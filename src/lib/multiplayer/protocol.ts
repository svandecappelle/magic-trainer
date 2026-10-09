import type { Card } from '../../types';
import type { Action, CardInst, GameState, PlayerId, PlayerState } from '../engine/engine';

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

/** Messages the server sends to the browser. */
export type ServerMessage =
  | { t: 'joined'; code: string; seat: PlayerId; token: string }
  | { t: 'lobby'; code: string; players: LobbyPlayer[] }
  | { t: 'state'; state: GameState }
  | { t: 'left' }
  /** `lostRoom`: the room or seat is gone (e.g. after a server restart); forget it. */
  | { t: 'error'; message: string; lostRoom?: boolean };

export const MIN_DECK_SIZE = 20;
export const MAX_DECK_SIZE = 250;

export const HIDDEN_CARD: Card = {
  id: 'hidden', name: 'Hidden card', manaCost: '', cmc: 0, typeLine: '', oracleText: '',
  colors: [], colorIdentity: [], setCode: '', setName: '', rarity: '',
};

/** What `viewer` is allowed to see: no libraries, no opponent hand. */
export function redact(state: GameState, viewer: PlayerId): GameState {
  const hide = (cards: CardInst[]): CardInst[] => cards.map((_, i) => ({ iid: `hidden-${i}`, card: HIDDEN_CARD }));
  const players = state.players.map((p, i): PlayerState => ({
    ...p,
    library: hide(p.library),
    hand: i === viewer ? p.hand : hide(p.hand),
  })) as [PlayerState, PlayerState];
  return { ...state, players };
}
