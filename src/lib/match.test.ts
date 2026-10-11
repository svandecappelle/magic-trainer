import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { isRearrangement, matchWinner, newMatch, nextFirst, recordGame } from './match';

const card = (id: string) => ({ id, name: id }) as Card;

describe('match', () => {
  it('scores a best of 3, the loser playing first next', () => {
    let m = newMatch(3);
    m = recordGame(m, 1, 0);
    expect(matchWinner(m)).toBeNull();
    expect(nextFirst(1, 0)).toBe(0);
    m = recordGame(m, 'draw', 0);
    expect(nextFirst('draw', 0)).toBe(1);
    m = recordGame(m, 1, 1);
    expect(m).toMatchObject({ wins: [0, 2], games: 3 });
    expect(matchWinner(m)).toBe(1);
    expect(matchWinner(recordGame(newMatch(1), 0, 0))).toBe(0);
  });

  it('accepts a deck made from the 75 only', () => {
    const pool = [card('a'), card('a'), card('b')];
    expect(isRearrangement(pool, [card('a'), card('b')])).toBe(true);
    expect(isRearrangement(pool, [card('b'), card('b')])).toBe(false);
    expect(isRearrangement(pool, [card('c')])).toBe(false);
  });
});
