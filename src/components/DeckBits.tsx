import { PRESET_DECKS } from '../lib/engine/presets';
import { engineStatus } from '../lib/engineStatus';
import { countCards } from '../lib/stats';
import type { Deck } from '../types';

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/** What a deck tile shows: its colors, mana curve (non-land cards, 0 to 6+) and how much the rules engine simulates. */
export function deckSummary(deck: Deck) {
  const main = deck.entries.filter((e) => e.board === 'main');
  const identity = new Set(main.flatMap((e) => e.card.colorIdentity));
  const curve = Array.from({ length: 7 }, () => 0);
  let simulated = 0;
  let total = 0;
  for (const e of main) {
    if (!/\bLand\b/.test(e.card.typeLine)) curve[Math.min(6, Math.floor(e.card.cmc))] += e.qty;
    total += e.qty;
    if (engineStatus(e.card) === 'ok') simulated += e.qty;
  }
  return { colors: COLORS.filter((c) => identity.has(c)), curve, simulated, total, side: countCards(deck.entries.filter((e) => e.board === 'side')) };
}

const BASICS: Record<string, (typeof COLORS)[number]> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** A preset's colors, from the basic lands in its list (its cards are only fetched when a game starts). */
export function presetColors(id: string): (typeof COLORS)[number][] {
  const list = PRESET_DECKS.find((p) => p.id === id)?.list ?? '';
  const found = new Set(Object.entries(BASICS).filter(([land]) => new RegExp(`^\\d+ ${land}$`, 'm').test(list)).map(([, c]) => c));
  return COLORS.filter((c) => found.has(c));
}

/** The color of a deck's band: its color, or brass for several colors (none: grey). */
export function deckBand(colors: readonly string[]): string {
  const one: Record<string, string> = { W: '#cdbf98', U: '#3f86cf', B: '#5b4e56', R: '#d65a3e', G: '#3e9160' };
  if (colors.length === 1) return one[colors[0]];
  return colors.length ? '#c0623f' : '#6b6f78';
}

export function Pips({ colors }: { colors: readonly string[] }) {
  return (
    <span className="pips">
      {colors.map((c) => <span key={c} className={`pip pip-${c}`}>{c}</span>)}
    </span>
  );
}

export function Curve({ counts, label }: { counts: number[]; label: string }) {
  const max = Math.max(1, ...counts);
  return (
    <span className="mini-curve" role="img" aria-label={`${label}: ${counts.join(', ')}`}>
      {counts.map((n, i) => <span key={i} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />)}
    </span>
  );
}
