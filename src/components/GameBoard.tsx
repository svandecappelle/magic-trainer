import { useEffect, useState, type ReactNode } from 'react';
import {
  actor, apply, canAttack, canBlock, canPay, findPermanent, IllegalAction, isMainStep, opponent,
  type Action, type GameState, type Permanent, type PlayerId,
} from '../lib/engine/engine';
import { isCreature, isLandCard, parseEffects, power, targetKind, toughness, type TargetKind } from '../lib/engine/rules';
import type { Card } from '../types';

interface Props {
  game: GameState;
  /** The seat this browser plays. */
  me: PlayerId;
  /** Receives actions that already passed the rules check against `game`. */
  onAction: (action: Action) => void;
  /** Buttons shown once the game is over (rematch, leave…). */
  endControls?: ReactNode;
  /** Extra status line, e.g. a server error or a disconnected opponent. */
  notice?: ReactNode;
}

/** The two-player game table, shared by Play vs Bot and online multiplayer. */
export function GameBoard({ game: g, me, onAction, endControls, notice }: Props) {
  const opp = opponent(me);
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
  }, [g.step, g.turn]);

  const acting = actor(g);
  const iAct = acting === me;

  function act(action: Action) {
    try {
      apply(g, action); // validate locally for instant feedback
      setError('');
      onAction(action);
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
      if (!canPay(g, me, card)) return setError(`Not enough mana for ${card.name}`);
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
    if (g.step === 'attack' && iAct && perm.controller === me && canAttack(perm)) {
      setAttackSel((sel) => (sel.includes(perm.iid) ? sel.filter((x) => x !== perm.iid) : [...sel, perm.iid]));
      return;
    }
    if (g.step === 'block' && iAct) {
      if (perm.controller === me && isCreature(perm.card) && !perm.tapped) {
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
    return <div className="play-side">{p === opp ? rows.reverse() : rows}</div>;
  };

  const player = (p: PlayerId) => {
    const ps = g.players[p];
    const targetable = targeting && targeting.kind !== 'creature';
    return (
      <div className={`player-panel ${g.active === p ? 'active' : ''} ${targetable ? 'targetable' : ''}`} onClick={() => onPlayerClick(p)}>
        <strong>{ps.name}{p === me && ps.name !== 'You' ? ' (you)' : ''}</strong>
        <span className="life-big">♥ {ps.life}</span>
        <span className="small muted">Library {ps.library.length} · Hand {ps.hand.length} · Graveyard {ps.graveyard.length}</span>
      </div>
    );
  };

  const oppName = g.players[opp].name;
  let prompt = '';
  let controls: ReactNode = null;
  if (g.winner !== null) {
    prompt = g.winner === 'draw' ? 'Draw game.' : g.winner === me ? 'You win! 🎉' : `${oppName} wins.`;
    controls = endControls;
  } else if (!iAct) {
    prompt = g.step === 'block' ? `${oppName} is choosing blockers…` : `${oppName} is thinking…`;
  } else if (targeting) {
    prompt = `Choose a target (${targeting.kind === 'any' ? 'creature or player' : targeting.kind}).`;
    controls = <button className="secondary" onClick={() => setTargeting(null)}>Cancel</button>;
  } else if (g.step === 'attack') {
    prompt = 'Declare attackers: click your creatures.';
    controls = (
      <button onClick={() => act({ type: 'declareAttackers', attackers: attackSel })}>
        {attackSel.length ? `Attack with ${attackSel.length}` : 'No attack'}
      </button>
    );
  } else if (g.step === 'block') {
    prompt = blockerSel ? 'Now click the attacker to block.' : 'Declare blockers: click one of your creatures, then an attacker.';
    controls = <button onClick={() => act({ type: 'declareBlockers', blocks })}>Confirm blocks</button>;
  } else {
    prompt = g.step === 'main1' ? 'Main phase: play a land, cast spells.' : 'Second main phase.';
    controls = <button onClick={() => act({ type: 'pass' })}>{g.step === 'main1' ? 'Go to combat ▶' : 'End turn ▶'}</button>;
  }

  return (
    <div className="play-layout">
      <div>
        {player(opp)}
        <div className="bot-hand">{g.players[opp].hand.map((c) => <div key={c.iid} className="card-back" />)}</div>
        {side(opp)}
        <div className="play-bar">
          <span className="small muted">Turn {g.turn} · {g.step === 'main1' ? 'Main 1' : g.step === 'main2' ? 'Main 2' : g.step === 'attack' ? 'Attackers' : 'Blockers'}</span>
          <strong>{prompt}</strong>
          <span className="spacer" />
          {controls}
        </div>
        {side(me)}
        {player(me)}
        <div className="my-hand">
          {g.players[me].hand.map(({ iid, card }) => {
            const playable = iAct && isMainStep(g) && (isLandCard(card) ? !g.players[me].landPlayed : canPay(g, me, card));
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
        {notice && <div className="small play-notice">{notice}</div>}
        {error && <div className="error small play-error">{error}</div>}
        <h4>Log</h4>
        <ol className="log small" reversed>
          {[...g.log].reverse().map((l, i) => <li key={i}>{l}</li>)}
        </ol>
        {g.winner === null && (
          <button className="danger" onClick={() => act({ type: 'concede', player: me })}>Concede</button>
        )}
      </aside>
    </div>
  );
}
