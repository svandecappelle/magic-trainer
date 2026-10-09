import { useEffect, useState, type ReactNode } from 'react';
import {
  actor, apply, canAttack, canBlock, canCastNow, findPermanent, hasUsefulTarget, IllegalAction, isMainStep, opponent, powerOf, toughnessOf,
  type Action, type GameState, type Permanent, type PlayerId, type WindowReason,
} from '../lib/engine/engine';
import { isCreature, isLandCard, parseEffects, targetKind, type TargetKind } from '../lib/engine/rules';
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

const STEP_LABELS: Record<GameState['step'], string> = {
  mulligan: 'Mulligans', main1: 'Main 1', attack: 'Attackers', block: 'Blockers', main2: 'Main 2',
};

const WINDOW_PROMPTS: Record<WindowReason, (myTurn: boolean) => string> = {
  main: () => 'Cast an instant, or pass.',
  attack: (myTurn) => (myTurn ? 'Attackers declared. Cast an instant, or pass.' : 'You are being attacked. Cast an instant before blocks, or pass.'),
  block: () => 'Blockers declared. Cast a combat trick, or pass to deal damage.',
  end: (myTurn) => (myTurn ? 'End of your turn. Cast an instant, or pass.' : 'End of the opponent\'s turn. Cast an instant, or pass.'),
};

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
  const [bottomSel, setBottomSel] = useState<string[]>([]);

  // Reset selections whenever the game moves on.
  useEffect(() => {
    setTargeting(null);
    setAttackSel([]);
    setBlockerSel(null);
    setBlocks({});
    setBottomSel([]);
  }, [g.step, g.turn, g.priority?.player, g.stack.length, g.mulligan?.player, g.mulligan?.count[me]]);

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
    if (!iAct) return;
    if (g.mulligan) {
      setBottomSel((sel) => (sel.includes(iid) ? sel.filter((x) => x !== iid) : [...sel, iid]));
      return;
    }
    if (isLandCard(card)) return act({ type: 'playLand', iid });
    const kind = targetKind(parseEffects(card));
    if (kind) {
      if (!canCastNow(g, me, card)) {
        return setError(g.priority ? `${card.name} can't be cast right now` : `Not enough mana for ${card.name}`);
      }
      if (!hasUsefulTarget(g, me, card)) return setError(`${card.name} has nothing to target right now`);
      setTargeting({ iid, kind });
      setError('');
    } else {
      act({ type: 'cast', iid });
    }
  }

  function onPermanentClick(perm: Permanent) {
    if (targeting) {
      if (targeting.kind === 'player' || targeting.kind === 'spell') return setError(`Choose a ${targeting.kind}`);
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
    if (targeting.kind === 'creature' || targeting.kind === 'spell') return setError(`Choose a ${targeting.kind}`);
    act({ type: 'cast', iid: targeting.iid, target: { kind: 'player', player: p } });
    setTargeting(null);
  }

  const blockedBy = (iid: string) => Object.entries(blocks).find(([, b]) => b.includes(iid))?.[0];

  const renderPermanent = (perm: Permanent) => {
    const attacking = g.attackers.includes(perm.iid) || attackSel.includes(perm.iid);
    const blocking = blockedBy(perm.iid);
    const selected = blockerSel === perm.iid;
    const targetable = targeting && (targeting.kind === 'any' || targeting.kind === 'creature') && isCreature(perm.card);
    const classes = ['perm', perm.tapped && 'tapped', attacking && 'attacking', (blocking || selected) && 'blocking', targetable && 'targetable']
      .filter(Boolean).join(' ');
    return (
      <div key={perm.iid} className={classes} onClick={() => onPermanentClick(perm)} onMouseEnter={() => setPreview(perm.card)}>
        <img src={perm.card.imageSmall ?? perm.card.imageNormal} alt={perm.card.name} />
        {isCreature(perm.card) && (
          <span className={`pt ${perm.damage ? 'hurt' : ''} ${perm.pumpPower || perm.pumpToughness ? 'pumped' : ''}`}>
            {powerOf(perm)}/{toughnessOf(perm) - perm.damage}
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
    const targetable = targeting && (targeting.kind === 'any' || targeting.kind === 'player');
    return (
      <div className={`player-panel ${g.active === p ? 'active' : ''} ${targetable ? 'targetable' : ''}`} onClick={() => onPlayerClick(p)}>
        <strong>{ps.name}{p === me && ps.name !== 'You' ? ' (you)' : ''}</strong>
        <span className="life-big">♥ {ps.life}</span>
        <span className="small muted">Library {ps.library.length} · Hand {ps.hand.length} · Graveyard {ps.graveyard.length}</span>
      </div>
    );
  };

  const oppName = g.players[opp].name;
  const top = g.stack.at(-1);
  let prompt = '';
  let controls: ReactNode = null;
  if (g.winner !== null) {
    prompt = g.winner === 'draw' ? 'Draw game.' : g.winner === me ? 'You win! 🎉' : `${oppName} wins.`;
    controls = endControls;
  } else if (g.mulligan) {
    const need = Math.min(g.mulligan.count[me], g.players[me].hand.length);
    if (!iAct) {
      prompt = g.mulligan.kept[me] ? `${oppName} is deciding on a mulligan…` : `${oppName} decides first…`;
    } else if (need > 0) {
      prompt = `Mulligan ${g.mulligan.count[me]}: click ${need} card(s) to put on the bottom (${bottomSel.length}/${need}), or mulligan again.`;
      controls = (
        <>
          <button disabled={bottomSel.length !== need} onClick={() => act({ type: 'keep', bottom: bottomSel })}>Keep</button>
          <button className="secondary" onClick={() => act({ type: 'mulligan' })}>Mulligan</button>
        </>
      );
    } else {
      const lands = g.players[me].hand.filter((c) => isLandCard(c.card)).length;
      prompt = `Opening hand: ${lands} land(s). Keep or mulligan?`;
      controls = (
        <>
          <button onClick={() => act({ type: 'keep', bottom: [] })}>Keep</button>
          <button className="secondary" onClick={() => act({ type: 'mulligan' })}>Mulligan</button>
        </>
      );
    }
  } else if (!iAct) {
    prompt = g.priority ? `${oppName} may respond…` : g.step === 'block' ? `${oppName} is choosing blockers…` : `${oppName} is thinking…`;
  } else if (targeting) {
    prompt = `Choose a target (${targeting.kind === 'any' ? 'creature or player' : targeting.kind === 'spell' ? 'a spell on the stack' : targeting.kind}).`;
    controls = <button className="secondary" onClick={() => setTargeting(null)}>Cancel</button>;
  } else if (g.priority) {
    prompt = top
      ? `${g.players[top.controller].name === 'You' ? 'Your' : `${g.players[top.controller].name}'s`} ${top.card.name} is on the stack. Respond with an instant, or pass.`
      : WINDOW_PROMPTS[g.priority.reason](g.active === me);
    controls = <button onClick={() => act({ type: 'pass' })}>{top ? 'Pass (let it resolve)' : 'Pass'}</button>;
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
          <span className="small muted">{g.mulligan ? 'Mulligans' : `Turn ${g.turn} · ${STEP_LABELS[g.step]}`}</span>
          <strong>{prompt}</strong>
          <span className="spacer" />
          {controls}
        </div>
        {g.stack.length > 0 && (
          <div className="stack">
            <span className="small muted">Stack (top first)</span>
            {[...g.stack].reverse().map((item) => (
              <div
                key={item.iid}
                className={`stack-item ${targeting?.kind === 'spell' ? 'targetable' : ''}`}
                onMouseEnter={() => setPreview(item.card)}
                onClick={() => {
                  if (targeting?.kind !== 'spell') return;
                  act({ type: 'cast', iid: targeting.iid, target: { kind: 'spell', iid: item.iid } });
                  setTargeting(null);
                }}
              >
                <img src={item.card.imageSmall ?? item.card.imageNormal} alt={item.card.name} />
                <span className="small">{g.players[item.controller].name}</span>
              </div>
            ))}
          </div>
        )}
        {side(me)}
        {player(me)}
        <div className="my-hand">
          {g.players[me].hand.map(({ iid, card }) => {
            const playable = isLandCard(card)
              ? iAct && !g.priority && !g.mulligan && isMainStep(g) && g.active === me && !g.players[me].landPlayed
              : canCastNow(g, me, card) && hasUsefulTarget(g, me, card);
            const selected = targeting?.iid === iid || bottomSel.includes(iid);
            return (
              <img
                key={iid}
                className={`hand-card ${playable ? 'playable' : ''} ${selected ? 'selected' : ''}`}
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
