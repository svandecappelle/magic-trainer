import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CardSearch } from '../components/CardSearch';
import { DeckStats } from '../components/DeckStats';
import { ManaCost } from '../components/ManaCost';
import { formatDeckText, parseDeckText } from '../lib/deckText';
import { checkDeck, type DeckIssue } from '../lib/legality';
import { fetchCardsById } from '../lib/scryfall';
import { resolveDecklist } from '../lib/importDeck';
import { primaryType, TYPE_ORDER } from '../lib/stats';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { useApp } from '../store/useApp';
import { FORMATS, type Board, type Card } from '../types';

export function DeckEditor() {
  const t = useT();
  const show = useCardDisplay();
  const { deckId = '' } = useParams();
  const deck = useApp((s) => s.decks.find((d) => d.id === deckId));
  const collection = useApp((s) => s.collection);
  const { updateDeck, addToDeck, moveBoard } = useApp.getState();
  const [preview, setPreview] = useState<Card | null>(null);
  const [textMode, setTextMode] = useState<'none' | 'import' | 'export'>('none');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [refreshMsg, setRefreshMsg] = useState('');

  const ownedByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of Object.values(collection)) m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty + e.foilQty);
    return m;
  }, [collection]);

  if (!deck) return <div className="page"><p>{t.editor.notFound} <Link to="/decks">{t.editor.back}</Link></p></div>;

  /** Re-fetch every card of the deck from Scryfall: legalities, faces, loyalty… for cards saved long ago. */
  async function refreshCards() {
    setRefreshMsg(t.editor.refreshing);
    try {
      const fresh = await fetchCardsById(deck!.entries.map((e) => e.card.id));
      updateDeck(deck!.id, { entries: deck!.entries.map((e) => ({ ...e, card: fresh.get(e.card.id) ?? e.card })) });
      setRefreshMsg(t.editor.refreshed(fresh.size));
    } catch {
      setRefreshMsg(t.editor.refreshFailed);
    }
  }

  const issues = checkDeck(deck);
  const issueText = (i: DeckIssue) => {
    switch (i.kind) {
      case 'tooFew': return t.editor.issues.tooFew(i.n, i.min);
      case 'tooMany': return t.editor.issues.tooMany(i.n, i.max);
      case 'sideboard': return t.editor.issues.sideboard(i.n, i.max);
      case 'copies': return t.editor.issues.copies(show.nameOf(i.card), i.n, i.max);
      case 'banned': return t.editor.issues.banned(show.nameOf(i.card));
      case 'notLegal': return t.editor.issues.notLegal(show.nameOf(i.card));
      case 'unknown': return t.editor.issues.unknown(i.n);
    }
  };

  async function runImport() {
    const lines = parseDeckText(importText);
    if (!lines.length) return;
    setImportMsg(t.decks.lookingUp);
    try {
      const { entries, notFound } = await resolveDecklist(lines);
      updateDeck(deck!.id, { entries });
      setImportMsg(notFound.length ? t.editor.importedMissing(notFound) : t.editor.imported(entries.length));
      if (!notFound.length) setTextMode('none');
    } catch (e) {
      setImportMsg(String(e));
    }
  }

  const renderBoard = (board: Board) => {
    const list = deck.entries.filter((e) => e.board === board);
    if (!list.length) return <p className="muted small">{t.editor.empty}</p>;
    return TYPE_ORDER.map((type) => {
      const group = list
        .filter((e) => primaryType(e.card) === type)
        .sort((a, b) => a.card.cmc - b.card.cmc || show.name(a.card).localeCompare(show.name(b.card)));
      if (!group.length) return null;
      return (
        <div key={type} className="type-group">
          <h4>{t.types[type]} ({group.reduce((n, e) => n + e.qty, 0)})</h4>
          <ul className="deck-list">
            {group.map((e) => {
              const owned = ownedByName.get(e.card.name) ?? 0;
              return (
                <li key={e.card.id} onMouseEnter={() => setPreview(e.card)}>
                  <span className="qty">{e.qty}</span>
                  <span className="card-name">{show.name(e.card)}</span>
                  <ManaCost cost={e.card.manaCost} />
                  <span className={`owned small ${owned >= e.qty ? 'ok' : 'missing'}`} title={t.editor.owned}>
                    {owned}/{e.qty}
                  </span>
                  <span className="entry-actions">
                    <button className="icon" title={t.editor.addOne} onClick={() => addToDeck(deck.id, e.card, board, 1)}>+</button>
                    <button className="icon" title={t.editor.removeOne} onClick={() => addToDeck(deck.id, e.card, board, -1)}>−</button>
                    <button className="icon" title={board === 'main' ? t.editor.toSide : t.editor.toMain} onClick={() => moveBoard(deck.id, e.card.id, board)}>
                      {board === 'main' ? t.editor.toSideShort : t.editor.toMainShort}
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
          {FORMATS.map((f) => <option key={f} value={f}>{t.formats[f] ?? f}</option>)}
        </select>
        <button className="secondary" onClick={() => setTextMode(textMode === 'import' ? 'none' : 'import')}>{t.editor.import}</button>
        <button className="secondary" onClick={() => setTextMode(textMode === 'export' ? 'none' : 'export')}>{t.editor.export}</button>
        <Link to={`/goldfish/${deck.id}`} className="button">{t.editor.goldfish}</Link>
      </div>

      {deck.format !== 'casual' && (
        <div className={`legality ${issues.length ? 'bad' : 'ok'}`}>
          {issues.length === 0 ? (
            <span>✓ {t.editor.legalIn(t.formats[deck.format as keyof typeof t.formats] ?? deck.format)}</span>
          ) : (
            <ul>
              {issues.map((i, k) => <li key={k}>{issueText(i)}</li>)}
            </ul>
          )}
          <span className="spacer" />
          <button className="secondary small" onClick={refreshCards} title={t.editor.refreshHelp}>{t.editor.refresh}</button>
          {refreshMsg && <span className="small muted">{refreshMsg}</span>}
        </div>
      )}

      {textMode === 'import' && (
        <div className="panel">
          <p className="small muted">{t.editor.importHelp}</p>
          <textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Smash to Smithereens'} />
          <div className="row">
            <button onClick={runImport}>{t.editor.import}</button>
            <span className="small">{importMsg}</span>
          </div>
        </div>
      )}
      {textMode === 'export' && (
        <div className="panel">
          <textarea rows={10} readOnly value={formatDeckText(deck)} onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard.writeText(formatDeckText(deck))}>{t.editor.copy}</button>
        </div>
      )}

      <div className="editor-layout">
        <section className="panel">
          <h3>{t.editor.addCards}</h3>
          <CardSearch
            onPreview={setPreview}
            actions={(card) => (
              <>
                <button className="icon" title={t.editor.addMainTitle} onClick={() => addToDeck(deck.id, card, 'main', 1)}>{t.editor.addMain}</button>
                <button className="icon" title={t.editor.addSideTitle} onClick={() => addToDeck(deck.id, card, 'side', 1)}>{t.editor.addSide}</button>
              </>
            )}
          />
        </section>

        <section className="panel">
          <h3>{t.editor.mainDeck}</h3>
          {renderBoard('main')}
          <h3>{t.editor.sideboard}</h3>
          {renderBoard('side')}
        </section>

        <aside className="panel side-column">
          {preview?.imageNormal ? (
            <img className="card-preview" src={show.imageNormal(preview)} alt={show.name(preview)} />
          ) : (
            <div className="card-preview placeholder muted small">{t.common.hoverPreview}</div>
          )}
          <DeckStats entries={deck.entries} />
        </aside>
      </div>
    </div>
  );
}
