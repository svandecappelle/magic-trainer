import type { MatchScore } from '../match';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppError } from '../../i18n/types';
import type { GameState, PlayerId } from '../engine/engine';
import type { ClientMessage, LobbyPlayer, ServerMessage } from './protocol';
import type { Card } from '../../types';

/**
 * The seats this browser holds, by room id: the secret that brings it back to its seat at /online/<id>, after a
 * reload, a closed tab or an update of the server. Kept a few days.
 */
const SEATS_KEY = 'mt.onlineSeats';
const SEAT_DAYS = 3;

export interface SavedSeat {
  room: string;
  code: string;
  token: string;
  savedAt: number;
}

export function savedSeats(): SavedSeat[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEATS_KEY) ?? '[]');
    const fresh = Date.now() - SEAT_DAYS * 86400_000;
    return Array.isArray(v)
      ? v.filter((s) => s && typeof s.room === 'string' && typeof s.token === 'string' && s.savedAt > fresh).sort((a, b) => b.savedAt - a.savedAt)
      : [];
  } catch {
    return [];
  }
}

function writeSeats(seats: SavedSeat[]) {
  try {
    localStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  } catch {
    // Storage unavailable (private mode): coming back after a reload won't work, playing still does.
  }
}

const saveSeat = (seat: SavedSeat) => writeSeats([seat, ...savedSeats().filter((s) => s.room !== seat.room)]);
export const forgetSeat = (room: string) => writeSeats(savedSeats().filter((s) => s.room !== room));

/** The room this tab watches as a spectator (kept through a reload of the tab). */
const WATCH_KEY = 'mt.watching';
function watchedRoom(): string | null {
  try {
    return sessionStorage.getItem(WATCH_KEY);
  } catch {
    return null;
  }
}
function setWatchedRoom(id: string | null) {
  try {
    if (id) sessionStorage.setItem(WATCH_KEY, id);
    else sessionStorage.removeItem(WATCH_KEY);
  } catch {
    // a reload then shows the room's page instead of the game
  }
}

/** Builds that can play together: the same one, or a development build on either side. */
export const sameBuild = (a: string, b: string) => a === b || a === 'dev' || b === 'dev';

