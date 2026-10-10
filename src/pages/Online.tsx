import { useEffect, useState } from 'react';
import { DeckOptions } from '../components/DeckOptions';
import { GameBoard } from '../components/GameBoard';
import { opponent } from '../lib/engine/engine';
import { loadDeckCards } from '../lib/loadDeck';
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

export function Online() {
  const t = useT();
  const decks = useApp((s) => s.decks);
  const { status, room, players, game, error, setError, send, clock } = useGameSocket();
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
      const deck = await loadDeckCards(deckId, decks);
      if (deck.length < MIN_DECK_SIZE) return setError({ code: 'deckTooSmall', params: { n: MIN_DECK_SIZE } });
      send(kind === 'create' ? { t: 'create', name, deck } : { t: 'join', code: code.trim().toUpperCase(), name, deck });
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
  const opp = players[opponent(me)];
  const iWantRematch = players[me]?.wantsRematch;
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
      <div className="muted">{t.online.room(room.code)}</div>
    </>
  );

  return (
    <div className="page play">
      <GameBoard
        game={game}
        me={me}
        onAction={(action) => send({ t: 'action', action })}
        notice={notice}
        endControls={
          <>
            <button disabled={iWantRematch || !opp?.connected} onClick={() => send({ t: 'rematch' })}>
              {iWantRematch ? t.online.waitingFor(opp?.name ?? t.online.opponent) : t.play.rematch}
            </button>
            <button className="secondary" onClick={() => send({ t: 'leave' })}>{t.online.leave}</button>
          </>
        }
      />
    </div>
  );
}
