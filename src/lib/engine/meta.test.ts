import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { activationProblem, actor, apply, canBlock, canCastNow, castCost, canTapForMana, type Answer, castOptions, IllegalAction, isLegalTarget, newGame, powerOf, toughnessOf, unitsOf, type GameState, type Permanent, type PlayerId } from './engine';
import { botAction } from './bot';
import { activatedOf, castInfo, castSpec, finalChapter, hasKeyword, manaUnits, parseAbilityText, spellSpec, triggersOf } from './rules';

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
    // An emblem with an ability the engine can't do isn't created.
    expect(parseAbilityText('You get an emblem with "Creatures you control get +1/+1 and have trample as long as you control a Dragon."').effects).toEqual([]);
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
