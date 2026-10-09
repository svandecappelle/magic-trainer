import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction, fallbackAction } from './bot';
import { actor, apply, IllegalAction, newGame, type GameState, type Permanent, type PlayerId } from './engine';
import { findPayment, manaColors, parseCost, parseEffects } from './rules';

let n = 0;
function card(partial: Partial<Card> & { name: string }): Card {
  return {
    id: `id-${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
    setCode: 't', setName: 'T', rarity: 'common', keywords: [], ...partial,
  };
}
const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
const creature = (name: string, p: number, t: number, keywords: string[] = [], manaCost = '{1}') =>
  card({ name, power: String(p), toughness: String(t), keywords, manaCost, cmc: parseCost(manaCost).generic + parseCost(manaCost).colored.length });
const bolt = card({ name: 'Lightning Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracleText: 'Lightning Bolt deals 3 damage to any target.' });

/** A game in main1 of player 0's turn with a hand-built battlefield. */
function board(perms: { card: Card; controller: PlayerId; tapped?: boolean; sick?: boolean }[], hand: Card[] = []): GameState {
  const s = newGame({ decks: [Array(20).fill(mountain), Array(20).fill(mountain)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5 });
  s.players[0].hand = hand.map((c, i) => ({ iid: `h${i}`, card: c }));
  s.battlefield = perms.map((x, i): Permanent => ({
    iid: `p${i}`, card: x.card, controller: x.controller, tapped: x.tapped ?? false, sick: x.sick ?? false, damage: 0, deathtouched: false,
  }));
  return s;
}

/** Attack with the given permanents and have the defender block as specified. */
function fight(s: GameState, attackers: string[], blocks: Record<string, string[]>): GameState {
  s = apply(s, { type: 'pass' });
  s = apply(s, { type: 'declareAttackers', attackers });
  return apply(s, { type: 'declareBlockers', blocks });
}

describe('rules', () => {
  it('parses costs and pays them with the right colors', () => {
    expect(parseCost('{2}{R}{W/U}')).toEqual({ generic: 2, colored: [['R'], ['W', 'U']] });
    const sources = [
      { iid: 'a', colors: ['R' as const] },
      { iid: 'b', colors: ['G' as const] },
      { iid: 'c', colors: ['U' as const, 'R' as const] },
    ];
    expect(findPayment(sources, parseCost('{R}{U}'))?.sort()).toEqual(['a', 'c']);
    expect(findPayment(sources, parseCost('{U}{U}'))).toBeNull();
    expect(findPayment(sources, parseCost('{3}{G}'))).toBeNull();
  });

  it('reads mana abilities and spell effects', () => {
    expect(manaColors(card({ name: 'Elves', oracleText: '{T}: Add {G}.' }))).toEqual(['G']);
    expect(manaColors(card({ name: 'City', typeLine: 'Land', oracleText: '{T}: Add one mana of any color.' }))).toHaveLength(5);
    expect(parseEffects(bolt)).toEqual([{ kind: 'damage', amount: 3, target: 'any' }]);
    const stp = card({ name: 'StP', typeLine: 'Instant', oracleText: 'Exile target creature. Its controller gains life equal to its power.' });
    expect(parseEffects(stp)).toEqual([{ kind: 'destroy', exile: true }]);
    const divination = card({ name: 'Div', typeLine: 'Sorcery', oracleText: 'Draw two cards.' });
    expect(parseEffects(divination)).toEqual([{ kind: 'draw', n: 2 }]);
  });
});

describe('engine', () => {
  it('casts a burn spell, tapping a matching land', () => {
    let s = board([{ card: mountain, controller: 0 }, { card: creature('Bear', 2, 2), controller: 1 }], [bolt]);
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p1' } });
    expect(s.battlefield.map((p) => p.card.name)).toEqual(['Mountain']);
    expect(s.battlefield[0].tapped).toBe(true);
    expect(s.players[1].graveyard.map((c) => c.card.name)).toContain('Bear');
  });

  it('rejects illegal actions', () => {
    const s = board([{ card: forest, controller: 0 }], [bolt]);
    expect(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } })).toThrow(IllegalAction);
    expect(() => apply(s, { type: 'cast', iid: 'h0' })).toThrow(/needs a target/);
  });

  it('handles trample, deathtouch, lifelink and first strike in combat', () => {
    // Trample: 5/5 blocked by 2/2 → 3 tramples over.
    let s = fight(board([{ card: creature('Wurm', 5, 5, ['Trample']), controller: 0 }, { card: creature('Bear', 2, 2), controller: 1 }]), ['p0'], { p0: ['p1'] });
    expect(s.players[1].life).toBe(17);

    // Deathtouch 1/1 kills a 5/5 blocker; lifelink gains life.
    s = fight(board([{ card: creature('Snake', 1, 1, ['Deathtouch', 'Lifelink']), controller: 0 }, { card: creature('Wall', 0, 5), controller: 1 }]), ['p0'], { p0: ['p1'] });
    expect(s.battlefield.map((p) => p.card.name)).toEqual(['Snake']);
    expect(s.players[0].life).toBe(21);

    // First strike 2/1 kills a 2/2 blocker before it can strike back.
    s = fight(board([{ card: creature('Knight', 2, 1, ['First strike']), controller: 0 }, { card: creature('Bear', 2, 2), controller: 1 }]), ['p0'], { p0: ['p1'] });
    expect(s.battlefield.map((p) => p.card.name)).toEqual(['Knight']);
  });

  it('enforces flying and summoning sickness', () => {
    const s = board([
      { card: creature('Bird', 1, 1, ['Flying']), controller: 0 },
      { card: creature('Fresh', 3, 3), controller: 0, sick: true },
      { card: creature('Bear', 2, 2), controller: 1 },
    ]);
    const atk = apply(s, { type: 'pass' });
    expect(() => apply(atk, { type: 'declareAttackers', attackers: ['p1'] })).toThrow(/cannot attack/);
    const blk = apply(atk, { type: 'declareAttackers', attackers: ['p0'] });
    expect(() => apply(blk, { type: 'declareBlockers', blocks: { p0: ['p2'] } })).toThrow(/cannot block/);
  });
});

describe('bot', () => {
  it('chump blocks when the attack would be lethal, not otherwise', () => {
    let s = board([{ card: creature('Giant', 5, 5), controller: 0 }, { card: creature('Squirrel', 1, 1), controller: 1 }]);
    s = apply(apply(s, { type: 'pass' }), { type: 'declareAttackers', attackers: ['p0'] });
    expect(botAction(s)).toEqual({ type: 'declareBlockers', blocks: {} });
    s.players[1].life = 5;
    expect(botAction(s)).toEqual({ type: 'declareBlockers', blocks: { p0: ['p1'] } });
  });

  it('burns face for lethal, otherwise kills a creature', () => {
    const s = board([{ card: mountain, controller: 1 }, { card: creature('Bear', 2, 2), controller: 0 }]);
    s.active = 1;
    s.players[1].hand = [{ iid: 'b', card: bolt }];
    expect(botAction(s)).toEqual({ type: 'cast', iid: 'b', target: { kind: 'permanent', iid: 'p1' } });
    s.players[0].life = 3;
    expect(botAction(s)).toEqual({ type: 'cast', iid: 'b', target: { kind: 'player', player: 0 } });
  });

  it('plays full bot-vs-bot games to completion', () => {
    const red = [...Array(17).fill(mountain), ...Array(4).fill(bolt), ...Array(19).fill(creature('Goblin', 2, 1, ['Haste'], '{1}{R}'))];
    const green = [...Array(17).fill(forest), ...Array(23).fill(creature('Bear', 2, 2, [], '{1}{G}'))];
    for (let seed = 0; seed < 20; seed++) {
      let x = seed + 1;
      const rng = () => ((x = (x * 16807) % 2147483647) / 2147483647);
      let s = newGame({ decks: [red, green], names: ['Red', 'Green'], first: (seed % 2) as PlayerId, rng });
      let steps = 0;
      while (actor(s) !== null && steps++ < 5000) {
        try {
          s = apply(s, botAction(s));
        } catch (e) {
          if (!(e instanceof IllegalAction)) throw e;
          s = apply(s, fallbackAction(s));
        }
      }
      expect(s.winner).not.toBeNull();
    }
  });
});
