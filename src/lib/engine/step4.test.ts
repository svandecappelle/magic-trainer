import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { botAction } from './bot';
import { apply, canAttack, canBlock, IllegalAction, newGame, powerOf, toughnessOf, type GameState, type Permanent, type PlayerId } from './engine';
import { activatedOf, auraTarget, entersTappedRule, protectionsOf, spellSpec, staticsOf, wardCost } from './rules';

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


const bear = (name = 'Bear', extra: Partial<Card> = {}) => creature(name, 2, 2, '', extra);
const red = { colors: ['R'] };

describe('step 4 wordings', () => {
  it('reads anthems, Auras, Equipment, ward, protection and lands entering tapped', () => {
    expect(staticsOf(card({ name: 'Anthem', typeLine: 'Enchantment', oracleText: 'Creatures you control get +1/+1.' }))).toEqual([
      { who: { which: { kind: 'creature', filter: { controller: 'you' } }, other: false }, power: 1, toughness: 1, keywords: [] },
    ]);
    expect(staticsOf(creature('Lord', 2, 2, 'Other Elf creatures you control get +1/+1 and have trample.'))).toEqual([
      { who: { which: { kind: 'creature', filter: { subtypes: ['elf'], controller: 'you' } }, other: true }, power: 1, toughness: 1, keywords: ['trample'] },
    ]);
    const might = card({ name: 'Might', typeLine: 'Enchantment — Aura', oracleText: 'Enchant creature\nEnchanted creature gets +2/+2 and has flying.' });
    expect(staticsOf(might)).toEqual([{ who: 'enchanted', power: 2, toughness: 2, keywords: ['flying'] }]);
    expect(auraTarget(might)).toMatchObject({ kind: 'creature' });
    expect(spellSpec(might).targets).toHaveLength(1);
    expect(staticsOf(card({ name: 'Pacifism', typeLine: 'Enchantment — Aura', oracleText: "Enchant creature\nEnchanted creature can't attack or block." })))
      .toMatchObject([{ who: 'enchanted', cantAttack: true, cantBlock: true }]);
    const sword = card({ name: 'Sword', typeLine: 'Artifact — Equipment', oracleText: 'Equipped creature gets +2/+0.\nEquip {2}' });
    expect(staticsOf(sword)).toMatchObject([{ who: 'equipped', power: 2 }]);
    expect(activatedOf(sword)[0]).toMatchObject({ cost: { mana: '{2}' }, sorcery: true, ability: { effects: [{ kind: 'attach' }] } });
    expect(wardCost(creature('Warded', 2, 2, 'Ward {2}'))).toBe(2);
    expect(protectionsOf(creature('Knight', 2, 2, 'Protection from white and from blue'))).toEqual(['W', 'U']);
    const land = (oracleText: string) => card({ name: 'L', typeLine: 'Land', oracleText });
    expect(entersTappedRule(land('This land enters tapped.'))).toEqual({ kind: 'always' });
    expect(entersTappedRule(land('This land enters tapped unless you control a Mountain or a Forest.'))).toEqual({ kind: 'unlessSubtypes', subtypes: ['mountain', 'forest'] });
    expect(entersTappedRule(land('This land enters tapped unless you control two or fewer other lands.'))).toEqual({ kind: 'unlessOtherLands', max: 2 });
    expect(entersTappedRule(land("As this land enters, you may pay 2 life. If you don't, it enters tapped."))).toEqual({ kind: 'payLife', n: 2 });
  });
});

