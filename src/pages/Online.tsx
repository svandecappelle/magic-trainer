import { useState } from 'react';
import { DeckOptions } from '../components/DeckOptions';
import { GameBoard } from '../components/GameBoard';
import { opponent } from '../lib/engine/engine';
import { loadDeckCards } from '../lib/loadDeck';
import { MIN_DECK_SIZE } from '../lib/multiplayer/protocol';
import { useGameSocket } from '../lib/multiplayer/useGameSocket';
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
  const decks = useApp((s) => s.decks);
  const { status, room, players, game, error, setError, send } = useGameSocket();
  const [name, setName] = useState(savedName);
  const [deckId, setDeckId] = useState(decks[0]?.id ?? 'preset-red');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function enter(kind: 'create' | 'join') {
    if (!name.trim()) return setError('Please enter your name');
    if (kind === 'join' && !code.trim()) return setError('Enter the room code your friend gave you');
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      // not essential
    }
    setBusy(true);
    try {
      const deck = await loadDeckCards(deckId, decks);
      if (deck.length < MIN_DECK_SIZE) throw new Error(`Your deck needs at least ${MIN_DECK_SIZE} main-deck cards.`);
      send(kind === 'create' ? { t: 'create', name, deck } : { t: 'join', code: code.trim().toUpperCase(), name, deck });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const connection =
    status === 'open' ? null : (
      <div className="banner">
        {status === 'connecting' ? 'Connecting to the game server…' : 'Disconnected from the game server, retrying…'}
        <span className="small muted">
          In development, start it with <code>npm run server</code>.
        </span>
      </div>
    );

  // 1. Not in a room: pick a name and deck, create or join.
  if (!room) {
    return (
      <div className="page">
        <h1>Play Online</h1>
        {connection}
        <div className="panel online-setup">
          <label>
            Your name <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </label>
          <label>
            Deck <select value={deckId} onChange={(e) => setDeckId(e.target.value)}><DeckOptions decks={decks} /></select>
          </label>
          <div className="online-choices">
            <div>
              <h3>Host a game</h3>
              <p className="small muted">Get a room code to send to a friend.</p>
              <button disabled={busy || status !== 'open'} onClick={() => enter('create')}>Create room</button>
            </div>
            <div>
              <h3>Join a game</h3>
              <p className="small muted">Enter the code your friend sent you.</p>
              <div className="row">
                <input
                  className="room-code-input"
                  value={code}
                  maxLength={5}
                  placeholder="ABCDE"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && enter('join')}
                />
                <button disabled={busy || status !== 'open'} onClick={() => enter('join')}>Join</button>
              </div>
            </div>
          </div>
          {busy && <div className="small muted">Loading cards…</div>}
          {error && <div className="error small">{error}</div>}
        </div>
        <RulesNote />
      </div>
    );
  }

  // 2. In a room, waiting for the second player.
  if (!game) {
    return (
      <div className="page">
        <h1>Play Online</h1>
        {connection}
        <div className="panel lobby">
          <p>Send this room code to your opponent:</p>
          <div className="row">
            <span className="room-code">{room.code}</span>
            <button
              className="secondary"
              onClick={() => {
                navigator.clipboard.writeText(room.code);
                setCopied(true);
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="muted">Waiting for an opponent to join…</p>
          {error && <div className="error small">{error}</div>}
          <button className="danger" onClick={() => send({ t: 'leave' })}>Leave room</button>
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
      {status !== 'open' && <div className="error">Reconnecting to the server…</div>}
      {opp && !opp.connected && <div className="error">{opp.name} disconnected. They can reload the page to come back.</div>}
      {opp?.wantsRematch && !iWantRematch && <div>{opp.name} wants a rematch.</div>}
      {error && <div className="error">{error}</div>}
      <div className="muted">Room {room.code}</div>
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
              {iWantRematch ? `Waiting for ${opp?.name ?? 'opponent'}…` : 'Rematch'}
            </button>
            <button className="secondary" onClick={() => send({ t: 'leave' })}>Leave</button>
          </>
        }
      />
    </div>
  );
}
