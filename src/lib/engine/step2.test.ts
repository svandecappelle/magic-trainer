import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { actor, apply, newGame, powerOf, type Action, type GameState, type Permanent, type PlayerId } from './engine';
import { triggersOf } from './rules';

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
const shock = card({ name: 'Shock', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracleText: 'Shock deals 2 damage to any target.' });

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
const lastLog = (s: GameState, k: string) => s.log.filter((e) => e.k === k).at(-1);

/** Plays until `done`: player 0 passes (or declares nothing), the bot plays player 1. */
function playUntil(s: GameState, done: (s: GameState) => boolean, limit = 60): GameState {
  for (let i = 0; i < limit && !done(s) && s.winner === null; i++) {
    const p = actor(s);
    let action: Action;
    if (p === 1) action = botAction(s);
    else if (s.pending) throw new Error(`unexpected choice ${s.pending.choice.purpose}`);
    else if (!s.priority && s.step === 'attack') action = { type: 'declareAttackers', attackers: [] };
    else if (!s.priority && s.step === 'block') action = { type: 'declareBlockers', blocks: {} };
    else action = { type: 'pass' };
    s = apply(s, action);
  }
  expect(done(s)).toBe(true);
  return s;
}

describe('step 2 trigger wordings', () => {
  it('reads enters, dies, attacks, landfall, upkeep, end step and cast triggers', () => {
    const t = (name: string, text: string, extra: Partial<Card> = {}) => triggersOf(creature(name, 2, 2, text, extra));

    expect(t('Flametongue Kavu', 'When Flametongue Kavu enters the battlefield, it deals 4 damage to target creature.')).toMatchObject([
      { event: { on: 'enters', self: true }, ability: { targets: [{ kind: 'creature' }], effects: [{ kind: 'damage', amount: 4 }] } },
    ]);
    expect(t('Elf', 'When this creature dies, draw a card.')).toMatchObject([{ event: { on: 'dies', self: true }, ability: { effects: [{ kind: 'draw' }] } }]);
    expect(t('Brute', 'Whenever Brute attacks, it gets +1/+0 until end of turn.')).toMatchObject([
      { event: { on: 'attacks', self: true }, ability: { effects: [{ kind: 'pump', power: 1, to: 'self' }] } },
    ]);
    expect(t('Ragavan, Pilferer', 'Whenever Ragavan attacks, put a +1/+1 counter on Ragavan.')[0].ability.effects).toEqual([
      { kind: 'addCounters', counter: '+1/+1', n: 1, to: 'self' },
    ]);
    expect(t('Ox', 'Landfall — Whenever a land you control enters, you gain 1 life. (Reminder text.)')).toMatchObject([
      { event: { on: 'enters', self: false, which: { kind: 'permanent', filter: { types: ['land'], controller: 'you' } } }, ability: { effects: [{ kind: 'gainLife' }] } },
    ]);
    expect(t('Ox', 'Whenever a land enters the battlefield under your control, you may gain 1 life.')).toMatchObject([
      { event: { which: { filter: { controller: 'you' } } }, ability: { optional: true } },
    ]);
    expect(t('Warden', 'Whenever another creature you control enters, you gain 1 life.')).toMatchObject([
      { event: { on: 'enters', another: true, which: { kind: 'creature' } } },
    ]);
    expect(t('Bob', 'At the beginning of your upkeep, you lose 1 life.')).toMatchObject([{ event: { on: 'upkeep', whose: 'you' } }]);
    expect(t('Arena', 'At the beginning of your upkeep, you draw a card and lose 1 life.')[0].ability.effects).toEqual([
      { kind: 'draw', n: 1, to: 'you' }, { kind: 'loseLife', n: 1, to: 'you' },
    ]);
    expect(t('Bob', 'At the beginning of each end step, each player draws a card.')).toMatchObject([{ event: { on: 'endStep', whose: 'each' } }]);
    expect(t('Monk', 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.')).toMatchObject([
      { event: { on: 'cast', filter: { nonTypes: ['creature'] } }, ability: { effects: [{ kind: 'pump', to: 'self' }] } },
    ]);
    expect(t('Swiftspear', 'Haste\nProwess', { keywords: ['Haste', 'Prowess'] })).toMatchObject([{ event: { on: 'cast' } }]);
    expect(t('Seer', 'When this creature enters or attacks, scry 1.').map((x) => x.event.on)).toEqual(['enters', 'attacks']);
    expect(t('Blood Artist', 'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.')).toMatchObject([
      { event: { on: 'dies', self: false, another: false, which: { kind: 'creature' } }, ability: { targets: [{ kind: 'player' }] } },
    ]);
    expect(t('Loran of the Third Path', 'When Loran enters, destroy up to one target artifact or enchantment.')).toMatchObject([
      { event: { on: 'enters', self: true }, ability: { targets: [{ min: 0, max: 1 }], effects: [{ kind: 'destroy' }] } },
    ]);
    expect(t('Ninja', 'Whenever this creature deals combat damage to a player, draw a card.')).toMatchObject([{ event: { on: 'combatDamage', self: true } }]);
    expect(t('Archmage', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.')).toMatchObject([
      { event: { on: 'cast', filter: { types: ['instant', 'sorcery'] } } },
    ]);
  });

  it('recognizes but does not simulate conditional or unknown trigger text', () => {
    expect(triggersOf(creature('A', 1, 1, 'When A enters, if you control a Swamp, draw a card.'))[0].ability.effects).toEqual([]);
    expect(triggersOf(creature('A', 1, 1, 'Whenever a creature you control attacks, it gets +1/+0 until end of turn.'))[0].ability.effects).toEqual([]);
    expect(triggersOf(creature('A', 1, 1, 'When A enters, investigate.'))[0].ability.effects).toEqual([]);
    expect(triggersOf(creature('A', 1, 1, 'Flying\n{T}: Add {G}.'))).toEqual([]);
  });
});

