import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CardSearch } from '../components/CardSearch';
import { DeckStats } from '../components/DeckStats';
import { ManaCost } from '../components/ManaCost';
import { formatDeckText, parseDeckText } from '../lib/deckText';
import { resolveDecklist } from '../lib/importDeck';
import { primaryType, TYPE_ORDER } from '../lib/stats';
import { useApp } from '../store/useApp';
import { FORMATS, type Board, type Card } from '../types';

export function DeckEditor() {
  const { deckId = '' } = useParams();
  const deck = useApp((s) => s.decks.find((d) => d.id === deckId));
  const collection = useApp((s) => s.collection);
  const { updateDeck, addToDeck, moveBoard } = useApp.getState();
  const [preview, setPreview] = useState<Card | null>(null);
  const [textMode, setTextMode] = useState<'none' | 'import' | 'export'>('none');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const ownedByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of Object.values(collection)) m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty + e.foilQty);
    return m;
  }, [collection]);

  if (!deck) return <div className="page"><p>Deck not found. <Link to="/decks">Back to decks</Link></p></div>;

  async function runImport() {
    const lines = parseDeckText(importText);
    if (!lines.length) return;
    setImportMsg('Looking up cards…');
    try {
      const { entries, notFound } = await resolveDecklist(lines);
      updateDeck(deck!.id, { entries });
      setImportMsg(notFound.length ? `Imported. Not found: ${notFound.join(', ')}` : `Imported ${entries.length} entries.`);
      if (!notFound.length) setTextMode('none');
    } catch (e) {
      setImportMsg(String(e));
    }
  }

  const renderBoard = (board: Board) => {
    const list = deck.entries.filter((e) => e.board === board);
    if (!list.length) return <p className="muted small">Empty</p>;
    return TYPE_ORDER.map((type) => {
      const group = list
        .filter((e) => primaryType(e.card) === type)
        .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
      if (!group.length) return null;
      return (
        <div key={type} className="type-group">
          <h4>{type} ({group.reduce((n, e) => n + e.qty, 0)})</h4>
          <ul className="deck-list">
            {group.map((e) => {
              const owned = ownedByName.get(e.card.name) ?? 0;
              return (
                <li key={e.card.id} onMouseEnter={() => setPreview(e.card)}>
                  <span className="qty">{e.qty}</span>
                  <span className="card-name">{e.card.name}</span>
                  <ManaCost cost={e.card.manaCost} />
                  <span className={`owned small ${owned >= e.qty ? 'ok' : 'missing'}`} title="Copies in your collection">
                    {owned}/{e.qty}
                  </span>
                  <span className="entry-actions">
                    <button className="icon" title="Add one" onClick={() => addToDeck(deck.id, e.card, board, 1)}>+</button>
                    <button className="icon" title="Remove one" onClick={() => addToDeck(deck.id, e.card, board, -1)}>−</button>
                    <button className="icon" title={board === 'main' ? 'Move one to sideboard' : 'Move one to main'} onClick={() => moveBoard(deck.id, e.card.id, board)}>
                      {board === 'main' ? '→SB' : '→MB'}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    });
  };

  return (
    <div className="page">
      <div className="deck-header">
        <input
          className="deck-name-input"
          value={deck.name}
          onChange={(e) => updateDeck(deck.id, { name: e.target.value })}
        />
        <select value={deck.format} onChange={(e) => updateDeck(deck.id, { format: e.target.value })}>
          {FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button className="secondary" onClick={() => setTextMode(textMode === 'import' ? 'none' : 'import')}>Import</button>
        <button className="secondary" onClick={() => setTextMode(textMode === 'export' ? 'none' : 'export')}>Export</button>
        <Link to={`/goldfish/${deck.id}`} className="button">Goldfish ▶</Link>
      </div>

      {textMode === 'import' && (
        <div className="panel">
          <p className="small muted">Paste a decklist (Arena/MTGO/plain text). This replaces the current list.</p>
          <textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Smash to Smithereens'} />
          <div className="row">
            <button onClick={runImport}>Import</button>
            <span className="small">{importMsg}</span>
          </div>
        </div>
      )}
      {textMode === 'export' && (
        <div className="panel">
          <textarea rows={10} readOnly value={formatDeckText(deck)} onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard.writeText(formatDeckText(deck))}>Copy to clipboard</button>
        </div>
      )}

      <div className="editor-layout">
        <section className="panel">
          <h3>Add cards</h3>
          <CardSearch
            onPreview={setPreview}
            actions={(card) => (
              <>
                <button className="icon" title="Add to main deck" onClick={() => addToDeck(deck.id, card, 'main', 1)}>+MB</button>
                <button className="icon" title="Add to sideboard" onClick={() => addToDeck(deck.id, card, 'side', 1)}>+SB</button>
              </>
            )}
          />
        </section>

        <section className="panel">
          <h3>Main deck</h3>
          {renderBoard('main')}
          <h3>Sideboard</h3>
          {renderBoard('side')}
        </section>

        <aside className="panel side-column">
          {preview?.imageNormal ? (
            <img className="card-preview" src={preview.imageNormal} alt={preview.name} />
          ) : (
            <div className="card-preview placeholder muted small">Hover a card to preview it</div>
          )}
          <DeckStats entries={deck.entries} />
        </aside>
      </div>
    </div>
  );
}
