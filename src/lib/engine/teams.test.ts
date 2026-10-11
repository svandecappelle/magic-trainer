import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { actor, apply, newGame, opponentsOf, teammatesOf, wonBy, type GameState, type Permanent, type PlayerId } from './engine';

let n = 0;
function card(partial: Partial<Card> & { name: string }): Card {
  return {
    id: `id-${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
    setCode: 't', setName: 'T', rarity: 'common', keywords: [], ...partial,
  };
}
const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
const creature = (name: string, p: number, t: number, extra: Partial<Card> = {}) =>
  card({ name, power: String(p), toughness: String(t), manaCost: '{1}', cmc: 1, ...extra });
const spell = (name: string, oracleText: string, typeLine = 'Sorcery') => card({ name, typeLine, manaCost: '{1}', cmc: 1, oracleText });

/** A Two-Headed Giant game (players 0+1 against 2+3), mulligans done, team 0 starting. */
function twoHeaded(opts: { mulligans?: boolean } = {}): GameState {
  return newGame({
    decks: [0, 1, 2, 3].map(() => Array(30).fill(mountain)),
    names: ['A', 'B', 'C', 'D'],
    first: 0,
    mode: { twoHeaded: true },
    rng: () => 0.5,
    mulligans: opts.mulligans ?? false,
  });
}
const put = (s: GameState, p: PlayerId, c: Card, iid: string): Permanent => {
  const perm: Permanent = { iid, card: c, controller: p, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] };
  s.battlefield.push(perm);
  return perm;
};
const lands = (s: GameState, p: PlayerId, k: number) => { for (let i = 0; i < k; i++) put(s, p, mountain, `land-${p}-${i}`); };

describe('Two-Headed Giant', () => {
  it('sets up two teams sharing 30 life, with mulligans in turn order', () => {
    let s = twoHeaded({ mulligans: true });
    expect(s.teams).toEqual([[0, 1], [2, 3]]);
    expect(s.players.map((p) => p.life)).toEqual([30, 30, 30, 30]);
    expect(s.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(teammatesOf(s, 2)).toEqual([3]);
    expect(opponentsOf(s, 1)).toEqual([2, 3]);
    const order: number[] = [];
    while (s.mulligan) {
      order.push(actor(s)!);
      s = apply(s, { type: 'keep', bottom: [] });
    }
    expect(order).toEqual([0, 1, 2, 3]);
    // The starting team skips its first draw.
    expect(s.players[0].hand).toHaveLength(7);
    expect(s.players[1].hand).toHaveLength(7);
  });

  it('lets each head act in the main phase, then the other team draws for both heads', () => {
    let s = twoHeaded();
    expect(actor(s)).toBe(0);
    s = apply(s, { type: 'pass' });
    expect(actor(s)).toBe(1); // the teammate's main phase
    s = apply(s, { type: 'pass' });
    expect(s.step).toBe('main2');
    s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'pass' }); // both heads end the turn
    expect(s.active).toBe(2);
    expect(actor(s)).toBe(2);
    expect(s.players[2].hand).toHaveLength(8);
    expect(s.players[3].hand).toHaveLength(8);
  });

  it('shares life: damage to one player hits the team, "each opponent" counts each opponent', () => {
    let s = twoHeaded();
    lands(s, 0, 2);
    s.players[0].hand = [
      { iid: 'shock', card: spell('Shock', 'Shock deals 2 damage to any target.', 'Instant') },
      { iid: 'drain', card: spell('Drain', 'Each opponent loses 1 life.') },
    ];
    s = apply(s, { type: 'cast', iid: 'shock', target: { kind: 'player', player: 3 } });
    expect(s.players.map((p) => p.life)).toEqual([30, 30, 28, 28]);
    s = apply(s, { type: 'cast', iid: 'drain' });
    expect(s.players[2].life).toBe(26);
  });

  it('passes priority around all four players before a spell resolves', () => {
    let s = twoHeaded();
    lands(s, 0, 1);
    lands(s, 2, 1);
    s.players[0].hand = [{ iid: 'shock', card: spell('Shock', 'Shock deals 2 damage to any target.', 'Instant') }];
    s.players[2].hand = [{ iid: 'bolt', card: spell('Bolt', 'Bolt deals 3 damage to any target.', 'Instant') }];
    s.fullControl = [true, true, true, true];
    s = apply(s, { type: 'cast', iid: 'shock', target: { kind: 'player', player: 2 } });
    const seen: number[] = [];
    while (s.stack.length) {
      seen.push(actor(s)!);
      s = apply(s, { type: 'pass' });
    }
    expect(seen).toEqual([1, 2, 3, 0]);
  });

  it('loses as a team: poison counts to 15, and conceding loses for both', () => {
    let s = twoHeaded();
    lands(s, 0, 1);
    s.players[0].hand = [{ iid: 'p', card: spell('Prick', 'Target player gets two poison counters.') }];
    s.players[2].poison = 13;
    s.players[3].poison = 13;
    s = apply(s, { type: 'cast', iid: 'p', target: { kind: 'player', player: 3 } });
    expect(s.players[2].poison).toBe(15);
    expect(wonBy(s, 1)).toBe(true);
    expect(wonBy(s, 2)).toBe(false);
    const t = apply(twoHeaded(), { type: 'concede', player: 1 });
    expect(wonBy(t, 2)).toBe(true);
    expect(wonBy(t, 0)).toBe(false);
  });

  it('has both heads attack and both defenders block, then damages the team', () => {
    let s = twoHeaded();
    put(s, 0, creature('Ogre', 3, 3), 'ogre');
    put(s, 1, creature('Bear', 2, 2), 'bear');
    put(s, 2, creature('Wall', 0, 4), 'wall');
    put(s, 3, creature('Elf', 1, 1), 'elf');
    s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'pass' }); // both heads done with main 1: combat
    while (s.priority) s = apply(s, { type: 'pass' });
    expect(s.step).toBe('attack');
    expect(actor(s)).toBe(0);
    s = apply(s, { type: 'declareAttackers', attackers: ['ogre'] });
    expect(actor(s)).toBe(1);
    s = apply(s, { type: 'declareAttackers', attackers: ['bear'] });
    while (s.priority) s = apply(s, { type: 'pass' });
    expect(s.step).toBe('block');
    expect(actor(s)).toBe(2);
    s = apply(s, { type: 'declareBlockers', blocks: { ogre: ['wall'] } });
    expect(actor(s)).toBe(3);
    s = apply(s, { type: 'declareBlockers', blocks: {} });
    while (s.priority) s = apply(s, { type: 'pass' });
    expect(s.step).toBe('main2');
    expect(s.players[2].life).toBe(28); // the Bear's 2 damage, shared
    expect(s.players[3].life).toBe(28);
  });

  it('lets bots play a whole Two-Headed Giant game', () => {
    let s = newGame({
      decks: [0, 1, 2, 3].map((p) => [...Array(17).fill(mountain), ...Array.from({ length: 13 }, (_, i) => creature(`C${p}-${i}`, 2, 2))]),
      names: ['A', 'B', 'C', 'D'], first: 0, mode: { twoHeaded: true }, rng: () => 0.3,
    });
    for (let i = 0; i < 3000 && s.winner === null; i++) s = apply(s, botAction(s));
    expect(s.winner).not.toBeNull();
  });
});

describe('Commander', () => {
  const boss = creature('Boss', 5, 5, { typeLine: 'Legendary Creature — Giant', manaCost: '{2}', cmc: 2 });
  function commanderDuel(): GameState {
    return newGame({
      decks: [Array(40).fill(mountain), Array(40).fill(mountain)], names: ['A', 'B'], first: 0, rng: () => 0.5, mulligans: false,
      mode: { commander: true }, commanders: [[boss], []],
    });
  }

  it('starts at 40 life (60 for a Two-Headed Giant team) with commanders in the command zone', () => {
    const s = commanderDuel();
    expect(s.players.map((p) => p.life)).toEqual([40, 40]);
    expect(s.players[0].command).toMatchObject([{ iid: '0-cmd-0', commander: true }]);
    expect(s.players[1].command).toEqual([]);
    const t = newGame({ decks: [0, 1, 2, 3].map(() => Array(40).fill(mountain)), names: ['A', 'B', 'C', 'D'], first: 0, mulligans: false, mode: { twoHeaded: true, commander: true } });
    expect(t.players.map((p) => p.life)).toEqual([60, 60, 60, 60]);
  });

  it('casts the commander from the command zone, back there when it dies, then pays the tax', () => {
    let s = commanderDuel();
    lands(s, 0, 4);
    s = apply(s, { type: 'cast', iid: '0-cmd-0' });
    expect(s.battlefield.find((p) => p.iid === '0-cmd-0')).toMatchObject({ commander: true });
    // It dies: back to the command zone, not the graveyard.
    s.battlefield.find((p) => p.iid === '0-cmd-0')!.damage = 9;
    s = apply(s, { type: 'pass' });
    expect(s.players[0].command!.map((c) => c.iid)).toEqual(['0-cmd-0']);
    expect(s.players[0].graveyard).toEqual([]);
    expect(s.log.some((e) => e.k === 'toCommand')).toBe(true);
    // Two lands left: {2} + {2} tax is too much.
    const again = { ...s, step: 'main1' as const, priority: null, active: 0 as PlayerId };
    expect(() => apply(again, { type: 'cast', iid: '0-cmd-0' })).toThrow();
    again.battlefield.forEach((p) => (p.tapped = false));
    expect(apply(again, { type: 'cast', iid: '0-cmd-0' }).battlefield.some((p) => p.iid === '0-cmd-0')).toBe(true);
  });

  it('makes a player lose at 21 combat damage from one commander', () => {
    let s = commanderDuel();
    const perm = put(s, 0, boss, '0-cmd-0');
    perm.commander = true;
    s.players[0].command = [];
    s.players[1].commanderDamage = { '0-cmd-0': 16 };
    s = apply(s, { type: 'pass' });
    while (s.priority) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: ['0-cmd-0'] });
    while (s.winner === null && s.step !== 'main2') s = apply(s, s.priority ? { type: 'pass' } : { type: 'declareBlockers', blocks: {} });
    expect(s.players[1].life).toBe(35);
    expect(s.winner).toBe(0);
    expect(s.log.some((e) => e.k === 'commanderDamage')).toBe(true);
  });
});
