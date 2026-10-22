import { describe, expect, it } from 'vitest';
import type { Permanent } from '../../lib/engine/engine';
import type { Card } from '../../types';
import { laneOf, stacksOf, untappedIn } from './stacks';

const card = (name: string, typeLine: string, extra: Partial<Card> = {}): Card => ({
  id: name, name, manaCost: '', cmc: 0, typeLine, oracleText: '', colors: [], colorIdentity: [], setCode: 't', setName: 'T', rarity: 'common', ...extra,
});
const treasure = card('Treasure', 'Token Artifact — Treasure', { oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.' });
const island = card('Island', 'Basic Land — Island');
const shark = card('Shark', 'Token Creature — Shark', { power: '3', toughness: '3' });
let n = 0;
const perm = (c: Card, extra: Partial<Permanent> = {}): Permanent => ({
  iid: `p${n++}`, card: c, controller: 0, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [], ...extra,
});

describe('board stacks', () => {
  it('puts creatures, lands and the other permanents in their lanes', () => {
    expect([laneOf(perm(shark)), laneOf(perm(island)), laneOf(perm(treasure))]).toEqual(['creatures', 'lands', 'others']);
    expect(laneOf(perm(card('Dryad Arbor', 'Land Creature — Forest Dryad')))).toBe('creatures');
  });

  it('stacks identical copies, in the order of the first one; tapped lands with untapped ones', () => {
    const t = [perm(treasure), perm(treasure, { tapped: true }), perm(treasure)];
    const i = [perm(island), perm(island, { tapped: true })];
    const stacks = stacksOf([t[0], i[0], t[1], i[1], t[2]]);
    expect(stacks.map((s) => s.perms.map((p) => p.iid))).toEqual([t.map((p) => p.iid), i.map((p) => p.iid)]);
    expect(untappedIn(stacks[0])).toBe(2);
  });

  it('keeps apart what tells copies apart', () => {
    const a = perm(shark);
    const tapped = perm(shark, { tapped: true });
    const sick = perm(shark, { sick: true });
    const countered = perm(shark, { counters: { '+1/+1': 1 } });
    const hurt = perm(shark, { damage: 1 });
    const theirs = perm(shark, { controller: 1 });
    const b = perm(shark);
    const attacking = perm(shark);
    const stacks = stacksOf([a, tapped, sick, countered, hurt, theirs, b, attacking], (p) => p === attacking);
    expect(stacks.map((s) => s.perms.length)).toEqual([2, 1, 1, 1, 1, 1, 1]);
    expect(stacks[0].perms).toEqual([a, b]);
  });
});
