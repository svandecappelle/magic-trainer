import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CardSearch } from '../components/CardSearch';
import { useHoverPreview } from '../components/HoverPreview';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { useApp } from '../store/useApp';
import type { Card, Deck } from '../types';

type Tab = 'owned' | 'missing' | 'add';

/** Copies of each card name needed by the decks: the most any one deck uses (main, sideboard and commander). */
function neededByName(decks: Deck[]): Map<string, { card: Card; n: number }> {
  const need = new Map<string, { card: Card; n: number }>();
  for (const d of decks) {
    const inDeck = new Map<string, { card: Card; n: number }>();
    for (const e of d.entries) {
      const cur = inDeck.get(e.card.name);
      inDeck.set(e.card.name, { card: e.card, n: (cur?.n ?? 0) + e.qty });
    }
    for (const [name, x] of inDeck) if ((need.get(name)?.n ?? 0) < x.n) need.set(name, x);
  }
  return need;
}

export function Collection() {
  const t = useT();
  const show = useCardDisplay();
  const collection = useApp((s) => s.collection);
  const decks = useApp((s) => s.decks);
  const addToCollection = useApp((s) => s.addToCollection);
  const hover = useHoverPreview();
  const [tab, setTab] = useState<Tab>(Object.keys(collection).length ? 'owned' : 'add');
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const all = Object.values(collection);
  const totalCards = all.reduce((n, e) => n + e.qty + e.foilQty, 0);
  // Scryfall's usd price is for non-foil; foil copies are valued at the same price as an approximation.
  const totalValue = all.reduce((sum, e) => sum + (e.card.priceUsd ?? 0) * (e.qty + e.foilQty), 0);

  const ownedByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty + e.foilQty);
    return m;
  }, [all]);
  const need = useMemo(() => neededByName(decks), [decks]);
  const owned = (name: string) => ownedByName.get(name) ?? 0;
  const missing = [...need.values()].filter((x) => x.n > owned(x.card.name));

  /** Under a card: enough copies for the decks, how many more they need, or not used by any deck. */
  const note = (card: Card) => {
    const n = need.get(card.name)?.n ?? 0;
    if (!n) return <span className="muted">{t.collection.notInDeck}</span>;
    const have = owned(card.name);
    return have >= n ? <span className="ok">{t.collection.enough}</span> : <span className="warn">{t.collection.need(n - have)}</span>;
  };
  const matches = (card: Card) => `${card.name} ${show.name(card)}`.toLowerCase().includes(filter.toLowerCase());

  const ownedCards = all.filter((e) => matches(e.card)).sort((a, b) => show.name(a.card).localeCompare(show.name(b.card)));
  const missingCards = missing.filter((x) => matches(x.card)).sort((a, b) => show.name(a.card).localeCompare(show.name(b.card)));

  const deckProgress = decks.map((d) => {
    const byName = new Map<string, number>();
    for (const e of d.entries) byName.set(e.card.name, (byName.get(e.card.name) ?? 0) + e.qty);
    let total = 0;
    const lacking: [string, number][] = [];
    for (const [name, n] of byName) {
      total += n;
      if (n > owned(name)) lacking.push([name, n - owned(name)]);
    }
    const short = lacking.reduce((s, [, n]) => s + n, 0);
    return { deck: d, total, short, lacking };
  });

  async function copyMissing() {
    const text = missing.map((x) => `${x.n - owned(x.card.name)} ${x.card.name}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabs: [Tab, string][] = [['owned', t.collection.tabs.owned], ['missing', t.collection.tabs.missing], ['add', t.collection.tabs.add]];
  const cardTile = (card: Card, badge: string | null, faded: boolean, foil = 0) => (
    <figure key={card.id} className={`result-card ${faded ? 'missing' : ''}`}>
      <div className="card-frame">
        <img src={show.imageSmall(card)} alt={show.name(card)} loading="lazy" {...hover.bind(card)} />
        {badge && <span className="count-badge">{badge}</span>}
      </div>
      <figcaption>
        <span className="small">{note(card)}{foil > 0 && <span className="muted"> · {t.collection.foil(foil)}</span>}</span>
        <span className="result-actions">
          <span className="qty-stepper">
            <button type="button" aria-label={t.collection.removeOne} onClick={() => addToCollection(card, -1)} disabled={!owned(card.name)}>−</button>
            <span>{collection[card.id]?.qty ?? 0}</span>
            <button type="button" aria-label={t.collection.addOne} onClick={() => addToCollection(card, 1)}>+</button>
          </span>
          <button className="icon" title={t.collection.addFoil} onClick={() => addToCollection(card, 1, true)}>+★</button>
        </span>
      </figcaption>
    </figure>
  );

  return (
    <div className="page collection">
      <header className="collection-head">
        <div>
          <h1>{t.collection.title}</h1>
          <p className="muted">{t.collection.subtitle}</p>
          <div className="chips">
            <span className="chip">{all.length} {t.collection.unique}</span>
            <span className="chip">{totalCards} {t.collection.cards}</span>
            <span className="chip">≈ {t.price(totalValue)}</span>
          </div>
        </div>
        <div className="segmented" role="tablist" aria-label={t.collection.title}>
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}{id === 'missing' && missing.length > 0 ? ` (${missing.length})` : ''}
            </button>
          ))}
        </div>
      </header>

      <div className="editor-layout">
        <section className="panel">
          {tab === 'add' ? (
            <CardSearch
              layout="grid"
              bindCard={hover.bind}
              info={(card) => (owned(card.name) ? <span className="in-deck">{t.collection.ownedN(owned(card.name))}</span> : note(card))}
              actions={(card) => (
                <>
                  <button className="secondary small" onClick={() => addToCollection(card, 1)}>{t.collection.add}</button>
                  <button className="icon" title={t.collection.addFoil} onClick={() => addToCollection(card, 1, true)}>+★</button>
                </>
              )}
            />
          ) : (
            <div className="card-search">
              <label className="search-box">
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 12l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                <input type="search" aria-label={t.collection.filter} placeholder={t.collection.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
              </label>
              <div className="result-grid">
                {tab === 'owned'
                  ? ownedCards.map((e) => cardTile(e.card, `×${e.qty + e.foilQty}`, false, e.foilQty))
                  : missingCards.map((x) => cardTile(x.card, `${owned(x.card.name)}/${x.n}`, true))}
              </div>
              {tab === 'owned' && !ownedCards.length && (
                <p className="muted">{t.collection.empty} <button className="secondary small" onClick={() => setTab('add')}>{t.collection.tabs.add}</button></p>
              )}
              {tab === 'missing' && !missingCards.length && <p className="muted">{t.collection.noMissing}</p>}
            </div>
          )}
        </section>

        <aside className="panel deck-progress">
          <h4>{t.collection.yourDecks}</h4>
          {!decks.length && <p className="small muted"><Link to="/decks">{t.home.newDeck}</Link></p>}
          {deckProgress.map(({ deck, total, short, lacking }) => {
            const done = short === 0;
            return (
              <Link key={deck.id} to={`/decks/${deck.id}`} className="progress-card">
                <span className="progress-head">
                  <span className="progress-name">{deck.name}</span>
                  <span className={`small ${done ? 'ok' : 'warn'}`}>{done ? t.collection.complete : t.collection.missingN(short)}</span>
                </span>
                <span className="progress-bar"><span className={done ? 'ok' : 'warn'} style={{ width: `${total ? ((total - short) / total) * 100 : 100}%` }} /></span>
                <span className="small muted">
                  {done ? t.collection.allOwned : lacking.slice(0, 3).map(([name, n]) => `${show.nameOf(name)} ×${n}`).join(', ') + (lacking.length > 3 ? '…' : '')}
                </span>
              </Link>
            );
          })}
          {missing.length > 0 && (
            <button className="secondary" onClick={copyMissing}>{copied ? t.collection.copied : t.collection.copyMissing}</button>
          )}
        </aside>
      </div>
      {hover.node}
    </div>
  );
}
