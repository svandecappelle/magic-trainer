import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { botAction } from './engine/bot';
import { actor, apply, newGame } from './engine/engine';
import { loadBotGame } from './botGames';
import { startPractice } from './practice';
import { newReplay, replayStates, type ReplayFile } from './replay';
import type { Card } from '../types';

const forest: Card = {
  id: 'f', name: 'Forest', manaCost: '', cmc: 0, typeLine: 'Basic Land — Forest', oracleText: '({T}: Add {G}.)',
  colors: [], colorIdentity: ['G'], setCode: 't', setName: 'T', rarity: 'common',
};
const deck: Card[] = Array(40).fill(forest);

describe('play from a replay moment', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves a bot game from that state, in the seat watched, outside any match', () => {
    let game = newGame({ decks: [deck, deck], names: ['', 'Ann'], first: 0, rng: () => 0.3 });
    const replay = newReplay(game);
    for (let i = 0; i < 40 && actor(game) !== null; i++) {
      const a = botAction(game);
      game = apply(game, a);
      replay.steps.push({ a });
    }
    const file: ReplayFile = { id: 'r1', at: 1, title: 'Elves vs Ann', me: 0, replay, end: { log: game.log.length, winner: game.winner } };
    const moment = replayStates(file).states[30];

    const id = startPractice(file, moment, 1, ['Bot', 'Ann'], '/history/replay/r1');
    const saved = loadBotGame(id!)!;
    expect(saved.practice).toMatchObject({ me: 1, title: 'Elves vs Ann', back: '/history/replay/r1' });
    // The seat played shows as "You".
    expect(saved.game.players.map((p) => p.name)).toEqual(['Bot', '']);
    expect(saved.game.turn).toBe(moment.turn);
    expect(saved.game.players[1].library).toHaveLength(moment.players[1].library.length);
    expect(saved.match).toBeNull();
    expect(saved.matchInfo?.recorded).toBe(true);
    expect(saved.replay?.start).toEqual(saved.game);
    expect(saved.current).toEqual({ first: moment.active, scored: false });
  });
});
