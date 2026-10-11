import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LogEntry, PlayerId } from '../lib/engine/engine';
import { en, type Messages } from './en';
import { fr } from './fr';
import type { AppError, LogContext } from './types';

export type { AppError } from './types';

/** To add a language: copy en.ts, translate it, and register it here. */
const MESSAGES = { en, fr } satisfies Record<string, Messages>;
export type Lang = keyof typeof MESSAGES;
export const LANGS = Object.keys(MESSAGES) as Lang[];

function detect(): Lang {
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = tag.toLowerCase().split('-')[0];
      if (base in MESSAGES) return base as Lang;
    }
  } catch {
    // no navigator (tests, server)
  }
  return 'en';
}

export const useLang = create<{ lang: Lang; setLang: (lang: Lang) => void }>()(
  persist((set) => ({ lang: detect(), setLang: (lang) => set({ lang }) }), { name: 'magic-trainer-lang' }),
);

export const messagesFor = (lang: Lang): Messages => MESSAGES[lang] ?? en;

export function useT(): Messages {
  return messagesFor(useLang((s) => s.lang));
}

/** Render an error code (engine, server or browser) in the current language. */
export function errorText(t: Messages, e: AppError): string {
  const render = t.errors[e.code];
  return render ? render(e.params ?? {}) : e.code;
}

/** Render a game log entry from the point of view of `me`; `card` localizes card names. */
export function logText(
  t: Messages, entry: LogEntry, names: [string, string], me: PlayerId, card: (englishName: string) => string = (n) => n,
): string {
  const ctx: LogContext = { name: (p) => names[p], isMe: (p) => p === me, list: t.list, card };
  const render = t.log[entry.k] as ((e: LogEntry, c: LogContext) => string) | undefined;
  // An entry this version doesn't know (a newer server): show its kind rather than break the page.
  return render ? render(entry, ctx) : entry.k;
}