/** Reloads after an update of the server, once a minute at most (a reload that didn't help must not loop). */
const RELOAD_KEY = 'mt.reloadedForUpdate';
function reloadForUpdate(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type RoomInfo = Extract<ServerMessage, { t: 'roomInfo' }>;

/**
 * Connection to the game server, with automatic reconnect. `roomId`: the room of the page (/online/<id>), opened as
 * soon as the connection is up (back to this browser's seat, or what is needed to join it).
 */
export function useGameSocket(roomId?: string) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<{ id: string; code: string; seat: PlayerId } | null>(null);
  /** The room watched as a spectator, and how many spectators the room has. */
  const [watching, setWatching] = useState<{ id: string; code: string } | null>(null);
  const [watchers, setWatchers] = useState(0);
  /** The room of the page when this browser has no seat in it; `gone`: it doesn't exist (anymore). */
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [gone, setGone] = useState(false);
  /** Logged in: the rooms where the account has a seat (from any device). */
  const [accountRooms, setAccountRooms] = useState<Extract<ServerMessage, { t: 'myRooms' }>['rooms']>([]);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  /** Your cards in this room: main deck for the current game, and the rest (sideboard). */
  const [deck, setDeck] = useState<{ main: Card[]; side: Card[]; name?: string } | null>(null);
  /** The replays of the match just finished, as the server sent them (see the 'replays' message). */
  const [replays, setReplays] = useState<{ match: string; packed: string } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [match, setMatch] = useState<MatchScore | null>(null);
  /** Seats in the room: 2, or 4 in Two-Headed Giant. */
  const [size, setSize] = useState(2);
  /** The running clock, with its deadline in this browser's time. */
  const [clock, setClock] = useState<{ player: PlayerId; deadline: number; kind: 'turn' | 'reconnect' } | null>(null);
  /** The server runs a newer (or older) build of the app: this page must be reloaded. */
  const [outdated, setOutdated] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  /** The page's room, read by the connection's handlers. */
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  /** The room this browser is seated in, as the server last said. */
  const seatedRef = useRef<string | null>(null);

  /**
   * Opens the page's room on the server (no-op without a room, or when already seated in it): back to this browser's
   * seat, or to watching it when this tab was watching it.
   */
  const openRoom = useCallback(() => {
    const ws = wsRef.current;
    const id = roomIdRef.current;
    if (!id || ws?.readyState !== WebSocket.OPEN || seatedRef.current === id) return;
    const token = savedSeats().find((s) => s.room === id)?.token;
    const msg: ClientMessage = !token && watchedRoom() === id ? { t: 'watch', room: id } : { t: 'open', room: id, ...(token ? { token } : {}) };
    ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      seatedRef.current = null;
      setRoom(null);
      setWatching(null);
      setPlayers([]);
      setGame(null);
      setDeck(null);
      setClock(null);
    };

    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        retries = 0;
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.t) {
          case 'hello': {
            // A different build of the app on the server: its game states may not fit this page. Reload to get
            // the same build; the seat is kept, so the game goes on after the reload.
            if (!sameBuild(msg.build, __BUILD__)) {
              disposed = true;
              ws.close();
              if (!(roomIdRef.current && reloadForUpdate())) setOutdated(true);
              return;
            }
            seatedRef.current = null;
            setStatus('open');
            openRoom();
            break;
          }
          case 'watching':
            seatedRef.current = msg.room;
            setWatchedRoom(msg.room);
            setWatching({ id: msg.room, code: msg.code });
            setInfo(null);
            setGone(false);
            setError(null);
            break;
          case 'joined':
            setWatching(null);
            seatedRef.current = msg.room;
            setRoom({ id: msg.room, code: msg.code, seat: msg.seat });
            setInfo(null);
            setGone(false);
            saveSeat({ room: msg.room, code: msg.code, token: msg.token, savedAt: Date.now() });
            setError(null);
            break;
          case 'roomInfo':
            if (msg.room !== roomIdRef.current) break;
            setInfo(msg);
            setGone(false);
            break;
          case 'lobby':
            setPlayers(msg.players);
            setWatchers(msg.watchers ?? 0);
            setMatch(msg.match ?? null);
            setSize(msg.size ?? 2);
            break;
          case 'myRooms':
            setAccountRooms(msg.rooms);
            break;
          case 'deck':
            setDeck({ main: msg.main, side: msg.side, name: msg.name });
            break;
          case 'state':
            setGame(msg.state);
            setError(null);
            break;
          case 'replays':
            setReplays({ match: msg.match, packed: msg.packed });
            break;
          case 'clock':
            setClock(msg.clock ? { player: msg.clock.player, kind: msg.clock.kind, deadline: Date.now() + msg.clock.ms } : null);
            break;
          case 'left':
            if (seatedRef.current) forgetSeat(seatedRef.current);
            setWatchedRoom(null);
            reset();
            break;
          case 'error':
            if (msg.lostRoom) {
              // The page's room is gone (finished long ago, or never existed): forget its seat.
              const id = roomIdRef.current;
              if (id) forgetSeat(id);
              setWatchedRoom(null);
              reset();
              setInfo(null);
              setGone(true);
              break;
            }
            setError({ code: msg.code, params: msg.params });
            break;
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('closed');
        timer = setTimeout(connect, Math.min(5000, 500 * 2 ** retries++));
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [openRoom]);

  // Another room's page (a link followed, back to /online): open it, or forget the shown one.
  useEffect(() => {
    setGone(false);
    setInfo(null);
    if (roomId) openRoom();
  }, [roomId, openRoom]);

  /** Watch the page's room as a spectator. */
  const watch = useCallback(() => {
    const id = roomIdRef.current;
    if (!id) return;
    setWatchedRoom(id);
    openRoom();
  }, [openRoom]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError({ code: 'notConnected' });
  }, []);

  return { replays, status, room, watching, watchers, watch, info, gone, accountRooms, players, game, deck, error, setError, clock, match, size, send, outdated };
}
