import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { apply, IllegalAction, newGame, powerOf, type GameState, type Permanent, type PlayerId } from './engine';
import { activatedOf, entersTapped, entersWithCounters, isToken, manaUnits, parseAbilityText, triggersOf } from './rules';

let n = 0;
function card(partial: Partial<Card> & { name: string }): Card {
  return {
    id: `id-${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
    setCode: 't', setName: 'T', rarity: 'common', keywords: [], ...partial,
  };
}
const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
const creature = (name: string, p: number, t: number, oracleText = '', extra: Partial<Card> = {}) =>
  card({ name, power: String(p), toughness: String(t), manaCost: '{1}', cmc: 1, oracleText, ...extra });
const spell = (name: string, manaCost: string, oracleText: string, typeLine = 'Sorcery') =>
  card({ name, typeLine, manaCost, cmc: (manaCost.match(/\{/g) ?? []).length, oracleText });

/** Player 0's main phase 1 with `mana` untapped Mountains, given permanents, and hands. */
function board(opts: { mana?: number; mine?: Card[]; theirs?: Card[]; hand?: Card[]; oppHand?: Card[]; oppMana?: number }): GameState {
  const s = newGame({ decks: [Array(20).fill(mountain), Array(20).fill(mountain)], names: ['Me', 'Bot'], first: 0, rng: () => 0.5, mulligans: false });
  s.players[0].hand = (opts.hand ?? []).map((c, i) => ({ iid: `h${i}`, card: c }));
  s.players[1].hand = (opts.oppHand ?? []).map((c, i) => ({ iid: `o${i}`, card: c }));
  const perms: { card: Card; controller: PlayerId }[] = [
    ...Array.from({ length: opts.mana ?? 0 }, () => ({ card: mountain, controller: 0 as PlayerId })),
    ...Array.from({ length: opts.oppMana ?? 0 }, () => ({ card: mountain, controller: 1 as PlayerId })),
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
const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof IllegalAction) return e.code;
    throw e;
  }
  return null;
};

const pyromancer = creature('Pyromancer', 1, 1, '{T}: Pyromancer deals 1 damage to any target.');
const fanatic = creature('Fanatic', 1, 1, 'Sacrifice Fanatic: It deals 1 damage to any target.');

describe('step 3 wordings', () => {
  it('reads activated abilities and their costs', () => {
    expect(activatedOf(pyromancer)).toMatchObject([
      { cost: { tap: true, mana: '', sacrificeSelf: false }, ability: { targets: [{ kind: 'any' }], effects: [{ kind: 'damage', amount: 1 }] }, sorcery: false },
    ]);
    expect(activatedOf(creature('Shade', 1, 1, '{1}{R}: This creature gets +1/+0 until end of turn.'))[0]).toMatchObject({
      cost: { mana: '{1}{R}', tap: false }, ability: { effects: [{ kind: 'pump', power: 1, to: 'self' }] },
    });
    expect(activatedOf(fanatic)[0]).toMatchObject({ cost: { sacrificeSelf: true }, ability: { effects: [{ kind: 'damage' }] } });
    expect(activatedOf(creature('Elf', 1, 1, '{T}: Add {G}.'))).toEqual([]);
    expect(activatedOf(card({ name: 'Jace', typeLine: 'Legendary Planeswalker — Jace', oracleText: '+1: Draw a card.\n−2: Scry 2.' }))).toMatchObject([
      { cost: { loyalty: 1 }, sorcery: true, ability: { effects: [{ kind: 'draw' }] } },
      { cost: { loyalty: -2 }, sorcery: true, ability: { effects: [{ kind: 'scry' }] } },
    ]);
    expect(activatedOf(creature('Priest', 1, 1, 'Sacrifice another creature: You gain 2 life.'))[0].cost.sacrifice).toMatchObject({
      another: true, which: { kind: 'creature', filter: { controller: 'you' } },
    });
    expect(activatedOf(creature('Mage', 1, 1, '{2}{U}: Draw a card. Activate only as a sorcery.'))[0]).toMatchObject({ sorcery: true });
    expect(activatedOf(creature('Mage', 1, 1, '{U}: Scry 1. Activate only once each turn.'))[0]).toMatchObject({ once: true });
    expect(activatedOf(creature('Mage', 1, 1, '{U}: Scry 1. Activate only during your turn.'))).toEqual([]);
  });

  it('reads edicts and tokens', () => {
    expect(parseAbilityText('Each opponent sacrifices a creature.').effects).toEqual([
      { kind: 'sacrifice', n: 1, to: 'each-opponent', which: { kind: 'creature', filter: {} } },
    ]);
    expect(parseAbilityText('Target player sacrifices two creatures of their choice.')).toMatchObject({
      targets: [{ kind: 'player' }], effects: [{ kind: 'sacrifice', n: 2 }],
    });
    expect(parseAbilityText('Create two 1/1 white Soldier creature tokens with flying.').effects).toMatchObject([
      { kind: 'token', n: 2, token: { name: 'Soldier', power: 1, toughness: 1, colors: ['W'], keywords: ['flying'], typeLine: 'Token Creature — Soldier' } },
    ]);
    expect(parseAbilityText('Create a 1/1 colorless Thopter artifact creature token with flying.').effects[0]).toMatchObject({
      token: { typeLine: 'Token Artifact Creature — Thopter' },
    });
    expect(parseAbilityText('Create a Treasure token.').effects[0]).toMatchObject({ kind: 'token', token: { name: 'Treasure' } });
    expect(triggersOf(creature('Ball Lightning', 6, 1, 'At the beginning of the end step, sacrifice Ball Lightning.'))).toMatchObject([
      { event: { on: 'endStep', whose: 'each' }, ability: { effects: [{ kind: 'sacrificeSelf' }] } },
    ]);
  });
});

describe('step 3 in a game', () => {
  it('activates a tap ability, and refuses it when tapped or summoning sick', () => {
    let s = board({ mine: [pyromancer], theirs: [creature('Elf', 1, 1)] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Pyromancer'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Elf') }]] });
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(perm(s, 'Pyromancer')!.tapped).toBe(true);
    expect(s.log.some((e) => e.k === 'activate')).toBe(true);
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Pyromancer'), index: 0, targets: [[{ kind: 'player', player: 1 }]] }))).toBe('alreadyTapped');
    const fresh = board({ mine: [pyromancer] });
    fresh.battlefield[0].sick = true;
    expect(errorOf(() => apply(fresh, { type: 'activate', iid: 'p0', index: 0, targets: [[{ kind: 'player', player: 1 }]] }))).toBe('summoningSick');
  });

  it('pays mana for a pump ability, as often as there is mana', () => {
    const shade = creature('Shade', 1, 1, '{R}: This creature gets +1/+0 until end of turn.');
    let s = board({ mana: 2, mine: [shade] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Shade'), index: 0 });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Shade'), index: 0 });
    expect(powerOf(perm(s, 'Shade')!)).toBe(3);
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Shade'), index: 0 }))).toBe('notEnoughMana');
  });

  it('keeps sorcery-speed abilities out of priority windows', () => {
    const mage = creature('Mage', 1, 1, '{R}: Draw a card. Activate only as a sorcery.');
    let s = board({ mana: 2, mine: [mage], hand: [spell('Shock', '{R}', 'Shock deals 2 damage to any target.', 'Instant')] });
    s.fullControl = [true, true];
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    s = apply(s, { type: 'pass' }); // the opponent passes: we get priority with Shock on the stack
    expect(s.priority?.player).toBe(0);
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Mage'), index: 0 }))).toBe('activateTiming');
  });

  it('sacrifices as a cost: itself, or a permanent chosen after paying', () => {
    let s = board({ mine: [fanatic] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Fanatic'), index: 0, targets: [[{ kind: 'player', player: 1 }]] });
    expect(perm(s, 'Fanatic')).toBeUndefined();
    expect(s.players[1].life).toBe(19);

    const priest = creature('Priest', 1, 1, 'Sacrifice another creature: You gain 2 life.');
    s = board({ mine: [priest, creature('Bear', 2, 2), creature('Goblin', 1, 1)] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Priest'), index: 0 });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'sacrificeCost' });
    expect((s.pending!.choice as { options: { iid: string }[] }).options.map((o) => o.iid)).not.toContain(iidOf(s, 'Priest'));
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Goblin')] } });
    expect(perm(s, 'Goblin')).toBeUndefined();
    expect(s.players[0].life).toBe(22);
    expect(errorOf(() => apply(board({ mine: [priest] }), { type: 'activate', iid: 'p0', index: 0 }))).toBe('nothingToSacrifice');
  });

  it('resolves edicts: the opponent chooses when they have a choice', () => {
    const edict = spell('Edict', '{1}', 'Each opponent sacrifices a creature.');
    let s = board({ mana: 1, hand: [edict], theirs: [creature('Big', 5, 5), creature('Small', 1, 1)] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ player: 1, purpose: 'sacrifice' });
    s = apply(s, botAction(s));
    expect(perm(s, 'Small')).toBeUndefined();
    expect(perm(s, 'Big')).toBeDefined();
    // Only one creature: no choice to make.
    s = board({ mana: 1, hand: [edict], theirs: [creature('Big', 5, 5)] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Big')).toBeUndefined();
  });

  it('creates tokens that vanish when they leave the battlefield', () => {
    const raise = spell('Raise', '{1}', 'Create two 1/1 white Soldier creature tokens.');
    const unsummon = spell('Unsummon', '{1}', "Return target creature to its owner's hand.", 'Instant');
    let s = board({ mana: 2, hand: [raise, unsummon] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    const soldiers = s.battlefield.filter((p) => p.card.name === 'Soldier');
    expect(soldiers).toHaveLength(2);
    expect(isToken(soldiers[0].card)).toBe(true);
    expect(soldiers[0].iid).not.toBe(soldiers[1].iid);
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: soldiers[0].iid } });
    expect(s.battlefield.filter((p) => p.card.name === 'Soldier')).toHaveLength(1);
    expect(s.players[0].hand.some((c) => c.card.name === 'Soldier')).toBe(false);
  });

  it('spends Treasure for mana and cracks Clues', () => {
    const loot = spell('Loot', '{R}', 'Create a Treasure token. Create a Clue token.');
    let s = board({ mana: 1, hand: [loot, spell('Bolt', '{R}', 'Bolt deals 3 damage to any target.', 'Instant')] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Treasure')).toBeDefined();
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'player', player: 1 } }); // paid by the Treasure
    expect(perm(s, 'Treasure')).toBeUndefined();
    expect(s.players[1].life).toBe(17);
    s.battlefield.forEach((p) => (p.tapped = false));
    s.battlefield.push({ ...s.battlefield[0], iid: 'extra' });
    const hand = s.players[0].hand.length;
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Clue'), index: 0 });
    expect(perm(s, 'Clue')).toBeUndefined();
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });

  it('sacrifices Ball Lightning at the end step', () => {
    const ball = creature('Ball Lightning', 6, 1, 'Trample, haste\nAt the beginning of the end step, sacrifice Ball Lightning.');
    let s = board({ mine: [ball] });
    s = apply(s, { type: 'pass' }); // to combat
    while (s.step !== 'main2') s = apply(s, s.priority ? { type: 'pass' } : { type: 'declareAttackers', attackers: [] });
    s = apply(s, { type: 'pass' }); // end the turn
    expect(perm(s, 'Ball Lightning')).toBeUndefined();
  });
});

describe('step 3 bot', () => {
  it('pings an x/1 at the end of our turn, and keeps its Fanatic', () => {
    let s = board({ theirs: [pyromancer, fanatic], mine: [creature('Elf', 1, 1)] });
    s.active = 0;
    s.step = 'main2';
    s.priority = { player: 1, passes: 1, reason: 'end' };
    const action = botAction(s);
    expect(action).toMatchObject({ type: 'activate', iid: iidOf(s, 'Pyromancer') });
    s = apply(s, action);
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(perm(s, 'Fanatic')).toBeDefined();
  });
});

describe('step 3: counters, library search, graveyard', () => {
  it('reads graveyard targets, counters for each creature, searches and entering rules', () => {
    expect(parseAbilityText('Return target creature card from your graveyard to your hand.')).toEqual({
      targets: [{ kind: 'card', min: 1, max: 1, filter: { controller: 'you', types: ['creature'] } }],
      effects: [{ kind: 'returnCard', to: { slot: 0 }, dest: 'hand' }],
    });
    expect(parseAbilityText('Return target permanent card with mana value 3 or less from your graveyard to the battlefield.')).toMatchObject({
      targets: [{ kind: 'card', filter: { nonTypes: ['instant', 'sorcery'], maxManaValue: 3 } }], effects: [{ dest: 'battlefield' }],
    });
    expect(parseAbilityText('Exile target card from a graveyard.')).toMatchObject({ targets: [{ kind: 'card', filter: {} }], effects: [{ kind: 'destroy', exile: true }] });
    expect(parseAbilityText('Put a +1/+1 counter on each creature you control.').effects[0]).toMatchObject({
      kind: 'addCountersAll', counter: '+1/+1', n: 1, which: { kind: 'creature', filter: { controller: 'you' } }, other: false,
    });
    expect(parseAbilityText('Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.').effects[0]).toEqual({
      kind: 'search', n: 1, filter: { basic: true, types: ['land'] }, dest: 'battlefield', tapped: true,
    });
    expect(parseAbilityText('Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle.').effects[0])
      .toMatchObject({ n: 2, dest: 'hand' });
    const fetch = card({ name: 'Wooded Foothills', typeLine: 'Land', oracleText: '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.' });
    expect(activatedOf(fetch)[0]).toMatchObject({
      cost: { tap: true, life: 1, sacrificeSelf: true }, ability: { effects: [{ kind: 'search', filter: { subtypes: ['mountain', 'forest'] }, tapped: false }] },
    });
    expect(entersWithCounters(creature('Walker', 0, 0, 'This creature enters with X +1/+1 counters on it.'))).toBe('X');
    expect(entersWithCounters(creature('Bear', 0, 0, 'Flying\nThis creature enters with two +1/+1 counters on it.'))).toBe(2);
    expect(entersTapped(card({ name: 'Guildgate', typeLine: 'Land — Gate', oracleText: 'This land enters tapped.\n{T}: Add {R}.' }))).toBe(true);
    expect(entersTapped(card({ name: 'Check', typeLine: 'Land', oracleText: 'This land enters tapped unless you control a Mountain.' }))).toBe(false);
  });

  it('returns and exiles cards from graveyards', () => {
    const raise = spell('Raise', '{1}', 'Return target creature card from your graveyard to your hand.');
    const purge = spell('Purge', '{1}', 'Exile target card from a graveyard.', 'Instant');
    let s = board({ mana: 2, hand: [raise, purge] });
    s.players[0].graveyard = [{ iid: 'g0', card: creature('Bear', 2, 2) }, { iid: 'g1', card: mountain }];
    s.players[1].graveyard = [{ iid: 'g2', card: creature('Snake', 1, 1) }];
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'card', iid: 'g2' } }))).toBe('illegalTarget');
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'card', iid: 'g1' } }))).toBe('illegalTarget');
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'card', iid: 'g0' } });
    expect(s.players[0].hand.map((c) => c.card.name)).toContain('Bear');
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Mountain', 'Raise']);
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'card', iid: 'g2' } });
    expect(s.players[1].graveyard).toEqual([]);
    expect(s.players[1].exile.map((c) => c.card.name)).toEqual(['Snake']);
  });

  it('lets an enters trigger return a creature, aimed by the bot at its best card', () => {
    const digger = creature('Digger', 2, 2, 'When this creature enters, return target creature card from your graveyard to your hand.');
    let s = board({ oppMana: 1, oppHand: [digger] });
    s.players[1].graveyard = [{ iid: 'g0', card: creature('Small', 1, 1) }, { iid: 'g1', card: creature('Big', 5, 5) }];
    s.active = 1;
    s.step = 'main2';
    s = apply(s, botAction(s));
    expect(s.pending?.choice.kind).toBe('targets');
    s = apply(s, botAction(s));
    expect(s.players[1].hand.map((c) => c.card.name)).toEqual(['Big']);
  });

  it('searches the library, then shuffles', () => {
    const growth = spell('Growth', '{1}', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    let s = board({ mana: 1, hand: [growth] });
    s.players[0].library = [...s.players[0].library.slice(0, 5), { iid: 'lib-spell', card: creature('Bear', 2, 2) }];
    const lands = s.battlefield.length;
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', purpose: 'search', min: 0, max: 1 });
    const options = (s.pending!.choice as { options: { iid: string; card: Card }[] }).options;
    expect(options.every((o) => o.card.name === 'Mountain')).toBe(true);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [options[0].iid] } });
    expect(s.battlefield).toHaveLength(lands + 1);
    expect(s.battlefield.at(-1)!.tapped).toBe(true);
    expect(s.players[0].library).toHaveLength(5);
    expect(s.log.at(-1)).toMatchObject({ k: 'search', n: 1, dest: 'battlefield' });
  });

  it('cracks a fetch land: pays life, sacrifices it, finds a land', () => {
    const fetch = card({ name: 'Foothills', typeLine: 'Land', oracleText: '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.' });
    let s = board({ mine: [fetch] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Foothills'), index: 0 });
    expect(perm(s, 'Foothills')).toBeUndefined();
    expect(s.players[0].life).toBe(19);
    // The ability resolves (both players pass automatically), then asks what to find.
    expect(s.pending?.choice.purpose).toBe('search');
    s = apply(s, botAction(s));
    expect(perm(s, 'Mountain')!.tapped).toBe(false);
  });

  it('puts counters on entering creatures and taps lands that enter tapped', () => {
    const walker = creature('Walker', 0, 0, 'This creature enters with X +1/+1 counters on it.', { manaCost: '{X}{X}', cmc: 0 });
    const gate = card({ name: 'Gate', typeLine: 'Land — Gate', oracleText: 'This land enters tapped.\n{T}: Add {R}.' });
    const overseer = creature('Overseer', 1, 1, '{T}: Put a +1/+1 counter on each other creature you control.');
    let s = board({ mana: 4, hand: [walker, gate], mine: [overseer] });
    s = apply(s, { type: 'cast', iid: 'h0', x: 2 });
    expect(perm(s, 'Walker')!.counters).toEqual({ '+1/+1': 2 });
    expect(powerOf(perm(s, 'Walker')!)).toBe(2);
    s = apply(s, { type: 'playLand', iid: 'h1' });
    expect(perm(s, 'Gate')!.tapped).toBe(true);
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Overseer'), index: 0 });
    expect(perm(s, 'Walker')!.counters).toEqual({ '+1/+1': 3 });
    expect(perm(s, 'Overseer')!.counters).toEqual({});
  });
});

describe('step 3: planeswalkers', () => {
  const walker = card({
    name: 'Chandra', typeLine: 'Legendary Planeswalker — Chandra', loyalty: '4',
    oracleText: '+1: Chandra deals 2 damage to each opponent.\n−3: Chandra deals 4 damage to target creature.',
  });

  it('reads targets that include planeswalkers', () => {
    expect(parseAbilityText('Shock deals 2 damage to target creature or planeswalker.').targets[0]).toEqual({
      kind: 'permanent', min: 1, max: 1, filter: { types: ['creature', 'planeswalker'] },
    });
    expect(parseAbilityText('Deals 3 damage to target player or planeswalker.').targets[0]).toMatchObject({ kind: 'any', filter: { types: ['planeswalker'] } });
  });

  it('enters with its loyalty, uses one loyalty ability a turn, and dies at 0 loyalty', () => {
    let s = board({ mana: 1, hand: [walker], theirs: [creature('Ogre', 3, 3)] });
    s.players[0].hand[0].card = { ...walker, manaCost: '{1}', cmc: 1 };
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Chandra')!.counters.loyalty).toBe(4);
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Chandra'), index: 0 });
    expect(perm(s, 'Chandra')!.counters.loyalty).toBe(5);
    expect(s.players[1].life).toBe(18);
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Chandra'), index: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })))
      .toBe('onceEachTurn');
    // Burn removes loyalty.
    const bolt = spell('Bolt', '{1}', 'Bolt deals 5 damage to any target.', 'Instant');
    let t = board({ oppMana: 1, oppHand: [bolt], mine: [walker] });
    t.battlefield.at(-1)!.counters = { loyalty: 4 };
    t.active = 1;
    t = apply(t, { type: 'cast', iid: 'o0', target: { kind: 'permanent', iid: iidOf(t, 'Chandra') } });
    expect(perm(t, 'Chandra')).toBeUndefined();
  });

  it('refuses a minus ability it cannot pay', () => {
    const s = board({ mine: [walker], theirs: [creature('Ogre', 3, 3)] });
    s.battlefield.find((p) => p.card.name === 'Chandra')!.counters = { loyalty: 2 };
    expect(errorOf(() => apply(s, { type: 'activate', iid: iidOf(s, 'Chandra'), index: 1, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] })))
      .toBe('notEnoughLoyalty');
  });

  it('lets creatures attack a planeswalker', () => {
    let s = board({ mine: [creature('Bear', 2, 2)], theirs: [walker] });
    s.battlefield.find((p) => p.card.name === 'Chandra')!.counters = { loyalty: 4 };
    s = apply(s, { type: 'pass' });
    while (s.step !== 'attack' || s.priority) s = apply(s, { type: 'pass' });
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Bear')], targets: { [iidOf(s, 'Bear')]: iidOf(s, 'Chandra') } });
    while (s.step !== 'main2') s = apply(s, s.priority ? { type: 'pass' } : { type: 'declareBlockers', blocks: {} });
    expect(perm(s, 'Chandra')!.counters.loyalty).toBe(2);
    expect(s.players[1].life).toBe(20);
  });

  it('makes the bot use loyalty abilities and attack planeswalkers', () => {
    let s = board({ theirs: [walker], mine: [creature('Ogre', 3, 3)] });
    s.battlefield.find((p) => p.card.name === 'Chandra')!.counters = { loyalty: 4 };
    s.active = 1;
    s.step = 'main1';
    // −3 kills the Ogre and leaves Chandra at 1.
    const action = botAction(s);
    expect(action).toMatchObject({ type: 'activate', index: 1 });
    s = apply(s, action);
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(perm(s, 'Chandra')!.counters.loyalty).toBe(1);

    let t = board({ mine: [walker], theirs: [creature('Bear', 2, 2)] });
    t.battlefield.find((p) => p.card.name === 'Chandra')!.counters = { loyalty: 2 };
    t.active = 1;
    t.step = 'attack';
    expect(botAction(t)).toEqual({ type: 'declareAttackers', attackers: [iidOf(t, 'Bear')], targets: { [iidOf(t, 'Bear')]: iidOf(t, 'Chandra') } });
  });
});

describe('step 3: mana pool', () => {
  const solRing = card({ name: 'Sol Ring', typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracleText: '{T}: Add {C}{C}.' });

  it('reads how much mana a source makes', () => {
    expect(manaUnits(solRing)).toEqual([['C'], ['C']]);
    expect(manaUnits(card({ name: 'Karplusan Forest', typeLine: 'Land', oracleText: '{T}: Add {C}.\n{T}: Add {R} or {G}. This land deals 1 damage to you.' })))
      .toEqual([['C', 'R', 'G']]);
    expect(manaUnits(card({ name: 'Gilded Lotus', typeLine: 'Artifact', oracleText: '{T}: Add three mana of any one color.' }))).toHaveLength(3);
    expect(manaUnits(card({ name: 'Azorius Chancery', typeLine: 'Land', oracleText: '{T}: Add {W}{U}.' }))).toEqual([['W'], ['U']]);
    expect(manaUnits(mountain)).toEqual([['R']]);
    expect(parseAbilityText('Add {B}{B}{B}.').effects).toEqual([{ kind: 'addMana', units: [['B'], ['B'], ['B']] }]);
  });

  it('pays with a two-mana source and keeps the extra mana in the pool for this step', () => {
    const bear = creature('Bear', 2, 2, '', { manaCost: '{1}{R}', cmc: 2 });
    const elf = creature('Elf', 1, 1, '', { manaCost: '{1}', cmc: 1 });
    let s = board({ mana: 1, mine: [solRing], hand: [bear, elf, creature('Ogre', 3, 3, '', { manaCost: '{2}', cmc: 2 })] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Sol Ring')!.tapped).toBe(true);
    expect(s.players[0].pool).toEqual([{ colors: ['C'], source: iidOf(s, 'Sol Ring') }]);
    s = apply(s, { type: 'cast', iid: 'h1' }); // paid from the pool
    expect(s.players[0].pool).toBeUndefined();
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h2' }))).toBe('notEnoughMana');
  });

  it('taps for mana by hand, untaps while unspent, and empties the pool at the end of the step', () => {
    let s = board({ mana: 2, mine: [creature('Bear', 2, 2)] });
    const [a, b] = s.battlefield.filter((p) => p.card.name === 'Mountain').map((p) => p.iid);
    s = apply(s, { type: 'tapForMana', iid: a });
    s = apply(s, { type: 'tapForMana', iid: b });
    expect(s.players[0].pool).toHaveLength(2);
    s = apply(s, { type: 'untapForMana', iid: b });
    expect(s.players[0].pool).toHaveLength(1);
    expect(s.battlefield.find((p) => p.iid === b)!.tapped).toBe(false);
    expect(errorOf(() => apply(s, { type: 'tapForMana', iid: a }))).toBe('alreadyTapped');
    s = apply(s, { type: 'pass' }); // to combat: the step ends
    expect(s.players[0].pool).toBeUndefined();
    expect(errorOf(() => apply(s, { type: 'untapForMana', iid: a }))).toBe('manaSpent');
  });

  it('casts a ritual and spends its mana', () => {
    const swamp = card({ name: 'Swamp', typeLine: 'Basic Land — Swamp' });
    const ritual = spell('Dark Ritual', '{B}', 'Add {B}{B}{B}.', 'Instant');
    const horror = creature('Horror', 4, 4, '', { manaCost: '{1}{B}{B}', cmc: 3 });
    let s = board({ hand: [ritual, horror] });
    s.battlefield.push({ iid: 'sw', card: swamp, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.players[0].pool).toEqual([{ colors: ['B'] }, { colors: ['B'] }, { colors: ['B'] }]);
    s = apply(s, { type: 'cast', iid: 'h1' });
    expect(perm(s, 'Horror')).toBeDefined();
    expect(s.players[0].pool).toBeUndefined();
  });
});
