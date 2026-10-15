import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { actor, apply, canTapForMana, castOptions, IllegalAction, newGame, powerOf, toughnessOf, type GameState, type Permanent, type PlayerId } from './engine';
import { castInfo, castSpec, manaUnits, parseAbilityText, spellSpec, triggersOf } from './rules';

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

  it('Mana Confluence costs 1 life, and Starting Town only makes {C} for now', () => {
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
    expect(manaUnits(startingTown)).toEqual([['C']]);
  });
});
