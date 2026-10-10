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
}

export function CardSearch({ actions, onPreview }: Props) {
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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
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
  }, [query, lang]);

  async function loadMore() {
    setLoading(true);
    try {
      const res = await searchCards(query.trim(), page + 1, undefined, lang !== 'en');
      setCards((prev) => [...prev, ...res.cards]);
      setHasMore(res.hasMore);
      setPage(page + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card-search">
      <input
        type="search"
        placeholder={t.search.placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="muted small">
        {loading ? t.search.searching : error ? <span className="error">{error}</span> : query.trim().length >= 2 ? t.search.results(total) : ''}
      </div>
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
