import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Board, Card, CollectionEntry, Deck, DeckEntry } from '../types';

interface AppState {
  decks: Deck[];
  collection: Record<string, CollectionEntry>;

  createDeck: (name: string, format: string) => string;
  updateDeck: (id: string, patch: Partial<Pick<Deck, 'name' | 'format' | 'entries'>>) => void;
  deleteDeck: (id: string) => void;
  /** Add (or remove, with a negative delta) copies of a card in a deck. */
  addToDeck: (deckId: string, card: Card, board: Board, delta: number) => void;
  moveBoard: (deckId: string, cardId: string, from: Board) => void;

  addToCollection: (card: Card, delta: number, foil?: boolean) => void;
}

function changeQty(entries: DeckEntry[], card: Card, board: Board, delta: number): DeckEntry[] {
  const idx = entries.findIndex((e) => e.card.id === card.id && e.board === board);
  if (idx === -1) return delta > 0 ? [...entries, { card, qty: delta, board }] : entries;
  const qty = entries[idx].qty + delta;
  return qty > 0
    ? entries.map((e, i) => (i === idx ? { ...e, qty } : e))
    : entries.filter((_, i) => i !== idx);
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      decks: [],
      collection: {},

      createDeck: (name, format) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        set((s) => ({ decks: [...s.decks, { id, name, format, entries: [], createdAt: now, updatedAt: now }] }));
        return id;
      },

      updateDeck: (id, patch) =>
        set((s) => ({ decks: s.decks.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)) })),

      deleteDeck: (id) => set((s) => ({ decks: s.decks.filter((d) => d.id !== id) })),

      addToDeck: (deckId, card, board, delta) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId ? { ...d, entries: changeQty(d.entries, card, board, delta), updatedAt: Date.now() } : d,
          ),
        })),

      moveBoard: (deckId, cardId, from) =>
        set((s) => ({
          decks: s.decks.map((d) => {
            if (d.id !== deckId) return d;
            const entry = d.entries.find((e) => e.card.id === cardId && e.board === from);
            if (!entry) return d;
            const to: Board = from === 'main' ? 'side' : 'main';
            let entries = changeQty(d.entries, entry.card, from, -1);
            entries = changeQty(entries, entry.card, to, 1);
            return { ...d, entries, updatedAt: Date.now() };
          }),
        })),

      addToCollection: (card, delta, foil = false) =>
        set((s) => {
          const prev = s.collection[card.id] ?? { card, qty: 0, foilQty: 0 };
          const next = foil
            ? { ...prev, foilQty: Math.max(0, prev.foilQty + delta) }
            : { ...prev, qty: Math.max(0, prev.qty + delta) };
          const collection = { ...s.collection };
          if (next.qty + next.foilQty === 0) delete collection[card.id];
          else collection[card.id] = next;
          return { collection };
        }),
    }),
    { name: 'magic-trainer', version: 1 },
  ),
);
