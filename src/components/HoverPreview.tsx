import { useCallback, useState, type MouseEvent } from 'react';
import type { Card } from '../types';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { engineGaps, engineStatus } from '../lib/engineStatus';

/**
 * The hovered card shown large next to it, with what the rules engine does with it (screens with a mouse; hidden on
 * touch screens and narrow windows by the CSS). `bind(card)` goes on each element showing a card.
 */
export function useHoverPreview() {
  const [hover, setHover] = useState<{ card: Card; rect: DOMRect } | null>(null);
  const hide = useCallback(() => setHover(null), []);
  const bind = (card: Card) => ({
    onMouseEnter: (e: MouseEvent) => setHover({ card, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: hide,
    onMouseDown: hide,
  });
  return { bind, hide, node: hover ? <HoverCard card={hover.card} rect={hover.rect} /> : null };
}

function HoverCard({ card, rect }: { card: Card; rect: DOMRect }) {
  const t = useT();
  const show = useCardDisplay();
  const w = 250;
  const h = w * 1.4 + 34;
  const right = rect.right + 14 + w < window.innerWidth;
  const left = right ? rect.right + 14 : Math.max(8, rect.left - 14 - w);
  const top = Math.min(Math.max(8, rect.top + rect.height / 2 - h / 2), window.innerHeight - h - 8);
  const status = engineStatus(card);
  return (
    <div className="hover-preview" style={{ left, top, width: w }} aria-hidden="true">
      <img src={show.imageNormal(card)} alt="" />
      <span className={`engine-pill ${status}`}>{t.game.engineStatus[status]}</span>
      {/* Partly simulated: the lines that do nothing. */}
      {status !== 'ok' && engineGaps(card).length > 0 && (
        <ul className="hover-gaps small">
          {engineGaps(card).slice(0, 4).map((l, i) => <li key={i}>{l.text}</li>)}
        </ul>
      )}
    </div>
  );
}
