import { describe, expect, it } from 'vitest';
import { botAction } from './engine/bot';
import { actor, apply, newGame } from './engine/engine';
import { nextState, newReplay, packReplay, replayStates, ReplayFileError, unpackReplay, type ReplayFile } from './replay';
import { ownerNamed } from './replayNames';
import type { Card } from '../types';

const forest: Card = {
  id: 'f', name: 'Forest', manaCost: '', cmc: 0, typeLine: 'Basic Land — Forest', oracleText: '({T}: Add {G}.)',
  colors: [], colorIdentity: ['G'], setCode: 't', setName: 'T', rarity: 'common',
};
const bears: Card = {
  id: 'b', name: 'Grizzly Bears', manaCost: '{1}{G}', cmc: 2, typeLine: 'Creature — Bear', oracleText: '',
  colors: ['G'], colorIdentity: ['G'], setCode: 't', setName: 'T', rarity: 'common', power: '2', toughness: '2',
};
const deck = [...Array(24).fill(forest), ...Array(16).fill(bears)];

/** Two bots play a game, recorded as a replay. */
function playedGame() {
  let rng = 0.42;
  let game = newGame({ decks: [deck, deck], names: ['A', 'B'], first: 0, rng: () => (rng = (rng * 9301 + 49297) % 1) });
  const replay = newReplay(game);
  for (let i = 0; i < 3000 && game.winner === null && actor(game) !== null; i++) {
    const a = botAction(game);
    game = apply(game, a);
    replay.steps.push({ a });
  }
  replay.steps.push({ log: { k: 'timedOut', p: 1 } });
  game = nextState(game, replay.steps.at(-1)!);
  const file: ReplayFile = { id: 'r1', at: 1, title: 'A vs B', me: 0, replay, end: { log: game.log.length, winner: game.winner } };
  return { game, file };
}

describe('replays', () => {
  it('give back every state of the game from its first state and its steps', () => {
    const { game, file } = playedGame();
    expect(game.winner).not.toBeNull();
    const { states, diverged } = replayStates(file);
    expect(diverged).toBe(false);
    expect(states).toHaveLength(file.replay.steps.length + 1);
    expect(states.at(-1)).toEqual(game);
  });

  it('travel as a file, and tell a game played differently by another version', () => {
    const { file } = playedGame();
    const back = unpackReplay(packReplay(file));
    expect(replayStates(back).states.at(-1)!.winner).toBe(file.end.winner);
    expect(replayStates({ ...back, end: { ...back.end, log: back.end.log + 1 } }).diverged).toBe(true);
    expect(() => unpackReplay('{"cards":[],"data":{"x":1}}')).toThrow(ReplayFileError);
    expect(() => unpackReplay('not json')).toThrow(ReplayFileError);
  });
});

describe('shared replays', () => {
  it('name the owner\'s seat where the game stored "You" (any language), not real names', () => {
    const { file } = playedGame();
    const named = (name: string) => ({ ...file, replay: { ...file.replay, start: { ...file.replay.start, players: file.replay.start.players.map((p, i) => (i === 0 ? { ...p, name } : p)) } } });
    expect(ownerNamed(named('You'), 'Alice').replay.start.players.map((p) => p.name)).toEqual(['Alice', 'B']);
    expect(ownerNamed(named('Vous'), 'Alice').replay.start.players[0].name).toBe('Alice');
    expect(ownerNamed(named('You & Ally'), 'Alice').replay.start.players[0].name).toBe('Alice & Ally');
    expect(ownerNamed(named('Bob'), 'Alice').replay.start.players[0].name).toBe('Bob');
    expect(replayStates(ownerNamed(named('You'), 'Alice')).diverged).toBe(false);
  });
});
