import { startingLife, type GameMode } from './engine/engine';
import { checkDeck, type DeckIssue } from './legality';
import type { Card, Deck } from '../types';

/**
 * The game modes of the setup pages (Play vs Bot, Play Online): what decks may be played and with what life.
 * - Constructed: a normal game in a format (Standard, Modern…); a deck not legal in it can't be played.
 * - Free Play: no restriction on the deck at all.
 * - Commander: 100-card singleton, 40 life; Duel Commander: the same for two players, 20 life. A deck that breaks
 *   their rules plays with a warning.
 * Two-Headed Giant is an option of every mode but Duel Commander.
 */
export const SETUP_MODES = ['constructed', 'free', 'commander', 'duelCommander'] as const;
export type SetupMode = (typeof SETUP_MODES)[number];

export const CONSTRUCTED_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper'] as const;
export type ConstructedFormat = (typeof CONSTRUCTED_FORMATS)[number];

export interface GameSetup {
  mode: SetupMode;
  /** Constructed: the format the decks must be legal in. */
  format: ConstructedFormat;
  twoHeaded: boolean;
}

/** A first visit: Free Play, so that any deck (the presets too) plays right away. */
export const DEFAULT_SETUP: GameSetup = { mode: 'free', format: 'modern', twoHeaded: false };

export const canTwoHead = (mode: SetupMode) => mode !== 'duelCommander';

/** A setup from untrusted data (a message, the browser's storage): the default for what isn't valid. */
export function cleanSetup(v: unknown): GameSetup {
  const x = (v ?? {}) as Partial<GameSetup>;
  const mode = SETUP_MODES.includes(x.mode as SetupMode) ? (x.mode as SetupMode) : DEFAULT_SETUP.mode;
  const format = CONSTRUCTED_FORMATS.includes(x.format as ConstructedFormat) ? (x.format as ConstructedFormat) : DEFAULT_SETUP.format;
  return { mode, format, twoHeaded: x.twoHeaded === true && canTwoHead(mode) };
}

/** The rules engine's mode for a setup. */
export function gameModeOf(s: GameSetup): GameMode {
  const commander = s.mode === 'commander' || s.mode === 'duelCommander';
  return {
    ...(s.twoHeaded && canTwoHead(s.mode) ? { twoHeaded: true } : {}),
    ...(commander ? { commander: true } : {}),
    ...(s.mode === 'duelCommander' ? { duelCommander: true } : {}),
  };
}

/** Starting life of each player (each team in Two-Headed Giant). */
export const startingLifeOf = (s: GameSetup) => startingLife(gameModeOf(s));

export interface DeckCards {
  main: Card[];
  side: Card[];
  commander: Card[];
}

/**
 * A deck's problems for a setup: `blocking` ones keep it from being played (Constructed: not legal in the format),
 * `warnings` don't (cards without legality data, the Commander modes' rules).
 */
export function deckProblems(cards: DeckCards, s: GameSetup): { blocking: DeckIssue[]; warnings: DeckIssue[] } {
  if (s.mode === 'free') return { blocking: [], warnings: [] };
  const format = s.mode === 'constructed' ? s.format : 'commander';
  const issues = checkDeck(asDeck(cards, format));
  if (s.mode !== 'constructed') return { blocking: [], warnings: issues };
  return { blocking: issues.filter((i) => i.kind !== 'unknown'), warnings: issues.filter((i) => i.kind === 'unknown') };
}

/** The cards (one per copy) as a deck in a format, for the legality check. */
function asDeck(cards: DeckCards, format: string): Deck {
  const entries: Deck['entries'] = [];
  for (const [board, list] of [['main', cards.main], ['side', cards.side], ['commander', cards.commander]] as const) {
    const byId = new Map<string, { card: Card; qty: number }>();
    for (const card of list) {
      const e = byId.get(card.id);
      if (e) e.qty++;
      else byId.set(card.id, { card, qty: 1 });
    }
    for (const { card, qty } of byId.values()) entries.push({ card, qty, board });
  }
  return { id: '', name: '', format, entries, createdAt: 0, updatedAt: 0 };
}
