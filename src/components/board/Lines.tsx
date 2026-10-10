import { useEffect, useRef, useState, type RefObject } from 'react';

/** An arrow between two board elements, named by their registry keys ("perm:<iid>", "player:0", "stack:<iid>", "hand:<iid>"). */
export interface Line {
  from: string;
  to: string;
  kind: 'block' | 'attack' | 'target' | 'pending';
}

interface Drawn {
  key: string;
  kind: Line['kind'];
  d: string;
}

interface Props {
  container: RefObject<HTMLElement | null>;
  registry: RefObject<Map<string, HTMLElement>>;
  lines: Line[];
}

/** Where the segment from the center of `a` towards `b` leaves rectangle `a`. */
function edgePoint(a: DOMRect, bx: number, by: number, origin: DOMRect) {
  const cx = a.left + a.width / 2;
  const cy = a.top + a.height / 2;
  const dx = bx - cx;
  const dy = by - cy;
  const t = Math.min(dx ? a.width / 2 / Math.abs(dx) : Infinity, dy ? a.height / 2 / Math.abs(dy) : Infinity, 1);
  return { x: cx + dx * t - origin.left, y: cy + dy * t - origin.top };
}

function path(from: DOMRect, to: DOMRect, origin: DOMRect): string {
  const fc = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const tc = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const s = edgePoint(from, tc.x, tc.y, origin);
  const e = edgePoint(to, fc.x, fc.y, origin);
  // A gentle curve reads better than a straight line when several arrows cross.
  const mx = (s.x + e.x) / 2;
  const my = (s.y + e.y) / 2;
  const len = Math.hypot(e.x - s.x, e.y - s.y);
  const bend = Math.min(40, len / 6);
  const nx = -(e.y - s.y) / (len || 1);
  const ny = (e.x - s.x) / (len || 1);
  return `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${(mx + nx * bend).toFixed(1)},${(my + ny * bend).toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
}

/**
 * Arrows drawn over the board. Positions are read from the DOM every animation frame while
 * there is something to draw, so they follow cards as they tap, attack and move.
 */
export function Lines({ container, registry, lines }: Props) {
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const last = useRef('');
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const active = lines.length > 0;

  useEffect(() => {
    if (!active) {
      last.current = '';
      setDrawn([]);
      return;
    }
    let frame = 0;
    const tick = () => {
      const box = container.current?.getBoundingClientRect();
      if (box) {
        const out: Drawn[] = [];
        for (const l of linesRef.current) {
          const a = registry.current.get(l.from)?.getBoundingClientRect();
          const b = registry.current.get(l.to)?.getBoundingClientRect();
          if (a && b) out.push({ key: `${l.from}>${l.to}`, kind: l.kind, d: path(a, b, box) });
        }
        const sig = out.map((x) => x.key + x.d).join('|');
        if (sig !== last.current) {
          last.current = sig;
          setDrawn(out);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, container, registry]);

  if (!drawn.length) return null;
  return (
    <svg className="board-lines" aria-hidden="true">
      <defs>
        {(['block', 'attack', 'target', 'pending'] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`arrow-${k}`} />
          </marker>
        ))}
      </defs>
      {drawn.map((x) => (
        <path key={x.key} d={x.d} className={`line line-${x.kind}`} markerEnd={`url(#arrow-${x.kind})`} />
      ))}
    </svg>
  );
}
