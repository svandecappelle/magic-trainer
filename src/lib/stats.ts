import type { Card, DeckEntry } from '../types';

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

export const TYPE_ORDER = [
  'Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Other',
] as const;
export type PrimaryType = (typeof TYPE_ORDER)[number];

/** Uses the front face only, so a "Creature // Land" MDFC counts as a creature. */
export function primaryType(card: Card): PrimaryType {
  const front = card.typeLine.split('//')[0];
  return TYPE_ORDER.find((t) => t !== 'Other' && front.includes(t)) ?? 'Other';
}

export const isLand = (card: Card) => primaryType(card) === 'Land';

export function countCards(entries: DeckEntry[], board = 'main'): number {
  return entries.filter((e) => e.board === board).reduce((n, e) => n + e.qty, 0);
}

/** Non-land card counts by mana value: index 0..6, where index 7 means 7+. */
export function manaCurve(entries: DeckEntry[]): number[] {
  const curve = new Array(8).fill(0);
  for (const e of entries) {
    if (e.board !== 'main' || isLand(e.card)) continue;
    curve[Math.min(7, Math.floor(e.card.cmc))] += e.qty;
  }
  return curve;
}

/** Number of colored mana symbols per color across main-deck mana costs. Hybrid symbols count for both colors. */
export function colorPips(entries: DeckEntry[]): Record<string, number> {
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const e of entries) {
    if (e.board !== 'main') continue;
    for (const sym of e.card.manaCost.match(/\{[^}]+\}/g) ?? []) {
      for (const c of COLORS) if (sym.includes(c)) pips[c] += e.qty;
    }
  }
  return pips;
}

export function typeBreakdown(entries: DeckEntry[]): Record<PrimaryType, number> {
  const out = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0])) as Record<PrimaryType, number>;
  for (const e of entries) if (e.board === 'main') out[primaryType(e.card)] += e.qty;
  return out;
}

export function averageManaValue(entries: DeckEntry[]): number {
  let total = 0;
  let n = 0;
  for (const e of entries) {
    if (e.board !== 'main' || isLand(e.card)) continue;
    total += e.card.cmc * e.qty;
    n += e.qty;
  }
  return n ? total / n : 0;
}

export function deckPrice(entries: DeckEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.card.priceUsd ?? 0) * e.qty, 0);
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Hypergeometric probability of drawing at least `atLeast` successes when drawing
 * `draws` cards from a deck of `deckSize` that contains `successes` hits.
 */
export function probAtLeast(deckSize: number, successes: number, draws: number, atLeast: number): number {
  const total = choose(deckSize, draws);
  if (!total) return 0;
  let p = 0;
  for (let k = atLeast; k <= Math.min(draws, successes); k++) {
    p += (choose(successes, k) * choose(deckSize - successes, draws - k)) / total;
  }
  return p;
}
