import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { botAction, fallbackAction } from '../lib/engine/bot';
import {
  actor, apply, canAttack, canBlock, canPay, findPermanent, IllegalAction, isMainStep, newGame,
  type Action, type GameState, type Permanent, type PlayerId,
} from '../lib/engine/engine';
import { PRESET_DECKS } from '../lib/engine/presets';
import { isCreature, isLandCard, parseEffects, power, targetKind, toughness, type TargetKind } from '../lib/engine/rules';
import { parseDeckText } from '../lib/deckText';
import { resolveDecklist } from '../lib/importDeck';
import { useApp } from '../store/useApp';
import type { Card, Deck } from '../types';

const ME: PlayerId = 0;
const BOT: PlayerId = 1;
const BOT_DELAY_MS = 650;

const presetCache = new Map<string, Card[]>();

async function loadDeckCards(id: string, decks: Deck[]): Promise<Card[]> {
  const preset = PRESET_DECKS.find((p) => p.id === id);
  if (!preset) {
    const deck = decks.find((d) => d.id === id);
    return deck ? deck.entries.filter((e) => e.board === 'main').flatMap((e) => Array(e.qty).fill(e.card)) : [];
  }
  const cached = presetCache.get(id);
  if (cached) return cached;
  const { entries } = await resolveDecklist(parseDeckText(preset.list));
  const cards = entries.filter((e) => e.board === 'main').flatMap((e) => Array(e.qty).fill(e.card));
  presetCache.set(id, cards);
  return cards;
}

