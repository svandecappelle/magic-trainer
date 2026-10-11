import { describe, expect, it } from 'vitest';
import type { Card, Deck } from '../types';
import { checkDeck } from './legality';

const card = (name: string, extra: Partial<Card> = {}): Card => ({
  id: name, name, manaCost: '', cmc: 0, typeLine: 'Instant', oracleText: '', colors: [], colorIdentity: [], setCode: '', setName: '', rarity: '',
  legalities: { modern: 'legal', vintage: 'legal', commander: 'legal' }, ...extra,
});
const deck = (format: string, entries: [Card, number, ('main' | 'side' | 'commander')?][]): Deck => ({
  id: 'd', name: 'D', format, createdAt: 0, updatedAt: 0, entries: entries.map(([c, qty, board]) => ({ card: c, qty, board: board ?? 'main' })),
});
const mountain = card('Mountain', { typeLine: 'Basic Land — Mountain' });

describe('deck legality', () => {
  it('accepts a legal Modern deck and has no rules in casual', () => {
    expect(checkDeck(deck('modern', [[card('Bolt'), 4], [mountain, 56], [card('Smash'), 3, 'side']]))).toEqual([]);
    expect(checkDeck(deck('casual', [[card('Bolt'), 12]]))).toEqual([]);
  });

  it('reports size, sideboard, copies (main and side together), bans and missing data', () => {
    const issues = checkDeck(deck('modern', [
      [card('Bolt'), 4], [card('Bolt'), 1, 'side'], [card('Banned', { legalities: { modern: 'banned' } }), 1],
      [card('Old', { legalities: undefined }), 2], [card('Smash'), 16, 'side'], [mountain, 20],
    ]));
    expect(issues).toEqual(expect.arrayContaining([
      { kind: 'tooFew', n: 27, min: 60 },
      { kind: 'sideboard', n: 17, max: 15 },
      { kind: 'copies', card: 'Bolt', n: 5, max: 4 },
      { kind: 'copies', card: 'Smash', n: 16, max: 4 },
      { kind: 'banned', card: 'Banned' },
      { kind: 'unknown', n: 2 },
    ]));
    expect(issues.some((i) => i.kind === 'copies' && i.card === 'Mountain')).toBe(false);
  });

  it('limits restricted cards to one copy, and Commander decks to 100 singletons', () => {
    expect(checkDeck(deck('vintage', [[card('Lotus', { legalities: { vintage: 'restricted' } }), 2], [mountain, 58]])))
      .toEqual([{ kind: 'copies', card: 'Lotus', n: 2, max: 1 }]);
    const boss = card('Boss', { typeLine: 'Legendary Creature — Goblin', colorIdentity: ['R'] });
    const issues = checkDeck(deck('commander', [[card('Sol Ring'), 2], [mountain, 97], [boss, 1, 'commander']]));
    expect(issues).toEqual([{ kind: 'copies', card: 'Sol Ring', n: 2, max: 1 }]);
    expect(checkDeck(deck('commander', [[card('Rats', { oracleText: 'A deck can have any number of cards named Rats.' }), 30], [mountain, 69], [boss, 1, 'commander']]))).toEqual([]);
    expect(checkDeck(deck('commander', [[card('Counterspell', { colorIdentity: ['U'] }), 1], [mountain, 98], [boss, 1, 'commander']])))
      .toEqual([{ kind: 'identity', card: 'Counterspell' }]);
    expect(checkDeck(deck('commander', [[mountain, 100]]))).toEqual([{ kind: 'noCommander' }]);
    expect(checkDeck(deck('commander', [[mountain, 99], [card('Bolt'), 1, 'commander']]))).toEqual([{ kind: 'notCommander', card: 'Bolt' }]);
  });
});