describe('step 2 triggers in a game', () => {
  const kavu = creature('Kavu', 4, 2, 'When this creature enters, it deals 4 damage to target creature.');

  it('asks for the targets of an enters trigger, then resolves it', () => {
    let s = board({ mana: 1, hand: [kavu], theirs: [creature('Bear', 2, 2)] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Kavu')).toBeDefined();
    expect(s.pending?.choice).toMatchObject({ kind: 'targets', player: 0, purpose: 'triggerTargets' });
    // Its own creature is a legal target too, but we pick theirs.
    s = apply(s, { type: 'choose', answer: { kind: 'targets', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] } });
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(s.stack).toEqual([]);
    expect(lastLog(s, 'triggers')).toMatchObject({ card: 'Kavu', targets: [{ card: 'Bear' }] });
  });

  it('removes a trigger with no legal target', () => {
    const exiler = creature('Exiler', 2, 2, 'When this creature enters, exile target creature an opponent controls.');
    let s = board({ mana: 1, hand: [exiler] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending).toBeNull();
    expect(lastLog(s, 'noTarget')).toEqual({ k: 'noTarget', card: 'Exiler' });
  });

  it('resolves untargeted enters, dies and landfall triggers', () => {
    const elf = creature('Elf', 1, 1, 'When this creature enters, draw a card.\nWhen this creature dies, you gain 3 life.');
    const ox = creature('Ox', 2, 2, 'Landfall — Whenever a land you control enters, you gain 2 life.');
    let s = board({ mana: 2, hand: [elf, shock, mountain], mine: [ox] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.players[0].hand).toHaveLength(3); // Shock, Mountain, and the drawn card
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: iidOf(s, 'Elf') } });
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(s.players[0].life).toBe(23);
    s = apply(s, { type: 'playLand', iid: 'h2' });
    expect(s.players[0].life).toBe(25);
    expect(s.priority).toBeNull(); // back to the main phase
  });

  it('triggers for other creatures entering, but not for itself with "another"', () => {
    const warden = creature('Warden', 1, 1, 'Whenever another creature you control enters, you gain 1 life.');
    let s = board({ mana: 2, hand: [warden, creature('Bear', 2, 2)] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.players[0].life).toBe(20);
    s = apply(s, { type: 'cast', iid: 'h1' });
    expect(s.players[0].life).toBe(21);
  });

  it('pumps an attacker with its attack trigger before damage', () => {
    const brute = creature('Brute', 2, 2, 'Whenever this creature attacks, it gets +1/+0 until end of turn.');
    let s = board({ mine: [brute] });
    s = apply(s, { type: 'pass' }); // to combat
    s = playUntil(s, (x) => x.step === 'attack' && !x.priority);
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Brute')] });
    expect(powerOf(perm(s, 'Brute')!)).toBe(3);
    s = playUntil(s, (x) => x.step === 'main2');
    expect(s.players[1].life).toBe(17);
  });

  it('triggers on combat damage to a player, not when blocked', () => {
    const ninja = creature('Ninja', 2, 2, 'Whenever this creature deals combat damage to a player, draw a card.');
    let s = board({ mine: [ninja] });
    const hand = s.players[0].hand.length;
    s = apply(s, { type: 'pass' });
    s = playUntil(s, (x) => x.step === 'attack' && !x.priority);
    s = apply(s, { type: 'declareAttackers', attackers: [iidOf(s, 'Ninja')] });
    s = playUntil(s, (x) => x.step === 'main2' && !x.stack.length && !x.priority);
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });

  it('gives prowess a +1/+1 that resolves before the spell', () => {
    const monk = creature('Monk', 1, 2, 'Prowess', { keywords: ['Prowess'] });
    let s = board({ mana: 1, mine: [monk], hand: [shock] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    expect(powerOf(perm(s, 'Monk')!)).toBe(2);
    expect(s.players[1].life).toBe(18);
    const order = s.log.filter((e) => e.k === 'pump' || e.k === 'damagePlayer').map((e) => e.k);
    expect(order).toEqual(['pump', 'damagePlayer']);
  });

  it('resolves upkeep triggers before the draw, and end step triggers before the turn ends', () => {
    const seer = creature('Seer', 0, 1, 'At the beginning of your upkeep, scry 1.\nAt the beginning of your end step, you gain 2 life.');
    let s = board({ mine: [seer] });
    s = playUntil(s, (x) => x.turn === 2);
    expect(s.players[0].life).toBe(22);
    const handBefore = s.players[0].hand.length;
    s = playUntil(s, (x) => x.pending !== null);
    expect(s.turn).toBe(3);
    expect(s.step).toBe('upkeep');
    expect(s.pending!.choice.purpose).toBe('scry');
    expect(s.players[0].hand).toHaveLength(handBefore); // not drawn yet
    const top = s.players[0].library[0];
    s = apply(s, { type: 'choose', answer: { kind: 'arrange', zones: { bottom: [top.iid] } } });
    expect(s.step).toBe('main1');
    expect(s.players[0].hand).toHaveLength(handBefore + 1);
    expect(s.players[0].hand.at(-1)!.iid).not.toBe(top.iid);
  });

  it('asks before a "you may" ability', () => {
    const scholar = creature('Scholar', 1, 1, 'When this creature enters, you may draw a card.');
    let s = board({ mana: 1, hand: [scholar] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ kind: 'yesNo', purpose: 'optional' });
    s = apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: false } });
    expect(s.players[0].hand).toHaveLength(0);
    expect(lastLog(s, 'declined')).toEqual({ k: 'declined', card: 'Scholar' });
  });

  it('lets the bot aim its triggers', () => {
    // The bot casts Kavu in its second main phase and shoots our best creature it can kill.
    let s = board({ oppMana: 1, oppHand: [kavu], mine: [creature('Bear', 2, 2), creature('Wall', 0, 5)] });
    s.active = 1;
    s.step = 'main2';
    s = apply(s, botAction(s));
    expect(s.pending?.choice.kind).toBe('targets');
    s = apply(s, botAction(s));
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(perm(s, 'Wall')).toBeDefined();
  });

  it('makes the bot pick its least bad target when a trigger must hit its own side', () => {
    const exiler = creature('Exiler', 3, 3, 'When this creature enters, exile target creature.');
    let s = board({ oppMana: 1, oppHand: [exiler], theirs: [creature('Big', 5, 5)] });
    s.active = 1;
    s.step = 'main2';
    s = apply(s, botAction(s));
    s = apply(s, botAction(s));
    // Exiler is worth less than Big: it exiles itself.
    expect(perm(s, 'Exiler')).toBeUndefined();
    expect(perm(s, 'Big')).toBeDefined();
  });
});
