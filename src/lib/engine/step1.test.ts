import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { actor, apply, maxX, newGame, powerOf, type GameState, type Permanent, type PlayerId } from './engine';
import { parseAbilityText } from './rules';

let n = 0;
function card(partial: Partial<Card> & { name: string }): Card {
  return {
    id: `id-${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
    setCode: 't', setName: 'T', rarity: 'common', keywords: [], ...partial,
  };
}
const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
const creature = (name: string, p: number, t: number, extra: Partial<Card> = {}) =>
  card({ name, power: String(p), toughness: String(t), manaCost: '{1}', cmc: 1, ...extra });
const spell = (name: string, manaCost: string, oracleText: string, typeLine = 'Sorcery') =>
  card({ name, typeLine, manaCost, cmc: (manaCost.match(/\{/g) ?? []).length, oracleText });
const library = (k: number, name = 'Card') => Array.from({ length: k }, (_, i) => ({ iid: `lib-${name}-${i}`, card: creature(`${name} ${i}`, 1, 1) }));

/** Player 0's main phase 1 with `mana` untapped Mountains, given creatures, and hands. */
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

describe('step 1 wordings', () => {
  it('reads draw, discard, life, mill, scry, tap, bounce, mass and fight effects', () => {
    expect(parseAbilityText('Target player draws two cards.')).toMatchObject({
      targets: [{ kind: 'player' }], effects: [{ kind: 'draw', n: 2, to: { slot: 0 } }],
    });
    expect(parseAbilityText('Each player draws a card.').effects).toEqual([{ kind: 'draw', n: 1, to: 'each-player' }]);
    expect(kinds('Draw two cards, then discard a card.')).toEqual(['draw', 'discard']);
    expect(parseAbilityText('Target opponent discards a card at random.').effects[0]).toMatchObject({ mode: 'random' });
    expect(parseAbilityText('Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.').effects[0])
      .toMatchObject({ kind: 'discard', mode: 'casterChooses', filter: { nonTypes: ['creature', 'land'] } });
    expect(parseAbilityText('Target player draws two cards and loses 2 life.')).toMatchObject({
      targets: [{ kind: 'player' }], effects: [{ kind: 'draw', n: 2, to: { slot: 0 } }, { kind: 'loseLife', n: 2, to: { slot: 0 } }],
    });
    expect(kinds('Target player loses 3 life and you gain 3 life.')).toEqual(['loseLife', 'gainLife']);
    expect(parseAbilityText('Target player mills three cards.').effects[0]).toMatchObject({ kind: 'mill', n: 3 });
    expect(kinds('Scry 2, then draw a card.')).toEqual(['scry', 'draw']);
    expect(kinds('Surveil 2.')).toEqual(['surveil']);
    expect(parseAbilityText('Tap up to two target creatures.')).toMatchObject({ targets: [{ min: 0, max: 2 }], effects: [{ kind: 'tap', untap: false }] });
    expect(parseAbilityText('Return target creature to its owner\'s hand.').effects[0].kind).toBe('bounce');
    expect(parseAbilityText('Fireball deals X damage to any target.').effects[0]).toMatchObject({ kind: 'damage', amount: 'X' });
    expect(parseAbilityText('Destroy all creatures. They can\'t be regenerated.').effects[0]).toMatchObject({ kind: 'destroyAll', which: { kind: 'creature' } });
    expect(parseAbilityText('Pyroclasm deals 2 damage to each creature.').effects[0]).toMatchObject({ kind: 'damageAll', amount: 2 });
    expect(parseAbilityText('Deals 1 damage to each creature without flying and each player.').effects[0])
      .toMatchObject({ which: { filter: { withoutKeyword: 'flying' } }, players: 'each-player' });
    expect(parseAbilityText('Creatures you control get +2/+2 and gain trample until end of turn.').effects[0])
      .toMatchObject({ kind: 'pumpAll', power: 2, keywords: ['trample'], which: { filter: { controller: 'you' } } });
    expect(parseAbilityText('Return all attacking creatures to their owner\'s hand.').effects[0]).toMatchObject({ kind: 'bounceAll', which: { filter: { attacking: true } } });
    expect(parseAbilityText('Destroy each nonland permanent with mana value 2 or less.').effects[0])
      .toMatchObject({ kind: 'destroyAll', which: { kind: 'permanent', filter: { nonTypes: ['land'], maxManaValue: 2 } } });
    expect(parseAbilityText('Exile target permanent with mana value 4 or greater.').targets[0].filter).toEqual({ minManaValue: 4 });
    expect(parseAbilityText('Target creature you control fights target creature you don\'t control.')).toMatchObject({
      targets: [{ filter: { controller: 'you' } }, { filter: { controller: 'opponent' } }],
      effects: [{ kind: 'fight', a: { slot: 0 }, b: { slot: 1 }, oneSided: false }],
    });
    expect(parseAbilityText('Target creature you control deals damage equal to its power to target creature you don\'t control.').effects[0])
      .toMatchObject({ kind: 'fight', oneSided: true });
  });
});

describe('step 1 effects', () => {
  it('draws for a target player and for each player', () => {
    let s = board({ mana: 2, hand: [spell('Gift', '{1}', 'Target player draws two cards.'), spell('Howl', '{1}', 'Each player draws a card.')] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    expect(s.players[1].hand).toHaveLength(2);
    s = apply(s, { type: 'cast', iid: 'h1' });
    expect([s.players[0].hand.length, s.players[1].hand.length]).toEqual([1, 3]);
  });

  it('loots: draw, then choose a discard', () => {
    let s = board({ mana: 1, hand: [spell('Loot', '{R}', 'Draw two cards, then discard a card.')] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ kind: 'cards', player: 0, purpose: 'discard', min: 1 });
    const pick = s.players[0].hand[1].iid;
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [pick] } });
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].graveyard.map((c) => c.iid)).toEqual([pick, 'h0']);
  });

  it('makes the target player choose discards, at random, or lets the caster choose (Duress)', () => {
    const hand = [creature('Bear', 2, 2), spell('Bolt', '{R}', 'x', 'Instant'), mountain];
    let s = board({ mana: 3, oppHand: hand, hand: [
      spell('Mind Rot', '{1}', 'Target player discards two cards.'),
      spell('Duress', '{R}', 'Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.'),
      spell('Hymn', '{1}', 'Target opponent discards a card at random.'),
    ] });
    let rot = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    expect(rot.pending?.choice).toMatchObject({ player: 1, purpose: 'discard', min: 2 });
    expect(actor(rot)).toBe(1);
    rot = apply(rot, botAction(rot)); // the bot picks its own discards
    expect(rot.players[1].hand).toHaveLength(1);

    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'player', player: 1 } });
    expect(s.pending?.choice).toMatchObject({ player: 0, purpose: 'discardChosen', min: 1 });
    const options = s.pending!.choice.kind === 'cards' ? s.pending!.choice.options : [];
    expect(options.map((c) => c.card.name)).toEqual(['Bolt']); // only noncreature, nonland
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [options[0].iid] } });
    expect(s.players[1].graveyard.map((c) => c.card.name)).toEqual(['Bolt']);

    s = apply(s, { type: 'cast', iid: 'h2', target: { kind: 'player', player: 1 } });
    expect(s.pending).toBeNull();
    expect(s.players[1].hand).toHaveLength(1);
  });

  it('asks each player in turn for "each player discards a card"', () => {
    let s = board({ mana: 1, hand: [spell('Wheel', '{1}', 'Each player discards a card.'), mountain], oppHand: [mountain, mountain] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice.player).toBe(0);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    expect(s.pending?.choice.player).toBe(1);
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['o0'] } });
    expect(s.pending).toBeNull();
    expect([s.players[0].hand.length, s.players[1].hand.length]).toEqual([0, 1]);
  });

  it('drains life and mills', () => {
    let s = board({ mana: 2, hand: [spell('Drain', '{1}', 'Target player loses 3 life and you gain 3 life.'), spell('Glimpse', '{1}', 'Target player mills three cards.')] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'player', player: 1 } });
    expect([s.players[0].life, s.players[1].life]).toEqual([23, 17]);
    const before = s.players[1].library.length;
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'player', player: 1 } });
    expect(s.players[1].library).toHaveLength(before - 3);
    expect(s.players[1].graveyard).toHaveLength(3);
  });

  it('scries and surveils with the arrange choice', () => {
    let s = board({ mana: 2, hand: [spell('Opt', '{R}', 'Scry 2, then draw a card.', 'Instant'), spell('Look', '{1}', 'Surveil 2.')] });
    s.players[0].library = library(5);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ kind: 'arrange', purpose: 'scry', zones: ['top', 'bottom'] });
    // Card 1 on top, card 0 to the bottom: then we draw card 1.
    s = apply(s, { type: 'choose', answer: { kind: 'arrange', zones: { top: ['lib-Card-1'], bottom: ['lib-Card-0'] } } });
    expect(s.players[0].hand.map((c) => c.iid)).toContain('lib-Card-1');
    expect(s.players[0].library.at(-1)!.iid).toBe('lib-Card-0');
    s = apply(s, { type: 'cast', iid: 'h1' });
    s = apply(s, { type: 'choose', answer: { kind: 'arrange', zones: { graveyard: ['lib-Card-2', 'lib-Card-3'] } } });
    expect(s.players[0].graveyard.map((c) => c.iid)).toEqual(expect.arrayContaining(['lib-Card-2', 'lib-Card-3']));
    expect(s.players[0].library[0].iid).toBe('lib-Card-4');
  });

  it('taps, untaps and bounces', () => {
    let s = board({ mana: 3, theirs: [creature('Ogre', 3, 3)], hand: [
      spell('Frost', '{R}', 'Tap target creature.', 'Instant'), spell('Wake', '{R}', 'Untap target creature.', 'Instant'),
      spell('Unsummon', '{R}', 'Return target creature to its owner\'s hand.', 'Instant'),
    ] });
    const ogre = { kind: 'permanent', iid: iidOf(s, 'Ogre') } as const;
    s = apply(s, { type: 'cast', iid: 'h0', target: ogre });
    expect(perm(s, 'Ogre')!.tapped).toBe(true);
    s = apply(s, { type: 'cast', iid: 'h1', target: ogre });
    expect(perm(s, 'Ogre')!.tapped).toBe(false);
    s = apply(s, { type: 'cast', iid: 'h2', target: ogre });
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(s.players[1].hand.map((c) => c.card.name)).toEqual(['Ogre']);
  });

  it('pays X and uses it', () => {
    const fireball = spell('Fireball', '{X}{R}', 'Fireball deals X damage to any target.');
    let s = board({ mana: 4, hand: [fireball] });
    expect(maxX(s, 0, fireball)).toBe(3);
    expect(() => apply(s, { type: 'cast', iid: 'h0', x: 4, target: { kind: 'player', player: 1 } })).toThrow(/notEnoughMana/);
    expect(() => apply(s, { type: 'cast', iid: 'h0', x: -1, target: { kind: 'player', player: 1 } })).toThrow(/badX/);
    s = apply(s, { type: 'cast', iid: 'h0', x: 3, target: { kind: 'player', player: 1 } });
    expect(s.players[1].life).toBe(17);
    expect(s.battlefield.filter((p) => p.tapped)).toHaveLength(4);
  });

  it('wipes, burns and pumps the whole board', () => {
    const mine = [creature('Bear', 2, 2), creature('Bird', 1, 1, { keywords: ['Flying'] })];
    const theirs = [creature('Ogre', 3, 3), creature('Elf', 1, 1)];
    const wrath = apply(board({ mana: 4, mine, theirs, hand: [spell('Wrath', '{4}', 'Destroy all creatures.')] }), { type: 'cast', iid: 'h0' });
    expect(wrath.battlefield.filter((p) => p.card.name !== 'Mountain')).toEqual([]);

    const quake = apply(board({ mana: 1, mine, theirs, hand: [spell('Quake', '{R}', 'Quake deals 1 damage to each creature without flying and each player.')] }), { type: 'cast', iid: 'h0' });
    expect(quake.battlefield.map((p) => p.card.name).sort()).toEqual(['Bear', 'Bird', 'Mountain', 'Ogre']);
    expect([quake.players[0].life, quake.players[1].life]).toEqual([19, 19]);

    const rally = apply(board({ mana: 1, mine, theirs, hand: [spell('Rally', '{R}', 'Creatures you control get +1/+1 until end of turn.', 'Instant')] }), { type: 'cast', iid: 'h0' });
    expect([powerOf(perm(rally, 'Bear')!), powerOf(perm(rally, 'Ogre')!)]).toEqual([3, 3]);
  });

  it('fights and bites', () => {
    const base = { mana: 2, mine: [creature('Bear', 2, 2), creature('Wurm', 6, 4)], theirs: [creature('Ogre', 3, 3)] };
    let s = board({ ...base, hand: [spell('Prey', '{R}', 'Target creature you control fights target creature you don\'t control.')] });
    s = apply(s, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }], [{ kind: 'permanent', iid: iidOf(s, 'Ogre') }]] });
    expect(perm(s, 'Bear')).toBeUndefined(); // 3 damage kills the Bear; the Ogre survives 2
    expect(perm(s, 'Ogre')!.damage).toBe(2);

    let b = board({ ...base, hand: [spell('Bite', '{R}', 'Target creature you control deals damage equal to its power to target creature you don\'t control.')] });
    b = apply(b, { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: iidOf(b, 'Bear') }], [{ kind: 'permanent', iid: iidOf(b, 'Ogre') }]] });
    expect(perm(b, 'Bear')!.damage).toBe(0);
    expect(() => apply(board({ ...base, hand: [spell('Bite', '{R}', 'Target creature you control deals damage equal to its power to target creature you don\'t control.')] }),
      { type: 'cast', iid: 'h0', targets: [[{ kind: 'permanent', iid: 'p3' }], [{ kind: 'permanent', iid: 'p2' }]] })).toThrow(/illegalTarget/);
  });
});

describe('the bot with step 1 spells', () => {
  it('wipes only when it hurts the opponent more, and picks a winning fight', () => {
    const wrath = spell('Wrath', '{4}', 'Destroy all creatures.');
    const ahead = board({ oppMana: 4, mine: [creature('Ogre', 3, 3), creature('Wurm', 6, 6)], theirs: [creature('Elf', 1, 1)], oppHand: [wrath] });
    ahead.active = 1;
    const behind = board({ oppMana: 4, mine: [creature('Elf', 1, 1)], theirs: [creature('Ogre', 3, 3), creature('Wurm', 6, 6)], oppHand: [wrath] });
    behind.active = 1;
    expect(botAction(ahead)).toEqual({ type: 'cast', iid: 'o0' });
    expect(botAction(behind)).toEqual({ type: 'pass' });

    const prey = spell('Prey', '{R}', 'Target creature you control fights target creature you don\'t control.');
    const f = board({ oppMana: 1, mine: [creature('Ogre', 3, 3)], theirs: [creature('Elf', 1, 1), creature('Wurm', 6, 6)], oppHand: [prey] });
    f.active = 1;
    expect(botAction(f)).toEqual({ type: 'cast', iid: 'o0', targets: [[{ kind: 'permanent', iid: iidOf(f, 'Wurm') }], [{ kind: 'permanent', iid: iidOf(f, 'Ogre') }]] });
  });

  it('casts X burn for lethal, discard at the opponent, and scries sensibly', () => {
    const fireball = spell('Fireball', '{X}{R}', 'Fireball deals X damage to any target.');
    const s = board({ oppMana: 5, oppHand: [fireball] });
    s.active = 1;
    s.players[0].life = 4;
    expect(botAction(s)).toEqual({ type: 'cast', iid: 'o0', targets: [[{ kind: 'player', player: 0 }]], x: 4 });

    const sign = spell('Sign in Blood', '{1}', 'Target player draws two cards and loses 2 life.');
    const sb = board({ oppMana: 2, oppHand: [sign] });
    sb.active = 1;
    expect(botAction(sb)).toEqual({ type: 'cast', iid: 'o0', targets: [[{ kind: 'player', player: 1 }]] });
    sb.players[0].life = 2;
    expect(botAction(sb)).toEqual({ type: 'cast', iid: 'o0', targets: [[{ kind: 'player', player: 0 }]] });

    const rot = spell('Mind Rot', '{1}', 'Target player discards two cards.');
    const d = board({ oppMana: 2, oppHand: [rot], hand: [mountain] });
    d.active = 1;
    expect(botAction(d)).toEqual({ type: 'cast', iid: 'o0', targets: [[{ kind: 'player', player: 0 }]] });
  });
});
