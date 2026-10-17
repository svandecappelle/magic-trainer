import { useCallback, useState } from 'react';

/**
 * The board layout chosen by the player (drag handles, Settings sliders), kept in this browser. A size left out
 * follows the window, as the stylesheet decides.
 */
export interface BoardLayout {
  /** Width of the side panel (log, card, settings), in px. */
  side?: number;
  /** The side panel is folded into a thin rail. */
  closed?: boolean;
  /** Share of the battlefields' height given to the opponents, in %. */
  opp?: number;
  /** Width of a permanent other than a land on the battlefields, in px. */
  perm?: number;
  /** Width of a land on the battlefields, in px; left out, 70 % of the other permanents. */
  land?: number;
  /** Width of a card in your hand, in px. */
  hand?: number;
}

export type LayoutSize = 'side' | 'opp' | 'perm' | 'land' | 'hand';

export const LAYOUT_LIMITS: Record<LayoutSize, [number, number]> = { side: [240, 520], opp: [25, 75], perm: [40, 130], land: [28, 110], hand: [50, 150] };
export const LAYOUT_DEFAULTS = { side: 320, opp: 50 };

export const clampSize = (k: LayoutSize, v: number) => Math.round(Math.min(LAYOUT_LIMITS[k][1], Math.max(LAYOUT_LIMITS[k][0], v)));

const KEY = 'mt.boardLayout';

/** The saved layout, keeping only valid values (an older or hand-edited one may hold anything). */
export function readLayout(raw: string | null): BoardLayout {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: BoardLayout = {};
  for (const k of Object.keys(LAYOUT_LIMITS) as LayoutSize[]) {
    if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = clampSize(k, o[k] as number);
  }
  if (o.closed === true) out.closed = true;
  return out;
}

const load = (): BoardLayout => {
  try {
    return readLayout(localStorage.getItem(KEY));
  } catch {
    return {};
  }
};

/** The layout, a setter that merges and saves (`undefined` puts a size back to its default), and a reset. */
export function useBoardLayout() {
  const [layout, setLayout] = useState(load);
  const save = (next: BoardLayout) => {
    try {
      if (Object.keys(next).length) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {
      // private mode: the layout lasts for this page only
    }
  };
  const update = useCallback((patch: BoardLayout) => {
    setLayout((l) => {
      const next: BoardLayout = { ...l, ...patch };
      for (const k of Object.keys(next) as (keyof BoardLayout)[]) if (next[k] === undefined || next[k] === false) delete next[k];
      save(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    save({});
    setLayout({});
  }, []);
  return { layout, update, reset };
}

/** The CSS variables that apply the layout to the table (`.game`). */
export function layoutStyle(l: BoardLayout): Record<string, string> {
  const opp = l.opp ?? LAYOUT_DEFAULTS.opp;
  return {
    '--side-w': `${l.side ?? LAYOUT_DEFAULTS.side}px`,
    '--opp-fr': `${opp}fr`,
    '--you-fr': `${100 - opp}fr`,
    ...(l.perm ? { '--perm-w': `${l.perm}px` } : {}),
    ...(l.land ? { '--land-w': `${l.land}px` } : {}),
    ...(l.hand ? { '--hand-w': `${l.hand}px` } : {}),
  };
}
