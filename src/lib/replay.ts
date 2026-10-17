import { apply, STATE_VERSION, type Action, type GameState, type LogEntry } from './engine/engine';
import { packState, unpackState } from './packState';

/**
 * A game's replay: its first state (decks shuffled, hands drawn) and every step played since. The engine is
 * deterministic (the shuffles come from the state's seed), so applying the steps again gives every state of the game.
 * A step is an action, or a line the server added to the log (a player who ran out of time).
 */
export type ReplayStep = { a: Action } | { log: LogEntry };

export interface Replay {
  start: GameState;
  steps: ReplayStep[];
}

/** A replay as saved and exported: what it is, for the lists. */
export interface ReplayFile {
  id: string;
  /** When the game ended. */
  at: number;
  /** "Mono Red vs Bot (Elves)" */
  title: string;
  /** The seat that recorded it ("you" in the replay); a spectator's replay: 0. */
  me: number;
  replay: Replay;
  /** The game's last log line count and winner, to tell when another version of the engine replays it differently. */
  end: { log: number; winner: GameState['winner'] };
}

export const newReplay = (start: GameState): Replay => ({ start, steps: [] });

export function nextState(state: GameState, step: ReplayStep): GameState {
  return 'a' in step ? apply(state, step.a) : { ...state, log: [...state.log, step.log] };
}

/**
 * Every state of the game, the first one included. `diverged`: a step the engine refused, or an end that differs from
 * the recorded one (a replay made with another version of the rules); the states stop at the step refused.
 */
export function replayStates(file: Pick<ReplayFile, 'replay' | 'end'>): { states: GameState[]; diverged: boolean } {
  const states = [file.replay.start];
  for (const step of file.replay.steps) {
    try {
      states.push(nextState(states[states.length - 1], step));
    } catch {
      return { states, diverged: true };
    }
  }
  const last = states[states.length - 1];
  return { states, diverged: last.log.length !== file.end.log || last.winner !== file.end.winner };
}

const FORMAT = 'magic-trainer-replay';

/** The file's text (also how it is kept in the browser). */
export function packReplay(file: ReplayFile): string {
  return packState({ format: FORMAT, v: STATE_VERSION, file });
}

export class ReplayFileError extends Error {
  constructor(readonly code: 'notReplay' | 'otherVersion') {
    super(code);
  }
}

export function unpackReplay(text: string): ReplayFile {
  let data: { format?: string; v?: number; file?: ReplayFile };
  try {
    data = unpackState(text);
  } catch {
    throw new ReplayFileError('notReplay');
  }
  const f = data?.file;
  if (data?.format !== FORMAT || !f || typeof f.id !== 'string' || !f.replay?.start?.players || !Array.isArray(f.replay.steps)) {
    throw new ReplayFileError('notReplay');
  }
  if (data.v !== STATE_VERSION) throw new ReplayFileError('otherVersion');
  return f;
}

/** Offers the replay as a file to save. */
export function downloadReplay(file: ReplayFile) {
  const blob = new Blob([packReplay(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date(file.at).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  a.download = `${file.title.replace(/[^\p{L}\p{N} &()-]+/gu, '').trim().slice(0, 60) || 'game'} ${date}.mtreplay.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Kept in the browser (the most recent ones) ----------

const INDEX_KEY = 'mt.replays';
const key = (id: string) => `mt.replay.${id}`;
const KEEP = 30;

export type ReplayInfo = Omit<ReplayFile, 'replay' | 'end'>;

export function listReplays(): ReplayInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string').sort((a, b) => b.at - a.at) : [];
  } catch {
    return [];
  }
}

export function loadReplay(id: string): ReplayFile | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? unpackReplay(raw) : null;
  } catch {
    return null;
  }
}

export function deleteReplay(id: string) {
  try {
    localStorage.removeItem(key(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(listReplays().filter((r) => r.id !== id)));
  } catch {
    // storage unavailable
  }
}

/** Keeps a replay; the oldest go when there are too many or the storage is full. False: it couldn't be kept. */
export function saveReplay(file: ReplayFile): boolean {
  const packed = packReplay(file);
  const info: ReplayInfo = { id: file.id, at: file.at, title: file.title, me: file.me };
  for (;;) {
    const others = listReplays().filter((r) => r.id !== file.id);
    try {
      for (const old of others.slice(KEEP - 1)) localStorage.removeItem(key(old.id));
      localStorage.setItem(key(file.id), packed);
      localStorage.setItem(INDEX_KEY, JSON.stringify([info, ...others.slice(0, KEEP - 1)]));
      return true;
    } catch {
      const oldest = others.at(-1);
      if (!oldest) return false;
      try {
        localStorage.removeItem(key(oldest.id));
        localStorage.setItem(INDEX_KEY, JSON.stringify(others.slice(0, -1)));
      } catch {
        return false;
      }
    }
  }
}