export function Play() {
  const decks = useApp((s) => s.decks);
  const [game, setGame] = useState<GameState | null>(null);
  const [myDeck, setMyDeck] = useState(decks[0]?.id ?? 'preset-red');
  const [botDeck, setBotDeck] = useState('preset-green');
  const [first, setFirst] = useState<'random' | 'me' | 'bot'>('random');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Card | null>(null);

  // Selection state for multi-click interactions.
  const [targeting, setTargeting] = useState<{ iid: string; kind: TargetKind } | null>(null);
  const [attackSel, setAttackSel] = useState<string[]>([]);
  const [blockerSel, setBlockerSel] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Record<string, string[]>>({});

  // Reset selections whenever the game moves to another step.
  useEffect(() => {
    setTargeting(null);
    setAttackSel([]);
    setBlockerSel(null);
    setBlocks({});
  }, [game?.step, game?.turn]);

  // The bot acts on a timer so the human can follow what it does.
  useEffect(() => {
    if (!game || actor(game) !== BOT) return;
    const timer = setTimeout(() => {
      setGame((g) => {
        if (!g || actor(g) !== BOT) return g;
        try {
          return apply(g, botAction(g));
        } catch (e) {
          if (!(e instanceof IllegalAction)) throw e;
          return apply(g, fallbackAction(g));
        }
      });
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game]);

  async function start() {
    setLoading(true);
    setError('');
    try {
      const [mine, theirs] = await Promise.all([loadDeckCards(myDeck, decks), loadDeckCards(botDeck, decks)]);
      if (mine.length < 20 || theirs.length < 20) throw new Error('Both decks need at least 20 main-deck cards.');
      const firstPlayer: PlayerId = first === 'me' ? ME : first === 'bot' ? BOT : Math.random() < 0.5 ? ME : BOT;
      setGame(newGame({ decks: [mine, theirs], names: ['You', 'Bot'], first: firstPlayer }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const deckOptions = (
    <>
      {decks.length > 0 && (
        <optgroup label="Your decks">
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </optgroup>
      )}
      <optgroup label="Presets">
        {PRESET_DECKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </optgroup>
    </>
  );

  if (!game) {
    return (
      <div className="page">
        <h1>Play vs Bot</h1>
        <div className="panel setup-panel">
          <label>Your deck <select value={myDeck} onChange={(e) => setMyDeck(e.target.value)}>{deckOptions}</select></label>
          <label>Bot deck <select value={botDeck} onChange={(e) => setBotDeck(e.target.value)}>{deckOptions}</select></label>
          <label>
            Who goes first{' '}
            <select value={first} onChange={(e) => setFirst(e.target.value as typeof first)}>
              <option value="random">Random</option>
              <option value="me">Me</option>
              <option value="bot">Bot</option>
            </select>
          </label>
          <button onClick={start} disabled={loading}>{loading ? 'Loading cards…' : 'Start game'}</button>
          {error && <div className="error small">{error}</div>}
        </div>
        <div className="panel small muted">
          <strong>Simplified rules.</strong> Spells are cast in your main phases only (no instant-speed responses).
          Combat supports flying, reach, haste, vigilance, trample, deathtouch, lifelink, defender, first strike,
          double strike and menace. Instants and sorceries that deal damage, destroy/exile a creature, draw cards or
          gain life are automated; other effects (including creature abilities and triggers) are not simulated yet.
          No mulligans. <Link to="/decks">Build a deck</Link> to bring your own.
        </div>
      </div>
    );
  }

  const g = game;
  const acting = actor(g);
  const myTurn = g.active === ME;
  const iAct = acting === ME;

  function act(action: Action) {
    try {
      setGame(apply(g, action));
      setError('');
    } catch (e) {
      if (e instanceof IllegalAction) setError(e.message);
      else throw e;
    }
  }

  function onHandClick(iid: string, card: Card) {
    if (!iAct || !isMainStep(g)) return;
    if (isLandCard(card)) return act({ type: 'playLand', iid });
    const kind = targetKind(parseEffects(card));
    if (kind) {
      if (!canPay(g, ME, card)) return setError(`Not enough mana for ${card.name}`);
      setTargeting({ iid, kind });
      setError('');
    } else {
      act({ type: 'cast', iid });
    }
  }

  function onPermanentClick(perm: Permanent) {
    if (targeting) {
      if (targeting.kind === 'player') return setError('Choose a player');
      act({ type: 'cast', iid: targeting.iid, target: { kind: 'permanent', iid: perm.iid } });
      return setTargeting(null);
    }
    if (g.step === 'attack' && iAct && perm.controller === ME && canAttack(perm)) {
      setAttackSel((sel) => (sel.includes(perm.iid) ? sel.filter((x) => x !== perm.iid) : [...sel, perm.iid]));
      return;
    }
    if (g.step === 'block' && iAct) {
      if (perm.controller === ME && isCreature(perm.card) && !perm.tapped) {
        const assigned = Object.keys(blocks).find((a) => blocks[a].includes(perm.iid));
        if (assigned) {
          setBlocks((b) => ({ ...b, [assigned]: b[assigned].filter((x) => x !== perm.iid) }));
        } else {
          setBlockerSel(blockerSel === perm.iid ? null : perm.iid);
        }
      } else if (g.attackers.includes(perm.iid) && blockerSel) {
        const blocker = findPermanent(g, blockerSel)!;
        if (!canBlock(blocker, perm)) return setError(`${blocker.card.name} can't block ${perm.card.name}`);
        setBlocks((b) => ({ ...b, [perm.iid]: [...(b[perm.iid] ?? []), blockerSel] }));
        setBlockerSel(null);
        setError('');
      }
    }
  }

  function onPlayerClick(p: PlayerId) {
    if (!targeting) return;
    if (targeting.kind === 'creature') return setError('Choose a creature');
    act({ type: 'cast', iid: targeting.iid, target: { kind: 'player', player: p } });
    setTargeting(null);
  }

  const blockedBy = (iid: string) => Object.entries(blocks).find(([, b]) => b.includes(iid))?.[0];

  const renderPermanent = (perm: Permanent) => {
    const attacking = g.attackers.includes(perm.iid) || attackSel.includes(perm.iid);
    const blocking = blockedBy(perm.iid);
    const selected = blockerSel === perm.iid;
    const targetable = targeting && targeting.kind !== 'player' && isCreature(perm.card);
    const classes = ['perm', perm.tapped && 'tapped', attacking && 'attacking', (blocking || selected) && 'blocking', targetable && 'targetable']
      .filter(Boolean).join(' ');
    return (
      <div key={perm.iid} className={classes} onClick={() => onPermanentClick(perm)} onMouseEnter={() => setPreview(perm.card)}>
        <img src={perm.card.imageSmall ?? perm.card.imageNormal} alt={perm.card.name} />
        {isCreature(perm.card) && (
          <span className={`pt ${perm.damage ? 'hurt' : ''}`}>
            {power(perm.card)}/{toughness(perm.card) - perm.damage}
          </span>
        )}
        {perm.sick && isCreature(perm.card) && <span className="sick" title="Summoning sick">zzz</span>}
        {blocking && <span className="tag">blocks {findPermanent(g, blocking)?.card.name}</span>}
      </div>
    );
  };

  const side = (p: PlayerId) => {
    const perms = g.battlefield.filter((x) => x.controller === p);
    const lands = perms.filter((x) => isLandCard(x.card));
    const others = perms.filter((x) => !isLandCard(x.card));
    const rows = [<div key="o" className="perm-row">{others.map(renderPermanent)}</div>, <div key="l" className="perm-row lands">{lands.map(renderPermanent)}</div>];
    return <div className="play-side">{p === BOT ? rows.reverse() : rows}</div>;
  };

  const player = (p: PlayerId) => {
    const ps = g.players[p];
    const targetable = targeting && targeting.kind !== 'creature';
    return (
      <div className={`player-panel ${g.active === p ? 'active' : ''} ${targetable ? 'targetable' : ''}`} onClick={() => onPlayerClick(p)}>
        <strong>{ps.name}</strong>
        <span className="life-big">♥ {ps.life}</span>
        <span className="small muted">Library {ps.library.length} · Hand {ps.hand.length} · Graveyard {ps.graveyard.length}</span>
      </div>
    );
  };

  let prompt = '';
  let controls: React.ReactNode = null;
  if (g.winner !== null) {
    prompt = g.winner === 'draw' ? 'Draw game.' : g.winner === ME ? 'You win! 🎉' : 'The bot wins.';
    controls = (
      <>
        <button onClick={start}>Rematch</button>
        <button className="secondary" onClick={() => setGame(null)}>Change decks</button>
      </>
    );
  } else if (!iAct) {
    prompt = g.step === 'block' ? 'Bot is choosing blockers…' : 'Bot is thinking…';
  } else if (targeting) {
    prompt = `Choose a target (${targeting.kind === 'any' ? 'creature or player' : targeting.kind}).`;
    controls = <button className="secondary" onClick={() => setTargeting(null)}>Cancel</button>;
  } else if (g.step === 'attack') {
    prompt = 'Declare attackers: click your creatures.';
    controls = (
      <>
        <button onClick={() => act({ type: 'declareAttackers', attackers: attackSel })}>
          {attackSel.length ? `Attack with ${attackSel.length}` : 'No attack'}
        </button>
      </>
    );
  } else if (g.step === 'block') {
    prompt = blockerSel ? 'Now click the attacker to block.' : 'Declare blockers: click one of your creatures, then an attacker.';
    controls = <button onClick={() => act({ type: 'declareBlockers', blocks })}>Confirm blocks</button>;
  } else if (myTurn) {
    prompt = g.step === 'main1' ? 'Main phase: play a land, cast spells.' : 'Second main phase.';
    controls = <button onClick={() => act({ type: 'pass' })}>{g.step === 'main1' ? 'Go to combat ▶' : 'End turn ▶'}</button>;
  }

  return (
    <div className="page play">
      <div className="play-layout">
        <div>
          {player(BOT)}
          <div className="bot-hand">{g.players[BOT].hand.map((c) => <div key={c.iid} className="card-back" />)}</div>
          {side(BOT)}
          <div className="play-bar">
            <span className="small muted">Turn {g.turn} · {g.step === 'main1' ? 'Main 1' : g.step === 'main2' ? 'Main 2' : g.step === 'attack' ? 'Attackers' : 'Blockers'}</span>
            <strong>{prompt}</strong>
            <span className="spacer" />
            {controls}
          </div>
          {side(ME)}
          {player(ME)}
          <div className="my-hand">
            {g.players[ME].hand.map(({ iid, card }) => {
              const playable = iAct && isMainStep(g) && (isLandCard(card) ? !g.players[ME].landPlayed : canPay(g, ME, card));
              return (
                <img
                  key={iid}
                  className={`hand-card ${playable ? 'playable' : ''} ${targeting?.iid === iid ? 'selected' : ''}`}
                  src={card.imageSmall ?? card.imageNormal}
                  alt={card.name}
                  onClick={() => onHandClick(iid, card)}
                  onMouseEnter={() => setPreview(card)}
                />
              );
            })}
          </div>
        </div>

        <aside className="side-column">
          {preview?.imageNormal ? (
            <img className="card-preview" src={preview.imageNormal} alt={preview.name} />
          ) : (
            <div className="card-preview placeholder muted small">Hover a card to preview it</div>
          )}
          {error && <div className="error small play-error">{error}</div>}
          <h4>Log</h4>
          <ol className="log small" reversed>
            {[...g.log].reverse().map((l, i) => <li key={i}>{l}</li>)}
          </ol>
          {g.winner === null && (
            <button className="danger" onClick={() => act({ type: 'concede', player: ME })}>Concede</button>
          )}
        </aside>
      </div>
    </div>
  );
}
