import { useEffect, useState } from 'react';
import { BetweenGames } from '../components/BetweenGames';
import { GameBoard } from '../components/GameBoard';
import { DeckPicker, EngineSummary, LifeChoice, ModeTile, Segmented } from '../components/Setup';
import { loadDeck75 } from '../lib/loadDeck';
import { matchWinner } from '../lib/match';
import { teamOf, teamsOf } from '../lib/engine/engine';
import type { Card } from '../types';
import { MIN_DECK_SIZE } from '../lib/multiplayer/protocol';
import { useGameSocket } from '../lib/multiplayer/useGameSocket';
import { errorText, useT } from '../i18n';
import { useApp } from '../store/useApp';

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
  const { status, room, players, game, error, setError, send, clock, match, size, outdated } = useGameSocket();
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  const [twoHeaded, setTwoHeaded] = useState(false);
  const [commander, setCommander] = useState(false);
  const [duelLife, setDuelLife] = useState<40 | 20>(40);
  const [deckId, setDeckId] = useState(decks[0]?.id ?? 'preset-red');
  const chosen = decks.find((d) => d.id === deckId);
  useEffect(() => {
    if (chosen?.format === 'commander') setCommander(true);
  }, [chosen?.format]);
  const missingCommander = !!chosen && !chosen.entries.some((e) => e.board === 'commander') && (commander || chosen.format === 'commander');
  // Your deck and sideboard for this match (changed by sideboarding), kept across reloads of the page.
  // Saved by this build of the app only: an older one may have stored cards in another shape.
  const [cards, setCardsState] = useState<{ main: Card[]; side: Card[] } | null>(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(MATCH_DECK_KEY) ?? 'null');
      if (v && v.build === __BUILD__ && Array.isArray(v.main) && Array.isArray(v.side)) return { main: v.main, side: v.side };
      sessionStorage.removeItem(MATCH_DECK_KEY);
    } catch {
      // unreadable or unavailable: start without it
    }
    return null;
  });
  const setCards = (c: { main: Card[]; side: Card[] }) => {
    setCardsState(c);
    try {
      sessionStorage.setItem(MATCH_DECK_KEY, JSON.stringify({ ...c, build: __BUILD__ }));
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
      const { main: deck, side, commander: commanders } = await loadDeck75(deckId, decks);
      if (deck.length < MIN_DECK_SIZE) return setError({ code: 'deckTooSmall', params: { n: MIN_DECK_SIZE } });
      const sideboard = side.slice(0, 30);
      setCards({ main: deck, side: sideboard });
      send(kind === 'create'
        ? { t: 'create', name, deck, sideboard, commanders, bestOf, size: twoHeaded ? 4 : 2, commander, duelCommander: commander && !twoHeaded && duelLife === 20 }
        : { t: 'join', code: code.trim().toUpperCase(), name, deck, sideboard, commanders });
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

  // The server was updated since this page was loaded: reload to get the same version.
  if (outdated) {
    return (
      <div className="page">
        <h1>{t.online.title}</h1>
        <div className="banner">
          {t.online.outdated}
          <button onClick={() => location.reload()}>{t.online.reload}</button>
        </div>
      </div>
    );
  }

  // 1. Not in a room: pick a name and deck, then host a game or join one.
  if (!room) {
    const offline = busy || status !== 'open';
    return (
      <div className="page setup">
        <h1>{t.online.title}</h1>
        {connection}

        <section className="deck-pickers">
          <label className="name-field">
            <h4>{t.online.yourName}</h4>
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={t.online.namePlaceholder} />
          </label>
          <DeckPicker label={t.play.yourDeck} value={deckId} onChange={setDeckId} />
        </section>
        {missingCommander && <div className="error small">{t.game.noCommanderInDeck(chosen!.name)}</div>}

        <section className="setup-section">
          <h4>{t.online.host}</h4>
          <div className="mode-tiles">
            {(['duel', 'twoHeaded'] as const).map((m) => (
              <ModeTile key={m} mode={m} text={t.online.modes[m]} on={(twoHeaded ? 'twoHeaded' : 'duel') === m} onClick={() => setTwoHeaded(m === 'twoHeaded')} />
            ))}
            <ModeTile mode="commander" text={t.play.modes.commander} on={commander} onClick={() => setCommander(!commander)} />
          </div>
        </section>
        <section className="setup-options">
          <Segmented label={t.match.format} value={bestOf} options={[[1, t.match.single], [3, t.match.bo3]]} onChange={setBestOf} />
          {commander && !twoHeaded && <LifeChoice value={duelLife} onChange={setDuelLife} />}
          <p className="small muted host-hint">{t.online.hostHint}</p>
          <button className="start-button" disabled={offline} onClick={() => enter('create')}>{t.online.createRoom}</button>
        </section>

        <section className="panel join-panel">
          <div>
            <h4>{t.online.join}</h4>
            <p className="small muted">{t.online.joinHint}</p>
          </div>
          <div className="join-row">
            <input
              className="room-code-input"
              value={code}
              maxLength={5}
              placeholder="ABCDE"
              aria-label={t.online.join}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && enter('join')}
            />
            <button className="start-button" disabled={offline} onClick={() => enter('join')}>{t.online.joinButton}</button>
          </div>
        </section>
        {busy && <div className="small muted">{t.common.loadingCards}</div>}
        {error && <div className="error small">{errorText(t, error)}</div>}

        <EngineSummary deck={chosen} />
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
          {size === 4 ? (
            <div className="teams-lobby">
              {[0, 1].map((team) => (
                <div key={team}>
                  <strong>{t.online.team(team + 1)}</strong>
                  <ul className="plain-list">
                    {[team * 2, team * 2 + 1].map((seat) => <li key={seat}>{players[seat]?.name ?? <span className="muted">{t.online.openSeat}</span>}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          <p className="muted">{size === 4 ? t.online.waitingPlayers(players.length, size) : t.online.waiting}</p>
          {error && <div className="error small">{errorText(t, error)}</div>}
          <button className="danger" onClick={() => send({ t: 'leave' })}>{t.online.leaveRoom}</button>
        </div>
      </div>
    );
  }

  // 3. Playing.
  const me = room.seat;
  const others = players.filter((_, i) => i !== me);
  const away = others.find((p) => !p.connected);
  const allHere = others.every((p) => p.connected);
  const waitingOn = others.find((p) => !p.wantsRematch);
  const iWantRematch = players[me]?.wantsRematch;
  const bo3 = match?.bestOf === 3;
  const going = !!match && matchWinner(match) === null;
  // Scores are per team: in Two-Headed Giant, teams are seats 0+1 and 2+3.
  const myTeam = teamOf(game, me);
  const teamNames = teamsOf(game).map((team) => team.map((q) => players[q]?.name ?? '').join(' & '));
  const names: [string, string] = [teamNames[0] ?? '', teamNames[1] ?? ''];
  const score = match ? t.match.score(names[myTeam], match.wins[myTeam], match.wins[1 - myTeam], names[1 - myTeam]) : '';
  const notice = (
    <>
      {status !== 'open' && <div className="error">{t.online.reconnecting}</div>}
      {away && <div className="error">{t.online.oppDisconnected(away.name)}</div>}
      {clock && (() => {
        const left = Math.max(0, Math.ceil((clock.deadline - now) / 1000));
        const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        const mine = clock.player === me;
        const text = clock.kind === 'reconnect' ? t.online.reconnectClock(players[clock.player]?.name ?? '', time)
          : mine ? t.online.yourClock(time) : t.online.theirClock(players[clock.player]?.name ?? '', time);
        return <div className={`clock ${mine && left <= 20 ? 'error' : ''}`}>⏱ {text}</div>;
      })()}
      {others.some((p) => p.wantsRematch) && !iWantRematch && <div>{t.online.wantsRematch(others.find((p) => p.wantsRematch)!.name)}</div>}
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
          me={myTeam}
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
              <button disabled={!allHere} onClick={() => setBetween(true)}>{t.match.nextGame}</button>
            ) : (
              <button disabled={iWantRematch || !allHere} onClick={() => send({ t: 'rematch' })}>
                {iWantRematch ? t.online.waitingFor(waitingOn?.name ?? t.online.opponent) : bo3 ? t.match.newMatch : t.play.rematch}
              </button>
            )}
            <button className="secondary" onClick={() => send({ t: 'leave' })}>{t.online.leave}</button>
          </>
        }
      />
    </div>
  );
}
