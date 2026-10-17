import type { KeyboardEvent, PointerEvent } from 'react';

/**
 * A line between two parts of the table that resizes them: drag it (mouse or pen), or focus it and use the arrow
 * keys; double-click puts the size back to its default. `onMove` gets the distance from where the drag started.
 */
export function ResizeHandle({ dir, label, className, onStart, onMove, onReset }: {
  /** `row`: a horizontal line moved up and down; `col`: a vertical line moved left and right. */
  dir: 'row' | 'col';
  label: string;
  className: string;
  onStart: () => void;
  onMove: (delta: number) => void;
  onReset: () => void;
}) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const from = dir === 'row' ? e.clientY : e.clientX;
    onStart();
    const move = (ev: globalThis.PointerEvent) => onMove((dir === 'row' ? ev.clientY : ev.clientX) - from);
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowUp: -10, ArrowLeft: -10, ArrowDown: 10, ArrowRight: 10 }[e.key];
    if (step === undefined) return;
    // The arrows would also pass priority or move other things on the board.
    e.preventDefault();
    e.stopPropagation();
    onStart();
    onMove(step);
  };
  return (
    <div
      className={`resize-handle resize-${dir} ${className}`}
      role="separator"
      aria-orientation={dir === 'row' ? 'horizontal' : 'vertical'}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={(e) => { e.stopPropagation(); onReset(); }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
