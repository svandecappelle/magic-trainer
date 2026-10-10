import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { redact } from '../multiplayer/protocol';
import { botAction } from './bot';
import {
  actor, addAbility, apply, hasKw, powerOf, newGame, toughnessOf, validateAnswer,
  type Choice, type GameState, type Permanent, type PlayerId,
} from './engine';
import { parseAbilityText, parseTargetPhrase } from './rules';

let n = 0;
function card(partial: Partial<Card> & { name: string }): Card {
  return {
    id: `id-${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
    setCode: 't', setName: 'T', rarity: 'common', keywords: [], ...partial,
  };
}
const land = (name: string, type: string) => card({ name, typeLine: `Basic Land — ${type}` });
const mountain = land('Mountain', 'Mountain');
const island = land('Island', 'Island');
const swamp = land('Swamp', 'Swamp');
const forest = land('Forest', 'Forest');
const creature = (name: string, p: number, t: number, extra: Partial<Card> = {}) =>
  card({ name, power: String(p), toughness: String(t), manaCost: '{1}', cmc: 1, ...extra });
const spell = (name: string, manaCost: string, oracleText: string, typeLine = 'Instant') =>
  card({ name, typeLine, manaCost, cmc: manaCost.length / 3, oracleText });

/** Player 0's main phase 1 with a hand-built battlefield; player 1's hand is optional. */
function board(perms: { card: Card; controller: PlayerId; tapped?: boolean }[], hand: Card[] = [], oppHand: Card[] = []): GameState {
  const s = newGame({ decks: [Array(20).fill(mountain), Array(20).fill(mountain)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5, mulligans: false });
  s.players[0].hand = hand.map((c, i) => ({ iid: `h${i}`, card: c }));
  s.players[1].hand = oppHand.map((c, i) => ({ iid: `o${i}`, card: c }));
  s.battlefield = perms.map((x, i): Permanent => ({
    iid: `p${i}`, card: x.card, controller: x.controller, tapped: x.tapped ?? false, sick: false, damage: 0, deathtouched: false,
    counters: {}, boosts: [],
  }));
  return s;
}

const perm = (s: GameState, name: string) => s.battlefield.find((p) => p.card.name === name);

describe('target phrases (0.3)', () => {
  it('understands kinds, counts and restrictions, and refuses unknown words', () => {
    expect(parseTargetPhrase('target nonblack creature')).toEqual({ kind: 'creature', min: 1, max: 1, filter: { nonColors: ['B'] } });
    expect(parseTargetPhrase('up to two target creatures you control')).toEqual({ kind: 'creature', min: 0, max: 2, filter: { controller: 'you' } });
    expect(parseTargetPhrase('target artifact, enchantment, or land')).toMatchObject({ kind: 'permanent', filter: { types: ['artifact', 'enchantment', 'land'] } });
    expect(parseTargetPhrase('target creature spell')).toMatchObject({ kind: 'spell', filter: { types: ['creature'] } });
    expect(parseTargetPhrase('target opponent')).toMatchObject({ kind: 'player', filter: { controller: 'opponent' } });
    expect(parseTargetPhrase('target attacking or blocking creature')).toMatchObject({ filter: { inCombat: true } });
    expect(parseTargetPhrase('target creature with flying')).toMatchObject({ filter: { keyword: 'flying' } });
    expect(parseTargetPhrase('target creature with power 4 or greater')).toMatchObject({ filter: { minPower: 4 } });
    // Unknown restrictions make the whole spell "not simulated" instead of silently ignored.
    expect(parseTargetPhrase('target legendary creature')).toBeNull();
    expect(parseAbilityText('Destroy target legendary creature.')).toEqual({ targets: [], effects: [] });
  });
});

describe('targets in play (0.3)', () => {
  it('casts a spell on several targets, and checks counts, duplicates and restrictions', () => {
    const rally = spell('Rally', '{R}', 'Up to two target creatures each get +1/+1 until end of turn.');
    const base = board(
      [{ card: mountain, controller: 0 }, { card: creature('Bear', 2, 2), controller: 0 }, { card: creature('Ogre', 3, 3), controller: 1 }],
      [rally],
    );
    const bear = { kind: 'permanent', iid: 'p1' } as const;
    const ogre = { kind: 'permanent', iid: 'p2' } as const;
    expect(() => apply(base, { type: 'cast', iid: 'h0', targets: [[bear, bear]] })).toThrow(/tooManyTargets/);
    expect(() => apply(base, { type: 'cast', iid: 'h0', targets: [[bear, ogre, bear]] })).toThrow(/tooManyTargets/);
    const s = apply(base, { type: 'cast', iid: 'h0', targets: [[bear, ogre]] });
    expect(powerOf(perm(s, 'Bear')!)).toBe(3);
    expect(powerOf(perm(s, 'Ogre')!)).toBe(4);
    // "Up to": zero targets is fine.
    expect(apply(base, { type: 'cast', iid: 'h0', targets: [[]] }).players[0].graveyard).toHaveLength(1);

    const doomBlade = spell('Doom Blade', '{B}', 'Destroy target nonblack creature.');
    const b2 = board(
      [{ card: swamp, controller: 0 }, { card: creature('Zombie', 2, 2, { colors: ['B'] }), controller: 1 }, { card: creature('Elf', 1, 1, { colors: ['G'] }), controller: 1 }],
      [doomBlade],
    );
    expect(() => apply(b2, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p1' } })).toThrow(/illegalTarget/);
    expect(() => apply(b2, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } })).toThrow(/targetMustBe/);
    expect(perm(apply(b2, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p2' } }), 'Elf')).toBeUndefined();
  });

  it('resolves on the targets that are still legal, and fizzles only when none are', () => {
    const rally = spell('Rally', '{R}', 'Up to two target creatures each get +1/+1 until end of turn.');
    const bolt = spell('Lightning Bolt', '{R}', 'Lightning Bolt deals 3 damage to any target.');
    let s = board(
      [{ card: mountain, controller: 0 }, { card: creature('Bear', 2, 2), controller: 0 }, { card: creature('Ogre', 3, 3), controller: 0 }, { card: mountain, controller: 1 }],
      [rally],
      [bolt],
    );
    s = apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: 'p1' }, { kind: 'permanent', iid: 'p2' }]] });
    s = apply(s, { type: 'cast', iid: 'o0', target: { kind: 'permanent', iid: 'p1' } }); // the bot kills the Bear in response
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(powerOf(perm(s, 'Ogre')!)).toBe(4);
    expect(s.log.some((l) => l.k === 'fizzles')).toBe(false);
  });
});

describe('lasting effects and counters (0.4)', () => {
  it('grants keywords until end of turn, shrinks to death, and keeps counters across turns', () => {
    const wings = spell('Wings', '{R}', 'Target creature gets +1/+0 and gains flying until end of turn.');
    let s = board([{ card: mountain, controller: 0 }, { card: creature('Bear', 2, 2), controller: 0 }, { card: creature('Wall', 0, 5), controller: 1 }], [wings]);
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p1' } });
    expect(hasKw(perm(s, 'Bear')!, 'flying')).toBe(true);
    // The ground Wall can't block a flier: blocks are skipped and, with nothing to cast, damage is dealt at once.
    s = apply(apply(s, { type: 'pass' }), { type: 'declareAttackers', attackers: ['p1'] });
    expect(s.step).toBe('main2');
    expect(s.players[1].life).toBe(17);
    s = apply(s, { type: 'pass' }); // end of turn
    expect(hasKw(perm(s, 'Bear')!, 'flying')).toBe(false);

    const shrink = spell('Shrink', '{R}', 'Target creature gets -2/-2 until end of turn.');
    const grow = spell('Grow', '{R}', 'Put two +1/+1 counters on target creature.');
    const wither = spell('Wither', '{R}', 'Put a -1/-1 counter on target creature.');
    let t = board(
      [{ card: mountain, controller: 0 }, { card: mountain, controller: 0 }, { card: mountain, controller: 0 }, { card: mountain, controller: 0 },
        { card: creature('Bear', 2, 2), controller: 0 }, { card: creature('Elf', 1, 2), controller: 1 }],
      [shrink, grow, wither],
    );
    t = apply(t, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: 'p5' } });
    expect(perm(t, 'Elf')).toBeUndefined(); // 0 toughness
    t = apply(t, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: 'p4' } });
    t = apply(t, { type: 'cast', iid: 'h2', target: { kind: 'permanent', iid: 'p4' } });
    expect(perm(t, 'Bear')!.counters).toEqual({ '+1/+1': 1, '-1/-1': 0 }); // they cancel out
    t = apply(apply(apply(t, { type: 'pass' }), { type: 'pass' }), { type: 'pass' }); // through to the next turn
    expect(t.active).toBe(1);
    expect([powerOf(perm(t, 'Bear')!), toughnessOf(perm(t, 'Bear')!)]).toEqual([3, 3]);
  });
});

describe('choices (0.2)', () => {
  it('asks the active player which cards to discard at end of turn', () => {
    let s = board([], Array(9).fill(mountain));
    s = apply(apply(s, { type: 'pass' }), { type: 'pass' });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', player: 0, purpose: 'cleanupDiscard', min: 2, max: 2 });
    expect(actor(s)).toBe(0);
    expect(() => apply(s, { type: 'pass' })).toThrow(/makeChoiceFirst/);
    expect(() => apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0'] } })).toThrow(/badChoice/);
    expect(() => apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0', 'nope'] } })).toThrow(/badChoice/);

    // Online, the opponent doesn't see which cards are offered.
    const seen = redact(s, 1).pending!.choice;
    expect(seen.kind === 'cards' && seen.options.every((c) => c.card.name === 'Hidden card')).toBe(true);

    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h3', 'h7'] } });
    expect(s.players[0].graveyard.map((c) => c.iid)).toEqual(['h3', 'h7']);
    expect(s.players[0].hand).toHaveLength(7);
    expect(s.active).toBe(1);
    expect(s.pending).toBeNull();
  });

  it('lets the bot answer: it discards to hand size on its own', () => {
    let s = board([], [], Array(9).fill(creature('Big', 5, 5, { cmc: 5, manaCost: '{5}' })));
    s.active = 1;
    s = apply(apply(s, { type: 'pass' }), { type: 'pass' });
    expect(s.pending?.choice.player).toBe(1);
    s = apply(s, botAction(s));
    expect(s.players[1].hand).toHaveLength(7);
  });

  it('asks whether to pay for "counter unless its controller pays"', () => {
    const leak = spell('Mana Leak', '{1}{U}', 'Counter target spell unless its controller pays {3}.');
    const ogre = creature('Ogre', 3, 3, { manaCost: '{R}', cmc: 1 });
    const lands = (k: number) => Array.from({ length: k }, () => ({ card: mountain, controller: 0 as PlayerId }));
    const setup = (mountains: number) =>
      apply(board([...lands(mountains), { card: island, controller: 1 }, { card: island, controller: 1 }], [ogre], [leak]), { type: 'cast', iid: 'h0' });

    // Nobody has anything else to cast: both auto-pass and Mana Leak resolves straight away.
    const s = apply(setup(4), { type: 'cast', iid: 'o0', target: { kind: 'spell', iid: 'h0' } });
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', player: 0, purpose: 'payOrCounter', params: { card: 'Ogre', n: 3 } });
    const paid = apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } });
    expect(paid.log.some((l) => l.k === 'paid')).toBe(true);
    expect(perm(paid, 'Ogre')).toBeDefined();
    expect(paid.battlefield.filter((x) => x.card.name === 'Mountain' && x.tapped)).toHaveLength(4);
    const declined = apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } });
    expect(perm(declined, 'Ogre')).toBeUndefined();

    // Can't pay: countered without asking.
    const poor = apply(setup(1), { type: 'cast', iid: 'o0', target: { kind: 'spell', iid: 'h0' } });
    expect(poor.pending).toBeNull();
    expect(poor.players[0].graveyard.map((c) => c.card.name)).toEqual(['Ogre']);
  });

  it('validates arrange and mode answers', () => {
    const cards = [{ iid: 'a', card: mountain }, { iid: 'b', card: forest }];
    const scry: Choice = { kind: 'arrange', player: 0, purpose: 'cleanupDiscard', cards, zones: ['top', 'bottom'] };
    expect(() => validateAnswer(scry, { kind: 'arrange', zones: { top: ['b'], bottom: ['a'] } })).not.toThrow();
    expect(() => validateAnswer(scry, { kind: 'arrange', zones: { top: ['a'] } })).toThrow(/badChoice/);
    expect(() => validateAnswer(scry, { kind: 'arrange', zones: { graveyard: ['a', 'b'] } })).toThrow(/badChoice/);
    expect(() => validateAnswer(scry, { kind: 'arrange', zones: { top: ['a', 'a'], bottom: ['b'] } })).toThrow(/badChoice/);
    const modes: Choice = { kind: 'mode', player: 0, purpose: 'cleanupDiscard', min: 1, max: 2, modes: ['x', 'y', 'z'] };
    expect(() => validateAnswer(modes, { kind: 'mode', modes: [0, 2] })).not.toThrow();
    expect(() => validateAnswer(modes, { kind: 'mode', modes: [] })).toThrow(/badChoice/);
    expect(() => validateAnswer(modes, { kind: 'mode', modes: [3] })).toThrow(/badChoice/);
    expect(() => validateAnswer(modes, { kind: 'yesNo', yes: true })).toThrow(/badChoice/);
  });
});

describe('abilities on the stack (0.1)', () => {
  it('resolves an ability with the same effects as spells, leaving its source in place', () => {
    const shaman = creature('Shaman', 1, 1);
    let s = board([{ card: shaman, controller: 0 }, { card: creature('Elf', 1, 1), controller: 1 }]);
    const spec = parseAbilityText('It deals 1 damage to any target.');
    s = addAbility(s, s.battlefield[0], 0, spec, [[{ kind: 'permanent', iid: 'p1' }]]);
    expect(perm(s, 'Shaman')).toBeDefined();
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(s.stack).toHaveLength(0);
    expect(s.players[0].graveyard).toHaveLength(0);
    expect(s.log.some((l) => l.k === 'damage' && l.card === 'Shaman')).toBe(true);
  });
});
