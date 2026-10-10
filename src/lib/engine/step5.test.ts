import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { apply, castOptions, IllegalAction, newGame, type GameState, type Permanent, type PlayerId } from './engine';
import { cardFaces, castInfo, castSpec, isAdventure, spellSpec } from './rules';

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


const forest = card({ name: 'Forest', typeLine: 'Basic Land — Forest' });
const addLands = (s: GameState, n: number, land = forest, p: PlayerId = 0) => {
  for (let i = 0; i < n; i++) {
    s.battlefield.push({ iid: `${land.name}-${p}-${i}`, card: land, controller: p, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [] });
  }
};
const shatter = spell('Choice', '{1}', 'Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.', 'Instant');
const burst = spell('Burst', '{R}', 'Kicker {3}\nBurst deals 2 damage to any target. If this spell was kicked, it deals 4 damage instead.', 'Instant');
const giant: Card = {
  ...creature('Giant', 4, 3, '', { manaCost: '{2}{R}', cmc: 3 }),
  name: 'Giant // Stomp', typeLine: 'Creature — Giant // Instant — Adventure', layout: 'adventure',
  faces: [
    { name: 'Giant', manaCost: '{2}{R}', typeLine: 'Creature — Giant', oracleText: '', power: '4', toughness: '3' },
    { name: 'Stomp', manaCost: '{1}{R}', typeLine: 'Instant — Adventure', oracleText: 'Stomp deals 2 damage to any target.' },
  ],
};

