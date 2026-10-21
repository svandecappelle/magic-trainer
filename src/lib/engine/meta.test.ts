import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import type { Card } from '../../types';
import { activationProblem, actor, cycleMaxX, canPayAbility, apply, findPermanent, hasKw, paymentFor, canBlock, canCastNow, castCost, castSource, canTapForMana, type Answer, castOptions, canPay, canActivateDiamond, IllegalAction, isLegalTarget, newGame, powerOf, toughnessOf, unitsOf, type GameState, type Permanent, type PlayerId } from './engine';
import { botAction } from './bot';
import { activatedOf, castInfo, cloneOf, entersTappedRule, gameRulesOf, castSpec, finalChapter, hasKeyword, isCreature, PREDEFINED_TOKENS, tokenCard, type TargetSpec, manaUnits, restrictedMana, extraManaOf, manaMultiplier, filterMana, paidAnyColor, parseAbilityText, spellSpec, triggersOf } from './rules';

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
    // Jeskai Revelation: a spell or a permanent goes back; the damage and the life too.
    expect(parseAbilityText('Return target spell or permanent to its owner\'s hand. Jeskai Revelation deals 4 damage to any target. You gain 4 life.').effects.map((e) => e.kind)).toEqual(['bounce', 'damage', 'gainLife']);
    // A sentence it doesn't understand: nothing is simulated.
    expect(parseAbilityText('Return target creature to its owner\'s hand. Its controller reveals their hand.').effects).toEqual([]);
    // An emblem with an ability the engine can't do isn't created.
    expect(parseAbilityText('You get an emblem with "Creatures you control get +1/+1 and have trample as long as you control a Dragon."').effects).toEqual([]);
    // Spree modes have their own costs: no mode chosen, nothing (the modes are chosen when casting).
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

describe('W lifegain, second pass', () => {
  /** Passes (both players) until the turn ends, resolving end step triggers on the way. */
  const endTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };
  const gainSpell = (n: number) => spell(`Salve ${n}`, '{1}', `You gain ${n} life.`);
  const cast = (s: GameState, iid: string) => {
    s = settle(apply(s, { type: 'cast', iid }));
    for (let i = 0; i < 6 && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Haliya draws at the end step only after gaining 3 or more life this turn', () => {
    const haliya = card({
      name: 'Haliya, Guided by Light', typeLine: 'Legendary Creature — Human Soldier', power: '3', toughness: '3', manaCost: '{2}{W}', cmc: 3,
      oracleText: 'Whenever Haliya or another creature or artifact you control enters, you gain 1 life.\nAt the beginning of your end step, draw a card if you\'ve gained 3 or more life this turn.\nWarp {W}',
    });
    let s = board({ mana: 1, mine: [haliya], hand: [gainSpell(2)] });
    s = cast(s, 'h0');
    s = endTurn(s);
    expect(s.players[0].hand).toHaveLength(0);
    let t = board({ mana: 1, mine: [haliya], hand: [gainSpell(3)] });
    t = cast(t, 'h0');
    t = endTurn(t);
    expect(t.players[0].hand).toHaveLength(1);
  });

  it('Lunar Convocation drains only if you gained life this turn', () => {
    const convocation = card({
      name: 'Lunar Convocation', typeLine: 'Enchantment', manaCost: '{W}{B}', cmc: 2,
      oracleText: 'At the beginning of your end step, if you gained life this turn, each opponent loses 1 life.\nAt the beginning of your end step, if you gained and lost life this turn, create a 1/1 black Bat creature token with flying.\n{1}{B}, Pay 2 life: Draw a card.',
    });
    let s = endTurn(board({ mine: [convocation] }));
    expect(s.players[1].life).toBe(20);
    s = board({ mana: 1, mine: [convocation], hand: [gainSpell(1)] });
    s = endTurn(cast(s, 'h0'));
    expect(s.players[1].life).toBe(19);
    expect(perm(s, 'Bat')).toBeUndefined(); // gained, but didn't lose life
  });

  it('Ajani Resolute gets a loyalty counter whenever you gain life', () => {
    const ajani = card({
      name: 'Ajani Resolute', typeLine: 'Legendary Planeswalker — Ajani', manaCost: '{1}{W}', cmc: 2, loyalty: '3',
      oracleText: 'Whenever you gain life, put a loyalty counter on Ajani.\n0: You gain 1 life.\n−4: Create a 2/2 white Cat Soldier creature token named Ajani\'s Pridemate with "Whenever you gain life, put a +1/+1 counter on this token."\n−10: You get an emblem with "Creatures you control get +2/+2."',
    });
    let s = board({ mana: 1, mine: [ajani], hand: [gainSpell(2)] });
    perm(s, 'Ajani Resolute')!.counters = { loyalty: 3 };
    s = cast(s, 'h0');
    expect(perm(s, 'Ajani Resolute')!.counters.loyalty).toBe(4);
  });

  it('Seam Rip exiles until it leaves the battlefield', () => {
    const seamRip = card({
      name: 'Seam Rip', typeLine: 'Enchantment', manaCost: '{1}', cmc: 1,
      oracleText: 'When this enchantment enters, exile target nonland permanent an opponent controls with mana value 2 or less until this enchantment leaves the battlefield.',
    });
    const bear = creature('Bear', 2, 2, { manaCost: '{1}{G}', cmc: 2 });
    const disenchant = spell('Disenchant', '{1}', 'Destroy target artifact or enchantment.');
    let s = board({ mana: 2, hand: [seamRip, disenchant], theirs: [bear] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    for (let i = 0; i < 6 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.pending?.choice.kind).toBe('targets');
    s = settle(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } }));
    for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Bear']);
    // Destroying Seam Rip brings the Bear back.
    s = settle(apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: iidOf(s, 'Seam Rip') } }));
    for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Seam Rip')).toBeUndefined();
    expect(perm(s, 'Bear')?.controller).toBe(1);
    expect(s.players[1].exile).toEqual([]);
  });

  it('Enduring Innocence draws once each turn when small creatures enter', () => {
    const innocence = card({
      name: 'Enduring Innocence', typeLine: 'Enchantment Creature — Sheep Glimmer', power: '2', toughness: '1', manaCost: '{1}{W}{W}', cmc: 3, keywords: ['Lifelink'],
      oracleText: 'Lifelink\nWhenever one or more other creatures you control with power 2 or less enter, draw a card. This ability triggers only once each turn.\nWhen Enduring Innocence dies, if it was a creature, return it to the battlefield under its owner\'s control. It\'s an enchantment. (It\'s not a creature.)',
    });
    const cub = creature('Cub', 1, 1);
    let s = board({ mana: 2, mine: [innocence], hand: [cub, { ...cub, id: 'cub2' }] });
    s = cast(s, 'h0');
    s = cast(s, 'h1');
    expect(s.players[0].hand).toHaveLength(1); // one draw, not two
  });
});

describe('Germinate Recruits', () => {
  const recruits = spell('Germinate Recruits', '{1}', 'Create X 2/2 colorless Wizard Soldier creature tokens named Cadet, where X is the amount of life you gained this turn.');

  it('reads a named token and X as the life gained this turn', () => {
    expect(spellSpec(recruits).effects).toMatchObject([
      { kind: 'token', n: 'lifeGained', token: { name: 'Cadet', typeLine: 'Token Creature — Wizard Soldier', power: 2, toughness: 2, colors: [] } },
    ]);
  });

  it('creates one Cadet per life gained this turn', () => {
    const resolve = (s: GameState) => {
      for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
      return s;
    };
    let s = resolve(settle(apply(board({ mana: 1, hand: [recruits] }), { type: 'cast', iid: 'h0' })));
    expect(s.battlefield.filter((p) => p.card.name === 'Cadet')).toHaveLength(0);
    let t = board({ mana: 2, hand: [spell('Salve', '{1}', 'You gain 3 life.'), recruits] });
    t = resolve(settle(apply(t, { type: 'cast', iid: 'h0' })));
    t = resolve(settle(apply(t, { type: 'cast', iid: 'h1' })));
    expect(t.battlefield.filter((p) => p.card.name === 'Cadet')).toHaveLength(3);
  });
});

describe('Enlightened Confidant', () => {
  const confidant = creature('Enlightened Confidant', 2, 1, {
    keywords: ['Lifelink'],
    oracleText: 'Lifelink\nAt the beginning of your end step, if you gained life this turn, surveil 1. If you put a card with mana value less than or equal to the amount of life you gained this turn into your graveyard this way, put that card into your hand. (To surveil 1, look at the top card of your library. You may put that card into your graveyard.)',
  });
  /** Gains `life`, goes to the end step, puts the surveilled card into the graveyard. */
  const play = (life: number, top: Card) => {
    let s = board({ mana: 1, mine: [confidant], hand: [spell('Salve', '{1}', `You gain ${life} life.`)] });
    s.players[0].library[0] = { iid: 'top', card: top };
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    for (let i = 0; i < 30 && !s.pending && s.turn === 1; i++) {
      s = !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    }
    expect(s.pending?.choice).toMatchObject({ kind: 'arrange', purpose: 'surveil', params: { toHandMax: life } });
    // The card is in the hand or the graveyard as soon as the choice is made.
    return apply(s, { type: 'choose', answer: { kind: 'arrange', zones: { graveyard: ['top'] } } });
  };

  it('reads the whole trigger', () => {
    expect(triggersOf(confidant)[0].ability).toMatchObject({ condition: { gained: 1 }, effects: [{ kind: 'surveil', n: 1, toHand: 'mvAtMostLifeGained' }] });
  });

  it('puts the surveilled card into the hand when its mana value is at most the life gained', () => {
    const cheap = { ...spell('Cheap', '{1}{W}', 'Draw a card.'), cmc: 2 };
    const s = play(2, cheap);
    expect(s.players[0].hand.map((c) => c.iid)).toContain('top');
    expect(s.players[0].graveyard.map((c) => c.iid)).not.toContain('top');
    const costly = { ...spell('Costly', '{2}{W}', 'Draw a card.'), cmc: 3 };
    const t = play(2, costly);
    expect(t.players[0].graveyard.map((c) => c.iid)).toContain('top');
  });
});

describe('Mobilize (Voice of Victory)', () => {
  const voice = creature('Voice of Victory', 1, 3, {
    oracleText: 'Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens. Sacrifice them at the beginning of the next end step.)\nYour opponents can\'t cast spells during your turn.',
  });

  it('attacks with two Warrior tokens, sacrificed at the end step', () => {
    let s = board({ mine: [voice] });
    s = apply(s, { type: 'pass' }); // to combat
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    // The trigger resolves, then combat goes on (the opponent has nothing to block with).
    s = settle(apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Voice of Victory')] }));
    for (let i = 0; i < 20 && s.step !== 'main2' && s.winner === null; i++) {
      s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    const warriors = s.battlefield.filter((p) => p.card.name === 'Warrior');
    expect(warriors).toHaveLength(2);
    expect(warriors.every((w) => w.tapped)).toBe(true);
    // They attacked: 1 + 1 + 1 damage.
    expect(s.log.filter((e) => e.k === 'damagePlayer').map((e) => (e as { card: string }).card)).toEqual(['Voice of Victory', 'Warrior', 'Warrior']);
    expect(s.players[1].life).toBe(17);
    s = apply(s, { type: 'pass' }); // end of main 2: end step
    expect(s.battlefield.filter((p) => p.card.name === 'Warrior')).toHaveLength(0);
  });
});

describe('Command Tower and Arcane Signet (commander\'s color identity)', () => {
  const tower = card({ name: 'Command Tower', typeLine: 'Land', oracleText: '{T}: Add one mana of any color in your commander\'s color identity.' });
  const signet = card({ name: 'Arcane Signet', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: '{T}: Add one mana of any color in your commander\'s color identity.' });
  const boss = creature('Boss', 3, 3, { typeLine: 'Legendary Creature — Elf', colorIdentity: ['B', 'G'] });

  it('makes mana of the commander\'s colors, and none without a commander', () => {
    const s = newGame({ decks: [Array(40).fill(swamp), Array(40).fill(island)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5, mulligans: false, mode: { commander: true }, commanders: [[boss], []] });
    s.battlefield = [tower, signet, tower].map((c, i): Permanent => ({
      iid: `p${i}`, card: c, controller: (i === 2 ? 1 : 0) as PlayerId, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [],
    }));
    let t = apply(s, { type: 'tapForMana', iid: 'p0' });
    t = apply(t, { type: 'tapForMana', iid: 'p1' });
    expect(t.players[0].pool?.map((m) => m.colors)).toEqual([['B', 'G'], ['B', 'G']]);
    // The opponent has no commander: their Command Tower makes nothing.
    expect(canTapForMana(t, t.battlefield[2])).toBe(false);
    // Outside a Commander game, no mana either.
    const duel = board({ mine: [tower] });
    expect(canTapForMana(duel, perm(duel, 'Command Tower')!)).toBe(false);
  });
});

describe('Vexing Bauble', () => {
  const bauble = card({
    name: 'Vexing Bauble', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
    oracleText: 'Whenever a player casts a spell, if no mana was spent to cast it, counter that spell.\n{1}, {T}, Sacrifice this artifact: Draw a card.',
  });
  const ornithopter = creature('Ornithopter', 0, 2, { manaCost: '{0}', cmc: 0, typeLine: 'Artifact Creature — Thopter', keywords: ['Flying'] });

  it('counters a spell cast without mana, not one paid with mana', () => {
    expect(triggersOf(bauble)[0]).toMatchObject({ event: { on: 'castWithoutMana' }, ability: { effects: [{ kind: 'counter' }] } });
    // The opponent's Bauble counters my free spell.
    let s = board({ mana: 1, theirs: [bauble], hand: [ornithopter, creature('Bear', 2, 2)] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Ornithopter')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Ornithopter');
    // A spell paid with a Swamp resolves.
    s = settle(apply(s, { type: 'cast', iid: 'h1' }));
    for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Bear')).toBeDefined();
  });
});

describe('Mana that hurts: City of Brass, Mana Confluence', () => {
  const city = card({ name: 'City of Brass', typeLine: 'Land', oracleText: 'Whenever this land becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color.' });
  const confluence = card({ name: 'Mana Confluence', typeLine: 'Land', oracleText: '{T}, Pay 1 life: Add one mana of any color.' });
  const startingTown = card({
    name: 'Starting Town', typeLine: 'Land',
    oracleText: 'This land enters tapped unless it\'s your first, second, or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color.',
  });
  const bear = creature('Bear', 2, 2, { manaCost: '{G}' });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 6 && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('City of Brass deals 1 damage each time it becomes tapped', () => {
    expect(triggersOf(city)[0]).toMatchObject({ event: { on: 'becomesTapped' }, ability: { effects: [{ kind: 'damage', amount: 1, to: 'you' }] } });
    let s = board({ mine: [city], hand: [bear] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'Bear')).toBeDefined();
    expect(s.players[0].life).toBe(19);
    // Tapped by hand for mana: the damage can't be undone by untapping.
    s.battlefield.forEach((p) => { p.tapped = false; });
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'City of Brass') });
    expect(errorOf(() => apply(s, { type: 'untapForMana', iid: iidOf(s, 'City of Brass') }))).toBe('manaSpent');
  });

  it('Mana Confluence costs 1 life', () => {
    let s = board({ mine: [confluence], hand: [bear] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'Bear')).toBeDefined();
    expect(s.players[0].life).toBe(19);
    // At 0 life it can't be paid.
    const t = board({ mine: [confluence] });
    t.players[0].life = 0;
    expect(canTapForMana(t, perm(t, 'Mana Confluence')!)).toBe(false);
    // Swamps are tapped first; Mana Confluence only when needed.
    let u = board({ mana: 1, mine: [confluence], hand: [creature('Rat', 1, 1, { manaCost: '{B}' })] });
    u = resolve(settle(apply(u, { type: 'cast', iid: 'h0' })));
    expect(u.players[0].life).toBe(20);
  });

  it('Starting Town: {C} for free, a color for 1 life', () => {
    expect(manaUnits(startingTown)).toEqual([['C', 'W', 'U', 'B', 'R', 'G']]);
    // Spent as {G}: 1 life.
    let s = board({ mine: [startingTown], hand: [bear] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'Bear')).toBeDefined();
    expect(s.players[0].life).toBe(19);
    // Spent as generic mana: {C}, free.
    let t = board({ mine: [startingTown], hand: [creature('Golem', 1, 1)] });
    t = resolve(settle(apply(t, { type: 'cast', iid: 'h0' })));
    expect(perm(t, 'Golem')).toBeDefined();
    expect(t.players[0].life).toBe(20);
    // A Swamp pays {B} before Starting Town's life does; Starting Town's {C} pays the {1}.
    let u = board({ mana: 1, mine: [startingTown], hand: [creature('Rat', 2, 1, { manaCost: '{1}{B}' })] });
    u = resolve(settle(apply(u, { type: 'cast', iid: 'h0' })));
    expect(perm(u, 'Rat')).toBeDefined();
    expect(u.players[0].life).toBe(20);
    // Tapped first, its mana waits in the pool: the life is paid when it's spent as a color.
    let v = board({ mine: [startingTown], hand: [bear] });
    v = apply(v, { type: 'tapForMana', iid: iidOf(v, 'Starting Town') });
    expect(v.players[0].life).toBe(20);
    v = resolve(settle(apply(v, { type: 'cast', iid: 'h0' })));
    expect(v.players[0].life).toBe(19);
  });

  it('Starting Town enters untapped on its controller\'s first three turns only', () => {
    const play = (turns: number) => {
      const s = board({ hand: [startingTown] });
      s.players[0].turns = turns;
      return perm(apply(s, { type: 'playLand', iid: 'h0' }), 'Starting Town')!.tapped;
    };
    expect(play(1)).toBe(false);
    expect(play(3)).toBe(false);
    expect(play(4)).toBe(true);
    // A real game counts each player's turns.
    expect(board({}).players[0].turns).toBe(1);
  });
});

describe('Channel (Otawara, Boseiju, Eiganjo)', () => {
  const otawara = card({
    name: 'Otawara, Soaring City', typeLine: 'Legendary Land',
    oracleText: '{T}: Add {U}.\nChannel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner\'s hand. This ability costs {1} less to activate for each legendary creature you control.',
  });
  const boseiju = card({
    name: 'Boseiju, Who Endures', typeLine: 'Legendary Land',
    oracleText: '{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.',
  });
  const eiganjo = card({
    name: 'Eiganjo, Seat of the Empire', typeLine: 'Legendary Land',
    oracleText: '{T}: Add {W}.\nChannel — {2}{W}, Discard this card: It deals 4 damage to target attacking or blocking creature. This ability costs {1} less to activate for each legendary creature you control.',
  });
  const islandUp = (s: GameState, n: number) => {
    // n untapped Islands for player 0 (the board's mana is Swamps).
    for (let i = 0; i < n; i++) s.battlefield.push({ iid: `i${i}`, card: island, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] });
    return s;
  };

  it('reads the channel abilities', () => {
    expect(castInfo(otawara).channel).toMatchObject({ cost: '{3}{U}', legendaryDiscount: true, ability: { effects: [{ kind: 'bounce' }] } });
    expect(castInfo(eiganjo).channel).toMatchObject({ ability: { targets: [{ kind: 'creature', filter: { inCombat: true } }], effects: [{ kind: 'damage', amount: 4 }] } });
    expect(castInfo(boseiju).channel?.ability).toMatchObject({
      targets: [{ kind: 'permanent', filter: { controller: 'opponent' } }],
      effects: [{ kind: 'destroy', to: { slot: 0 } }, { kind: 'search', n: 1, dest: 'battlefield', tapped: false, searcher: { slot: 0 } }],
    });
  });

  it('Boseiju destroys a nonbasic land; its controller may search for a land with a basic land type', () => {
    const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
    const shock = card({ name: 'Watery Grave', typeLine: 'Land — Island Swamp', oracleText: '({T}: Add {U} or {B}.)' });
    const vault = card({ name: 'Urza\'s Vault', typeLine: 'Land' });
    let s = board({ mana: 1, mine: [forest], theirs: [vault], hand: [boseiju] });
    s.players[1].library = [{ iid: 'l0', card: vault }, { iid: 'l1', card: shock }, { iid: 'l2', card: island }];
    s = settle(apply(s, { type: 'channel', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Urza\'s Vault') }]] }));
    for (let i = 0; i < 6 && s.stack.length && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    // The opponent chooses: a land with a basic land type (not Urza's Vault).
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', player: 1, purpose: 'search', min: 0, max: 1 });
    const options = s.pending!.choice.kind === 'cards' ? s.pending!.choice.options.map((c) => c.card.name) : [];
    expect(options.sort()).toEqual(['Island', 'Watery Grave']);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } });
    expect(s.players[1].graveyard.map((c) => c.card.name)).toEqual(['Urza\'s Vault']);
    expect(perm(s, 'Watery Grave')).toMatchObject({ controller: 1 });
    expect(s.players[1].library).toHaveLength(2);
  });
  it('Otawara bounces from the hand, {1} cheaper for each legendary creature', () => {
    const legend = creature('Legend', 2, 2, { typeLine: 'Legendary Creature — Human' });
    const ogre = creature('Ogre', 3, 3);
    let s = islandUp(board({ mana: 2, mine: [legend], theirs: [ogre], hand: [otawara] }), 1);
    // {3}{U} - 1 = 3 mana: two Swamps and an Island.
    s = settle(apply(s, { type: 'channel', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] }));
    for (let i = 0; i < 6 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(s.players[1].hand.map((c) => c.card.name)).toContain('Ogre');
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Otawara, Soaring City']);
    // Without the legend, three mana isn't enough.
    const t = islandUp(board({ mana: 2, theirs: [ogre], hand: [otawara] }), 1);
    expect(errorOf(() => apply(t, { type: 'channel', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(t, 'Ogre') }]] }))).toBe('notEnoughMana');
  });

  it('the bot channels to remove a permanent, keeping a land to play', () => {
    const ogre = creature('Ogre', 3, 3, { manaCost: '{2}{G}', cmc: 3 });
    // Its land for the turn already played: Otawara bounces the Ogre.
    let s = islandUp(board({ mana: 3, theirs: [ogre], hand: [otawara] }), 1);
    s.players[0].landPlayed = true;
    expect(botAction(s)).toEqual({ type: 'channel', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] });
    // Otawara is its only land in hand and no land was played: it's played as a land instead.
    s = islandUp(board({ mana: 3, theirs: [ogre], hand: [otawara] }), 1);
    expect(botAction(s)).toMatchObject({ type: 'playLand', iid: 'h0' });
    // Nothing of the opponent's to bounce: kept.
    s = islandUp(board({ mana: 3, hand: [otawara] }), 1);
    s.players[0].landPlayed = true;
    expect(botAction(s)).toEqual({ type: 'pass' });
  });
});

describe('Path to Exile', () => {
  it('exiles the creature; its controller may search for a basic land, put onto the battlefield tapped', () => {
    const path = spell('Path to Exile', '{W}', 'Exile target creature. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    expect(spellSpec(path).effects).toMatchObject([{ kind: 'destroy', exile: true }, { kind: 'search', filter: { basic: true }, tapped: true, searcher: { slot: 0 } }]);
    const plains = card({ name: 'Plains', typeLine: 'Basic Land — Plains' });
    let s = board({ mine: [plains], theirs: [creature('Ogre', 3, 3)], hand: [path] });
    s = settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] }));
    for (let i = 0; i < 6 && s.stack.length && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.pending?.choice).toMatchObject({ player: 1, purpose: 'search' });
    // It may decline.
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } });
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Ogre']);
    expect(s.battlefield.filter((x) => x.controller === 1)).toHaveLength(0);
  });
});

describe('Sagas (Urza\'s Saga)', () => {
  const urzasSaga = card({
    name: 'Urza\'s Saga', typeLine: 'Enchantment Land — Urza\'s Saga',
    oracleText: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga gains "{T}: Add {C}."\nII — This Saga gains "{2}, {T}: Create a 0/0 colorless Construct artifact creature token with \'This token gets +1/+1 for each artifact you control.\'"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.',
  });
  const ornithopter = card({ name: 'Ornithopter', typeLine: 'Artifact Creature — Thopter', manaCost: '{0}', power: '0', toughness: '2', keywords: ['Flying'], oracleText: 'Flying' });
  const solRing = card({ name: 'Sol Ring', typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracleText: '{T}: Add {C}{C}.' });
  const wurmcoil = card({ name: 'Wurmcoil Engine', typeLine: 'Artifact Creature — Phyrexian Wurm', manaCost: '{6}', cmc: 6, power: '6', toughness: '6' });
  /** Passes (both players) until the next turn begins. */
  const endTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };
  /** Resolves what's waiting (chapter abilities), the opponent passing; stops at a choice. */
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('reads the chapters', () => {
    const chapters = triggersOf(urzasSaga).map((t) => [t.event, t.ability.effects.map((e) => e.kind)]);
    expect(chapters).toEqual([
      [{ on: 'chapter', n: 1 }, ['gainAbility']], [{ on: 'chapter', n: 2 }, ['gainAbility']], [{ on: 'chapter', n: 3 }, ['search']],
    ]);
    // No mana before chapter I.
    expect(manaUnits(urzasSaga)).toEqual([]);
  });

  it('gains its abilities chapter by chapter, finds a {0} or {1} artifact, and is sacrificed after III', () => {
    let s = board({ mana: 2, hand: [urzasSaga] });
    // Below the cards drawn meanwhile.
    s.players[0].library = [...s.players[0].library, { iid: 'l0', card: wurmcoil }, { iid: 'l1', card: ornithopter }, { iid: 'l2', card: solRing }];
    // I: a lore counter as it enters, then "{T}: Add {C}."
    s = resolve(apply(s, { type: 'playLand', iid: 'h0' }));
    expect(perm(s, 'Urza\'s Saga')!.counters.lore).toBe(1);
    expect(canTapForMana(s, perm(s, 'Urza\'s Saga')!)).toBe(true);

    // II, after the next draw step: the Construct ability.
    s = resolve(endTurn(endTurn(s)));
    const saga = perm(s, 'Urza\'s Saga')!;
    expect(saga.counters.lore).toBe(2);
    s = resolve(settle(apply(s, { type: 'activate', iid: saga.iid, index: 0 })));
    // A 0/0 Construct, +1/+1 for each artifact: itself.
    const construct = perm(s, 'Construct')!;
    expect([powerOf(construct), toughnessOf(construct)]).toEqual([1, 1]);

    // III: only the {0} and {1} artifacts can be found; then the Saga is sacrificed.
    s = endTurn(endTurn(s));
    s = resolve(s);
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'search', player: 0 });
    const options = s.pending!.choice.kind === 'cards' ? s.pending!.choice.options.map((c) => c.card.name).sort() : [];
    expect(options).toEqual(['Ornithopter', 'Sol Ring']);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l2'] } }));
    expect(perm(s, 'Sol Ring')).toBeDefined();
    expect(perm(s, 'Urza\'s Saga')).toBeUndefined();
    // The printed card goes to the graveyard, without the abilities it gained.
    expect(s.players[0].graveyard.find((c) => c.card.name === 'Urza\'s Saga')?.card.oracleText).toBe(urzasSaga.oracleText);
    // Two artifacts now: the Construct is 2/2.
    expect(powerOf(perm(s, 'Construct')!)).toBe(2);
  });

  it('a chapter the engine can\'t do is "not simulated", and the Saga still goes after its last chapter', () => {
    const misty = card({
      name: 'The Misty Mountains Cold', typeLine: 'Enchantment — Saga', manaCost: '{3}', cmc: 3,
      oracleText: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III, IV — Create a Treasure token. Then if you control four or more Treasures, create a 4/4 red Dragon creature token with flying.',
    });
    expect(finalChapter(misty)).toBe(4);
    let s = board({ mana: 3, hand: [misty] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'The Misty Mountains Cold')!.counters.lore).toBe(1);
    expect(s.log.some((e) => e.k === 'notSimulated')).toBe(true);
    perm(s, 'The Misty Mountains Cold')!.counters.lore = 3;
    s = resolve(endTurn(endTurn(s)));
    expect(perm(s, 'The Misty Mountains Cold')).toBeUndefined();
  });
});

describe('Boros Dwarves equipment (mtgtop8 deck 899948)', () => {
  const equipment = (name: string, manaCost: string, oracleText: string, typeLine = 'Artifact — Equipment') =>
    card({ name, typeLine, manaCost, cmc: (manaCost.match(/\{/g) ?? []).length, oracleText });
  const boots = equipment('Lavaspur Boots', '{1}', 'Equipped creature gets +1/+0 and has haste and ward {1}. (Whenever it becomes the target of a spell or ability an opponent controls, counter it unless that player pays {1}.)\nEquip {1}');
  const blade = equipment('Dragonfire Blade', '{1}', 'Equipped creature gets +2/+2 and has hexproof from monocolored.\nEquip {4}. This ability costs {1} less to activate for each color of the creature it targets.');
  const chainsaw = equipment('Chainsaw', '{1}{R}', 'When this Equipment enters, it deals 3 damage to up to one target creature.\nWhenever one or more creatures die, put a rev counter on this Equipment.\nEquipped creature gets +X/+0, where X is the number of rev counters on this Equipment.\nEquip {3}');
  const axe = equipment('Leyline Axe', '{4}', 'If this card is in your opening hand, you may begin the game with it on the battlefield.\nEquipped creature gets +1/+1 and has double strike and trample.\nEquip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)');
  const ironMan = equipment('Iron Man Armor', '{3}', 'When this Equipment enters, attach it to target creature you control.\nEquipped creature gets +2/+1 and has flying.\n{2}: If this Equipment isn\'t a creature, it becomes a 0/0 Construct Hero artifact creature with flying and "This creature gets +1/+1 for each artifact you control" until end of turn.\nEquip {2}');
  // Mana costs made generic: the board's lands are Swamps.
  const mauler = creature('Dwarven Mauler', 2, 1, { typeLine: 'Creature — Dwarf Warrior', manaCost: '{1}', colors: ['R'], oracleText: 'Equip abilities you activate that target this creature cost {2} less to activate.' });
  const dains = creature('Dáin\'s Company', 2, 2, {
    typeLine: 'Creature — Dwarf Warrior', manaCost: '{2}', colors: ['R', 'W'],
    oracleText: 'This creature has lifelink as long as you control another Dwarf.\nWhen this creature enters, look at the top four cards of your library. You may reveal a Dwarf or Equipment card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
  });
  const kili = creature('Kíli the Resourceful', 1, 2, {
    typeLine: 'Legendary Creature — Dwarf Scout', manaCost: '{1}{W}', colors: ['W'],
    oracleText: 'Storied (If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game.)\nAs long as you have an enduring story, you may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.\nWhenever another Dwarf or Equipment you control enters, draw a card. This ability triggers only once each turn.',
  });
  const kellan = creature('Kellan, the Fae-Blooded', 2, 2, {
    typeLine: 'Legendary Creature — Human Faerie', manaCost: '{2}{R}', colors: ['R'], keywords: ['Double strike'],
    oracleText: 'Double strike\nOther creatures you control get +1/+0 for each Aura and Equipment attached to Kellan.',
  });
  const cloud = creature('Cloud, Midgar Mercenary', 2, 1, {
    typeLine: 'Legendary Creature — Human Soldier Mercenary', manaCost: '{W}{W}', colors: ['W'],
    oracleText: 'When Cloud enters, search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\nAs long as Cloud is equipped, if a triggered ability of Cloud or an Equipment attached to it triggers, that ability triggers an additional time.',
  });
  const lonely = card({
    name: 'The Lonely Mountain', typeLine: 'Land — Mountain',
    oracleText: '({T}: Add {R}.)\nThis land enters tapped unless you control an Equipment.\n{4}{R}, {T}: Create a 2/2 red Dwarf creature token. This ability costs {1} less to activate for each Equipment you control. Activate only as a sorcery.',
  });
  const verge = card({ name: 'Sunbillow Verge', typeLine: 'Land', oracleText: '{T}: Add {W}.\n{T}: Add {R}. Activate only if you control a Mountain or a Plains.' });
  const shock = { ...spell('Shock', '{1}', 'Shock deals 2 damage to any target.'), colors: ['R'] };
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const attach = (s: GameState, eq: string, to: string) => { perm(s, eq)!.attachedTo = iidOf(s, to); return s; };
  const equipIndex = (c: Card) => activatedOf(c).findIndex((a) => a.equip);

  it('Lavaspur Boots: +1/+0, haste and ward {1}', () => {
    let s = board({ mana: 1, hand: [shock], theirs: [creature('Bear', 2, 2), boots] });
    s = attach(s, 'Lavaspur Boots', 'Bear');
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    expect(powerOf(perm(s, 'Bear')!)).toBe(3);
    expect(perm(s, 'Bear')!.statics?.keywords).toContain('haste');
    // Shock with no mana left for ward: countered.
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(perm(s, 'Bear')).toBeDefined();
    expect(s.log.some((e) => e.k === 'countered' && e.card === 'Shock')).toBe(true);
  });

  it('Dragonfire Blade: equip {1} less per color; hexproof from monocolored', () => {
    const golem = creature('Golem', 3, 3);
    // Dáin's Company is two colors: {4} - 2.
    let s = board({ mana: 2, mine: [dains, blade, golem] });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Dragonfire Blade'), index: equipIndex(blade), targets: [[{ kind: 'permanent', iid: iidOf(s, 'Golem') }]] }))).toBe('notEnoughMana');
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Dragonfire Blade'), index: equipIndex(blade), targets: [[{ kind: 'permanent', iid: iidOf(s, 'Dáin\'s Company') }]] });
    s = resolve(settle(s));
    expect(perm(s, 'Dragonfire Blade')!.attachedTo).toBe(iidOf(s, 'Dáin\'s Company'));
    expect(toughnessOf(perm(s, 'Dáin\'s Company')!)).toBe(4);
    // The opponent's red Shock can't target it; a two-color spell could.
    expect(isLegalTarget(s, 1, { kind: 'any', min: 1, max: 1, filter: {} }, { kind: 'permanent', iid: iidOf(s, 'Dáin\'s Company') }, undefined, { ...shock, colors: ['R'] })).toBe(false);
    expect(isLegalTarget(s, 1, { kind: 'any', min: 1, max: 1, filter: {} }, { kind: 'permanent', iid: iidOf(s, 'Dáin\'s Company') }, undefined, { ...shock, colors: ['R', 'W'] })).toBe(true);
  });

  it('Dwarven Mauler: equip abilities targeting it cost {2} less', () => {
    let s = board({ mana: 1, mine: [mauler, axe] });
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Leyline Axe'), index: equipIndex(axe), targets: [[{ kind: 'permanent', iid: iidOf(s, 'Dwarven Mauler') }]] })));
    expect(perm(s, 'Leyline Axe')!.attachedTo).toBe(iidOf(s, 'Dwarven Mauler'));
    expect(powerOf(perm(s, 'Dwarven Mauler')!)).toBe(3);
  });

  it('Kíli: an enduring story with three artifacts or legendaries, then the first equip each turn costs {0}', () => {
    let s = board({ mana: 1, mine: [kili, boots, chainsaw, creature('Golem', 3, 3)] });
    // Any action checks the story (state-based); the {B} made stays in the pool.
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    s = settle(apply(s, { type: 'activate', iid: iidOf(s, 'Lavaspur Boots'), index: equipIndex(boots), targets: [[{ kind: 'permanent', iid: iidOf(s, 'Golem') }]] }));
    expect(s.players[0].enduringStory).toBe(true);
    s = resolve(s);
    expect(perm(s, 'Lavaspur Boots')!.attachedTo).toBe(iidOf(s, 'Golem'));
    expect(s.players[0].pool).toHaveLength(1); // paid {0}
    // The second equip this turn costs its mana.
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Chainsaw'), index: equipIndex(chainsaw), targets: [[{ kind: 'permanent', iid: iidOf(s, 'Golem') }]] }))).toBe('notEnoughMana');
  });

  it('Kíli draws once each turn when another Dwarf or Equipment enters', () => {
    const t = triggersOf(kili).find((x) => x.event.on === 'enters')!;
    expect(t).toMatchObject({ oncePerTurn: true, event: { self: false, another: true, which: { filter: { subtypes: ['dwarf', 'equipment'], controller: 'you' } } } });
    let s = board({ mana: 2, mine: [kili], hand: [boots, mauler] });
    const hand = s.players[0].hand.length;
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h1' })));
    expect(s.players[0].hand.length).toBe(hand - 2 + 1);
  });

  it('Dáin\'s Company has lifelink only with another Dwarf', () => {
    let s = board({ mana: 1, mine: [dains] });
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    expect(perm(s, 'Dáin\'s Company')!.statics?.keywords ?? []).not.toContain('lifelink');
    s = board({ mana: 1, mine: [dains], hand: [mauler] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'Dáin\'s Company')!.statics?.keywords).toContain('lifelink');
    expect(perm(s, 'Dwarven Mauler')!.statics?.keywords ?? []).not.toContain('lifelink');
  });

  it('Kellan: other creatures get +1/+0 for each Aura and Equipment attached to it', () => {
    let s = board({ mana: 1, mine: [kellan, boots, chainsaw, creature('Golem', 3, 3)] });
    attach(s, 'Lavaspur Boots', 'Kellan, the Fae-Blooded');
    attach(s, 'Chainsaw', 'Kellan, the Fae-Blooded');
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    expect(powerOf(perm(s, 'Golem')!)).toBe(5);
    expect(powerOf(perm(s, 'Kellan, the Fae-Blooded')!)).toBe(3); // Boots' +1/+0 only
  });

  it('Chainsaw: one rev counter when creatures die together, +1/+0 each', () => {
    const wipe = spell('Wipe', '{1}', 'Destroy all creatures.', 'Sorcery');
    let s = board({ mana: 1, mine: [chainsaw, creature('Golem', 3, 3)], theirs: [creature('Bear', 2, 2), creature('Ogre', 3, 3)], hand: [wipe] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'Chainsaw')!.counters.rev).toBe(1);
  });

  it('Cloud finds an Equipment; equipped, its Equipment\'s triggers happen twice', () => {
    expect(triggersOf(cloud)[0].ability.effects).toMatchObject([{ kind: 'search', filter: { subtypes: ['equipment'] }, dest: 'hand' }]);
    let s = board({ mine: [cloud, chainsaw], theirs: [creature('Bear', 2, 2)], hand: [shock] });
    attach(s, 'Chainsaw', 'Cloud, Midgar Mercenary');
    s.battlefield.push({ ...s.battlefield[0], iid: 'm0', card: card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' }) });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(perm(s, 'Chainsaw')!.counters.rev).toBe(2);
  });

  it('Iron Man Armor attaches itself as it enters', () => {
    let s = board({ mana: 3, mine: [creature('Golem', 3, 3)], hand: [ironMan] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    s = resolve(s);
    if (s.pending) s = resolve(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Golem') }]] } }));
    expect(perm(s, 'Iron Man Armor')!.attachedTo).toBe(iidOf(s, 'Golem'));
    expect(powerOf(perm(s, 'Golem')!)).toBe(5);
  });

  it('The Lonely Mountain: enters tapped without an Equipment; Dwarves {1} cheaper per Equipment', () => {
    const play = (mine: Card[]) => perm(apply(board({ mine, hand: [lonely] }), { type: 'playLand', iid: 'h0' }), 'The Lonely Mountain')!.tapped;
    expect(play([])).toBe(true);
    expect(play([boots])).toBe(false);
    // {4}{R} - 2 Equipment = {2}{R}, paid by two Swamps and a Mountain (The Lonely Mountain taps as the cost).
    let s = board({ mana: 2, mine: [lonely, boots, chainsaw, card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' })] });
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'The Lonely Mountain'), index: 0 })));
    expect(perm(s, 'Dwarf')).toMatchObject({ controller: 0 });
  });

  it('Sunbillow Verge makes {R} only with a Mountain or a Plains', () => {
    const s = board({ mine: [verge] });
    expect(unitsOf(s, perm(s, 'Sunbillow Verge')!)).toEqual([['W']]);
    const t = board({ mine: [verge, card({ name: 'Plains', typeLine: 'Basic Land — Plains' })] });
    expect(unitsOf(t, perm(t, 'Sunbillow Verge')!)).toEqual([['W', 'R']]);
  });

  it('Leyline Axe in the opening hand begins the game on the battlefield', () => {
    const g = newGame({ decks: [[axe, ...Array(39).fill(swamp)], Array(40).fill(island)], names: ['Me', 'Bot'], first: 0, rng: () => 0.99 });
    let s = g;
    s.players[0].hand = [{ iid: 'axe', card: axe }, ...s.players[0].hand.slice(1)];
    for (let i = 0; i < 4 && s.mulligan; i++) s = apply(s, { type: 'keep', bottom: [] });
    expect(perm(s, 'Leyline Axe')).toMatchObject({ controller: 0 });
    expect(s.log.some((e) => e.k === 'beginsOnBattlefield')).toBe(true);
  });
});

describe('Boros Dwarves, second pass: Thorin, Dáin\'s Company, Iron Man Armor, Mjölnir, Cavern of Souls, Chandra', () => {
  const equipment = (name: string, manaCost: string, oracleText: string, typeLine = 'Artifact — Equipment') =>
    card({ name, typeLine, manaCost, cmc: (manaCost.match(/\{/g) ?? []).length, oracleText });
  const boots = equipment('Lavaspur Boots', '{1}', 'Equipped creature gets +1/+0 and has haste and ward {1}.\nEquip {1}');
  const collar = equipment('Basilisk Collar', '{1}', 'Equipped creature has deathtouch and lifelink.\nEquip {2}');
  const thorin = creature('Thorin, Mountain-king', 3, 4, {
    typeLine: 'Legendary Creature — Dwarf Noble', manaCost: '{4}', cmc: 4, keywords: ['Trample'], colors: ['R'],
    oracleText: 'Trample\nWhen Thorin enters, attach any number of target Equipment you control to target creature you control. When one or more Equipment become attached to that creature this way, that creature deals damage equal to its power to up to one target creature.',
  });
  const dains = creature('Dáin\'s Company', 2, 2, {
    typeLine: 'Creature — Dwarf Warrior', manaCost: '{2}', colors: ['R', 'W'],
    oracleText: 'This creature has lifelink as long as you control another Dwarf.\nWhen this creature enters, look at the top four cards of your library. You may reveal a Dwarf or Equipment card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
  });
  const ironMan = equipment('Iron Man Armor', '{3}', 'When this Equipment enters, attach it to target creature you control.\nEquipped creature gets +2/+1 and has flying.\n{2}: If this Equipment isn\'t a creature, it becomes a 0/0 Construct Hero artifact creature with flying and "This creature gets +1/+1 for each artifact you control" until end of turn.\nEquip {2}');
  const mjolnir = card({
    name: 'Mjölnir, Hammer of Thor', typeLine: 'Legendary Artifact — Equipment', manaCost: '{4}', cmc: 4, colors: ['R'],
    oracleText: 'When Mjölnir enters, it deals 4 damage to up to one target creature.\nDouble all damage equipped creature would deal.\nEquip worthy {1} (A creature is worthy if it\'s a legendary non-Villain that\'s red and/or white.)\n{2}, Discard this card: It deals 2 damage to each creature.',
  });
  const cavern = card({
    name: 'Cavern of Souls', typeLine: 'Land',
    oracleText: 'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
  });
  const chandra = card({
    name: 'Chandra, Spark Hunter', typeLine: 'Legendary Planeswalker — Chandra', manaCost: '{4}', cmc: 4, colors: ['R'], loyalty: '4',
    oracleText: 'At the beginning of combat on your turn, choose up to one target Vehicle you control. Until end of turn, it becomes an artifact creature and gains haste.\n+2: You may sacrifice an artifact or discard a card. If you do, draw a card.\n0: Create a 3/2 colorless Vehicle artifact token with crew 1.\n−7: You get an emblem with "Whenever an artifact you control enters, this emblem deals 3 damage to any target."',
  });
  const dwarf = creature('Dwarf', 2, 1, { typeLine: 'Creature — Dwarf Warrior', manaCost: '{R}', colors: ['R'] });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const answer = (s: GameState, a: Parameters<typeof apply>[1] extends infer A ? (A extends { type: 'choose'; answer: infer B } ? B : never) : never) =>
    resolve(apply(s, { type: 'choose', answer: a }));
  const iids = (s: GameState, ...names: string[]) => names.map((n) => ({ kind: 'permanent' as const, iid: iidOf(s, n) }));

  it('Dáin\'s Company looks at the top four: a Dwarf or Equipment into the hand, the rest on the bottom', () => {
    let s = board({ mana: 2, hand: [dains] });
    s.players[0].library = [{ iid: 'l0', card: swamp }, { iid: 'l1', card: boots }, { iid: 'l2', card: dwarf }, { iid: 'l3', card: swamp }, { iid: 'l4', card: island }];
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'dig', min: 0, max: 1 });
    const options = s.pending!.choice.kind === 'cards' ? s.pending!.choice.options.map((c) => c.card.name) : [];
    expect(options).toEqual(['Lavaspur Boots', 'Dwarf']);
    s = answer(s, { kind: 'cards', iids: ['l1'] });
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Lavaspur Boots']);
    // The Island stays on top; the other three are below it.
    expect(s.players[0].library.map((c) => c.iid)[0]).toBe('l4');
    expect(s.players[0].library.map((c) => c.iid).slice(1).sort()).toEqual(['l0', 'l2', 'l3']);
  });

  it('Thorin attaches Equipment to a creature, which then deals damage equal to its power', () => {
    let s = board({ mana: 4, mine: [dwarf, boots, collar], theirs: [creature('Ogre', 3, 3)], hand: [thorin] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    s = resolve(s);
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', purpose: 'triggerTargets' });
    s = answer(s, { kind: 'targets', targets: [iids(s, 'Lavaspur Boots', 'Basilisk Collar'), iids(s, 'Dwarf')] });
    expect(perm(s, 'Lavaspur Boots')!.attachedTo).toBe(iidOf(s, 'Dwarf'));
    expect(perm(s, 'Basilisk Collar')!.attachedTo).toBe(iidOf(s, 'Dwarf'));
    // The reflexive trigger: up to one target creature.
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', purpose: 'triggerTargets' });
    s = answer(s, { kind: 'targets', targets: [iids(s, 'Ogre')] });
    // 3 damage (2 + the Boots) with deathtouch: the Ogre dies; lifelink gains 3.
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(s.players[0].life).toBe(23);
  });

  it('Iron Man Armor becomes a creature until end of turn (and falls off what it equipped)', () => {
    let s = board({ mana: 2, mine: [ironMan, creature('Golem', 3, 3), boots] });
    perm(s, 'Iron Man Armor')!.attachedTo = iidOf(s, 'Golem');
    const index = activatedOf(ironMan).findIndex((a) => a.ability.effects.some((e) => e.kind === 'animate'));
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Iron Man Armor'), index })));
    const armor = perm(s, 'Iron Man Armor')!;
    expect(armor.attachedTo).toBeUndefined();
    // 0/0, +1/+1 for each artifact: itself and the Boots.
    expect([powerOf(armor), toughnessOf(armor)]).toEqual([2, 2]);
    expect(powerOf(perm(s, 'Golem')!)).toBe(3);
    // The next turn, it's an Equipment again.
    s = settle(apply(s, { type: 'pass' }));
    for (let i = 0; i < 30 && s.active === 0; i++) s = s.step === 'attack' && !s.priority ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    expect(perm(s, 'Iron Man Armor')!.card.typeLine).toBe('Artifact — Equipment');
  });

  it('Mjölnir: only worthy creatures; it doubles their damage; discarded, it deals 2 to each creature', () => {
    const villain = creature('Villain', 2, 2, { typeLine: 'Legendary Creature — Human Villain', colors: ['R'] });
    const blue = creature('Blue Legend', 2, 2, { typeLine: 'Legendary Creature — Human', colors: ['U'] });
    const thor = creature('Thor', 3, 3, { typeLine: 'Legendary Creature — God Hero', colors: ['R', 'W'] });
    let s = board({ mana: 1, mine: [mjolnir, villain, blue, thor] });
    const equip = activatedOf(mjolnir).findIndex((a) => a.equip);
    for (const name of ['Villain', 'Blue Legend']) {
      expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Mjölnir, Hammer of Thor'), index: equip, targets: [iids(s, name)] }))).toBe('illegalTarget');
    }
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Mjölnir, Hammer of Thor'), index: equip, targets: [iids(s, 'Thor')] })));
    expect(perm(s, 'Mjölnir, Hammer of Thor')!.attachedTo).toBe(iidOf(s, 'Thor'));
    expect(perm(s, 'Thor')!.statics?.doubleDamage).toBe(true);
    // Discarded from the hand.
    expect(castInfo(mjolnir).channel).toMatchObject({ cost: '{2}', keyword: false, ability: { effects: [{ kind: 'damageAll', amount: 2 }] } });
    let t = board({ mana: 2, mine: [creature('Bear', 2, 2)], theirs: [creature('Ogre', 3, 3)], hand: [mjolnir] });
    t = resolve(settle(apply(t, { type: 'channel', iid: 'h0' })));
    expect(perm(t, 'Bear')).toBeUndefined();
    expect(perm(t, 'Ogre')!.damage).toBe(2);
  });

  it('Mjölnir doubles combat damage', () => {
    const thor = creature('Thor', 3, 3, { typeLine: 'Legendary Creature — God Hero', colors: ['R'] });
    let s = board({ mine: [thor, mjolnir] });
    perm(s, 'Mjölnir, Hammer of Thor')!.attachedTo = iidOf(s, 'Thor');
    s = settle(apply(s, { type: 'pass' }));
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Thor')] });
    for (let i = 0; i < 10 && s.attackers.length; i++) s = s.step === 'block' && !s.priority ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    expect(s.players[1].life).toBe(14);
  });

  it('Cavern of Souls: a chosen type; its colored mana only for that type, which can\'t be countered', () => {
    const counter = spell('Cancel', '{1}', 'Counter target spell.');
    const elf = creature('Elf', 1, 1, { typeLine: 'Creature — Elf', manaCost: '{G}', colors: ['G'] });
    let s = board({ hand: [cavern, dwarf, elf], oppMana: 2, oppHand: [counter] });
    s.players[0].library = [{ iid: 'l0', card: dwarf }, ...s.players[0].library];
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ kind: 'mode', purpose: 'creatureType' });
    const modes = s.pending!.choice.kind === 'mode' ? s.pending!.choice.modes : [];
    expect(modes[0]).toBe('Dwarf');
    s = apply(s, { type: 'choose', answer: { kind: 'mode', modes: [modes.indexOf('Dwarf')] } });
    expect(perm(s, 'Cavern of Souls')!.chosenType).toBe('Dwarf');
    // {G} for the Elf: no.
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h2' }))).toBe('notEnoughMana');
    // {R} for the Dwarf: yes, and the opponent's Cancel can't counter it.
    s = apply(s, { type: 'cast', iid: 'h1' });
    expect(s.stack.at(-1)).toMatchObject({ card: { name: 'Dwarf' }, uncounterable: true });
    s = settle(apply(s, { type: 'pass' }));
    if (s.priority?.player === 1) s = apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: s.stack.find((x) => x.card.name === 'Dwarf')!.iid }]] });
    s = resolve(s);
    expect(perm(s, 'Dwarf')).toBeDefined();
  });

  it('Chandra: a Vehicle token with crew 1; at the beginning of combat it becomes a creature with haste', () => {
    let s = board({ mine: [chandra, dwarf] });
    perm(s, 'Chandra, Spark Hunter')!.counters.loyalty = 4;
    const zero = activatedOf(chandra).findIndex((a) => a.cost.loyalty === 0);
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Chandra, Spark Hunter'), index: zero })));
    const vehicle = perm(s, 'Vehicle')!;
    expect(vehicle.card).toMatchObject({ typeLine: 'Token Artifact — Vehicle', power: '3', toughness: '2', oracleText: 'Crew 1' });
    // Crew 1 with the Dwarf: a 3/2 artifact creature.
    s = apply(s, { type: 'activate', iid: vehicle.iid, index: 0 });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'crewCost' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Dwarf')] } }));
    expect(perm(s, 'Dwarf')!.tapped).toBe(true);
    expect(perm(s, 'Vehicle')!.card.typeLine).toContain('Creature');
    // Combat: Chandra's trigger gives it haste, so the new Vehicle can attack.
    s = settle(apply(s, { type: 'pass' }));
    if (s.pending?.choice.kind === 'targets') s = answer(s, { kind: 'targets', targets: [iids(s, 'Vehicle')] });
    s = resolve(s);
    expect(s.step).toBe('attack');
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Vehicle')] });
    for (let i = 0; i < 10 && s.attackers.length; i++) s = s.step === 'block' && !s.priority ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    expect(s.players[1].life).toBe(17);
  });

  it('Chandra\'s +2 trades a card for a card; her emblem deals 3 damage when an artifact enters', () => {
    let s = board({ mine: [chandra], hand: [swamp] });
    perm(s, 'Chandra, Spark Hunter')!.counters.loyalty = 4;
    s.players[0].library = [{ iid: 'l0', card: island }, ...s.players[0].library];
    const plus = activatedOf(chandra).findIndex((a) => a.cost.loyalty === 2);
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Chandra, Spark Hunter'), index: plus })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'tradeForCard', min: 0, max: 1 });
    s = answer(s, { kind: 'cards', iids: ['h0'] });
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Island']);
    // Declined: no card drawn.
    let t = board({ mine: [chandra], hand: [swamp] });
    perm(t, 'Chandra, Spark Hunter')!.counters.loyalty = 4;
    t = resolve(settle(apply(t, { type: 'activate', iid: iidOf(t, 'Chandra, Spark Hunter'), index: plus })));
    t = answer(t, { kind: 'cards', iids: [] });
    expect(t.players[0].hand.map((c) => c.card.name)).toEqual(['Swamp']);

    // The emblem.
    let u = board({ mana: 1, mine: [chandra], hand: [boots] });
    perm(u, 'Chandra, Spark Hunter')!.counters.loyalty = 7;
    const minus = activatedOf(chandra).findIndex((a) => a.cost.loyalty === -7);
    u = resolve(settle(apply(u, { type: 'activate', iid: iidOf(u, 'Chandra, Spark Hunter'), index: minus })));
    expect(u.players[0].emblems).toHaveLength(1);
    u = resolve(settle(apply(u, { type: 'cast', iid: 'h0' })));
    if (u.pending?.choice.kind === 'targets') u = answer(u, { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] });
    expect(u.players[1].life).toBe(17);
  });
});

describe('manlands', () => {
  const land = (name: string, oracleText: string) => card({ name, typeLine: 'Land', oracleText });
  const fortress = land('Restless Fortress', 'This land enters tapped.\n{T}: Add {W} or {B}.\n{2}{W}{B}: This land becomes a 1/4 white and black Nightmare creature until end of turn. It\'s still a land.\nWhenever this land attacks, defending player loses 2 life and you gain 2 life.');
  const mutavault = land('Mutavault', '{T}: Add {C}.\n{1}: This land becomes a 2/2 creature with all creature types until end of turn. It\'s still a land.');
  const plains = card({ name: 'Plains', typeLine: 'Basic Land — Plains', oracleText: '({T}: Add {W}.)' });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('reads the "becomes a creature" abilities, with their colors and types', () => {
    expect(activatedOf(fortress)[0]?.ability.effects).toEqual([
      { kind: 'animate', to: 'self', power: 1, toughness: 4, subtypes: ['Nightmare'], keywords: [], colors: ['W', 'B'] },
    ]);
    expect(activatedOf(mutavault)[0]?.ability.effects).toMatchObject([{ kind: 'animate', power: 2, toughness: 2, subtypes: [], allTypes: true, colors: [] }]);
    // Raging Ravine's quoted trigger is understood; Hall of Storm Giants' ward {3} isn't, so it isn't simulated.
    expect(parseAbilityText('Until end of turn, this land becomes a 3/3 red and green Elemental creature with "Whenever this creature attacks, put a +1/+1 counter on it." It\'s still a land.').effects)
      .toMatchObject([{ kind: 'animate', text: 'Whenever this creature attacks, put a +1/+1 counter on it.' }]);
    expect(parseAbilityText('Until end of turn, this land becomes a 7/7 blue Giant creature with ward {3}. It\'s still a land.').effects).toEqual([]);
  });

  it('Restless Fortress attacks and drains 2, then is only a land again', () => {
    let s = board({ mine: [fortress, plains, plains, swamp, swamp] });
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Restless Fortress'), index: 0 })));
    const f = perm(s, 'Restless Fortress')!;
    // Paid with the other lands, not by tapping itself.
    expect(f.tapped).toBe(false);
    expect([f.card.typeLine, f.card.colors, powerOf(f), toughnessOf(f)]).toEqual(['Land Creature — Nightmare', ['W', 'B'], 1, 4]);
    s = settle(apply(s, { type: 'pass' }));
    s = resolve(apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Restless Fortress')] }));
    for (let i = 0; i < 10 && s.attackers.length; i++) s = s.step === 'block' && !s.priority ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    expect([s.players[0].life, s.players[1].life]).toEqual([22, 17]);
    for (let i = 0; i < 30 && s.active === 0; i++) s = apply(s, { type: 'pass' });
    expect(perm(s, 'Restless Fortress')!.card.typeLine).toBe('Land');
  });

  it('the bot animates a manland and attacks with it, unless a blocker would kill it', () => {
    let s = board({ mine: [fortress, plains, plains, swamp, swamp] });
    expect(botAction(s)).toEqual({ type: 'activate', iid: iidOf(s, 'Restless Fortress'), index: 0 });
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = settle(apply(s, botAction(s)));
    expect(s.log).toContainEqual({ k: 'attack', p: 0, cards: ['Restless Fortress'] });
    expect(s.players[1].life).toBe(17);
    const t = board({ mine: [fortress, plains, plains, swamp, swamp], theirs: [creature('Ogre', 4, 4)] });
    expect(botAction(t)).toEqual({ type: 'pass' });
  });

  it('Mutavault has all creature types: a Dwarf for Dáin\'s Company', () => {
    const dains = creature('Dáin\'s Company', 2, 2, { typeLine: 'Creature — Dwarf Warrior', oracleText: 'This creature has lifelink as long as you control another Dwarf.' });
    let s = board({ mana: 1, mine: [mutavault, dains] });
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    expect(perm(s, 'Dáin\'s Company')!.statics?.keywords ?? []).not.toContain('lifelink');
    s = resolve(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Mutavault'), index: 0 })));
    expect(perm(s, 'Dáin\'s Company')!.statics?.keywords).toContain('lifelink');
  });
});

describe('modal triggers', () => {
  const flanker = creature('Kutzil\'s Flanker', 3, 1, {
    typeLine: 'Creature — Cat Warrior', manaCost: '{2}{W}', cmc: 3, keywords: ['Flash'],
    oracleText: 'Flash\nWhen this creature enters, choose one —\n• Put a +1/+1 counter on this creature for each creature that left the battlefield under your control this turn.\n• You gain 2 life and scry 2.\n• Exile target player\'s graveyard.',
  });
  const gaius = creature('Gaius van Baelsar', 3, 2, {
    typeLine: 'Legendary Creature — Human Soldier', manaCost: '{2}{B}{B}', cmc: 4,
    oracleText: 'When Gaius van Baelsar enters, choose one —\n• Each player sacrifices a creature token of their choice.\n• Each player sacrifices a nontoken creature of their choice.\n• Each player sacrifices an enchantment of their choice.',
  });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const choose = (s: GameState, answer: Parameters<typeof apply>[1] & { type: 'choose' } extends { answer: infer A } ? A : never) => resolve(apply(s, { type: 'choose', answer }));

  it('reads the modes; the one it does not understand can\'t be chosen', () => {
    const [t] = triggersOf(flanker);
    expect(t.ability.modal).toMatchObject({ min: 1, max: 1 });
    expect(t.ability.modal!.specs.map((sp) => sp.effects.map((e) => e.kind))).toEqual([[], ['gainLife', 'scry'], ['exileGraveyards']]);
    let s = board({ mana: 2, mine: [card({ name: 'Plains', typeLine: 'Basic Land — Plains' })], hand: [flanker] });
    s.players[1].graveyard = [{ iid: 'og', card: island }];
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'mode', purpose: 'triggerMode', disabled: [0] });
    expect(errorOf(() => apply(s, { type: 'choose', answer: { kind: 'mode', modes: [0] } }))).toBe('badChoice');
    s = choose(s, { kind: 'mode', modes: [2] });
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', purpose: 'triggerTargets' });
    s = choose(s, { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] });
    expect([s.players[1].graveyard.length, s.players[1].exile.length]).toEqual([0, 1]);
  });

  it('Gaius: each player sacrifices a nontoken creature', () => {
    const goblin = card({ id: 'token:goblin', name: 'Goblin', typeLine: 'Token Creature — Goblin', power: '1', toughness: '1' });
    let s = board({ mana: 4, hand: [gaius], theirs: [goblin, creature('Ogre', 4, 4)] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    s = choose(s, { kind: 'mode', modes: [1] });
    for (let i = 0; i < 5 && s.pending; i++) s = choose(s, botAnswerFor(s));
    expect(s.battlefield.map((p) => p.card.name).filter((n) => n !== 'Swamp')).toEqual(['Goblin']);
  });

  it('the bot picks a mode that does something', () => {
    let s = board({ mana: 4, hand: [gaius], theirs: [creature('Ogre', 4, 4)] });
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0' })));
    // No creature token, no enchantment: only the nontoken edict hits the opponent.
    expect(botAction(s)).toEqual({ type: 'choose', answer: { kind: 'mode', modes: [1] } });
  });
});

function botAnswerFor(s: GameState) {
  const a = botAction(s);
  if (a.type !== 'choose') throw new Error(`expected a choice, got ${a.type}`);
  return a.answer;
}

describe('reflexive triggers ("When you do")', () => {
  const inti = creature('Inti, Seneschal of the Sun', 2, 2, {
    typeLine: 'Legendary Creature — Human Knight', manaCost: '{1}{R}', cmc: 2,
    oracleText: 'Whenever you attack, you may discard a card. When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn.\nWhenever you discard one or more cards, exile the top card of your library. You may play that card until your next end step.',
  });
  const sentry = creature('Icewrought Sentry', 2, 3, {
    typeLine: 'Creature — Elemental Soldier', manaCost: '{2}{U}', cmc: 3, keywords: ['Vigilance'],
    oracleText: 'Vigilance\nWhenever this creature attacks, you may pay {1}{U}. When you do, tap target creature an opponent controls.\nWhenever you tap an untapped creature an opponent controls, you gain 2 life.',
  });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const choose = (s: GameState, answer: Parameters<typeof apply>[1] & { type: 'choose' } extends { answer: infer A } ? A : never) => resolve(apply(s, { type: 'choose', answer }));
  const attack = (s: GameState, ...names: string[]) => resolve(apply(settle(apply(s, { type: 'pass' })), { type: 'declareAttackers', attackers: names.map((n) => iidOf(s, n)) }));

  it('Inti: discard a card, then a +1/+1 counter and trample on the target chosen then', () => {
    expect(triggersOf(inti)[0]).toMatchObject({ event: { on: 'youAttack' }, ability: { effects: [{ kind: 'reflexive', cost: { discard: 1 } }] } });
    let s = attack(board({ mine: [inti, creature('Bear', 2, 2)], hand: [swamp] }), 'Bear');
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'reflexiveCost', min: 0, max: 1 });
    s = choose(s, { kind: 'cards', iids: ['h0'] });
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Swamp']);
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', purpose: 'triggerTargets' });
    s = choose(s, { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] });
    const bear = perm(s, 'Bear')!;
    expect([bear.counters['+1/+1'], powerOf(bear)]).toEqual([1, 3]);
    expect(bear.boosts.flatMap((b) => b.keywords)).toContain('trample');
    // Nothing discarded: no counter.
    let t = attack(board({ mine: [inti, creature('Bear', 2, 2)], hand: [swamp] }), 'Bear');
    t = choose(t, { kind: 'cards', iids: [] });
    expect([t.pending, t.players[0].hand.length, perm(t, 'Bear')!.counters['+1/+1']]).toEqual([null, 1, undefined]);
  });

  it('Icewrought Sentry: pay {1}{U} to tap a creature; asked only when it can be paid', () => {
    let s = board({ mine: [sentry], theirs: [creature('Ogre', 4, 4)] });
    s.battlefield.push({ ...s.battlefield[0], iid: 'isl', card: island, controller: 0 }, { ...s.battlefield[0], iid: 'isl2', card: island, controller: 0 });
    s = attack(s, 'Icewrought Sentry');
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'reflexivePay', params: { cost: '{1}{U}' } });
    s = choose(s, { kind: 'yesNo', yes: true });
    s = choose(s, { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] });
    expect([perm(s, 'Ogre')!.tapped, s.battlefield.filter((p) => p.card.name === 'Island' && p.tapped).length]).toEqual([true, 2]);
    // No mana: no question.
    const t = attack(board({ mine: [sentry], theirs: [creature('Ogre', 4, 4)] }), 'Icewrought Sentry');
    expect(t.pending).toBeNull();
  });

  it('the bot discards a spare land for Inti', () => {
    let s = attack(board({ mine: [inti, creature('Bear', 2, 2)], hand: [swamp, swamp, moonshadow] }), 'Bear');
    expect(botAction(s)).toEqual({ type: 'choose', answer: { kind: 'cards', iids: ['h0'] } });
    s = choose(s, { kind: 'cards', iids: ['h0'] });
    expect(botAction(s)).toEqual({ type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } });
  });
});

describe('Mana rocks: Grim Monolith, Mana Vault, Mox Diamond', () => {
  const grim = card({ name: 'Grim Monolith', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: 'This artifact doesn\'t untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact.' });
  const vault = card({
    name: 'Mana Vault', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
    oracleText: 'This artifact doesn\'t untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\nAt the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}.',
  });
  const moxDiamond = card({
    name: 'Mox Diamond', typeLine: 'Artifact', manaCost: '{0}',
    oracleText: 'If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don\'t, put it into its owner\'s graveyard.\n{T}: Add one mana of any color.',
  });
  /** Passes (both players, no attacks) until player 0's next turn reaches its first main phase; `answer` answers player 0's choices. */
  const nextTurn = (s: GameState, answer: (s: GameState) => Answer) => {
    const turn = s.turn;
    for (let i = 0; i < 80 && s.winner === null && !(s.turn === turn + 2 && s.step === 'main1' && !s.stack.length && !s.triggered?.length && !s.pending); i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.player === 0 ? answer(s) : { kind: 'yesNo', yes: false } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };

  it('Grim Monolith stays tapped and untaps for {4}', () => {
    let s = board({ mana: 4, mine: [grim] });
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Grim Monolith') });
    s = nextTurn(s, () => ({ kind: 'yesNo', yes: false }));
    expect(perm(s, 'Grim Monolith')!.tapped).toBe(true);
    expect(s.battlefield.filter((p) => p.card.name === 'Swamp' && p.tapped)).toHaveLength(0);
    const index = activatedOf(grim).findIndex((a) => a.ability.effects.some((e) => e.kind === 'tap'));
    s = settle(apply(s, { type: 'activate', iid: iidOf(s, 'Grim Monolith'), index }));
    for (let i = 0; i < 4 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Grim Monolith')!.tapped).toBe(false);
    expect(s.battlefield.filter((p) => p.card.name === 'Swamp' && p.tapped)).toHaveLength(4);
  });

  it('Mana Vault: pay {4} in the upkeep to untap it, otherwise 1 damage in the draw step', () => {
    let s = board({ mana: 4, mine: [vault] });
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Mana Vault') });
    const asked: string[] = [];
    s = nextTurn(s, (t) => {
      asked.push(`${t.pending!.choice.purpose}:${t.pending!.choice.params?.cost}`);
      return { kind: 'yesNo', yes: false };
    });
    expect(asked).toEqual(['mayPay:{4}']);
    expect(perm(s, 'Mana Vault')!.tapped).toBe(true);
    expect(s.players[0].life).toBe(19);
    // This time it pays: untapped, no damage, the four Swamps tapped.
    s = nextTurn(s, () => ({ kind: 'yesNo', yes: true }));
    expect(perm(s, 'Mana Vault')!.tapped).toBe(false);
    expect(s.players[0].life).toBe(19);
    expect(s.battlefield.filter((p) => p.card.name === 'Swamp' && p.tapped)).toHaveLength(4);
    // Untapped: the upkeep trigger still asks (declined), no damage.
    s = nextTurn(s, () => ({ kind: 'yesNo', yes: false }));
    expect(s.players[0].life).toBe(19);
  });

  it('Mana Vault: not asked to pay without {4}', () => {
    let s = board({ mana: 2, mine: [vault] });
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Mana Vault') });
    s = nextTurn(s, () => { throw new Error('nothing to ask'); });
    expect(s.players[0].life).toBe(19);
  });

  it('Mox Diamond enters only by discarding a land card', () => {
    let s = board({ hand: [moxDiamond, swamp, spell('Shock', '{R}', 'Shock deals 2 damage to any target.')] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'discardLandInstead', min: 0, max: 1 });
    expect(s.pending?.choice.kind === 'cards' && s.pending.choice.options.map((c) => c.iid)).toEqual(['h1']);
    expect(botAction(s)).toEqual({ type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    expect(perm(s, 'Mox Diamond')).toBeDefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Swamp']);

    // Declined, or no land card: it goes to the graveyard.
    s = board({ hand: [moxDiamond, swamp] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } });
    expect(perm(s, 'Mox Diamond')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Mox Diamond']);
    s = board({ hand: [moxDiamond] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.pending).toBeNull();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Mox Diamond']);
  });
});

describe('Moxen and Gemstone Caverns', () => {
  const chromeMox = card({
    name: 'Chrome Mox', typeLine: 'Artifact', manaCost: '{0}',
    oracleText: 'Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card\'s colors.',
  });
  const moxAmber = card({ name: 'Mox Amber', typeLine: 'Legendary Artifact', manaCost: '{0}', oracleText: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.' });
  const moxOpal = card({ name: 'Mox Opal', typeLine: 'Legendary Artifact', manaCost: '{0}', keywords: ['Metalcraft'], oracleText: 'Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.' });
  const caverns = card({
    name: 'Gemstone Caverns', typeLine: 'Legendary Land',
    oracleText: 'If this card is in your opening hand and you\'re not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.\n{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color.',
  });
  const bolt = card({ name: 'Lightning Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, colors: ['R'], oracleText: 'Lightning Bolt deals 3 damage to any target.' });
  const ornithopter = card({ name: 'Ornithopter', typeLine: 'Artifact Creature — Thopter', manaCost: '{0}', power: '0', toughness: '2', oracleText: 'Flying' });

  it('Chrome Mox makes the colors of the card it exiled', () => {
    let s = board({ hand: [chromeMox, bolt, swamp, ornithopter] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 4 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    // Only the nonartifact, nonland card can be exiled; no yes/no before.
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'exileFromHand', min: 0, max: 1 });
    expect(s.pending?.choice.kind === 'cards' && s.pending.choice.options.map((c) => c.card.name)).toEqual(['Lightning Bolt']);
    expect(botAction(s)).toEqual({ type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Lightning Bolt']);
    expect(unitsOf(s, perm(s, 'Chrome Mox')!)).toEqual([['R']]);
    // Nothing exiled: no mana.
    s = board({ mine: [chromeMox] });
    expect(canTapForMana(s, perm(s, 'Chrome Mox')!)).toBe(false);
  });

  it('Mox Amber makes the colors of legendary creatures and planeswalkers', () => {
    const legend = creature('Ragavan', 2, 1, { typeLine: 'Legendary Creature — Monkey Pirate', colors: ['R'] });
    const walker = card({ name: 'Teferi', typeLine: 'Legendary Planeswalker — Teferi', colors: ['W', 'U'], loyalty: '4' });
    let s = board({ mine: [moxAmber] });
    expect(canTapForMana(s, perm(s, 'Mox Amber')!)).toBe(false);
    s = board({ mine: [moxAmber, legend, walker, creature('Bear', 2, 2, { colors: ['G'] })], theirs: [creature('Their Legend', 1, 1, { typeLine: 'Legendary Creature — Elf', colors: ['B'] })] });
    expect(unitsOf(s, perm(s, 'Mox Amber')!)).toEqual([['R', 'W', 'U']]);
  });

  it('Mox Opal makes mana only with three or more artifacts', () => {
    let s = board({ mine: [moxOpal, ornithopter] });
    expect(canTapForMana(s, perm(s, 'Mox Opal')!)).toBe(false);
    s = board({ mine: [moxOpal, ornithopter, chromeMox] });
    expect(unitsOf(s, perm(s, 'Mox Opal')!)).toEqual([['W', 'U', 'B', 'R', 'G']]);
  });

  it('Gemstone Caverns begins on the battlefield for the player going second', () => {
    const deck = (land: Card) => [...Array(10).fill(caverns), ...Array(10).fill(land)];
    let s = newGame({ decks: [deck(swamp), deck(island)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5 });
    s = apply(s, { type: 'keep', bottom: [] });
    s = apply(s, { type: 'keep', bottom: [] });
    // Only the player not starting is asked.
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', player: 1, purpose: 'gemstoneCaverns', min: 0, max: 1 });
    const hand = s.players[1].hand.length;
    const exiled = s.pending!.choice.kind === 'cards' ? s.pending!.choice.options[0].iid : '';
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [exiled] } });
    expect(s.players[1].hand).toHaveLength(hand - 2);
    expect(s.players[1].exile.map((c) => c.iid)).toEqual([exiled]);
    const mine = s.battlefield.filter((p) => p.card.name === 'Gemstone Caverns');
    expect(mine.map((p) => [p.controller, p.counters.luck])).toEqual([[1, 1]]);
    expect(unitsOf(s, mine[0])).toEqual([['W', 'U', 'B', 'R', 'G']]);
    expect(s.turn).toBe(1);
    // Without a luck counter: {C}.
    s = board({ mine: [caverns] });
    expect(unitsOf(s, perm(s, 'Gemstone Caverns')!)).toEqual([['C']]);
  });
});

describe('Hexing Squelcher, Teferi, Time Raveler, Pithing Needle', () => {
  const squelcher = creature('Hexing Squelcher', 2, 2, {
    typeLine: 'Creature — Goblin Sorcerer', manaCost: '{1}{R}', cmc: 2, colors: ['R'], keywords: ['Ward'],
    oracleText: 'This spell can\'t be countered.\nWard—Pay 2 life.\nSpells you control can\'t be countered.\nOther creatures you control have "Ward—Pay 2 life."',
  });
  const teferi = card({
    name: 'Teferi, Time Raveler', typeLine: 'Legendary Planeswalker — Teferi', manaCost: '{1}{W}{U}', cmc: 3, colors: ['W', 'U'], loyalty: '4',
    oracleText: 'Each opponent can cast spells only any time they could cast a sorcery.\n+1: Until your next turn, you may cast sorcery spells as though they had flash.\n−3: Return up to one target artifact, creature, or enchantment to its owner\'s hand. Draw a card.',
  });
  const needle = card({
    name: 'Pithing Needle', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
    oracleText: 'As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can\'t be activated unless they\'re mana abilities.',
  });
  const murder = spell('Murder', '{B}', 'Destroy target creature.');
  const counter = spell('Counterspell', '{U}', 'Counter target spell.');
  const pinger = creature('Pinger', 1, 1, { oracleText: '{T}: Pinger deals 1 damage to any target.' });
  const elves = creature('Llanowar Elves', 1, 1, { typeLine: 'Creature — Elf Druid', oracleText: '{T}: Add {G}.' });
  /** Passes (the opponent answers with settle) until player 0 has a choice or the stack is empty. */
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Hexing Squelcher gives its other creatures "Ward—Pay 2 life"', () => {
    // Granted abilities are computed after each action: tap a Swamp first.
    let s = board({ mana: 2, hand: [murder], theirs: [squelcher, creature('Bear', 2, 2)] });
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', player: 0, purpose: 'payLifeOrCounter', params: { n: 2 } });
    // Not paid: Murder is countered.
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(perm(s, 'Bear')).toBeDefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Murder']);
    // Paid: 2 life, the Bear is destroyed.
    s = board({ mana: 2, hand: [murder], theirs: [squelcher, creature('Bear', 2, 2)] });
    s = apply(s, { type: 'tapForMana', iid: s.battlefield[0].iid });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(s.players[0].life).toBe(18);
    expect(perm(s, 'Bear')).toBeUndefined();
  });

  it('Hexing Squelcher: spells you control can\'t be countered', () => {
    let s = board({ mana: 2, hand: [creature('Bear', 2, 2)], mine: [squelcher], oppHand: [counter], oppMana: 1 });
    s = apply(s, { type: 'cast', iid: 'h0' });
    // The opponent counters the Bear: it still resolves.
    if (actor(s) === 1 && s.priority) s = apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: s.stack[0].iid }]] });
    s = run(settle(s));
    expect(s.players[1].graveyard.map((c) => c.card.name)).toEqual(['Counterspell']);
    expect(perm(s, 'Bear')).toBeDefined();
  });

  it('Teferi, Time Raveler: opponents cast only at sorcery speed; +1 gives sorceries flash', () => {
    const bolt = spell('Bolt', '{B}', 'Bolt deals 3 damage to any target.');
    const ritual = spell('Sorcery Bolt', '{B}', 'Sorcery Bolt deals 3 damage to any target.', 'Sorcery');
    let s = board({ mana: 1, hand: [bolt], theirs: [teferi] });
    s.priority = { player: 0, passes: 0, reason: 'main' };
    expect(canCastNow(s, 0, bolt)).toBe(false);
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] }))).toBe('sorceryOnly');
    // In its controller's own main phase, at sorcery speed, the spell can be cast.
    s.priority = null;
    expect(canCastNow(s, 0, bolt)).toBe(true);

    s = board({ mana: 1, hand: [ritual], mine: [teferi] });
    perm(s, 'Teferi, Time Raveler')!.counters.loyalty = 4;
    const plus = activatedOf(teferi).findIndex((a) => a.cost.loyalty === 1);
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Teferi, Time Raveler'), index: plus })));
    expect(s.players[0].sorceryFlash).toBe(true);
    s.priority = { player: 0, passes: 0, reason: 'main' };
    expect(canCastNow(s, 0, ritual)).toBe(true);
  });

  it('Pithing Needle names a card: its activated abilities stop, mana abilities don\'t', () => {
    let s = board({ mana: 1, hand: [needle], theirs: [pinger, elves] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'mode', purpose: 'cardName', modes: ['Pinger'] });
    s = apply(s, { type: 'choose', answer: { kind: 'mode', modes: [0] } });
    expect(perm(s, 'Pithing Needle')!.chosenName).toBe('Pinger');
    expect(activationProblem(s, 1, perm(s, 'Pinger')!, 0)).toBe('nameStopped');
    expect(canTapForMana(s, perm(s, 'Llanowar Elves')!)).toBe(true);
    // Nothing seen to name: it names nothing.
    s = board({ mana: 1, hand: [needle] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending).toBeNull();
    expect(perm(s, 'Pithing Needle')!.chosenName).toBe('');
  });
});

describe('Orcish Bowmasters, Faerie Mastermind, Quantum Riddler, Containment Priest, Grafdigger\'s Cage', () => {
  const bowmasters = creature('Orcish Bowmasters', 1, 1, {
    typeLine: 'Creature — Orc Archer', manaCost: '{1}{B}', cmc: 2, colors: ['B'], keywords: ['Flash'],
    oracleText: 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.',
  });
  const mastermind = creature('Faerie Mastermind', 2, 1, {
    typeLine: 'Creature — Faerie Rogue', manaCost: '{1}{U}', cmc: 2, colors: ['U'], keywords: ['Flash', 'Flying'],
    oracleText: 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.',
  });
  const riddler = creature('Quantum Riddler', 4, 6, {
    typeLine: 'Creature — Sphinx', manaCost: '{3}{U}{U}', cmc: 5, colors: ['U'], keywords: ['Flying', 'Warp'],
    oracleText: 'Flying\nWhen this creature enters, draw a card.\nAs long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.\nWarp {1}{U}',
  });
  const priest = creature('Containment Priest', 2, 2, {
    typeLine: 'Creature — Human Cleric', manaCost: '{1}{W}', cmc: 2, colors: ['W'], keywords: ['Flash'],
    oracleText: 'Flash\nIf a nontoken creature would enter and it wasn\'t cast, exile it instead.',
  });
  const cage = card({
    name: 'Grafdigger\'s Cage', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
    oracleText: 'Creature cards in graveyards and libraries can\'t enter the battlefield.\nPlayers can\'t cast spells from graveyards or libraries.',
  });
  const wheel = spell('Wheel', '{B}', 'Each player draws two cards.', 'Sorcery');
  const divination = spell('Peek', '{B}', 'Draw a card.', 'Sorcery');
  const reanimate = spell('Reanimate', '{B}', 'Return target creature card from your graveyard to the battlefield.', 'Sorcery');
  const souls = spell('Lingering Souls', '{2}{W}', 'Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}', 'Sorcery');
  const bear = creature('Bear', 2, 2);
  /** Resolves everything: triggers aimed at player 1, other choices with their defaults. */
  const run = (s: GameState) => {
    for (let i = 0; i < 30; i++) {
      const c = s.pending?.choice;
      if (c && c.player === 0) {
        s = apply(s, { type: 'choose', answer: c.kind === 'targets' ? { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] } : c.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } });
        continue;
      }
      if (!s.stack.length && !s.triggered?.length) break;
      s = settle(apply(s, { type: 'pass' }));
    }
    return s;
  };
  const army = (s: GameState) => s.battlefield.find((p) => p.card.name === 'Orc Army');

  it('Orcish Bowmasters: 1 damage and amass when it enters and for each extra card an opponent draws', () => {
    let s = board({ mana: 3, hand: [bowmasters, wheel] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.players[1].life).toBe(19);
    expect(army(s)?.counters['+1/+1']).toBe(1);
    // The opponent draws two cards: two triggers, two damage, the same Army grows.
    s = run(settle(apply(s, { type: 'cast', iid: 'h1' })));
    expect(s.players[1].life).toBe(17);
    expect(army(s)?.counters['+1/+1']).toBe(3);
    expect(s.battlefield.filter((p) => p.card.name === 'Orc Army')).toHaveLength(1);
  });

  it('Orcish Bowmasters: not for the first card of the opponent\'s draw step', () => {
    let s = board({ mine: [bowmasters] });
    for (let i = 0; i < 40 && s.turn === 1; i++) s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } }) : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    expect(s.turn).toBe(2);
    expect(s.players[1].drawnThisTurn).toBe(1);
    expect(s.triggered ?? []).toEqual([]);
    expect(s.stack).toEqual([]);
  });

  it('Faerie Mastermind draws when an opponent draws their second card in a turn', () => {
    let s = board({ mana: 1, hand: [wheel], mine: [mastermind] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    // Two from Wheel, one from Faerie Mastermind.
    expect(s.players[0].hand).toHaveLength(3);
    expect(s.players[1].hand).toHaveLength(2);
  });

  it('Quantum Riddler: one more card with one or fewer cards in hand', () => {
    let s = board({ mana: 1, hand: [divination], mine: [riddler] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.players[0].hand).toHaveLength(2);
    s = board({ mana: 1, hand: [divination, bear, bear], mine: [riddler] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.players[0].hand).toHaveLength(3);
  });

  it('Containment Priest exiles a creature put onto the battlefield without being cast', () => {
    let s = board({ mana: 1, hand: [reanimate], grave: [bear], mine: [priest] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'card', iid: 'g0' }]] })));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Bear']);
  });

  it('Grafdigger\'s Cage: creature cards stay in the graveyard; no flashback', () => {
    let s = board({ mana: 1, hand: [reanimate], grave: [bear], theirs: [cage] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'card', iid: 'g0' }]] })));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name).sort()).toEqual(['Bear', 'Reanimate']);
    s = board({ mana: 3, grave: [souls], theirs: [cage] });
    expect(castOptions(s, 0, 'g0')).toEqual([]);
    s = board({ mana: 3, grave: [souls] });
    expect(castOptions(s, 0, 'g0').length).toBeGreaterThan(0);
  });
});

describe('City of Traitors, Defense Grid, Spirit Guides, Multiversal Passage', () => {
  const city = card({ name: 'City of Traitors', typeLine: 'Land', oracleText: 'When you play another land, sacrifice this land.\n{T}: Add {C}{C}.' });
  const grid = card({ name: 'Defense Grid', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: 'Each spell costs {3} more to cast except during its controller\'s turn.' });
  const esg = creature('Elvish Spirit Guide', 2, 2, { typeLine: 'Creature — Elf Spirit', manaCost: '{2}{G}', cmc: 3, colors: ['G'], oracleText: 'Exile this card from your hand: Add {G}.' });
  const passage = card({
    name: 'Multiversal Passage', typeLine: 'Land',
    oracleText: 'As this land enters, choose a basic land type. Then you may pay 2 life. If you don\'t, it enters tapped.\nThis land is the chosen type.',
  });
  const growth = spell('Giant Growth', '{G}', 'Target creature gets +3/+3 until end of turn.');

  it('City of Traitors is sacrificed when you play another land', () => {
    let s = board({ mine: [city], hand: [swamp] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    for (let i = 0; i < 6 && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'City of Traitors')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['City of Traitors']);
  });

  it('Defense Grid: spells cost {3} more except during their controller\'s turn', () => {
    const s = board({ mine: [grid] });
    expect(castCost(s, 0, growth, {})).toEqual({ generic: 0, colored: [['G']] });
    expect(castCost(s, 1, growth, {})).toEqual({ generic: 3, colored: [['G']] });
  });

  it('Elvish Spirit Guide pays {G} by being exiled from the hand, last', () => {
    let s = board({ hand: [growth, esg], mine: [creature('Bear', 2, 2)] });
    expect(castOptions(s, 0, 'h0').length).toBeGreaterThan(0);
    // It can't pay for itself.
    expect(castOptions(s, 0, 'h1')).toEqual([]);
    s = settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }));
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Elvish Spirit Guide']);
    expect(s.players[0].hand).toEqual([]);
  });

  it('Multiversal Passage: a basic land type, its mana, and 2 life or tapped', () => {
    let s = board({ hand: [passage] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ kind: 'mode', purpose: 'basicType', modes: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] });
    s = apply(s, { type: 'choose', answer: { kind: 'mode', modes: [1] } });
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'payLife', params: { n: 2 } });
    s = apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } });
    const p = perm(s, 'Multiversal Passage')!;
    expect(p.card.typeLine).toBe('Land — Island');
    expect(p.tapped).toBe(false);
    expect(s.players[0].life).toBe(18);
    expect(unitsOf(s, p)).toEqual([['U']]);
  });
});

describe('Metagame audit 2026-10-16: Drum, Borrower, Channeler, Academy, Gemstone Mine, Spellbomb, Rhystic Study', () => {
  const drum = card({ name: 'Springleaf Drum', typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracleText: '{T}, Tap an untapped creature you control: Add one mana of any color.' });
  const borrower = creature('Brazen Borrower', 3, 1, {
    typeLine: 'Creature — Faerie Rogue // Instant — Adventure', manaCost: '{1}{U}{U} // {1}{U}', cmc: 3, colors: ['U'], keywords: ['Flash', 'Flying'],
    oracleText: 'Flash\nFlying\nThis creature can block only creatures with flying.\n//\nReturn target nonland permanent an opponent controls to its owner\'s hand.',
  });
  const drc = creature('Dragon\'s Rage Channeler', 1, 1, {
    typeLine: 'Creature — Human Shaman', manaCost: '{R}', colors: ['R'],
    oracleText: 'Whenever you cast a noncreature spell, surveil 1. (Look at the top card of your library. You may put that card into your graveyard.)\nDelirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.',
  });
  const academy = card({ name: 'Tolarian Academy', typeLine: 'Legendary Land', oracleText: '{T}: Add {U} for each artifact you control.' });
  const mine = card({ name: 'Gemstone Mine', typeLine: 'Land', oracleText: 'This land enters with three mining counters on it.\n{T}, Remove a mining counter from this land: Add one mana of any color. If there are no mining counters on this land, sacrifice it.' });
  const spellbomb = card({
    name: 'Nihil Spellbomb', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
    oracleText: '{T}, Sacrifice this artifact: Exile target player\'s graveyard.\nWhen this artifact is put into a graveyard from the battlefield, you may pay {B}. If you do, draw a card.',
  });
  const rhystic = card({ name: 'Rhystic Study', typeLine: 'Enchantment', manaCost: '{2}{U}', cmc: 3, oracleText: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.' });
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Springleaf Drum: any color by tapping a creature that makes no mana', () => {
    let s = board({ mine: [drum] });
    expect(canTapForMana(s, perm(s, 'Springleaf Drum')!)).toBe(false);
    s = board({ mine: [drum, creature('Bear', 2, 2)] });
    expect(unitsOf(s, perm(s, 'Springleaf Drum')!)).toEqual([['W', 'U', 'B', 'R', 'G']]);
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Springleaf Drum') });
    expect(perm(s, 'Bear')!.tapped).toBe(true);
    expect(s.players[0].pool).toHaveLength(1);
  });

  it('Brazen Borrower can block only creatures with flying', () => {
    const s = board({ mine: [creature('Bear', 2, 2), creature('Bird', 1, 1, { keywords: ['Flying'] })], theirs: [borrower] });
    expect(canBlock(perm(s, 'Brazen Borrower')!, perm(s, 'Bear')!)).toBe(false);
    expect(canBlock(perm(s, 'Brazen Borrower')!, perm(s, 'Bird')!)).toBe(true);
  });

  it('Dragon\'s Rage Channeler: delirium makes it a 3/3 flier that must attack', () => {
    const types = [swamp, creature('Bear', 2, 2), spell('Shock', '{R}', 'Shock deals 2 damage to any target.'), card({ name: 'Rock', typeLine: 'Artifact' })];
    const toAttack = (grave: Card[]) => {
      let s = settle(apply(board({ mine: [drc], grave }), { type: 'pass' }));
      for (let i = 0; i < 6 && s.step !== 'attack'; i++) s = apply(s, { type: 'pass' });
      return s;
    };
    // Three card types: no delirium, no attack needed.
    let s = toAttack(types.slice(0, 3));
    expect(powerOf(perm(s, 'Dragon\'s Rage Channeler')!)).toBe(1);
    expect(errorOf(() => apply(s, { type: 'declareAttackers', attackers: [] }))).toBeNull();
    s = toAttack(types);
    expect(s.step).toBe('attack');
    const channeler = perm(s, 'Dragon\'s Rage Channeler')!;
    expect([powerOf(channeler), toughnessOf(channeler)]).toEqual([3, 3]);
    expect(errorOf(() => apply(s, { type: 'declareAttackers', attackers: [] }))).toBe('mustAttack');
    expect(errorOf(() => apply(s, { type: 'declareAttackers', attackers: [channeler.iid] }))).toBeNull();
  });

  it('Tolarian Academy makes {U} for each artifact you control', () => {
    const s = board({ mine: [academy, drum, spellbomb] });
    expect(unitsOf(s, perm(s, 'Tolarian Academy')!)).toEqual([['U'], ['U']]);
  });

  it('Gemstone Mine: three mining counters, one each time, sacrificed after the last', () => {
    let s = board({ hand: [mine] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(perm(s, 'Gemstone Mine')!.counters.mining).toBe(3);
    perm(s, 'Gemstone Mine')!.counters.mining = 1;
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Gemstone Mine') });
    expect(perm(s, 'Gemstone Mine')).toBeUndefined();
    expect(s.players[0].pool?.[0].colors).toEqual(['W', 'U', 'B', 'R', 'G']);
  });

  it('Nihil Spellbomb: pay {B} to draw when it goes to the graveyard', () => {
    let s = board({ mana: 1, mine: [spellbomb] });
    const hand = s.players[0].hand.length;
    s = settle(apply(s, { type: 'activate', iid: iidOf(s, 'Nihil Spellbomb'), index: 0, targets: [[{ kind: 'player', player: 1 }]] }));
    s = run(s);
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'mayPay', params: { cost: '{B}' } });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });

  it('Rhystic Study: the opponent pays {1}, or its controller draws', () => {
    // The Study is the opponent's: player 0 casts, player 0 is asked to pay.
    let s = board({ theirs: [rhystic], hand: [spell('Shock', '{B}', 'Shock deals 2 damage to any target.')], mana: 2 });
    const theirHand = s.players[1].hand.length;
    s = settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] }));
    for (let i = 0; i < 6 && !(s.pending?.choice.player === 0); i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', player: 0, purpose: 'payOrDraw', params: { n: 1 } });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(s.players[1].hand).toHaveLength(theirHand + 1);
  });
});

describe('Metagame audit 2026-10-16, second batch', () => {
  const thrull = creature('Doorkeeper Thrull', 1, 1, { typeLine: 'Creature — Thrull', manaCost: '{1}{W}', cmc: 2, keywords: ['Flash', 'Flying'], oracleText: 'Flash\nFlying\nArtifacts and creatures entering don\'t cause abilities to trigger.' });
  const noon = card({ name: 'High Noon', typeLine: 'Enchantment', manaCost: '{1}{W}', cmc: 2, oracleText: 'Each player can\'t cast more than one spell each turn.\n{4}{R}, Sacrifice this enchantment: It deals 5 damage to any target.' });
  const remora = card({
    name: 'Mystic Remora', typeLine: 'Enchantment', manaCost: '{U}', cmc: 1,
    oracleText: 'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
  });
  const yavimaya = card({ name: 'Yavimaya, Cradle of Growth', typeLine: 'Legendary Land', oracleText: 'Each land is a Forest in addition to its other land types.' });
  const pool = card({ name: 'Reflecting Pool', typeLine: 'Land', oracleText: '{T}: Add one mana of any type that a land you control could produce.' });
  const halfling = creature('Delighted Halfling', 1, 2, { typeLine: 'Creature — Halfling Citizen', manaCost: '{G}', oracleText: '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can\'t be countered.' });
  const mycospawn = creature('Sowing Mycospawn', 3, 3, {
    typeLine: 'Creature — Eldrazi Fungus', manaCost: '{3}{G}', cmc: 4, keywords: ['Devoid', 'Kicker'],
    oracleText: 'Devoid (This card has no color.)\nKicker {1}{C} (You may pay an additional {1}{C} as you cast this spell.)\nWhen you cast this spell, search your library for a land card, put it onto the battlefield, then shuffle.\nWhen you cast this spell, if it was kicked, exile target land.',
  });
  const mockingbird = creature('Mockingbird', 1, 1, {
    typeLine: 'Creature — Bird Bard', manaCost: '{X}{U}', cmc: 1, keywords: ['Flying'],
    oracleText: 'Flying\nYou may have this creature enter as a copy of any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast this creature, except it\'s a Bird in addition to its other types and it has flying.',
  });
  const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Doorkeeper Thrull: creatures entering trigger nothing', () => {
    const healer = creature('Healer', 1, 1, { oracleText: 'When this creature enters, you gain 3 life.' });
    let s = board({ mana: 1, hand: [healer], theirs: [thrull] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'Healer')).toBeDefined();
    expect(s.players[0].life).toBe(20);
  });

  it('High Noon: one spell each turn', () => {
    const shock = spell('Shock', '{B}', 'Shock deals 2 damage to any target.');
    let s = board({ mana: 2, hand: [shock, shock], theirs: [noon] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] })));
    expect(s.players[1].life).toBe(18);
    expect(canCastNow(s, 0, shock)).toBe(false);
  });

  it('Mystic Remora: cumulative upkeep, then sacrificed', () => {
    let s = board({ mana: 3, mine: [remora] });
    const toMyUpkeep = (t: GameState) => {
      const turn = t.turn;
      for (let i = 0; i < 60 && !(t.pending?.choice.purpose === 'cumulativeUpkeep') && t.turn <= turn + 2; i++) {
        t = t.pending ? apply(t, { type: 'choose', answer: { kind: 'cards', iids: [] } }) : !t.priority && t.step === 'attack' ? apply(t, { type: 'declareAttackers', attackers: [] }) : apply(t, { type: 'pass' });
      }
      return t;
    };
    s = toMyUpkeep(s);
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', player: 0, purpose: 'cumulativeUpkeep', params: { cost: '{1}', n: 1 } });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(perm(s, 'Mystic Remora')!.counters.age).toBe(1);
    s = toMyUpkeep(s);
    expect(s.pending?.choice).toMatchObject({ purpose: 'cumulativeUpkeep', params: { cost: '{2}', n: 2 } });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(perm(s, 'Mystic Remora')).toBeUndefined();
  });

  it('Yavimaya and Reflecting Pool', () => {
    let s = board({ mine: [yavimaya, mountain] });
    expect(unitsOf(s, perm(s, 'Mountain')!)).toEqual([['R', 'G']]);
    s = board({ mine: [pool, island] });
    expect(unitsOf(s, perm(s, 'Reflecting Pool')!)).toEqual([['U']]);
    s = board({ mana: 1, mine: [pool, island] });
    expect(unitsOf(s, perm(s, 'Reflecting Pool')!)).toEqual([['B', 'U']]);
  });

  it('Delighted Halfling: any color for a legendary spell, which can\'t be countered', () => {
    const legend = creature('Legend', 2, 2, { typeLine: 'Legendary Creature — Elf', manaCost: '{R}', colors: ['R'] });
    const bear = creature('Bear', 2, 2, { manaCost: '{R}', colors: ['R'] });
    const counter = spell('Counterspell', '{U}', 'Counter target spell.');
    let s = board({ mine: [halfling], hand: [legend, bear], oppHand: [counter], oppMana: 1 });
    const h = perm(s, 'Delighted Halfling')!;
    expect(unitsOf(s, h, bear)).toEqual([['C']]);
    expect(unitsOf(s, h, legend)).toEqual([['C', 'W', 'U', 'B', 'R', 'G']]);
    expect(castOptions(s, 0, 'h1')).toEqual([]);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.stack[0]?.uncounterable).toBe(true);
    // The opponent's Counterspell does nothing to it.
    s = apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: s.stack[0].iid }]] });
    s = run(settle(s));
    expect(perm(s, 'Legend')).toBeDefined();
  });

  it('Sowing Mycospawn: a land when cast; the kicked trigger only when kicked', () => {
    const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
    let s = board({ mine: [forest, forest, forest, forest], hand: [mycospawn] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    // One trigger (not kicked), resolving above the creature spell: the search.
    expect(s.log.filter((e) => e.k === 'triggers')).toHaveLength(1);
    expect(s.stack.map((x) => x.card.name)).toEqual(['Sowing Mycospawn']);
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'search' });
    const lands = s.battlefield.length;
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [(s.pending!.choice as { options: { iid: string }[] }).options[0].iid] } }));
    expect(s.battlefield.length).toBe(lands + 2);
  });

  it('Mockingbird copies a creature with mana value up to the mana spent, as a flying Bird', () => {
    const ogre = creature('Ogre', 4, 4, { manaCost: '{3}{R}', cmc: 4 });
    let s = board({ mine: [island, island, creature('Bear', 2, 2, { typeLine: 'Creature — Bear' })], theirs: [ogre], hand: [mockingbird] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', x: 1 })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'clone' });
    expect((s.pending!.choice as { options: { card: Card }[] }).options.map((c) => c.card.name)).toEqual(['Bear']);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Bear')] } });
    const copy = s.battlefield.filter((p) => p.card.name === 'Bear').find((p) => p.iid === 'h0')!;
    expect(copy.card.typeLine).toBe('Creature — Bear Bird');
    expect(hasKeyword(copy.card, 'flying')).toBe(true);
  });
});

describe('Metagame audit 2026-10-16: rule-changing permanents', () => {
  const thalia = creature('Thalia, Guardian of Thraben', 2, 1, { typeLine: 'Legendary Creature — Human Soldier', manaCost: '{1}{W}', cmc: 2, keywords: ['First strike'], oracleText: 'First strike\nNoncreature spells cost {1} more to cast.' });
  const trinisphere = card({ name: 'Trinisphere', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracleText: 'As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast. (Additional mana in the cost may be paid with any color of mana or colorless mana. For example, a spell that would cost {1}{B} to cast costs {2}{B} to cast instead.)' });
  const damping = card({ name: 'Damping Sphere', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: 'If a land is tapped for two or more mana, it produces {C} instead of any other type and amount.\nEach spell a player casts costs {1} more to cast for each other spell that player has cast this turn.' });
  const nullRod = card({ name: 'Null Rod', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: 'Activated abilities of artifacts can\'t be activated.' });
  const drannith = creature('Drannith Magistrate', 1, 3, { typeLine: 'Creature — Human Wizard', manaCost: '{1}{W}', cmc: 2, oracleText: 'Your opponents can\'t cast spells from anywhere other than their hands.' });
  const magus = creature('Magus of the Moon', 2, 2, { typeLine: 'Creature — Human Wizard', manaCost: '{2}{R}', cmc: 3, oracleText: 'Nonbasic lands are Mountains.' });
  const urborg = card({ name: 'Urborg, Tomb of Yawgmoth', typeLine: 'Legendary Land', oracleText: 'Each land is a Swamp in addition to its other land types.' });
  const cradle = card({ name: 'Gaea\'s Cradle', typeLine: 'Legendary Land', oracleText: '{T}: Add {G} for each creature you control.' });
  const fellwar = card({ name: 'Fellwar Stone', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: '{T}: Add one mana of any color that a land an opponent controls could produce.' });
  const mage = creature('Meddling Mage', 2, 2, { typeLine: 'Creature — Human Wizard', manaCost: '{W}{U}', cmc: 2, oracleText: 'As this creature enters, choose a nonland card name.\nSpells with the chosen name can\'t be cast.' });
  const sentinel = creature('Esper Sentinel', 1, 1, { typeLine: 'Artifact Creature — Human Soldier', manaCost: '{W}', oracleText: 'Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature\'s power.' });
  const shock = spell('Shock', '{B}', 'Shock deals 2 damage to any target.');
  const bear = creature('Bear', 2, 2, { manaCost: '{1}{B}', cmc: 2 });
  const sol = card({ name: 'Sol Ring', typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracleText: '{T}: Add {C}{C}.' });
  const ancient = card({ name: 'Ancient Tomb', typeLine: 'Land', oracleText: '{T}: Add {C}{C}. This land deals 2 damage to you.' });
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Thalia, Trinisphere and Damping Sphere change costs', () => {
    let s = board({ theirs: [thalia] });
    expect(castCost(s, 0, shock, {})).toEqual({ generic: 1, colored: [['B']] });
    expect(castCost(s, 0, bear, {})).toEqual({ generic: 1, colored: [['B']] });
    s = board({ theirs: [trinisphere] });
    expect(castCost(s, 0, shock, {})).toEqual({ generic: 2, colored: [['B']] });
    perm(s, 'Trinisphere')!.tapped = true;
    expect(castCost(s, 0, shock, {})).toEqual({ generic: 0, colored: [['B']] });
    s = board({ theirs: [damping] });
    s.players[0].spellsThisTurn = 2;
    expect(castCost(s, 0, shock, {})).toEqual({ generic: 2, colored: [['B']] });
  });

  it('Damping Sphere: a land tapped for two mana makes {C}', () => {
    const s = board({ mine: [ancient, sol], theirs: [damping] });
    expect(unitsOf(s, perm(s, 'Ancient Tomb')!)).toEqual([['C']]);
    expect(unitsOf(s, perm(s, 'Sol Ring')!)).toEqual([['C'], ['C']]);
  });

  it('Null Rod: no activated abilities of artifacts, mana included', () => {
    const s = board({ mine: [sol], theirs: [nullRod] });
    expect(canTapForMana(s, perm(s, 'Sol Ring')!)).toBe(false);
  });

  it('Drannith Magistrate: opponents cast only from their hands', () => {
    const souls = spell('Lingering Souls', '{2}{W}', 'Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}', 'Sorcery');
    let s = board({ mana: 2, grave: [souls] });
    expect(castOptions(s, 0, 'g0').length).toBeGreaterThan(0);
    s = board({ mana: 2, grave: [souls], theirs: [drannith] });
    expect(castOptions(s, 0, 'g0')).toEqual([]);
  });

  it('Magus of the Moon: nonbasic lands make only {R}; Urborg makes every land a Swamp', () => {
    let s = board({ mine: [ancient, swamp], theirs: [magus] });
    expect(unitsOf(s, perm(s, 'Ancient Tomb')!)).toEqual([['R']]);
    expect(unitsOf(s, perm(s, 'Swamp')!)).toEqual([['B']]);
    s = board({ mine: [urborg, island] });
    expect(unitsOf(s, perm(s, 'Island')!)).toEqual([['U', 'B']]);
  });

  it('Gaea\'s Cradle and Fellwar Stone', () => {
    let s = board({ mine: [cradle, bear, bear] });
    expect(unitsOf(s, perm(s, 'Gaea\'s Cradle')!)).toEqual([['G'], ['G']]);
    s = board({ mine: [fellwar], oppMana: 1 });
    expect(unitsOf(s, perm(s, 'Fellwar Stone')!)).toEqual([['U']]);
  });

  it('Meddling Mage names a nonland card: it can\'t be cast', () => {
    let s = board({ mine: [card({ name: 'Plains', typeLine: 'Basic Land — Plains' }), island, swamp], hand: [mage, shock], theirs: [bear] });
    s.players[1].graveyard = [{ iid: 'og', card: shock }];
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'mode', purpose: 'spellName' });
    const modes = (s.pending!.choice as { modes: string[] }).modes;
    expect(modes).toContain('Shock');
    s = apply(s, { type: 'choose', answer: { kind: 'mode', modes: [modes.indexOf('Shock')] } });
    expect(canCastNow(s, 0, shock)).toBe(false);
    expect(castOptions(s, 0, 'h1')).toEqual([]);
  });

  it('Esper Sentinel: the first noncreature spell each turn, pay X or it draws', () => {
    let s = board({ mana: 2, hand: [shock, shock], theirs: [sentinel] });
    const theirHand = s.players[1].hand.length;
    s = settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] }));
    for (let i = 0; i < 6 && !(s.pending?.choice.player === 0); i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'payOrDraw', params: { n: 1 } });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(s.players[1].hand).toHaveLength(theirHand + 1);
    // The second one: no trigger.
    s = run(settle(apply(s, { type: 'cast', iid: 'h1', targets: [[{ kind: 'player', player: 1 }]] })));
    expect(s.pending).toBeNull();
    expect(s.players[1].hand).toHaveLength(theirHand + 1);
  });
});

describe('Commander deck (Aang, Swift Savior)', () => {
  const harbinger = creature('Harbinger of the Seas', 2, 2, { typeLine: 'Creature — Merfolk Wizard', manaCost: '{1}{U}{U}', cmc: 3, oracleText: 'Nonbasic lands are Islands.' });
  const tnn = creature('True-Name Nemesis', 3, 1, { typeLine: 'Creature — Merfolk Rogue', manaCost: '{1}{U}{U}', cmc: 3, oracleText: 'As this creature enters, choose a player.\nThis creature has protection from the chosen player.' });
  const clamp = card({ name: 'Skullclamp', typeLine: 'Artifact — Equipment', manaCost: '{1}', cmc: 1, oracleText: 'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}' });
  const apparition = creature('Skyclave Apparition', 2, 2, {
    typeLine: 'Creature — Kor Spirit', manaCost: '{1}{W}{W}', cmc: 3,
    oracleText: 'When this creature enters, exile up to one target nonland, nontoken permanent you don\'t control with mana value 4 or less.\nWhen this creature leaves the battlefield, the exiled card\'s owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.',
  });
  const interrupter = creature('Aven Interrupter', 2, 2, {
    typeLine: 'Creature — Bird Rogue', manaCost: '{1}{W}{W}', cmc: 3, keywords: ['Flash', 'Flying'],
    oracleText: 'Flash\nFlying\nWhen this creature enters, exile target spell. It becomes plotted. (Its owner may cast it as a sorcery on a later turn without paying its mana cost.)\nSpells your opponents cast from graveyards or from exile cost {2} more to cast.',
  });
  const queen = creature('The Queen of Dale', 1, 3, { typeLine: 'Legendary Creature — Human Noble', manaCost: '{1}{W}', cmc: 2, oracleText: 'Whenever an opponent casts their first noncreature spell each turn, you recruit. (Draw a card, then discard a card. If you discarded a nonland card, create a 1/1 white Human Soldier creature token.)' });
  const tchalla = creature('King T\'Challa', 2, 3, { typeLine: 'Legendary Creature — Human Noble Hero', manaCost: '{1}{W}{U}', cmc: 3, keywords: ['Flash'], oracleText: 'Flash\nWhenever a player draws their second card each turn, you draw a card.\n{4}{W}{U}: Transform King T\'Challa. Activate only as a sorcery.' });
  const thinIce = card({ name: 'On Thin Ice', typeLine: 'Snow Enchantment — Aura', manaCost: '{W}', cmc: 1, oracleText: 'Enchant snow land you control\nWhen this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.' });
  const wave = card({
    name: 'Parallax Wave', typeLine: 'Enchantment', manaCost: '{2}{W}{W}', cmc: 4,
    oracleText: 'Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can\'t, sacrifice it.)\nRemove a fade counter from this enchantment: Exile target creature.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.',
  });
  const haunt = card({ name: 'Moorland Haunt', typeLine: 'Land', oracleText: '{T}: Add {C}.\n{W}{U}, {T}, Exile a creature card from your graveyard: Create a 1/1 white Spirit creature token with flying.' });
  const tundra = card({ name: 'Tundra', typeLine: 'Land — Plains Island', oracleText: '({T}: Add {W} or {U}.)' });
  const snowPlains = card({ name: 'Snow-Covered Plains', typeLine: 'Basic Snow Land — Plains' });
  const shock = spell('Shock', '{B}', 'Shock deals 2 damage to any target.');
  const bear = creature('Bear', 2, 2, { manaCost: '{1}{G}', cmc: 2 });
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Harbinger of the Seas: nonbasic lands are Islands', () => {
    const s = board({ mine: [tundra], theirs: [harbinger] });
    expect(unitsOf(s, perm(s, 'Tundra')!)).toEqual([['U']]);
  });

  it('True-Name Nemesis: protection from the chosen player', () => {
    // The opponent's, with protection from player 0: no target, no block.
    let s = board({ mana: 1, hand: [shock], mine: [bear], theirs: [tnn] });
    perm(s, 'True-Name Nemesis')!.chosenPlayer = 0;
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'True-Name Nemesis') }]] }))).not.toBeNull();
    expect(canBlock(perm(s, 'Bear')!, perm(s, 'True-Name Nemesis')!)).toBe(false);
    // Cast: the only opponent is chosen.
    s = board({ mine: [card({ name: 'Island', typeLine: 'Basic Land — Island' }), card({ name: 'Island', typeLine: 'Basic Land — Island' }), card({ name: 'Island', typeLine: 'Basic Land — Island' })], hand: [tnn] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(perm(s, 'True-Name Nemesis')!.chosenPlayer).toBe(1);
  });

  it('Skullclamp draws two when the equipped creature dies', () => {
    let s = board({ mana: 1, mine: [clamp, creature('Elf', 1, 1)] });
    const hand = s.players[0].hand.length;
    const equip = activatedOf(clamp).findIndex((a) => a.equip);
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Skullclamp'), index: equip, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Elf') }]] })));
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(s.players[0].hand).toHaveLength(hand + 2);
  });

  it('Skyclave Apparition: the exiled card\'s owner gets an X/X Illusion when it leaves', () => {
    const plains = card({ name: 'Plains', typeLine: 'Basic Land — Plains' });
    let s = board({ mine: [plains, plains, plains], hand: [apparition, spell('Murder', '{B}', 'Destroy target creature.')], theirs: [bear] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    if (s.pending?.choice.kind === 'targets') s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } }));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(perm(s, 'Skyclave Apparition')!.exiledCard).toEqual({ cmc: 2, owner: 1 });
    s.battlefield.push({ iid: 'sw', card: swamp, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h1', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Skyclave Apparition') }]] })));
    const illusion = s.battlefield.find((p) => p.card.name === 'Illusion')!;
    expect([illusion.controller, powerOf(illusion), toughnessOf(illusion)]).toEqual([1, 2, 2]);
  });

  it('Aven Interrupter: an opponent\'s spells from graveyards or exile cost {2} more', () => {
    const souls = spell('Lingering Souls', '{2}{W}', 'Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}', 'Sorcery');
    const s = board({ theirs: [interrupter] });
    expect(castCost(s, 0, souls, { from: 'graveyard' })).toEqual({ generic: 3, colored: [['B']] });
    expect(castCost(s, 1, souls, { from: 'graveyard' })).toEqual({ generic: 1, colored: [['B']] });
  });

  it('The Queen of Dale recruits; King T\'Challa draws on any second card', () => {
    let s = board({ mana: 1, hand: [shock], theirs: [queen] });
    const theirHand = s.players[1].hand.length;
    s = settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] }));
    for (let i = 0; i < 6 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    // Player 1 drew, and discards (its own choice): a land (Island) makes no token.
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', player: 1, purpose: 'discard' });
    const options = (s.pending!.choice as { options: { iid: string }[] }).options;
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [options[0].iid] } }));
    expect(s.players[1].hand).toHaveLength(theirHand);
    expect(s.battlefield.some((p) => p.card.name === 'Human Soldier')).toBe(false);

    const wheel = spell('Wheel', '{B}', 'Each player draws two cards.', 'Sorcery');
    s = board({ mana: 1, hand: [wheel], mine: [tchalla] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    // Two players reach their second card: two triggers, 2 + 2 cards for player 0.
    expect(s.players[0].hand).toHaveLength(4);
  });

  it('On Thin Ice enchants a snow land you control', () => {
    const s = board({ mine: [snowPlains, card({ name: 'Plains', typeLine: 'Basic Land — Plains' })], hand: [thinIce], theirs: [bear] });
    const opts = castOptions(s, 0, 'h0');
    expect(opts.length).toBeGreaterThan(0);
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Plains') }]] }))).not.toBeNull();
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Snow-Covered Plains') }]] }))).toBeNull();
  });

  it('Parallax Wave: fade counters exile creatures until it leaves', () => {
    let s = board({ mine: [wave], theirs: [bear] });
    perm(s, 'Parallax Wave')!.counters.fade = 5;
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Parallax Wave'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(perm(s, 'Parallax Wave')!.counters.fade).toBe(4);
    // With its last counter used, destroying it brings the Bear back.
    const naturalize = spell('Shatter', '{B}', 'Destroy target enchantment.');
    s = board({ mana: 1, mine: [wave], theirs: [bear], hand: [naturalize] });
    perm(s, 'Parallax Wave')!.counters.fade = 1;
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Parallax Wave'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Parallax Wave'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Parallax Wave') }]] }))).toBe('noCounterToRemove');
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Parallax Wave') }]] })));
    expect(perm(s, 'Bear')).toBeDefined();
  });

  it('Thraben Inspector investigates: a Clue token', () => {
    const inspector = creature('Thraben Inspector', 1, 2, { typeLine: 'Creature — Human Soldier', manaCost: '{W}', oracleText: 'When this creature enters, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")' });
    let s = board({ mine: [card({ name: 'Plains', typeLine: 'Basic Land — Plains' })], hand: [inspector] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.battlefield.some((p) => p.card.name === 'Clue')).toBe(true);
  });

  it('Moorland Haunt exiles a creature card from the graveyard to make a Spirit', () => {
    const plains = card({ name: 'Plains', typeLine: 'Basic Land — Plains' });
    let s = board({ mine: [haunt, plains, card({ name: 'Island', typeLine: 'Basic Land — Island' })], grave: [bear] });
    const index = activatedOf(haunt).findIndex((a) => a.cost.exileFromGraveyard);
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Moorland Haunt'), index });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'exileCost' });
    s = run(settle(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g0'] } })));
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Bear']);
    expect(s.battlefield.some((p) => p.card.name === 'Spirit')).toBe(true);
  });
});

describe('Aang deck, batch 1: counterspells and spell targets', () => {
  const lapse = spell('Memory Lapse', '{1}{U}', 'Counter target spell. If that spell is countered this way, put it on top of its owner\'s library instead of into that player\'s graveyard.');
  const remand = spell('Remand', '{1}{U}', 'Counter target spell. If that spell is countered this way, put it into its owner\'s hand instead of into that player\'s graveyard.\nDraw a card.');
  const reprieve = spell('Reprieve', '{1}{W}', 'Return target spell to its owner\'s hand.\nDraw a card.');
  const scolding = spell('Stern Scolding', '{U}', 'Counter target creature spell with power or toughness 2 or less.');
  const talesEnd = spell('Tale\'s End', '{1}{U}', 'Counter target activated ability, triggered ability, or legendary spell.');
  const stupor = spell('Sink into Stupor', '{1}{U}{U}', 'Return target spell or nonland permanent an opponent controls to its owner\'s hand.');
  const cryptic = spell('Cryptic Command', '{1}{U}{U}{U}', 'Choose two —\n• Counter target spell.\n• Return target permanent to its owner\'s hand.\n• Tap all creatures your opponents control.\n• Draw a card.');
  const tidebinder = creature('Tishana\'s Tidebinder', 3, 2, {
    typeLine: 'Creature — Merfolk Wizard', manaCost: '{2}{U}', cmc: 3, keywords: ['Flash'],
    oracleText: 'Flash\nWhen this creature enters, counter up to one target activated or triggered ability. If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield. (Mana abilities can\'t be targeted.)',
  });
  const subtlety = creature('Subtlety', 3, 3, {
    typeLine: 'Creature — Elemental Incarnation', manaCost: '{2}{U}{U}', cmc: 4, keywords: ['Flash', 'Flying'],
    oracleText: 'Flash\nFlying\nWhen this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library.\nEvoke—Exile a blue card from your hand.',
  });
  const swords = spell('Swords to Plowshares', '{W}', 'Exile target creature. Its controller gains life equal to its power.');
  const solitude = creature('Solitude', 3, 2, {
    typeLine: 'Creature — Elemental Incarnation', manaCost: '{3}{W}{W}', cmc: 5, keywords: ['Flash', 'Lifelink'],
    oracleText: 'Flash\nLifelink\nWhen this creature enters, exile up to one other target creature. That creature\'s controller gains life equal to its power.\nEvoke—Exile a white card from your hand.',
  });
  const bear = creature('Bear', 2, 2, { manaCost: '{B}', cmc: 1 });
  const ogre = creature('Ogre', 3, 3, { manaCost: '{B}', cmc: 1 });
  const legend = creature('Legend', 2, 2, { typeLine: 'Legendary Creature — Elf', manaCost: '{B}', cmc: 1 });
  const islands = (n: number) => Array.from({ length: n }, () => card({ name: 'Island', typeLine: 'Basic Land — Island' }));
  const plains = (n: number) => Array.from({ length: n }, () => card({ name: 'Plains', typeLine: 'Basic Land — Plains' }));
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  /** Player 0 casts `mine` (h0); player 1 answers with o0 aimed at it; everything resolves. */
  const respond = (mine: Card, theirs: Card, theirLands: Card[], extra: Partial<Parameters<typeof board>[0]> = {}) => {
    let s = board({ mana: 1, hand: [mine], oppHand: [theirs], theirs: theirLands, ...extra });
    s = apply(s, { type: 'cast', iid: 'h0' });
    s = apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: s.stack[0].iid }]] });
    return run(settle(s));
  };

  it('Memory Lapse puts the spell on top of its owner\'s library; Remand into their hand', () => {
    let s = respond(bear, lapse, islands(2));
    expect(s.players[0].library[0].card.name).toBe('Bear');
    expect(perm(s, 'Bear')).toBeUndefined();
    s = respond(bear, remand, islands(2));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Bear']);
    expect(s.players[1].graveyard.map((c) => c.card.name)).toEqual(['Remand']);
  });

  it('Reprieve returns a spell to its owner\'s hand; Sink into Stupor a spell or a permanent', () => {
    let s = respond(bear, reprieve, plains(2));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Bear']);
    s = respond(bear, stupor, islands(3));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Bear']);
    s = board({ mine: [ogre], oppHand: [stupor], oppMana: 3 });
    expect(isLegalTarget(s, 1, spellSpec(stupor).targets[0], { kind: 'permanent', iid: iidOf(s, 'Ogre') })).toBe(true);
  });

  it('Stern Scolding: only a creature spell with power or toughness 2 or less', () => {
    let s = respond(bear, scolding, islands(1));
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Bear']);
    const target = spellSpec(scolding).targets[0];
    s = board({ mana: 2, hand: [ogre, bear] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    s.stack = [{ iid: 'x0', card: ogre, controller: 0, targets: [] }, { iid: 'x1', card: bear, controller: 0, targets: [] }];
    expect(isLegalTarget(s, 1, target, { kind: 'spell', iid: 'x0' })).toBe(false);
    expect(isLegalTarget(s, 1, target, { kind: 'spell', iid: 'x1' })).toBe(true);
  });

  it('Tale\'s End: an activated or triggered ability, or a legendary spell (not another spell)', () => {
    let s = respond(legend, talesEnd, islands(2));
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Legend']);
    const target = spellSpec(talesEnd).targets[0];
    s = board({});
    s.stack = [
      { iid: 'x0', card: bear, controller: 0, targets: [] },
      { iid: 'x1', card: bear, controller: 0, targets: [], ability: { targets: [], effects: [] }, triggered: true },
      { iid: 'x2', card: bear, controller: 0, targets: [], ability: { targets: [], effects: [] } },
    ];
    expect(['x0', 'x1', 'x2'].map((iid) => isLegalTarget(s, 1, target, { kind: 'spell', iid }))).toEqual([false, true, true]);
  });

  it('Cryptic Command taps all creatures the opponents control', () => {
    let s = board({ mine: [...islands(4)], hand: [cryptic], theirs: [bear, ogre] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', modes: [2, 3] })));
    expect(s.battlefield.filter((p) => p.controller === 1).map((p) => p.tapped)).toEqual([true, true]);
  });

  /** Passes until the stack holds an ability (a trigger waiting to resolve), player 1 to act. */
  const toTrigger = (s: GameState) => {
    for (let i = 0; i < 10 && !(s.stack.some((x) => x.ability) && actor(s) === 1); i++) {
      if (s.pending) break;
      s = apply(s, { type: 'pass' });
    }
    return s;
  };

  it('Tishana\'s Tidebinder counters a trigger and its creature loses all abilities while it stays', () => {
    const healer = creature('Healer', 1, 1, { manaCost: '{B}', cmc: 1, keywords: ['Flying'], oracleText: 'Flying\nWhen this creature enters, you gain 3 life.' });
    let s = board({ mana: 1, hand: [healer], oppHand: [tidebinder], theirs: islands(3), oppMana: 0 });
    s.fullControl = [false, true];
    s = toTrigger(apply(s, { type: 'cast', iid: 'h0' }));
    const trigger = s.stack.find((x) => x.ability)!;
    expect(trigger).toBeDefined();
    s = apply(s, { type: 'cast', iid: 'o0' });
    // Tidebinder resolves (both pass), then its trigger asks for a target.
    for (let i = 0; i < 6 && !s.pending; i++) s = apply(s, { type: 'pass' });
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', player: 1 });
    s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'spell', iid: trigger.iid }]] } });
    s = run(settle(s));
    expect(s.players[0].life).toBe(20);
    expect(hasKeyword(perm(s, 'Healer')!.card, 'flying')).toBe(false);
  });

  it('Subtlety: the owner puts the creature spell on top or bottom of their library', () => {
    let s = board({ mana: 1, hand: [bear], oppHand: [subtlety], theirs: islands(4) });
    s.fullControl = [false, true];
    s = apply(s, { type: 'cast', iid: 'h0' });
    s = apply(s, { type: 'cast', iid: 'o0' });
    for (let i = 0; i < 6 && !s.pending; i++) s = apply(s, { type: 'pass' });
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', player: 1 });
    s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'spell', iid: 'h0' }]] } });
    for (let i = 0; i < 6 && !s.pending; i++) s = apply(s, { type: 'pass' });
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', player: 0, purpose: 'tuckTop' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(s.players[0].library.at(-1)!.card.name).toBe('Bear');
    expect(perm(s, 'Bear')).toBeUndefined();
  });

  it('Swords to Plowshares and Solitude: the creature\'s controller gains life equal to its power', () => {
    let s = board({ mine: plains(1), hand: [swords], theirs: [ogre] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })));
    expect(s.players[1].life).toBe(23);
    s = board({ mine: plains(5), hand: [solitude], theirs: [ogre] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    // "other target creature": Solitude itself isn't offered.
    expect(s.pending?.choice.kind).toBe('targets');
    const choice = s.pending!.choice as { slots: TargetSpec[] };
    expect(isLegalTarget(s, 0, choice.slots[0], { kind: 'permanent', iid: iidOf(s, 'Solitude') }, iidOf(s, 'Solitude'))).toBe(false);
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] } }));
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(s.players[1].life).toBe(23);
  });
});

describe('Aang deck, batch 2: alternative and additional costs', () => {
  const daze = spell('Daze', '{1}{U}', 'You may return an Island you control to its owner\'s hand rather than pay this spell\'s mana cost.\nCounter target spell unless its controller pays {1}.');
  const fon = spell('Force of Negation', '{1}{U}{U}', 'If it\'s not your turn, you may exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard.');
  const wash = spell('Wash Away', '{U}', 'Cleave {1}{U}{U} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nCounter target spell [that wasn\'t cast from its owner\'s hand].');
  const sense = spell('Spider-Sense', '{1}{U}', 'Web-slinging {U} (You may cast this spell for {U} if you also return a tapped creature you control to its owner\'s hand.)\nCounter target instant spell, sorcery spell, or triggered ability.');
  const probe = spell('Gitaxian Probe', '{U/P}', '({U/P} can be paid with either {U} or 2 life.)\nLook at target player\'s hand.\nDraw a card.', 'Sorcery');
  const march = spell('March of Otherworldly Light', '{X}{W}', 'As an additional cost to cast this spell, you may exile any number of white cards from your hand. This spell costs {2} less to cast for each card exiled this way.\nExile target artifact, creature, or enchantment with mana value X or less.');
  const solitude = creature('Solitude', 3, 2, {
    typeLine: 'Creature — Elemental Incarnation', manaCost: '{3}{W}{W}', cmc: 5, colors: ['W'], keywords: ['Flash', 'Lifelink', 'Evoke'],
    oracleText: 'Flash\nLifelink\nWhen this creature enters, exile up to one other target creature. That creature\'s controller gains life equal to its power.\nEvoke—Exile a white card from your hand.',
  });
  const riddler = creature('Quantum Riddler', 4, 6, {
    typeLine: 'Creature — Sphinx', manaCost: '{3}{U}{U}', cmc: 5, colors: ['U'], keywords: ['Flying', 'Warp'],
    oracleText: 'Flying\nWhen this creature enters, draw a card.\nAs long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.\nWarp {1}{U}',
  });
  const island = () => card({ name: 'Island', typeLine: 'Basic Land — Island' });
  const plains = () => card({ name: 'Plains', typeLine: 'Basic Land — Plains' });
  const blue = (name: string) => creature(name, 1, 1, { colors: ['U'], manaCost: '{U}' });
  const white = (name: string) => creature(name, 1, 1, { colors: ['W'], manaCost: '{W}' });
  const bear = creature('Bear', 2, 2, { manaCost: '{B}', cmc: 1 });
  const shock = spell('Shock', '{B}', 'Shock deals 2 damage to any target.');
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const altIndex = (c: Card, kind: string) => castInfo(c).alts.findIndex((a) => a.kind === kind || ('name' in a && a.name === kind) || (kind === 'evoke' && 'evoke' in a));

  it('Daze: return an Island instead of paying; the spell is countered unless {1} is paid', () => {
    let s = board({ mana: 1, hand: [bear], oppHand: [daze], theirs: [island()] });
    s.fullControl = [false, true];
    s = apply(s, { type: 'cast', iid: 'h0' });
    perm(s, 'Island')!.tapped = true;
    expect(castOptions(s, 1, 'o0').map((o) => o.alt)).toEqual([altIndex(daze, 'returnLand')]);
    s = apply(s, { type: 'cast', iid: 'o0', alt: altIndex(daze, 'returnLand'), targets: [[{ kind: 'spell', iid: 'h0' }]] });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', player: 1, purpose: 'returnLandCost' });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Island')] } });
    expect(s.players[1].hand.map((c) => c.card.name)).toEqual(['Island']);
    s = run(s);
    // Player 0 has no mana left to pay {1}: Bear is countered.
    expect(perm(s, 'Bear')).toBeUndefined();
  });

  it('Force of Negation: exile a blue card on an opponent\'s turn; the countered spell is exiled', () => {
    let s = board({ mana: 1, hand: [shock], oppHand: [fon, blue('Merfolk')] });
    s.fullControl = [false, true];
    s = apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] });
    s = apply(s, { type: 'cast', iid: 'o0', alt: altIndex(fon, 'exileCard'), targets: [[{ kind: 'spell', iid: 'h0' }]] });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'exileFromHandCost' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['o1'] } }));
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Merfolk']);
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Shock']);
    expect(s.players[1].life).toBe(20);
    // On its own turn, the alternative cost isn't offered.
    s = board({ hand: [fon, blue('Merfolk')] });
    expect(castOptions(s, 0, 'h0')).toEqual([]);
  });

  it('Wash Away: a spell not cast from the hand; with cleave, any spell', () => {
    let s = board({ mana: 1, hand: [bear] });
    s.stack = [{ iid: 'x0', card: bear, controller: 0, targets: [] }, { iid: 'x1', card: bear, controller: 0, targets: [], from: 'graveyard' }];
    expect(['x0', 'x1'].map((iid) => isLegalTarget(s, 1, castSpec(wash, {}).targets[0], { kind: 'spell', iid }))).toEqual([false, true]);
    const cleave = castSpec(wash, { alt: altIndex(wash, 'cleave') }).targets[0];
    expect(['x0', 'x1'].map((iid) => isLegalTarget(s, 1, cleave, { kind: 'spell', iid }))).toEqual([true, true]);
  });

  it('Spider-Sense: web-slinging for {U}, returning a tapped creature', () => {
    let s = board({ mine: [island(), bear], hand: [sense, shock] });
    perm(s, 'Bear')!.tapped = true;
    s.stack = [{ iid: 'x0', card: shock, controller: 1, targets: [[{ kind: 'player', player: 0 }]] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    const web = altIndex(sense, 'webSlinging');
    expect(castOptions(s, 0, 'h0').map((o) => o.alt)).toContain(web);
    s = apply(s, { type: 'cast', iid: 'h0', alt: web, targets: [[{ kind: 'spell', iid: 'x0' }]] });
    expect(s.pending?.choice).toMatchObject({ purpose: 'returnCreatureCost' });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Bear')] } });
    expect(s.players[0].hand.map((c) => c.card.name).sort()).toEqual(['Bear', 'Shock']);
  });

  it('Gitaxian Probe: 2 life instead of {U}; looks at a hand and draws', () => {
    let s = board({ hand: [probe], oppHand: [bear] });
    const life = altIndex(probe, 'phyrexian');
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', alt: life, targets: [[{ kind: 'player', player: 1 }]] })));
    expect(s.players[0].life).toBe(18);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.log.some((e) => e.k === 'looksAtHand' && e.cards.join() === 'Bear')).toBe(true);
  });

  it('March of Otherworldly Light: X, and {2} less for each white card exiled', () => {
    const ogre = creature('Ogre', 3, 3, { manaCost: '{2}{B}', cmc: 3 });
    let s = board({ mine: [plains(), plains()], hand: [march, white('Cat')], theirs: [ogre] });
    expect(castOptions(s, 0, 'h0').some((o) => o.exiled === 1)).toBe(true);
    // X = 3, one white card exiled: {3}{W} - {2} = {1}{W}.
    s = apply(s, { type: 'cast', iid: 'h0', x: 3, exiled: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] });
    expect(s.pending?.choice).toMatchObject({ purpose: 'exileFromHandCost', min: 1 });
    s = run(settle(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } })));
    expect(perm(s, 'Ogre')).toBeUndefined();
    // X too small: the Ogre isn't a legal target.
    expect(isLegalTarget(s, 0, castSpec(march, { x: 2 }).targets[0], { kind: 'permanent', iid: 'p0' })).toBe(false);
  });

  it('Solitude evoked: a white card exiled, its trigger resolves, then it is sacrificed', () => {
    let s = board({ hand: [solitude, white('Cat')], theirs: [bear] });
    s = apply(s, { type: 'cast', iid: 'h0', alt: altIndex(solitude, 'evoke') });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    for (let i = 0; i < 10 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    if (s.pending?.choice.kind === 'targets') s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } });
    s = run(s);
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(perm(s, 'Solitude')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Solitude']);
  });

  it('Quantum Riddler warped: exiled at the end step, cast from exile on a later turn', () => {
    let s = board({ mine: [island(), island()], hand: [riddler] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', alt: altIndex(riddler, 'warp') })));
    expect(perm(s, 'Quantum Riddler')).toBeDefined();
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn; i++) s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } }) : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    expect(perm(s, 'Quantum Riddler')).toBeUndefined();
    const inExile = s.players[0].exile.find((c) => c.card.name === 'Quantum Riddler')!;
    expect(inExile.warpedOnTurn).toBe(turn);
    // On a later turn it can be cast from exile, not on the turn it was warped.
    expect(castSource(s, 0, inExile.iid)?.from).toBe('exile');
    s.turn = turn;
    expect(castSource(s, 0, inExile.iid)).toBeNull();
  });
});

describe('Aang deck, batch 3: library mechanics', () => {
  const brainstorm = spell('Brainstorm', '{U}', 'Draw three cards, then put two cards from your hand on top of your library in any order.');
  const ponder = spell('Ponder', '{U}', 'Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.', 'Sorcery');
  const consult = spell('Consult the Star Charts', '{1}{U}', 'Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\nLook at the top X cards of your library, where X is the number of lands you control. Put one of those cards into your hand. If this spell was kicked, put two of those cards into your hand instead. Put the rest on the bottom of your library in a random order.');
  const tutor = spell('Enlightened Tutor', '{W}', 'Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.');
  const stoneforge = creature('Stoneforge Mystic', 1, 2, {
    typeLine: 'Creature — Kor Artificer', manaCost: '{1}{W}', cmc: 2,
    oracleText: 'When this creature enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\n{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.',
  });
  const step = card({
    name: 'Step Through', typeLine: 'Sorcery', manaCost: '{3}{U}{U}', cmc: 5, keywords: ['Wizardcycling', 'Typecycling', 'Cycling'],
    oracleText: 'Return two target creatures to their owners\' hands.\nWizardcycling {2} ({2}, Discard this card: Search your library for a Wizard card, reveal it, put it into your hand, then shuffle.)',
  });
  const clamp = card({ name: 'Skullclamp', typeLine: 'Artifact — Equipment', manaCost: '{1}', cmc: 1, oracleText: 'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}' });
  const wizard = creature('Wizard', 1, 1, { typeLine: 'Creature — Human Wizard' });
  const named = (name: string) => card({ name, typeLine: 'Sorcery', manaCost: '{1}', cmc: 1 });
  const library = (s: GameState, cards: Card[]) => {
    s.players[0].library = [...cards.map((c, i) => ({ iid: `l${i}`, card: c })), ...s.players[0].library];
  };
  const names = (cs: { card: Card }[]) => cs.map((c) => c.card.name);
  const lands = (type: string, n: number) => Array.from({ length: n }, () => card({ name: type, typeLine: `Basic Land — ${type}` }));
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Brainstorm draws three, then puts two cards from the hand back on top (the first chosen on top)', () => {
    let s = board({ mine: lands('Island', 1), hand: [brainstorm, named('Kept')] });
    library(s, [named('A'), named('B'), named('C')]);
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'putBack', min: 2, max: 2 });
    const iid = (n: string) => s.players[0].hand.find((c) => c.card.name === n)!.iid;
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iid('C'), iid('Kept')] } }));
    expect(names(s.players[0].hand).sort()).toEqual(['A', 'B']);
    expect(names(s.players[0].library.slice(0, 2))).toEqual(['C', 'Kept']);
  });

  it('Ponder: the top three in any order, may shuffle, then draw', () => {
    let s = board({ mine: lands('Island', 1), hand: [ponder] });
    library(s, [named('A'), named('B'), named('C')]);
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'arrange', purpose: 'reorder' });
    s = apply(s, { type: 'choose', answer: { kind: 'arrange', zones: { top: ['l2', 'l0', 'l1'] } } });
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'mayShuffle' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(names(s.players[0].hand)).toEqual(['C']);
    expect(names(s.players[0].library.slice(0, 2))).toEqual(['A', 'B']);
  });

  it('Consult the Star Charts looks at X cards (X = lands); two into the hand when kicked', () => {
    let s = board({ mine: lands('Island', 4), hand: [consult] });
    library(s, [named('A'), named('B'), named('C'), named('D'), named('E')]);
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', kicked: true })));
    const choice = s.pending?.choice as { kind: string; min: number; max: number; options: { iid: string; card: Card }[] };
    expect(choice).toMatchObject({ kind: 'cards', min: 2, max: 2 });
    expect(names(choice.options)).toEqual(['A', 'B', 'C', 'D']);
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1', 'l3'] } }));
    expect(names(s.players[0].hand).sort()).toEqual(['B', 'D']);
    expect(names(s.players[0].library.slice(0, 1))).toEqual(['E']);
    expect(names(s.players[0].library.slice(-2)).sort()).toEqual(['A', 'C']);
  });

  it('Enlightened Tutor puts the artifact on top after shuffling', () => {
    let s = board({ mine: lands('Plains', 1), hand: [tutor] });
    library(s, [named('A'), clamp]);
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'search' });
    expect(names((s.pending!.choice as { options: { card: Card }[] }).options)).toEqual(['Skullclamp']);
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } }));
    expect(names(s.players[0].library.slice(0, 1))).toEqual(['Skullclamp']);
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('Stoneforge Mystic puts an Equipment card from the hand onto the battlefield', () => {
    let s = board({ mine: [...lands('Plains', 2), stoneforge], hand: [clamp, named('A')] });
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Stoneforge Mystic'), index: 0 })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'putFromHand', min: 0, max: 1 });
    expect(names((s.pending!.choice as { options: { card: Card }[] }).options)).toEqual(['Skullclamp']);
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0'] } }));
    expect(perm(s, 'Skullclamp')?.controller).toBe(0);
    expect(names(s.players[0].hand)).toEqual(['A']);
  });

  it('Step Through returns two creatures; Wizardcycling finds a Wizard', () => {
    const bear = creature('Bear', 2, 2);
    expect(spellSpec(step).targets).toHaveLength(1);
    expect(spellSpec(step).targets[0]).toMatchObject({ min: 2, max: 2 });
    let s = board({ mana: 2, hand: [step], theirs: [bear] });
    library(s, [named('A'), wizard]);
    s = run(settle(apply(s, { type: 'cycle', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'search' });
    expect(names((s.pending!.choice as { options: { card: Card }[] }).options)).toEqual(['Wizard']);
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } }));
    expect(names(s.players[0].hand)).toEqual(['Wizard']);
    expect(names(s.players[0].graveyard)).toEqual(['Step Through']);
  });
});

describe('Aang deck, batch 4: permanents with more to do', () => {
  const mother = creature('Mother of Runes', 1, 1, {
    typeLine: 'Creature — Human Cleric', manaCost: '{W}', colors: ['W'],
    oracleText: '{T}: Target creature you control gains protection from the color of your choice until end of turn.',
  });
  const mantra = spell('Reverent Mantra', '{3}{W}', 'You may exile a white card from your hand rather than pay this spell\'s mana cost.\nChoose a color. All creatures gain protection from the chosen color until end of turn.');
  const bolt = card({ name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, colors: ['R'], oracleText: 'Bolt deals 3 damage to any target.' });
  const bear = creature('Bear', 2, 2);
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Mother of Runes: protection from the chosen color, the spell targeting the creature is countered', () => {
    let s = board({ mine: [mother, bear] });
    s.stack = [{ iid: 'x0', card: bolt, controller: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Mother of Runes'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] });
    // The opponent passes: the ability resolves.
    expect(s.pending?.choice).toMatchObject({ kind: 'mode', purpose: 'color', modes: ['W', 'U', 'B', 'R', 'G'] });
    s = run(apply(s, { type: 'choose', answer: { kind: 'mode', modes: [3] } }));
    expect(perm(s, 'Bear')?.damage).toBe(0);
    expect(s.log.some((e) => e.k === 'gainsProtection' && e.color === 'R')).toBe(true);
  });

  it('Mother of Runes: the bot protects its creature from the removal spell\'s color', () => {
    let s = board({ theirs: [mother, bear] });
    s.stack = [{ iid: 'x0', card: bolt, controller: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }];
    s.priority = { player: 1, passes: 0, reason: 'main' };
    const action = botAction(s);
    expect(action).toMatchObject({ type: 'activate', iid: iidOf(s, 'Mother of Runes') });
    s = apply(s, action);
    for (let i = 0; i < 20 && s.stack.length; i++) s = apply(s, s.pending || actor(s) === 1 ? botAction(s) : { type: 'pass' });
    expect(perm(s, 'Bear')?.damage).toBe(0);
  });

  it('Snapcaster Mage: an instant or sorcery in the graveyard gains flashback for its mana cost this turn', () => {
    const snap = creature('Snapcaster Mage', 2, 1, {
      typeLine: 'Creature — Human Wizard', manaCost: '{1}{U}', cmc: 2, colors: ['U'], keywords: ['Flash'],
      oracleText: 'Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.',
    });
    const divination = spell('Divination', '{2}{U}', 'Draw two cards.', 'Sorcery');
    const islands = Array.from({ length: 5 }, () => card({ name: 'Island', typeLine: 'Basic Land — Island' }));
    let s = board({ mine: islands, hand: [snap], grave: [divination, bear] });
    expect(castOptions(s, 0, 'g0')).toEqual([]);
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 6 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.pending?.choice).toMatchObject({ kind: 'targets' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'card', iid: 'g0' }]] } }));
    expect(s.players[0].graveyard.find((c) => c.iid === 'g0')?.flashbackOnTurn).toBe(s.turn);
    // Cast from the graveyard for {2}{U}, then exiled.
    expect(castOptions(s, 0, 'g0').map((o) => o.from)).toEqual(['graveyard']);
    expect(castCost(s, 0, divination, { from: 'graveyard' }).generic).toBe(2);
    s = run(settle(apply(s, { type: 'cast', iid: 'g0' })));
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Divination']);
    // A creature card can't be targeted.
    expect(isLegalTarget(s, 0, triggersOf(snap)[0].ability.targets[0], { kind: 'card', iid: 'g1' })).toBe(false);
  });

  it('Phelia: the exiled permanent comes back at the end step under its owner\'s control; a counter if it\'s yours', () => {
    const phelia = creature('Phelia, Exuberant Shepherd', 2, 2, {
      typeLine: 'Legendary Creature — Dog', manaCost: '{1}{W}', cmc: 2, colors: ['W'], keywords: ['Flash'],
      oracleText: 'Flash\nWhenever Phelia attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner\'s control. If it entered under your control, put a +1/+1 counter on Phelia.',
    });
    const toEnd = (s: GameState, target: string) => {
      s = apply(s, { type: 'pass' }); // to combat
      for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
      s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Phelia, Exuberant Shepherd')] });
      expect(s.pending?.choice).toMatchObject({ kind: 'targets' });
      s = settle(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, target) }]] } }));
      for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
      expect(perm(s, target)).toBeUndefined();
      return apply(s, { type: 'pass' }); // end step
    };
    // The opponent's creature: back under their control, no counter.
    let s = toEnd(board({ mine: [phelia], theirs: [bear] }), 'Bear');
    expect(perm(s, 'Bear')?.controller).toBe(1);
    expect(perm(s, 'Phelia, Exuberant Shepherd')!.counters['+1/+1']).toBeUndefined();
    // Our own creature: back under our control, and a +1/+1 counter on Phelia.
    s = toEnd(board({ mine: [phelia, bear] }), 'Bear');
    expect(perm(s, 'Bear')?.controller).toBe(0);
    expect(perm(s, 'Phelia, Exuberant Shepherd')!.counters['+1/+1']).toBe(1);
  });

  it('Ocelot Pride: a Cat if you gained life; with the city\'s blessing, a copy of each token that entered this turn', () => {
    const ocelot = creature('Ocelot Pride', 1, 1, {
      typeLine: 'Creature — Cat', manaCost: '{W}', colors: ['W'], keywords: ['Lifelink', 'Ascend', 'First strike'],
      oracleText: 'First strike, lifelink\nAscend (If you control ten or more permanents, you get the city\'s blessing for the rest of the game.)\nAt the beginning of your end step, if you gained life this turn, create a 1/1 white Cat creature token. Then if you have the city\'s blessing, for each token you control that entered this turn, create a token that\'s a copy of it.',
    });
    const endStep = (s: GameState) => {
      for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
      return settle(apply(s, { type: 'pass' }));
    };
    const cats = (s: GameState) => s.battlefield.filter((x) => x.card.name === 'Cat').length;
    // No life gained: nothing.
    let s = endStep(board({ mana: 2, mine: [ocelot] }));
    expect(cats(s)).toBe(0);
    // Life gained, three permanents: one Cat, no blessing.
    s = board({ mana: 2, mine: [ocelot] });
    s.players[0].gainedThisTurn = 1;
    s = endStep(s);
    expect(cats(s)).toBe(1);
    expect(s.players[0].citysBlessing).toBeUndefined();
    // Ten permanents: the blessing; the new Cat is copied.
    s = board({ mana: 9, mine: [ocelot] });
    s.players[0].gainedThisTurn = 1;
    s = endStep(s);
    expect(s.players[0].citysBlessing).toBe(true);
    expect(cats(s)).toBe(2);
  });

  it('Pre-War Formalwear returns a creature card with mana value 3 or less and is attached to it', () => {
    const formalwear = card({
      name: 'Pre-War Formalwear', typeLine: 'Artifact — Equipment', manaCost: '{2}{W}', cmc: 3, keywords: ['Equip'],
      oracleText: 'When this Equipment enters, return target creature card with mana value 3 or less from your graveyard to the battlefield and attach this Equipment to it.\nEquipped creature gets +2/+2 and has vigilance.\nEquip {3}',
    });
    const ogre = creature('Ogre', 3, 3, { manaCost: '{3}{W}', cmc: 4 });
    const plains = Array.from({ length: 3 }, () => card({ name: 'Plains', typeLine: 'Basic Land — Plains' }));
    let s = board({ mine: plains, hand: [formalwear], grave: [bear, ogre] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 6 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    const slot = triggersOf(formalwear)[0].ability.targets[0];
    expect(isLegalTarget(s, 0, slot, { kind: 'card', iid: 'g1' })).toBe(false);
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'card', iid: 'g0' }]] } }));
    expect(perm(s, 'Pre-War Formalwear')!.attachedTo).toBe(iidOf(s, 'Bear'));
    expect(powerOf(perm(s, 'Bear')!)).toBe(4);
  });

  it('Ghost Vacuum: the creature cards it exiled come back as 1/1 Spirits with a flying counter', () => {
    const vacuum = card({
      name: 'Ghost Vacuum', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
      oracleText: '{T}: Exile target card from a graveyard.\n{6}, {T}, Sacrifice this artifact: Put each creature card exiled with this artifact onto the battlefield under your control with a flying counter on it. Each of them is a 1/1 Spirit in addition to its other types. Activate only as a sorcery.',
    });
    const ogre = creature('Ogre', 4, 4, { typeLine: 'Creature — Ogre' });
    let s = board({ mana: 6, mine: [vacuum] });
    s.players[1].graveyard = [{ iid: 'og', card: ogre }];
    // The bot doesn't sacrifice it with nothing exiled.
    expect(botAction(s)).not.toMatchObject({ type: 'activate', index: 1 });
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Ghost Vacuum'), index: 0, targets: [[{ kind: 'card', iid: 'og' }]] })));
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Ogre']);
    perm(s, 'Ghost Vacuum')!.tapped = false;
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Ghost Vacuum'), index: 1 })));
    const spirit = perm(s, 'Ogre')!;
    expect(spirit.controller).toBe(0);
    expect([powerOf(spirit), toughnessOf(spirit)]).toEqual([1, 1]);
    expect(spirit.card.typeLine).toBe('Creature — Ogre Spirit');
    expect(spirit.counters.flying).toBe(1);
    expect(hasKw(spirit, 'flying')).toBe(true);
  });

  const land = (type: string, n: number) => Array.from({ length: n }, () => card({ name: type, typeLine: `Basic Land — ${type}` }));

  it('Aang airbends a creature or a spell: exiled, its owner may cast it for {2}', () => {
    const aang = creature('Aang, Swift Savior', 2, 3, {
      typeLine: 'Legendary Creature — Human Avatar Ally', manaCost: '{1}{W}{U}', cmc: 3, colors: ['W', 'U'], keywords: ['Flash', 'Flying', 'Airbend', 'Waterbend'],
      oracleText: 'Flash\nFlying\nWhen Aang enters, airbend up to one other target creature or spell. (Exile it. While it\'s exiled, its owner may cast it for {2} rather than its mana cost.)\nWaterbend {8}: Transform Aang.',
    });
    const ogre = creature('Ogre', 4, 4, { manaCost: '{3}{B}{B}', cmc: 5 });
    let s = board({ mine: [...land('Plains', 1), ...land('Island', 2)], hand: [aang], theirs: [ogre] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 6 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] } }));
    const exiled = s.players[1].exile.find((c) => c.card.name === 'Ogre')!;
    expect(exiled.castFor).toEqual({ cost: '{2}' });
    expect(castSource(s, 1, exiled.iid)?.from).toBe('exile');
    expect(castCost(s, 1, ogre, { from: 'exile', iid: exiled.iid })).toEqual({ generic: 2, colored: [] });
    // A spell: the opponent's Bolt is exiled, not resolved.
    s = board({ mine: [...land('Plains', 1), ...land('Island', 2), bear], hand: [aang] });
    s.stack = [{ iid: 'x0', card: bolt, controller: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    s = apply(s, { type: 'cast', iid: 'h0' });
    for (let i = 0; i < 6 && !s.pending; i++) s = apply(s, { type: 'pass' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'spell', iid: 'x0' }]] } }));
    expect(perm(s, 'Bear')?.damage).toBe(0);
    expect(s.players[1].exile.find((c) => c.card.name === 'Bolt')?.castFor).toEqual({ cost: '{2}' });
  });

  it('Aven Interrupter plots a spell: free as a sorcery on a later turn ({2} more while it stays)', () => {
    const aven = creature('Aven Interrupter', 2, 2, {
      typeLine: 'Creature — Bird Rogue', manaCost: '{1}{W}{W}', cmc: 3, colors: ['W'], keywords: ['Flying', 'Plot', 'Flash'],
      oracleText: 'Flash\nFlying\nWhen this creature enters, exile target spell. It becomes plotted. (Its owner may cast it as a sorcery on a later turn without paying its mana cost.)\nSpells your opponents cast from graveyards or from exile cost {2} more to cast.',
    });
    let s = board({ mine: [...land('Plains', 3), bear], hand: [aven] });
    s.stack = [{ iid: 'x0', card: bolt, controller: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    s = apply(s, { type: 'cast', iid: 'h0' });
    for (let i = 0; i < 6 && !s.pending; i++) s = apply(s, { type: 'pass' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'spell', iid: 'x0' }]] } }));
    const plotted = s.players[1].exile.find((c) => c.card.name === 'Bolt')!;
    expect(plotted.castFor).toEqual({ cost: '', afterTurn: s.turn, sorcery: true });
    expect(castSource(s, 1, plotted.iid)).toBeNull();
    s.turn += 1;
    expect(castSource(s, 1, plotted.iid)?.from).toBe('exile');
    // Free, but Aven Interrupter's tax applies to its owner's opponent.
    expect(castCost(s, 1, bolt, { from: 'exile', iid: plotted.iid })).toEqual({ generic: 2, colored: [] });
  });

  it('Malcolm: a chorus counter and a loot; with four, the discarded card is cast for free', () => {
    const malcolm = creature('Malcolm, Alluring Scoundrel', 2, 1, {
      typeLine: 'Legendary Creature — Siren Pirate', manaCost: '{1}{U}', cmc: 2, colors: ['U'], keywords: ['Flying', 'Flash'],
      oracleText: 'Flash\nFlying\nWhenever Malcolm deals combat damage to a player, put a chorus counter on it. Draw a card, then discard a card. If there are four or more chorus counters on Malcolm, you may cast the discarded card without paying its mana cost.',
    });
    const divination = spell('Divination', '{2}{U}', 'Draw two cards.', 'Sorcery');
    let s = board({ mine: [malcolm], hand: [divination] });
    perm(s, 'Malcolm, Alluring Scoundrel')!.counters = { chorus: 3 };
    s = apply(s, { type: 'pass' }); // to combat
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = settle(apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Malcolm, Alluring Scoundrel')] }));
    for (let i = 0; i < 20 && !s.pending; i++) s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'discard' });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0'] } });
    expect(perm(s, 'Malcolm, Alluring Scoundrel')!.counters.chorus).toBe(4);
    expect(s.castNow).toEqual({ player: 0, iid: 'h0' });
    expect(castOptions(s, 0, 'h0')).toHaveLength(1);
    expect(castCost(s, 0, divination, { from: 'graveyard', iid: 'h0' })).toEqual({ generic: 0, colored: [] });
    const hand = s.players[0].hand.length;
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.players[0].hand.length).toBe(hand + 2);
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Divination']);
    // Passing instead: the chance is gone.
    expect(s.castNow).toBeUndefined();
  });

  it('Mystic Gate: with another land paying {W/U}, two mana in white and blue', () => {
    const gate = card({ name: 'Mystic Gate', typeLine: 'Land', oracleText: '{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.' });
    const sphinx = creature('Sphinx', 3, 3, { manaCost: '{W}{U}{U}', cmc: 3 });
    // Gate + Plains: {W}{U}, or {U}{U}; with an Island: {W}{U}{U}.
    let s = board({ mine: [gate, ...land('Plains', 1), ...land('Island', 1)], hand: [sphinx] });
    expect(castOptions(s, 0, 'h0')).toHaveLength(1);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.battlefield.filter((x) => x.controller === 0 && x.tapped).map((x) => x.card.name).sort()).toEqual(['Island', 'Mystic Gate', 'Plains']);
    expect(s.players[0].pool ?? []).toEqual([]);
    // Alone, it makes {C}.
    s = board({ mine: [gate], hand: [sphinx] });
    expect(unitsOf(s, perm(s, 'Mystic Gate')!)).toEqual([['C']]);
    s = board({ mine: [gate, ...land('Swamp', 1)] });
    expect(unitsOf(s, perm(s, 'Mystic Gate')!)).toEqual([['C']]);
  });

  it('Swift Reconfiguration: the enchanted creature is a Vehicle with crew 5 until the Aura leaves', () => {
    const swift = card({
      name: 'Swift Reconfiguration', typeLine: 'Enchantment — Aura', manaCost: '{W}', cmc: 1, colors: ['W'], keywords: ['Enchant', 'Flash'],
      oracleText: 'Flash\nEnchant creature or Vehicle\nEnchanted permanent is a Vehicle artifact with crew 5 and it loses all other card types. (It\'s not a creature unless it\'s crewed.)',
    });
    const ogre = creature('Ogre', 4, 4, { typeLine: 'Creature — Ogre' });
    let s = board({ mine: land('Plains', 1), hand: [swift], theirs: [ogre] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })));
    const vehicle = perm(s, 'Ogre')!;
    expect(perm(s, 'Swift Reconfiguration')!.attachedTo).toBe(vehicle.iid);
    expect(vehicle.card.typeLine).toBe('Artifact — Vehicle');
    expect(activatedOf(vehicle.card).some((a) => a.cost.crew === 5)).toBe(true);
    // The Aura leaves: a creature again, and the card that leaves is the Ogre as printed.
    s.battlefield = s.battlefield.filter((x) => x.card.name !== 'Swift Reconfiguration');
    s = apply(s, { type: 'pass' });
    expect(perm(s, 'Ogre')!.card.typeLine).toBe('Creature — Ogre');
    expect(perm(s, 'Ogre')!.reconfigured).toBeUndefined();
  });

  it('Reverent Mantra: a white card exiled instead; all creatures gain protection from the chosen color', () => {
    expect(castInfo(mantra).alts).toEqual([{ kind: 'exileCard', color: 'W' }]);
    const blackOgre = creature('Ogre', 3, 3, { colors: ['B'] });
    let s = board({ mine: [bear], theirs: [blackOgre], hand: [mantra, creature('Cat', 1, 1, { colors: ['W'] })] });
    s = settle(apply(s, { type: 'cast', iid: 'h0', alt: 0 }));
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    s = run(s);
    s = run(apply(s, { type: 'choose', answer: { kind: 'mode', modes: [2] } }));
    expect(perm(s, 'Bear')!.boosts.flatMap((b) => b.protection ?? [])).toEqual(['B']);
    expect(perm(s, 'Ogre')!.boosts.flatMap((b) => b.protection ?? [])).toEqual(['B']);
    // The black Ogre can't block a creature with protection from black.
    expect(canBlock(perm(s, 'Ogre')!, perm(s, 'Bear')!)).toBe(false);
  });
});

describe('Aang deck, batch 5: transform and prepared', () => {
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const land = (type: string, n: number) => Array.from({ length: n }, () => card({ name: type, typeLine: `Basic Land — ${type}` }));
  const bear = creature('Bear', 2, 2, { typeLine: 'Creature — Bear' });
  const dfc = (front: Partial<Card> & { name: string }, back: { name: string; typeLine: string; oracleText: string; power?: string; toughness?: string; manaCost?: string }, layout: string) => card({
    ...front, name: `${front.name} // ${back.name}`, layout,
    faces: [
      { name: front.name, manaCost: front.manaCost ?? '', typeLine: front.typeLine ?? '', oracleText: front.oracleText ?? '', power: front.power, toughness: front.toughness },
      { manaCost: '', ...back },
    ],
    oracleText: `${front.oracleText}\n//\n${back.oracleText}`, typeLine: `${front.typeLine} // ${back.typeLine}`,
  });
  const aang = dfc({
    name: 'Aang, Swift Savior', manaCost: '{1}{W}{U}', cmc: 3, typeLine: 'Legendary Creature — Human Avatar Ally', power: '2', toughness: '3', colors: ['W', 'U'],
    keywords: ['Flying', 'Reach', 'Airbend', 'Transform', 'Trample', 'Flash', 'Waterbend'],
    oracleText: 'Flash\nFlying\nWhen Aang enters, airbend up to one other target creature or spell. (Exile it. While it\'s exiled, its owner may cast it for {2} rather than its mana cost.)\nWaterbend {8}: Transform Aang.',
  }, { name: 'Aang and La, Ocean\'s Fury', typeLine: 'Legendary Creature — Avatar Spirit Ally', power: '5', toughness: '5', oracleText: 'Reach, trample\nWhenever Aang and La attack, put a +1/+1 counter on each tapped creature you control.' }, 'transform');
  const tchalla = dfc({
    name: 'King T\'Challa', manaCost: '{1}{W}{U}', cmc: 3, typeLine: 'Legendary Creature — Human Noble Hero', power: '3', toughness: '2', colors: ['W', 'U'], keywords: ['Transform', 'Double strike', 'Flash'],
    oracleText: 'Flash\nWhenever a player draws their second card each turn, you draw a card.\n{4}{W}{U}: Transform King T\'Challa. Activate only as a sorcery.',
  }, { name: 'Black Panther, Hope Enduring', manaCost: '{4}{W}{U}', typeLine: 'Legendary Creature — Human Warrior Hero', power: '3', toughness: '3', oracleText: 'Flash\nDouble strike\nPrevent all damage that would be dealt to Black Panther.\nWhenever Black Panther deals combat damage to a player, draw a card.' }, 'modal_dfc');
  const skycoach = dfc({
    name: 'Skycoach Conductor', manaCost: '{2}{U}', cmc: 3, typeLine: 'Creature — Bird Pilot', power: '2', toughness: '3', colors: ['U'], keywords: ['Flying', 'Vigilance', 'Prepared', 'Flash'],
    oracleText: 'Flash\nFlying, vigilance\nThis creature enters prepared. (While it\'s prepared, you may cast a copy of its spell. Doing so unprepares it.)',
  }, { name: 'All Aboard', manaCost: '{U}', typeLine: 'Instant', oracleText: 'Exile target non-Pilot creature you control, then return that card to the battlefield under its owner\'s control.' }, 'prepare');

  it('Aang: waterbend {8} with creatures tapped to pay; Aang and La put counters on tapped creatures', () => {
    const mine = [aang, ...land('Plains', 4), ...Array.from({ length: 4 }, (_, i) => creature(`Cat ${i}`, 1, 1))];
    let s = board({ mine });
    expect(activatedOf(aang)[0].cost).toMatchObject({ mana: '{8}', waterbend: true });
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Aang, Swift Savior // Aang and La, Ocean\'s Fury'), index: 0 })));
    const la = s.battlefield.find((x) => x.card.name === 'Aang and La, Ocean\'s Fury')!;
    expect(la.transformed).toBe(true);
    expect([powerOf(la), hasKw(la, 'trample'), hasKw(la, 'reach')]).toEqual([5, true, true]);
    expect(s.battlefield.filter((x) => x.card.name.startsWith('Cat')).every((x) => x.tapped)).toBe(true);
    // Its attack trigger: a counter on each tapped creature (the four Cats and itself, tapped by attacking).
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = run(settle(apply(s, { type: 'declareAttackers', attackers: [la.iid] })));
    expect(s.battlefield.filter((x) => x.controller === 0 && isCreature(x.card)).map((x) => x.counters['+1/+1'])).toEqual([1, 1, 1, 1, 1]);
  });

  it('King T\'Challa transforms at sorcery speed; Black Panther takes no damage', () => {
    let s = board({ mine: [tchalla, ...land('Plains', 3), ...land('Island', 3)] });
    const iid = iidOf(s, 'King T\'Challa // Black Panther, Hope Enduring');
    s = run(settle(apply(s, { type: 'activate', iid, index: 0 })));
    const panther = findPermanent(s, iid)!;
    expect(panther.card.name).toBe('Black Panther, Hope Enduring');
    expect(hasKw(panther, 'double strike')).toBe(true);
    const shock = spell('Shock', '{R}', 'Shock deals 2 damage to any target.');
    s.stack = [{ iid: 'x0', card: shock, controller: 1, targets: [[{ kind: 'permanent', iid }]] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    s = run(s);
    expect(findPermanent(s, iid)!.damage).toBe(0);
  });

  it('Skycoach Conductor enters prepared: a copy of All Aboard blinks a non-Pilot creature, once', () => {
    let s = board({ mine: [...land('Island', 4), bear], hand: [skycoach] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0' })));
    const conductor = s.battlefield.find((x) => x.card.name.startsWith('Skycoach'))!;
    expect(conductor.prepared).toBe(true);
    expect(castOptions(s, 0, conductor.iid)).toEqual([{ face: 0, kicked: false, from: 'prepared' }]);
    perm(s, 'Bear')!.damage = 1;
    const slot = spellSpec(castSource(s, 0, conductor.iid)!.inst.card).targets[0];
    // Not a Pilot.
    expect(isLegalTarget(s, 0, slot, { kind: 'permanent', iid: conductor.iid })).toBe(false);
    s = run(settle(apply(s, { type: 'cast', iid: conductor.iid, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(perm(s, 'Bear')!.damage).toBe(0);
    expect(perm(s, 'Bear')!.sick).toBe(true);
    expect(findPermanent(s, conductor.iid)!.prepared).toBe(false);
    expect(castOptions(s, 0, conductor.iid)).toEqual([]);
    // The copy ceased to exist: nothing in the graveyard.
    expect(s.players[0].graveyard).toEqual([]);
  });

  it('Get Lost: the destroyed creature\'s controller creates two Map tokens; a Map makes a creature explore', () => {
    const getLost = spell('Get Lost', '{1}{W}', 'Destroy target creature, enchantment, or planeswalker. Its controller creates two Map tokens. (They\'re artifacts with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.")');
    const ogre = creature('Ogre', 3, 3);
    let s = board({ mine: land('Plains', 2), hand: [getLost], theirs: [ogre] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })));
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(s.battlefield.filter((x) => x.card.name === 'Map').map((x) => x.controller)).toEqual([1, 1]);
    // Explore: a land goes to the hand.
    const map = tokenCard(PREDEFINED_TOKENS.map);
    s = board({ mana: 2, mine: [map, map, bear] });
    const sorcery = spell('Divination', '{2}{U}', 'Draw two cards.', 'Sorcery');
    s.players[0].library = [{ iid: 'l0', card: land('Island', 1)[0] }, { iid: 'l1', card: sorcery }, ...s.players[0].library];
    const maps = s.battlefield.filter((x) => x.card.name === 'Map').map((x) => x.iid);
    s = run(settle(apply(s, { type: 'activate', iid: maps[0], index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Island']);
    expect(perm(s, 'Bear')!.counters['+1/+1']).toBeUndefined();
    // Not a land: a +1/+1 counter, and the card may go to the graveyard.
    s = run(settle(apply(s, { type: 'activate', iid: maps[1], index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] })));
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'exploreMill' });
    s = run(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(perm(s, 'Bear')!.counters['+1/+1']).toBe(1);
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Divination');
  });
});

describe('choosing the mana to pay with', () => {
  const plains = card({ name: 'Plains', typeLine: 'Basic Land — Plains' });
  const island = card({ name: 'Island', typeLine: 'Basic Land — Island' });
  const knight = creature('Knight', 2, 2, { manaCost: '{1}{W}', cmc: 2 });

  it('pays with the sources chosen, or says they are not enough', () => {
    let s = board({ mine: [plains, plains, island], hand: [knight] });
    const [p1, p2, i1] = s.battlefield.map((x) => x.iid);
    const payment = paymentFor(s, 0, { type: 'cast', iid: 'h0' })!;
    expect(payment.cost).toEqual({ generic: 1, colored: [['W']] });
    expect(payment.sources.map((m) => m.iid)).toEqual([p1, p2, i1]);
    // Two Plains, the Island kept: the engine would have tapped the Island for the {1}.
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', pay: [p1, i1] }))).toBeNull();
    s = apply(s, { type: 'cast', iid: 'h0', pay: [p1, p2] });
    expect(s.battlefield.filter((x) => x.tapped).map((x) => x.iid)).toEqual([p1, p2]);
    // Not enough with the Island alone.
    s = board({ mine: [plains, island], hand: [knight] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', pay: [s.battlefield[1].iid] }))).toBe('chosenManaShort');
  });
});

describe('layers: base power and toughness, abilities lost until end of turn', () => {
  const multiply = spell('Multiply by Zero', '{1}{B}', 'Target creature has base power and toughness 0/0 until end of turn.');
  const blackSun = spell('Day of Black Sun', '{X}{B}{B}', 'Each creature with mana value X or less loses all abilities until end of turn. Destroy those creatures.', 'Sorcery');
  const sheriff = spell('Shoot the Sheriff', '{1}{B}', 'Destroy target non-outlaw creature. (Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws. Everyone else is fair game.)');
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Multiply by Zero: base 0/0, +1/+1 counters and pumps still apply on top', () => {
    const ogre = creature('Ogre', 4, 4, { manaCost: '{3}{B}', cmc: 4 });
    let s = board({ mana: 2, hand: [multiply], theirs: [ogre] });
    perm(s, 'Ogre')!.counters = { '+1/+1': 1 };
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })));
    expect([powerOf(perm(s, 'Ogre')!), toughnessOf(perm(s, 'Ogre')!)]).toEqual([1, 1]);
    // Without the counter it dies (0 toughness).
    s = board({ mana: 2, hand: [multiply], theirs: [ogre] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })));
    expect(perm(s, 'Ogre')).toBeUndefined();
  });

  it('Day of Black Sun: creatures with mana value X or less lose their abilities, then are destroyed', () => {
    const wall = creature('Wall', 0, 4, { manaCost: '{1}', cmc: 1, keywords: ['Indestructible'], oracleText: 'Indestructible' });
    const bear = creature('Bear', 2, 2, { manaCost: '{1}{G}', cmc: 2 });
    const dragon = creature('Dragon', 5, 5, { manaCost: '{4}{R}', cmc: 5 });
    let s = board({ mana: 4, hand: [blackSun], theirs: [wall, bear, dragon] });
    s = run(settle(apply(s, { type: 'cast', iid: 'h0', x: 2 })));
    // The Wall lost indestructible first: destroyed too. The Dragon (mana value 5) stays.
    expect(s.battlefield.filter((x) => x.controller === 1 && isCreature(x.card)).map((x) => x.card.name)).toEqual(['Dragon']);
    expect(s.players[1].graveyard.map((c) => c.card.name).sort()).toEqual(['Bear', 'Wall']);
  });

  it('Shoot the Sheriff can\'t target outlaws', () => {
    const rogue = creature('Rogue', 2, 2, { typeLine: 'Creature — Human Rogue' });
    const bear = creature('Bear', 2, 2, { typeLine: 'Creature — Bear' });
    const s = board({ theirs: [rogue, bear] });
    const slot = spellSpec(sheriff).targets[0];
    expect(['Rogue', 'Bear'].map((n) => isLegalTarget(s, 0, slot, { kind: 'permanent', iid: iidOf(s, n) }))).toEqual([false, true]);
  });
});

describe('online: stops decided from public information', () => {
  const bear = creature('Bear', 2, 2, { manaCost: '{B}', cmc: 1 });
  const instant = spell('Opt', '{U}', 'Draw a card.');
  const sorcery = spell('Divination', '{2}{U}', 'Draw two cards.', 'Sorcery');
  /** Does the opponent get a stop when Bear is cast? */
  const stops = (hand: Card[], publicStops: boolean, oppMana = 1) => {
    let s = board({ mana: 1, hand: [bear], oppHand: hand, oppMana });
    if (publicStops) s.publicStops = true;
    s = apply(s, { type: 'cast', iid: 'h0' });
    return s.priority?.player === 1 && s.stack.length === 1;
  };

  it('stops the same with an instant or a sorcery in hand', () => {
    // Offline (vs the bot): only with something to cast.
    expect([stops([instant], false), stops([sorcery], false)]).toEqual([true, false]);
    // Online: cards in hand and mana open: a stop either way; no mana or no cards: no stop.
    expect([stops([instant], true), stops([sorcery], true)]).toEqual([true, true]);
    expect([stops([instant], true, 0), stops([], true)]).toEqual([false, false]);
  });
});

describe('bot mana planning', () => {
  const land = (type: string, n: number) => Array.from({ length: n }, () => card({ name: type, typeLine: `Basic Land — ${type}` }));
  const toMain2 = (s: GameState) => {
    s.step = 'main2';
    return s;
  };

  it('casts a ritual when its mana makes a spell in hand affordable', () => {
    const ritual = spell('Dark Ritual', '{B}', 'Add {B}{B}{B}.');
    const ogre = creature('Ogre', 4, 4, { manaCost: '{3}{B}', cmc: 4 });
    let s = toMain2(board({ mana: 2, hand: [ritual, ogre] }));
    expect(botAction(s)).toMatchObject({ type: 'cast', iid: 'h0' });
    // Nothing to enable: the ritual stays in hand.
    s = toMain2(board({ mana: 2, hand: [ritual, creature('Bear', 2, 2, { manaCost: '{1}{B}', cmc: 2 })] }));
    expect(botAction(s)).toMatchObject({ type: 'cast', iid: 'h1' });
  });

  it('keeps mana for a counterspell unless the play is bigger', () => {
    const counter = spell('Counterspell', '{U}{U}', 'Counter target spell.');
    const bear = creature('Bear', 2, 2, { manaCost: '{1}{U}', cmc: 2 });
    const sphinx = creature('Sphinx', 4, 4, { manaCost: '{2}{U}{U}', cmc: 4 });
    // Three Islands: the Bear would leave {U}: held.
    let s = toMain2(board({ mine: land('Island', 3), hand: [counter, bear], oppHand: [bear] }));
    expect(botAction(s)).toEqual({ type: 'pass' });
    // Four Islands: Bear and Counterspell both fit.
    s = toMain2(board({ mine: land('Island', 4), hand: [counter, bear], oppHand: [bear] }));
    expect(botAction(s)).toMatchObject({ type: 'cast', iid: 'h1' });
    // The Sphinx costs more than the counter: cast.
    s = toMain2(board({ mine: land('Island', 4), hand: [counter, sphinx], oppHand: [bear] }));
    expect(botAction(s)).toMatchObject({ type: 'cast', iid: 'h1' });
    // The opponent has no cards: nothing to counter.
    s = toMain2(board({ mine: land('Island', 3), hand: [counter, bear] }));
    expect(botAction(s)).toMatchObject({ type: 'cast', iid: 'h1' });
  });

  it('holds flash creatures for the end of the opponent\'s turn', () => {
    const flash = creature('Snapcaster', 2, 1, { manaCost: '{1}{U}', cmc: 2, keywords: ['Flash'], oracleText: 'Flash' });
    let s = toMain2(board({ mine: land('Island', 2), hand: [flash] }));
    expect(botAction(s)).toEqual({ type: 'pass' });
    // The opponent's end step: cast.
    s = board({ theirs: land('Island', 2), oppHand: [flash] });
    s.priority = { player: 1, passes: 0, reason: 'end' };
    expect(botAction(s)).toMatchObject({ type: 'cast', iid: 'o0' });
  });
});

describe('look at the top cards: Sleight of Hand, Flow State', () => {
  const sleight = spell('Sleight of Hand', '{U}', 'Look at the top two cards of your library. Put one of them into your hand and the other on the bottom of your library.', 'Sorcery');
  const flow = spell('Flow State', '{1}{U}', 'Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order. If there is an instant card and a sorcery card in your graveyard, instead put two of them into your hand and the rest on the bottom of your library in any order.', 'Sorcery');
  const islands = (n: number) => Array.from({ length: n }, () => card({ name: 'Island', typeLine: 'Basic Land — Island' }));
  const named = (name: string, typeLine = 'Sorcery') => card({ name, typeLine, manaCost: '{1}', cmc: 1 });
  const cast = (hand: Card[], grave: Card[] = []) => {
    let s = board({ mine: islands(2), hand, grave });
    s.players[0].library = [...['A', 'B', 'C'].map((n, i) => ({ iid: `l${i}`, card: named(n) })), ...s.players[0].library];
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 6 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Sleight of Hand: one of two into the hand, the other on the bottom', () => {
    let s = cast([sleight]);
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'dig', min: 1, max: 1 });
    const options = (s.pending!.choice as { options: { iid: string; card: Card }[] }).options;
    expect(options.map((c) => c.card.name)).toEqual(['A', 'B']);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [options[1].iid] } });
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['B']);
    expect(s.players[0].library.at(-1)!.card.name).toBe('A');
  });

  it('Flow State: two cards with an instant and a sorcery in the graveyard', () => {
    expect(cast([flow]).pending?.choice).toMatchObject({ purpose: 'dig', max: 1 });
    expect(cast([flow], [named('Opt', 'Instant'), named('Ponder')]).pending?.choice).toMatchObject({ purpose: 'dig', max: 2 });
  });
});

describe('reflexive costs, stun and finality counters', () => {
  const land = (type: string, n: number) => Array.from({ length: n }, () => card({ name: type, typeLine: `Basic Land — ${type}` }));
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const toTrigger = (s: GameState) => {
    for (let i = 0; i < 8 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Ruthless Lawbringer: sacrifice another creature, then destroy a nonland permanent', () => {
    const lawbringer = creature('Ruthless Lawbringer', 3, 2, {
      typeLine: 'Creature — Vampire Assassin', manaCost: '{1}{W}{B}', cmc: 3,
      oracleText: 'When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent.',
    });
    const ogre = creature('Ogre', 4, 4, { cmc: 4 });
    let s = board({ mana: 2, mine: [...land('Plains', 1), creature('Squire', 1, 1)], hand: [lawbringer], theirs: [ogre] });
    s = toTrigger(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'reflexiveSacrifice' });
    expect((s.pending!.choice as { options: { card: Card }[] }).options.map((c) => c.card.name)).toEqual(['Squire']);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Squire')] } });
    s = toTrigger(s);
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] } }));
    expect([perm(s, 'Squire'), perm(s, 'Ogre')]).toEqual([undefined, undefined]);
  });

  it('Snaremaster Sprite: a stun counter keeps the creature tapped through one untap step', () => {
    const sprite = creature('Snaremaster Sprite', 1, 1, {
      typeLine: 'Creature — Faerie Wizard', manaCost: '{U}', cmc: 1, keywords: ['Flying'],
      oracleText: 'Flying\nWhen this creature enters, you may pay {2}. When you do, tap target creature an opponent controls and put a stun counter on it. (If a permanent with a stun counter would become untapped, remove one from it instead.)',
    });
    const ogre = creature('Ogre', 4, 4);
    let s = board({ mine: land('Island', 3), hand: [sprite], theirs: [ogre] });
    s = toTrigger(settle(apply(s, { type: 'cast', iid: 'h0' })));
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'reflexivePay' });
    s = toTrigger(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    s = run(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] } }));
    expect(perm(s, 'Ogre')).toMatchObject({ tapped: true, counters: { stun: 1 } });
    // The opponent's untap step: the counter goes, the Ogre stays tapped.
    for (let i = 0; i < 40 && s.active === 0; i++) s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } }) : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    expect(perm(s, 'Ogre')).toMatchObject({ tapped: true, counters: { stun: 0 } });
  });

  it('Zoraline: a Bat attacking gains life; the returned card has a finality counter (exiled if it dies)', () => {
    const zoraline = creature('Zoraline, Cosmos Caller', 3, 3, {
      typeLine: 'Legendary Creature — Bat Cleric', manaCost: '{1}{W}{B}', cmc: 3, keywords: ['Flying', 'Vigilance'],
      oracleText: 'Flying, vigilance\nWhenever a Bat you control attacks, you gain 1 life.\nWhenever Zoraline enters or attacks, you may pay {W}{B} and 2 life. When you do, return target nonland permanent card with mana value 3 or less from your graveyard to the battlefield with a finality counter on it.',
    });
    const triggers = triggersOf(zoraline);
    expect(triggers[0].ability.effects.map((e) => e.kind)).toEqual(['gainLife']);
    const reflexive = triggers[1].ability.effects[0];
    expect(reflexive.kind === 'reflexive' && reflexive.then.effects[0]).toMatchObject({ kind: 'returnCard', dest: 'battlefield', finality: true });
    // A returned creature with a finality counter is exiled when it dies.
    const bear = creature('Bear', 2, 2, { cmc: 2 });
    let s = board({ mine: [...land('Plains', 1), ...land('Swamp', 1), zoraline], grave: [bear] });
    s.stack = [{ iid: 'x0', card: zoraline, controller: 0, targets: [], ability: reflexive.kind === 'reflexive' ? reflexive.then : undefined, source: iidOf(s, 'Zoraline, Cosmos Caller') }];
    s.stack[0].targets = [[{ kind: 'card', iid: 'g0' }]];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    s = run(s);
    expect(perm(s, 'Bear')!.counters.finality).toBe(1);
    const shock = spell('Shock', '{R}', 'Shock deals 2 damage to any target.');
    s.stack = [{ iid: 'x1', card: shock, controller: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    s = run(s);
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Bear']);
  });
});

describe('Overlord of the Balemurk: impending, mill then return a card', () => {
  const overlord = creature('Overlord of the Balemurk', 5, 5, {
    typeLine: 'Enchantment Creature — Avatar Horror', manaCost: '{3}{B}{B}', cmc: 5, keywords: ['Impending', 'Mill'],
    oracleText: 'Impending 5—{1}{B} (If you cast this spell for its impending cost, it enters with five time counters and isn\'t a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\nWhenever this permanent enters or attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.',
  });

  it('cast for {1}{B}: five time counters, not a creature; mills four and returns a creature card', () => {
    let s = board({ mana: 2, hand: [overlord] });
    const ogre = creature('Ogre', 3, 3);
    const avatar = creature('Avatar', 3, 3, { typeLine: 'Creature — Avatar' });
    s.players[0].library = [ogre, avatar, spell('Opt', '{U}', 'Draw a card.'), swamp].map((c, i) => ({ iid: `l${i}`, card: c }));
    expect(castOptions(s, 0, 'h0').map((o) => o.alt)).toEqual([0]);
    s = settle(apply(s, { type: 'cast', iid: 'h0', alt: 0 }));
    for (let i = 0; i < 8 && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    const o = perm(s, 'Overlord of the Balemurk')!;
    expect(o.counters.time).toBe(5);
    expect(isCreature(o.card)).toBe(false);
    expect(s.players[0].graveyard).toHaveLength(4);
    // Only the Ogre: the Avatar is excluded, the others aren't creatures or planeswalkers.
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'returnFromGraveyard', min: 0, max: 1 });
    expect((s.pending!.choice as { options: { card: Card }[] }).options.map((c) => c.card.name)).toEqual(['Ogre']);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } });
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Ogre']);
    // The end step: a time counter removed.
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    s = apply(s, { type: 'pass' });
    expect(perm(s, 'Overlord of the Balemurk')!.counters.time).toBe(4);
    // The last one: a creature again.
    const last = perm(s, 'Overlord of the Balemurk')!;
    last.counters.time = 1;
    s.active = 0;
    s.step = 'main2';
    s.priority = null;
    s = apply(s, { type: 'pass' });
    expect(isCreature(perm(s, 'Overlord of the Balemurk')!.card)).toBe(true);
  });
});

describe('Spree and Tiered: modes with their own costs', () => {
  const threeSteps = spell('Three Steps Ahead', '{U}', 'Spree (Choose one or more additional costs.)\n+ {1}{U} — Counter target spell.\n+ {3} — Create a token that\'s a copy of target artifact or creature you control.\n+ {2} — Draw two cards, then discard a card.');
  const fireMagic = spell('Fire Magic', '{R}', 'Tiered (Choose one additional cost.)\n• Fire — {0} — Fire Magic deals 1 damage to each creature.\n• Fira — {2} — Fire Magic deals 2 damage to each creature.\n• Firaga — {5} — Fire Magic deals 3 damage to each creature.');
  const islands = (n: number) => Array.from({ length: n }, () => card({ name: 'Island', typeLine: 'Basic Land — Island' }));
  const mountains = (n: number) => Array.from({ length: n }, () => card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' }));

  it('costs the mana cost plus the modes chosen', () => {
    const s = board({ mine: islands(3), hand: [threeSteps] });
    expect(castInfo(threeSteps).modal).toMatchObject({ min: 1, max: 3, costs: ['{1}{U}', '{3}', '{2}'] });
    expect(castCost(s, 0, threeSteps, { modes: [2] })).toEqual({ generic: 2, colored: [['U']] });
    expect(castCost(s, 0, threeSteps, { modes: [0, 2] })).toEqual({ generic: 3, colored: [['U'], ['U']] });
    // Three Islands: drawing ({U} + {2}) is fine; counter and draw ({U}{1}{U}{2}) isn't.
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [2] }))).toBeNull();
    s.stack = [{ iid: 'x0', card: creature('Ogre', 3, 3), controller: 1, targets: [] }];
    s.priority = { player: 0, passes: 0, reason: 'main' };
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [0, 2], targets: [[{ kind: 'spell', iid: 'x0' }]] }))).toBe('notEnoughMana');
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [0], targets: [[{ kind: 'spell', iid: 'x0' }]] }))).toBeNull();
  });

  it('Tiered: one mode, its cost added (Fira: {R} + {2})', () => {
    const bear = creature('Bear', 2, 2);
    let s = board({ mine: mountains(3), hand: [fireMagic], theirs: [bear] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [2] }))).toBe('notEnoughMana');
    s = settle(apply(s, { type: 'cast', iid: 'h0', modes: [1] }));
    for (let i = 0; i < 8 && s.stack.length; i++) s = settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.battlefield.filter((x) => !x.tapped)).toHaveLength(0);
  });

  it('the bot only picks modes it can pay for', () => {
    const bear = creature('Bear', 2, 2);
    const s = board({ mine: mountains(3), hand: [fireMagic], theirs: [bear, bear] });
    const action = botAction(s) as { type: string; modes?: number[] };
    expect(action.type === 'pass' || action.modes?.every((m) => m < 2)).toBe(true);
    expect(errorOf(() => apply(s, botAction(s)))).toBeNull();
  });
});


describe('metagame audit 2026-10-17', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  /** From main phase 1: attack with `names` (planeswalker targets by name), then to main phase 2. */
  const combat = (s: GameState, names: string[], walkers: Record<string, string> = {}) => {
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    const targets = Object.fromEntries(Object.entries(walkers).map(([a, w]) => [iidOf(s, a), iidOf(s, w)]));
    s = settle(apply(s, { type: 'declareAttackers', attackers: names.map((n) => iidOf(s, n)), ...(walkers ? { targets } : {}) }));
    for (let i = 0; i < 20 && s.step !== 'main2' && s.winner === null && !s.pending; i++) {
      s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    return s;
  };
  const frog = card({
    name: 'Psychic Frog', typeLine: 'Creature — Frog', manaCost: '{U}{B}', cmc: 2, power: '1', toughness: '3',
    oracleText: 'Whenever this creature deals combat damage to a player or planeswalker, draw a card.\nDiscard a card: Put a +1/+1 counter on this creature.\nExile three cards from your graveyard: This creature gains flying until end of turn.',
  });
  const walker = card({ name: 'Teferi', typeLine: 'Legendary Planeswalker — Teferi', manaCost: '{2}{W}{U}', cmc: 4, loyalty: '4', oracleText: '+1: Draw a card.' });

  it('Psychic Frog: discard for a counter, exile three for flying, draws on combat damage', () => {
    const [discard, exile] = activatedOf(frog);
    expect(discard.cost).toMatchObject({ discard: 1, mana: '', tap: false });
    expect(exile.cost).toMatchObject({ exileFromGraveyard: {}, exileCount: 3 });
    expect(triggersOf(frog).map((t) => t.event.on)).toEqual(['combatDamage', 'combatDamageWalker']);

    let s = board({ mine: [frog], hand: [swamp, island], grave: [swamp, swamp] });
    // Two cards in the graveyard: not enough to exile three.
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Psychic Frog'), index: 1 }))).toBe('nothingToExile');
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Psychic Frog'), index: 0 });
    expect(s.pending?.choice).toMatchObject({ purpose: 'discardCost', min: 1, max: 1, params: { ability: 1 } });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } }));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Swamp']);
    expect(perm(s, 'Psychic Frog')!.counters['+1/+1']).toBe(1);
    // Three cards now: flying.
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Psychic Frog'), index: 1 });
    expect(s.pending?.choice).toMatchObject({ purpose: 'exileCost', min: 3, max: 3 });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: s.players[0].graveyard.map((c) => c.iid) } }));
    expect(s.players[0].graveyard).toHaveLength(0);
    expect(s.players[0].exile).toHaveLength(3);
    expect(hasKw(perm(s, 'Psychic Frog')!, 'flying')).toBe(true);
    // Combat damage to the player draws.
    const hand = s.players[0].hand.length;
    s = resolve(combat(s, ['Psychic Frog']));
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].hand.length).toBe(hand + 1);
  });

  it('Psychic Frog draws on combat damage to a planeswalker too', () => {
    let s = board({ mine: [frog], theirs: [walker] });
    perm(s, 'Teferi')!.counters = { loyalty: 4 };
    s = resolve(combat(s, ['Psychic Frog'], { 'Psychic Frog': 'Teferi' }));
    expect(perm(s, 'Teferi')!.counters.loyalty).toBe(3);
    expect(s.players[0].hand).toHaveLength(1);
  });

  const crab = card({
    name: 'Eddymurk Crab', typeLine: 'Creature — Elemental Crab', manaCost: '{5}{U}{U}', cmc: 7, power: '5', toughness: '5', keywords: ['Flash'],
    oracleText: 'Flash\nThis spell costs {1} less to cast for each instant and sorcery card in your graveyard.\nThis creature enters tapped if it\'s not your turn.\nWhen this creature enters, tap up to two target creatures.',
  });
  const emrakul = card({
    name: 'Emrakul, the Promised End', typeLine: 'Legendary Creature — Eldrazi', manaCost: '{13}', cmc: 13, power: '13', toughness: '13', keywords: ['Flying', 'Protection', 'Trample'],
    oracleText: 'This spell costs {1} less to cast for each card type among cards in your graveyard.\nWhen you cast this spell, you gain control of target opponent during that player\'s next turn. After that turn, that player takes an extra turn.\nFlying, trample, protection from instants',
  });

  it('Eddymurk Crab and Emrakul cost less for the cards in the graveyard', () => {
    const bolt = spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.');
    const think = spell('Think', '{U}', 'Draw a card.', 'Sorcery');
    const bear = creature('Bear', 2, 2);
    const s = board({ grave: [bolt, think, bolt, bear, swamp] });
    // Three instant and sorcery cards: {2}{U}{U}.
    expect(castCost(s, 0, crab, {})).toEqual({ generic: 2, colored: [['U'], ['U']] });
    // Instant, sorcery, creature, land: four types, {9}.
    expect(castCost(s, 0, emrakul, {})).toEqual({ generic: 9, colored: [] });
    expect(castCost(board({}), 0, emrakul, {}).generic).toBe(13);
  });

  it('enters tapped: not on your turn, a fast land worded the other way, two or more opponents', () => {
    const lair = card({ name: 'Lair of the Hydra', typeLine: 'Land', oracleText: 'If you control two or more other lands, this land enters tapped.\n{T}: Add {G}.\n{X}{G}: Until end of turn, this land becomes an X/X green Hydra creature. It\'s still a land. X can\'t be 0.' });
    const springs = card({ name: 'Rejuvenating Springs', typeLine: 'Land', oracleText: 'This land enters tapped unless you have two or more opponents.\n{T}: Add {G} or {U}.' });
    expect(entersTappedRule(crab)).toEqual({ kind: 'notYourTurn' });
    expect(entersTappedRule(lair)).toEqual({ kind: 'unlessOtherLands', max: 1 });
    expect(entersTappedRule(springs)).toEqual({ kind: 'unlessOpponents', n: 2 });
    const play = (lands: number, c: Card) => perm(apply(board({ mana: lands, hand: [c] }), { type: 'playLand', iid: 'h0' }), c.name)!.tapped;
    expect(play(1, lair)).toBe(false);
    expect(play(2, lair)).toBe(true);
    // One opponent: tapped.
    expect(play(0, springs)).toBe(true);
    // On its controller's turn, the Crab enters untapped.
    let s = board({ mine: [], hand: [crab], grave: [spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.')] });
    s.battlefield = Array.from({ length: 6 }, (_, i): Permanent => ({ iid: `i${i}`, card: island, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] }));
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    if (s.pending) s = resolve(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[]] } as never }));
    expect(perm(s, 'Eddymurk Crab')?.tapped).toBe(false);
  });

  it('Sunspine Lynx: players can\'t gain life, damage can\'t be prevented', () => {
    const lynx = card({
      name: 'Sunspine Lynx', typeLine: 'Creature — Elemental Cat', manaCost: '{2}{R}{R}', cmc: 4, power: '5', toughness: '4',
      oracleText: 'Players can\'t gain life.\nDamage can\'t be prevented.\nWhen this creature enters, it deals damage to each player equal to the number of nonbasic lands that player controls.',
    });
    const heal = spell('Heal', '{B}', 'You gain 3 life.');
    const fog = spell('Fog', '{B}', 'Prevent all combat damage that would be dealt this turn.');
    let s = resolve(apply(board({ mana: 1, hand: [heal], mine: [lynx] }), { type: 'cast', iid: 'h0' }));
    expect(s.players[0].life).toBe(20);
    s = resolve(apply(board({ mana: 1, hand: [heal] }), { type: 'cast', iid: 'h0' }));
    expect(s.players[0].life).toBe(23);
    // A Fog doesn't stop the Lynx's damage.
    s = board({ mana: 1, hand: [fog], mine: [lynx] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.preventCombat).toBe(true);
    s = combat(s, ['Sunspine Lynx']);
    expect(s.players[1].life).toBe(15);
  });

  it('Exalted Angel gains the damage it deals, as lifelink', () => {
    const angel = card({
      name: 'Exalted Angel', typeLine: 'Creature — Angel', manaCost: '{4}{W}{W}', cmc: 6, power: '4', toughness: '5', keywords: ['Flying', 'Morph'],
      oracleText: 'Flying\nWhenever this creature deals damage, you gain that much life.\nMorph {2}{W}{W} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)',
    });
    const s = combat(board({ mine: [angel] }), ['Exalted Angel']);
    expect(s.players[1].life).toBe(16);
    expect(s.players[0].life).toBe(24);
    expect(hasKeyword(creature('Bear', 2, 2, { oracleText: 'Whenever another creature deals damage, you gain that much life.' }), 'lifelink')).toBe(false);
  });

  it('Cryptolith Rite: creatures you control tap for any color, once they can attack', () => {
    const rite = card({ name: 'Cryptolith Rite', typeLine: 'Enchantment', manaCost: '{1}{G}', cmc: 2, oracleText: 'Creatures you control have "{T}: Add one mana of any color."' });
    const s = board({ mine: [rite, creature('Bear', 2, 2)], theirs: [creature('Ogre', 3, 3)] });
    expect(unitsOf(s, perm(s, 'Bear')!)).toEqual([['W', 'U', 'B', 'R', 'G']]);
    expect(canTapForMana(s, perm(s, 'Bear')!)).toBe(true);
    // The opponent's creatures don't get it.
    expect(unitsOf(s, perm(s, 'Ogre')!)).toEqual([]);
    perm(s, 'Bear')!.sick = true;
    expect(canTapForMana(s, perm(s, 'Bear')!)).toBe(false);
  });

  it('Iron-Shield Elf: discard a card, indestructible, and it taps', () => {
    const elf = card({
      name: 'Iron-Shield Elf', typeLine: 'Creature — Elf Warrior', manaCost: '{1}{B}', cmc: 2, power: '3', toughness: '1',
      oracleText: 'Discard a card: This creature gains indestructible until end of turn. Tap it.',
    });
    let s = board({ mine: [elf], hand: [swamp] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Iron-Shield Elf'), index: 0 });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0'] } }));
    expect(hasKw(perm(s, 'Iron-Shield Elf')!, 'indestructible')).toBe(true);
    expect(perm(s, 'Iron-Shield Elf')!.tapped).toBe(true);
    // No card left to discard.
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Iron-Shield Elf'), index: 0 }))).toBe('nothingToDiscard');
  });

  describe('rules from the second batch', () => {
    const art = (name: string, oracleText: string, typeLine = 'Artifact') => card({ name, typeLine, manaCost: '{2}', cmc: 2, oracleText });
    const bolt = spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.');

    it('Bilbo: spells cast from anywhere but the hand cost {1} less', () => {
      const bilbo = creature('Bilbo, Thief in the Night', 2, 2, { typeLine: 'Legendary Creature — Halfling Rogue', oracleText: 'Spells you cast from anywhere other than your hand cost {1} less to cast.' });
      const recall = spell('Recall', '{2}{U}', 'Draw two cards.\nFlashback {3}{U}', 'Sorcery');
      expect(castCost(board({ mine: [bilbo] }), 0, recall, { from: 'graveyard' })).toEqual({ generic: 2, colored: [['U']] });
      expect(castCost(board({ mine: [bilbo] }), 0, recall, { from: 'hand' }).generic).toBe(2);
      expect(castCost(board({ theirs: [bilbo] }), 0, recall, { from: 'graveyard' }).generic).toBe(3);
    });

    it('Valley Floodcaller: noncreature spells as though they had flash', () => {
      const flood = creature('Valley Floodcaller', 2, 2, { oracleText: 'Flash\nYou may cast noncreature spells as though they had flash.' });
      const sorcery = spell('Think', '{B}', 'Draw a card.', 'Sorcery');
      const bear = creature('Bear', 2, 2, { manaCost: '{B}' });
      const s = board({ mana: 2, mine: [flood], hand: [sorcery, bear] });
      s.stack = [{ iid: 'x0', card: bolt, controller: 1, targets: [] }];
      s.priority = { player: 0, passes: 0, reason: 'main' };
      expect(canCastNow(s, 0, sorcery)).toBe(true);
      expect(canCastNow(s, 0, bear)).toBe(false);
      s.battlefield = s.battlefield.filter((x) => x.card !== flood);
      expect(canCastNow(s, 0, sorcery)).toBe(false);
    });

    it('Karn and Cursed Totem stop activated abilities', () => {
      const karn = card({ name: 'Karn, the Great Creator', typeLine: 'Legendary Planeswalker — Karn', oracleText: 'Activated abilities of artifacts your opponents control can\'t be activated.' });
      const rock = art('Mind Stone', '{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.');
      let s = board({ mana: 1, mine: [rock], theirs: [karn] });
      expect(canTapForMana(s, perm(s, 'Mind Stone')!)).toBe(false);
      expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Mind Stone'), index: 0 }))).toBe('activationForbidden');
      // Karn's own controller's artifacts still work.
      s = board({ mana: 1, mine: [rock, karn] });
      expect(canTapForMana(s, perm(s, 'Mind Stone')!)).toBe(true);
      const totem = art('Cursed Totem', 'Activated abilities of creatures can\'t be activated.');
      const elf = creature('Llanowar Elves', 1, 1, { oracleText: '{T}: Add {G}.' });
      s = board({ mine: [elf, totem] });
      expect(canTapForMana(s, perm(s, 'Llanowar Elves')!)).toBe(false);
    });

    it('Ashiok: an opponent\'s own spells can\'t make them search', () => {
      const ashiok = card({ name: 'Ashiok, Dream Render', typeLine: 'Legendary Planeswalker — Ashiok', oracleText: 'Spells and abilities your opponents control can\'t cause their controller to search their library.' });
      const tutor = spell('Tutor', '{B}', 'Search your library for a land card, put it into your hand, then shuffle.', 'Sorcery');
      let s = board({ mana: 1, hand: [tutor], theirs: [ashiok] });
      perm(s, 'Ashiok, Dream Render')!.counters = { loyalty: 5 };
      s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
      expect(s.pending?.choice).toBeFalsy();
      expect(s.stack).toHaveLength(0);
      s = resolve(apply(board({ mana: 1, hand: [tutor] }), { type: 'cast', iid: 'h0' }));
      expect(s.pending?.choice).toMatchObject({ purpose: 'search' });
    });

    it('Archon of Emeria, Manglehorn and Root Maze make permanents enter tapped', () => {
      const archon = creature('Archon of Emeria', 2, 3, { oracleText: 'Flying\nEach player can\'t cast more than one spell each turn.\nNonbasic lands your opponents control enter tapped.' });
      const maze = art('Root Maze', 'Artifacts and lands enter tapped.', 'Enchantment');
      const tundra = card({ name: 'Tundra', typeLine: 'Land — Plains Island' });
      const play = (c: Card, opts: Parameters<typeof board>[0]) => perm(apply(board({ ...opts, hand: [c] }), { type: 'playLand', iid: 'h0' }), c.name)!.tapped;
      expect(play(tundra, { theirs: [archon] })).toBe(true);
      expect(play(tundra, { mine: [archon] })).toBe(false);
      expect(play(island, { theirs: [archon] })).toBe(false);
      expect(play(island, { mine: [maze] })).toBe(true);
    });

    it('Frenzied Baloth: creature spells can\'t be countered, combat damage can\'t be prevented', () => {
      const baloth = creature('Frenzied Baloth', 3, 2, { oracleText: 'This spell can\'t be countered.\nTrample, haste\nCreature spells you control can\'t be countered.\nCombat damage can\'t be prevented.', keywords: ['Trample', 'Haste'] });
      const counter = spell('Counterspell', '{U}', 'Counter target spell.');
      let s = board({ mine: [baloth], oppMana: 1, mana: 1, hand: [creature('Bear', 2, 2, { manaCost: '{B}' })], oppHand: [counter] });
      s = apply(s, { type: 'cast', iid: 'h0' });
      // The opponent counters: nothing happens.
      s = apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: s.stack[0].iid }]] });
      s = resolve(s);
      expect(perm(s, 'Bear')).toBeDefined();
      expect(gameRulesOf(baloth)).toEqual(['creatureSpellsUncounterable', 'combatDamageCantBePrevented']);
    });

    it('Exploration: one more land each turn', () => {
      const exploration = art('Exploration', 'You may play an additional land on each of your turns.', 'Enchantment');
      let s = board({ mine: [exploration], hand: [island, island, island] });
      s = apply(apply(s, { type: 'playLand', iid: 'h0' }), { type: 'playLand', iid: 'h1' });
      expect(errorOf(() => apply(s, { type: 'playLand', iid: 'h2' }))).toBe('landAlreadyPlayed');
      expect(errorOf(() => apply(apply(board({ hand: [island, island] }), { type: 'playLand', iid: 'h0' }), { type: 'playLand', iid: 'h1' }))).toBe('landAlreadyPlayed');
    });

    it('Lhurgoyfs, Ardyn\'s Demons and Skrelv', () => {
      const barrowgoyf = creature('Barrowgoyf', 0, 1, { power: '*', toughness: '1+*', oracleText: 'Deathtouch, lifelink\nBarrowgoyf\'s power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.' });
      const nethergoyf = creature('Nethergoyf', 0, 1, { power: '*', toughness: '1+*', oracleText: 'Nethergoyf\'s power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1.' });
      let s = board({ mine: [barrowgoyf, nethergoyf], grave: [bolt] });
      s.players[1].graveyard = [{ iid: 'og', card: creature('Bear', 2, 2) }, { iid: 'og2', card: swamp }];
      s = settle(apply(s, { type: 'pass' }));
      // All graveyards: instant, creature, land; mine: instant.
      expect([powerOf(perm(s, 'Barrowgoyf')!), toughnessOf(perm(s, 'Barrowgoyf')!)]).toEqual([3, 4]);
      expect([powerOf(perm(s, 'Nethergoyf')!), toughnessOf(perm(s, 'Nethergoyf')!)]).toEqual([1, 2]);
      const ardyn = creature('Ardyn, the Usurper', 4, 4, { oracleText: 'Demons you control have menace, lifelink, and haste.' });
      const demon = creature('Demon', 5, 5, { typeLine: 'Creature — Demon' });
      const skrelv = creature('Skrelv, Defector Mite', 1, 1, { oracleText: 'Toxic 1\nSkrelv can\'t block.' });
      s = settle(apply(board({ mine: [ardyn, demon], theirs: [skrelv] }), { type: 'pass' }));
      expect(hasKw(perm(s, 'Demon')!, 'haste')).toBe(true);
      expect(hasKw(perm(s, 'Ardyn, the Usurper')!, 'haste')).toBe(false);
      expect(canBlock(perm(s, 'Skrelv, Defector Mite')!, perm(s, 'Demon')!)).toBe(false);
    });

    it('Survival of the Fittest discards a creature card to find one', () => {
      const survival = art('Survival of the Fittest', '{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.', 'Enchantment');
      const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
      let s = board({ mine: [forest, survival], hand: [swamp] });
      expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Survival of the Fittest'), index: 0 }))).toBe('nothingToDiscard');
      s = board({ mine: [forest, survival], hand: [swamp, creature('Bear', 2, 2)] });
      s.players[0].library = [{ iid: 'l0', card: creature('Ogre', 3, 3) }, ...s.players[0].library];
      s = apply(s, { type: 'activate', iid: iidOf(s, 'Survival of the Fittest'), index: 0 });
      expect((s.pending!.choice as { options: { iid: string }[] }).options.map((c) => c.iid)).toEqual(['h1']);
      s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } }));
      expect(s.pending?.choice).toMatchObject({ purpose: 'search' });
      s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } }));
      expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Swamp', 'Ogre']);
    });

    it('Priest of Titania: {G} for each Elf on the battlefield', () => {
      const priest = creature('Priest of Titania', 1, 1, { typeLine: 'Creature — Elf Druid', oracleText: '{T}: Add {G} for each Elf on the battlefield.' });
      const s = board({ mine: [priest], theirs: [creature('Elvish Visionary', 1, 1, { typeLine: 'Creature — Elf Shaman' })] });
      expect(unitsOf(s, perm(s, 'Priest of Titania')!)).toEqual([['G'], ['G']]);
    });

    it('Disruptor Flute and Anointed Peacekeeper tax the chosen name', () => {
      const flute = art('Disruptor Flute', 'Flash\nAs this artifact enters, choose a card name.\nSpells with the chosen name cost {3} more to cast.\nActivated abilities of sources with the chosen name can\'t be activated unless they\'re mana abilities.');
      const keeper = creature('Anointed Peacekeeper', 3, 3, { oracleText: 'Vigilance\nAs this creature enters, look at an opponent\'s hand, then choose any card name.\nSpells your opponents cast with the chosen name cost {2} more to cast.\nActivated abilities of sources with the chosen name cost {2} more to activate unless they\'re mana abilities.' });
      let s = board({ mine: [flute, keeper] });
      perm(s, 'Disruptor Flute')!.chosenName = 'Bolt';
      perm(s, 'Anointed Peacekeeper')!.chosenName = 'Bolt';
      // Mine: only the Flute's {3}; the opponent's: {3} + {2}.
      expect(castCost(s, 0, bolt, {}).generic).toBe(3);
      expect(castCost(s, 1, bolt, {}).generic).toBe(5);
      // Cast, the Peacekeeper offers the opponent's hand first.
      s = board({ mana: 3, hand: [keeper], oppHand: [bolt, swamp] });
      s.battlefield.push(...[0, 1].map((i): Permanent => ({ iid: `w${i}`, card: card({ name: 'Plains', typeLine: 'Basic Land — Plains' }), controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] })));
      s.battlefield = s.battlefield.slice(1);
      s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
      expect(s.pending?.choice).toMatchObject({ purpose: 'taxName', modes: ['Bolt', 'Swamp'] });
    });
  });

  it('clones of a creature you control, of any nonland permanent, of an enchantment', () => {
    const mimic = creature('Glasspool Mimic', 0, 0, { typeLine: 'Creature — Shapeshifter Rogue', manaCost: '{B}', cmc: 1, oracleText: 'You may have this creature enter as a copy of a creature you control, except it\'s a Shapeshifter Rogue in addition to its other types.' });
    const impersonator = creature('Clever Impersonator', 0, 0, { manaCost: '{B}', cmc: 1, oracleText: 'You may have this creature enter as a copy of any nonland permanent on the battlefield.' });
    const copyEnchantment = card({ name: 'Copy Enchantment', typeLine: 'Enchantment', manaCost: '{B}', cmc: 1, oracleText: 'You may have this enchantment enter as a copy of any enchantment on the battlefield.' });
    expect(cloneOf(mimic)).toEqual({ filter: { types: ['creature'] }, mine: true, subtypes: ['Shapeshifter', 'Rogue'] });
    const bear = creature('Bear', 2, 2, { typeLine: 'Creature — Bear' });
    const ogre = creature('Ogre', 3, 3);
    const anthem = card({ name: 'Anthem', typeLine: 'Enchantment', oracleText: 'Creatures you control get +1/+1.' });
    const options = (c: Card) => {
      const s = resolve(apply(board({ mana: 1, hand: [c], mine: [bear], theirs: [ogre, anthem] }), { type: 'cast', iid: 'h0' }));
      return (s.pending!.choice as { options: { card: Card }[] }).options.map((o) => o.card.name);
    };
    expect(options(mimic)).toEqual(['Bear']);
    expect(options(impersonator)).toEqual(['Bear', 'Ogre', 'Anthem']);
    expect(options(copyEnchantment)).toEqual(['Anthem']);
    // The Mimic copies the Bear and is a Shapeshifter Rogue too.
    let s = resolve(apply(board({ mana: 1, hand: [mimic], mine: [bear] }), { type: 'cast', iid: 'h0' }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Bear')] } }));
    const copy = s.battlefield.filter((x) => x.card.name === 'Bear')[1];
    expect(copy.card.typeLine).toBe('Creature — Bear Shapeshifter Rogue');
    expect(powerOf(copy)).toBe(2);
  });
});

describe('mana abilities costing mana, extra mana when tapped', () => {
  const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const talon = card({
    name: 'Talon Gates of Madara', typeLine: 'Land — Gate',
    oracleText: 'When this land enters, up to one target creature phases out.\n{T}: Add {C}.\n{1}, {T}: Add one mana of any color.\n{4}: Put this card from your hand onto the battlefield.',
  });
  const boulder = card({
    name: 'Giant\'s Boulder', typeLine: 'Artifact', manaCost: '{1}', cmc: 1,
    oracleText: 'When this artifact enters, scry 2.\n{1}, {T}: Add one mana of any color.\n{7}, {T}, Sacrifice this artifact: Destroy target permanent.',
  });
  const sprite = creature('Sprite', 1, 1, { manaCost: '{U}', cmc: 1 });
  const golem = creature('Golem', 2, 2, { manaCost: '{2}', cmc: 2 });
  const tapped = (s: GameState) => s.battlefield.filter((x) => x.controller === 0 && x.tapped).map((x) => x.card.name).sort();

  it('Talon Gates of Madara: any color, spending one other mana on it', () => {
    expect(paidAnyColor(talon)).toBe(true);
    let s = board({ mine: [talon, mountain], hand: [sprite, golem] });
    expect(canPay(s, 0, sprite)).toBe(true);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(tapped(s)).toEqual(['Mountain', 'Talon Gates of Madara']);
    expect(s.players[0].pool ?? []).toEqual([]);
    // Its {C} still counts as one mana for a generic cost.
    s = board({ mine: [talon, mountain], hand: [golem] });
    expect(canPay(s, 0, golem)).toBe(true);
    // Alone, or with {U}{U} to pay out of two lands: not enough.
    expect(canPay(board({ mine: [talon] }), 0, sprite)).toBe(false);
    expect(canPay(board({ mine: [talon, mountain] }), 0, creature('Sphinx', 3, 3, { manaCost: '{U}{U}', cmc: 2 }))).toBe(false);
  });

  it('Giant\'s Boulder: no mana of its own, a color for one other mana', () => {
    expect(canPay(board({ mine: [boulder] }), 0, sprite)).toBe(false);
    expect(canPay(board({ mine: [boulder, mountain] }), 0, golem)).toBe(false);
    let s = board({ mine: [boulder, mountain], hand: [sprite] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(tapped(s)).toEqual(['Giant\'s Boulder', 'Mountain']);
  });

  it('Skycloud Expanse: {W}{U} for one other mana', () => {
    const skycloud = card({ name: 'Skycloud Expanse', typeLine: 'Land', oracleText: '{1}, {T}: Add {W}{U}.' });
    expect(filterMana(skycloud)).toEqual({ fee: null, units: [['W'], ['U']] });
    const sphinx = creature('Sphinx', 3, 3, { manaCost: '{W}{U}', cmc: 2 });
    expect(canPay(board({ mine: [skycloud] }), 0, sprite)).toBe(false);
    let s = board({ mine: [skycloud, mountain], hand: [sphinx] });
    expect(unitsOf(s, perm(s, 'Skycloud Expanse')!)).toEqual([['W'], ['U']]);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(tapped(s)).toEqual(['Mountain', 'Skycloud Expanse']);
  });

  const wildGrowth = card({
    name: 'Wild Growth', typeLine: 'Enchantment — Aura', manaCost: '{G}', cmc: 1, keywords: ['Enchant'],
    oracleText: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
  });

  it('Wild Growth: the enchanted land makes an additional {G}', () => {
    expect(extraManaOf(wildGrowth)).toEqual({ whose: 'enchanted', kind: 'land', add: [['G']] });
    const bear = creature('Bear', 2, 2, { manaCost: '{G}{G}', cmc: 2 });
    let s = board({ mine: [mountain, wildGrowth], hand: [bear] });
    perm(s, 'Wild Growth')!.attachedTo = iidOf(s, 'Mountain');
    expect(unitsOf(s, perm(s, 'Mountain')!)).toEqual([['R'], ['G']]);
    expect(canPay(s, 0, bear)).toBe(false);
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Mountain') });
    expect(s.players[0].pool?.map((m) => m.colors)).toEqual([['R'], ['G']]);
    // Taken back: both mana leave the pool.
    s = apply(s, { type: 'untapForMana', iid: iidOf(s, 'Mountain') });
    expect(s.players[0].pool).toBeUndefined();
    s = board({ mine: [forest, wildGrowth], hand: [bear] });
    perm(s, 'Wild Growth')!.attachedTo = iidOf(s, 'Forest');
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.players[0].hand).toHaveLength(0);
    expect(tapped(s)).toEqual(['Forest']);
  });

  it('Badgermole Cub and Kinnan: more mana from creatures and nonland permanents', () => {
    const cub = card({
      name: 'Badgermole Cub', typeLine: 'Creature — Badger Mole', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2',
      oracleText: 'When this creature enters, earthbend 1. (Target land you control becomes a 0/0 creature with haste that\'s still a land. Put a +1/+1 counter on it. When it dies or is exiled, return it to the battlefield tapped.)\nWhenever you tap a creature for mana, add an additional {G}.',
    });
    const kinnan = card({
      name: 'Kinnan, Bonder Prodigy', typeLine: 'Legendary Creature — Human Druid', manaCost: '{G}{U}', cmc: 2, power: '2', toughness: '2',
      oracleText: 'Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
    });
    const elf = creature('Llanowar Elves', 1, 1, { oracleText: '{T}: Add {G}.' });
    const ring = card({ name: 'Sol Ring', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' });
    expect(extraManaOf(cub)).toEqual({ whose: 'yours', kind: 'creature', add: [['G']] });
    expect(extraManaOf(kinnan)).toEqual({ whose: 'yours', kind: 'nonland', add: 'same' });
    let s = board({ mine: [cub, elf, forest] });
    expect(unitsOf(s, perm(s, 'Llanowar Elves')!)).toEqual([['G'], ['G']]);
    expect(unitsOf(s, perm(s, 'Forest')!)).toEqual([['G']]);
    // An opponent's Cub doesn't help.
    s = board({ mine: [elf], theirs: [cub] });
    expect(unitsOf(s, perm(s, 'Llanowar Elves')!)).toEqual([['G']]);
    s = board({ mine: [kinnan, ring, forest] });
    expect(unitsOf(s, perm(s, 'Sol Ring')!)).toEqual([['C'], ['C'], ['C']]);
    expect(unitsOf(s, perm(s, 'Forest')!)).toEqual([['G']]);
  });

  it('Nyxbloom Ancient triples its controller\'s mana; Mana Flare adds to every land', () => {
    const nyxbloom = card({
      name: 'Nyxbloom Ancient', typeLine: 'Enchantment Creature — Elemental', manaCost: '{4}{G}{G}{G}', cmc: 7, power: '5', toughness: '5', keywords: ['Trample'],
      oracleText: 'Trample\nIf you tap a permanent for mana, it produces three times as much of that mana instead.',
    });
    const flare = card({
      name: 'Mana Flare', typeLine: 'Enchantment', manaCost: '{2}{R}', cmc: 3,
      oracleText: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
    });
    expect(manaMultiplier(nyxbloom)).toBe(3);
    let s = board({ mine: [nyxbloom, forest], theirs: [mountain] });
    expect(unitsOf(s, perm(s, 'Forest')!)).toEqual([['G'], ['G'], ['G']]);
    expect(unitsOf(s, perm(s, 'Mountain')!)).toEqual([['R']]);
    s = board({ mine: [forest], theirs: [flare, mountain] });
    expect(unitsOf(s, perm(s, 'Forest')!)).toEqual([['G'], ['G']]);
    expect(unitsOf(s, perm(s, 'Mountain')!)).toEqual([['R'], ['R']]);
  });
});

describe('metagame audit 2026-10-17, fifth batch', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
  const bear = creature('Bear', 2, 2);

  it('Hypnotic Specter: damage to an opponent makes them discard at random', () => {
    const specter = card({
      name: 'Hypnotic Specter', typeLine: 'Creature — Specter', manaCost: '{1}{B}{B}', cmc: 3, power: '2', toughness: '2', keywords: ['Flying'],
      oracleText: 'Flying\nWhenever this creature deals damage to an opponent, that player discards a card at random.',
    });
    expect(triggersOf(specter).map((t) => t.event.on)).toEqual(['damagesOpponent']);
    let s = board({ mine: [specter], oppHand: [swamp, island] });
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = settle(apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Hypnotic Specter')] }));
    for (let i = 0; i < 20 && s.step !== 'main2' && !s.pending; i++) {
      s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    s = resolve(s);
    expect(s.players[1].life).toBe(18);
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.players[1].graveyard).toHaveLength(1);
  });

  const cryomancer = card({
    name: 'Seasoned Cryomancer', typeLine: 'Creature — Human Wizard', manaCost: '{1}{U}{U}', cmc: 3, power: '2', toughness: '2',
    oracleText: 'When this creature enters, draw two cards, then discard two cards. When you discard one or more nonland cards this way, tap up to that many target creatures and put a stun counter on each of them.\n{3}{U}{U}, Exile this card from your graveyard: Draw two cards.',
  });

  it('Seasoned Cryomancer: taps and stuns one creature per nonland card discarded', () => {
    expect(triggersOf(cryomancer)[0].ability.effects.map((e) => e.kind)).toEqual(['draw', 'discard', 'whenDiscardedNonland']);
    expect(activatedOf(cryomancer)).toEqual([]);
    const ogre = creature('Ogre', 3, 3);
    let s = board({ mana: 3, hand: [{ ...cryomancer, manaCost: '{3}' }], theirs: [bear, ogre] });
    s.players[0].library = [{ iid: 'l0', card: creature('Elf', 1, 1) }, { iid: 'l1', card: swamp }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.pending?.choice).toMatchObject({ purpose: 'discard', min: 2, max: 2 });
    // One nonland card and a land: one creature.
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0', 'l1'] } }));
    expect(s.pending?.choice).toMatchObject({ kind: 'targets' });
    const targets = (s.pending!.choice as { slots: TargetSpec[] }).slots;
    expect(targets[0].max).toBe(1);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] } }));
    expect(perm(s, 'Ogre')).toMatchObject({ tapped: true, counters: { stun: 1 } });
    expect(perm(s, 'Bear')!.tapped).toBe(false);
  });

  it('Seasoned Cryomancer: two lands discarded, no trigger', () => {
    let s = board({ mana: 3, hand: [{ ...cryomancer, manaCost: '{3}' }], theirs: [bear] });
    s.players[0].library = [{ iid: 'l0', card: swamp }, { iid: 'l1', card: island }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0', 'l1'] } }));
    expect(s.pending).toBeNull();
    expect(perm(s, 'Bear')!.tapped).toBe(false);
  });

  const wall = card({
    name: 'Wall of Roots', typeLine: 'Creature — Plant Wall', manaCost: '{1}{G}', cmc: 2, power: '0', toughness: '5', keywords: ['Defender'],
    oracleText: 'Defender\nPut a -0/-1 counter on this creature: Add {G}. Activate only once each turn.',
  });

  it('Wall of Roots: {G} for a -0/-1 counter, once each turn, even summoning sick', () => {
    const elf = creature('Elf', 1, 1, { manaCost: '{G}', cmc: 1 });
    let s = board({ mine: [wall], hand: [elf, { ...elf, name: 'Elf Two' }] });
    perm(s, 'Wall of Roots')!.sick = true;
    expect(canPay(s, 0, elf)).toBe(true);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Wall of Roots')!.counters['-0/-1']).toBe(1);
    expect(toughnessOf(perm(s, 'Wall of Roots')!)).toBe(4);
    expect(perm(s, 'Wall of Roots')!.tapped).toBe(false);
    // Once each turn.
    s = resolve(s);
    expect(canPay(s, 0, elf)).toBe(false);
  });

  it('Utopia Sprawl: enchants a Forest, a color chosen as it enters, one more mana of it', () => {
    const sprawl = card({
      name: 'Utopia Sprawl', typeLine: 'Enchantment — Aura', manaCost: '{G}', cmc: 1, keywords: ['Enchant'],
      oracleText: 'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    });
    expect(extraManaOf(sprawl)).toEqual({ whose: 'enchanted', kind: 'land', add: 'chosen' });
    let s = board({ mine: [forest, mountain], hand: [sprawl] });
    // Only a Forest can be enchanted.
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Mountain') }]] }))).not.toBeNull();
    s = resolve(settle(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Forest') }]] })));
    expect(s.pending?.choice).toMatchObject({ purpose: 'manaColor' });
    s = apply(s, { type: 'choose', answer: { kind: 'mode', modes: [1] } });
    expect(perm(s, 'Utopia Sprawl')!.chosenColor).toBe('U');
    perm(s, 'Forest')!.tapped = false;
    expect(unitsOf(s, perm(s, 'Forest')!)).toEqual([['G'], ['U']]);
  });

  it('Lion\'s Eye Diamond: discards the hand for three mana of one color, never paid automatically', () => {
    const led = card({ name: 'Lion\'s Eye Diamond', typeLine: 'Artifact', oracleText: 'Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.' });
    let s = board({ mine: [led], hand: [creature('Giant', 3, 3, { manaCost: '{R}{R}{R}', cmc: 3 }), swamp] });
    expect(canPay(s, 0, s.players[0].hand[0].card)).toBe(false);
    expect(canActivateDiamond(s, perm(s, 'Lion\'s Eye Diamond')!)).toBe(true);
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Lion\'s Eye Diamond') });
    expect(s.pending?.choice).toMatchObject({ purpose: 'manaColor' });
    s = apply(s, { type: 'choose', answer: { kind: 'mode', modes: [3] } });
    expect(s.players[0].pool?.map((m) => m.colors)).toEqual([['R'], ['R'], ['R']]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].graveyard.map((c) => c.card.name).sort()).toEqual(['Giant', 'Lion\'s Eye Diamond', 'Swamp']);
  });
});

describe('metagame audit 2026-10-18', () => {
  const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const workshop = card({ name: 'Mishra\'s Workshop', typeLine: 'Land', oracleText: '{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.' });
  const temple = card({
    name: 'Eldrazi Temple', typeLine: 'Land',
    oracleText: '{T}: Add {C}.\n{T}: Add {C}{C}. Spend this mana only to cast colorless Eldrazi spells or activate abilities of colorless Eldrazi.',
  });
  const golem = card({ name: 'Golem', typeLine: 'Artifact Creature — Golem', manaCost: '{3}', cmc: 3, power: '3', toughness: '3' });
  const ogre = creature('Ogre', 3, 3, { manaCost: '{3}', cmc: 3 });

  it('Mishra\'s Workshop: three mana for artifact spells only', () => {
    expect(restrictedMana(workshop)).toEqual({ units: [['C'], ['C'], ['C']], spell: { types: ['artifact'] } });
    let s = board({ mine: [workshop], hand: [golem, ogre] });
    expect(canPay(s, 0, ogre)).toBe(false);
    expect(canPay(s, 0, golem)).toBe(true);
    expect(canTapForMana(s, perm(s, 'Mishra\'s Workshop')!)).toBe(false);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Mishra\'s Workshop')!.tapped).toBe(true);
    expect(s.players[0].pool ?? []).toEqual([]);
  });

  it('Eldrazi Temple: {C}{C} for colorless Eldrazi, {C} otherwise', () => {
    const eldrazi = card({ name: 'Thought-Knot Seer', typeLine: 'Creature — Eldrazi', manaCost: '{3}{C}', cmc: 4, power: '4', toughness: '4' });
    const red = card({ name: 'Red Eldrazi', typeLine: 'Creature — Eldrazi', manaCost: '{2}{R}', cmc: 3, colors: ['R'], power: '3', toughness: '3' });
    let s = board({ mine: [temple, ...[1, 2].map(() => swamp)], hand: [eldrazi, ogre, red] });
    expect(unitsOf(s, perm(s, 'Eldrazi Temple')!)).toEqual([['C']]);
    expect(unitsOf(s, perm(s, 'Eldrazi Temple')!, eldrazi)).toEqual([['C'], ['C']]);
    expect(canPay(s, 0, eldrazi)).toBe(true);
    expect(canPay(s, 0, ogre)).toBe(true);
    // A colored Eldrazi gets only {C}.
    expect(unitsOf(s, perm(s, 'Eldrazi Temple')!, red)).toEqual([['C']]);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.battlefield.filter((x) => x.tapped).map((x) => x.card.name).sort()).toEqual(['Eldrazi Temple', 'Swamp', 'Swamp']);
  });

  it('Shang-Chi: its mana only pays for abilities of creatures', () => {
    const shang = card({
      name: 'Shang-Chi, Master of Kung Fu', typeLine: 'Legendary Creature — Human Warrior Hero', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2',
      oracleText: 'You may activate abilities of creatures you control as though those creatures had haste.\n{T}: Add two mana of any one color. Spend this mana only to activate abilities of creature sources.',
    });
    const pumper = creature('Pumper', 1, 1, { oracleText: '{2}: This creature gets +1/+1 until end of turn.' });
    const rock = card({ name: 'Rock', typeLine: 'Artifact', oracleText: '{2}: You gain 1 life.' });
    const s = board({ mine: [shang, pumper, rock], hand: [ogre] });
    expect(canPay(s, 0, ogre)).toBe(false);
    expect(activationProblem(s, 0, perm(s, 'Pumper')!, 0)).toBeNull();
    expect(activationProblem(s, 0, perm(s, 'Rock')!, 0)).toBe('notEnoughMana');
  });

  const cutter = card({
    name: 'Cori-Steel Cutter', typeLine: 'Artifact — Equipment', manaCost: '{1}{R}', cmc: 2,
    oracleText: 'Equipped creature gets +1/+1 and has trample and haste.\nFlurry — Whenever you cast your second spell each turn, create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it. (Whenever you cast a noncreature spell, the token gets +1/+1 until end of turn.)\nEquip {1}{R}',
  });

  it('Cori-Steel Cutter: a Monk on the second spell each turn, the Equipment attached to it', () => {
    expect(triggersOf(cutter).map((t) => t.event)).toEqual([{ on: 'cast', filter: {}, nth: 2 }]);
    expect(triggersOf(cutter)[0].ability.effects.map((e) => e.kind)).toEqual(['token', 'attachToToken']);
    const shock = spell('Shock', '{R}', 'Shock deals 2 damage to any target.');
    let s = board({ mine: [cutter, ...[1, 2, 3].map(() => mountain)], hand: [shock, { ...shock, name: 'Shock Two' }, { ...shock, name: 'Shock Three' }] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] }));
    expect(s.battlefield.some((x) => x.card.name === 'Monk')).toBe(false);
    s = resolve(apply(s, { type: 'cast', iid: 'h1', targets: [[{ kind: 'player', player: 1 }]] }));
    const monk = s.battlefield.find((x) => x.card.name === 'Monk')!;
    expect(perm(s, 'Cori-Steel Cutter')!.attachedTo).toBe(monk.iid);
    // The third spell: no Monk.
    s = resolve(apply(s, { type: 'cast', iid: 'h2', targets: [[{ kind: 'player', player: 1 }]] }));
    expect(s.battlefield.filter((x) => x.card.name === 'Monk')).toHaveLength(1);
  });

  it('Cori-Steel Cutter already equipping a creature: its controller is asked', () => {
    const shock = spell('Shock', '{R}', 'Shock deals 2 damage to any target.');
    const bear = creature('Bear', 2, 2);
    let s = board({ mine: [cutter, bear, ...[1, 2].map(() => mountain)], hand: [shock, { ...shock, name: 'Shock Two' }] });
    perm(s, 'Cori-Steel Cutter')!.attachedTo = iidOf(s, 'Bear');
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'player', player: 1 }]] }));
    s = resolve(apply(s, { type: 'cast', iid: 'h1', targets: [[{ kind: 'player', player: 1 }]] }));
    expect(s.pending?.choice).toMatchObject({ purpose: 'attachToToken' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } }));
    expect(perm(s, 'Cori-Steel Cutter')!.attachedTo).toBe(iidOf(s, 'Bear'));
    expect(s.battlefield.some((x) => x.card.name === 'Monk')).toBe(true);
  });

  it('Kraum and Lotho: the second spell of an opponent, of any player', () => {
    const kraum = card({ name: 'Kraum', typeLine: 'Legendary Creature — Zombie Horror', oracleText: 'Flying, haste\nWhenever an opponent casts their second spell each turn, draw a card.' });
    const lotho = card({ name: 'Lotho', typeLine: 'Legendary Creature — Halfling Rogue', oracleText: 'Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token.' });
    expect(triggersOf(kraum).map((t) => t.event.on)).toEqual(['opponentCasts']);
    expect(triggersOf(lotho).map((t) => t.event.on)).toEqual(['cast', 'opponentCasts']);
  });
});

describe('Tezzeret artifacts deck (deck-2)', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const plains = card({ name: 'Plains', typeLine: 'Basic Land — Plains' });
  const rock = (name: string) => card({ name, typeLine: 'Artifact', manaCost: '{1}', cmc: 1 });
  const bear = creature('Bear', 2, 2);
  const crown = card({ name: 'Crown of Empires', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: '{3}, {T}: Tap target creature. Gain control of that creature instead if you control artifacts named Scepter of Empires and Throne of Empires.' });
  const scepter = card({ name: 'Scepter of Empires', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracleText: '{T}: This artifact deals 1 damage to target player or planeswalker. It deals 3 damage instead if you control artifacts named Crown of Empires and Throne of Empires.' });
  const throne = card({ name: 'Throne of Empires', typeLine: 'Artifact', manaCost: '{4}', cmc: 4, oracleText: '{1}, {T}: Create a 1/1 white Soldier creature token. Create five of those tokens instead if you control artifacts named Crown of Empires and Scepter of Empires.' });

  it('Phyrexian Metamorph: a copy of an artifact or creature that is also an artifact', () => {
    const metamorph = card({
      name: 'Phyrexian Metamorph', typeLine: 'Artifact Creature — Phyrexian Shapeshifter', manaCost: '{3}{U/P}', cmc: 4, power: '0', toughness: '0',
      oracleText: '({U/P} can be paid with either {U} or 2 life.)\nYou may have this creature enter as a copy of any artifact or creature on the battlefield, except it\'s an artifact in addition to its other types.',
    });
    expect(cloneOf(metamorph)).toMatchObject({ filter: { types: ['artifact', 'creature'] }, artifact: true });
    let s = board({ mana: 4, hand: [{ ...metamorph, manaCost: '{4}' }], theirs: [bear], mine: [scepter] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.pending?.choice).toMatchObject({ purpose: 'clone' });
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid).sort()).toEqual([iidOf(s, 'Bear'), iidOf(s, 'Scepter of Empires')].sort());
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Bear')] } }));
    const copy = s.battlefield.filter((x) => x.card.name === 'Bear').find((x) => x.controller === 0)!;
    expect(copy.card.typeLine).toBe('Artifact Creature');
    expect(powerOf(copy)).toBe(2);
  });

  it('Wall of Essence: gains life equal to the combat damage it is dealt', () => {
    const wall = card({ name: 'Wall of Essence', typeLine: 'Creature — Wall', manaCost: '{1}{W}', cmc: 2, power: '0', toughness: '4', keywords: ['Defender'], oracleText: 'Defender (This creature can\'t attack.)\nWhenever this creature is dealt combat damage, you gain that much life.' });
    let s = board({ mine: [wall], theirs: [creature('Ogre', 3, 3)] });
    s.active = 1;
    s.players[1].landPlayed = true;
    s.step = 'main1';
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Ogre')] });
    for (let i = 0; i < 6 && !(s.step === 'block' && !s.priority); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareBlockers', blocks: { [iidOf(s, 'Ogre')]: [iidOf(s, 'Wall of Essence')] } });
    for (let i = 0; i < 10 && s.step !== 'main2'; i++) s = apply(s, { type: 'pass' });
    expect(s.players[0].life).toBe(23);
    expect(perm(s, 'Wall of Essence')!.damage).toBe(3);
  });

  it('Tezzeret, Betrayer of Flesh: the first artifact ability each turn costs {2} less; +1 discards one artifact or two cards', () => {
    const tezzeret = card({
      name: 'Tezzeret, Betrayer of Flesh', typeLine: 'Legendary Planeswalker — Tezzeret', manaCost: '{2}{U}{U}', cmc: 4, loyalty: '4',
      oracleText: 'The first activated ability of an artifact you activate each turn costs {2} less to activate.\n+1: Draw two cards. Then discard two cards unless you discard an artifact card.\n−2: Target artifact becomes an artifact creature. If it isn\'t a Vehicle, it has base power and toughness 4/4.\n−6: You get an emblem with "Whenever an artifact you control becomes tapped, draw a card."',
    });
    expect(gameRulesOf(tezzeret)).toEqual(['firstArtifactAbilityCostsLess']);
    let s = board({ mana: 1, mine: [tezzeret, throne] });
    perm(s, 'Tezzeret, Betrayer of Flesh')!.counters = { loyalty: 4 };
    // {1} for Throne: free with the discount (so the Swamp stays untapped).
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Throne of Empires'), index: 0 }));
    expect(s.battlefield.filter((x) => x.card.name === 'Soldier')).toHaveLength(1);
    expect(perm(s, 'Swamp')!.tapped).toBe(false);
    // +1: two cards drawn, then one artifact discarded is enough.
    s.players[0].library = [{ iid: 'l0', card: rock('Ornithopter') }, { iid: 'l1', card: plains }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Tezzeret, Betrayer of Flesh'), index: 0 }));
    expect(s.pending?.choice).toMatchObject({ purpose: 'discardUnlessArtifact', min: 1, max: 2 });
    // One land alone isn't enough: asked again.
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } });
    expect(s.pending?.choice).toMatchObject({ purpose: 'discardUnlessArtifact' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } }));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Plains']);
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Ornithopter']);
  });

  it('Tezzeret the Seeker: −X puts an artifact with mana value X or less onto the battlefield', () => {
    const seeker = card({
      name: 'Tezzeret the Seeker', typeLine: 'Legendary Planeswalker — Tezzeret', manaCost: '{3}{U}{U}', cmc: 5, loyalty: '4',
      oracleText: '+1: Untap up to two target artifacts.\n−X: Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.\n−5: Artifacts you control become artifact creatures with base power and toughness 5/5 until end of turn.',
    });
    expect(activatedOf(seeker)[1].cost).toMatchObject({ loyalty: 0, loyaltyX: true });
    let s = board({ mine: [seeker] });
    perm(s, 'Tezzeret the Seeker')!.counters = { loyalty: 4 };
    s.players[0].library = [{ iid: 'l0', card: throne }, { iid: 'l1', card: scepter }, ...s.players[0].library];
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Tezzeret the Seeker'), index: 1, x: 5 }))).toBe('notEnoughLoyalty');
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Tezzeret the Seeker'), index: 1, x: 3 }));
    expect(perm(s, 'Tezzeret the Seeker')!.counters.loyalty).toBe(1);
    // Throne (4) is too expensive.
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual(['l1']);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } }));
    expect(perm(s, 'Scepter of Empires')).toBeDefined();
  });

  it('Dispatch: tap target creature; exile it with three or more artifacts', () => {
    const dispatch = spell('Dispatch', '{W}', 'Tap target creature.\nMetalcraft — If you control three or more artifacts, exile that creature.');
    let s = board({ mine: [plains, rock('A'), rock('B')], hand: [dispatch], theirs: [bear] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }));
    expect(perm(s, 'Bear')!.tapped).toBe(true);
    s = board({ mine: [plains, rock('A'), rock('B'), rock('C')], hand: [dispatch], theirs: [bear] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Bear']);
  });

  it('Turn Aside: counters only a spell that targets a permanent you control', () => {
    const turnAside = spell('Turn Aside', '{U}', 'Counter target spell that targets a permanent you control.');
    const bolt = spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.');
    const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
    // I Bolt; the opponent has Turn Aside for its Bear.
    const bolts = (target: (s: GameState) => { kind: 'player'; player: PlayerId } | { kind: 'permanent'; iid: string }) => {
      let s = board({ mine: [mountain], theirs: [bear, island], hand: [bolt], oppHand: [turnAside] });
      return apply(s, { type: 'cast', iid: 'h0', targets: [[target(s)]] });
    };
    // Bolt at the opponent: not a permanent they control.
    // (Turn Aside has no legal target: the opponent isn't even asked, and the Bolt resolves.)
    let s = bolts(() => ({ kind: 'player', player: 1 }));
    expect(s.players[1].life).toBe(17);
    expect(s.players[1].hand.map((c) => c.card.name)).toEqual(['Turn Aside']);
    // Bolt at their Bear: countered.
    s = bolts((t) => ({ kind: 'permanent', iid: iidOf(t, 'Bear') }));
    s = apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: s.stack[0].iid }]] });
    for (let i = 0; i < 6 && s.stack.length; i++) s = apply(s, { type: 'pass' });
    expect(perm(s, 'Bear')).toBeDefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Bolt']);
  });

  it('Crown, Scepter and Throne of Empires: more with the other two', () => {
    expect(activatedOf(scepter)[0].ability.insteadIfNamed).toEqual({ names: ['Crown of Empires', 'Throne of Empires'], effects: [{ kind: 'damage', amount: 3, to: { slot: 0 } }] });
    // Alone: 1 damage, a tap, one Soldier.
    let s = board({ mana: 4, mine: [scepter, crown, rock('A')], theirs: [bear] });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Scepter of Empires'), index: 0, targets: [[{ kind: 'player', player: 1 }]] }));
    expect(s.players[1].life).toBe(19);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Crown of Empires'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }));
    expect(perm(s, 'Bear')).toMatchObject({ tapped: true, controller: 1 });
    // All three: 3 damage, the creature stolen, five Soldiers.
    s = board({ mana: 5, mine: [scepter, crown, throne], theirs: [bear] });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Scepter of Empires'), index: 0, targets: [[{ kind: 'player', player: 1 }]] }));
    expect(s.players[1].life).toBe(17);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Crown of Empires'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }));
    expect(perm(s, 'Bear')!.controller).toBe(0);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Throne of Empires'), index: 0 }));
    expect(s.battlefield.filter((x) => x.card.name === 'Soldier')).toHaveLength(5);
  });
});

describe('metagame audit 2026-10-18, small triggers', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const bear = creature('Bear', 2, 2);
  const treasure = tokenCard(PREDEFINED_TOKENS.treasure);
  const rock = card({ name: 'Rock', typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracleText: '{T}, Sacrifice this artifact: You gain 1 life.' });

  it('Sewer-veillance Cam: taps or untaps a creature as it enters and as it leaves', () => {
    const cam = card({
      name: 'Sewer-veillance Cam', typeLine: 'Artifact', manaCost: '{U}', cmc: 1, keywords: ['Flash'],
      oracleText: 'Flash\nWhen this artifact enters or leaves the battlefield, you may tap or untap target creature.\n{3}{U}, Sacrifice this artifact: Draw two cards.',
    });
    expect(triggersOf(cam).map((t) => t.event.on)).toEqual(['enters', 'leaves']);
    let s = board({ mine: [island, ...[1, 2, 3].map(() => island)], hand: [cam], theirs: [bear] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(perm(s, 'Bear')!.tapped).toBe(true);
    // Sacrificed: it leaves, and the Bear is untapped.
    for (const x of s.battlefield) if (x.card.name === 'Island') x.tapped = false;
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Sewer-veillance Cam'), index: 0 }));
    s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(perm(s, 'Bear')!.tapped).toBe(false);
  });

  it('Monument to Endurance: each discard picks a mode not chosen this turn', () => {
    const monument = card({
      name: 'Monument to Endurance', typeLine: 'Artifact', manaCost: '{3}', cmc: 3,
      oracleText: 'Whenever you discard a card, choose one that hasn\'t been chosen this turn —\n• Draw a card.\n• Create a Treasure token.\n• Each opponent loses 3 life.',
    });
    const loot = spell('Loot', '{0}', 'Draw a card, then discard a card.');
    let s = board({ mine: [monument], hand: [loot, { ...loot, name: 'Loot Two' }, swamp, swamp] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h2'] } });
    expect(s.pending?.choice).toMatchObject({ purpose: 'triggerMode', disabled: [] });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'mode', modes: [2] } }));
    expect(s.players[1].life).toBe(17);
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h3'] } });
    // "Each opponent loses 3 life" was chosen this turn.
    expect(s.pending?.choice).toMatchObject({ purpose: 'triggerMode', disabled: [2] });
  });

  it('Biotech Specialist and The Sackville-Bagginses: sacrifices of artifacts and tokens', () => {
    const biotech = card({
      name: 'Biotech Specialist', typeLine: 'Creature — Insect Scientist', manaCost: '{R}{G}', cmc: 2, power: '1', toughness: '3',
      oracleText: 'When this creature enters, create a Lander token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")\nWhenever you sacrifice an artifact, this creature deals 2 damage to target opponent.',
    });
    const bagginses = card({
      name: 'The Sackville-Bagginses', typeLine: 'Legendary Creature — Halfling Citizen', manaCost: '{1}{B}', cmc: 2, power: '2', toughness: '2',
      oracleText: 'When The Sackville-Bagginses enter, you may sacrifice another creature or artifact. If you do, draw a card and create a Treasure token.\nWhenever you sacrifice a token, target opponent loses 1 life.',
    });
    expect(triggersOf(biotech).map((t) => t.event.on)).toEqual(['enters', 'youSacrifice']);
    expect(triggersOf(bagginses).map((t) => t.event.on)).toEqual(['enters', 'youSacrifice']);
    // A Treasure sacrificed for mana: both trigger.
    // Their "target opponent": the only one.
    const aim = (s: GameState) => {
      for (let i = 0; i < 4 && s.pending?.choice.purpose === 'triggerTargets'; i++) s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] } });
      return resolve(s);
    };
    let s = board({ mine: [biotech, bagginses, treasure], hand: [creature('Elf', 1, 1, { manaCost: '{G}', cmc: 1 })] });
    s = aim(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.players[1].life).toBe(17);
    expect(s.players[0].sacrificedThisTurn).toBe(1);
    // A nontoken artifact: only the Specialist.
    s = board({ mine: [biotech, bagginses, rock] });
    s = aim(apply(s, { type: 'activate', iid: iidOf(s, 'Rock'), index: 0 }));
    expect(s.players[1].life).toBe(18);
  });

  it('The Sackville-Bagginses: may sacrifice another creature or artifact as they enter, to draw and get a Treasure', () => {
    const bagginses = card({
      name: 'The Sackville-Bagginses', typeLine: 'Legendary Creature — Halfling Citizen', manaCost: '{1}{B}', cmc: 2, power: '2', toughness: '2',
      oracleText: 'When The Sackville-Bagginses enter, you may sacrifice another creature or artifact. If you do, draw a card and create a Treasure token.\nWhenever you sacrifice a token, target opponent loses 1 life.',
    });
    let s = board({ mana: 2, mine: [rock], hand: [{ ...bagginses, manaCost: '{2}' }] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.pending?.choice).toMatchObject({ purpose: 'reflexiveSacrifice' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Rock')] } }));
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.battlefield.some((x) => x.card.name === 'Treasure')).toBe(true);
  });

  it('Obsessive Pursuit: a Clue as it enters and each upkeep; counters for each permanent sacrificed', () => {
    const pursuit = card({
      name: 'Obsessive Pursuit', typeLine: 'Enchantment', manaCost: '{1}{B}', cmc: 2,
      oracleText: 'When this enchantment enters and at the beginning of your upkeep, you lose 1 life and create a Clue token. (It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\nWhenever you attack, put X +1/+1 counters on target attacking creature, where X is the number of permanents you\'ve sacrificed this turn. If X is three or more, that creature gains lifelink until end of turn.',
    });
    expect(triggersOf(pursuit).map((t) => t.event.on)).toEqual(['enters', 'upkeep', 'youAttack']);
    let s = board({ mana: 2, hand: [{ ...pursuit, manaCost: '{2}' }], mine: [bear] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.players[0].life).toBe(19);
    expect(s.battlefield.some((x) => x.card.name === 'Clue')).toBe(true);
    s.players[0].sacrificedThisTurn = 3;
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Bear')] });
    if (s.pending) s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } });
    s = resolve(s);
    expect(perm(s, 'Bear')!.counters['+1/+1']).toBe(3);
    expect(hasKw(perm(s, 'Bear')!, 'lifelink')).toBe(true);
  });

  it('Wishclaw Talisman: three wish counters, a card for one, then the opponent gets it', () => {
    const wishclaw = card({
      name: 'Wishclaw Talisman', typeLine: 'Artifact', manaCost: '{1}{B}', cmc: 2,
      oracleText: 'This artifact enters with three wish counters on it.\n{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of this artifact. Activate only during your turn.',
    });
    let s = board({ mana: 3, hand: [{ ...wishclaw, manaCost: '{2}' }] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Wishclaw Talisman')!.counters.wish).toBe(3);
    s.players[0].library = [{ iid: 'l0', card: bear }, ...s.players[0].library];
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Wishclaw Talisman'), index: 0 });
    s = resolve(s);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } }));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Bear']);
    expect(perm(s, 'Wishclaw Talisman')).toMatchObject({ controller: 1, counters: { wish: 2 } });
    // Not during its new controller's opponent's turn.
    expect(activationProblem(s, 1, perm(s, 'Wishclaw Talisman')!, 0)).toBe('activateTiming');
  });
});

describe('Tezzeret artifacts deck (deck-2), second batch', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const rock = (name: string) => card({ name, typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracleText: '{T}: Add {C}.' });
  const tezzeret = card({
    name: 'Tezzeret, Betrayer of Flesh', typeLine: 'Legendary Planeswalker — Tezzeret', manaCost: '{2}{U}{U}', cmc: 4, loyalty: '4',
    oracleText: 'The first activated ability of an artifact you activate each turn costs {2} less to activate.\n+1: Draw two cards. Then discard two cards unless you discard an artifact card.\n−2: Target artifact becomes an artifact creature. If it isn\'t a Vehicle, it has base power and toughness 4/4.\n−6: You get an emblem with "Whenever an artifact you control becomes tapped, draw a card."',
  });

  it('Tezzeret, Betrayer of Flesh −2: an artifact becomes a 4/4 artifact creature for good', () => {
    let s = board({ mine: [tezzeret, rock('Sol Rock')] });
    perm(s, 'Tezzeret, Betrayer of Flesh')!.counters = { loyalty: 4 };
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Tezzeret, Betrayer of Flesh'), index: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Sol Rock') }]] }));
    const rockPerm = perm(s, 'Sol Rock')!;
    expect(rockPerm.card.typeLine).toBe('Artifact Creature');
    expect([powerOf(rockPerm), toughnessOf(rockPerm)]).toEqual([4, 4]);
    // Still a creature next turn.
    for (let i = 0; i < 40 && !(s.active === 0 && s.turn > 1); i++) s = apply(s, { type: 'pass' });
    expect(isCreature(perm(s, 'Sol Rock')!.card)).toBe(true);
    expect(powerOf(perm(s, 'Sol Rock')!)).toBe(4);
  });

  it('Tezzeret, Betrayer of Flesh −6: the emblem draws when an artifact becomes tapped', () => {
    let s = board({ mine: [tezzeret, rock('Sol Rock')] });
    perm(s, 'Tezzeret, Betrayer of Flesh')!.counters = { loyalty: 6 };
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Tezzeret, Betrayer of Flesh'), index: 2 }));
    expect(s.players[0].emblems).toHaveLength(1);
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Sol Rock') });
    s = resolve(s);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('Tezzeret the Seeker −5: artifacts become 5/5 artifact creatures until end of turn', () => {
    const seeker = card({
      name: 'Tezzeret the Seeker', typeLine: 'Legendary Planeswalker — Tezzeret', manaCost: '{3}{U}{U}', cmc: 5, loyalty: '4',
      oracleText: '+1: Untap up to two target artifacts.\n−X: Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.\n−5: Artifacts you control become artifact creatures with base power and toughness 5/5 until end of turn.',
    });
    const thopter = card({ name: 'Ornithopter', typeLine: 'Artifact Creature — Thopter', manaCost: '{0}', power: '0', toughness: '2', keywords: ['Flying'], oracleText: 'Flying' });
    let s = board({ mine: [seeker, rock('Sol Rock'), thopter] });
    perm(s, 'Tezzeret the Seeker')!.counters = { loyalty: 5 };
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Tezzeret the Seeker'), index: 2 }));
    for (const name of ['Sol Rock', 'Ornithopter']) expect([powerOf(perm(s, name)!), toughnessOf(perm(s, name)!)]).toEqual([5, 5]);
    for (let i = 0; i < 40 && s.active === 0; i++) s = apply(s, { type: 'pass' });
    expect(isCreature(perm(s, 'Sol Rock')!.card)).toBe(false);
    expect(powerOf(perm(s, 'Ornithopter')!)).toBe(0);
  });

  it('Vedalken Shackles: control while it stays tapped, power up to the Islands', () => {
    const shackles = card({
      name: 'Vedalken Shackles', typeLine: 'Artifact', manaCost: '{3}', cmc: 3,
      oracleText: 'You may choose not to untap this artifact during your untap step.\n{2}, {T}: Gain control of target creature with power less than or equal to the number of Islands you control for as long as this artifact remains tapped.',
    });
    const ogre = creature('Ogre', 3, 3);
    let s = board({ mine: [shackles, island, island], theirs: [creature('Bear', 2, 2), ogre] });
    const spec = activatedOf(shackles)[0];
    expect(spec.ability.targets[0].filter).toMatchObject({ maxPowerIslands: true });
    // Two Islands: the Ogre (power 3) can't be taken.
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Vedalken Shackles'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] }))).not.toBeNull();
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Vedalken Shackles'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] }));
    expect(perm(s, 'Bear')!.controller).toBe(0);
    // Its untap step: the Shackles stay tapped, the Bear stays.
    for (let i = 0; i < 60 && !(s.active === 0 && s.turn > 1 && s.step === 'main1'); i++) s = apply(s, { type: 'pass' });
    expect(perm(s, 'Vedalken Shackles')!.tapped).toBe(true);
    expect(perm(s, 'Bear')!.controller).toBe(0);
    // Untapped (by an effect): the Bear goes back.
    perm(s, 'Vedalken Shackles')!.tapped = false;
    s = apply(s, { type: 'pass' });
    expect(perm(s, 'Bear')!.controller).toBe(1);
  });
});

describe('metagame audit 2026-10-18, cost reductions and Eldrazi Spawn', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 12 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const spawn = (s: GameState) => s.battlefield.filter((x) => x.card.name === 'Eldrazi Spawn');

  it('Hearth Elemental: {X} less for instants, sorceries and Adventure cards in the graveyard', () => {
    const hearth = card({
      name: 'Hearth Elemental // Stoke Genius', typeLine: 'Creature — Elemental // Sorcery — Adventure', manaCost: '{5}{R} // {1}{R}', cmc: 6, power: '4', toughness: '5',
      oracleText: 'This spell costs {X} less to cast, where X is the number of cards in your graveyard that are instant cards, sorcery cards, and/or have an Adventure.\n//\nDiscard your hand, then draw two cards. (Then exile this card. You may cast the creature later from exile.)',
    });
    const adventurer = card({ name: 'Bonecrusher Giant // Stomp', typeLine: 'Creature — Giant // Instant — Adventure', manaCost: '{2}{R} // {1}{R}', cmc: 3, power: '4', toughness: '3', oracleText: 'x\n//\ny' });
    const s = board({ hand: [hearth], grave: [spell('Bolt', '{R}', 'x'), spell('Think', '{U}', 'x', 'Sorcery'), adventurer, swamp, creature('Bear', 2, 2)] });
    expect(castCost(s, 0, hearth, {})).toEqual({ generic: 2, colored: [['R']] });
  });

  const sunderflock = card({
    name: 'Sunderflock', typeLine: 'Creature — Elemental', manaCost: '{7}{U}{U}', cmc: 9, power: '5', toughness: '5', keywords: ['Flying'],
    oracleText: 'This spell costs {X} less to cast, where X is the greatest mana value among Elementals you control.\nFlying\nWhen this creature enters, if you cast it, return all non-Elemental creatures to their owners\' hands.',
  });

  it('Sunderflock: {X} less for the greatest Elemental; returns non-Elementals only if cast', () => {
    const elemental = card({ name: 'Big Elemental', typeLine: 'Creature — Elemental', manaCost: '{4}{U}', cmc: 5, power: '4', toughness: '4' });
    const bear = creature('Bear', 2, 2);
    let s = board({ mine: [elemental, ...Array.from({ length: 4 }, () => island)], hand: [sunderflock], theirs: [bear] });
    expect(castCost(s, 0, sunderflock, {})).toEqual({ generic: 2, colored: [['U'], ['U']] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.players[1].hand.map((c) => c.card.name)).toEqual(['Bear']);
    expect(perm(s, 'Big Elemental')).toBeDefined();
    // Put onto the battlefield without being cast: nothing returns.
    const reanimate = spell('Reanimate', '{0}', 'Return target creature card from your graveyard to the battlefield.', 'Sorcery');
    s = board({ hand: [reanimate], grave: [sunderflock], theirs: [bear] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'card', iid: 'g0' }]] }));
    expect(perm(s, 'Sunderflock')).toBeDefined();
    expect(perm(s, 'Bear')).toBeDefined();
  });

  it('Eldrazi Spawn: a 0/1 sacrificed for {C}, even the turn it is made', () => {
    const truths = spell('Unfathomable Truths', '{0}', 'Devoid (This card has no color.)\nDraw three cards and create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."');
    let s = board({ hand: [truths, creature('Golem', 1, 1, { manaCost: '{1}', cmc: 1 })] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(spawn(s)).toHaveLength(1);
    expect([powerOf(spawn(s)[0]), toughnessOf(spawn(s)[0])]).toEqual([0, 1]);
    expect(canPay(s, 0, s.players[0].hand.find((c) => c.card.name === 'Golem')!.card)).toBe(true);
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    expect(spawn(s)).toHaveLength(0);
    expect(perm(s, 'Golem')).toBeDefined();
  });

  it('Basking Broodscale: adapt puts a counter, and counters make a Spawn', () => {
    const broodscale = card({
      name: 'Basking Broodscale', typeLine: 'Creature — Eldrazi Lizard', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', keywords: ['Devoid'],
      oracleText: 'Devoid (This card has no color.)\n{1}{G}: Adapt 1. (If this creature has no +1/+1 counters on it, put a +1/+1 counter on it.)\nWhenever one or more +1/+1 counters are put on this creature, you may create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."',
    });
    const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
    let s = board({ mine: [broodscale, forest, forest, forest, forest] });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Basking Broodscale'), index: 0 }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }));
    expect(perm(s, 'Basking Broodscale')!.counters['+1/+1']).toBe(1);
    expect(spawn(s)).toHaveLength(1);
    // Already adapted: no counter, no Spawn.
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Basking Broodscale'), index: 0 }));
    expect(perm(s, 'Basking Broodscale')!.counters['+1/+1']).toBe(1);
    expect(spawn(s)).toHaveLength(1);
  });

  it('Glaring Fleshraker: a Spawn for each colorless spell, 1 damage for each other colorless creature', () => {
    const fleshraker = card({
      name: 'Glaring Fleshraker', typeLine: 'Creature — Eldrazi Drone', manaCost: '{2}{C}', cmc: 3, power: '2', toughness: '2',
      oracleText: 'Whenever you cast a colorless spell, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."\nWhenever another colorless creature you control enters, this creature deals 1 damage to each opponent.',
    });
    const golem = creature('Golem', 1, 1, { manaCost: '{0}', cmc: 0 });
    const red = creature('Goblin', 1, 1, { manaCost: '{0}', cmc: 0, colors: ['R'] });
    let s = board({ mine: [fleshraker], hand: [golem, red] });
    // A colorless spell: a Spawn; the Golem and the Spawn enter: 2 damage.
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(spawn(s)).toHaveLength(1);
    expect(s.players[1].life).toBe(18);
    // A red one: nothing.
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    expect(spawn(s)).toHaveLength(1);
    expect(s.players[1].life).toBe(18);
  });
});

describe('Metagame audit 2026-10-18: clones and enlist', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  /** Passes (both players) until the turn ends. */
  const endTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };
  const ogre = creature('Ogre', 3, 3, { typeLine: 'Creature — Ogre' });
  const shock = spell('Shock', '{R}', 'Shock deals 2 damage to any target.');

  it('Phantasmal Image: an Illusion copy, sacrificed when it becomes the target of a spell or ability', () => {
    const image = card({
      name: 'Phantasmal Image', typeLine: 'Creature — Illusion', manaCost: '{1}{U}', cmc: 2, power: '0', toughness: '0',
      oracleText: 'You may have this creature enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
    });
    expect(cloneOf(image)).toMatchObject({ subtypes: ['Illusion'], grants: 'When this creature becomes the target of a spell or ability, sacrifice it.' });
    let s = board({ mana: 3, hand: [{ ...image, manaCost: '{2}' }, { ...shock, manaCost: '{1}' }], theirs: [ogre] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Ogre')] } }));
    const copy = s.battlefield.find((x) => x.card.name === 'Ogre' && x.controller === 0)!;
    expect(copy.card.typeLine).toBe('Creature — Ogre Illusion');
    expect(powerOf(copy)).toBe(3);
    // Targeted by its own controller's Shock: sacrificed before it resolves (the Shock then has no target).
    s = resolve(apply(s, { type: 'cast', iid: 'h1', targets: [[{ kind: 'permanent', iid: copy.iid }]] }));
    expect(findPermanent(s, copy.iid)).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Phantasmal Image');
    // The original Ogre isn't affected by being targeted.
    s.players[0].hand.push({ iid: 'h9', card: { ...shock, manaCost: '{0}' } });
    s = resolve(apply(s, { type: 'cast', iid: 'h9', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] }));
    expect(perm(s, 'Ogre')!.damage).toBe(2);
  });

  it('Flesh Duplicate: a copy with vanishing 3 unless the creature has vanishing', () => {
    const duplicate = card({
      name: 'Flesh Duplicate', typeLine: 'Creature — Shapeshifter Rebel', manaCost: '{U}{U}', cmc: 2, power: '0', toughness: '0',
      oracleText: 'You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn\'t have vanishing. (A permanent with vanishing 3 enters with three time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)',
    });
    expect(cloneOf(duplicate)).toMatchObject({ vanishing: 3, subtypes: [] });
    let s = board({ mana: 2, hand: [{ ...duplicate, manaCost: '{2}' }], theirs: [ogre] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Ogre')] } }));
    const copy = s.battlefield.find((x) => x.card.name === 'Ogre' && x.controller === 0)!;
    expect(copy.counters.time).toBe(3);
    expect(triggersOf(copy.card).map((t) => t.ability.effects.map((e) => e.kind))).toEqual([['vanish']]);
    // Each of its controller's upkeeps removes one; the last one: sacrificed.
    copy.counters.time = 2;
    s = endTurn(endTurn(s));
    expect(findPermanent(s, copy.iid)?.counters.time).toBe(1);
    s = endTurn(endTurn(s));
    expect(findPermanent(s, copy.iid)).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Flesh Duplicate');
  });

  it('Superior Spider-Man: a 4/4 copy of a creature card in a graveyard, named Superior Spider-Man, that card exiled', () => {
    const spidey = card({
      name: 'Superior Spider-Man', typeLine: 'Legendary Creature — Spider Human Hero', manaCost: '{2}{U}{B}', cmc: 4, power: '4', toughness: '4',
      oracleText: 'Mind Swap — You may have Superior Spider-Man enter as a copy of any creature card in a graveyard, except his name is Superior Spider-Man and he\'s a 4/4 Spider Human Hero in addition to his other types. When you do, exile that card.',
    });
    expect(cloneOf(spidey)).toMatchObject({ graveyard: true, name: 'Superior Spider-Man', pt: [4, 4], subtypes: ['Spider', 'Human', 'Hero'] });
    const titan = creature('Grave Titan', 6, 6, {
      typeLine: 'Creature — Giant', keywords: ['Deathtouch'],
      oracleText: 'Deathtouch\nWhenever Grave Titan enters or attacks, create two 2/2 black Zombie creature tokens.',
    });
    let s = board({ mana: 4, hand: [{ ...spidey, manaCost: '{4}' }], theirs: [ogre] });
    s.players[1].graveyard = [{ iid: 'og0', card: titan }];
    s = apply(s, { type: 'cast', iid: 'h0' });
    s = resolve(s);
    expect(s.pending?.choice).toMatchObject({ purpose: 'clone' });
    // Only creature cards in graveyards (not the Ogre on the battlefield).
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual(['og0']);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['og0'] } }));
    const copy = perm(s, 'Superior Spider-Man')!;
    expect(copy.card.typeLine).toBe('Creature — Giant Spider Human Hero');
    expect([powerOf(copy), toughnessOf(copy)]).toEqual([4, 4]);
    expect(hasKw(copy, 'deathtouch')).toBe(true);
    // Grave Titan's enters trigger, now his: two Zombies.
    expect(s.battlefield.filter((x) => x.card.name === 'Zombie' && x.controller === 0)).toHaveLength(2);
    expect(s.players[1].graveyard).toEqual([]);
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Grave Titan']);
  });

  it('Guardian of New Benalia: enlist taps a creature that stays home, adding its power, and scries 2', () => {
    const guardian = creature('Guardian of New Benalia', 2, 2, {
      typeLine: 'Creature — Human Soldier', keywords: ['Enlist', 'Scry'],
      oracleText: 'Enlist (As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature\'s until end of turn.)\nWhenever this creature enlists a creature, scry 2.\nDiscard a card: This creature gains indestructible until end of turn. Tap it.',
    });
    expect(triggersOf(guardian).map((t) => t.event.on)).toEqual(['enlists']);
    let s = board({ mine: [guardian, ogre, creature('Fresh', 5, 5)] });
    perm(s, 'Fresh')!.sick = true;
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Guardian of New Benalia')] });
    // Only the Ogre: the other one has summoning sickness.
    expect(s.pending?.choice).toMatchObject({ purpose: 'enlist' });
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual([iidOf(s, 'Ogre')]);
    expect(errorOf(() => apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Fresh')] } }))).toBe('badChoice');
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Ogre')] } });
    expect(perm(s, 'Ogre')!.tapped).toBe(true);
    for (let i = 0; i < 10 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = apply(s, { type: 'pass' });
    // Scry 2.
    expect(s.pending?.choice.kind).toBe('arrange');
    s = apply(s, { type: 'choose', answer: { kind: 'arrange', zones: { top: (s.pending!.choice as { cards: { iid: string }[] }).cards.map((c) => c.iid) } } });
    for (let i = 0; i < 10 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = apply(s, { type: 'pass' });
    expect(powerOf(perm(s, 'Guardian of New Benalia')!)).toBe(5);
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) {
      s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    expect(s.players[1].life).toBe(15);
  });

  it('enlist: no choice is asked without a creature to tap; the bot enlists its strongest idle creature', () => {
    const guardian = creature('Guardian of New Benalia', 2, 2, {
      typeLine: 'Creature — Human Soldier', keywords: ['Enlist'],
      oracleText: 'Enlist (As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature\'s until end of turn.)',
    });
    let s = board({ mine: [guardian] });
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Guardian of New Benalia')] });
    expect(s.pending).toBeFalsy();
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) {
      s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    expect(s.players[1].life).toBe(18);

    const elf = creature('Llanowar Elves', 1, 1, { oracleText: '{T}: Add {G}.' });
    let t = board({ mine: [guardian, elf, ogre] });
    t = apply(t, { type: 'pass' });
    for (let i = 0; i < 5 && (t.priority || t.step !== 'attack'); i++) t = apply(t, { type: 'pass' });
    t = apply(t, { type: 'declareAttackers', attackers: [iidOf(t, 'Guardian of New Benalia')] });
    t = apply(t, botAction(t)!);
    expect(perm(t, 'Ogre')!.tapped).toBe(true);
    expect(perm(t, 'Llanowar Elves')!.tapped).toBe(false);
  });
});

describe('Metagame audit 2026-10-18: Eldrazi and single cards', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const endTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };
  const named = (s: GameState, name: string) => s.battlefield.filter((x) => x.card.name === name);
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });

  it('Warping Wail: the Scion mode (its ability in a sentence of its own)', () => {
    const wail = spell('Warping Wail', '{1}{C}', '({C} represents colorless mana.)\nChoose one —\n• Exile target creature with power or toughness 1 or less.\n• Counter target sorcery spell.\n• Create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."');
    let s = board({ hand: [{ ...wail, manaCost: '{0}' }] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', modes: [2] }));
    const [scion] = named(s, 'Eldrazi Scion');
    expect(scion.card).toMatchObject({ typeLine: 'Token Creature — Eldrazi Scion', oracleText: 'Sacrifice this token: Add {C}.' });
    expect([powerOf(scion), toughnessOf(scion)]).toEqual([1, 1]);
    expect(canPay(s, 0, creature('Golem', 1, 1))).toBe(true);
  });

  it('Malevolent Rumble: a permanent card into the hand, the rest into the graveyard, and a Spawn', () => {
    const rumble = spell('Malevolent Rumble', '{1}{G}', 'Reveal the top four cards of your library. You may put a permanent card from among them into your hand. Put the rest into your graveyard. Create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."', 'Sorcery');
    expect(spellSpec(rumble).effects.map((e) => e.kind)).toEqual(['dig', 'token']);
    let s = board({ hand: [{ ...rumble, manaCost: '{0}' }] });
    const bolt = spell('Lightning Bolt', '{R}', 'Lightning Bolt deals 3 damage to any target.');
    const bear = creature('Bear', 2, 2);
    s.players[0].library = [bolt, bear, swamp, bolt, swamp].map((c, i) => ({ iid: `l${i}`, card: c }));
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    // The Bolts can't be taken.
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual(['l1', 'l2']);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } }));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Bear']);
    expect(s.players[0].graveyard.map((c) => c.card.name).sort()).toEqual(['Lightning Bolt', 'Lightning Bolt', 'Malevolent Rumble', 'Swamp']);
    expect(s.players[0].library.map((c) => c.iid)).toEqual(['l4']);
    expect(named(s, 'Eldrazi Spawn')).toHaveLength(1);
  });

  it('Glimpse the Impossible: three cards playable this turn; those left go to the graveyard at the end step, a Spawn each', () => {
    const glimpse = spell('Glimpse the Impossible', '{2}{R}', 'Exile the top three cards of your library. You may play those cards this turn. At the beginning of the next end step, if any of those cards remain exiled, put them into your graveyard, then create a 0/1 colorless Eldrazi Spawn creature token for each card put into your graveyard this way. Those tokens have "Sacrifice this token: Add {C}."', 'Sorcery');
    expect(spellSpec(glimpse).effects).toEqual([{ kind: 'impulse', n: 3, spawnAtEnd: true }]);
    let s = board({ mana: 1, hand: [{ ...glimpse, manaCost: '{0}' }] });
    const bear = creature('Bear', 2, 2, { manaCost: '{B}' });
    const ogre = creature('Ogre', 3, 3, { manaCost: '{5}', cmc: 5 });
    s.players[0].library = [bear, swamp, ogre, swamp].map((c, i) => ({ iid: `l${i}`, card: c }));
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.players[0].exile.map((c) => c.iid)).toEqual(['l0', 'l1', 'l2']);
    // The land is played from exile, the Bear cast from there.
    s = apply(s, { type: 'playLand', iid: 'l1' });
    s = resolve(apply(s, { type: 'cast', iid: 'l0' }));
    expect(perm(s, 'Bear')).toBeDefined();
    expect(named(s, 'Swamp')).toHaveLength(2);
    // The Ogre is too expensive: at the end step it goes to the graveyard, and a Spawn is made.
    s = endTurn(s);
    expect(s.players[0].exile).toEqual([]);
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Ogre');
    expect(named(s, 'Eldrazi Spawn')).toHaveLength(1);
    // Not playable any more on a later turn.
    s.players[0].exile.push({ iid: 'x0', card: ogre, playableOnTurn: 1 });
    expect(castOptions(s, 0, 'x0')).toEqual([]);
  });

  it('Incubation Druid: one mana of a type a land could make; three with a +1/+1 counter', () => {
    const druid = card({
      name: 'Incubation Druid', typeLine: 'Creature — Elf Druid', manaCost: '{1}{G}', cmc: 2, power: '0', toughness: '2',
      oracleText: '{T}: Add one mana of any type that a land you control could produce. If this creature has a +1/+1 counter on it, add three mana of that type instead.\n{3}{G}{G}: Adapt 3. (If this creature has no +1/+1 counters on it, put three +1/+1 counters on it.)',
    });
    const s = board({ mana: 1, mine: [druid, forest] });
    expect(unitsOf(s, perm(s, 'Incubation Druid')!)).toEqual([['B', 'G']]);
    perm(s, 'Incubation Druid')!.counters = { '+1/+1': 3 };
    expect(unitsOf(s, perm(s, 'Incubation Druid')!)).toEqual([['B', 'G'], ['B', 'G'], ['B', 'G']]);
  });

  it('Phyrexian Devourer: counters equal to the exiled card\'s mana value; sacrificed at power 7 or more', () => {
    const devourer = card({
      name: 'Phyrexian Devourer', typeLine: 'Artifact Creature — Phyrexian Construct', manaCost: '{6}', cmc: 6, power: '1', toughness: '1',
      oracleText: 'When this creature\'s power is 7 or greater, sacrifice it.\nExile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card\'s mana value.',
    });
    expect(activatedOf(devourer)[0].cost).toMatchObject({ exileTop: true });
    let s = board({ mine: [devourer] });
    s.players[0].library = [{ iid: 'l0', card: creature('Ogre', 3, 3, { cmc: 5 }) }, { iid: 'l1', card: creature('Bear', 2, 2, { cmc: 2 }) }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Phyrexian Devourer'), index: 0 }));
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Ogre']);
    expect(powerOf(perm(s, 'Phyrexian Devourer')!)).toBe(6);
    // 6 + 2: sacrificed.
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Phyrexian Devourer'), index: 0 }));
    expect(perm(s, 'Phyrexian Devourer')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Phyrexian Devourer']);
    // An empty library: it can't be activated.
    const t = board({ mine: [devourer] });
    t.players[0].library = [];
    expect(errorOf(() => apply(t, { type: 'activate', iid: iidOf(t, 'Phyrexian Devourer'), index: 0 }))).toBe('nothingToExile');
  });

  it('Sneaky Snacker: back from the graveyard tapped when you draw your third card in a turn', () => {
    const snacker = card({
      name: 'Sneaky Snacker', typeLine: 'Creature — Faerie Rogue', manaCost: '{U}{B}', cmc: 2, power: '2', toughness: '1', keywords: ['Flying'],
      oracleText: 'Flying\nWhen you draw your third card in a turn, return this card from your graveyard to the battlefield tapped.',
    });
    const draw2 = spell('Divination', '{0}', 'Draw two cards.', 'Sorcery');
    let s = board({ grave: [snacker], hand: [draw2, draw2] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Sneaky Snacker')).toBeUndefined();
    // The third and fourth cards: it triggers once.
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    expect(perm(s, 'Sneaky Snacker')!.tapped).toBe(true);
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Divination', 'Divination']);
  });

  it('Void Mirror: counters a spell cast without colored mana', () => {
    const mirror = card({ name: 'Void Mirror', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracleText: 'Whenever a player casts a spell, if no colored mana was spent to cast it, counter that spell.' });
    const wastes = card({ name: 'Wastes', typeLine: 'Basic Land', oracleText: '{T}: Add {C}.' });
    const golem = creature('Golem', 1, 1, { manaCost: '{1}', cmc: 1 });
    const bear = creature('Bear', 2, 2, { manaCost: '{1}', cmc: 1 });
    let s = board({ theirs: [mirror], mine: [wastes], hand: [golem] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Golem')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Golem']);
    // Generic mana paid with a Swamp: colored mana was spent.
    s = board({ mana: 1, theirs: [mirror], hand: [bear] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Bear')).toBeDefined();
  });
});

describe('Metagame audit 2026-10-18: Birgi, Samut, Biomancer\'s Familiar', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Birgi: {R} for each spell cast, kept as steps and phases end until the end of the turn', () => {
    const birgi = creature('Birgi, God of Storytelling', 3, 3, {
      typeLine: 'Legendary Creature — God', manaCost: '{2}{R}', cmc: 3,
      oracleText: 'Whenever you cast a spell, add {R}. Until end of turn, you don\'t lose this mana as steps and phases end.\nCreatures you control can boast twice during each of your turns rather than once.',
    });
    expect(triggersOf(birgi)[0].ability.effects).toEqual([{ kind: 'addMana', units: [['R']], untilEndOfTurn: true }]);
    const ornithopter = creature('Ornithopter', 0, 2, { manaCost: '{0}', cmc: 0 });
    let s = board({ mine: [birgi], hand: [ornithopter, creature('Goblin', 1, 1, { manaCost: '{R}', cmc: 1 })] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.players[0].pool).toEqual([{ colors: ['R'], untilEndOfTurn: true }]);
    // Into combat and out: still there in the second main phase, spent on the Goblin.
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 10 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, { type: 'pass' });
    expect(s.step).toBe('main2');
    expect(s.players[0].pool).toHaveLength(1);
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    expect(perm(s, 'Goblin')).toBeDefined();
    // Gone at the end of the turn (the Goblin's own {R} too).
    expect(s.players[0].pool).toHaveLength(1);
    for (let i = 0; i < 20 && s.active === 0; i++) s = apply(s, { type: 'pass' });
    expect(s.players[0].pool).toBeUndefined();
  });

  it('Samut: your instants and sorceries have split second', () => {
    const samut = creature('Samut, Tyrant of Naktamun', 2, 1, {
      typeLine: 'Legendary Creature — Human Wizard', manaCost: '{1}{U}', cmc: 2,
      oracleText: 'Instant and sorcery spells you control have split second. (As long as a spell with split second is on the stack, players can\'t cast spells or activate abilities that aren\'t mana abilities.)',
    });
    expect(gameRulesOf(samut)).toEqual(['yourSpellsSplitSecond']);
    const counterspell = spell('Counterspell', '{U}{U}', 'Counter target spell.');
    const pinger = creature('Pinger', 1, 1, { oracleText: '{T}: This creature deals 1 damage to any target.' });
    const divination = { ...spell('Divination', '{0}', 'Draw two cards.'), typeLine: 'Instant' };
    const opts = { hand: [divination], theirs: [pinger], oppMana: 2, oppHand: [{ ...counterspell, manaCost: '{0}' }] };
    // Without Samut, the opponent may answer it.
    let s = apply(board(opts), { type: 'cast', iid: 'h0' });
    expect(actor(s)).toBe(1);
    // With Samut, the opponent can do nothing: it resolves at once.
    s = apply(board({ ...opts, mine: [samut] }), { type: 'cast', iid: 'h0' });
    expect(s.stack).toEqual([]);
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[1].hand).toHaveLength(1);
    // Holding priority over it: neither a spell nor an ability (mana abilities still work).
    s = board({ ...opts, mine: [samut] });
    s.stack.push({ iid: 'h9', card: divination, controller: 0, targets: [], splitSecond: true });
    s.priority = { player: 1, passes: 0, reason: 'main' };
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'spell', iid: 'h9' }]] }))).toBe('castingForbidden');
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Pinger'), index: 0, targets: [[{ kind: 'player', player: 0 }]] }))).toBe('activationForbidden');
    expect(errorOf(() => apply(s, { type: 'tapForMana', iid: iidOf(s, 'Island') }))).toBeNull();
    // A creature spell doesn't get it.
    const t = apply(board({ ...opts, mine: [samut], hand: [creature('Bear', 2, 2, { manaCost: '{0}', cmc: 0 })] }), { type: 'cast', iid: 'h0' });
    expect(t.stack[0].splitSecond).toBeUndefined();
    expect(actor(t)).toBe(1);
  });

  it('Biomancer\'s Familiar: creature abilities cost {2} less (at least one mana); the next adapt ignores counters', () => {
    const familiar = creature('Biomancer\'s Familiar', 2, 2, {
      typeLine: 'Creature — Mutant', manaCost: '{G}{U}', cmc: 2,
      oracleText: 'Activated abilities of creatures you control cost {2} less to activate. This effect can\'t reduce the mana in that cost to less than one mana.\n{T}: The next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it.',
    });
    const adapter = creature('Adapter', 1, 1, { oracleText: '{3}: Adapt 2. (If this creature has no +1/+1 counters on it, put two +1/+1 counters on it.)' });
    const pinger = creature('Pinger', 1, 1, { oracleText: '{1}, {T}: This creature deals 1 damage to any target.' });
    const rock = card({ name: 'Rock', typeLine: 'Artifact', oracleText: '{2}, {T}: You gain 1 life.' });
    let s = board({ mana: 1, mine: [familiar, adapter, pinger, rock] });
    // {3} becomes {1}; {1} stays {1}; an artifact's {2} is not reduced.
    expect(canPayAbility(s, perm(s, 'Adapter')!, 0)).toBe(true);
    expect(canPayAbility(s, perm(s, 'Pinger')!, 0)).toBe(true);
    expect(canPayAbility(s, perm(s, 'Rock')!, 0)).toBe(false);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Adapter'), index: 0 }));
    expect(perm(s, 'Adapter')!.counters['+1/+1']).toBe(2);
    // With counters, adapt does nothing, unless the Familiar was used first.
    s.battlefield.push(...[0, 1].map((i): Permanent => ({ iid: `x${i}`, card: swamp, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] })));
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Adapter'), index: 0 }));
    expect(perm(s, 'Adapter')!.counters['+1/+1']).toBe(2);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Biomancer\'s Familiar'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Adapter') }]] }));
    s.battlefield.push({ iid: 'x9', card: swamp, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Adapter'), index: 0 }));
    expect(perm(s, 'Adapter')!.counters['+1/+1']).toBe(4);
  });
});

describe('Duel Commander: mono-green landfall (mtgtop8 deck 901562)', () => {
  const deck = JSON.parse(readFileSync(new URL('./fixtures/duel-commander-landfall-2026-10.json', import.meta.url), 'utf8')) as Card[];
  /** A card of the deck, with its real Oracle text; its mana cost may be replaced (free to cast in a test). */
  const real = (name: string, manaCost?: string) => {
    const c = deck.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const target = (s: GameState, name: string) => [[{ kind: 'permanent' as const, iid: iidOf(s, name) }]];
  const bear = creature('Bear', 2, 2);
  const playForest = (s: GameState) => resolve(apply(s, { type: 'playLand', iid: s.players[0].hand.find((c) => c.card.name === 'Forest')!.iid }));

  it('Hickory Woodlot: enters tapped with two depletion counters; {G}{G} for each, then sacrificed', () => {
    let s = board({ hand: [real('Hickory Woodlot')] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    const woodlot = perm(s, 'Hickory Woodlot')!;
    expect(woodlot).toMatchObject({ tapped: true, counters: { depletion: 2 } });
    woodlot.tapped = false;
    expect(unitsOf(s, woodlot)).toEqual([['G'], ['G']]);
    s = apply(s, { type: 'tapForMana', iid: woodlot.iid });
    expect(s.players[0].pool).toHaveLength(2);
    perm(s, 'Hickory Woodlot')!.tapped = false;
    s = apply(s, { type: 'tapForMana', iid: woodlot.iid });
    expect(perm(s, 'Hickory Woodlot')).toBeUndefined();
    expect(s.players[0].pool).toHaveLength(4);
  });

  it('Elvish Reclaimer: +2/+2 with three or more land cards in the graveyard', () => {
    let s = board({ mana: 1, mine: [real('Elvish Reclaimer')], grave: [forest, forest, bear] });
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Swamp') });
    expect(powerOf(perm(s, 'Elvish Reclaimer')!)).toBe(1);
    s.players[0].graveyard.push({ iid: 'g9', card: forest });
    s = apply(s, { type: 'pass' });
    expect([powerOf(perm(s, 'Elvish Reclaimer')!), toughnessOf(perm(s, 'Elvish Reclaimer')!)]).toEqual([3, 4]);
  });

  it('Surrak: a card when an opponent targets a creature you control', () => {
    const shock = spell('Shock', '{0}', 'Shock deals 2 damage to any target.');
    let s = board({ mine: [real('Surrak, Elusive Hunter')], oppHand: [shock], hand: [{ ...shock, manaCost: '{0}' }] });
    // My own Shock on Surrak: nothing.
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Surrak, Elusive Hunter') }));
    expect(s.players[0].hand).toHaveLength(0);
    // The opponent's: a card.
    s.priority = { player: 1, passes: 0, reason: 'main' };
    s = resolve(apply(s, { type: 'cast', iid: 'o0', targets: target(s, 'Surrak, Elusive Hunter') }));
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('Centaur Garden: threshold, +3/+3 only with seven or more cards in the graveyard', () => {
    const garden = real('Centaur Garden');
    expect(activatedOf(garden)[0]).toMatchObject({ minGraveyard: 7 });
    let s = board({ mine: [garden, bear, card({ name: 'Forest', typeLine: 'Basic Land — Forest' })], grave: Array(6).fill(bear) });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Centaur Garden'), index: 0, targets: target(s, 'Bear') }))).toBe('threshold');
    s.players[0].graveyard.push({ iid: 'g9', card: bear });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Centaur Garden'), index: 0, targets: target(s, 'Bear') }));
    expect(powerOf(perm(s, 'Bear')!)).toBe(5);
  });

  it('pump spells: Groundswell (landfall), Might of Old Krosa (main phase), Tyvar\'s Stand (X), Vines of Vastwood (kicked)', () => {
    let s = board({ mine: [bear], hand: [real('Groundswell', '{0}'), real('Groundswell', '{0}'), forest] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect(powerOf(perm(s, 'Bear')!)).toBe(4);
    s = playForest(s);
    s = resolve(apply(s, { type: 'cast', iid: 'h1', targets: target(s, 'Bear') }));
    expect(powerOf(perm(s, 'Bear')!)).toBe(8);

    s = board({ mine: [bear], hand: [real('Might of Old Krosa', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect(powerOf(perm(s, 'Bear')!)).toBe(6);

    s = board({ mana: 3, mine: [bear], hand: [real('Tyvar\'s Stand', '{X}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', x: 3, targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'hexproof'), hasKw(perm(s, 'Bear')!, 'indestructible')]).toEqual([5, true, true]);

    s = board({ mine: [bear, forest, forest], hand: [real('Vines of Vastwood', '{1}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', kicked: true, targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'hexproof')]).toEqual([6, true]);
  });

  it('Invigorate: free with a Forest, an opponent gains 3 life', () => {
    const invigorate = real('Invigorate');
    let s = board({ mine: [bear, forest], hand: [invigorate] });
    const alt = castOptions(s, 0, 'h0').find((o) => o.alt !== undefined);
    expect(alt).toBeDefined();
    s = resolve(apply(s, { type: 'cast', iid: 'h0', alt: alt!.alt, targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), s.players[1].life, perm(s, 'Forest')!.tapped]).toEqual([6, 23, false]);
    // Without a Forest: not offered.
    s = board({ mine: [bear], hand: [invigorate] });
    expect(castOptions(s, 0, 'h0').some((o) => o.alt !== undefined)).toBe(false);
  });

  it('Hapatra\'s Mark, Tamiyo\'s Safekeeping, Bridgeworks Battle', () => {
    let s = board({ mine: [bear], hand: [real('Hapatra\'s Mark', '{0}')] });
    perm(s, 'Bear')!.counters = { '-1/-1': 1 };
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'hexproof')]).toEqual([2, true]);

    const rock = card({ name: 'Rock', typeLine: 'Artifact' });
    s = board({ mine: [rock], hand: [real('Tamiyo\'s Safekeeping', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Rock') }));
    expect([hasKw(perm(s, 'Rock')!, 'indestructible'), s.players[0].life]).toEqual([true, 22]);

    s = board({ mine: [bear], theirs: [creature('Ogre', 3, 3)], hand: [real('Bridgeworks Battle', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: [...target(s, 'Bear'), ...target(s, 'Ogre')] }));
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(perm(s, 'Bear')!.damage).toBe(3);
  });

  it('Green Sun\'s Zenith: a green creature with mana value X or less onto the battlefield; it goes back into the library', () => {
    let s = board({ mana: 2, hand: [real('Green Sun\'s Zenith', '{X}')] });
    const elf = creature('Elf', 1, 1, { colors: ['G'], cmc: 2 });
    const big = creature('Big', 5, 5, { colors: ['G'], cmc: 5 });
    s.players[0].library = [{ iid: 'l0', card: big }, { iid: 'l1', card: elf }, { iid: 'l2', card: bear }];
    s = resolve(apply(s, { type: 'cast', iid: 'h0', x: 2 }));
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual(['l1']);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l1'] } }));
    expect(perm(s, 'Elf')).toBeDefined();
    expect(s.players[0].graveyard).toEqual([]);
    expect(s.players[0].library.map((c) => c.card.name).sort()).toEqual(['Bear', 'Big', 'Green Sun\'s Zenith']);
  });

  it('landfall: Adventuring Gear, Tifa Lockhart, Mossborn Hydra, Scythecat Cub', () => {
    let s = board({ mine: [real('Adventuring Gear'), real('Tifa Lockhart'), real('Mossborn Hydra'), real('Scythecat Cub')], hand: [forest, forest] });
    perm(s, 'Adventuring Gear')!.attachedTo = iidOf(s, 'Tifa Lockhart');
    perm(s, 'Mossborn Hydra')!.counters = { '+1/+1': 1 };
    s = playForest(s);
    if (s.pending?.choice.kind === 'targets') s = resolve(apply(s, { type: 'choose', answer: { kind: 'targets', targets: target(s, 'Scythecat Cub') } }));
    for (let i = 0; i < 6 && s.pending; i++) {
      s = resolve(apply(s, { type: 'choose', answer: s.pending!.choice.kind === 'targets' ? { kind: 'targets', targets: target(s, 'Scythecat Cub') } : { kind: 'cards', iids: [] } }));
    }
    // Tifa: 1 doubled and +2 from the Gear (in some order): 4 or 5.
    expect(powerOf(perm(s, 'Tifa Lockhart')!)).toBeGreaterThanOrEqual(4);
    expect(perm(s, 'Mossborn Hydra')!.counters['+1/+1']).toBe(2);
    expect(perm(s, 'Scythecat Cub')!.counters['+1/+1']).toBe(1);
    // The second time this turn: the Cub's counters doubled.
    s.players[0].landPlayed = false;
    s = playForest(s);
    for (let i = 0; i < 6 && s.pending; i++) {
      s = resolve(apply(s, { type: 'choose', answer: s.pending!.choice.kind === 'targets' ? { kind: 'targets', targets: target(s, 'Scythecat Cub') } : { kind: 'cards', iids: [] } }));
    }
    expect(perm(s, 'Scythecat Cub')!.counters['+1/+1']).toBe(2);
    expect(perm(s, 'Mossborn Hydra')!.counters['+1/+1']).toBe(4);
  });

  it('Bristly Bill doubles the counters on each creature you control', () => {
    const bill = real('Bristly Bill, Spine Sower');
    let s = board({ mine: [bill, bear, forest, forest, forest, forest, forest], theirs: [creature('Ogre', 3, 3)] });
    perm(s, 'Bear')!.counters = { '+1/+1': 2 };
    perm(s, 'Ogre')!.counters = { '+1/+1': 1 };
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Bristly Bill, Spine Sower'), index: 0 }));
    expect([perm(s, 'Bear')!.counters['+1/+1'], perm(s, 'Ogre')!.counters['+1/+1']]).toEqual([4, 1]);
  });

  it('lands: Arbor Elf, Escape Tunnel, Okina, Command Beacon, Fabled Passage, Brokers Hideout', () => {
    let s = board({ mine: [real('Arbor Elf'), forest] });
    perm(s, 'Forest')!.tapped = true;
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Arbor Elf'), index: 0, targets: target(s, 'Forest') }));
    expect(perm(s, 'Forest')!.tapped).toBe(false);

    s = board({ mine: [real('Escape Tunnel'), bear], theirs: [creature('Wall', 0, 4)] });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Escape Tunnel'), index: 1, targets: target(s, 'Bear') }));
    expect(canBlock(perm(s, 'Wall')!, perm(s, 'Bear')!)).toBe(false);

    const legend = creature('Legend', 2, 2, { typeLine: 'Legendary Creature — Elf' });
    s = board({ mine: [real('Okina, Temple to the Grandfathers'), forest, legend, bear] });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Okina, Temple to the Grandfathers'), index: 0, targets: target(s, 'Bear') }))).not.toBeNull();
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Okina, Temple to the Grandfathers'), index: 0, targets: target(s, 'Legend') }));
    expect(powerOf(perm(s, 'Legend')!)).toBe(3);

    s = board({ mine: [real('Command Beacon')] });
    s.players[0].command = [{ iid: 'c0', card: legend, commander: true }];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Command Beacon'), index: 0 }));
    expect([s.players[0].command, s.players[0].hand.map((c) => c.iid)]).toEqual([[], ['c0']]);

    // Fabled Passage: the land found is untapped with four or more lands.
    s = board({ mana: 3, mine: [real('Fabled Passage')] });
    s.players[0].library = [{ iid: 'l0', card: forest }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Fabled Passage'), index: 0 }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } }));
    expect(perm(s, 'Forest')!.tapped).toBe(false);
    s = board({ mana: 2, mine: [real('Fabled Passage')] });
    s.players[0].library = [{ iid: 'l0', card: forest }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Fabled Passage'), index: 0 }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } }));
    expect(perm(s, 'Forest')!.tapped).toBe(true);

    // Brokers Hideout: sacrificed as it enters, a basic Forest, Plains or Island found, 1 life.
    s = board({ hand: [real('Brokers Hideout')] });
    s.players[0].library = [{ iid: 'l0', card: forest }, ...s.players[0].library];
    s = resolve(apply(s, { type: 'playLand', iid: 'h0' }));
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual(['l0']);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['l0'] } }));
    expect([perm(s, 'Brokers Hideout'), perm(s, 'Forest')!.tapped, s.players[0].life]).toEqual([undefined, true, 21]);
  });
});

describe('Duel Commander landfall deck, second pass', () => {
  const deck = JSON.parse(readFileSync(new URL('./fixtures/duel-commander-landfall-2026-10.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string, manaCost?: string) => {
    const c = deck.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const target = (s: GameState, name: string) => [[{ kind: 'permanent' as const, iid: iidOf(s, name) }]];
  const bear = creature('Bear', 2, 2, { typeLine: 'Creature — Bear' });
  /** Passes (both players) until the turn ends. */
  const endTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };

  it('Berserk: double power and trample, before combat damage only; destroyed at the end step if it attacked', () => {
    let s = board({ mine: [bear], hand: [real('Berserk', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'trample')]).toEqual([4, true]);
    // It didn't attack: it survives the end step.
    s = endTurn(s);
    expect(perm(s, 'Bear')).toBeDefined();

    s = board({ mine: [bear], hand: [real('Berserk', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Bear')] });
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    expect(s.players[1].life).toBe(16);
    s = endTurn(s);
    expect(perm(s, 'Bear')).toBeUndefined();

    // After combat damage (the second main phase): can't be cast.
    s = board({ mine: [bear], hand: [real('Berserk', '{0}')] });
    s.step = 'main2';
    expect(castOptions(s, 0, 'h0')).toEqual([]);
  });

  it('Embiggen: +1/+1 for each supertype, card type and subtype', () => {
    const legend = creature('Legend', 1, 1, { typeLine: 'Legendary Creature — Elf Druid' });
    let s = board({ mine: [legend], hand: [real('Embiggen', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Legend') }));
    expect(powerOf(perm(s, 'Legend')!)).toBe(5);
  });

  it('Bounty of the Hunt: three counters among one to three creatures, removed at cleanup; free by exiling a green card', () => {
    const bounty = real('Bounty of the Hunt');
    const ogre = creature('Ogre', 3, 3);
    let s = board({ mine: [bear, ogre], hand: [bounty, creature('Elf', 1, 1, { colors: ['G'] })] });
    const alt = castOptions(s, 0, 'h0').find((o) => o.alt !== undefined)!;
    expect(alt).toBeDefined();
    s = apply(s, { type: 'cast', iid: 'h0', alt: alt.alt, targets: [[...target(s, 'Bear')[0], ...target(s, 'Ogre')[0]]] });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } }));
    expect(s.pending?.choice).toMatchObject({ purpose: 'distributeTwo' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Ogre')] } }));
    expect([perm(s, 'Bear')!.counters['+1/+1'], perm(s, 'Ogre')!.counters['+1/+1']]).toEqual([1, 2]);
    s = endTurn(s);
    expect([perm(s, 'Bear')!.counters['+1/+1'], perm(s, 'Ogre')!.counters['+1/+1']]).toEqual([0, 0]);
  });

  it('Scale Up (and overloaded), Wild Shape: base power and toughness, creature type, until end of turn', () => {
    let s = board({ mine: [bear, creature('Elf', 1, 1)], hand: [real('Scale Up', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), toughnessOf(perm(s, 'Bear')!), perm(s, 'Bear')!.card.typeLine, perm(s, 'Bear')!.card.colors]).toEqual([6, 4, 'Creature — Wurm', ['G']]);
    expect(powerOf(perm(s, 'Elf')!)).toBe(1);
    s = endTurn(s);
    expect([powerOf(perm(s, 'Bear')!), perm(s, 'Bear')!.card.typeLine]).toEqual([2, 'Creature — Bear']);

    s = board({ mine: [bear, creature('Elf', 1, 1), forest, forest, forest, forest, forest, forest] });
    s.players[0].hand = [{ iid: 'h0', card: real('Scale Up') }];
    const overload = castOptions(s, 0, 'h0').find((o) => o.alt !== undefined)!;
    s = resolve(apply(s, { type: 'cast', iid: 'h0', alt: overload.alt }));
    expect([powerOf(perm(s, 'Bear')!), powerOf(perm(s, 'Elf')!)]).toEqual([6, 6]);

    s = board({ mine: [bear], hand: [real('Wild Shape', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', modes: [1], targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), toughnessOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'reach'), perm(s, 'Bear')!.card.typeLine]).toEqual([1, 5, true, 'Creature — Spider']);
  });

  it('Royal Treatment: hexproof and a Royal Role (+1/+1, ward {1}); a new Role replaces the old one', () => {
    let s = board({ mine: [bear], hand: [real('Royal Treatment', '{0}'), real('Royal Treatment', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect([powerOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'hexproof'), perm(s, 'Bear')!.statics?.ward]).toEqual([3, true, [1]]);
    s = resolve(apply(s, { type: 'cast', iid: 'h1', targets: target(s, 'Bear') }));
    expect(s.battlefield.filter((x) => x.card.name === 'Royal Role')).toHaveLength(1);
    expect(powerOf(perm(s, 'Bear')!)).toBe(3);
  });

  it('Legolas\'s Quick Reflexes: untapped, reach and hexproof, and damage equal to its power when it becomes tapped', () => {
    let s = board({ mine: [creature('Archer', 3, 3)], theirs: [bear], hand: [real('Legolas\'s Quick Reflexes', '{0}')] });
    perm(s, 'Archer')!.tapped = true;
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Archer') }));
    expect([perm(s, 'Archer')!.tapped, hasKw(perm(s, 'Archer')!, 'reach')]).toEqual([false, true]);
    // Attacking taps it: 3 damage to the Bear.
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Archer')] });
    if (s.pending?.choice.kind === 'targets') s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: target(s, 'Bear') } });
    s = resolve(s);
    expect(perm(s, 'Bear')).toBeUndefined();
    // The ability goes at end of turn.
    s = endTurn(s);
    expect(perm(s, 'Archer')!.card.oracleText).toBe('');
  });

  it('Hope of Ghirapur: the player it dealt combat damage can\'t cast noncreature spells until your next turn', () => {
    let s = board({ mine: [real('Hope of Ghirapur')], oppHand: [spell('Shock', '{0}', 'Shock deals 2 damage to any target.'), creature('Elf', 1, 1, { manaCost: '{0}' })] });
    const hope = iidOf(s, 'Hope of Ghirapur');
    expect(errorOf(() => apply(s, { type: 'activate', iid: hope, index: 0, targets: [[{ kind: 'player', player: 1 }]] }))).not.toBeNull();
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [hope] });
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    s = resolve(apply(s, { type: 'activate', iid: hope, index: 0, targets: [[{ kind: 'player', player: 1 }]] }));
    expect(perm(s, 'Hope of Ghirapur')).toBeUndefined();
    expect(s.players[1].noNoncreatureUntil).toBe(0);
    s = endTurn(s);
    // The opponent's turn: the Shock can't be cast, the Elf can.
    expect(canCastNow(s, 1, s.players[1].hand.find((c) => c.card.name === 'Shock')!.card)).toBe(false);
    expect(canCastNow(s, 1, s.players[1].hand.find((c) => c.card.name === 'Elf')!.card)).toBe(true);
    s = endTurn(s);
    expect(s.players[1].noNoncreatureUntil).toBeUndefined();
  });

  it('Talon Gates of Madara: {4} from the hand onto the battlefield; a creature phases out until its controller\'s untap step', () => {
    let s = board({ mana: 4, theirs: [bear], hand: [real('Talon Gates of Madara')] });
    s = apply(s, { type: 'channel', iid: 'h0' });
    s = resolve(s);
    if (s.pending?.choice.kind === 'targets') s = resolve(apply(s, { type: 'choose', answer: { kind: 'targets', targets: target(s, 'Bear') } }));
    expect(perm(s, 'Talon Gates of Madara')).toBeDefined();
    expect(s.players[0].landPlayed).toBe(false);
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.phasedOut?.map((x) => x.card.name)).toEqual(['Bear']);
    // Back at the start of its controller's turn.
    s = endTurn(s);
    expect(perm(s, 'Bear')).toBeDefined();
  });

  it('Defend the Rider\'s Pilot crews as though its power were 2 greater; Jeweled Amulet keeps a mana of the type spent', () => {
    let s = board({ hand: [real('Defend the Rider', '{0}')], mine: [card({ name: 'Car', typeLine: 'Artifact — Vehicle', power: '4', toughness: '4', oracleText: 'Crew 3' })] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', modes: [1] }));
    expect(perm(s, 'Pilot')).toBeDefined();
    perm(s, 'Pilot')!.sick = false;
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Car'), index: 0 });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Pilot')] } }));
    expect(isCreature(perm(s, 'Car')!.card)).toBe(true);

    s = board({ mine: [real('Jeweled Amulet'), forest] });
    const amulet = iidOf(s, 'Jeweled Amulet');
    expect(unitsOf(s, perm(s, 'Jeweled Amulet')!)).toEqual([]);
    s = resolve(apply(s, { type: 'activate', iid: amulet, index: 0 }));
    expect(perm(s, 'Jeweled Amulet')).toMatchObject({ counters: { charge: 1 }, noted: 'G' });
    // Only once while it has a charge counter.
    perm(s, 'Jeweled Amulet')!.tapped = false;
    expect(errorOf(() => apply(s, { type: 'activate', iid: amulet, index: 0 }))).toBe('activationForbidden');
    expect(unitsOf(s, perm(s, 'Jeweled Amulet')!)).toEqual([['G']]);
    s = apply(s, { type: 'tapForMana', iid: amulet });
    expect([s.players[0].pool?.[0].colors, perm(s, 'Jeweled Amulet')!.counters.charge]).toEqual([['G'], 0]);
  });
});

describe('Metagame audit 2026-10-18 evening: Chalice of the Void, Moonshadow, Shifting Woodland', () => {
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });

  it('Chalice of the Void: X charge counters; spells with that mana value are countered', () => {
    const chalice = card({
      name: 'Chalice of the Void', typeLine: 'Artifact', manaCost: '{X}{X}', cmc: 0,
      oracleText: 'This artifact enters with X charge counters on it.\nWhenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter that spell.',
    });
    let s = board({ mana: 2, hand: [chalice, creature('Elf', 1, 1, { manaCost: '{0}', cmc: 1 }), creature('Bear', 2, 2, { manaCost: '{0}', cmc: 2 })] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', x: 1 }));
    expect(perm(s, 'Chalice of the Void')!.counters.charge).toBe(1);
    // Mana value 1: countered; 2: resolves.
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Elf');
    s = resolve(apply(s, { type: 'cast', iid: 'h2' }));
    expect(perm(s, 'Bear')).toBeDefined();
    // An X spell's mana value counts X on the stack: Chalice for X=1 has mana value 2.
    s = board({ mana: 2, mine: [{ ...chalice, name: 'Old Chalice' }], hand: [chalice] });
    perm(s, 'Old Chalice')!.counters = { charge: 2 };
    s = resolve(apply(s, { type: 'cast', iid: 'h0', x: 1 }));
    expect(perm(s, 'Chalice of the Void')).toBeUndefined();
  });

  it('Moonshadow: a -1/-1 counter removed when permanent cards go to your graveyard (once for cards put there together)', () => {
    let s = board({ mine: [moonshadow], hand: [spell('Mill', '{0}', 'Mill three cards.', 'Sorcery'), spell('Opt', '{0}', 'Draw a card.')] });
    perm(s, 'Moonshadow')!.counters = { '-1/-1': 6 };
    s.players[0].library = [forest, forest, creature('Bear', 2, 2), ...s.players[0].library.map((c) => c.card)].map((c, i) => ({ iid: `l${i}`, card: c }));
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    // Three permanent cards together (a sorcery card too): one counter.
    expect(perm(s, 'Moonshadow')!.counters['-1/-1']).toBe(5);
    expect(powerOf(perm(s, 'Moonshadow')!)).toBe(2);
    // An instant card isn't a permanent card.
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    expect(perm(s, 'Moonshadow')!.counters['-1/-1']).toBe(5);
  });

  it('Shifting Woodland: with delirium, a copy of a permanent card in your graveyard until end of turn', () => {
    const woodland = card({
      name: 'Shifting Woodland', typeLine: 'Land',
      oracleText: 'This land enters tapped unless you control a Forest.\n{T}: Add {G}.\nDelirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.',
    });
    const titan = creature('Titan', 6, 6, { typeLine: 'Creature — Giant' });
    const graveTarget = (s: GameState) => [[{ kind: 'card' as const, iid: s.players[0].graveyard.find((c) => c.card.name === 'Titan')!.iid }]];
    let s = board({ mine: [woodland, forest, forest, forest, forest], grave: [titan, forest] });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Shifting Woodland'), index: 0, targets: graveTarget(s) }))).toBe('delirium');
    s.players[0].graveyard.push({ iid: 'g8', card: spell('Opt', '{U}', 'Draw a card.') }, { iid: 'g9', card: spell('Rite', '{R}', 'Add {R}.', 'Sorcery') });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Shifting Woodland'), index: 0, targets: graveTarget(s) }));
    const copy = s.battlefield.find((x) => x.card.name === 'Titan')!;
    expect([powerOf(copy), isCreature(copy.card)]).toEqual([6, true]);
    // Back to a land at end of turn.
    for (let i = 0; i < 40 && s.turn === 1; i++) s = !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, s.pending ? { type: 'choose', answer: { kind: 'cards', iids: [] } } : { type: 'pass' });
    expect(findPermanent(s, copy.iid)!.card.name).toBe('Shifting Woodland');
  });
});

describe('Metagame audit 2026-10-18 evening, second batch', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string, manaCost?: string) => {
    const c = cards.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const target = (s: GameState, name: string) => [[{ kind: 'permanent' as const, iid: iidOf(s, name) }]];
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const wastes = card({ name: 'Wastes', typeLine: 'Basic Land', oracleText: '{T}: Add {C}.' });
  const toCombat = (s: GameState) => {
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    return s;
  };
  const finishCombat = (s: GameState) => {
    for (let i = 0; i < 20 && s.step !== 'main2' && !(s.step === 'attack' && !s.priority); i++) {
      s = s.pending?.choice.kind === 'targets' ? s : !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    return s;
  };

  it('Dark Matter Manipulator: +2/+0 for every seven cards in your graveyard', () => {
    let s = board({ mana: 1, mine: [real('Dark Matter Manipulator')], grave: Array(13).fill(forest) });
    s = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Swamp') });
    expect(powerOf(perm(s, 'Dark Matter Manipulator')!)).toBe(3);
    s.players[0].graveyard.push({ iid: 'g99', card: forest });
    s = apply(s, { type: 'pass' });
    expect(powerOf(perm(s, 'Dark Matter Manipulator')!)).toBe(5);
  });

  it('Devoted Druid: a -1/-1 counter untaps it; the second one kills it', () => {
    let s = board({ mine: [real('Devoted Druid')] });
    const druid = iidOf(s, 'Devoted Druid');
    s = apply(s, { type: 'tapForMana', iid: druid });
    s = resolve(apply(s, { type: 'activate', iid: druid, index: 0 }));
    expect(perm(s, 'Devoted Druid')).toMatchObject({ tapped: false, counters: { '-1/-1': 1 } });
    s = resolve(apply(s, { type: 'activate', iid: druid, index: 0 }));
    expect(perm(s, 'Devoted Druid')).toBeUndefined();
  });

  it('Obsidian Charmaw: {1} less for each land an opponent controls that could produce {C}', () => {
    const s = board({ mana: 3, theirs: [wastes, wastes], hand: [real('Obsidian Charmaw', '{5}')] });
    expect(castOptions(s, 0, 'h0')).not.toEqual([]);
    expect(castOptions(board({ mana: 3, theirs: [wastes], hand: [real('Obsidian Charmaw', '{5}')] }), 0, 'h0')).toEqual([]);
  });

  it('Screaming Nemesis: the damage it is dealt goes to another target; a player hit can\'t gain life for the rest of the game', () => {
    let s = board({ mine: [real('Screaming Nemesis')], hand: [spell('Shock', '{0}', 'Shock deals 2 damage to any target.'), spell('Salve', '{0}', 'Target player gains 4 life.')] });
    s = apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Screaming Nemesis') });
    for (let i = 0; i < 10 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = apply(s, { type: 'pass' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] } }));
    expect(s.players[1]).toMatchObject({ life: 18, cantGainLife: true });
    s = resolve(apply(s, { type: 'cast', iid: 'h1', targets: [[{ kind: 'player', player: 1 }]] }));
    expect(s.players[1].life).toBe(18);
  });

  it('Fear of Missing Out: with delirium, its first attack each turn untaps a creature and adds a combat phase', () => {
    const fomo = real('Fear of Missing Out');
    const kinds = [forest, creature('Bear', 2, 2), spell('Opt', '{U}', 'Draw a card.'), spell('Rite', '{R}', 'Add {R}.', 'Sorcery')];
    for (const withDelirium of [true, false]) {
      let s = toCombat(board({ mine: [fomo], grave: withDelirium ? kinds : kinds.slice(0, 3) }));
      s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Fear of Missing Out')] });
      for (let i = 0; i < 6 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = apply(s, { type: 'pass' });
      if (s.pending?.choice.kind === 'targets') s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: target(s, 'Fear of Missing Out') } });
      s = finishCombat(s);
      if (withDelirium) {
        // The second combat: it attacks again (untapped), with no new trigger.
        expect([s.step, s.priority, perm(s, 'Fear of Missing Out')!.tapped]).toEqual(['attack', null, false]);
        s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Fear of Missing Out')] });
        expect(s.pending).toBeFalsy();
        s = finishCombat(s);
        expect([s.step, s.players[1].life]).toEqual(['main2', 16]);
      } else {
        expect([s.step, s.players[1].life]).toEqual(['main2', 18]);
      }
    }
  });

  it('Tamiyo: drawing a third card in a turn exiles her and returns her transformed', () => {
    const draw2 = spell('Divination', '{0}', 'Draw two cards.', 'Sorcery');
    let s = board({ mine: [real('Tamiyo, Inquisitive Student')], hand: [draw2, draw2] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.battlefield.find((x) => x.card.name.startsWith('Tamiyo, Inquisitive Student'))).toBeDefined();
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    const flipped = s.battlefield.find((x) => x.card.name.startsWith('Tamiyo, Seasoned Scholar'))!;
    expect(flipped).toMatchObject({ transformed: true });
    expect(flipped.counters.loyalty).toBeGreaterThan(0);
  });
});

describe('Casting from the graveyard: escape, Underworld Breach, Lurrus', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string, manaCost?: string) => {
    const c = cards.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const bear = creature('Bear', 2, 2, { manaCost: '{1}', cmc: 2 });
  const opt = spell('Opt', '{0}', 'Draw a card.');
  const rite = spell('Rite', '{0}', 'Add {R}.', 'Sorcery');
  const rock = card({ name: 'Rock', typeLine: 'Artifact', manaCost: '{1}', cmc: 1 });

  it('Nethergoyf: escape, exiling other cards with four or more card types among them', () => {
    let s = board({ mana: 3, grave: [real('Nethergoyf'), forest, bear, opt] });
    // Three card types among the others: not enough.
    expect(castOptions(s, 0, 'g0')).toEqual([]);
    s.players[0].graveyard.push({ iid: 'g9', card: rite });
    const escape = castOptions(s, 0, 'g0');
    expect(escape).toHaveLength(1);
    s = apply(s, { type: 'cast', iid: 'g0', alt: escape[0].alt });
    expect(s.pending?.choice).toMatchObject({ purpose: 'escapeExile', min: 1, max: 4 });
    expect(errorOf(() => apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g1', 'g2'] } }))).toBe('escapeTypes');
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g1', 'g2', 'g3', 'g9'] } }));
    expect(perm(s, 'Nethergoyf')).toBeDefined();
    expect(s.players[0].exile).toHaveLength(4);
  });

  it('Underworld Breach: nonland cards in your graveyard escape for their mana cost and three other cards; it goes at the end step', () => {
    const bolt = spell('Lightning Bolt', '{0}', 'Lightning Bolt deals 3 damage to any target.');
    let s = board({ mine: [real('Underworld Breach')], grave: [bolt, forest, forest, forest, forest] });
    // A land can't be cast.
    expect(castOptions(s, 0, 'g1')).toEqual([]);
    const escape = castOptions(s, 0, 'g0');
    expect(escape).toHaveLength(1);
    s = apply(s, { type: 'cast', iid: 'g0', alt: escape[0].alt, targets: [[{ kind: 'player', player: 1 }]] });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g1', 'g2', 'g3'] } }));
    expect(s.players[1].life).toBe(17);
    // Escaped: back to the graveyard (not exiled like flashback), and castable again.
    expect(s.players[0].graveyard.map((c) => c.card.name).sort()).toEqual(['Forest', 'Lightning Bolt']);
    expect(castOptions(s, 0, 'g0')).toEqual([]);
    for (let i = 0; i < 30 && s.turn === 1; i++) s = !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] }) : apply(s, s.pending ? { type: 'choose', answer: { kind: 'cards', iids: [] } } : { type: 'pass' });
    expect(perm(s, 'Underworld Breach')).toBeUndefined();
  });

  it('Lurrus: once during each of your turns, a permanent spell with mana value 2 or less from your graveyard', () => {
    let s = board({ mana: 4, mine: [real('Lurrus of the Dream-Den')], grave: [bear, rock, creature('Ogre', 3, 3, { manaCost: '{3}', cmc: 3 }), opt] });
    expect([castOptions(s, 0, 'g0').length, castOptions(s, 0, 'g1').length, castOptions(s, 0, 'g2').length, castOptions(s, 0, 'g3').length]).toEqual([1, 1, 0, 0]);
    s = resolve(apply(s, { type: 'cast', iid: 'g0' }));
    expect(perm(s, 'Bear')).toBeDefined();
    // Once each turn.
    expect(castOptions(s, 0, 'g1')).toEqual([]);
  });

  it('Phlage: sacrificed when cast from the hand, stays when it escaped', () => {
    let s = board({ hand: [real('Phlage, Titan of Fire\'s Fury', '{0}')] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length); i++) {
      s = s.pending?.choice.kind === 'targets' ? apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] } }) : settle(apply(s, { type: 'pass' }));
    }
    expect(perm(s, 'Phlage, Titan of Fire\'s Fury')).toBeUndefined();
    expect(s.players[1].life).toBe(17);
    // Escaped: it stays.
    const phlage = { ...real('Phlage, Titan of Fire\'s Fury'), oracleText: real('Phlage, Titan of Fire\'s Fury').oracleText.replace('{R}{R}{W}{W}', '{0}') };
    s = board({ grave: [phlage, forest, forest, forest, forest, forest] });
    s = apply(s, { type: 'cast', iid: 'g0', alt: castOptions(s, 0, 'g0')[0].alt });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g1', 'g2', 'g3', 'g4', 'g5'] } });
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length); i++) {
      s = s.pending?.choice.kind === 'targets' ? apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] } }) : settle(apply(s, { type: 'pass' }));
    }
    expect(perm(s, 'Phlage, Titan of Fire\'s Fury')).toBeDefined();
  });
});

describe('cEDH: Tinder Wall, Grand Abolisher, Necropotence, The Cabbage Merchant, Shang-Chi', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string) => cards.find((x) => x.name.startsWith(name))!;
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const passTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };

  it('Tinder Wall: sacrificed for {R}{R}; what a payment doesn\'t use stays in the pool', () => {
    let s = board({ mine: [real('Tinder Wall')], hand: [creature('Goblin', 1, 1, { manaCost: '{R}', cmc: 1 })] });
    perm(s, 'Tinder Wall')!.sick = true;
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect([perm(s, 'Tinder Wall'), perm(s, 'Goblin') !== undefined, s.players[0].pool?.map((m) => m.colors)]).toEqual([undefined, true, [['R']]]);
  });

  it('Grand Abolisher: during its controller\'s turn, opponents cast nothing and use no artifact, creature or enchantment ability', () => {
    const elf = creature('Elf', 1, 1, { oracleText: '{T}: Add {G}.' });
    const s = board({ mine: [real('Grand Abolisher')], theirs: [elf], oppMana: 1, oppHand: [spell('Shock', '{0}', 'Shock deals 2 damage to any target.')] });
    s.priority = { player: 1, passes: 0, reason: 'main' };
    expect(canCastNow(s, 1, s.players[1].hand[0].card)).toBe(false);
    expect(canTapForMana(s, perm(s, 'Elf')!)).toBe(false);
    expect(canTapForMana(s, perm(s, 'Island')!)).toBe(true);
    // On the opponent's turn: no effect.
    s.active = 1;
    expect(canCastNow(s, 1, s.players[1].hand[0].card)).toBe(true);
  });

  it('Necropotence: no draw step; 1 life sets the top card aside until your end step; discarded cards are exiled', () => {
    let s = board({ mine: [real('Necropotence')], hand: [spell('Rummage', '{0}', 'Discard a card, then draw a card.', 'Sorcery'), creature('Bear', 2, 2)] });
    const top = s.players[0].library[0].iid;
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Necropotence'), index: 0 }));
    expect([s.players[0].life, s.players[0].exile.map((c) => c.iid)]).toEqual([19, [top]]);
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    if (s.pending) s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } }));
    expect(s.players[0].exile.map((c) => c.card.name)).toContain('Bear');
    const hand = s.players[0].hand.length;
    s = passTurn(s);
    // Its end step: the card set aside comes to the hand.
    expect(s.players[0].hand.some((c) => c.iid === top)).toBe(true);
    expect(s.players[0].hand.length).toBe(hand + 1);
    // The next turn: no card drawn.
    s = passTurn(s);
    expect(s.players[0].hand.length).toBe(hand + 1);
  });

  it('The Cabbage Merchant: Food for opponents\' noncreature spells, one sacrificed when a creature hits you; two Foods tap for a mana', () => {
    let s = board({ mine: [real('The Cabbage Merchant')], oppHand: [spell('Shock', '{0}', 'Shock deals 2 damage to any target.')], hand: [creature('Goblin', 1, 1, { manaCost: '{R}', cmc: 1 })] });
    s.priority = { player: 1, passes: 0, reason: 'main' };
    s = resolve(apply(s, { type: 'cast', iid: 'o0', targets: [[{ kind: 'player', player: 0 }]] }));
    expect(s.battlefield.filter((x) => x.card.name === 'Food')).toHaveLength(1);
    // Two Foods: one mana of any color (both tapped).
    s.battlefield.push({ ...s.battlefield.find((x) => x.card.name === 'Food')!, iid: 'food2' });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Goblin')).toBeDefined();
    expect(s.battlefield.filter((x) => x.card.name === 'Food').every((x) => x.tapped)).toBe(true);
    // The opponent's creature deals combat damage to me: a Food is sacrificed.
    s.battlefield.push({ iid: 'ogre', card: creature('Ogre', 3, 3), controller: 1, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] });
    s = passTurn(s);
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 6 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: ['ogre'] });
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    s = resolve(s);
    expect([s.players[0].life, s.pending?.choice]).toMatchObject([15, { kind: 'cards' }]);
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [(s.pending!.choice as { options: { iid: string }[] }).options[0].iid] } }));
    expect(s.battlefield.filter((x) => x.card.name === 'Food')).toHaveLength(1);
  });

  it('Shang-Chi: creatures\' abilities as though they had haste', () => {
    const elf = creature('Elf', 1, 1, { oracleText: '{T}: Add {G}.' });
    const s = board({ mine: [elf] });
    perm(s, 'Elf')!.sick = true;
    expect(canTapForMana(s, perm(s, 'Elf')!)).toBe(false);
    const t = board({ mine: [elf, real('Shang-Chi, Master of Kung Fu')] });
    perm(t, 'Elf')!.sick = true;
    expect(canTapForMana(t, perm(t, 'Elf')!)).toBe(true);
  });
});

describe('Metagame audit 2026-10-18 evening, third batch', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string, manaCost?: string) => {
    const c = cards.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const land = (name: string, type: string) => card({ name, typeLine: `Basic Land — ${type}` });
  const forest = land('Forest', 'Forest');
  const legend = creature('Legend', 1, 1, { typeLine: 'Legendary Creature — Elf' });

  it('Solitary Cell: discarding a legendary card draws one', () => {
    let s = board({ mana: 1, mine: [real('Solitary Cell')], hand: [creature('Bear', 2, 2), legend] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Solitary Cell'), index: 0 });
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).toEqual(['h1']);
  });

  it('Leyline Binding: {1} less for each basic land type among your lands', () => {
    const s = board({ mine: [land('Plains', 'Plains'), land('Island', 'Island'), land('Swamp', 'Swamp'), land('Mountain', 'Mountain'), forest], hand: [real('Leyline Binding')] });
    expect(castCost(s, 0, real('Leyline Binding'), {}).generic).toBe(0);
  });

  it('Tectonic Edge: only if an opponent controls four or more lands', () => {
    const s = board({ mana: 1, mine: [real('Tectonic Edge')], oppMana: 3, theirs: [card({ name: 'Ruins', typeLine: 'Land' })] });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Tectonic Edge'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ruins') }]] }))).toBeNull();
    const t = board({ mana: 1, mine: [real('Tectonic Edge')], oppMana: 2, theirs: [card({ name: 'Ruins', typeLine: 'Land' })] });
    expect(errorOf(() => apply(t, { type: 'activate', iid: iidOf(t, 'Tectonic Edge'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(t, 'Ruins') }]] }))).toBe('activationForbidden');
  });

  it('Boromir: counters an opponent\'s spell cast without mana, not yours', () => {
    const free = creature('Ornithopter', 0, 2, { manaCost: '{0}', cmc: 0 });
    let s = board({ mine: [real('Boromir, Warden of the Tower')], hand: [free] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Ornithopter')).toBeDefined();
    s = board({ theirs: [real('Boromir, Warden of the Tower')], hand: [free] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(perm(s, 'Ornithopter')).toBeUndefined();
  });

  it('Jace, Wielder of Mysteries: drawing from an empty library wins', () => {
    let s = board({ mine: [real('Jace, Wielder of Mysteries')], hand: [spell('Opt', '{0}', 'Draw a card.')] });
    perm(s, 'Jace, Wielder of Mysteries')!.counters = { loyalty: 4 };
    s.players[0].library = [];
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.winner).toBe(0);
  });

  it('Karn, Argent Defender: creatures entering trigger nothing', () => {
    const elf = creature('Elf', 1, 1, { manaCost: '{0}', oracleText: 'When this creature enters, draw a card.' });
    let s = board({ mine: [real('Karn, Argent Defender')], hand: [elf] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('Archivist of Oghma: 1 life and a card when an opponent searches their library', () => {
    const tutor = spell('Tutor', '{0}', 'Search your library for a card, put it into your hand, then shuffle.', 'Sorcery');
    let s = board({ theirs: [real('Archivist of Oghma')], hand: [tutor] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length); i++) s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'cards', iids: [] } }) : settle(apply(s, { type: 'pass' }));
    expect([s.players[1].life, s.players[1].hand.length]).toEqual([21, 1]);
  });

  it('Theorist\'s Sanctum: untapped when you can behold a Jace', () => {
    let s = board({ hand: [real('Theorist\'s Sanctum')] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(perm(s, 'Theorist\'s Sanctum')!.tapped).toBe(true);
    s = board({ hand: [real('Theorist\'s Sanctum'), real('Jace, Wielder of Mysteries')] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(perm(s, 'Theorist\'s Sanctum')!.tapped).toBe(false);
  });

  it('Relic of Progenitus: a player exiles a card of their choice; exiled itself: all graveyards, and a card', () => {
    let s = board({ mana: 1, mine: [real('Relic of Progenitus')], grave: [forest, legend] });
    s.players[1].graveyard = [{ iid: 'og0', card: forest }];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Relic of Progenitus'), index: 0, targets: [[{ kind: 'player', player: 0 }]] }));
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g1'] } }));
    expect(s.players[0].graveyard.map((c) => c.iid)).toEqual(['g0']);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Relic of Progenitus'), index: 1 }));
    expect([s.players[0].graveyard.length, s.players[1].graveyard.length, perm(s, 'Relic of Progenitus'), s.players[0].hand.length]).toEqual([0, 0, undefined, 1]);
  });

  it('Faerie Macabre: discarded from the hand for free, exiles up to two cards from graveyards', () => {
    let s = board({ hand: [real('Faerie Macabre')], grave: [forest] });
    s.players[1].graveyard = [{ iid: 'og0', card: legend }];
    s = resolve(apply(s, { type: 'channel', iid: 'h0', targets: [[{ kind: 'card', iid: 'g0' }, { kind: 'card', iid: 'og0' }]] }));
    expect([s.players[0].graveyard.map((c) => c.card.name), s.players[1].graveyard.length]).toEqual([['Faerie Macabre'], 0]);
  });
});

describe('Granted abilities, bestow, Kaito, Murktide Regent, Inti', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string, manaCost?: string) => {
    const c = cards.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const target = (s: GameState, name: string) => [[{ kind: 'permanent' as const, iid: iidOf(s, name) }]];
  const bear = creature('Bear', 2, 2);
  const passTurn = (s: GameState) => {
    const turn = s.turn;
    for (let i = 0; i < 40 && s.turn === turn && s.winner === null; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'attack' ? apply(s, { type: 'declareAttackers', attackers: [] })
        : apply(s, { type: 'pass' });
    }
    return s;
  };
  const attackWith = (s: GameState, name: string) => {
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 6 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, name)] });
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } })
        : !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    }
    for (let i = 0; i < 6 && (s.pending || s.stack.length); i++) {
      s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } }) : apply(s, { type: 'pass' });
    }
    return resolve(s);
  };

  it('Curious Obsession: +1/+1 and a card when the creature deals combat damage; sacrificed if you didn\'t attack', () => {
    let s = board({ mine: [bear], hand: [real('Curious Obsession', '{0}')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect(powerOf(perm(s, 'Bear')!)).toBe(3);
    s = attackWith(s, 'Bear');
    expect([s.players[1].life, s.players[0].hand.length]).toEqual([17, 1]);
    s = passTurn(passTurn(s));
    // A turn without attacking: the Aura is sacrificed at the end step.
    s = passTurn(s);
    expect(perm(s, 'Curious Obsession')).toBeUndefined();
  });

  it('Detective\'s Phoenix: bestowed (collect evidence 6) from the graveyard; a creature again when its host leaves', () => {
    const ogre = creature('Ogre', 3, 3, { cmc: 6 });
    let s = board({ mine: [bear, card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' })], grave: [real('Detective\'s Phoenix'), ogre], hand: [spell('Blast', '{0}', 'Blast deals 5 damage to any target.')] });
    const bestow = castOptions(s, 0, 'g0');
    expect(bestow).toHaveLength(1);
    s = apply(s, { type: 'cast', iid: 'g0', alt: bestow[0].alt, targets: target(s, 'Bear') });
    expect(s.pending?.choice).toMatchObject({ purpose: 'collectEvidence' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['g1'] } }));
    expect([powerOf(perm(s, 'Bear')!), hasKw(perm(s, 'Bear')!, 'flying'), isCreature(perm(s, 'Detective\'s Phoenix')!.card)]).toEqual([4, true, false]);
    s = resolve(apply(s, { type: 'cast', iid: 'h0', targets: target(s, 'Bear') }));
    expect(perm(s, 'Bear')).toBeUndefined();
    s = apply(s, { type: 'pass' });
    const phoenix = perm(s, 'Detective\'s Phoenix')!;
    expect([isCreature(phoenix.card), phoenix.attachedTo, powerOf(phoenix)]).toEqual([true, undefined, 2]);
  });

  it('Kaito: a 3/4 Ninja creature with hexproof during your turn; −2 stuns, 0 surveils and draws', () => {
    let s = board({ mine: [real('Kaito, Bane of Nightmares')], theirs: [bear] });
    const kaito = perm(s, 'Kaito, Bane of Nightmares')!;
    kaito.counters = { loyalty: 4 };
    s = apply(s, { type: 'pass' });
    const k = perm(s, 'Kaito, Bane of Nightmares')!;
    expect([isCreature(k.card), powerOf(k), hasKw(k, 'hexproof')]).toEqual([true, 3, true]);
    s = passTurn(s);
    expect(isCreature(perm(s, 'Kaito, Bane of Nightmares')!.card)).toBe(false);
    s = passTurn(s);
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Kaito, Bane of Nightmares'), index: activatedOf(real('Kaito, Bane of Nightmares')).findIndex((a) => a.cost.loyalty === -2), targets: target(s, 'Bear') }));
    expect(perm(s, 'Bear')).toMatchObject({ tapped: true, counters: { stun: 2 } });
  });

  it('Murktide Regent: counters for the instants and sorceries delved; one more when such a card leaves your graveyard', () => {
    const opt = spell('Opt', '{U}', 'Draw a card.');
    let s = board({ mana: 1, hand: [real('Murktide Regent', '{6}')], grave: [opt, opt, card({ name: 'Island', typeLine: 'Basic Land — Island' }), opt, spell('Rite', '{R}', 'Add {R}.', 'Sorcery')] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    const regent = perm(s, 'Murktide Regent')!;
    expect(s.players[0].graveyard).toHaveLength(0);
    expect(regent.counters['+1/+1']).toBe(4);
    // An instant leaving the graveyard later: one more.
    s.players[0].graveyard.push({ iid: 'g9', card: opt });
    s = apply(s, { type: 'pass' });
    s.players[0].graveyard = [];
    s = resolve(apply(s, { type: 'pass' }));
    expect(perm(s, 'Murktide Regent')!.counters['+1/+1']).toBe(5);
  });

  it('Inti: discarding exiles the top card, playable until your next end step', () => {
    let s = board({ mine: [real('Inti, Seneschal of the Sun')], hand: [spell('Rummage', '{0}', 'Discard two cards, then draw two cards.', 'Sorcery'), bear, bear] });
    s.players[0].library = [0, 1, 2, 3].map((i) => ({ iid: `l${i}`, card: creature('Elf', 1, 1, { manaCost: '{0}', cmc: 0 }) }));
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    if (s.pending) s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1', 'h2'] } }));
    // Two cards discarded together: one card exiled (the third: two were drawn first).
    expect(s.players[0].exile.map((c) => c.iid)).toEqual(['l2']);
    expect(castOptions(s, 0, 'l2')).toHaveLength(1);
    s = passTurn(s);
    expect(castOptions(s, 0, 'l2')).toEqual([]);
  });
});

describe('The bot uses the new abilities', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const landfall = JSON.parse(readFileSync(new URL('./fixtures/duel-commander-landfall-2026-10.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string) => [...cards, ...landfall].find((x) => x.name.startsWith(name))!;
  /** The bot (player 1) acting in its own main phase. */
  const botTurn = (s: GameState) => {
    s.active = 1;
    s.turnHead = 1;
    s.players[1].landPlayed = true;
    return s;
  };

  it('Hope of Ghirapur: sacrificed to lock the player it hit', () => {
    const s = botTurn(board({ theirs: [real('Hope of Ghirapur')] }));
    s.step = 'main2';
    expect(botAction(s)).toMatchObject({ type: 'pass' });
    s.combatDamagedBy = { [iidOf(s, 'Hope of Ghirapur')]: [0] };
    expect(botAction(s)).toMatchObject({ type: 'activate', iid: iidOf(s, 'Hope of Ghirapur'), targets: [[{ kind: 'player', player: 0 }]] });
  });

  it('Necropotence: cards for life while it has 12 or more, three a turn at most', () => {
    const s = botTurn(board({ theirs: [real('Necropotence')] }));
    s.step = 'main2';
    expect(botAction(s)).toMatchObject({ type: 'activate', iid: iidOf(s, 'Necropotence') });
    s.handAtEndStep = [0, 1, 2].map((i) => ({ p: 1, iid: `x${i}` }));
    expect(botAction(s)).toMatchObject({ type: 'pass' });
    s.handAtEndStep = [];
    s.players[1].life = 11;
    expect(botAction(s)).toMatchObject({ type: 'pass' });
  });

  it('Relic of Progenitus: a card of the opponent\'s graveyard; all graveyards only when theirs is full', () => {
    const s = botTurn(board({ theirs: [real('Relic of Progenitus')], oppMana: 1 }));
    s.step = 'main2';
    expect(botAction(s)).toMatchObject({ type: 'pass' });
    s.players[0].graveyard = [0, 1].map((i) => ({ iid: `g${i}`, card: creature('Bear', 2, 2) }));
    expect(botAction(s)).toMatchObject({ type: 'activate', index: 0, targets: [[{ kind: 'player', player: 0 }]] });
  });

  it('Phyrexian Devourer: grows while its power is 2 or less', () => {
    const devourer = card({
      name: 'Phyrexian Devourer', typeLine: 'Artifact Creature — Phyrexian Construct', manaCost: '{6}', cmc: 6, power: '1', toughness: '1',
      oracleText: 'When this creature\'s power is 7 or greater, sacrifice it.\nExile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card\'s mana value.',
    });
    const s = botTurn(board({ theirs: [devourer] }));
    s.step = 'main2';
    expect(botAction(s)).toMatchObject({ type: 'activate', iid: iidOf(s, 'Phyrexian Devourer') });
    perm(s, 'Phyrexian Devourer')!.counters = { '+1/+1': 3 };
    expect(botAction(s)).toMatchObject({ type: 'pass' });
  });

  it('Talon Gates of Madara: put onto the battlefield for {4} at the end of the opponent\'s turn', () => {
    const s = board({ oppMana: 4 });
    s.players[1].hand = [{ iid: 'o0', card: real('Talon Gates of Madara') }];
    s.priority = { player: 1, passes: 0, reason: 'end' };
    expect(botAction(s)).toMatchObject({ type: 'channel', iid: 'o0' });
  });
});

describe('Ninjutsu', () => {
  const ninja = creature('Ingenious Infiltrator', 2, 3, {
    typeLine: 'Creature — Vedalken Ninja', manaCost: '{2}{U}{B}', cmc: 4,
    oracleText: 'Ninjutsu {U}{B} ({U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nWhenever a Ninja you control deals combat damage to a player, draw a card.',
  });
  const islandSwamp = card({ name: 'Watery Grave', typeLine: 'Land — Island Swamp', oracleText: '({T}: Add {U} or {B}.)' });
  const toBlocks = (s: GameState, attackers: string[]) => {
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 6 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers });
    // Until the window after blockers (the opponent has nothing to block with: no declaration).
    for (let i = 0; i < 10 && s.priority?.reason !== 'block'; i++) s = !s.priority && s.step === 'block' ? apply(s, { type: 'declareBlockers', blocks: {} }) : apply(s, { type: 'pass' });
    return s;
  };

  it('returns an unblocked attacker; the Ninja enters tapped and attacking, unblocked', () => {
    let s = board({ mine: [creature('Rat', 1, 1), islandSwamp, islandSwamp], hand: [ninja] });
    // Not before blockers.
    expect(errorOf(() => apply(s, { type: 'ninjutsu', iid: 'h0', attacker: iidOf(s, 'Rat') }))).not.toBeNull();
    s = toBlocks(s, [iidOf(s, 'Rat')]);
    expect(s.priority?.reason).toBe('block');
    s = apply(s, { type: 'ninjutsu', iid: 'h0', attacker: iidOf(s, 'Rat') });
    for (let i = 0; i < 20 && s.step !== 'main2'; i++) s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }) : apply(s, { type: 'pass' });
    for (let i = 0; i < 5 && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    expect(s.players[0].hand.map((c) => c.card.name)).toContain('Rat');
    expect(perm(s, 'Ingenious Infiltrator')!.tapped).toBe(true);
    expect(s.players[1].life).toBe(18);
    // Its trigger: a card.
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('the bot swaps a weaker unblocked attacker for its Ninja', () => {
    let s = board({ mine: [creature('Rat', 1, 1), islandSwamp, islandSwamp], hand: [ninja] });
    s = toBlocks(s, [iidOf(s, 'Rat')]);
    expect(botAction(s)).toMatchObject({ type: 'ninjutsu', iid: 'h0', attacker: iidOf(s, 'Rat') });
  });
});

describe('Metagame audit 2026-10-18 evening, fifth batch', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-18.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string, manaCost?: string) => {
    const c = cards.find((x) => x.name.startsWith(name))!;
    return manaCost === undefined ? c : { ...c, manaCost };
  };
  const resolve = (s: GameState) => {
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length) && !s.pending; i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };
  const forest = () => card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
  const goblin = creature('Goblin Guide', 2, 2, { typeLine: 'Creature — Goblin Scout', manaCost: '{2}{R}', cmc: 3 });

  it('cost changes: Helm of Awakening, Goblin Warchief, God-Pharaoh\'s Statue', () => {
    const s = board({ mine: [real('Helm of Awakening'), real('Goblin Warchief'), real('God-Pharaoh\'s Statue')] });
    const bear = creature('Bear', 2, 2, { manaCost: '{3}{G}', cmc: 4 });
    // Mine: {1} less from each (the Goblin), {1} less (the Bear); the opponent's: {1} less, {2} more.
    expect([castCost(s, 0, goblin, {}).generic, castCost(s, 0, bear, {}).generic, castCost(s, 1, bear, {}).generic]).toEqual([0, 2, 4]);
  });

  it('Hollow One: {2} less for each card cycled or discarded this turn', () => {
    let s = board({ hand: [real('Hollow One'), spell('Rummage', '{0}', 'Discard two cards, then draw two cards.', 'Sorcery'), forest(), forest()] });
    expect(castCost(s, 0, real('Hollow One'), {}).generic).toBe(5);
    s = resolve(apply(s, { type: 'cast', iid: 'h1' }));
    if (s.pending) s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h2', 'h3'] } }));
    expect(castCost(s, 0, real('Hollow One'), {}).generic).toBe(1);
  });

  it('Triskelion: a +1/+1 counter for 1 damage', () => {
    let s = board({ mine: [real('Triskelion')] });
    perm(s, 'Triskelion')!.counters = { '+1/+1': 3 };
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Triskelion'), index: 0, targets: [[{ kind: 'player', player: 1 }]] }));
    expect([s.players[1].life, perm(s, 'Triskelion')!.counters['+1/+1']]).toEqual([19, 2]);
  });

  it('Deathrite Shaman: a land card exiled from a graveyard for a mana of any color', () => {
    let s = board({ mine: [real('Deathrite Shaman')] });
    s.players[1].graveyard = [{ iid: 'og0', card: forest() }];
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Deathrite Shaman'), index: 0, targets: [[{ kind: 'card', iid: 'og0' }]] }));
    expect([s.players[1].exile.length, s.players[0].pool?.[0].colors]).toEqual([1, ['W', 'U', 'B', 'R', 'G']]);
  });

  it('Attunement: back to the hand to draw three and discard four', () => {
    let s = board({ mine: [real('Attunement')], hand: Array(5).fill(forest()) });
    s = resolve(apply(s, { type: 'activate', iid: iidOf(s, 'Attunement'), index: 0 }));
    if (s.pending) s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: s.players[0].hand.filter((c) => c.card.name === 'Forest').slice(0, 4).map((c) => c.iid) } }));
    expect(perm(s, 'Attunement')).toBeUndefined();
    expect(s.players[0].hand.map((c) => c.card.name)).toContain('Attunement');
  });

  it('Goblin Lackey: a Goblin permanent from the hand when it deals damage to a player', () => {
    let s = board({ mine: [real('Goblin Lackey')], hand: [goblin] });
    s = apply(s, { type: 'pass' });
    for (let i = 0; i < 6 && (s.priority || s.step !== 'attack'); i++) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Goblin Lackey')] });
    for (let i = 0; i < 20 && !s.pending && s.step !== 'main2'; i++) s = apply(s, { type: 'pass' });
    for (let i = 0; i < 10 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = apply(s, { type: 'pass' });
    // "you may": yes, then which Goblin.
    if (s.pending?.choice.kind === 'yesNo') s = apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } });
    for (let i = 0; i < 10 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = apply(s, { type: 'pass' });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards' });
    s = resolve(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0'] } }));
    expect(perm(s, 'Goblin Guide')).toBeDefined();
  });

  it('Aurora Eidolon: back to the hand from the graveyard when you cast a multicolored spell', () => {
    let s = board({ grave: [real('Aurora Eidolon')], hand: [spell('Helix', '{0}', 'You gain 3 life.', 'Instant'), { ...spell('Helix', '{0}', 'You gain 3 life.'), name: 'Lightning Helix', colors: ['R', 'W'] }] });
    s = resolve(apply(s, { type: 'cast', iid: 'h0' }));
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Aurora Eidolon');
    s = apply(s, { type: 'cast', iid: 'h1' });
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length); i++) s = s.pending ? apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } }) : settle(apply(s, { type: 'pass' }));
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Aurora Eidolon']);
  });

  it('Chancellor of the Annex: each opponent spell countered unless they pay {1}', () => {
    let s = board({ theirs: [real('Chancellor of the Annex')], hand: [creature('Bear', 2, 2, { manaCost: '{0}', cmc: 0 })] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    for (let i = 0; i < 10 && (s.stack.length || s.triggered?.length); i++) s = s.pending ? apply(s, { type: 'choose', answer: s.pending.choice.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : { kind: 'cards', iids: [] } }) : settle(apply(s, { type: 'pass' }));
    expect(perm(s, 'Bear')).toBeUndefined();
  });

});

describe('Metagame audit 2026-10-21', () => {
  const cards = JSON.parse(readFileSync(new URL('./fixtures/metagame-2026-10-21.json', import.meta.url), 'utf8')) as Card[];
  const real = (name: string) => cards.find((x) => x.name === name)!;
  const run = (s: GameState) => {
    for (let i = 0; i < 12 && !s.pending && (s.stack.length || s.triggered?.length); i++) s = settle(apply(s, { type: 'pass' }));
    return s;
  };

  it('Terravore and Unlicensed Hearse: power and toughness counted from graveyards and from the cards exiled with it', () => {
    const [terravore, hearse] = [real('Terravore'), real('Unlicensed Hearse')];
    const ogre = creature('Ogre', 2, 2);
    let s = board({ mine: [terravore, hearse, ogre], grave: [swamp, ogre] });
    s.players[1].graveyard = [{ iid: 'x0', card: island }, { iid: 'x1', card: island }];
    // Three land cards among both graveyards (statics are refreshed by any action).
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Unlicensed Hearse'), index: 1 });
    expect([powerOf(perm(s, 'Terravore')!), toughnessOf(perm(s, 'Terravore')!)]).toEqual([3, 3]);
    s = board({ mine: [terravore, hearse, ogre], grave: [swamp, ogre] });
    s.players[1].graveyard = [{ iid: 'x0', card: island }, { iid: 'x1', card: island }];
    // "from a single graveyard": not one of each.
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Unlicensed Hearse'), index: 0, targets: [[{ kind: 'card', iid: 'g0' }, { kind: 'card', iid: 'x0' }]] }))).toBe('illegalTarget');
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Unlicensed Hearse'), index: 0, targets: [[{ kind: 'card', iid: 'x0' }, { kind: 'card', iid: 'x1' }]] })));
    expect(s.players[1].exile).toHaveLength(2);
    expect([powerOf(perm(s, 'Terravore')!), toughnessOf(perm(s, 'Terravore')!)]).toEqual([1, 1]);
    // Crewed: a 2/2.
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Unlicensed Hearse'), index: 1 });
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Ogre')] } }));
    const crewed = perm(s, 'Unlicensed Hearse')!;
    expect([powerOf(crewed), toughnessOf(crewed)]).toEqual([2, 2]);
  });

  it('Keen-Eyed Curator: +4/+4 and trample with four card types among the cards it exiled', () => {
    const bolt = spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.');
    const rite = card({ name: 'Rite', typeLine: 'Sorcery', manaCost: '{B}', cmc: 1, oracleText: 'Draw a card.' });
    const ogre = creature('Ogre', 2, 2);
    let s = board({ mana: 4, mine: [real('Keen-Eyed Curator')] });
    s.players[1].graveyard = [swamp, bolt, rite, ogre].map((c, i) => ({ iid: `x${i}`, card: c }));
    for (let i = 0; i < 4; i++) {
      expect([powerOf(perm(s, 'Keen-Eyed Curator')!), hasKw(perm(s, 'Keen-Eyed Curator')!, 'trample')]).toEqual([3, false]);
      s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Keen-Eyed Curator'), index: 0, targets: [[{ kind: 'card', iid: `x${i}` }]] })));
    }
    expect([powerOf(perm(s, 'Keen-Eyed Curator')!), toughnessOf(perm(s, 'Keen-Eyed Curator')!), hasKw(perm(s, 'Keen-Eyed Curator')!, 'trample')]).toEqual([7, 7, true]);
  });

  it('Fountainport: "Sacrifice a token" as a cost', () => {
    let s = board({ mana: 6, mine: [real('Fountainport')] });
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Fountainport'), index: 0 }))).toBe('nothingToSacrifice');
    // A Fish (1 life), then the Fish for a card.
    s = run(settle(apply(s, { type: 'activate', iid: iidOf(s, 'Fountainport'), index: 1 })));
    expect([perm(s, 'Fish')?.card.typeLine, s.players[0].life]).toEqual(['Token Creature — Fish', 19]);
    perm(s, 'Fountainport')!.tapped = false;
    const hand = s.players[0].hand.length;
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Fountainport'), index: 0 });
    expect(s.pending?.choice).toMatchObject({ purpose: 'sacrificeCost', options: [{ card: { name: 'Fish' } }] });
    s = run(settle(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Fish')] } })));
    expect([perm(s, 'Fish'), s.players[0].hand.length]).toEqual([undefined, hand + 1]);
  });

  it('Overgrown Battlement and Bloom Tender: mana counted from the board', () => {
    const wall = creature('Wall of Roots', 0, 5, { keywords: ['Defender'], oracleText: 'Defender' });
    const relic = card({ name: 'Relic', typeLine: 'Artifact', manaCost: '{U}{R}', colors: ['U', 'R'] });
    const s = board({ mine: [real('Overgrown Battlement'), wall, real('Bloom Tender'), relic] });
    let t = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Overgrown Battlement') });
    expect(t.players[0].pool?.map((m) => m.colors)).toEqual([['G'], ['G']]);
    // Green (Bloom Tender itself), blue and red.
    t = apply(s, { type: 'tapForMana', iid: iidOf(s, 'Bloom Tender') });
    expect(t.players[0].pool?.map((m) => m.colors)).toEqual([['U'], ['R'], ['G']]);
  });

  it('Quirion Ranger: a Forest back to the hand untaps a creature, once each turn', () => {
    const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
    const ogre = creature('Ogre', 2, 2);
    let s = board({ mine: [real('Quirion Ranger'), forest, ogre] });
    perm(s, 'Ogre')!.tapped = true;
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Quirion Ranger'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] });
    expect(s.pending?.choice).toMatchObject({ purpose: 'returnCost', options: [{ card: { name: 'Forest' } }] });
    s = run(settle(apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Forest')] } })));
    expect([perm(s, 'Forest'), s.players[0].hand.map((c) => c.card.name), perm(s, 'Ogre')!.tapped]).toEqual([undefined, ['Forest'], false]);
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Quirion Ranger'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] }))).toBe('onceEachTurn');
  });

  it('Shark Typhoon: cycled for X, an X/X flying Shark; on the battlefield, a Shark the size of each noncreature spell', () => {
    const typhoon = real('Shark Typhoon');
    let s = board({ mana: 5, hand: [typhoon] });
    s.battlefield.filter((x) => x.card.name === 'Swamp').forEach((x) => (x.card = island));
    expect(cycleMaxX(s, 0, typhoon)).toBe(3);
    s = run(settle(apply(s, { type: 'cycle', iid: 'h0', x: 3 })));
    const shark = perm(s, 'Shark')!;
    expect([powerOf(shark), toughnessOf(shark), hasKw(shark, 'flying'), shark.controller]).toEqual([3, 3, true, 0]);
    expect(s.players[0].hand).toHaveLength(1); // the cycling's card
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Shark Typhoon']);
    // The bot cycles it for as much as it can.
    const b = board({ mana: 4, hand: [typhoon] });
    b.battlefield.forEach((x) => (x.card = island));
    b.step = 'main2';
    expect(botAction(b)).toMatchObject({ type: 'cycle', x: 2 });

    const growth = { ...spell('Growth', '{X}{G}', 'Draw X cards.', 'Sorcery'), cmc: 1 };
    let t = board({ mana: 4, mine: [typhoon], hand: [growth] });
    t.battlefield.forEach((x) => { if (x.card.name === 'Swamp') x.card = card({ name: 'Forest', typeLine: 'Basic Land — Forest' }); });
    t = run(settle(apply(t, { type: 'cast', iid: 'h0', x: 3 })));
    expect([powerOf(perm(t, 'Shark')!), toughnessOf(perm(t, 'Shark')!)]).toEqual([4, 4]);
  });

  it('Mesmeric Fiend: a nonland card exiled from the opponent\'s hand, back when it leaves', () => {
    const fiend = real('Mesmeric Fiend');
    const bolt = spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.');
    let s = board({ mana: 2, hand: [fiend], oppHand: [island, bolt] });
    s = settle(apply(s, { type: 'cast', iid: 'h0' }));
    for (let i = 0; i < 10 && s.pending?.choice.purpose !== 'exileChosen'; i++) {
      s = s.pending?.choice.kind === 'targets' ? apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'player', player: 1 }]] } }) : settle(apply(s, { type: 'pass' }));
    }
    expect(s.pending?.choice).toMatchObject({ purpose: 'exileChosen', options: [{ card: { name: 'Bolt' } }] });
    s = run(apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['o1'] } }));
    expect([s.players[1].hand.map((c) => c.card.name), s.players[1].exile.map((c) => c.card.name)]).toEqual([['Island'], ['Bolt']]);
    // It dies: the Bolt goes back to its owner's hand.
    const fiendPerm = perm(s, 'Mesmeric Fiend')!;
    fiendPerm.damage = 5;
    s = run(settle(apply(s, { type: 'pass' })));
    expect(perm(s, 'Mesmeric Fiend')).toBeUndefined();
    expect(s.players[1].hand.map((c) => c.card.name).sort()).toEqual(['Bolt', 'Island']);
  });
});
