import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { actor, apply, castOptions, IllegalAction, newGame, powerOf, toughnessOf, type GameState, type Permanent, type PlayerId } from './engine';
import { castInfo, castSpec, parseAbilityText, spellSpec, triggersOf } from './rules';

// Cards from Standard decks on mtgtop8 (Oct 2026), with their Oracle text.
let n = 0;
function card(partial: Partial<Card> & { name: string }): Card {
  return {
    id: `id-${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
    setCode: 't', setName: 'T', rarity: 'common', keywords: [], ...partial,
  };
}
const swamp = card({ name: 'Swamp', typeLine: 'Basic Land — Swamp' });
const island = card({ name: 'Island', typeLine: 'Basic Land — Island' });
const spell = (name: string, manaCost: string, oracleText: string, typeLine = 'Instant') =>
  card({ name, typeLine, manaCost, cmc: (manaCost.match(/\{/g) ?? []).length, oracleText });
const creature = (name: string, p: number, t: number, extra: Partial<Card> = {}) =>
  card({ name, power: String(p), toughness: String(t), manaCost: '{1}', cmc: 1, ...extra });

const terminalCriticism = spell('Terminal Criticism', '{1}{B}', 'Destroy target creature or planeswalker that\'s blue or red. You gain 1 life.');
const bitterTriumph = spell('Bitter Triumph', '{1}{B}', 'As an additional cost to cast this spell, discard a card or pay 3 life.\nDestroy target creature or planeswalker.');
const requitingHex = spell('Requiting Hex', '{B}', 'As an additional cost to cast this spell, you may blight 1. (You may put a -1/-1 counter on a creature you control.)\nDestroy target creature with mana value 2 or less. If this spell\'s additional cost was paid, you gain 2 life.');
const oculus = card({
  name: 'Abhorrent Oculus', manaCost: '{2}{U}', cmc: 3, typeLine: 'Creature — Eye', power: '5', toughness: '5', keywords: ['Flying'],
  oracleText: 'As an additional cost to cast this spell, exile six cards from your graveyard.\nFlying\nAt the beginning of each opponent\'s upkeep, manifest dread.',
});
const moonshadow = card({
  name: 'Moonshadow', manaCost: '{B}', cmc: 1, typeLine: 'Creature — Elemental', power: '7', toughness: '7', keywords: ['Menace'],
  oracleText: 'Menace\nThis creature enters with six -1/-1 counters on it.\nWhenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.',
});

/** Player 0's main phase 1 with `mana` untapped Swamps, given permanents, hand and graveyard. */
function board(opts: { mana?: number; mine?: Card[]; theirs?: Card[]; hand?: Card[]; grave?: Card[]; oppHand?: Card[]; oppMana?: number }): GameState {
  const s = newGame({ decks: [Array(20).fill(swamp), Array(20).fill(island)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5, mulligans: false });
  s.players[0].hand = (opts.hand ?? []).map((c, i) => ({ iid: `h${i}`, card: c }));
  s.players[0].graveyard = (opts.grave ?? []).map((c, i) => ({ iid: `g${i}`, card: c }));
  s.players[1].hand = (opts.oppHand ?? []).map((c, i) => ({ iid: `o${i}`, card: c }));
  const perms: { card: Card; controller: PlayerId }[] = [
    ...Array.from({ length: opts.mana ?? 0 }, () => ({ card: swamp, controller: 0 as PlayerId })),
    ...Array.from({ length: opts.oppMana ?? 0 }, () => ({ card: island, controller: 1 as PlayerId })),
    ...(opts.mine ?? []).map((c) => ({ card: c, controller: 0 as PlayerId })),
    ...(opts.theirs ?? []).map((c) => ({ card: c, controller: 1 as PlayerId })),
  ];
  s.battlefield = perms.map((x, i): Permanent => ({
    iid: `p${i}`, card: x.card, controller: x.controller, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [],
  }));
  return s;
}
const perm = (s: GameState, name: string) => s.battlefield.find((p) => p.card.name === name);
const iidOf = (s: GameState, name: string) => perm(s, name)!.iid;
/** Lets the opponent pass until it's player 0's turn to act again. */
const settle = (s: GameState) => {
  for (let i = 0; i < 20 && !s.pending && actor(s) === 1; i++) s = apply(s, { type: 'pass' });
  return s;
};
const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof IllegalAction) return e.code;
    throw e;
  }
  return null;
};

describe('partly understood texts are not simulated', () => {
  it('leaves out abilities with a sentence it does not understand', () => {
    // Daydream used to exile your creature for good: the return wasn't understood.
    expect(parseAbilityText('Exile target creature you control, then return that card to the battlefield under its owner\'s control with a +1/+1 counter on it.').effects).toEqual([]);
    // Jeskai Revelation: the bounce of a spell isn't simulated, so nothing is.
    expect(parseAbilityText('Return target spell or permanent to its owner\'s hand. Jeskai Revelation deals 4 damage to any target. You gain 4 life.').effects).toEqual([]);
    // An emblem isn't a one-time effect.
    expect(parseAbilityText('You get an emblem with "Whenever you cast a spell, this emblem deals 5 damage to any target."').effects).toEqual([]);
    // Spree modes have their own costs: not all modes for the base cost.
    const threeSteps = spell('Three Steps Ahead', '{U}', 'Spree\n+ {1}{U} — Counter target spell.\n+ {3} — Create a token that\'s a copy of target artifact or creature you control.\n+ {2} — Draw two cards, then discard a card.');
    expect(spellSpec(threeSteps).effects).toEqual([]);
  });

  it('never reads a quoted ability as an effect', () => {
    const moseo = card({ name: 'Moseo, Vein\'s New Dean', oracleText: 'When Moseo enters, create a 1/1 black and green Pest creature token with "Whenever this token attacks, you gain 1 life."' });
    expect(triggersOf(moseo)[0].ability.effects).toEqual([]);
  });

  it('keeps sentences that change nothing simulated, and options never taken', () => {
    expect(parseAbilityText('Destroy all creatures. They can\'t be regenerated.').effects).toHaveLength(1);
    const torch = spell('Torch the Tower', '{R}', 'Bargain\nTorch the Tower deals 2 damage to target creature or planeswalker. If this spell was bargained, instead it deals 3 damage to that permanent and you scry 1.\nIf a permanent dealt damage by Torch the Tower would die this turn, exile it instead.');
    expect(spellSpec(torch).effects).toEqual([{ kind: 'damage', amount: 2, to: { slot: 0 } }]);
    const floodMaw = spell('Into the Flood Maw', '{U}', 'Gift a tapped Fish\nReturn target creature an opponent controls to its owner\'s hand. If the gift was promised, instead return target nonland permanent an opponent controls to its owner\'s hand.');
    expect(spellSpec(floodMaw)).toMatchObject({ targets: [{ kind: 'creature', filter: { controller: 'opponent' } }], effects: [{ kind: 'bounce' }] });
    // "It gains …" and "Untap it." after a target.
    expect(parseAbilityText('Target creature you control gets +1/+1 and gains hexproof until end of turn. Untap it.').effects.map((e) => e.kind)).toEqual(['pump', 'tap']);
  });
});

describe('cards of Standard decks', () => {
  it('Terminal Criticism only targets blue or red creatures, and gains 1 life', () => {
    const blue = creature('Looter', 1, 1, { colors: ['U'] });
    const black = creature('Bat', 1, 1, { colors: ['B'] });
    let s = board({ mana: 2, hand: [terminalCriticism], theirs: [blue, black] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Bat') } }))).not.toBeNull();
    s = settle(apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Looter') } }));
    expect(perm(s, 'Looter')).toBeUndefined();
    expect(s.players[0].life).toBe(21);
  });

  it('Spell Snare counters only mana value 2', () => {
    expect(spellSpec(spell('Spell Snare', '{U}', 'Counter target spell with mana value 2.')).targets[0].filter).toEqual({ minManaValue: 2, maxManaValue: 2 });
  });

  it('Moonshadow enters with six -1/-1 counters', () => {
    let s = board({ mana: 1, hand: [moonshadow] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    const m = perm(s, 'Moonshadow')!;
    expect(m.counters).toEqual({ '-1/-1': 6 });
    expect([powerOf(m), toughnessOf(m)]).toEqual([1, 1]);
  });

  it('Abhorrent Oculus exiles six cards from the graveyard, or can\'t be cast', () => {
    let s = board({ mana: 2, mine: [island], hand: [oculus], grave: Array(5).fill(swamp) });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0' }))).toBe('notEnoughInGraveyard');
    s = board({ mana: 2, mine: [island], hand: [oculus], grave: Array(7).fill(swamp) });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ purpose: 'exileCost', min: 6, max: 6 });
    s = settle(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] } }));
    expect(perm(s, 'Abhorrent Oculus')).toBeDefined();
    expect(s.players[0].graveyard.map((c) => c.iid)).toEqual(['g6']);
    expect(s.players[0].exile).toHaveLength(6);
  });

  it('refuses a permanent whose additional cost is not understood', () => {
    const odd = card({ ...oculus, name: 'Odd', oracleText: 'As an additional cost to cast this spell, behold a Dragon.' });
    expect(errorOf(() => apply(board({ mana: 3, hand: [odd] }), { type: 'cast', iid: 'h0' }))).toBe('costNotSimulated');
  });

  it('Bitter Triumph: discard a card or pay 3 life, the caster\'s choice', () => {
    expect(castInfo(bitterTriumph).additional).toEqual({ kind: 'either', options: [{ kind: 'discard', n: 1 }, { kind: 'life', n: 3 }] });
    const ogre = creature('Ogre', 3, 3);
    let s = board({ mana: 2, hand: [bitterTriumph, swamp], theirs: [ogre] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Ogre') } });
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'costChoice', params: { yes: 'discard:1', no: 'life:3' } });
    s = settle(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(s.players[0].life).toBe(17);
    expect(s.players[0].hand).toHaveLength(1);
    expect(perm(s, 'Ogre')).toBeUndefined();
    // Nothing to discard: the life is paid without asking.
    let t = board({ mana: 2, hand: [bitterTriumph], theirs: [ogre] });
    t = settle(apply(t, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(t, 'Ogre') } }));
    expect(t.players[0].life).toBe(17);
    expect(perm(t, 'Ogre')).toBeUndefined();
  });

  it('Requiting Hex destroys without its optional cost or bonus', () => {
    expect(castSpec(requitingHex, {})).toMatchObject({ targets: [{ filter: { maxManaValue: 2 } }], effects: [{ kind: 'destroy' }] });
  });

  it('Countersculpt pays {1} more rather than beholding', () => {
    const sculpt = spell('Countersculpt', '{U}{U}', 'As an additional cost to cast this spell, behold a Jace or pay {1}. (To behold a Jace, choose a Jace you control or reveal a Jace card from your hand.)\nCounter target spell. Empower Jace 1.');
    expect(castInfo(sculpt).additional).toEqual({ kind: 'mana', cost: '{1}' });
  });

  it('triggers "whenever you gain life"', () => {
    const channeler = creature('Essence Channeler', 2, 1, { oracleText: 'Whenever you gain life, put a +1/+1 counter on this creature.' });
    const salve = spell('Salve', '{B}', 'You gain 3 life.');
    let s = board({ mana: 1, hand: [salve], mine: [channeler] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 5 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Essence Channeler')!.counters).toEqual({ '+1/+1': 1 });
  });

  it('can\'t counter a spell that can\'t be countered', () => {
    const defeat = spell('Unstoppable', '{B}', 'This spell can\'t be countered.\nYou gain 3 life.');
    expect(spellSpec(defeat).effects).toEqual([{ kind: 'gainLife', n: 3, to: 'you' }]);
    const negate = spell('Negate', '{1}{U}', 'Counter target noncreature spell.');
    let s = board({ mana: 1, hand: [defeat], oppHand: [negate], oppMana: 2 });
    s = apply(s, { type: 'cast', iid: 'h0' });
    s = apply(s, { type: 'cast', iid: 'o0', target: { kind: 'spell', iid: 'h0' } });
    for (let i = 0; i < 6 && s.stack.length; i++) s = apply(s, { type: 'pass' });
    expect(s.players[0].life).toBe(23);
  });
});

describe('W lifegain (mtgtop8 deck 895437)', () => {
  const voice = creature('Voice of Victory', 1, 3, { oracleText: 'Mobilize 2\nYour opponents can\'t cast spells during your turn.' });
  const conqueror = creature('Clarion Conqueror', 3, 3, { keywords: ['Flying'], oracleText: 'Flying\nActivated abilities of artifacts, creatures, and planeswalkers can\'t be activated.' });
  const rip = card({ name: 'Rest in Peace', typeLine: 'Enchantment', manaCost: '{2}', cmc: 2, oracleText: 'When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.' });
  const shock = spell('Shock', '{1}', 'Shock deals 2 damage to any target.');

  it('Voice of Victory: opponents can\'t cast spells during your turn', () => {
    const opt = spell('Opt', '{1}', 'Draw a card.');
    let s = board({ mana: 1, hand: [opt], mine: [voice], oppHand: [opt], oppMana: 1 });
    s.fullControl = [false, true]; // the opponent gets priority even with nothing to cast
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.priority?.player).toBe(1);
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'o0' }))).toBe('castingForbidden');
    expect(castOptions(s, 1, 'o0')).toEqual([]);
    // On the opponent's own turn, they can.
    const t = board({ oppHand: [opt], oppMana: 1, mine: [voice] });
    t.active = 1;
    expect(castOptions(t, 1, 'o0')).not.toEqual([]);
  });

  it('Clarion Conqueror: no activated abilities of artifacts, creatures or planeswalkers, mana included', () => {
    const elf = creature('Elf', 1, 1, { oracleText: '{T}: Add {G}.' });
    const pinger = creature('Pinger', 1, 1, { oracleText: '{T}: Pinger deals 1 damage to any target.' });
    const s = board({ mana: 1, mine: [conqueror, elf, pinger] });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Pinger'), index: 0, targets: [[{ kind: 'player', player: 1 }]] }))).toBe('activationForbidden');
    expect(errorOf(() => apply(s, { type: 'tapForMana', iid: iidOf(s, 'Elf') }))).not.toBeNull();
    // Lands still tap for mana.
    expect(errorOf(() => apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid }))).toBeNull();
  });

  it('Rest in Peace exiles graveyards, then everything that would go there', () => {
    const bear = creature('Bear', 2, 2, { oracleText: 'When this creature dies, you gain 3 life.' });
    let s = board({ mana: 3, hand: [rip, shock], grave: [swamp, swamp], theirs: [bear] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 4 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.players[0].graveyard).toEqual([]);
    expect(s.players[0].exile).toHaveLength(2);
    s = settle(apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: iidOf(s, 'Bear') } }));
    for (let i = 0; i < 4 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Bear')).toBeUndefined();
    // Exiled, so it didn't die; Shock was exiled too.
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Bear']);
    expect(s.players[1].life).toBe(20);
    expect(s.players[0].exile.map((c) => c.card.name)).toContain('Shock');
  });

  it('Abandoned Air Temple enters tapped unless you control a basic land', () => {
    const temple = card({ name: 'Abandoned Air Temple', typeLine: 'Land', oracleText: 'This land enters tapped unless you control a basic land.\n{T}: Add {W}.' });
    let s = board({ hand: [temple] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(perm(s, 'Abandoned Air Temple')!.tapped).toBe(true);
    let t = board({ mana: 1, hand: [temple] });
    t = apply(t, { type: 'playLand', iid: 'h0' });
    expect(perm(t, 'Abandoned Air Temple')!.tapped).toBe(false);
  });
});
