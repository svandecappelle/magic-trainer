import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { actor, apply, canAttack, newGame, type GameState, type Permanent, type PlayerId } from './engine';
import { entersAsCopy, isToken, parseAbilityText, toxicOf } from './rules';

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


const kinds = (text: string) => parseAbilityText(text).effects.map((e) => e.kind);
/** Passes priority and declares nothing until `done`. */
function advance(s: GameState, done: (s: GameState) => boolean): GameState {
  for (let i = 0; i < 80 && !done(s) && s.winner === null; i++) {
    s = apply(s, s.pending || actor(s) === 1 ? botAction(s) : !s.priority && s.step === 'attack' ? { type: 'declareAttackers', attackers: [] }
      : !s.priority && s.step === 'block' ? { type: 'declareBlockers', blocks: {} } : { type: 'pass' });
  }
  return s;
}
function attackWith(s: GameState, names: string[]): GameState {
  s = advance(s, (x) => x.step === 'attack' && !x.priority);
  s = apply(s, { type: 'declareAttackers', attackers: names.map((n) => iidOf(s, n)) });
  return advance(s, (x) => x.step === 'main2');
}

describe('step 6 wordings', () => {
  it('reads poison, proliferate, control, copies, prevention and extra turns', () => {
    expect(parseAbilityText('Target player gets two poison counters.').effects[0]).toMatchObject({ kind: 'poison', n: 2, to: { slot: 0 } });
    expect(kinds('Each opponent gets a poison counter. Proliferate.')).toEqual(['poison', 'proliferate']);
    expect(parseAbilityText('Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn.').effects)
      .toEqual([{ kind: 'gainControl', to: { slot: 0 }, untilEndOfTurn: true, untapHaste: true }]);
    expect(parseAbilityText('Gain control of target creature.').effects[0]).toMatchObject({ kind: 'gainControl', untilEndOfTurn: false });
    expect(parseAbilityText('Copy target instant or sorcery spell. You may choose new targets for the copy.')).toMatchObject({
      targets: [{ kind: 'spell', filter: { types: ['instant', 'sorcery'] } }], effects: [{ kind: 'copySpell' }],
    });
    expect(kinds("Create a token that's a copy of target creature you control.")).toEqual(['tokenCopy']);
    expect(kinds('Prevent all combat damage that would be dealt this turn.')).toEqual(['preventCombat']);
    expect(parseAbilityText('Prevent the next 3 damage that would be dealt to any target this turn.').effects[0]).toMatchObject({ kind: 'preventDamage', n: 3 });
    expect(kinds('Take an extra turn after this one.')).toEqual(['extraTurn']);
    expect(parseAbilityText('Target player takes an extra turn after this one.')).toMatchObject({ targets: [{ kind: 'player' }], effects: [{ kind: 'extraTurn' }] });
    expect(parseAbilityText('Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.').effects)
      .toEqual([{ kind: 'gainControl', to: { slot: 0 }, untilEndOfTurn: true, untapHaste: true }]);
    expect(toxicOf(creature('Rat', 1, 1, 'Toxic 2'))).toBe(2);
    expect(entersAsCopy(creature('Clone', 0, 0, 'You may have this creature enter as a copy of any creature on the battlefield.'))).toBe(true);
  });
});

