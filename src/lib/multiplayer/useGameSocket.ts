import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppError } from '../../i18n/types';
import type { GameState, PlayerId } from '../engine/engine';
import type { ClientMessage, LobbyPlayer, ServerMessage } from './protocol';

// sessionStorage is per tab: a reload rejoins the same seat, and two tabs can be two players.
const SESSION_KEY = 'magic-trainer-online';

function readSession(): { code: string; token: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function writeSession(value: { code: string; token: string } | null) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable (private mode): reconnecting after a reload won't work, playing still does.
  }
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** Connection to the game server, with automatic reconnect and seat recovery. */
export function useGameSocket() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<{ code: string; seat: PlayerId } | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      writeSession(null);
      setRoom(null);
      setPlayers([]);
      setGame(null);
    };

    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        retries = 0;
        setStatus('open');
        const saved = readSession();
        if (saved) ws.send(JSON.stringify({ t: 'rejoin', ...saved } satisfies ClientMessage));
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.t) {
          case 'joined':
            setRoom({ code: msg.code, seat: msg.seat });
            writeSession({ code: msg.code, token: msg.token });
            setError(null);
            break;
          case 'lobby':
            setPlayers(msg.players);
            break;
          case 'state':
            setGame(msg.state);
            setError(null);
            break;
          case 'left':
            reset();
            break;
          case 'error':
            setError({ code: msg.code, params: msg.params });
            if (msg.lostRoom) reset();
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
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError({ code: 'notConnected' });
  }, []);

  return { status, room, players, game, error, setError, send };
}
