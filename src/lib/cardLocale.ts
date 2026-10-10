import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useLang } from '../i18n';
import type { Card } from '../types';
import { fetchPrintings } from './scryfall';

/** How a card looks in one language. */
export interface LocalizedCard {
  name?: string;
  typeLine?: string;
  imageSmall?: string;
  imageNormal?: string;
}

interface CardLocaleState {
  /** lang → English card name → printing in that language (null: none exists). */
  byLang: Record<string, Record<string, LocalizedCard | null>>;
  add: (lang: string, entries: Record<string, LocalizedCard | null>) => void;
}

export const useCardLocale = create<CardLocaleState>()(
  persist(
    (set) => ({
      byLang: {},
      add: (lang, entries) => set((s) => ({ byLang: { ...s.byLang, [lang]: { ...s.byLang[lang], ...entries } } })),
    }),
    { name: 'magic-trainer-card-locale', version: 1 },
  ),
);

// ---------- Batched fetching ----------

const pending = new Map<string, Set<string>>();
const inFlight = new Set<string>();
/** After a network error, wait before asking Scryfall about the same cards again. */
const failedUntil = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Queue English card names whose `lang` printing is unknown; fetched together shortly after. */
export function requestPrintings(lang: string, names: string[]) {
  const known = useCardLocale.getState().byLang[lang] ?? {};
  for (const name of names) {
    const key = `${lang}|${name}`;
    if (name in known || inFlight.has(key) || (failedUntil.get(key) ?? 0) > Date.now()) continue;
    if (!pending.has(lang)) pending.set(lang, new Set());
    pending.get(lang)!.add(name);
  }
  if (pending.size && !timer) timer = setTimeout(flush, 50);
}

async function flush() {
  timer = undefined;
  const batches = [...pending.entries()];
  pending.clear();
  for (const [lang, set] of batches) {
    const names = [...set];
    names.forEach((n) => inFlight.add(`${lang}|${n}`));
    try {
      const found = await fetchPrintings(names, lang);
      const entries: Record<string, LocalizedCard | null> = {};
      for (const name of names) {
        const c = found.get(name);
        entries[name] = c
          ? { name: c.printedName, typeLine: c.printedTypeLine, imageSmall: c.imageSmall, imageNormal: c.imageNormal }
          : null;
      }
      useCardLocale.getState().add(lang, entries);
    } catch {
      names.forEach((n) => failedUntil.set(`${lang}|${n}`, Date.now() + 60_000));
    } finally {
      names.forEach((n) => inFlight.delete(`${lang}|${n}`));
    }
  }
}

// ---------- Display ----------

export interface CardDisplay {
  name: (card: Card) => string;
  typeLine: (card: Card) => string;
  imageSmall: (card: Card) => string | undefined;
  imageNormal: (card: Card) => string | undefined;
  /** Display name for an English card name (game logs only store names). */
  nameOf: (englishName: string) => string;
}

/**
 * Shows cards in the current language: printed name, type line and image of a printing
 * in that language when Scryfall has one, otherwise the card as stored (English).
 * Missing printings are fetched in the background and cached.
 */
export function useCardDisplay(): CardDisplay {
  const lang = useLang((s) => s.lang);
  const table = useCardLocale((s) => s.byLang[lang]);

  return useMemo(() => {
    const printLang = (card: Card) => card.lang ?? 'en';
    // The card's own printing already is in the right language.
    const own = (card: Card) => printLang(card) === lang;

    const lookup = (englishName: string): LocalizedCard | null | undefined => {
      if (englishName === 'Hidden card') return null;
      const entry = table?.[englishName];
      if (entry === undefined) requestPrintings(lang, [englishName]);
      return entry;
    };
    const localized = (card: Card) => (own(card) ? null : lookup(card.name));

    return {
      name: (card) => {
        if (lang === 'en') return card.name;
        if (own(card)) return card.printedName ?? card.name;
        return localized(card)?.name ?? card.name;
      },
      typeLine: (card) => {
        if (lang === 'en') return card.typeLine;
        if (own(card)) return card.printedTypeLine ?? card.typeLine;
        return localized(card)?.typeLine ?? card.typeLine;
      },
      imageSmall: (card) => localized(card)?.imageSmall ?? card.imageSmall ?? card.imageNormal,
      imageNormal: (card) => localized(card)?.imageNormal ?? card.imageNormal ?? card.imageSmall,
      nameOf: (englishName) => (lang === 'en' ? englishName : lookup(englishName)?.name ?? englishName),
    };
  }, [lang, table]);
}
