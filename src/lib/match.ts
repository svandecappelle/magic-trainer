import type { PlayerId } from './engine/engine';
import type { Card } from '../types';

/** A match: one game, or the best of three. */
export interface MatchScore {
  bestOf: 1 | 3;
  wins: [number, number];
  /** Games played (draws included). */
  games: number;
  /** Who played first in the last game. */
  lastFirst?: PlayerId;
}

export const newMatch = (bestOf: 1 | 3): MatchScore => ({ bestOf, wins: [0, 0], games: 0 });

/** The score after a game, given who won it and who played first. */
export function recordGame(m: MatchScore, winner: PlayerId | 'draw', first: PlayerId): MatchScore {
  const wins = [...m.wins] as [number, number];
  if (winner !== 'draw') wins[winner]++;
  return { ...m, wins, games: m.games + 1, lastFirst: first };
}

/** The match winner, once someone has won enough games. */
export function matchWinner(m: MatchScore): PlayerId | null {
  const needed = Math.ceil(m.bestOf / 2);
  return m.wins[0] >= needed ? 0 : m.wins[1] >= needed ? 1 : null;
}

/** The loser of the last game plays first in the next one (after a draw, the other player does). */
export function nextFirst(lastWinner: PlayerId | 'draw', lastFirst: PlayerId): PlayerId {
  if (lastWinner === 'draw') return lastFirst === 0 ? 1 : 0;
  return lastWinner === 0 ? 1 : 0;
}

/** Is `deck` made only of cards from `pool` (main deck + sideboard), each used at most as often as it's there? */
export function isRearrangement(pool: Card[], deck: Card[]): boolean {
  const left = new Map<string, number>();
  for (const c of pool) left.set(c.id, (left.get(c.id) ?? 0) + 1);
  for (const c of deck) {
    const n = left.get(c.id) ?? 0;
    if (!n) return false;
    left.set(c.id, n - 1);
  }
  return true;
}
