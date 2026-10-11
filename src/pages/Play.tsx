import { useEffect, useRef, useState } from 'react';
import { BetweenGames } from '../components/BetweenGames';
import { Link } from 'react-router-dom';
import { DeckOptions } from '../components/DeckOptions';
import { GameBoard } from '../components/GameBoard';
import { botAction, fallbackAction } from '../lib/engine/bot';
import { actor, apply, IllegalAction, newGame, type GameState, type PlayerId } from '../lib/engine/engine';
import { loadDeck75, loadDeckCards } from '../lib/loadDeck';
import { matchWinner, newMatch, nextFirst, recordGame, type MatchScore } from '../lib/match';
import type { Card } from '../types';
import { errorText, useT, type AppError } from '../i18n';
import { useApp } from '../store/useApp';

const ME: PlayerId = 0;
const BOT: PlayerId = 1;
const BOT_DELAY_MS = 650;

export function Play() {
  const t = useT();
  const decks = useApp((s) => s.decks);
  const [game, setGame] = useState<GameState | null>(null);
  const [myDeck, setMyDeck] = useState(decks[0]?.id ?? 'preset-red');
  const [botDeck, setBotDeck] = useState('preset-green');
  const [first, setFirst] = useState<'random' | 'me' | 'bot'>('random');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  // The match being played: its score, your main deck and sideboard (changed by sideboarding), the bot's deck.
  const [match, setMatch] = useState<MatchScore | null>(null);
  const [myCards, setMyCards] = useState<{ main: Card[]; side: Card[] } | null>(null);
  const [botCards, setBotCards] = useState<Card[]>([]);
  const [between, setBetween] = useState(false);
  /** Who played first in the current game, and whether its result is already in the score. */
  const current = useRef<{ first: PlayerId; scored: boolean }>({ first: ME, scored: true });

  // Count each finished game once in the match score.
  useEffect(() => {
    if (!game || game.winner === null || current.current.scored) return;
    current.current.scored = true;
    setMatch((m) => (m ? recordGame(m, game.winner!, current.current.first) : m));
  }, [game]);

  // The bot acts on a timer so the human can follow what it does.
  useEffect(() => {
    if (!game || actor(game) !== BOT) return;
    const timer = setTimeout(() => {
      setGame((g) => {
        if (!g || actor(g) !== BOT) return g;
        try {
          return apply(g, botAction(g));
        } catch (e) {
          if (!(e instanceof IllegalAction)) throw e;
          return apply(g, fallbackAction(g));
        }
      });
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game]);

  function startGame(firstPlayer: PlayerId, mine: Card[], theirs: Card[]) {
    current.current = { first: firstPlayer, scored: false };
    setBetween(false);
    // An empty name is displayed as "You" in the current language.
    // A rematch keeps the full control setting.
    setGame(newGame({ decks: [mine, theirs], names: ['', t.play.botName], first: firstPlayer, fullControl: game?.fullControl }));
  }

  /** A new match (one game, or the first game of a best of 3) with the chosen decks. */
  async function start() {
    setLoading(true);
    setError(null);
    try {
      const [mine, theirs] = await Promise.all([loadDeck75(myDeck, decks), loadDeckCards(botDeck, decks)]);
      if (mine.main.length < 20 || theirs.length < 20) return setError({ code: 'decksTooSmall', params: { n: 20 } });
      const firstPlayer: PlayerId = first === 'me' ? ME : first === 'bot' ? BOT : Math.random() < 0.5 ? ME : BOT;
      setMatch(newMatch(bestOf));
      setMyCards(mine);
      setBotCards(theirs);
      startGame(firstPlayer, mine.main, theirs);
    } catch (e) {
      setError({ code: 'loadFailed', params: { message: e instanceof Error ? e.message : String(e) } });
    } finally {
      setLoading(false);
    }
  }

  if (!game) {
    return (
      <div className="page">
        <h1>{t.play.title}</h1>
        <div className="panel setup-panel">
          <label>{t.play.yourDeck} <select value={myDeck} onChange={(e) => setMyDeck(e.target.value)}><DeckOptions decks={decks} /></select></label>
          <label>{t.play.botDeck} <select value={botDeck} onChange={(e) => setBotDeck(e.target.value)}><DeckOptions decks={decks} /></select></label>
          <label>
            {t.match.format}{' '}
            <select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value) as 1 | 3)}>
              <option value={1}>{t.match.single}</option>
              <option value={3}>{t.match.bo3}</option>
            </select>
          </label>
          <label>
            {t.play.first}{' '}
            <select value={first} onChange={(e) => setFirst(e.target.value as typeof first)}>
              <option value="random">{t.play.firstOptions.random}</option>
              <option value="me">{t.play.firstOptions.me}</option>
              <option value="bot">{t.play.firstOptions.bot}</option>
            </select>
          </label>
          <button onClick={start} disabled={loading}>{loading ? t.common.loadingCards : t.play.start}</button>
          {error && <div className="error small">{errorText(t, error)}</div>}
        </div>
        <RulesNote />
      </div>
    );
  }

  const names: [string, string] = [t.game.you, t.play.botName];
  const changeDecks = () => {
    setGame(null);
    setMatch(null);
    setBetween(false);
  };

  // Between two games of a best of 3: sideboarding, then the loser plays first.
  if (between && match && myCards) {
    return (
      <div className="page">
        <BetweenGames
          score={match}
          names={names}
          me={ME}
          main={myCards.main}
          side={myCards.side}
          onChange={(main, side) => setMyCards({ main, side })}
          onReady={() => startGame(nextFirst(game.winner ?? 'draw', match.lastFirst ?? ME), myCards.main, botCards)}
        >
          {matchWinner(match) !== null && <button onClick={start}>{t.match.newMatch}</button>}
          <button className="secondary" onClick={changeDecks}>{t.play.changeDecks}</button>
        </BetweenGames>
      </div>
    );
  }

  const bo3 = match?.bestOf === 3;
  const over = match ? matchWinner(match) !== null : true;
  return (
    <div className="page play">
      <GameBoard
        game={game}
        me={ME}
        onAction={(action) => setGame(apply(game, action))}
        notice={bo3 && match ? <div className="muted">{t.match.inGame(match.games + (game.winner === null ? 1 : 0), t.match.score(names[ME], match.wins[ME], match.wins[BOT], names[BOT]))}</div> : undefined}
        endControls={
          <>
            {bo3 && !over && <button onClick={() => setBetween(true)}>{t.match.nextGame}</button>}
            {bo3 && over && <button onClick={() => setBetween(true)}>{t.match.score(names[ME], match!.wins[ME], match!.wins[BOT], names[BOT])}</button>}
            <button className={bo3 && !over ? 'secondary' : ''} onClick={start}>{bo3 ? t.match.newMatch : t.play.rematch}</button>
            <button className="secondary" onClick={changeDecks}>{t.play.changeDecks}</button>
          </>
        }
      />
    </div>
  );
}

export function RulesNote() {
  const t = useT();
  return (
    <div className="panel small muted">
      {t.play.rules} <Link to="/decks">{t.play.buildDeck}</Link> {t.play.bringYourOwn}
    </div>
  );
}
