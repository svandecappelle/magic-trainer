import { type GameState, type PlayerId } from './engine/engine';
import { saveBotGame, type BotGame } from './botGames';
import { cleanSetup } from './gameModes';
import { newReplay, type ReplayFile } from './replay';

/**
 * "Play from here": a game against the bot from a moment of a replay. You take the seat you were watching from, the bot
 * plays every other one. It's practice: no match, nothing in the history (its replay is kept like any game's).
 * `names`: the players' names (yours is set empty: "You"). `back`: the replay's page. Returns the bot game's id (/play/<id>), null when the browser can't keep it.
 */
export function startPractice(file: ReplayFile, state: GameState, seat: PlayerId, names: string[], back: string): string | null {
  const mode = state.mode ?? {};
  const setup = cleanSetup({ mode: mode.duelCommander ? 'duelCommander' : mode.commander ? 'commander' : 'free', twoHeaded: !!mode.twoHeaded });
  // Your seat shows as "You"; an online game's stops and full control don't apply against the bot.
  const game: GameState = {
    ...state,
    players: state.players.map((p, i) => ({ ...p, name: i === seat ? '' : names[i] ?? p.name })),
    publicStops: undefined,
    fullControl: undefined,
  };
  const id = crypto.randomUUID();
  const saved: BotGame = {
    setup: { myDeck: '', botDeck: '', allyDeck: '', botDeck2: '', setup, first: 'random', bestOf: 1 },
    game, match: null, myCards: null, botCards: [], commanders: [], between: false,
    current: { first: state.active, scored: false },
    replay: newReplay(game),
    // Not a match: nothing goes in the history.
    matchInfo: { id, replays: [], recorded: true },
    practice: { me: seat, start: game, title: file.title, back },
  };
  return saveBotGame(id, saved, [file.title, '']) ? id : null;
}
