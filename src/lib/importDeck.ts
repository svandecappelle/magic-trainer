import type { DeckEntry } from '../types';
import type { ParsedLine } from './deckText';
import { fetchCardsByName } from './scryfall';

/** Look up parsed decklist lines on Scryfall and turn them into deck entries. */
export async function resolveDecklist(lines: ParsedLine[]): Promise<{ entries: DeckEntry[]; notFound: string[] }> {
  // Scryfall's name lookup rejects "Fire // Ice" but accepts "Fire", so send front-face names.
  const names = [...new Set(lines.map((l) => l.name.split(' // ')[0]))];
  const { found, notFound } = await fetchCardsByName(names);
  const byName = new Map(found.map((c) => [c.name.toLowerCase(), c]));
  // Index front-face names too, so both "Fire" and "Fire // Ice" lines resolve.
  for (const c of found) byName.set(c.name.split(' // ')[0].toLowerCase(), c);

  const entries: DeckEntry[] = [];
  for (const l of lines) {
    const card = byName.get(l.name.toLowerCase());
    if (!card) continue;
    // "Fire" and "Fire // Ice" lines on the same board resolve to the same card: merge them.
    const existing = entries.find((e) => e.card.id === card.id && e.board === l.board);
    if (existing) existing.qty += l.qty;
    else entries.push({ card, qty: l.qty, board: l.board });
  }
  return { entries, notFound };
}
