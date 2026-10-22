import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Density } from './layout';
import type { Lane } from './stacks';

/** How much room the cards of a row take: their widths, margins (tapped cards) and the gaps between them. */
function cardsWidth(row: HTMLElement): number {
  const kids = [...row.children] as HTMLElement[];
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  return kids.reduce((w, k) => {
    const style = getComputedStyle(k);
    return w + k.offsetWidth + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
  }, 0) + gap * Math.max(0, kids.length - 1);
}

const innerWidth = (row: HTMLElement) => {
  const style = getComputedStyle(row);
  return row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
};

/**
 * The height the lanes of a battlefield need (not its scroll height: the opponents' lanes are aligned to its bottom, so
 * what doesn't fit goes over its top, which doesn't scroll).
 */
function lanesHeight(field: HTMLElement): number {
  const style = getComputedStyle(field);
  const kids = [...field.children] as HTMLElement[];
  const gap = parseFloat(style.rowGap) || 0;
  return kids.reduce((h, k) => h + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1)
    + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
}

/** The lanes don't fit in the height of their battlefield. */
const overflows = (field: HTMLElement | null) => !!field && lanesHeight(field) > field.clientHeight + 1;

/**
 * One lane of a battlefield. Lands and other non-creature permanents become compact chips when the player asks for it,
 * or, by default, when their cards don't fit in one row or their battlefield is too short for all its lanes (measured
 * before the row is painted); creatures stay cards. `count`: the number of stacks in the lane (a change measures the
 * cards again).
 */
export function LaneRow({ lane, density, count, render }: {
  lane: Lane;
  density?: Density;
  count: number;
  render: (compact: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  /** Auto: compact since the cards needed `needed` px across (`tall`: the battlefield that height) for `count` stacks. */
  const [auto, setAuto] = useState<{ needed: number; tall: number; count: number } | null>(null);
  const can = lane !== 'creatures';
  const compact = can && (density === 'compact' || (density === undefined && auto !== null));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const field = el.parentElement;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      if (field) setHeight(field.clientHeight);
    });
    observer.observe(el);
    if (field) observer.observe(field);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !can || density !== undefined) return;
    const field = el.parentElement;
    if (auto === null) {
      const needed = cardsWidth(el);
      if (needed > innerWidth(el) + 1 || overflows(field)) setAuto({ needed, tall: field ? lanesHeight(field) : 0, count });
    } else if (count !== auto.count || (innerWidth(el) >= auto.needed && (field?.clientHeight ?? 0) >= auto.tall)) {
      // Other stacks, or more room: try the cards again.
      setAuto(null);
    }
  }, [can, density, auto, count, width, height]);

  return <div ref={ref} className={`perm-row ${lane}${compact ? ' compact' : ''}`}>{render(compact)}</div>;
}
