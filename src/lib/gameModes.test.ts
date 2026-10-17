import { describe, expect, it } from 'vitest';
import { cleanSetup, deckProblems, gameModeOf, startingLifeOf } from './gameModes';
import type { Card } from '../types';

const card = (name: string, legal: string, over: Partial<Card> = {}): Card => ({
  id: name, name, manaCost: '', cmc: 0, typeLine: 'Instant', oracleText: '', colors: [], colorIdentity: [],
  setCode: 't', setName: 'T', rarity: 'common', legalities: { modern: legal, legacy: 'legal', commander: legal }, ...over,
});
const mountain = card('Mountain', 'legal', { typeLine: 'Basic Land — Mountain' });
const bolt = card('Lightning Bolt', 'legal');
const guide = card('Simian Spirit Guide', 'banned');
const legal60 = [...Array(56).fill(mountain), ...Array(4).fill(bolt)];

describe('game modes', () => {
  it('turn into the engine mode and life', () => {
    expect(gameModeOf({ mode: 'constructed', format: 'modern', twoHeaded: true })).toEqual({ twoHeaded: true });
    expect(gameModeOf({ mode: 'duelCommander', format: 'modern', twoHeaded: true })).toEqual({ commander: true, duelCommander: true });
    expect(startingLifeOf({ mode: 'commander', format: 'modern', twoHeaded: false })).toBe(40);
    expect(startingLifeOf({ mode: 'duelCommander', format: 'modern', twoHeaded: false })).toBe(20);
    expect(startingLifeOf({ mode: 'free', format: 'modern', twoHeaded: true })).toBe(30);
    expect(cleanSetup({ mode: 'duelCommander', format: 'nope', twoHeaded: true })).toEqual({ mode: 'duelCommander', format: 'modern', twoHeaded: false });
    expect(cleanSetup(null)).toEqual({ mode: 'free', format: 'modern', twoHeaded: false });
  });

  it('block decks not legal in a Constructed format, warn in Commander, let anything play in Free Play', () => {
    const modern = { mode: 'constructed', format: 'modern', twoHeaded: false } as const;
    expect(deckProblems({ main: legal60, side: [], commander: [] }, modern)).toEqual({ blocking: [], warnings: [] });
    const banned = deckProblems({ main: [...legal60.slice(1), guide], side: [], commander: [] }, modern);
    expect(banned.blocking).toEqual([{ kind: 'banned', card: 'Simian Spirit Guide' }]);
    const pile = { main: [...Array(30).fill(mountain), ...Array(9).fill(bolt)], side: [], commander: [] };
    expect(deckProblems(pile, modern).blocking.map((i) => i.kind)).toEqual(['tooFew', 'copies']);
    expect(deckProblems(pile, { ...modern, mode: 'free' })).toEqual({ blocking: [], warnings: [] });
    const cmd = deckProblems(pile, { ...modern, mode: 'commander' });
    expect(cmd.blocking).toEqual([]);
    expect(cmd.warnings.map((i) => i.kind)).toContain('noCommander');
    // Cards saved without legality data can't be checked: a warning only.
    const old = card('Shock', 'legal', { legalities: undefined });
    expect(deckProblems({ main: [...legal60.slice(1), old], side: [], commander: [] }, modern)).toMatchObject({ blocking: [], warnings: [{ kind: 'unknown' }] });
  });

  it('checks Duel Commander against its own ban list', () => {
    const boss = card('Boss', 'legal', { typeLine: 'Legendary Creature — Goblin', legalities: { commander: 'legal', duel: 'legal' } });
    const land = card('Mountain', 'legal', { typeLine: 'Basic Land — Mountain', legalities: { commander: 'legal', duel: 'legal' } });
    // Legal in Commander, banned in Duel Commander (and the other way round).
    const ring = card('Sol Ring', 'legal', { legalities: { commander: 'legal', duel: 'banned' } });
    const deck = { main: [...Array(98).fill(land), ring], side: [], commander: [boss] };
    const duel = { mode: 'duelCommander', format: 'modern', twoHeaded: false } as const;
    expect(deckProblems(deck, duel).warnings).toEqual([{ kind: 'banned', card: 'Sol Ring' }]);
    expect(deckProblems(deck, { ...duel, mode: 'commander' }).warnings).toEqual([]);
    // Cards saved before the Duel Commander list was kept: unknown, refresh them.
    const old = card('Shock', 'legal', { legalities: { commander: 'legal' } });
    expect(deckProblems({ ...deck, main: [...Array(98).fill(land), old] }, duel).warnings).toEqual([{ kind: 'unknown', n: 1 }]);
  });
});
