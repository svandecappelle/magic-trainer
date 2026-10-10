import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseDecklist } from '../lib/deckText';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { resolveDecklist } from '../lib/importDeck';
import { countCards } from '../lib/stats';
import { useApp } from '../store/useApp';
import { FORMATS } from '../types';

export function Decks() {
  const t = useT();
  const show = useCardDisplay();
  const decks = useApp((s) => s.decks);
  const createDeck = useApp((s) => s.createDeck);
  const deleteDeck = useApp((s) => s.deleteDeck);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<string>('casual');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');
  const [importFormat, setImportFormat] = useState<string>('casual');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ id?: string; message: string } | null>(null);

  const parsed = useMemo(() => parseDecklist(importText), [importText]);
  const parsedCount = (board: string) => parsed.lines.filter((l) => l.board === board).reduce((n, l) => n + l.qty, 0);

  function create(e: React.FormEvent) {
    e.preventDefault();
    const id = createDeck(name.trim() || t.decks.untitled, format);
    navigate(`/decks/${id}`);
  }

  async function loadFile(file: File) {
    setImportText(await file.text());
    if (!importName) setImportName(file.name.replace(/\.[^.]+$/, ''));
  }

  async function runImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const { entries, notFound } = await resolveDecklist(parsed.lines);
      if (!entries.length) {
        setImportResult({ message: t.decks.noneFound(notFound) });
        return;
      }
      const id = createDeck(importName.trim() || parsed.name || t.decks.importedName, importFormat, entries);
      if (!notFound.length) {
        navigate(`/decks/${id}`);
        return;
      }
      setImportResult({ id, message: t.decks.partlyFound(notFound) });
    } catch (e) {
      setImportResult({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="page">
      <h1>{t.decks.title}</h1>
      <form className="inline-form" onSubmit={create}>
        <input placeholder={t.decks.newDeckName} value={name} onChange={(e) => setName(e.target.value)} />
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {FORMATS.map((f) => <option key={f} value={f}>{t.formats[f] ?? f}</option>)}
        </select>
        <button type="submit">{t.decks.createDeck}</button>
        <button type="button" className="secondary" onClick={() => setShowImport(!showImport)}>
          {t.decks.importDecklist}
        </button>
      </form>

      {showImport && (
        <div className="panel import-panel">
          <p className="small muted">
            {t.decks.importHelp} {t.decks.importFormat}
          </p>
          <textarea
            rows={12}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'Deck\n4 Lightning Bolt\n4 Goblin Guide\n20 Mountain\n\nSideboard\n2 Smash to Smithereens'}
          />
          <div className="row">
            <input type="file" accept=".txt,.dec,text/plain" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </div>
          <div className="row">
            <input placeholder={parsed.name ?? t.decks.deckName} value={importName} onChange={(e) => setImportName(e.target.value)} />
            <select value={importFormat} onChange={(e) => setImportFormat(e.target.value)}>
              {FORMATS.map((f) => <option key={f} value={f}>{t.formats[f] ?? f}</option>)}
            </select>
            <button onClick={runImport} disabled={importing || !parsed.lines.length}>
              {importing ? t.decks.lookingUp : t.decks.importAsNew}
            </button>
            <span className="small muted">
              {parsed.lines.length > 0 && t.decks.detected(parsedCount('main'), parsedCount('side'))}
            </span>
          </div>
          {importResult && (
            <p className="small">
              <span className={importResult.id ? '' : 'error'}>{importResult.message}</span>{' '}
              {importResult.id && <Link to={`/decks/${importResult.id}`}>{t.decks.openDeck}</Link>}
            </p>
          )}
        </div>
      )}

      {decks.length === 0 ? (
        <p className="muted">{t.decks.empty}</p>
      ) : (
        <div className="deck-grid">
          {[...decks]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((deck) => {
              const coverCard = deck.entries.find((e) => e.card.imageSmall)?.card;
              const cover = coverCard && show.imageSmall(coverCard);
              return (
                <div key={deck.id} className="deck-tile">
                  {cover ? <img src={cover} alt="" /> : <div className="deck-cover-empty" />}
                  <div className="deck-tile-body">
                    <Link to={`/decks/${deck.id}`} className="card-name">{deck.name}</Link>
                    <div className="muted small">
                      {t.decks.tile(t.formats[deck.format] ?? deck.format, countCards(deck.entries))}
                    </div>
                    <div className="row">
                      <Link to={`/goldfish/${deck.id}`} className="button secondary">{t.decks.goldfish}</Link>
                      <button
                        className="danger"
                        onClick={() => confirm(t.decks.confirmDelete(deck.name)) && deleteDeck(deck.id)}
                      >
                        {t.common.delete}
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
