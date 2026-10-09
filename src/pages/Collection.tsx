import { useMemo, useState } from 'react';
import { CardSearch } from '../components/CardSearch';
import { ManaCost } from '../components/ManaCost';
import { useApp } from '../store/useApp';
import type { Card } from '../types';

export function Collection() {
  const collection = useApp((s) => s.collection);
  const addToCollection = useApp((s) => s.addToCollection);
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<Card | null>(null);

  const entries = useMemo(
    () =>
      Object.values(collection)
        .filter((e) => e.card.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => a.card.name.localeCompare(b.card.name)),
    [collection, filter],
  );
  const all = Object.values(collection);
  const totalCards = all.reduce((n, e) => n + e.qty + e.foilQty, 0);
  // Scryfall's usd price is for non-foil; foil copies are valued at the same price as an approximation.
  const totalValue = all.reduce((sum, e) => sum + (e.card.priceUsd ?? 0) * (e.qty + e.foilQty), 0);

  return (
    <div className="page">
      <h1>Collection</h1>
      <div className="stat-row">
        <div><strong>{all.length}</strong> unique</div>
        <div><strong>{totalCards}</strong> cards</div>
        <div>≈ <strong>${totalValue.toFixed(2)}</strong></div>
      </div>

      <div className="editor-layout">
        <section className="panel">
          <h3>Add cards</h3>
          <CardSearch
            onPreview={setPreview}
            actions={(card) => (
              <>
                <button className="icon" onClick={() => addToCollection(card, 1)}>+1</button>
                <button className="icon" title="Add a foil copy" onClick={() => addToCollection(card, 1, true)}>+★</button>
              </>
            )}
          />
        </section>

        <section className="panel">
          <h3>Owned cards</h3>
          <input type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <table className="collection-table">
            <thead>
              <tr><th>Card</th><th>Set</th><th>Qty</th><th>Foil</th><th>Price</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.card.id} onMouseEnter={() => setPreview(e.card)}>
                  <td>
                    <span className="card-name">{e.card.name}</span> <ManaCost cost={e.card.manaCost} />
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
                  <td className="small">{e.card.priceUsd != null ? `$${e.card.priceUsd.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <p className="muted small">Nothing here yet. Search on the left to add cards.</p>}
        </section>

        <aside className="panel side-column">
          {preview?.imageNormal ? (
            <img className="card-preview" src={preview.imageNormal} alt={preview.name} />
          ) : (
            <div className="card-preview placeholder muted small">Hover a card to preview it</div>
          )}
        </aside>
      </div>
    </div>
  );
}
