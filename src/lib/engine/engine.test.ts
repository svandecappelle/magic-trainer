import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction, fallbackAction } from './bot';
import { actor, apply, IllegalAction, newGame, type GameState, type Permanent, type PlayerId } from './engine';
import { hasInstantSpeed } from './rules';
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
  const s = newGame({ decks: [Array(20).fill(mountain), Array(20).fill(mountain)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5, mulligans: false });
  s.players[0].hand = hand.map((c, i) => ({ iid: `h${i}`, card: c }));
  s.battlefield = perms.map((x, i): Permanent => ({
    iid: `p${i}`, card: x.card, controller: x.controller, tapped: x.tapped ?? false, sick: x.sick ?? false, damage: 0, deathtouched: false,
    pumpPower: 0, pumpToughness: 0,
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
    expect(() => apply(s, { type: 'cast', iid: 'h0' })).toThrow(/needsTarget/);
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
    expect(() => apply(atk, { type: 'declareAttackers', attackers: ['p1'] })).toThrow(/cannotAttack/);
    // Only a flyer attacks and the Bear can't block it: the blockers step is skipped.
    const skipped = apply(atk, { type: 'declareAttackers', attackers: ['p0'] });
    expect(skipped.step).toBe('main2');
    expect(skipped.players[1].life).toBe(19);

    // With a ground attacker too, blocks are declared, and the Bear still can't block the flyer.
    const both = board([
      { card: creature('Bird', 1, 1, ['Flying']), controller: 0 },
      { card: creature('Wolf', 2, 2), controller: 0 },
      { card: creature('Bear', 2, 2), controller: 1 },
    ]);
    const blk = apply(apply(both, { type: 'pass' }), { type: 'declareAttackers', attackers: ['p0', 'p1'] });
    expect(blk.step).toBe('block');
    expect(() => apply(blk, { type: 'declareBlockers', blocks: { p0: ['p2'] } })).toThrow(/cannotBlock/);
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

const island = card({ name: 'Island', typeLine: 'Basic Land — Island' });
const counterspell = card({ name: 'Counterspell', typeLine: 'Instant', manaCost: '{U}{U}', cmc: 2, oracleText: 'Counter target spell.' });
const negate = card({ name: 'Negate', typeLine: 'Instant', manaCost: '{1}{U}', cmc: 2, oracleText: 'Counter target noncreature spell.' });
const growth = card({ name: 'Giant Growth', typeLine: 'Instant', manaCost: '{G}', cmc: 1, oracleText: 'Target creature gets +3/+3 until end of turn.' });

/** Give player 1 a hand (the board() helper only sets player 0's). */
function withOpponentHand(s: GameState, cards: Card[]): GameState {
  s.players[1].hand = cards.map((c, i) => ({ iid: `o${i}`, card: c }));
  return s;
}

describe('mulligans', () => {
  it('runs the London mulligan in turn order, then starts turn 1', () => {
    let s = newGame({ decks: [Array(40).fill(mountain), Array(40).fill(forest)], names: ['A', 'B'], first: 1, rng: () => 0.3 });
    expect(s.step).toBe('mulligan');
    expect(actor(s)).toBe(1);
    expect(() => apply(s, { type: 'pass' })).toThrow(/keepFirst/);

    s = apply(s, { type: 'mulligan' });
    expect(s.players[1].hand).toHaveLength(7);
    expect(() => apply(s, { type: 'keep', bottom: [] })).toThrow(/chooseBottom/);
    const bottom = s.players[1].hand[0].iid;
    s = apply(s, { type: 'keep', bottom: [bottom] });
    expect(s.players[1].hand).toHaveLength(6);
    expect(s.players[1].library.at(-1)!.iid).toBe(bottom);

    expect(actor(s)).toBe(0);
    s = apply(s, { type: 'keep', bottom: [] });
    expect(s.mulligan).toBeNull();
    expect(s.turn).toBe(1);
    expect(s.active).toBe(1);
    expect(s.step).toBe('main1');
  });
});

describe('instant speed', () => {
  it('lets the defender kill an attacker before blocks', () => {
    let s = withOpponentHand(
      board([{ card: creature('Bear', 2, 2), controller: 0 }, { card: mountain, controller: 1 }]),
      [bolt],
    );
    s = apply(apply(s, { type: 'pass' }), { type: 'declareAttackers', attackers: ['p0'] });
    expect(s.priority).toMatchObject({ player: 1, reason: 'attack' });
    s = apply(s, { type: 'cast', iid: 'o0', target: { kind: 'permanent', iid: 'p0' } });
    // Player 0 has no instants, so they auto-pass, Bolt resolves and combat ends without attackers.
    expect(s.priority).toBeNull();
    expect(s.step).toBe('main2');
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Bear']);
    expect(s.players[1].life).toBe(20);
  });

  it('counters a spell; Negate cannot counter a creature', () => {
    const base = withOpponentHand(
      board([{ card: mountain, controller: 0 }, { card: island, controller: 1 }, { card: island, controller: 1 }], [creature('Goblin', 2, 2, [], '{R}')]),
      [negate, counterspell],
    );
    let s = apply(base, { type: 'cast', iid: 'h0' });
    expect(s.stack).toHaveLength(1);
    expect(actor(s)).toBe(1);
    expect(() => apply(s, { type: 'cast', iid: 'o0', target: { kind: 'spell', iid: 'h0' } })).toThrow(/counterFilter/);
    s = apply(s, { type: 'cast', iid: 'o1', target: { kind: 'spell', iid: 'h0' } });
    expect(s.stack).toHaveLength(0);
    expect(s.priority).toBeNull();
    expect(s.battlefield.some((p) => p.card.name === 'Goblin')).toBe(false);
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Goblin']);
  });

  it('pumps a creature after blocks to win the fight, and the boost wears off', () => {
    let s = board(
      [{ card: creature('Bear', 2, 2), controller: 0 }, { card: forest, controller: 0 }, { card: creature('Ogre', 3, 3), controller: 1 }],
      [growth],
    );
    s = apply(apply(s, { type: 'pass' }), { type: 'declareAttackers', attackers: ['p0'] });
    s = apply(s, { type: 'declareBlockers', blocks: { p0: ['p2'] } });
    expect(s.priority).toMatchObject({ player: 0, reason: 'block' });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p0' } });
    expect(s.step).toBe('main2');
    expect(s.battlefield.map((p) => p.card.name).sort()).toEqual(['Bear', 'Forest']);
    s = apply(s, { type: 'pass' }); // end turn
    expect(s.battlefield.find((p) => p.card.name === 'Bear')!.pumpPower).toBe(0);
  });

  it('offers an end-of-turn window, and casting a sorcery there is refused', () => {
    const sorcery = card({ name: 'Lava Spike', typeLine: 'Sorcery', manaCost: '{R}', cmc: 1, oracleText: 'Lava Spike deals 3 damage to target player or planeswalker.' });
    let s = withOpponentHand(board([{ card: mountain, controller: 1 }]), [sorcery, bolt]);
    s = apply(apply(s, { type: 'pass' }), { type: 'pass' }); // main1 → main2 → end of turn
    expect(s.priority).toMatchObject({ player: 1, reason: 'end' });
    expect(() => apply(s, { type: 'cast', iid: 'o0', target: { kind: 'player', player: 0 } })).toThrow(/sorcerySpeed/);
    s = apply(s, { type: 'cast', iid: 'o1', target: { kind: 'player', player: 0 } });
    expect(s.players[0].life).toBe(17);
    expect(s.active).toBe(1); // turn passed after the window closed
  });

  it('casts flash creatures at instant speed and fizzles spells whose target is gone', () => {
    const knight = creature('Benalish Knight', 2, 2, ['First strike', 'Flash'], '{W}');
    expect(hasInstantSpeed(knight)).toBe(true);
    // Player 0 bolts a creature; player 1 responds by bolting the same creature first.
    let s = withOpponentHand(
      board([{ card: mountain, controller: 0 }, { card: creature('Bear', 2, 2), controller: 1 }, { card: mountain, controller: 1 }], [bolt]),
      [bolt],
    );
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p1' } });
    s = apply(s, { type: 'cast', iid: 'o0', target: { kind: 'permanent', iid: 'p1' } });
    expect(s.log.some((l) => l.k === 'fizzles')).toBe(true);
    expect(s.stack).toHaveLength(0);
  });
});

describe('full control', () => {
  it('stops at every window, including your own spell, only for the player who turned it on', () => {
    let s = board([{ card: creature('Bear', 2, 2), controller: 0 }, { card: mountain, controller: 0 }], [creature('Goblin', 2, 2, [], '{R}')]);
    // Allowed even when it is not your turn to act.
    s = apply(s, { type: 'setFullControl', player: 1, on: true });
    s = apply(s, { type: 'setFullControl', player: 0, on: true });
    expect(s.fullControl).toEqual([true, true]);

    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.priority).toMatchObject({ player: 1, reason: 'main' });
    s = apply(s, { type: 'pass' });
    expect(s.priority).toMatchObject({ player: 0, reason: 'main' }); // respond to your own spell
    s = apply(s, { type: 'pass' });
    expect(s.priority).toBeNull();

    s = apply(s, { type: 'pass' }); // main1 → beginning of combat
    expect(s.priority).toMatchObject({ player: 1, reason: 'combat' });
    s = apply(s, { type: 'pass' });
    expect(s.step).toBe('attack');
    s = apply(s, { type: 'declareAttackers', attackers: ['p0'] });
    expect(s.priority).toMatchObject({ player: 0, reason: 'attack' }); // the attacker first
    s = apply(apply(s, { type: 'pass' }), { type: 'pass' });
    // Player 1 has nothing to block with: straight to the window after blocks.
    expect(s.priority).toMatchObject({ player: 0, reason: 'block' });
    s = apply(apply(s, { type: 'pass' }), { type: 'pass' }); // damage
    expect(s.players[1].life).toBe(18);
    s = apply(s, { type: 'pass' }); // end turn
    expect(s.priority).toMatchObject({ player: 1, reason: 'end' });
    s = apply(s, { type: 'pass' });
    expect(s.active).toBe(1);
    expect(s.priority).toMatchObject({ player: 0, reason: 'begin' });

    // Without full control, the same game never stops for player 0 when they have nothing castable.
    s = apply(s, { type: 'setFullControl', player: 0, on: false });
    s = apply(s, { type: 'pass' });
    expect(s.priority).toBeNull();
    expect(actor(s)).toBe(1);
  });

  it('lets the defender remove a creature at beginning of combat, skipping combat if nothing can attack', () => {
    let s = withOpponentHand(board([{ card: creature('Bear', 2, 2), controller: 0 }, { card: mountain, controller: 1 }]), [bolt]);
    s = apply(s, { type: 'setFullControl', player: 1, on: true });
    s = apply(s, { type: 'pass' });
    expect(s.priority).toMatchObject({ player: 1, reason: 'combat' });
    s = apply(s, { type: 'cast', iid: 'o0', target: { kind: 'permanent', iid: 'p0' } });
    s = apply(s, { type: 'pass' }); // player 1 lets Bolt resolve, then passes again with an empty stack
    expect(s.priority).toMatchObject({ player: 1, reason: 'combat' });
    s = apply(s, { type: 'pass' });
    expect(s.step).toBe('main2');
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Bear']);
  });
});

describe('bot with instants', () => {
  it('saves its creature from burn with a pump spell, and mulligans a no-land hand', () => {
    let s = withOpponentHand(
      board([{ card: mountain, controller: 0 }, { card: creature('Bear', 2, 2), controller: 1 }, { card: forest, controller: 1 }], [bolt]),
      [growth],
    );
    s.players[0].hand = [{ iid: 'h0', card: bolt }];
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p1' } });
    expect(botAction(s)).toEqual({ type: 'cast', iid: 'o0', target: { kind: 'permanent', iid: 'p1' } });

    const m = newGame({ decks: [Array(40).fill(bolt), Array(40).fill(bolt)], names: ['A', 'B'], first: 0 });
    expect(botAction(m)).toEqual({ type: 'mulligan' });
  });
});
