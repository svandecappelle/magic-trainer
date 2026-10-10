import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { countCards } from '../lib/stats';
import { useApp } from '../store/useApp';

const FEATURES = [
  { to: '/decks', key: 'decks' },
  { to: '/collection', key: 'collection' },
  { to: '/goldfish', key: 'goldfish' },
  { to: '/play', key: 'play' },
  { to: '/online', key: 'online' },
  { to: '/life', key: 'life' },
];

export function Home() {
  const t = useT();
  const decks = useApp((s) => s.decks);
  const uniqueOwned = useApp((s) => Object.keys(s.collection).length);

  return (
    <div className="page">
      <h1>Magic Trainer</h1>
      <p className="muted">{t.home.summary(decks.length, uniqueOwned)}</p>
      <div className="feature-grid">
        {FEATURES.map((f) => {
          const [title, text] = t.home.features[f.key];
          return (
            <Link key={f.to} to={f.to} className="feature">
              <h3>{title}</h3>
              <p className="small muted">{text}</p>
            </Link>
          );
        })}
      </div>
      {decks.length > 0 && (
        <>
          <h3>{t.home.recentDecks}</h3>
          <ul className="plain-list">
            {[...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((d) => (
              <li key={d.id}>
                <Link to={`/decks/${d.id}`}>{d.name}</Link> <span className="muted small">{t.home.cardCount(countCards(d.entries))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
