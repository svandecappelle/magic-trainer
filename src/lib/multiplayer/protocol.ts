import type { Card } from '../../types';
import type { Action, CardInst, ErrorParams, GameErrorCode, GameState, PlayerId, PlayerState } from '../engine/engine';

/** Messages the browser sends to the server. */
export type ClientMessage =
  | { t: 'create'; name: string; deck: Card[] }
  | { t: 'join'; code: string; name: string; deck: Card[] }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'action'; action: Action }
  | { t: 'rematch' }
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
  | { t: 'joined'; code: string; seat: PlayerId; token: string }
  | { t: 'lobby'; code: string; players: LobbyPlayer[] }
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
  const players = state.players.map((p, i): PlayerState => ({
    ...p,
    library: hide(p.library),
    hand: i === viewer ? p.hand : hide(p.hand),
  })) as [PlayerState, PlayerState];
  // A choice among hidden cards (your hand, your library) is only shown to the player making it.
  let pending = state.pending;
  if (pending && pending.choice.player !== viewer) {
    const c = pending.choice;
    if (c.kind === 'cards') pending = { ...pending, choice: { ...c, options: hide(c.options) } };
    if (c.kind === 'arrange') pending = { ...pending, choice: { ...c, cards: hide(c.cards) } };
  }
  return { ...state, players, pending, seed: 0 };
}
