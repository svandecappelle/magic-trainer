import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deckSummary, Pips } from '../components/DeckBits';
import { DeckStats } from '../components/DeckStats';
import { useHoverPreview } from '../components/HoverPreview';
import { ManaCost } from '../components/ManaCost';
import { CopyButton } from '../components/SharePanel';
import { issueText, useT } from '../i18n';
import { accountApi, type SharedDeck as Shared } from '../lib/account/api';
import { useCardDisplay } from '../lib/cardLocale';
import { formatDeckText } from '../lib/deckText';
import { checkDeck } from '../lib/legality';
import { primaryType, TYPE_ORDER } from '../lib/stats';
import { useApp } from '../store/useApp';
import type { Board, Deck } from '../types';

/** /shared/<shareId>: a deck someone shared, read-only, to copy into one's own decks or goldfish. */
export function SharedDeck() {
  const t = useT();
  const show = useCardDisplay();
  const hover = useHoverPreview();
  const navigate = useNavigate();
  const createDeck = useApp((s) => s.createDeck);
  const { shareId = '' } = useParams();
  const [shared, setShared] = useState<Shared | 'missing' | 'error' | null>(null);

  useEffect(() => {
    let live = true;
    setShared(null);
    accountApi.shared(shareId).then(
      (deck) => live && setShared(deck),
      (e) => live && setShared(e?.status === 404 ? 'missing' : 'error'),
    );
    return () => {
      live = false;
    };
  }, [shareId]);

  if (shared === null) return <div className="page"><p className="muted">{t.share.loading}</p></div>;
  if (shared === 'missing' || shared === 'error') {
    return (
      <div className="page">
        <h1>{t.share.sharedDeck}</h1>
        <div className="banner">
          {shared === 'missing' ? t.share.missing : t.share.loadFailed}
          <Link to="/decks">{t.share.toMyDecks}</Link>
        </div>
      </div>
    );
  }

  const deck: Deck = { id: '', name: shared.name, format: shared.format, entries: shared.entries, createdAt: shared.updatedAt, updatedAt: shared.updatedAt };
  const summary = deckSummary(deck);
  const issues = deck.format === 'casual' ? [] : checkDeck(deck);
  const formatName = t.formats[deck.format] ?? deck.format;
  /** A copy in the user's decks (it stays theirs to edit), then `to` with its id. */
  const copy = (to: (id: string) => string) => navigate(to(createDeck(shared.name, shared.format, shared.entries)));

  const board = (b: Board) => {
    const list = deck.entries.filter((e) => e.board === b);
    return TYPE_ORDER.map((type) => {
      const group = list.filter((e) => primaryType(e.card) === type).sort((x, y) => x.card.cmc - y.card.cmc || show.name(x.card).localeCompare(show.name(y.card)));
      if (!group.length) return null;
      return (
        <div key={type} className="type-group">
          <h4>{t.types[type]} ({group.reduce((n, e) => n + e.qty, 0)})</h4>
          <ul className="deck-list">
            {group.map((e) => (
              <li key={e.card.id} {...hover.bind(e.card)}>
                <span className="qty">{e.qty}</span>
                <span className="card-name">{show.name(e.card)}</span>
                <ManaCost cost={e.card.manaCost} />
              </li>
            ))}
          </ul>
        </div>
      );
    });
  };
  const has = (b: Board) => deck.entries.some((e) => e.board === b);

  return (
    <div className="page shared-deck">
      <header className="editor-head">
        <div className="editor-title">
          <div className="editor-name">
            <h1>{shared.name}</h1>
            <Pips colors={summary.colors} />
          </div>
          <div className="shared-owner small muted">
            {shared.owner.avatarUrl ? <img src={shared.owner.avatarUrl} alt="" width={20} height={20} /> : null}
            {t.share.by(shared.owner.name, new Date(shared.updatedAt).toLocaleDateString())}
          </div>
          <div className="chips">
            <span className="chip">{formatName}</span>
            <span className="chip">{t.editor.counts(summary.total, summary.side)}</span>
            {deck.format !== 'casual' && (
              <span className={`chip ${issues.length ? 'warn' : 'info'}`} title={issues.map((i) => issueText(t, i, show.nameOf)).join('\n')}>
                {issues.length ? t.editor.issuesN(issues.length) : t.editor.legalIn(formatName)}
              </span>
            )}
          </div>
        </div>
        <div className="editor-actions">
          <button type="button" onClick={() => copy((id) => `/decks/${id}`)}>{t.share.copyToMine}</button>
          <button type="button" className="secondary" title={t.share.goldfishHint} onClick={() => copy((id) => `/goldfish/${id}`)}>{t.share.goldfish}</button>
          <CopyButton text={formatDeckText(deck)} label={t.share.copyList} />
        </div>
      </header>

      <div className="shared-layout">
        <section className="panel">
          {has('commander') && (<><h3>{t.editor.commander}</h3>{board('commander')}</>)}
          <h3>{t.editor.mainDeck}</h3>
          <div className="shared-columns">{board('main')}</div>
          {has('side') && (<><h3>{t.editor.sideboard}</h3><div className="shared-columns">{board('side')}</div></>)}
        </section>
        <aside className="panel">
          <DeckStats entries={deck.entries} compact />
        </aside>
      </div>
      {hover.node}
    </div>
  );
}
