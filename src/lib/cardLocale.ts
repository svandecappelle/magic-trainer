import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useLang } from '../i18n';
import type { Card } from '../types';
import { fetchPrintings } from './scryfall';
import { isToken } from './engine/rules';

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
    // Tokens have no printings to look up.
    const localized = (card: Card) => (own(card) || isToken(card) ? null : lookup(card.name));

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
      imageSmall: (card) => localized(card)?.imageSmall ?? card.imageSmall ?? card.imageNormal ?? drawnCard(card),
      imageNormal: (card) => localized(card)?.imageNormal ?? card.imageNormal ?? card.imageSmall ?? drawnCard(card),
      nameOf: (englishName) => (lang === 'en' ? englishName : lookup(englishName)?.name ?? englishName),
    };
  }, [lang, table]);
}

const FRAME: Record<string, string> = { W: '#e9e2c4', U: '#3d7ac2', B: '#4a4250', R: '#c4452f', G: '#2f8a52' };
const escapeXml = (t: string) => t.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const drawn = new Map<string, string>();

/** A simple card face for cards without an image (tokens): name, type line, rules text and P/T. */
export function drawnCard(card: Card): string {
  const key = `${card.name}|${card.typeLine}|${card.colors.join('')}|${card.power}/${card.toughness}|${card.oracleText}`;
  const cached = drawn.get(key);
  if (cached) return cached;
  const fill = card.colors.length === 1 ? FRAME[card.colors[0]] : card.colors.length > 1 ? '#c9a64a' : '#9a9ea6';
  // Rules text wrapped to ~22 characters per line, at most 5 lines.
  const lines = card.oracleText.split(/\s+/).reduce<string[]>((out, w) => {
    const last = out.at(-1);
    if (last !== undefined && (last + ' ' + w).length <= 22) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
    return out;
  }, []).slice(0, 5);
  const pt = card.power !== undefined ? `<rect x="118" y="244" width="58" height="26" rx="6" fill="#f4f1e8" stroke="#222"/><text x="147" y="263" font-size="17" font-weight="700" text-anchor="middle">${escapeXml(`${card.power}/${card.toughness}`)}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 266" font-family="Georgia, serif">
<rect width="190" height="266" rx="10" fill="#151515"/>
<rect x="8" y="8" width="174" height="250" rx="7" fill="${fill}"/>
<rect x="14" y="14" width="162" height="26" rx="4" fill="#f4f1e8"/>
<text x="20" y="32" font-size="14" font-weight="700">${escapeXml(card.name)}</text>
<rect x="14" y="46" width="162" height="96" rx="4" fill="rgba(255,255,255,0.18)"/>
<text x="95" y="106" font-size="30" text-anchor="middle" fill="rgba(0,0,0,0.35)">✦</text>
<rect x="14" y="148" width="162" height="22" rx="4" fill="#f4f1e8"/>
<text x="20" y="164" font-size="10.5">${escapeXml(card.typeLine)}</text>
<rect x="14" y="176" width="162" height="64" rx="4" fill="#f4f1e8" opacity="0.92"/>
${lines.map((l, i) => `<text x="20" y="${192 + i * 12}" font-size="10">${escapeXml(l)}</text>`).join('')}
${pt}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  drawn.set(key, uri);
  return uri;
}
