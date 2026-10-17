import { STATE_VERSION, type GameState, type PlayerId } from './engine/engine';
import type { MatchScore } from './match';
import { packState, unpackState } from './packState';
import type { Replay } from './replay';
import { cleanSetup, type GameSetup } from './gameModes';
import type { Card } from '../types';

/**
 * Games against the bot, saved in this browser after each action so /play/<id> resumes them after a reload. The
 * most recent ones are kept; a game saved by an older engine (STATE_VERSION) is dropped.
 */

/** The setup the game was started with (a new match or a rematch uses it again). */
export interface BotSetup {
  myDeck: string;
  botDeck: string;
  allyDeck: string;
  botDeck2: string;
  setup: GameSetup;
  first: 'random' | 'me' | 'bot';
  bestOf: 1 | 3;
}

export interface BotGame {
  setup: BotSetup;
  game: GameState;
  match: MatchScore | null;
  myCards: { main: Card[]; side: Card[] } | null;
  botCards: Card[][];
  commanders: Card[][];
  between: boolean;
  current: { first: PlayerId; scored: boolean };
  /** The current game's replay so far. */
  replay?: Replay;
  /** The match: its id (in the history), the replays of its finished games, its result saved. */
  matchInfo?: MatchInfo;
}

export interface MatchInfo {
  id: string;
  replays: string[];
  recorded: boolean;
}

/** A line of the list of saved games. */
export interface BotGameInfo {
  id: string;
  savedAt: number;
  /** Your deck's name and the opponents'. */
  title: [string, string];
  turn: number;
  over: boolean;
}

const INDEX_KEY = 'mt.botGames';
const gameKey = (id: string) => `mt.botGame.${id}`;
/** Saved games kept; the oldest go first (also when the browser storage is full). */
const KEEP = 10;

export function listBotGames(): BotGameInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string').sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: BotGameInfo[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function loadBotGame(id: string): BotGame | null {
  try {
    const raw = localStorage.getItem(gameKey(id));
    if (!raw) return null;
    const { v, game } = unpackState<{ v: number; game: BotGame }>(raw);
    if (v === STATE_VERSION && game?.game?.players) {
      // Saved before game modes: the mode from its rules.
      const old = game.setup as BotSetup & { twoHeaded?: boolean; commander?: boolean; duelLife?: number };
      if (!old.setup) {
        old.setup = cleanSetup({ mode: old.commander ? (old.duelLife === 20 ? 'duelCommander' : 'commander') : 'free', twoHeaded: old.twoHeaded });
      }
      return game;
    }
  } catch {
    // unreadable: dropped below
  }
  deleteBotGame(id);
  return null;
}

export function deleteBotGame(id: string) {
  try {
    localStorage.removeItem(gameKey(id));
    writeIndex(listBotGames().filter((g) => g.id !== id));
  } catch {
    // storage unavailable
  }
}

/** Saves a game; returns false when the browser can't keep it (storage unavailable or full even after clean-up). */
export function saveBotGame(id: string, game: BotGame, title: [string, string]): boolean {
  let packed: string;
  try {
    packed = packState({ v: STATE_VERSION, game });
  } catch {
    return false;
  }
  const info: BotGameInfo = { id, savedAt: Date.now(), title, turn: game.game.turn, over: game.game.winner !== null };
  for (;;) {
    try {
      const others = listBotGames().filter((g) => g.id !== id);
      // Over the limit: forget the oldest.
      for (const old of others.slice(KEEP - 1)) localStorage.removeItem(gameKey(old.id));
      localStorage.setItem(gameKey(id), packed);
      writeIndex([info, ...others.slice(0, KEEP - 1)]);
      return true;
    } catch {
      // Storage full: make room by forgetting the oldest other game, if any.
      const others = listBotGames().filter((g) => g.id !== id);
      const oldest = others.at(-1);
      if (!oldest) return false;
      try {
        localStorage.removeItem(gameKey(oldest.id));
        writeIndex(others.slice(0, -1));
      } catch {
        return false;
      }
    }
  }
}
