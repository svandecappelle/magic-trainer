import type { Card } from '../../types';
import type { MatchScore } from '../match';
import { teamOf, type Action, type CardInst, type ErrorParams, type GameErrorCode, type GameMode, type GameState, type PlayerId, type PlayerState } from '../engine/engine';

/** Messages the browser sends to the server. */
export type ClientMessage =
  /**
   * `bestOf`: a single game or a best of 3; `size`: 2 players, or 4 for Two-Headed Giant (seats 0+1 against 2+3);
   * `commander`: Commander rules, `duelCommander`: its 20 life in a duel (all chosen by the room's creator). `sideboard`: for sideboarding between games;
   * `commanders`: the deck's commanders.
   */
  | { t: 'create'; name: string; deck: Card[]; sideboard?: Card[]; commanders?: Card[]; bestOf?: 1 | 3; size?: 2 | 4; commander?: boolean; duelCommander?: boolean }
  /** Join a room by its address (`room`, the id in /online/<id>) or its code. */
  | { t: 'join'; room?: string; code?: string; name: string; deck: Card[]; sideboard?: Card[]; commanders?: Card[] }
  /** The page /online/<id> is open: back to the seat (`token`: the seat's secret), or what is needed to join. */
  | { t: 'open'; room: string; token?: string }
  | { t: 'action'; action: Action }
  /** Ready for the next game; `deck`: the main deck after sideboarding (cards from your main deck and sideboard). */
  | { t: 'rematch'; deck?: Card[] }
  | { t: 'leave' };

export interface LobbyPlayer {
  name: string;
  connected: boolean;
  wantsRematch: boolean;
}

/** Errors specific to the server; rule violations use the engine's codes. */
export type ServerErrorCode =
  | 'invalidMessage' | 'unknownMessage' | 'enterName' | 'deckSize' | 'invalidCard' | 'cardCheckFailed' | 'noRoom' | 'roomFull'
  | 'gameGone' | 'notStarted' | 'invalidAction' | 'notYourTurn' | 'gameNotOver' | 'opponentLeft' | 'notInRoom';

export type ErrorCode = GameErrorCode | ServerErrorCode;

/** Messages the server sends to the browser. */
export type ServerMessage =
  /** First message on each connection: the build of the app the server ships ("dev" in development). */
  | { t: 'hello'; build: string }
  /** Seated in a room: `room` is its id (its address), `token` the secret to come back to this seat. */
  | { t: 'joined'; room: string; code: string; seat: PlayerId; token: string }
  /** `size`: seats in the room (2, or 4 in Two-Headed Giant); `mode`: its rules. */
  | { t: 'lobby'; room: string; code: string; players: LobbyPlayer[]; match?: MatchScore; size?: number; mode?: GameMode }
  /** Your main deck for the current game, and the other cards you brought (to sideboard between games). */
  | { t: 'deck'; main: Card[]; side: Card[] }
  /** A room opened by its address without holding a seat in it: who is there, and whether a seat is free. */
  | { t: 'roomInfo'; room: string; code: string; size: number; mode: GameMode; bestOf: 1 | 3; players: string[]; started: boolean }
  | { t: 'state'; state: GameState }
  | { t: 'left' }
  /**
   * Who is on the clock and how long they have left (ms): to make a decision ("turn"), or to come back
   * after disconnecting ("reconnect"). null when no clock runs.
   */
  | { t: 'clock'; clock: { player: PlayerId; ms: number; kind: 'turn' | 'reconnect' } | null }
  /** `lostRoom`: the room or seat is gone (e.g. after a server restart); forget it. */
  | { t: 'error'; code: ErrorCode; params?: ErrorParams; lostRoom?: boolean };

export const MIN_DECK_SIZE = 20;
export const MAX_DECK_SIZE = 250;

export const HIDDEN_CARD: Card = {
  id: 'hidden', name: 'Hidden card', manaCost: '', cmc: 0, typeLine: '', oracleText: '',
  colors: [], colorIdentity: [], setCode: '', setName: '', rarity: '',
};

/** What `viewer` is allowed to see: no libraries, no opponent hand, no random seed (it predicts shuffles). */
export function redact(state: GameState, viewer: PlayerId): GameState {
  const hide = (cards: CardInst[]): CardInst[] => cards.map((_, i) => ({ iid: `hidden-${i}`, card: HIDDEN_CARD }));
  // Your hand, and your teammate's in Two-Headed Giant (teammates may show each other their hands).
  const players = state.players.map((p, i): PlayerState => ({
    ...p,
    library: hide(p.library),
    hand: teamOf(state, i) === teamOf(state, viewer) ? p.hand : hide(p.hand),
  }));
  // A choice among hidden cards (your hand, your library) is only shown to the player making it.
  let pending = state.pending;
  if (pending && pending.choice.player !== viewer) {
    const c = pending.choice;
    if (c.kind === 'cards') pending = { ...pending, choice: { ...c, options: hide(c.options) } };
    if (c.kind === 'arrange') pending = { ...pending, choice: { ...c, cards: hide(c.cards) } };
  }
  return { ...state, players, pending, seed: 0 };
}
