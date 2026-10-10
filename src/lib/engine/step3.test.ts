import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { apply, IllegalAction, newGame, powerOf, type GameState, type Permanent, type PlayerId } from './engine';
import { activatedOf, isToken, parseAbilityText, triggersOf } from './rules';

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
    expect(activatedOf(card({ name: 'Jace', typeLine: 'Legendary Planeswalker — Jace', oracleText: '+1: Draw a card.\n−2: Scry 2.' }))).toEqual([]);
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
