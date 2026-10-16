import { useEffect, useReducer, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { goldfishReducer, initialState, type GoldfishLogEntry, type Instance, type Zone } from '../lib/goldfish';
import { countCards, isLand } from '../lib/stats';
import { useApp } from '../store/useApp';
import type { Card } from '../types';
import { Icon } from '../components/Icon';

interface ZoneAction {
  /** Key into t.goldfish.actions: [short label, tooltip]. */
  key: string;
  to: Zone;
  position?: 'top' | 'bottom';
}

const ACTIONS: Record<Zone, ZoneAction[]> = {
  library: [],
  hand: [
    { key: 'gy', to: 'graveyard' },
    { key: 'ex', to: 'exile' },
    { key: 'top', to: 'library', position: 'top' },
  ],
  battlefield: [
    { key: 'hand', to: 'hand' },
    { key: 'gy', to: 'graveyard' },
    { key: 'ex', to: 'exile' },
  ],
  graveyard: [
    { key: 'hand', to: 'hand' },
    { key: 'bf', to: 'battlefield' },
    { key: 'ex', to: 'exile' },
  ],
  exile: [
    { key: 'hand', to: 'hand' },
    { key: 'bf', to: 'battlefield' },
  ],
};

export function Goldfish() {
  const t = useT();
  const show = useCardDisplay();
  const goldfishLogText = (e: GoldfishLogEntry) => {
    const render = t.goldfish.log[e.k] as (entry: GoldfishLogEntry, zone: (z: Zone) => string, card: (n: string) => string) => string;
    return t.goldfish.turnPrefix(e.turn) + render(e, (z) => t.zones[z], show.nameOf);
  };
  const { deckId } = useParams();
  const decks = useApp((s) => s.decks);
  const deck = decks.find((d) => d.id === deckId);
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(goldfishReducer, initialState);
  const [onThePlay, setOnThePlay] = useState(true);

  const mainCards = (): Card[] =>
    deck ? deck.entries.filter((e) => e.board === 'main').flatMap((e) => Array(e.qty).fill(e.card)) : [];

  // Start a game whenever the selected deck changes.
  useEffect(() => {
    if (deck) dispatch({ type: 'new', cards: mainCards(), onThePlay });
  }, [deck?.id]);

  if (!deck) {
    return (
      <div className="page">
        <h1>{t.goldfish.title}</h1>
        <p>{t.goldfish.intro}</p>
        {decks.length === 0 ? (
          <p className="muted">{t.goldfish.noDecks} <Link to="/decks">{t.goldfish.createOne}</Link>.</p>
        ) : (
          <div className="deck-tiles">
            {decks.map((d) => (
              <article key={d.id} className="panel deck-tile">
                <span className="tile-name">{d.name}</span>
                <span className="small muted">{t.home.deckLine(countCards(d.entries.filter((e) => e.board === 'main')), 0)}</span>
                <Link className="button" to={`/goldfish/${d.id}`}>{t.home.goldfish}</Link>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  const { zones, phase } = state;
  const untappedLands = zones.battlefield.filter((c) => !c.tapped && isLand(c.card)).length;

  const onCardClick = (zone: Zone, inst: Instance) => {
    if (zone === 'hand') {
      if (phase === 'bottoming') dispatch({ type: 'bottom', iid: inst.iid });
      else if (phase === 'playing') dispatch({ type: 'move', iid: inst.iid, to: 'battlefield' });
    } else if (zone === 'battlefield') {
      dispatch({ type: 'tap', iid: inst.iid });
    }
  };

  const renderCard = (zone: Zone, inst: Instance) => (
    <div key={inst.iid} className={`game-card ${inst.tapped ? 'tapped' : ''}`}>
      <img src={show.imageSmall(inst.card)} alt={show.name(inst.card)} title={show.name(inst.card)} onClick={() => onCardClick(zone, inst)} />
      {phase === 'playing' && (
        <div className="game-card-actions">
          {ACTIONS[zone].map((a) => {
            const [label, title] = t.goldfish.actions[a.key];
            return (
              <button key={a.key} title={title} onClick={() => dispatch({ type: 'move', iid: inst.iid, to: a.to, position: a.position })}>
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const lands = zones.battlefield.filter((c) => isLand(c.card));
  const permanents = zones.battlefield.filter((c) => !isLand(c.card));

  return (
    <div className="page goldfish">
      <div className="goldfish-bar">
        <select value={deck.id} onChange={(e) => navigate(`/goldfish/${e.target.value}`)}>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="small">
          <input type="checkbox" checked={onThePlay} onChange={(e) => setOnThePlay(e.target.checked)} /> {t.goldfish.onThePlay}
        </label>
        <button className="secondary" onClick={() => dispatch({ type: 'new', cards: mainCards(), onThePlay })}>{t.goldfish.newGame}</button>
        <span className="spacer" />
        <span>{t.common.turn} <strong>{state.turn || '–'}</strong></span>
        <span className="life-mini">
          <button className="icon" onClick={() => dispatch({ type: 'life', delta: -1 })}>−</button>
          <Icon name="heart" /> <strong>{state.life}</strong>
          <button className="icon" onClick={() => dispatch({ type: 'life', delta: 1 })}>+</button>
        </span>
        <span title={t.goldfish.untapped}>◈ {untappedLands}</span>
        <span>{t.goldfish.library} <strong>{zones.library.length}</strong></span>
        <button className="secondary" disabled={phase !== 'playing'} onClick={() => dispatch({ type: 'draw' })}>{t.goldfish.draw}</button>
        <button className="secondary" disabled={phase !== 'playing'} onClick={() => dispatch({ type: 'shuffle' })}>{t.goldfish.shuffle}</button>
        <button disabled={phase !== 'playing'} onClick={() => dispatch({ type: 'nextTurn' })}>{t.goldfish.nextTurn}</button>
      </div>

      {phase === 'mulligan' && (
        <div className="banner">
          {t.goldfish.opening(zones.hand.length, state.mulligans, zones.hand.filter((c) => isLand(c.card)).length)}
          <button onClick={() => dispatch({ type: 'keep' })}>{t.common.keep}</button>
          <button className="secondary" disabled={state.mulligans >= 6} onClick={() => dispatch({ type: 'mulligan' })}>{t.common.mulligan}</button>
        </div>
      )}
      {phase === 'bottoming' && (
        <div className="banner">{t.goldfish.bottoming(state.toBottom)}</div>
      )}

      <div className="goldfish-layout">
        <div>
          <h4>{t.goldfish.battlefield} <span className="muted small">{t.goldfish.battlefieldHint}</span></h4>
          <div className="zone battlefield">
            <div className="zone-row">{permanents.map((c) => renderCard('battlefield', c))}</div>
            <div className="zone-row">{lands.map((c) => renderCard('battlefield', c))}</div>
          </div>
          <h4>{t.goldfish.hand(zones.hand.length)} <span className="muted small">{t.goldfish.handHint}</span></h4>
          <div className="zone hand zone-row">{zones.hand.map((c) => renderCard('hand', c))}</div>
        </div>

        <div className="side-zones">
          <h4>{t.goldfish.graveyard(zones.graveyard.length)}</h4>
          <div className="zone small-zone zone-row">{zones.graveyard.map((c) => renderCard('graveyard', c))}</div>
          <h4>{t.goldfish.exile(zones.exile.length)}</h4>
          <div className="zone small-zone zone-row">{zones.exile.map((c) => renderCard('exile', c))}</div>
          <h4>{t.common.log}</h4>
          <ol className="log small">
            {[...state.log].reverse().map((l, i) => <li key={i}>{goldfishLogText(l)}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
