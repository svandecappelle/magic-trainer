import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { countCards } from '../lib/stats';
import { useApp } from '../store/useApp';
import { FORMATS } from '../types';

export function Decks() {
  const decks = useApp((s) => s.decks);
  const createDeck = useApp((s) => s.createDeck);
  const deleteDeck = useApp((s) => s.deleteDeck);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<string>('casual');

  function create(e: React.FormEvent) {
    e.preventDefault();
    const id = createDeck(name.trim() || 'Untitled deck', format);
    navigate(`/decks/${id}`);
  }

  return (
    <div className="page">
      <h1>Decks</h1>
      <form className="inline-form" onSubmit={create}>
        <input placeholder="New deck name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button type="submit">Create deck</button>
      </form>

      {decks.length === 0 ? (
        <p className="muted">No decks yet. Create one, or create one and import a list.</p>
      ) : (
        <div className="deck-grid">
          {[...decks]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((deck) => {
              const cover = deck.entries.find((e) => e.card.imageSmall)?.card.imageSmall;
              return (
                <div key={deck.id} className="deck-tile">
                  {cover ? <img src={cover} alt="" /> : <div className="deck-cover-empty" />}
                  <div className="deck-tile-body">
                    <Link to={`/decks/${deck.id}`} className="card-name">{deck.name}</Link>
                    <div className="muted small">
                      {deck.format} · {countCards(deck.entries)} cards
                    </div>
                    <div className="row">
                      <Link to={`/goldfish/${deck.id}`} className="button secondary">Goldfish</Link>
                      <button
                        className="danger"
                        onClick={() => confirm(`Delete "${deck.name}"?`) && deleteDeck(deck.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