describe('step 4 in a game', () => {
  it('applies anthems and lords while their source is on the battlefield', () => {
    const anthem = card({ name: 'Anthem', typeLine: 'Enchantment', oracleText: 'Creatures you control get +1/+1.' });
    const lord = creature('Lord', 2, 2, 'Other Elf creatures you control get +1/+1.');
    let s = board({ mine: [anthem, lord, bear('Elf', { typeLine: 'Creature — Elf' }), bear()], theirs: [bear('Theirs')] });
    s = apply(s, { type: 'pass' }); // any action refreshes the statics
    expect(powerOf(perm(s, 'Lord')!)).toBe(3);
    expect(powerOf(perm(s, 'Elf')!)).toBe(4);
    expect(powerOf(perm(s, 'Bear')!)).toBe(3);
    expect(powerOf(perm(s, 'Theirs')!)).toBe(2);
  });

  it('attaches an Aura on resolution and puts it into the graveyard when its creature dies', () => {
    const might = card({ name: 'Might', typeLine: 'Enchantment — Aura', manaCost: '{1}', cmc: 1, oracleText: 'Enchant creature\nEnchanted creature gets +2/+2 and has flying.' });
    const bolt = spell('Bolt', '{1}', 'Bolt deals 5 damage to any target.', 'Instant');
    let s = board({ mana: 2, mine: [bear()], hand: [might, bolt] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0' }))).toBe('needsTarget');
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Bear') } });
    expect(perm(s, 'Might')!.attachedTo).toBe(iidOf(s, 'Bear'));
    expect(powerOf(perm(s, 'Bear')!)).toBe(4);
    expect(perm(s, 'Bear')!.statics?.keywords).toEqual(['flying']);
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: iidOf(s, 'Bear') } });
    expect(perm(s, 'Bear')).toBeUndefined();
    expect(perm(s, 'Might')).toBeUndefined();
    expect(s.players[0].graveyard.map((c) => c.card.name)).toContain('Might');
  });

  it("stops a creature with Pacifism from attacking or blocking", () => {
    const pacifism = card({ name: 'Pacifism', typeLine: 'Enchantment — Aura', manaCost: '{1}', cmc: 1, oracleText: "Enchant creature\nEnchanted creature can't attack or block." });
    let s = board({ mana: 1, hand: [pacifism], theirs: [bear('Theirs')], mine: [bear()] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Theirs') } });
    expect(canAttack(perm(s, 'Theirs')!)).toBe(false);
    expect(canBlock(perm(s, 'Theirs')!, perm(s, 'Bear')!)).toBe(false);
  });

  it('equips a creature, and the Equipment stays when the creature dies', () => {
    const sword = card({ name: 'Sword', typeLine: 'Artifact — Equipment', oracleText: 'Equipped creature gets +2/+0.\nEquip {2}' });
    let s = board({ mana: 2, mine: [sword, bear()] });
    s = apply(s, { type: 'activate', iid: iidOf(s, 'Sword'), index: 0, targets: [[{ kind: 'permanent', iid: iidOf(s, 'Bear') }]] });
    expect(perm(s, 'Sword')!.attachedTo).toBe(iidOf(s, 'Bear'));
    expect(powerOf(perm(s, 'Bear')!)).toBe(4);
    s.battlefield = s.battlefield.filter((p) => p.card.name !== 'Bear');
    s = apply(s, { type: 'pass' });
    expect(perm(s, 'Sword')).toBeDefined();
    expect(perm(s, 'Sword')!.attachedTo).toBeUndefined();
  });

  it('respects hexproof, shroud and indestructible', () => {
    const shock = spell('Shock', '{1}', 'Shock deals 2 damage to any target.', 'Instant');
    const doom = spell('Doom', '{1}', 'Destroy target creature.');
    const wrath = spell('Wrath', '{1}', 'Destroy all creatures.');
    let s = board({ mana: 3, hand: [shock, doom, wrath], theirs: [bear('Hex', { keywords: ['Hexproof'] }), bear('Wall', { keywords: ['Indestructible'] })], mine: [bear('Mine', { keywords: ['Shroud'] })] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Hex') } }))).toBe('illegalTarget');
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Mine') } }))).toBe('illegalTarget');
    s = apply(s, { type: 'cast', iid: 'h1', target: { kind: 'permanent', iid: iidOf(s, 'Wall') } });
    expect(perm(s, 'Wall')).toBeDefined();
    s = apply(s, { type: 'cast', iid: 'h2' });
    expect(perm(s, 'Hex')).toBeUndefined();
    expect(perm(s, 'Mine')).toBeUndefined();
    expect(perm(s, 'Wall')).toBeDefined();
  });

  it('gives protection from a color: no targeting, no damage, no blocking by that color', () => {
    const knight = bear('Knight', { oracleText: 'Protection from red' });
    const shock = spell('Shock', '{1}', 'Shock deals 2 damage to any target.', 'Instant');
    const clasm = { ...spell('Clasm', '{1}', 'Clasm deals 2 damage to each creature.'), ...red };
    let s = board({ mana: 2, hand: [{ ...shock, ...red }, clasm], theirs: [knight, bear('Goblin', red)] });
    expect(errorOf(() => apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Knight') } }))).toBe('illegalTarget');
    s = apply(s, { type: 'cast', iid: 'h1' });
    expect(perm(s, 'Knight')).toBeDefined();
    expect(perm(s, 'Goblin')).toBeUndefined();
    expect(canBlock({ ...perm(board({ mine: [bear('Red', red)] }), 'Red')! }, perm(s, 'Knight')!)).toBe(false);
  });

  it('counters a spell targeting a ward creature unless its controller pays', () => {
    const shock = spell('Shock', '{1}', 'Shock deals 2 damage to any target.', 'Instant');
    const warded = bear('Warded', { oracleText: 'Ward {2}' });
    let s = board({ mana: 1, hand: [shock], theirs: [warded] });
    s = apply(s, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(s, 'Warded') } });
    expect(perm(s, 'Warded')).toBeDefined(); // no mana left to pay for ward: countered
    expect(s.log.some((e) => e.k === 'countered' && e.card === 'Shock')).toBe(true);
    let t = board({ mana: 3, hand: [shock], theirs: [warded] });
    t = apply(t, { type: 'cast', iid: 'h0', target: { kind: 'permanent', iid: iidOf(t, 'Warded') } });
    expect(t.pending?.choice).toMatchObject({ purpose: 'payOrCounter', player: 0 });
    t = apply(t, { type: 'choose', answer: { kind: 'yesNo', yes: true } });
    expect(perm(t, 'Warded')).toBeUndefined();
  });

  it('applies the legend rule: its controller keeps one', () => {
    const legend = creature('Ragavan', 2, 1, '', { typeLine: 'Legendary Creature — Monkey', manaCost: '{1}', cmc: 1 });
    let s = board({ mana: 1, mine: [legend], hand: [legend] });
    s = apply(s, { type: 'cast', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ purpose: 'legendRule', player: 0 });
    s = apply(s, { type: 'choose', answer: { kind: 'cards', iids: ['h0'] } });
    expect(s.battlefield.filter((p) => p.card.name === 'Ragavan').map((p) => p.iid)).toEqual(['h0']);
  });

  it('enters lands tapped or untapped by their rules', () => {
    const shockLand = card({ name: 'Shockland', typeLine: 'Land — Mountain Forest', oracleText: "({T}: Add {R} or {G}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped." });
    const check = card({ name: 'Checkland', typeLine: 'Land', oracleText: 'This land enters tapped unless you control a Mountain or a Forest.\n{T}: Add {R} or {G}.' });
    const fast = card({ name: 'Fastland', typeLine: 'Land', oracleText: 'This land enters tapped unless you control two or fewer other lands.\n{T}: Add {R} or {G}.' });
    let s = board({ mana: 1, hand: [shockLand] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(s.pending?.choice).toMatchObject({ purpose: 'payLife' });
    s = apply(s, { type: 'choose', answer: { kind: 'yesNo', yes: true } });
    expect(perm(s, 'Shockland')!.tapped).toBe(false);
    expect(s.players[0].life).toBe(18);
    s = board({ mana: 1, hand: [check] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(perm(s, 'Checkland')!.tapped).toBe(false);
    s = board({ mana: 3, hand: [fast] });
    s = apply(s, { type: 'playLand', iid: 'h0' });
    expect(perm(s, 'Fastland')!.tapped).toBe(true);
  });

  it('makes the bot put Auras where they help it', () => {
    const might = card({ name: 'Might', typeLine: 'Enchantment — Aura', manaCost: '{1}', cmc: 1, oracleText: 'Enchant creature\nEnchanted creature gets +2/+2.' });
    const pacifism = card({ name: 'Pacifism', typeLine: 'Enchantment — Aura', manaCost: '{1}', cmc: 1, oracleText: "Enchant creature\nEnchanted creature can't attack or block." });
    let s = board({ oppMana: 2, oppHand: [might, pacifism], theirs: [bear('Small'), creature('Big', 4, 4)], mine: [creature('Ogre', 3, 3)] });
    s.active = 1;
    for (let i = 0; i < 2; i++) s = apply(s, botAction(s));
    expect(perm(s, 'Might')!.attachedTo).toBe(iidOf(s, 'Big'));
    expect(perm(s, 'Pacifism')!.attachedTo).toBe(iidOf(s, 'Ogre'));
    expect(toughnessOf(perm(s, 'Big')!)).toBe(6);
  });
});
