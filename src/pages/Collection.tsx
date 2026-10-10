import { useMemo, useState } from 'react';
import { CardSearch } from '../components/CardSearch';
import { ManaCost } from '../components/ManaCost';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { useApp } from '../store/useApp';
import type { Card } from '../types';

export function Collection() {
  const t = useT();
  const show = useCardDisplay();
  const collection = useApp((s) => s.collection);
  const addToCollection = useApp((s) => s.addToCollection);
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<Card | null>(null);

  const entries = useMemo(
    () =>
      Object.values(collection)
        .filter((e) => `${e.card.name} ${show.name(e.card)}`.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => show.name(a.card).localeCompare(show.name(b.card))),
    [collection, filter, show],
  );
  const all = Object.values(collection);
  const totalCards = all.reduce((n, e) => n + e.qty + e.foilQty, 0);
  // Scryfall's usd price is for non-foil; foil copies are valued at the same price as an approximation.
  const totalValue = all.reduce((sum, e) => sum + (e.card.priceUsd ?? 0) * (e.qty + e.foilQty), 0);

  return (
    <div className="page">
      <h1>{t.collection.title}</h1>
      <div className="stat-row">
        <div><strong>{all.length}</strong> {t.collection.unique}</div>
        <div><strong>{totalCards}</strong> {t.collection.cards}</div>
        <div>≈ <strong>{t.price(totalValue)}</strong></div>
      </div>

      <div className="editor-layout">
        <section className="panel">
          <h3>{t.collection.addCards}</h3>
          <CardSearch
            onPreview={setPreview}
            actions={(card) => (
              <>
                <button className="icon" onClick={() => addToCollection(card, 1)}>+1</button>
                <button className="icon" title={t.collection.addFoil} onClick={() => addToCollection(card, 1, true)}>+★</button>
              </>
            )}
          />
        </section>

        <section className="panel">
          <h3>{t.collection.owned}</h3>
          <input type="search" placeholder={t.collection.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <table className="collection-table">
            <thead>
              <tr>{t.collection.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.card.id} onMouseEnter={() => setPreview(e.card)}>
                  <td>
                    <span className="card-name">{show.name(e.card)}</span> <ManaCost cost={e.card.manaCost} />
                  </td>
                  <td className="small muted" title={e.card.setName}>{e.card.setCode.toUpperCase()}</td>
                  <td>
                    <button className="icon" onClick={() => addToCollection(e.card, -1)}>−</button>
                    {e.qty}
                    <button className="icon" onClick={() => addToCollection(e.card, 1)}>+</button>
                  </td>
                  <td>
                    <button className="icon" onClick={() => addToCollection(e.card, -1, true)}>−</button>
                    {e.foilQty}
                    <button className="icon" onClick={() => addToCollection(e.card, 1, true)}>+</button>
                  </td>
                  <td className="small">{e.card.priceUsd != null ? t.price(e.card.priceUsd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <p className="muted small">{t.collection.empty}</p>}
        </section>

        <aside className="panel side-column">
          {preview?.imageNormal ? (
            <img className="card-preview" src={show.imageNormal(preview)} alt={show.name(preview)} />
          ) : (
            <div className="card-preview placeholder muted small">{t.common.hoverPreview}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
