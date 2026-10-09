import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DeckOptions } from '../components/DeckOptions';
import { GameBoard } from '../components/GameBoard';
import { botAction, fallbackAction } from '../lib/engine/bot';
import { actor, apply, IllegalAction, newGame, type GameState, type PlayerId } from '../lib/engine/engine';
import { loadDeckCards } from '../lib/loadDeck';
import { useApp } from '../store/useApp';

const ME: PlayerId = 0;
const BOT: PlayerId = 1;
const BOT_DELAY_MS = 650;

export function Play() {
  const decks = useApp((s) => s.decks);
  const [game, setGame] = useState<GameState | null>(null);
  const [myDeck, setMyDeck] = useState(decks[0]?.id ?? 'preset-red');
  const [botDeck, setBotDeck] = useState('preset-green');
  const [first, setFirst] = useState<'random' | 'me' | 'bot'>('random');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    setError('');
    try {
      const [mine, theirs] = await Promise.all([loadDeckCards(myDeck, decks), loadDeckCards(botDeck, decks)]);
      if (mine.length < 20 || theirs.length < 20) throw new Error('Both decks need at least 20 main-deck cards.');
      const firstPlayer: PlayerId = first === 'me' ? ME : first === 'bot' ? BOT : Math.random() < 0.5 ? ME : BOT;
      setGame(newGame({ decks: [mine, theirs], names: ['You', 'Bot'], first: firstPlayer }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!game) {
    return (
      <div className="page">
        <h1>Play vs Bot</h1>
        <div className="panel setup-panel">
          <label>Your deck <select value={myDeck} onChange={(e) => setMyDeck(e.target.value)}><DeckOptions decks={decks} /></select></label>
          <label>Bot deck <select value={botDeck} onChange={(e) => setBotDeck(e.target.value)}><DeckOptions decks={decks} /></select></label>
          <label>
            Who goes first{' '}
            <select value={first} onChange={(e) => setFirst(e.target.value as typeof first)}>
              <option value="random">Random</option>
              <option value="me">Me</option>
              <option value="bot">Bot</option>
            </select>
          </label>
          <button onClick={start} disabled={loading}>{loading ? 'Loading cards…' : 'Start game'}</button>
          {error && <div className="error small">{error}</div>}
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
            <button onClick={start}>Rematch</button>
            <button className="secondary" onClick={() => setGame(null)}>Change decks</button>
          </>
        }
      />
    </div>
  );
}

export function RulesNote() {
  return (
    <div className="panel small muted">
      <strong>Simplified rules.</strong> London mulligans; instants and flash cards can be cast when you get
      priority: in response to a spell, after attackers or blockers are declared, and at end of turn (you are only
      asked when you hold something castable). Combat supports flying, reach, haste, vigilance, trample, deathtouch,
      lifelink, defender, first strike, double strike and menace. Spells that deal damage, destroy/exile a creature,
      counter a spell, pump a creature, draw cards or gain life are automated; other effects (including creature
      abilities and triggers) are not simulated yet. <Link to="/decks">Build a deck</Link> to bring your own.
    </div>
  );
}
