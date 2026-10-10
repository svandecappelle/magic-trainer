import { useEffect, useRef, useState } from 'react';
import { powerOf, toughnessOf, type GameState, type LogEntry, type Permanent, type PlayerId } from '../../lib/engine/engine';
import { isLandCard } from '../../lib/engine/rules';

/** A number floating up from a permanent or a player: damage, life gain, a boost. */
export interface Float {
  id: number;
  /** "perm:<iid>" or "player:<0|1>" */
  anchor: string;
  text: string;
  kind: 'damage' | 'heal' | 'buff' | 'debuff';
}

/** A permanent that just left the battlefield, kept on screen briefly to animate its exit. */
export interface Ghost {
  id: number;
  perm: Permanent;
  /** Position in its row before it left. */
  index: number;
}

export interface Toast {
  id: number;
  entry: LogEntry;
}

export interface BoardFx {
  floats: Float[];
  ghosts: Ghost[];
  toasts: Toast[];
  /** "Your turn" / "X's turn" banner. */
  banner: { id: number; player: PlayerId } | null;
  /** Log entries added by the latest update (to highlight them in the log). */
  freshLog: number;
}

const FLOAT_MS = 1200;
const GHOST_MS = 650;
const TOAST_MS = 3200;
const BANNER_MS = 1400;
const MAX_TOASTS = 3;

let nextId = 1;

/** Entries of `next` that `prev` didn't have. The log is capped, so match on overlap rather than length. */
function newEntries(prev: LogEntry[], next: LogEntry[]): LogEntry[] {
  if (next.length > prev.length) return next.slice(prev.length);
  const a = prev.map((e) => JSON.stringify(e));
  const b = next.map((e) => JSON.stringify(e));
  for (let shift = 0; shift <= a.length; shift++) {
    const overlap = a.length - shift;
    let same = true;
    for (let i = 0; i < overlap && same; i++) same = a[shift + i] === b[i];
    if (same) return next.slice(overlap);
  }
  return next;
}

const rowOf = (s: GameState, perm: Permanent) =>
  s.battlefield.filter((x) => x.controller === perm.controller && isLandCard(x.card) === isLandCard(perm.card));

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Turns game state changes into short-lived visual effects. Compares each new state with the
 * previous one, so it works the same for local and online games.
 */
export function useBoardFx(g: GameState, me: PlayerId): BoardFx {
  const prev = useRef<GameState | null>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<BoardFx['banner']>(null);
  const [freshLog, setFreshLog] = useState(0);

  useEffect(() => {
    const p = prev.current;
    prev.current = g;
    if (!p || p === g) return;
    // Effects clear themselves on a timer, even if more updates arrive in between.
    const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

    // Floating numbers.
    const fl: Float[] = [];
    ([0, 1] as PlayerId[]).forEach((pl) => {
      const diff = g.players[pl].life - p.players[pl].life;
      if (diff) fl.push({ id: nextId++, anchor: `player:${pl}`, text: signed(diff), kind: diff < 0 ? 'damage' : 'heal' });
    });
    for (const now of g.battlefield) {
      const before = p.battlefield.find((x) => x.iid === now.iid);
      if (!before) continue;
      const hurt = now.damage - before.damage;
      if (hurt > 0) fl.push({ id: nextId++, anchor: `perm:${now.iid}`, text: `-${hurt}`, kind: 'damage' });
      const dp = powerOf(now) - powerOf(before);
      const dt = toughnessOf(now) - toughnessOf(before);
      if (dp || dt) {
        fl.push({ id: nextId++, anchor: `perm:${now.iid}`, text: `${signed(dp)}/${signed(dt)}`, kind: dp + dt < 0 ? 'debuff' : 'buff' });
      }
    }
    if (fl.length) {
      setFloats((list) => [...list, ...fl]);
      later(FLOAT_MS, () => setFloats((list) => list.filter((f) => !fl.includes(f))));
    }

    // Permanents that left: fade them out where they stood.
    const gone: Ghost[] = p.battlefield
      .filter((x) => !g.battlefield.some((y) => y.iid === x.iid))
      .map((perm) => ({ id: nextId++, perm, index: rowOf(p, perm).indexOf(perm) }));
    if (gone.length) {
      setGhosts((list) => [...list, ...gone]);
      later(GHOST_MS, () => setGhosts((list) => list.filter((x) => !gone.includes(x))));
    }

    // What just happened, as toasts. Your own plain actions (playing a land, casting, attacking) need no toast.
    const added = newEntries(p.log, g.log);
    setFreshLog(added.length);
    const worth = added.filter((e) => {
      if (e.k === 'turn' || e.k === 'goesFirst' || e.k === 'keep' || e.k === 'mulligan') return false;
      if ((e.k === 'playLand' || e.k === 'cast' || e.k === 'attack') && e.p === me) return false;
      return true;
    });
    if (worth.length) {
      const ts = worth.map((entry) => ({ id: nextId++, entry }));
      setToasts((list) => [...list, ...ts].slice(-MAX_TOASTS));
      later(TOAST_MS, () => setToasts((list) => list.filter((x) => !ts.includes(x))));
    }

    if (g.turn !== p.turn && g.turn > 0) {
      const b = { id: nextId++, player: g.active };
      setBanner(b);
      later(BANNER_MS, () => setBanner((cur) => (cur === b ? null : cur)));
    }
  }, [g, me]);

  return { floats, ghosts, toasts, banner, freshLog };
}
