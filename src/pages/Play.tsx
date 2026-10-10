import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DeckOptions } from '../components/DeckOptions';
import { GameBoard } from '../components/GameBoard';
import { botAction, fallbackAction } from '../lib/engine/bot';
import { actor, apply, IllegalAction, newGame, type GameState, type PlayerId } from '../lib/engine/engine';
import { loadDeckCards } from '../lib/loadDeck';
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

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const [mine, theirs] = await Promise.all([loadDeckCards(myDeck, decks), loadDeckCards(botDeck, decks)]);
      if (mine.length < 20 || theirs.length < 20) return setError({ code: 'decksTooSmall', params: { n: 20 } });
      const firstPlayer: PlayerId = first === 'me' ? ME : first === 'bot' ? BOT : Math.random() < 0.5 ? ME : BOT;
      // An empty name is displayed as "You" in the current language.
      setGame(newGame({ decks: [mine, theirs], names: ['', t.play.botName], first: firstPlayer }));
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

  return (
    <div className="page play">
      <GameBoard
        game={game}
        me={ME}
        onAction={(action) => setGame(apply(game, action))}
        endControls={
          <>
            <button onClick={start}>{t.play.rematch}</button>
            <button className="secondary" onClick={() => setGame(null)}>{t.play.changeDecks}</button>
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
