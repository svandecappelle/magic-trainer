import { useState } from 'react';
import {
  averageManaValue, colorPips, countCards, deckPrice, isLand, manaCurve, probAtLeast, typeBreakdown, TYPE_ORDER,
} from '../lib/stats';
import type { DeckEntry } from '../types';

const COLOR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

export function DeckStats({ entries }: { entries: DeckEntry[] }) {
  const [minLands, setMinLands] = useState(2);
  const size = countCards(entries);
  const curve = manaCurve(entries);
  const maxCurve = Math.max(1, ...curve);
  const pips = colorPips(entries);
  const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
  const types = typeBreakdown(entries);
  const lands = entries.filter((e) => e.board === 'main' && isLand(e.card)).reduce((n, e) => n + e.qty, 0);

  return (
    <div className="deck-stats">
      <div className="stat-row">
        <div><strong>{size}</strong> cards</div>
        <div><strong>{countCards(entries, 'side')}</strong> sideboard</div>
        <div>avg MV <strong>{averageManaValue(entries).toFixed(2)}</strong></div>
        <div><strong>${deckPrice(entries).toFixed(2)}</strong></div>
      </div>

      <h4>Mana curve</h4>
      <div className="curve">
        {curve.map((n, mv) => (
          <div key={mv} className="curve-col" title={`${n} card(s)`}>
            <span className="small">{n || ''}</span>
            <div className="curve-bar" style={{ height: `${(n / maxCurve) * 80}px` }} />
            <span className="small muted">{mv === 7 ? '7+' : mv}</span>
          </div>
        ))}
      </div>

      <h4>Colors</h4>
      {totalPips === 0 ? (
        <div className="muted small">Colorless</div>
      ) : (
        <div className="color-bar">
          {Object.entries(pips)
            .filter(([, n]) => n > 0)
            .map(([c, n]) => (
              <div
                key={c}
                className={`pip-seg pip-${c}`}
                style={{ flex: n }}
                title={`${COLOR_NAMES[c]}: ${n} pips`}
              >
                {Math.round((n / totalPips) * 100)}%
              </div>
            ))}
        </div>
      )}

      <h4>Types</h4>
      <ul className="type-list small">
        {TYPE_ORDER.filter((t) => types[t] > 0).map((t) => (
          <li key={t}>
            {t} <strong>{types[t]}</strong>
          </li>
        ))}
      </ul>

      <h4>Opening hand</h4>
      {size >= 7 ? (
        <p className="small">
          Chance of at least{' '}
          <select value={minLands} onChange={(e) => setMinLands(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
          </select>{' '}
          land(s) in 7 cards: <strong>{(probAtLeast(size, lands, 7, minLands) * 100).toFixed(1)}%</strong>
          <br />
          <span className="muted">{lands} lands in {size} cards</span>
        </p>
      ) : (
        <p className="muted small">Add at least 7 cards.</p>
      )}
    </div>
  );
}
