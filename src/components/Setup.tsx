import { Link } from 'react-router-dom';
import { deckBand, deckSummary, Pips, presetColors } from './DeckBits';
import { DeckOptions } from './DeckOptions';
import { PRESET_DECKS } from '../lib/engine/presets';
import type { Deck } from '../types';
import { useT } from '../i18n';
import { useApp } from '../store/useApp';

/** The pieces of the game setup pages (Play vs Bot, Play Online). */

const MODE_ICONS = {
  duel: 'M6 22L20 8M8 6l14 14M5 18l5 5M18 5l5 5',
  twoHeaded: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 24c0-4 3-7 7-7s7 3 7 7M14 24c0-4 2-7 5-7s7 3 7 7',
  commander: 'M4 21h20M6 21l-2-11 6 4 4-7 4 7 6-4-2 11',
};

/** The name of a deck or a preset deck, by id (in the current language for presets). */
export function useDeckName(): (id: string) => string {
  const t = useT();
  const decks = useApp((s) => s.decks);
  return (id) => {
    const preset = PRESET_DECKS.find((p) => p.id === id);
    return decks.find((d) => d.id === id)?.name ?? (preset ? (t.presets[preset.id] ?? preset.name) : id);
  };
}

/** A game mode as a tile: duel or Two-Headed Giant (one of them), Commander rules (on or off, with either). */
export function ModeTile({ mode, text: [title, text], on, onClick }: { mode: keyof typeof MODE_ICONS; text: [string, string]; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`mode-tile ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path d={MODE_ICONS[mode]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="mode-title">{title}</span>
      <span className="small muted">{text}</span>
    </button>
  );
}

/** A deck as a tile (color band, name, what the engine simulates, colors); the select over it picks another one. */
export function DeckPicker({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const t = useT();
  const decks = useApp((s) => s.decks);
  const deck = decks.find((d) => d.id === value);
  const summary = deck ? deckSummary(deck) : null;
  const colors = summary ? summary.colors : presetColors(value);
  const preset = PRESET_DECKS.find((p) => p.id === value);
  const name = deck?.name ?? (preset ? (t.presets[preset.id] ?? preset.name) : value);
  const line = summary
    ? `${t.formats[deck!.format as keyof typeof t.formats] ?? deck!.format} · ${t.home.simulated(summary.simulated, summary.total)}`
    : t.play.preset;
  return (
    <label className="deck-picker">
      <h4>{label}</h4>
      <span className="deck-picker-card">
        <span className="deck-band" style={{ background: deckBand(colors) }} />
        <span className="deck-picker-text">
          <span className="deck-picker-name">{name}</span>
          <span className={`small ${summary && summary.simulated === summary.total ? 'ok' : 'muted'}`}>{line}</span>
        </span>
        <Pips colors={colors} />
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M5 7l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          <DeckOptions decks={decks} />
        </select>
      </span>
    </label>
  );
}

/** A choice between a few options, as a row of toggle buttons. */
export function Segmented<V extends string | number>({ label, value, options, onChange }: { label: string; value: V; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <div className="segmented-field">
      <h4 id={`seg-${label}`}>{label}</h4>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A Commander duel's starting life: 40 (the official rules) or 20 (the Duel Commander format). */
export function LifeChoice({ value, onChange }: { value: 40 | 20; onChange: (v: 40 | 20) => void }) {
  const t = useT();
  return <Segmented label={t.play.commanderLife} value={value} options={[[40, t.play.lifeOfficial], [20, t.play.lifeDuel]]} onChange={onChange} />;
}

/** What the rules engine plays, with links to the chosen deck in the editor and to the decks. */
export function EngineSummary({ deck }: { deck?: Deck }) {
  const t = useT();
  return (
    <section className="panel engine-summary">
      <div>
        <strong>{t.play.engineTitle}</strong>
        <p className="small muted">{t.play.rules}</p>
      </div>
      <div className="engine-links">
        {deck && <Link to={`/decks/${deck.id}`}>{t.play.deckInEngine} →</Link>}
        <Link to="/decks">{t.play.buildDeck} →</Link>
      </div>
    </section>
  );
}
