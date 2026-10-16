import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { Curve, deckSummary, Pips } from '../components/DeckBits';
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
  const sorted = [...decks].sort((a, b) => b.updatedAt - a.updatedAt);
  const last = sorted[0];
  const lastSummary = last ? deckSummary(last) : null;

  return (
    <div className="page home">
      <section className="home-top">
        {last && lastSummary ? (
          <div className="panel home-hero">
            <span className="eyebrow">{t.home.continueLabel}</span>
            <h1>{last.name}</h1>
            <p className="muted">
              <Pips colors={lastSummary.colors} /> {t.formats[last.format as keyof typeof t.formats] ?? last.format} · {t.home.deckLine(lastSummary.total, lastSummary.side)}
            </p>
            <div className="row">
              <Link className="button" to={`/play?deck=${last.id}`}>{t.home.playBot}</Link>
              <Link className="button secondary" to={`/goldfish/${last.id}`}>{t.home.goldfish}</Link>
              <Link className="button secondary" to={`/decks/${last.id}`}>{t.home.edit}</Link>
            </div>
          </div>
        ) : (
          <div className="panel home-hero">
            <span className="eyebrow">{t.home.startLabel}</span>
            <h1>{t.home.startTitle}</h1>
            <p className="muted">{t.home.startText}</p>
            <div className="row">
              <Link className="button" to="/decks">{t.home.importDeck}</Link>
              <Link className="button secondary" to="/play">{t.home.tryPreset}</Link>
            </div>
          </div>
        )}
        <div className="home-quick">
          {([['online', '/online'], ['goldfish', '/goldfish'], ['import', '/decks']] as const).map(([key, to]) => {
            const [title, text] = t.home.quick[key];
            return (
              <Link key={key} to={to} className="panel quick-link">
                <strong>{title}</strong>
                <span className="small muted">{text}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {decks.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t.home.yourDecks}</h2>
            <span className="muted small">{t.home.summary(decks.length, uniqueOwned)}</span>
            <span className="spacer" />
            <Link to="/decks" className="small">{t.home.allDecks}</Link>
          </div>
          <div className="deck-tiles">
            {sorted.slice(0, 7).map((d) => {
              const s = deckSummary(d);
              return (
                <article key={d.id} className="panel deck-tile">
                  <div className="row tile-head">
                    <Link to={`/decks/${d.id}`} className="tile-name">{d.name}</Link>
                    <Pips colors={s.colors} />
                  </div>
                  <Curve counts={s.curve} label={t.home.curve} />
                  <div className="small muted">
                    {t.home.deckLine(s.total, s.side)}
                    {s.total > 0 && <> · <span className={s.simulated === s.total ? 'ok' : ''}>{t.home.simulated(s.simulated, s.total)}</span></>}
                  </div>
                  <div className="row">
                    <Link className="button small" to={`/play?deck=${d.id}`}>{t.home.playBot}</Link>
                    <Link className="button secondary small" to={`/decks/${d.id}`}>{t.home.edit}</Link>
                  </div>
                </article>
              );
            })}
            <Link to="/decks" className="deck-tile new-deck">
              <span className="plus" aria-hidden="true">+</span>
              <strong>{t.home.newDeck}</strong>
              <span className="small muted">{t.home.newDeckHint}</span>
            </Link>
          </div>
        </section>
      )}

      <section>
        <h2>{t.home.tools}</h2>
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
      </section>
    </div>
  );
}
