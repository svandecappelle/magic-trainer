import type { Card, Deck } from '../types';
import { parseDeckText } from './deckText';
import { PRESET_DECKS } from './engine/presets';
import { resolveDecklist } from './importDeck';

const presetCache = new Map<string, Card[]>();
const sideCache = new Map<string, Card[]>();

/** Main-deck cards (one entry per copy) for a saved deck or a preset id. */
export async function loadDeckCards(id: string, decks: Deck[]): Promise<Card[]> {
  const preset = PRESET_DECKS.find((p) => p.id === id);
  if (!preset) {
    const deck = decks.find((d) => d.id === id);
    return deck ? deck.entries.filter((e) => e.board === 'main').flatMap((e) => Array(e.qty).fill(e.card)) : [];
  }
  const cached = presetCache.get(id);
  if (cached) return cached;
  const { entries } = await resolveDecklist(parseDeckText(preset.list));
  const cards = entries.filter((e) => e.board === 'main').flatMap((e) => Array(e.qty).fill(e.card));
  presetCache.set(id, cards);
  sideCache.set(id, entries.filter((e) => e.board === 'side').flatMap((e) => Array(e.qty).fill(e.card)));
  return cards;
}

/** Main deck, sideboard and commanders (one entry per copy), for a match with sideboarding or a Commander game. */
export async function loadDeck75(id: string, decks: Deck[]): Promise<{ main: Card[]; side: Card[]; commander: Card[] }> {
  const main = await loadDeckCards(id, decks);
  const deck = decks.find((d) => d.id === id);
  const board = (b: 'side' | 'commander') => (deck ? deck.entries.filter((e) => e.board === b).flatMap((e) => Array(e.qty).fill(e.card)) : []);
  return { main, side: deck ? board('side') : (sideCache.get(id) ?? []), commander: board('commander') };
}