describe('step 6 in a game', () => {
  it('poisons with infect and toxic, and loses at ten', () => {
    const infecter = creature('Infecter', 3, 3, 'Infect', { keywords: ['Infect'] });
    const rat = creature('Rat', 1, 1, 'Toxic 2');
    let s = board({ mine: [infecter, rat] });
    s = attackWith(s, ['Infecter', 'Rat']);
    expect(s.players[1].poison).toBe(5);
    expect(s.players[1].life).toBe(19);
    let t = board({ mana: 1, hand: [spell('Prick', '{1}', 'Target player gets a poison counter.')] });
    t.players[1].poison = 9;
    t = apply(t, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    expect(t.winner).toBe(0);
  });

  it('turns infect damage to creatures into -1/-1 counters', () => {
    let s = board({ mana: 1, mine: [creature('Infecter', 1, 1, 'Infect', { keywords: ['Infect'] })], theirs: [creature('Ogre', 3, 3)] });
    // A fight: the infect creature deals its damage as counters.
    s.players[0].hand = [{ iid: 'h0', card: spell('Bite', '{1}', 'Target creature you control deals damage equal to its power to target creature you don\'t control.') }];
    s = apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Infecter') }], [{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] });
    expect(perm(s, 'Ogre')!.counters['-1/-1']).toBe(1);
    expect(perm(s, 'Ogre')!.damage).toBe(0);
  });

  it('proliferates counters that help us and hurt them', () => {
    let s = board({ mana: 1, hand: [spell('Grow', '{1}', 'Proliferate.')], mine: [creature('Mine', 1, 1)], theirs: [creature('Theirs', 3, 3)] });
    s.battlefield.find((p) => p.card.name === 'Mine')!.counters = { '+1/+1': 1 };
    s.battlefield.find((p) => p.card.name === 'Theirs')!.counters = { '-1/-1': 1 };
    s.players[1].poison = 2;
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Mine')!.counters['+1/+1']).toBe(2);
    expect(perm(s, 'Theirs')!.counters['-1/-1']).toBe(2);
    expect(s.players[1].poison).toBe(3);
  });

  it('steals a creature until end of turn (Threaten), or for good', () => {
    const threaten = spell('Threaten', '{1}', 'Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn.');
    let s = board({ mana: 1, hand: [threaten], theirs: [creature('Ogre', 3, 3)] });
    s.battlefield.find((p) => p.card.name === 'Ogre')!.tapped = true;
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Ogre') } });
    expect(perm(s, 'Ogre')).toMatchObject({ controller: 0, owner: 1, tapped: false });
    expect(canAttack(perm(s, 'Ogre')!)).toBe(true);
    s = attackWith(s, ['Ogre']);
    expect(s.players[1].life).toBe(17);
    s = advance(s, (x) => x.active === 1);
    expect(perm(s, 'Ogre')!.controller).toBe(1);

    const mind = spell('Mind', '{1}', 'Gain control of target creature.');
    const bolt = spell('Bolt', '{1}', 'Bolt deals 5 damage to any target.', 'Instant');
    let t = board({ mana: 2, hand: [mind, bolt], theirs: [creature('Ogre', 3, 3)] });
    t = apply(t, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(t, 'Ogre') } });
    t = apply(t, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: iidOf(t, 'Ogre') } });
    expect(t.players[1].graveyard.map((c) => c.card.name)).toEqual(['Ogre']); // its owner's graveyard
  });

  it('copies a spell with the same targets', () => {
    const shock = spell('Shock', '{1}', 'Shock deals 2 damage to any target.', 'Instant');
    const twin = spell('Twin', '{1}', 'Copy target instant or sorcery spell. You may choose new targets for the copy.', 'Instant');
    let s = board({ mana: 2, hand: [shock, twin] });
    s.fullControl = [true, false];
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    s = advance(s, (x) => x.priority?.player === 0);
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'spell', iid: 'h0' } });
    s = advance(s, (x) => !x.stack.length);
    expect(s.players[1].life).toBe(16);
    expect(s.players[0].graveyard.map((c) => c.card.name).sort()).toEqual(['Shock', 'Twin']);
  });

  it('makes token copies and clones', () => {
    const mirror = spell('Mirror', '{1}', "Create a token that's a copy of target creature you control.");
    let s = board({ mana: 1, hand: [mirror], mine: [creature('Ogre', 3, 3)] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Ogre') } });
    const ogres = s.battlefield.filter((p) => p.card.name === 'Ogre');
    expect(ogres).toHaveLength(2);
    expect(isToken(ogres[1].card)).toBe(true);

    const clone = creature('Clone', 0, 0, 'You may have this creature enter as a copy of any creature on the battlefield.', { manaCost: '{1}', cmc: 1 });
    const bolt = spell('Bolt', '{1}', 'Bolt deals 5 damage to any target.', 'Instant');
    let t = board({ mana: 2, hand: [clone, bolt], theirs: [creature('Dragon', 5, 5)] });
    t = apply(t, { type: 'cast', iid: 'h0' });
    expect(t.pending?.choice).toMatchObject({ purpose: 'clone', min: 0, max: 1 });
    t = apply(t, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(t, 'Dragon')] } });
    const copy = t.battlefield.find((p) => p.iid === 'h0')!;
    expect(copy).toMatchObject({ controller: 0, card: { name: 'Dragon' } });
    t = apply(t, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: 'h0' } });
    expect(t.players[0].graveyard.map((c) => c.card.name)).toEqual(['Bolt', 'Clone']);
  });

  it('prevents damage: Fog and shields', () => {
    const fog = spell('Fog', '{1}', 'Prevent all combat damage that would be dealt this turn.', 'Instant');
    let s = board({ mana: 1, hand: [fog], mine: [creature('Ogre', 3, 3)] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    s = attackWith(s, ['Ogre']);
    expect(s.players[1].life).toBe(20);
    const ward = spell('Ward', '{1}', 'Prevent the next 3 damage that would be dealt to any target this turn.', 'Instant');
    const shock = spell('Shock', '{1}', 'Shock deals 2 damage to any target.', 'Instant');
    let t = board({ mana: 2, hand: [ward, shock] });
    t = apply(t, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    t = apply(t, { type: 'cast', iid: 'h1', target: { kind: 'player', player: 1 } });
    expect(t.players[1].life).toBe(20);
  });

  it('takes an extra turn', () => {
    let s = board({ mana: 1, hand: [spell('Time', '{1}', 'Take an extra turn after this one.')] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    const turn = s.turn;
    s = advance(s, (x) => x.turn > turn);
    expect(s.active).toBe(0);
    s = advance(s, (x) => x.turn > turn + 1);
    expect(s.active).toBe(1);
  });

  it('makes the bot Fog a lethal attack', () => {
    const fog = spell('Fog', '{1}', 'Prevent all combat damage that would be dealt this turn.', 'Instant');
    let s = board({ oppMana: 1, oppHand: [fog], mine: [creature('Giant', 6, 6)] });
    s.players[1].life = 5;
    s = attackWith(s, ['Giant']);
    expect(s.players[1].life).toBe(5);
    expect(s.log.some((e) => e.k === 'cast' && e.card === 'Fog')).toBe(true);
  });
});
