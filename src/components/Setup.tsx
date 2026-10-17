import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { deckBand, deckSummary, Pips, presetColors } from './DeckBits';
import { DeckOptions } from './DeckOptions';
import { PRESET_DECKS } from '../lib/engine/presets';
import type { Deck } from '../types';
import { issueText, useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { loadDeck75 } from '../lib/loadDeck';
import {
  canTwoHead, cleanSetup, CONSTRUCTED_FORMATS, deckProblems, SETUP_MODES, startingLifeOf, type DeckCards, type GameSetup,
} from '../lib/gameModes';
import { useApp } from '../store/useApp';

/** The pieces of the game setup pages (Play vs Bot, Play Online). */

/** The name of a deck or a preset deck, by id (in the current language for presets). */
export function useDeckName(): (id: string) => string {
  const t = useT();
  const decks = useApp((s) => s.decks);
  return (id) => {
    const preset = PRESET_DECKS.find((p) => p.id === id);
    return decks.find((d) => d.id === id)?.name ?? (preset ? (t.presets[preset.id] ?? preset.name) : id);
  };
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

// ---------- Game mode ----------

const SETUP_KEY = 'mt.gameSetup';

/** The game mode chosen, remembered in this browser for the next game. */
export function useGameSetup(): [GameSetup, (s: GameSetup) => void] {
  const [setup, set] = useState<GameSetup>(() => {
    try {
      return cleanSetup(JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null'));
    } catch {
      return cleanSetup(null);
    }
  });
  const change = (s: GameSetup) => {
    const clean = cleanSetup(s);
    set(clean);
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(clean));
    } catch {
      // not essential
    }
  };
  return [setup, change];
}

/** "Constructed · Modern", "Duel Commander": a setup's name. */
export function setupName(t: ReturnType<typeof useT>, s: GameSetup): string {
  return s.mode === 'constructed' ? `${t.modes.constructed.title} · ${t.formats[s.format] ?? s.format}` : t.modes[s.mode].title;
}

const CHEVRON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;

/**
 * The game modes as a list (title, one line), and the chosen one in detail: its rules, its format (Constructed),
 * Duel or Two-Headed Giant. `children`: the other options (best of 3, who starts…), shown in the detail.
 */
export function ModePicker({ setup, onChange, children }: { setup: GameSetup; onChange: (s: GameSetup) => void; children?: ReactNode }) {
  const t = useT();
  const m = t.modes[setup.mode];
  const life = startingLifeOf(setup);
  const rules: [string, string][] = [
    [t.modes.life, setup.twoHeaded ? t.modes.teamLife(life) : String(life)],
    ...m.rules.map(([k, v]): [string, string] => [k, v.replace('{format}', t.formats[setup.format] ?? setup.format)]),
  ];
  return (
    <section className="mode-picker">
      <div>
        <h4>{t.modes.title}</h4>
        <div className="mode-list" role="radiogroup" aria-label={t.modes.title}>
          {SETUP_MODES.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={id === setup.mode} className="mode-row" onClick={() => onChange({ ...setup, mode: id })}>
              <b>{t.modes[id].title}</b>
              <span>{t.modes[id].line}</span>
              {CHEVRON}
            </button>
          ))}
        </div>
      </div>
      <div className="mode-detail panel" aria-live="polite">
        <div>
          <h2>{m.title}</h2>
          <p className="muted">{m.text}</p>
        </div>
        <div className="mode-rules">
          {rules.map(([k, v]) => (
            <div key={k} className="mode-rule"><small>{k}</small><strong>{v}</strong></div>
          ))}
        </div>
        <div className="setup-options">
          {setup.mode === 'constructed' && (
            <Segmented label={t.modes.format} value={setup.format} options={CONSTRUCTED_FORMATS.map((f) => [f, t.formats[f] ?? f])} onChange={(format) => onChange({ ...setup, format })} />
          )}
          {canTwoHead(setup.mode) && (
            <Segmented label={t.modes.players} value={setup.twoHeaded ? 'two' : 'duel'} options={[['duel', t.modes.duel], ['two', t.modes.twoHeaded]]} onChange={(v) => onChange({ ...setup, twoHeaded: v === 'two' })} />
          )}
          {children}
        </div>
      </div>
    </section>
  );
}

export type DeckCheck =
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'unchecked' }
  | { status: 'warn'; lines: string[] }
  | { status: 'block'; lines: string[] };

/** Can this deck be played in this mode? Loads the deck's cards (presets come from Scryfall). */
export function useDeckCheck(deckId: string, setup: GameSetup): DeckCheck {
  const t = useT();
  const show = useCardDisplay();
  const decks = useApp((s) => s.decks);
  const [cards, setCards] = useState<{ id: string; cards: DeckCards | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadDeck75(deckId, decks).then(
      (d) => live && setCards({ id: deckId, cards: d }),
      () => live && setCards({ id: deckId, cards: null }),
    );
    return () => {
      live = false;
    };
  }, [deckId, decks]);
  // Free Play takes any deck: nothing to wait for.
  if (setup.mode === 'free') return { status: 'ok' };
  if (!cards || cards.id !== deckId) return { status: 'loading' };
  if (!cards.cards) return { status: 'unchecked' };
  const { blocking, warnings } = deckProblems(cards.cards, setup);
  const text = (list: typeof blocking) => list.map((i) => issueText(t, i, show.nameOf));
  if (blocking.length) return { status: 'block', lines: text(blocking) };
  if (warnings.length) return { status: 'warn', lines: text(warnings) };
  return { status: 'ok' };
}

/** A deck check, under its deck picker. */
export function DeckCheckLine({ check, setup }: { check: DeckCheck; setup: GameSetup }) {
  const t = useT();
  if (check.status === 'loading') return <span className="deck-check small muted">{t.modes.checking}</span>;
  if (check.status === 'unchecked') return <span className="deck-check small muted">{t.modes.unchecked}</span>;
  if (check.status === 'ok') {
    return <span className="deck-check small ok">✓ {setup.mode === 'free' ? t.modes.anyDeck : t.modes.legalIn(setupName(t, setup))}</span>;
  }
  const [first, ...rest] = check.lines;
  return (
    <span className={`deck-check small ${check.status}`} title={check.lines.join('\n')}>
      {check.status === 'block' ? '✕' : '⚠'} {check.status === 'block' ? t.modes.notLegal(setupName(t, setup), first) : first}
      {rest.length > 0 && <span className="muted"> {t.modes.more(rest.length)}</span>}
    </span>
  );
}

/** A deck picker with its check for the game mode; `onBlocked`: whether the deck can't be played in it. */
export function CheckedDeckPicker({ label, value, onChange, setup, onBlocked }: {
  label: string; value: string; onChange: (id: string) => void; setup: GameSetup; onBlocked: (blocked: boolean) => void;
}) {
  const check = useDeckCheck(value, setup);
  const blocked = check.status === 'block';
  useEffect(() => {
    onBlocked(blocked);
    return () => onBlocked(false);
  }, [blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="checked-deck">
      <DeckPicker label={label} value={value} onChange={onChange} />
      <DeckCheckLine check={check} setup={setup} />
    </div>
  );
}

/** The decks of a setup page that can't be played in the mode, by role ("mine", "bot"…). */
export function useBlockedDecks() {
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const report = (role: string) => (b: boolean) => setBlocked((x) => (x[role] === b ? x : { ...x, [role]: b }));
  return { any: Object.values(blocked).some(Boolean), report };
}
