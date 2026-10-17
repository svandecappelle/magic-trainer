import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GameBoard } from './GameBoard';
import type { PlayerId } from '../lib/engine/engine';
import { downloadReplay, replayStates, type ReplayFile } from '../lib/replay';
import { useT } from '../i18n';

/** Steps per second when playing the replay on its own. */
const SPEEDS = [1, 2, 4, 8];

/** A replay on the game table: step through it, play it, see it from any seat. */
export function ReplayViewer({ file }: { file: ReplayFile }) {
  const t = useT();
  const { states, diverged } = useMemo(() => replayStates(file), [file]);
  const last = states.length - 1;
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [seat, setSeat] = useState<PlayerId>(Math.min(file.me, states[0].players.length - 1) as PlayerId);
  const game = states[Math.min(at, last)];
  /** Where each turn starts (the step after the mulligans for turn 1). */
  const turnStarts = useMemo(() => states.map((s, i) => (i > 0 && s.turn !== states[i - 1].turn ? i : -1)).filter((i) => i >= 0), [states]);

  useEffect(() => {
    if (!playing) return;
    if (at >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setAt((i) => Math.min(last, i + 1)), 1000 / speed);
    return () => clearTimeout(timer);
  }, [playing, at, last, speed]);

  const go = (i: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(last, i)));
  };
  const prevTurn = () => go([...turnStarts].reverse().find((i) => i < at) ?? 0);
  const nextTurn = () => go(turnStarts.find((i) => i > at) ?? last);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === 'PageDown') nextTurn();
      else if (e.key === 'PageUp') prevTurn();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const names = game.players.map((p, i) => p.name || (i === file.me ? t.game.you : `#${i + 1}`));
  const controls = (
    <div className="replay-controls">
      <strong className="replay-title">{file.title}</strong>
      <span className="small muted">{new Date(file.at).toLocaleString()}</span>
      <div className="replay-buttons" role="group" aria-label={t.history.replay}>
        <button type="button" className="icon" title={t.history.prevTurn} onClick={prevTurn}>⏮</button>
        <button type="button" className="icon" title={t.history.prevStep} onClick={() => go(at - 1)}>◀</button>
        <button type="button" className="icon" title={playing ? t.history.pause : t.history.play} onClick={() => (at >= last ? (setAt(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="icon" title={t.history.nextStep} onClick={() => go(at + 1)}>▶|</button>
        <button type="button" className="icon" title={t.history.nextTurn} onClick={nextTurn}>⏭</button>
        <select aria-label={t.history.speed} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
        </select>
      </div>
      <input type="range" className="replay-slider" min={0} max={last} value={at} aria-label={t.history.position} onChange={(e) => go(Number(e.target.value))} />
      <span className="small muted">{t.history.stepOf(at, last, game.turn)}</span>
      <label className="small">
        {t.history.seenBy}{' '}
        <select value={seat} onChange={(e) => setSeat(Number(e.target.value) as PlayerId)}>
          {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
        </select>
      </label>
      {diverged && <div className="error small">{t.history.diverged}</div>}
      <div className="row replay-links">
        <button type="button" className="secondary" onClick={() => downloadReplay(file)}>{t.history.download}</button>
        <Link to="/history" className="button secondary">{t.history.back}</Link>
      </div>
    </div>
  );

  return (
    <div className="page play">
      <GameBoard game={game} me={seat} readOnly={seat === file.me ? 'replay' : 'spectator'} onAction={() => {}} notice={controls} />
    </div>
  );
}
