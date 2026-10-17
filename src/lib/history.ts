import { accountApi } from './account/api';

/**
 * Results of finished matches (against the bot and online), kept in this browser and, logged in, in the account
 * (GET/POST /api/history; online results are recorded by the server itself). Results have the match's id, so the
 * browser's copy and the account's are merged without doubles.
 */

export interface MatchResult {
  id: string;
  /** When the match ended. */
  at: number;
  kind: 'bot' | 'online';
  twoHeaded: boolean;
  commander: boolean;
  bestOf: 1 | 3;
  /** Your deck's name, and the opponents' (their decks against the bot, their names online). */
  deck: string;
  opponent: string;
  result: 'win' | 'loss' | 'draw';
  /** Games won and lost in the match. */
  wins: number;
  losses: number;
  /** In this browser only: the replays of the match's games (lib/replay.ts). */
  replays?: string[];
  /** In this browser only: a bot result already sent to the account. */
  synced?: boolean;
}

export const RESULTS = ['win', 'loss', 'draw'] as const;

const KEY = 'mt.history';
const KEEP = 500;

const isResult = (r: unknown): r is MatchResult => {
  const x = r as MatchResult;
  return !!x && typeof x.id === 'string' && typeof x.at === 'number' && RESULTS.includes(x.result) && typeof x.deck === 'string';
};

export function listResults(): MatchResult[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isResult).sort((a, b) => b.at - a.at) : [];
  } catch {
    return [];
  }
}

function write(list: MatchResult[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, KEEP)));
  } catch {
    // storage full or unavailable: the history isn't essential
  }
}

/** Adds a result, or replaces the one with the same id. */
export function saveResult(r: MatchResult) {
  write([r, ...listResults().filter((x) => x.id !== r.id)].sort((a, b) => b.at - a.at));
}

export function hasResult(id: string): boolean {
  return listResults().some((r) => r.id === id);
}

export function markSynced(ids: string[]) {
  const done = new Set(ids);
  write(listResults().map((r) => (done.has(r.id) ? { ...r, synced: true } : r)));
}

export function clearResults() {
  write([]);
}

/** The browser's results and the account's together: one line per match, the browser's replays kept. */
export function mergeResults(local: MatchResult[], remote: MatchResult[]): MatchResult[] {
  const byId = new Map(remote.map((r) => [r.id, r]));
  for (const r of local) byId.set(r.id, { ...byId.get(r.id), ...r });
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

export interface Tally {
  matches: number;
  win: number;
  loss: number;
  draw: number;
}

const emptyTally = (): Tally => ({ matches: 0, win: 0, loss: 0, draw: 0 });

/** Share of matches won, draws counting as half (0–100), or null without any match. */
export const winRate = (t: Tally) => (t.matches ? Math.round((100 * (t.win + t.draw / 2)) / t.matches) : null);

/** Totals, per deck and per opponent (most played first). */
export function summarize(results: MatchResult[]) {
  const total = emptyTally();
  const decks = new Map<string, Tally>();
  const opponents = new Map<string, Tally>();
  for (const r of results) {
    for (const t of [total, get(decks, r.deck), get(opponents, r.opponent)]) {
      t.matches++;
      t[r.result]++;
    }
  }
  const sorted = (m: Map<string, Tally>) => [...m.entries()].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
  return { total, decks: sorted(decks), opponents: sorted(opponents) };
}

function get(m: Map<string, Tally>, key: string): Tally {
  let t = m.get(key);
  if (!t) m.set(key, (t = emptyTally()));
  return t;
}

/**
 * Logged in: sends the bot results not sent yet, then returns the account's results merged with this browser's.
 * Throws (ApiError) when the account can't be reached.
 */
export async function syncResults(): Promise<MatchResult[]> {
  const unsent = listResults().filter((r) => r.kind === 'bot' && !r.synced);
  for (let i = 0; i < unsent.length; i += 200) {
    const batch = unsent.slice(i, i + 200);
    await accountApi.postHistory(batch.map(({ replays: _r, synced: _s, ...r }) => r));
    markSynced(batch.map((r) => r.id));
  }
  const { results } = await accountApi.history();
  return mergeResults(listResults(), results);
}
