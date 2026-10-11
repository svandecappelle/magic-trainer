import { useEffect, useState } from 'react';
import { BetweenGames } from '../components/BetweenGames';
import { DeckOptions } from '../components/DeckOptions';
import { GameBoard } from '../components/GameBoard';
import { loadDeck75 } from '../lib/loadDeck';
import { matchWinner } from '../lib/match';
import type { Card } from '../types';
import { MIN_DECK_SIZE } from '../lib/multiplayer/protocol';
import { useGameSocket } from '../lib/multiplayer/useGameSocket';
import { errorText, useT } from '../i18n';
import { useApp } from '../store/useApp';
import { RulesNote } from './Play';

const NAME_KEY = 'magic-trainer-name';

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

const MATCH_DECK_KEY = 'magic-trainer-match-deck';

export function Online() {
  const t = useT();
  const decks = useApp((s) => s.decks);
  const { status, room, players, game, error, setError, send, clock, match } = useGameSocket();
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  // Your deck and sideboard for this match (changed by sideboarding), kept across reloads of the page.
  const [cards, setCardsState] = useState<{ main: Card[]; side: Card[] } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(MATCH_DECK_KEY) ?? 'null');
    } catch {
      return null;
    }
  });
  const setCards = (c: { main: Card[]; side: Card[] }) => {
    setCardsState(c);
    try {
      sessionStorage.setItem(MATCH_DECK_KEY, JSON.stringify(c));
    } catch {
      // not essential
    }
  };
  const [between, setBetween] = useState(false);
  // A new game started: back to the board.
  useEffect(() => {
    if (game && game.winner === null) setBetween(false);
  }, [game]);
  // Ticks while a clock runs, to show the countdown.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!clock) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [clock]);
  const [name, setName] = useState(savedName);
  const [deckId, setDeckId] = useState(decks[0]?.id ?? 'preset-red');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function enter(kind: 'create' | 'join') {
    if (!name.trim()) return setError({ code: 'enterYourName' });
    if (kind === 'join' && !code.trim()) return setError({ code: 'enterRoomCode' });
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      // not essential
    }
    setBusy(true);
    try {
      const { main: deck, side } = await loadDeck75(deckId, decks);
      if (deck.length < MIN_DECK_SIZE) return setError({ code: 'deckTooSmall', params: { n: MIN_DECK_SIZE } });
      const sideboard = side.slice(0, 30);
      setCards({ main: deck, side: sideboard });
      send(kind === 'create' ? { t: 'create', name, deck, sideboard, bestOf } : { t: 'join', code: code.trim().toUpperCase(), name, deck, sideboard });
    } catch (e) {
      setError({ code: 'loadFailed', params: { message: e instanceof Error ? e.message : String(e) } });
    } finally {
      setBusy(false);
    }
  }

  const connection =
    status === 'open' ? null : (
      <div className="banner">
        {status === 'connecting' ? t.online.connecting : t.online.disconnected}
        <span className="small muted">
          {t.online.devHint} <code>npm run server</code>.
        </span>
      </div>
    );

  // 1. Not in a room: pick a name and deck, create or join.
  if (!room) {
    return (
      <div className="page">
        <h1>{t.online.title}</h1>
        {connection}
        <div className="panel online-setup">
          <label>
            {t.online.yourName} <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={t.online.namePlaceholder} />
          </label>
          <label>
            {t.online.deck} <select value={deckId} onChange={(e) => setDeckId(e.target.value)}><DeckOptions decks={decks} /></select>
          </label>
          <div className="online-choices">
            <div>
              <h3>{t.online.host}</h3>
              <p className="small muted">{t.online.hostHint}</p>
              <label className="small">
                {t.match.format}{' '}
                <select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value) as 1 | 3)}>
                  <option value={1}>{t.match.single}</option>
                  <option value={3}>{t.match.bo3}</option>
                </select>
              </label>
              <button disabled={busy || status !== 'open'} onClick={() => enter('create')}>{t.online.createRoom}</button>
            </div>
            <div>
              <h3>{t.online.join}</h3>
              <p className="small muted">{t.online.joinHint}</p>
              <div className="row">
                <input
                  className="room-code-input"
                  value={code}
                  maxLength={5}
                  placeholder="ABCDE"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && enter('join')}
                />
                <button disabled={busy || status !== 'open'} onClick={() => enter('join')}>{t.online.joinButton}</button>
              </div>
            </div>
          </div>
          {busy && <div className="small muted">{t.common.loadingCards}</div>}
          {error && <div className="error small">{errorText(t, error)}</div>}
        </div>
        <RulesNote />
      </div>
    );
  }

  // 2. In a room, waiting for the second player.
  if (!game) {
    return (
      <div className="page">
        <h1>{t.online.title}</h1>
        {connection}
        <div className="panel lobby">
          <p>{t.online.sendCode}</p>
          <div className="row">
            <span className="room-code">{room.code}</span>
            <button
              className="secondary"
              onClick={() => {
                navigator.clipboard.writeText(room.code);
                setCopied(true);
              }}
            >
              {copied ? t.online.copied : t.online.copy}
            </button>
          </div>
          <p className="muted">{t.online.waiting}</p>
          {error && <div className="error small">{errorText(t, error)}</div>}
          <button className="danger" onClick={() => send({ t: 'leave' })}>{t.online.leaveRoom}</button>
        </div>
      </div>
    );
  }

  // 3. Playing.
  const me = room.seat;
  const opp = players[(me === 0 ? 1 : 0)];
  const iWantRematch = players[me]?.wantsRematch;
  const bo3 = match?.bestOf === 3;
  const going = !!match && matchWinner(match) === null;
  const names: [string, string] = [players[0]?.name ?? '', players[1]?.name ?? ''];
  const score = match ? t.match.score(names[me], match.wins[me], match.wins[(me === 0 ? 1 : 0)], names[(me === 0 ? 1 : 0)]) : '';
  const notice = (
    <>
      {status !== 'open' && <div className="error">{t.online.reconnecting}</div>}
      {opp && !opp.connected && <div className="error">{t.online.oppDisconnected(opp.name)}</div>}
      {clock && (() => {
        const left = Math.max(0, Math.ceil((clock.deadline - now) / 1000));
        const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        const mine = clock.player === me;
        const text = clock.kind === 'reconnect' ? t.online.reconnectClock(players[clock.player]?.name ?? '', time)
          : mine ? t.online.yourClock(time) : t.online.theirClock(players[clock.player]?.name ?? '', time);
        return <div className={`clock ${mine && left <= 20 ? 'error' : ''}`}>⏱ {text}</div>;
      })()}
      {opp?.wantsRematch && !iWantRematch && <div>{t.online.wantsRematch(opp.name)}</div>}
      {error && <div className="error">{errorText(t, error)}</div>}
      {bo3 && match && <div className="muted">{t.match.inGame(match.games + (game.winner === null ? 1 : 0), score)}</div>}
      <div className="muted">{t.online.room(room.code)}</div>
    </>
  );

  // Between two games of a best of 3: sideboard, then tell the server you're ready with that deck.
  if (between && bo3 && match && cards && going) {
    return (
      <div className="page">
        <BetweenGames
          score={match}
          names={names}
          me={me}
          main={cards.main}
          side={cards.side}
          onChange={(main, side) => setCards({ main, side })}
          onReady={() => send({ t: 'rematch', deck: cards.main })}
          waiting={iWantRematch}
        >
          <button className="secondary" onClick={() => send({ t: 'leave' })}>{t.online.leave}</button>
        </BetweenGames>
      </div>
    );
  }

  return (
    <div className="page play">
      <GameBoard
        game={game}
        me={me}
        onAction={(action) => send({ t: 'action', action })}
        notice={notice}
        endControls={
          <>
            {bo3 && going ? (
              <button disabled={!opp?.connected} onClick={() => setBetween(true)}>{t.match.nextGame}</button>
            ) : (
              <button disabled={iWantRematch || !opp?.connected} onClick={() => send({ t: 'rematch' })}>
                {iWantRematch ? t.online.waitingFor(opp?.name ?? t.online.opponent) : bo3 ? t.match.newMatch : t.play.rematch}
              </button>
            )}
            <button className="secondary" onClick={() => send({ t: 'leave' })}>{t.online.leave}</button>
          </>
        }
      />
    </div>
  );
}
