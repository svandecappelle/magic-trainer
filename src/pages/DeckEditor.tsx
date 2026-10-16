import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CardSearch } from '../components/CardSearch';
import { DeckStats } from '../components/DeckStats';
import { ManaCost } from '../components/ManaCost';
import { formatDeckText, parseDeckText } from '../lib/deckText';
import { canBeCommander, checkDeck, type DeckIssue } from '../lib/legality';
import { fetchCardsById } from '../lib/scryfall';
import { resolveDecklist } from '../lib/importDeck';
import { primaryType, TYPE_ORDER } from '../lib/stats';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { engineStatus } from '../lib/engineStatus';
import { useHoverPreview } from '../components/HoverPreview';
import { Icon } from '../components/Icon';
import { deckSummary, Pips } from '../components/DeckBits';
import { useApp } from '../store/useApp';
import { FORMATS, type Board, type Card } from '../types';

export function DeckEditor() {
  const t = useT();
  const show = useCardDisplay();
  const { deckId = '' } = useParams();
  const deck = useApp((s) => s.decks.find((d) => d.id === deckId));
  const collection = useApp((s) => s.collection);
  const { updateDeck, addToDeck, moveBoard } = useApp.getState();
  const hover = useHoverPreview();
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
      case 'noCommander': return t.editor.issues.noCommander;
      case 'notCommander': return t.editor.issues.notCommander(show.nameOf(i.card));
      case 'identity': return t.editor.issues.identity(show.nameOf(i.card));
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
                <li key={e.card.id} {...hover.bind(e.card)}>
                  <span className="qty-stepper">
                    <button type="button" aria-label={t.editor.removeOne} onClick={() => addToDeck(deck.id, e.card, board, -1)}>−</button>
                    <span>{e.qty}</span>
                    <button type="button" aria-label={t.editor.addOne} onClick={() => addToDeck(deck.id, e.card, board, 1)}>+</button>
                  </span>
                  <span className="card-name">{show.name(e.card)}</span>
                  {engineStatus(e.card) !== 'ok' && (
                    <span className={`engine-badge ${engineStatus(e.card)}`} title={t.game.engineStatus[engineStatus(e.card)]}>{t.game.engineBadge[engineStatus(e.card)]}</span>
                  )}
                  <span className="entry-actions">
                    {board !== 'commander' && (
                      <button className="icon" title={board === 'main' ? t.editor.toSide : t.editor.toMain} onClick={() => moveBoard(deck.id, e.card.id, board)}>
                        {board === 'main' ? t.editor.toSideShort : t.editor.toMainShort}
                      </button>
                    )}
                    {board === 'main' && deck.format === 'commander' && canBeCommander(e.card) && (
                      <button className="icon" title={t.editor.toCommander} onClick={() => moveBoard(deck.id, e.card.id, 'main', 'commander')}><Icon name="command" /></button>
                    )}
                    {board === 'commander' && (
                      <button className="icon" title={t.editor.toMain} onClick={() => moveBoard(deck.id, e.card.id, 'commander', 'main')}>↓</button>
                    )}
                  </span>
                  <span className={`owned small ${owned >= e.qty ? 'ok' : 'missing'}`} title={t.editor.owned}>
                    {owned}/{e.qty}
                  </span>
                  <ManaCost cost={e.card.manaCost} />
                </li>
              );
            })}
          </ul>
        </div>
      );
    });
  };

  const main = deck.entries.filter((e) => e.board === 'main');
  const count = (list: typeof main) => list.reduce((n, e) => n + e.qty, 0);
  // How much of the main deck the rules engine simulates, counting copies.
  const engine = { ok: 0, partial: 0, none: 0 };
  for (const e of main) {
    const st = engineStatus(e.card);
    engine[st === 'ok' ? 'ok' : st === 'partial' ? 'partial' : 'none'] += e.qty;
  }
  const engineTotal = engine.ok + engine.partial + engine.none;
  const formatName = t.formats[deck.format as keyof typeof t.formats] ?? deck.format;
  const inDeck = (card: Card) => count(deck.entries.filter((e) => e.card.name === card.name && e.board !== 'side'));

  return (
    <div className="page editor">
      <header className="editor-head">
        <div className="editor-title">
          <Link to="/decks" className="small">← {t.editor.back}</Link>
          <div className="editor-name">
            <input className="deck-name-input" aria-label={t.editor.deckName} value={deck.name} onChange={(e) => updateDeck(deck.id, { name: e.target.value })} />
            <Pips colors={deckSummary(deck).colors} />
          </div>
          <div className="chips">
            <select className="chip-select" aria-label={t.editor.format} value={deck.format} onChange={(e) => updateDeck(deck.id, { format: e.target.value })}>
              {FORMATS.map((f) => <option key={f} value={f}>{t.formats[f] ?? f}</option>)}
            </select>
            {deck.format !== 'casual' && (
              <span className={`chip ${issues.length ? 'warn' : 'info'}`}>{issues.length ? t.editor.issuesN(issues.length) : t.editor.legalIn(formatName)}</span>
            )}
            <span className="chip">{t.editor.counts(count(main), count(deck.entries.filter((e) => e.board === 'side')))}</span>
            {engineTotal > 0 && (
              <span className={`chip ${engine.ok === engineTotal ? 'ok' : 'warn'}`} title={t.editor.engineSummary(engine.ok, engine.partial, engine.none)}>
                {t.home.simulated(engine.ok, engineTotal)}
              </span>
            )}
          </div>
        </div>
        <div className="editor-actions">
          <button className="secondary" onClick={() => setTextMode(textMode === 'import' ? 'none' : 'import')}>{t.editor.import}</button>
          <button className="secondary" onClick={() => setTextMode(textMode === 'export' ? 'none' : 'export')}>{t.editor.export}</button>
          <Link to={`/goldfish/${deck.id}`} className="button secondary">{t.editor.goldfishShort}</Link>
          <Link to={`/play?deck=${deck.id}`} className="button">{t.home.playBot}</Link>
        </div>
      </header>

      {deck.format !== 'casual' && issues.length > 0 && (
        <div className="legality bad">
          <ul>
            {issues.map((i, k) => <li key={k}>{issueText(i)}</li>)}
          </ul>
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
        <section className="panel editor-search" aria-label={t.editor.addCards}>
          <CardSearch
            layout="grid"
            format={deck.format}
            bindCard={hover.bind}
            info={(card) => {
              const n = inDeck(card);
              return n ? <span className="in-deck">{t.editor.inDeck(n)}</span> : <span className="muted">{t.editor.notInDeck}</span>;
            }}
            actions={(card) => (
              <>
                <button className="secondary small" title={t.editor.addMainTitle} onClick={() => addToDeck(deck.id, card, 'main', 1)}>{t.editor.add}</button>
                <button className="icon" title={t.editor.addSideTitle} onClick={() => addToDeck(deck.id, card, 'side', 1)}>{t.editor.addSide}</button>
              </>
            )}
          />
        </section>

        <aside className="panel editor-deck">
          <DeckStats entries={deck.entries} compact />
          {engineTotal > 0 && engine.ok < engineTotal && (
            <div className="small">
              <div className="engine-bar" aria-hidden="true">
                <span className="ok" style={{ flex: engine.ok }} />
                <span className="partial" style={{ flex: engine.partial }} />
                <span className="none" style={{ flex: engine.none }} />
              </div>
              <p className="muted" style={{ margin: '6px 0 0' }}>{t.editor.engineSummary(engine.ok, engine.partial, engine.none)}</p>
            </div>
          )}
          {(deck.format === 'commander' || deck.entries.some((e) => e.board === 'commander')) && (
            <>
              <h3>{t.editor.commander}</h3>
              {deck.entries.some((e) => e.board === 'commander') ? renderBoard('commander') : <p className="small muted">{t.editor.noCommanderYet}</p>}
            </>
          )}
          <h3>{t.editor.mainDeck}</h3>
          {renderBoard('main')}
          <h3>{t.editor.sideboard}</h3>
          {renderBoard('side')}
        </aside>
      </div>
      {hover.node}
    </div>
  );
}
