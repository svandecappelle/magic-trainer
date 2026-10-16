import { useState } from 'react';
import {
  averageManaValue, colorPips, countCards, deckPrice, isLand, manaCurve, probAtLeast, typeBreakdown, TYPE_ORDER,
} from '../lib/stats';
import { useT } from '../i18n';
import type { DeckEntry } from '../types';

/** `compact`: the curve, colors and opening hand only (the deck editor shows the counts and types elsewhere). */
export function DeckStats({ entries, compact = false }: { entries: DeckEntry[]; compact?: boolean }) {
  const t = useT();
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
      {!compact && <div className="stat-row">
        <div><strong>{size}</strong> {t.stats.cards}</div>
        <div><strong>{countCards(entries, 'side')}</strong> {t.stats.sideboard}</div>
        <div>{t.stats.avgMv} <strong>{t.num(averageManaValue(entries))}</strong></div>
        <div><strong>{t.price(deckPrice(entries))}</strong></div>
      </div>}

      <div className="stats-head">
        <h4>{t.stats.curve}</h4>
        <span className="small muted">{t.stats.avgMv} {t.num(averageManaValue(entries))}</span>
      </div>
      <div className="curve">
        {curve.map((n, mv) => (
          <div key={mv} className="curve-col" title={t.stats.curveTitle(n)}>
            <span className="small">{n || ''}</span>
            <div className="curve-bar" style={{ height: `${(n / maxCurve) * 80}px` }} />
            <span className="small muted">{mv === 7 ? '7+' : mv}</span>
          </div>
        ))}
      </div>

      <h4>{t.stats.colors}</h4>
      {totalPips === 0 ? (
        <div className="muted small">{t.stats.colorless}</div>
      ) : (
        <div className="color-bar">
          {Object.entries(pips)
            .filter(([, n]) => n > 0)
            .map(([c, n]) => (
              <div
                key={c}
                className={`pip-seg pip-${c}`}
                style={{ flex: n }}
                title={t.stats.pips(t.colors[c], n)}
              >
                {t.percent(n / totalPips)}
              </div>
            ))}
        </div>
      )}

      {!compact && <>
        <h4>{t.stats.types}</h4>
        <ul className="type-list small">
          {TYPE_ORDER.filter((type) => types[type] > 0).map((type) => (
            <li key={type}>
              {t.types[type]} <strong>{types[type]}</strong>
            </li>
          ))}
        </ul>
      </>}

      <h4>{t.stats.openingHand}</h4>
      {size >= 7 ? (
        <p className="small">
          {t.stats.chanceLead}{' '}
          <select value={minLands} onChange={(e) => setMinLands(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
          </select>{' '}
          {t.stats.chanceTail} <strong>{t.percent(probAtLeast(size, lands, 7, minLands))}</strong>
          <br />
          <span className="muted">{t.stats.landsIn(lands, size)}</span>
        </p>
      ) : (
        <p className="muted small">{t.stats.needSeven}</p>
      )}
    </div>
  );
}