describe('step 5 wordings', () => {
  it('reads modes, kicker, additional costs, flashback, cycling and cost reductions', () => {
    expect(castInfo(shatter).modal).toEqual({ min: 1, max: 1, modes: ['Destroy target artifact.', 'Destroy target enchantment.'] });
    expect(castSpec(shatter, {}).effects).toEqual([]);
    expect(castSpec(shatter, { modes: [1] })).toMatchObject({ targets: [{ filter: { types: ['enchantment'] } }], effects: [{ kind: 'destroy', to: { slot: 0 } }] });
    const both = spell('Both', '{1}', 'Choose one or both —\n• Destroy target artifact.\n• Draw a card.');
    expect(castInfo(both).modal).toMatchObject({ min: 1, max: 2 });
    expect(castSpec(both, { modes: [0, 1] }).effects.map((e) => e.kind)).toEqual(['destroy', 'draw']);
    expect(castInfo(burst).kicker).toBe('{3}');
    expect(castSpec(burst, {}).effects[0]).toMatchObject({ kind: 'damage', amount: 2 });
    expect(castSpec(burst, { kicked: true }).effects[0]).toMatchObject({ kind: 'damage', amount: 4 });
    const growth = spell('Growth', '{G}', 'Kicker {1}{G}\nTarget creature gets +2/+2 until end of turn. If this spell was kicked, draw a card.', 'Instant');
    expect(castSpec(growth, { kicked: true }).effects.map((e) => e.kind)).toEqual(['pump', 'draw']);
    const rites = spell('Rites', '{B}', 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.', 'Instant');
    expect(castInfo(rites).additional).toEqual({ kind: 'sacrifice', which: { kind: 'creature', filter: {} } });
    expect(spellSpec(rites).effects).toEqual([{ kind: 'draw', n: 2, to: 'you' }]);
    expect(castInfo(spell('Flash', '{R}', 'Flash deals 1 damage to any target.\nFlashback {2}{R}')).flashback).toBe('{2}{R}');
    const cycler = spell('Cycler', '{2}{B}', 'Destroy target creature.\nCycling {2} ({2}, Discard this card: Draw a card.)');
    expect(castInfo(cycler).cycling).toEqual({ cost: '{2}' });
    expect(spellSpec(cycler).effects.map((e) => e.kind)).toEqual(['destroy']); // the reminder text's "Draw a card" is ignored
    expect(castInfo(creature('Beast', 3, 3, 'Swampcycling {2}')).cycling).toEqual({ cost: '{2}', search: { subtypes: ['swamp'] } });
    expect(castInfo(spell('Big', '{4}{G}', 'Convoke\nDraw a card.')).convoke).toBe(true);
    expect(castInfo(spell('Delver', '{4}{U}', 'Delve\nDraw a card.')).delve).toBe(true);
    expect(castInfo(creature('Frog', 3, 3, 'Affinity for artifacts')).affinity).toEqual({ types: ['artifact'] });
    expect(isAdventure(giant)).toBe(true);
    expect(cardFaces({ ...giant, faces: undefined }).map((f) => f.name)).toEqual(['Giant', 'Stomp']);
  });
});

describe('step 5 in a game', () => {
  it('casts a modal spell with the chosen mode', () => {
    const totem = card({ name: 'Totem', typeLine: 'Enchantment' });
    let s = board({ mana: 1, hand: [shatter], theirs: [totem] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [0, 1] }))).toBe('badModes');
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [0], targets: [[{ kind: 'permanent', iid: iidOf(s, 'Totem') }]] }))).toBe('illegalTarget');
    s = apply(s, { type: 'cast', iid: 'h0', modes: [1], targets: [[{ kind: 'permanent', iid: iidOf(s, 'Totem') }]] });
    expect(perm(s, 'Totem')).toBeUndefined();
  });

  it('casts "choose two" spells, and pays "discard two cards"', () => {
    const command = spell('Command', '{1}', 'Choose two —\n• Command deals 2 damage to any target.\n• Draw a card.\n• Destroy target enchantment.', 'Instant');
    let s = board({ mana: 1, hand: [command] });
    expect(castOptions(s, 0, 'h0')).toHaveLength(1);
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', modes: [1] }))).toBe('badModes');
    s = apply(s, { type: 'cast', iid: 'h0', modes: [0, 1], targets: [[{ kind: 'player', player: 1 }]] });
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].hand).toHaveLength(1);
    const reunion = spell('Reunion', '{1}', 'As an additional cost to cast this spell, discard two cards.\nDraw three cards.');
    let t = board({ mana: 1, hand: [reunion, creature('A', 1, 1)] });
    expect(errorOf(() => apply(t, { type: 'cast', iid: 'h0' }))).toBe('nothingToDiscard');
    t = board({ mana: 1, hand: [reunion, creature('A', 1, 1), creature('B', 1, 1)] });
    t = apply(t, { type: 'cast', iid: 'h0' });
    t = apply(t, { type: 'choose', answer: { kind: 'cards', iids: ['h1', 'h2'] } });
    expect(t.players[0].hand).toHaveLength(3);
  });

  it('pays kicker for the bigger effect', () => {
    let s = board({ mana: 4, hand: [burst], theirs: [creature('Ogre', 3, 4)] });
    expect(castOptions(s, 0, 'h0')).toEqual([{ face: 0, kicked: false, from: 'hand' }, { face: 0, kicked: true, from: 'hand' }]);
    s = apply(s, { type: 'cast', iid: 'h0', kicked: true, target: { kind: 'permanent', iid: iidOf(s, 'Ogre') } });
    expect(perm(s, 'Ogre')).toBeUndefined();
    expect(s.battlefield.filter((p) => p.card.name === 'Mountain' && p.tapped)).toHaveLength(4);
    expect(s.log.find((e) => e.k === 'cast')).toMatchObject({ kicked: true });
  });

  it('pays additional costs: sacrifice and discard', () => {
    const rites = spell('Rites', '{1}', 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.', 'Instant');
    expect(errorOf(() => apply(board({ mana: 1, hand: [rites] }), { type: 'cast', iid: 'h0' }))).toBe('nothingToSacrifice');
    let s = board({ mana: 1, hand: [rites], mine: [creature('Elf', 1, 1)] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ purpose: 'sacrificeCost' });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [iidOf(s, 'Elf')] } });
    expect(perm(s, 'Elf')).toBeUndefined();
    expect(s.players[0].hand).toHaveLength(2);
    const looting = spell('Loot', '{1}', 'As an additional cost to cast this spell, discard a card.\nDraw two cards.');
    let t = board({ mana: 1, hand: [looting, creature('Extra', 1, 1)] });
    t = apply(t, { type: 'cast', iid: 'h0' });
    expect(t.pending?.choice).toMatchObject({ purpose: 'discardCost' });
    t = apply(t, { type: 'choose', answer: { kind: 'cards', iids: ['h1'] } });
    expect(t.players[0].graveyard.map((c) => c.card.name)).toEqual(['Extra', 'Loot']);
    expect(t.players[0].hand).toHaveLength(2);
  });

  it('casts with flashback from the graveyard, then exiles it', () => {
    const flame = spell('Flame', '{R}', 'Flame deals 1 damage to any target.\nFlashback {1}{R}');
    let s = board({ mana: 2 });
    s.players[0].graveyard = [{ iid: 'g0', card: flame }];
    expect(castOptions(s, 0, 'g0')).toEqual([{ face: 0, kicked: false, from: 'graveyard' }]);
    s = apply(s, { type: 'cast', iid: 'g0', target: { kind: 'player', player: 1 } });
    expect(s.players[1].life).toBe(19);
    expect(s.players[0].graveyard).toEqual([]);
    expect(s.players[0].exile.map((c) => c.card.name)).toEqual(['Flame']);
  });

  it('cycles and landcycles', () => {
    const cycler = spell('Cycler', '{5}', 'Destroy target creature.\nCycling {1}');
    const beast = creature('Beast', 3, 3, 'Mountaincycling {1}', { manaCost: '{5}', cmc: 5 });
    let s = board({ mana: 2, hand: [cycler, beast] });
    s = apply(s, { type: 'cycle', iid: 'h0' });
    expect(s.players[0].graveyard.map((c) => c.card.name)).toEqual(['Cycler']);
    expect(s.players[0].hand).toHaveLength(2); // Beast and the drawn card
    s = apply(s, { type: 'cycle', iid: 'h1' });
    // The library is all Mountains: pick one.
    expect(s.pending?.choice.purpose).toBe('search');
    const option = (s.pending!.choice as { options: { iid: string }[] }).options[0];
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: [option.iid] } });
    expect(s.players[0].hand.at(-1)!.card.name).toBe('Mountain');
    expect(errorOf(() => apply(s, { type: 'cycle', iid: s.players[0].hand[0].iid }))).toBe('cannotCycle');
  });

  it('pays with convoke, delve and affinity', () => {
    const army = spell('Army', '{3}{G}', 'Convoke\nDraw a card.');
    let s = board({ hand: [army], mine: [creature('A', 1, 1, '', { colors: ['G'] }), creature('B', 1, 1), creature('C', 1, 1)] });
    addLands(s, 1);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.battlefield.filter((p) => isTapped(p)).length).toBe(4);
    const dig = spell('Dig', '{4}{U}', 'Delve\nDraw a card.');
    const island = card({ name: 'Island', typeLine: 'Basic Land — Island' });
    let t = board({ hand: [dig] });
    addLands(t, 1, island);
    t.players[0].graveyard = Array.from({ length: 5 }, (_, i) => ({ iid: `g${i}`, card: creature(`Dead${i}`, 1, 1) }));
    t = apply(t, { type: 'cast', iid: 'h0' });
    expect(t.players[0].graveyard.map((c) => c.card.name)).toEqual(['Dead4', 'Dig']);
    expect(t.players[0].exile).toHaveLength(4);
    const frog = creature('Frog', 3, 3, 'Affinity for artifacts', { manaCost: '{4}{U}', cmc: 5 });
    const trinket = card({ name: 'Trinket', typeLine: 'Artifact' });
    let u = board({ hand: [frog], mine: [trinket, trinket, trinket, trinket] });
    addLands(u, 1, island);
    u = apply(u, { type: 'cast', iid: 'h0' });
    expect(perm(u, 'Frog')).toBeDefined();
  });

  it('sends an adventure into exile, then casts the creature from there', () => {
    let s = board({ mana: 5, hand: [giant] });
    expect(castOptions(s, 0, 'h0').map((o) => o.face)).toEqual([0, 1]);
    s = apply(s, { type: 'cast', iid: 'h0', face: 1, target: { kind: 'player', player: 1 } });
    expect(s.players[1].life).toBe(18);
    expect(s.players[0].exile).toMatchObject([{ iid: 'h0', adventure: true }]);
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(perm(s, 'Giant // Stomp') ?? perm(s, 'Giant')).toBeDefined();
    expect(s.players[0].exile).toEqual([]);
  });

  it('plays the land face of a modal double-faced card, and returns the whole card to hand', () => {
    const mdfc: Card = {
      ...spell('Call', '{4}{W}{W}{W}', 'Create two 1/1 white Soldier creature tokens.'),
      name: 'Call // Skyclave', typeLine: 'Sorcery // Land', layout: 'modal_dfc',
      faces: [
        { name: 'Call', manaCost: '{4}{W}{W}{W}', typeLine: 'Sorcery', oracleText: 'Create two 1/1 white Soldier creature tokens.' },
        { name: 'Skyclave', manaCost: '', typeLine: 'Land', oracleText: 'This land enters tapped.\n{T}: Add {W}.' },
      ],
    };
    const bounce = spell('Bounce', '{1}', "Return target permanent to its owner's hand.", 'Instant');
    let s = board({ mana: 1, hand: [mdfc, bounce] });
    s = apply(s, { type: 'playLand', iid: 'h0', face: 1 });
    expect(perm(s, 'Skyclave')).toMatchObject({ tapped: true });
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: 'h0' } });
    expect(s.players[0].hand.map((c) => c.card.name)).toEqual(['Call // Skyclave']);
  });

  it('makes the bot use adventures, modes and cycling', () => {
    let s = board({ oppMana: 3, oppHand: [giant], mine: [creature('Elf', 1, 2)] });
    s.active = 1;
    s.step = 'main1';
    const first = botAction(s);
    expect(first).toMatchObject({ type: 'cast', face: 1, targets: [[{ kind: 'permanent' }]] });
    let t = board({ oppMana: 1, oppHand: [shatter], theirs: [], mine: [card({ name: 'Totem', typeLine: 'Enchantment' })] });
    t.active = 1;
    t.step = 'main1';
    expect(botAction(t)).toMatchObject({ type: 'cast', modes: [1] });
  });
});

const isTapped = (p: Permanent) => p.tapped;
