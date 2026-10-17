import { describe, expect, it } from 'vitest';
import { newGame } from './engine/engine';
import { packState, unpackState } from './packState';
import type { Card } from '../types';

const card = (name: string): Card => ({
  id: name, name, manaCost: '', cmc: 0, typeLine: 'Basic Land', oracleText: `{T}: Add mana. (${name})`,
  colors: [], colorIdentity: [], setCode: 't', setName: 'T', rarity: 'common',
});

describe('packState', () => {
  it('restores a game state exactly, writing each card once', () => {
    const decks = [Array(40).fill(card('Mountain')), [...Array(39).fill(card('Forest')), { ...card('Forest'), setCode: 'other' }]];
    const game = newGame({ decks, names: ['A', 'B'], first: 0, rng: () => 0.3 });
    const packed = packState({ game, extra: [card('Mountain')] });
    expect(unpackState(packed)).toEqual({ game, extra: [card('Mountain')] });
    // Mountain, Forest and the other Forest printing.
    expect(JSON.parse(packed).cards).toHaveLength(3);
    expect(packed.length).toBeLessThan(JSON.stringify(game).length / 3);
  });
});
