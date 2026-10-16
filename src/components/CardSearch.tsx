import { useEffect, useState, type ReactNode } from 'react';
import { useLang, useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { searchCards } from '../lib/scryfall';
import type { Card } from '../types';
import { ManaCost } from './ManaCost';

interface Props {
  /** Buttons rendered next to each result. */
  actions: (card: Card) => ReactNode;
  onPreview?: (card: Card) => void;
  /** Results as a grid of card images (with filters), or as a list of names. */
  layout?: 'list' | 'grid';
  /** Grid: a line under each card ("3 in deck"). */
  info?: (card: Card) => ReactNode;
  /** Grid: hover handlers for each card (a large preview). */
  bindCard?: (card: Card) => object;
  /** The deck's format: a filter keeps the cards legal in it. */
  format?: string;
}

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const TYPES = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Battle'] as const;

/** The Scryfall query: the words typed, then the filters (colors within the chosen ones, a card type, a format). */
function fullQuery(text: string, colors: string[], type: string, legalIn: string | null): string {
  return [
    text.trim(),
    colors.length ? `id<=${colors.join('').toLowerCase()}` : '',
    type ? `t:${type.toLowerCase()}` : '',
    legalIn ? `f:${legalIn}` : '',
  ].filter(Boolean).join(' ');
}

export function CardSearch({ actions, onPreview, layout = 'list', info, bindCard, format }: Props) {
  const t = useT();
  const show = useCardDisplay();
  // In other languages, also match names printed in that language ("Foudre").
  const lang = useLang((s) => s.lang);
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [type, setType] = useState('');
  const canFilterFormat = !!format && format !== 'casual';
  const [legalOnly, setLegalOnly] = useState(canFilterFormat);
  const grid = layout === 'grid';
  const filtered = grid && (colors.length > 0 || !!type);
  const q = grid ? fullQuery(query, colors, type, legalOnly && canFilterFormat ? format! : null) : query.trim();

  useEffect(() => {
    // Typing two letters starts a search; in the grid, a color or type filter does too.
    if (query.trim().length < 2 && !filtered) {
      setCards([]);
      setTotal(0);
      setHasMore(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await searchCards(q, 1, ctrl.signal, lang !== 'en');
        setCards(res.cards);
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(1);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(String(e));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    setLoading(true);
    try {
      const res = await searchCards(q, page + 1, undefined, lang !== 'en');
      setCards((prev) => [...prev, ...res.cards]);
      setHasMore(res.hasMore);
      setPage(page + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const status = (
    <div className="muted small">
      {loading ? t.search.searching : error ? <span className="error">{error}</span> : query.trim().length >= 2 || filtered ? t.search.results(total) : ''}
    </div>
  );
  const searchBox = (
    <label className="search-box">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 12l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <input type="search" aria-label={t.search.label} placeholder={t.search.placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
    </label>
  );
  if (grid) {
    return (
      <div className="card-search grid">
        {searchBox}
        <div className="search-filters">
          <div className="color-filter" role="group" aria-label={t.search.colors}>
            {COLORS.map((c) => {
              const on = colors.includes(c);
              return (
                <button
                  key={c} type="button" className={`pip-toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={t.colors[c]}
                  onClick={() => setColors(on ? colors.filter((x) => x !== c) : [...colors, c])}
                >
                  <span className={`pip pip-${c}`}>{c}</span>
                </button>
              );
            })}
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t.search.type}>
            <option value="">{t.search.anyType}</option>
            {TYPES.map((ty) => <option key={ty} value={ty}>{t.types[ty]}</option>)}
          </select>
          {canFilterFormat && (
            <label className="check">
              <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} /> {t.editor.legalIn(t.formats[format as keyof typeof t.formats] ?? format!)}
            </label>
          )}
          <span className="spacer" />
          {status}
        </div>
        <div className="result-grid">
          {cards.map((card) => (
            <figure key={card.id} className="result-card" onMouseEnter={() => onPreview?.(card)}>
              <img src={show.imageSmall(card)} alt={show.name(card)} loading="lazy" {...(bindCard?.(card) ?? {})} />
              <figcaption>
                <span className="small">{info?.(card)}</span>
                <span className="result-actions">{actions(card)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        {hasMore && !loading && <button className="secondary" onClick={loadMore}>{t.search.loadMore}</button>}
      </div>
    );
  }

  return (
    <div className="card-search">
      {searchBox}
      {status}
      <ul className="result-list">
        {cards.map((card) => (
          <li key={card.id} onMouseEnter={() => onPreview?.(card)}>
            <div className="result-main">
              <span className="card-name">{show.name(card)}</span>
              <ManaCost cost={card.manaCost} />
              <div className="muted small">{show.typeLine(card)}</div>
            </div>
            <div className="result-actions">{actions(card)}</div>
          </li>
        ))}
      </ul>
      {hasMore && !loading && (
        <button className="secondary" onClick={loadMore}>
          {t.search.loadMore}
        </button>
      )}
    </div>
  );
}
