import { useEffect, useReducer, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { goldfishReducer, initialState, type Instance, type Zone } from '../lib/goldfish';
import { isLand } from '../lib/stats';
import { useApp } from '../store/useApp';
import type { Card } from '../types';

interface ZoneAction {
  label: string;
  title: string;
  to: Zone;
  position?: 'top' | 'bottom';
}

const ACTIONS: Record<Zone, ZoneAction[]> = {
  library: [],
  hand: [
    { label: 'GY', title: 'Discard', to: 'graveyard' },
    { label: 'Ex', title: 'Exile', to: 'exile' },
    { label: 'Top', title: 'Put on top of library', to: 'library', position: 'top' },
  ],
  battlefield: [
    { label: 'Hand', title: 'Return to hand', to: 'hand' },
    { label: 'GY', title: 'To graveyard', to: 'graveyard' },
    { label: 'Ex', title: 'Exile', to: 'exile' },
  ],
  graveyard: [
    { label: 'Hand', title: 'Return to hand', to: 'hand' },
    { label: 'BF', title: 'Return to battlefield', to: 'battlefield' },
    { label: 'Ex', title: 'Exile', to: 'exile' },
  ],
  exile: [
    { label: 'Hand', title: 'Return to hand', to: 'hand' },
    { label: 'BF', title: 'Put onto battlefield', to: 'battlefield' },
  ],
};

export function Goldfish() {
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
        <h1>Goldfish</h1>
        <p>Pick a deck to practice with. Draw opening hands, mulligan, and play turns solo.</p>
        {decks.length === 0 ? (
          <p className="muted">You have no decks yet. <Link to="/decks">Create one</Link>.</p>
        ) : (
          <ul className="plain-list">
            {decks.map((d) => (
              <li key={d.id}><Link to={`/goldfish/${d.id}`}>{d.name}</Link></li>
            ))}
          </ul>
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
      <img src={inst.card.imageSmall ?? inst.card.imageNormal} alt={inst.card.name} title={inst.card.name} onClick={() => onCardClick(zone, inst)} />
      {phase === 'playing' && (
        <div className="game-card-actions">
          {ACTIONS[zone].map((a) => (
            <button key={a.label} title={a.title} onClick={() => dispatch({ type: 'move', iid: inst.iid, to: a.to, position: a.position })}>
              {a.label}
            </button>
          ))}
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
          <input type="checkbox" checked={onThePlay} onChange={(e) => setOnThePlay(e.target.checked)} /> On the play
        </label>
        <button className="secondary" onClick={() => dispatch({ type: 'new', cards: mainCards(), onThePlay })}>New game</button>
        <span className="spacer" />
        <span>Turn <strong>{state.turn || '–'}</strong></span>
        <span className="life-mini">
          <button className="icon" onClick={() => dispatch({ type: 'life', delta: -1 })}>−</button>
          ♥ <strong>{state.life}</strong>
          <button className="icon" onClick={() => dispatch({ type: 'life', delta: 1 })}>+</button>
        </span>
        <span title="Untapped lands">◈ {untappedLands}</span>
        <span>Library <strong>{zones.library.length}</strong></span>
        <button className="secondary" disabled={phase !== 'playing'} onClick={() => dispatch({ type: 'draw' })}>Draw</button>
        <button className="secondary" disabled={phase !== 'playing'} onClick={() => dispatch({ type: 'shuffle' })}>Shuffle</button>
        <button disabled={phase !== 'playing'} onClick={() => dispatch({ type: 'nextTurn' })}>Next turn ▶</button>
      </div>

      {phase === 'mulligan' && (
        <div className="banner">
          Opening hand ({zones.hand.length} cards{state.mulligans ? `, mulligan ${state.mulligans}` : ''}, {zones.hand.filter((c) => isLand(c.card)).length} lands).
          <button onClick={() => dispatch({ type: 'keep' })}>Keep</button>
          <button className="secondary" disabled={state.mulligans >= 6} onClick={() => dispatch({ type: 'mulligan' })}>Mulligan</button>
        </div>
      )}
      {phase === 'bottoming' && (
        <div className="banner">London mulligan: click {state.toBottom} card(s) in your hand to put them on the bottom.</div>
      )}

      <div className="goldfish-layout">
        <div>
          <h4>Battlefield <span className="muted small">(click a card to tap or untap it)</span></h4>
          <div className="zone battlefield">
            <div className="zone-row">{permanents.map((c) => renderCard('battlefield', c))}</div>
            <div className="zone-row">{lands.map((c) => renderCard('battlefield', c))}</div>
          </div>
          <h4>Hand ({zones.hand.length}) <span className="muted small">(click a card to play it)</span></h4>
          <div className="zone hand zone-row">{zones.hand.map((c) => renderCard('hand', c))}</div>
        </div>

        <div className="side-zones">
          <h4>Graveyard ({zones.graveyard.length})</h4>
          <div className="zone small-zone zone-row">{zones.graveyard.map((c) => renderCard('graveyard', c))}</div>
          <h4>Exile ({zones.exile.length})</h4>
          <div className="zone small-zone zone-row">{zones.exile.map((c) => renderCard('exile', c))}</div>
          <h4>Log</h4>
          <ol className="log small">
            {[...state.log].reverse().map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
