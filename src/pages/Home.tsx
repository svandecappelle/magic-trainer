import { Link } from 'react-router-dom';
import { countCards } from '../lib/stats';
import { useApp } from '../store/useApp';

const FEATURES = [
  { to: '/decks', title: 'Deck builder', text: 'Search every card, build decks, import and export lists, check the curve and land odds.' },
  { to: '/collection', title: 'Collection', text: 'Track the cards you own and what they are worth. Decks show which cards you are missing.' },
  { to: '/goldfish', title: 'Goldfish', text: 'Practice a deck solo: opening hands, London mulligan, playing turns, tapping lands.' },
  { to: '/play', title: 'Play vs Bot', text: 'Test your deck against a computer opponent with real combat, mana, and removal.' },
  { to: '/online', title: 'Play Online', text: 'Play a friend over the internet: share a room code, pick your decks, and battle.' },
  { to: '/life', title: 'Life tracker', text: 'Life, poison, and turns for 2–6 players at the table, plus dice and coin flips.' },
];

export function Home() {
  const decks = useApp((s) => s.decks);
  const uniqueOwned = useApp((s) => Object.keys(s.collection).length);

  return (
    <div className="page">
      <h1>Magic Trainer</h1>
      <p className="muted">
        {decks.length} deck(s) · {uniqueOwned} unique card(s) in your collection
      </p>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="feature">
            <h3>{f.title}</h3>
            <p className="small muted">{f.text}</p>
          </Link>
        ))}
      </div>
      {decks.length > 0 && (
        <>
          <h3>Recent decks</h3>
          <ul className="plain-list">
            {[...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((d) => (
              <li key={d.id}>
                <Link to={`/decks/${d.id}`}>{d.name}</Link> <span className="muted small">({countCards(d.entries)} cards)</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
