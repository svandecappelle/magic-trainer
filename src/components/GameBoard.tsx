import { useEffect, useState, type ReactNode } from 'react';
import {
  actor, apply, canAttack, canBlock, canCastNow, findPermanent, hasUsefulTarget, IllegalAction, isMainStep, opponent, powerOf, toughnessOf,
  type Action, type GameState, type Permanent, type PlayerId,
} from '../lib/engine/engine';
import { errorText, logText, useT, type AppError } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
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

// A player with an empty name (the human in Play vs Bot) is shown as "You" in the current language.

/** The two-player game table, shared by Play vs Bot and online multiplayer. */
export function GameBoard({ game: g, me, onAction, endControls, notice }: Props) {
  const t = useT();
  const show = useCardDisplay();
  const opp = opponent(me);
  const names = g.players.map((p) => p.name || t.game.you) as [string, string];
  const [error, setError] = useState<AppError | null>(null);
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

  const fullControl = g.fullControl?.[me] ?? false;
  const acting = actor(g);
  const iAct = acting === me;

  function act(action: Action) {
    try {
      apply(g, action); // validate locally for instant feedback
      setError(null);
      onAction(action);
    } catch (e) {
      if (e instanceof IllegalAction) {
        // Card names in rule errors are English; show them in the current language.
        const params = Object.fromEntries(
          Object.entries(e.params).map(([k, v]) => [k, ['card', 'blocker', 'attacker'].includes(k) ? show.nameOf(String(v)) : v]),
        );
        setError({ code: e.code, params });
      }
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
        return setError({ code: g.priority ? 'cannotCastNow' : 'notEnoughMana', params: { card: show.name(card) } });
      }
      if (!hasUsefulTarget(g, me, card)) return setError({ code: 'nothingToTarget', params: { card: show.name(card) } });
      setTargeting({ iid, kind });
      setError(null);
    } else {
      act({ type: 'cast', iid });
    }
  }

  function onPermanentClick(perm: Permanent) {
    if (targeting) {
      if (targeting.kind === 'player' || targeting.kind === 'spell') return setError({ code: 'chooseTargetKind', params: { kind: targeting.kind } });
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
        if (!canBlock(blocker, perm)) return setError({ code: 'cannotBlock', params: { blocker: show.name(blocker.card), attacker: show.name(perm.card) } });
        setBlocks((b) => ({ ...b, [perm.iid]: [...(b[perm.iid] ?? []), blockerSel] }));
        setBlockerSel(null);
        setError(null);
      }
    }
  }

  function onPlayerClick(p: PlayerId) {
    if (!targeting) return;
    if (targeting.kind === 'creature' || targeting.kind === 'spell') return setError({ code: 'chooseTargetKind', params: { kind: targeting.kind } });
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
        <img src={show.imageSmall(perm.card)} alt={show.name(perm.card)} />
        {isCreature(perm.card) && (
          <span className={`pt ${perm.damage ? 'hurt' : ''} ${perm.pumpPower || perm.pumpToughness ? 'pumped' : ''}`}>
            {powerOf(perm)}/{toughnessOf(perm) - perm.damage}
          </span>
        )}
        {perm.sick && isCreature(perm.card) && <span className="sick" title={t.game.sick}>zzz</span>}
        {blocking && <span className="tag">{t.game.blocks(show.nameOf(findPermanent(g, blocking)?.card.name ?? ''))}</span>}
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
        <strong>{p === me && ps.name ? t.game.nameYou(ps.name) : names[p]}</strong>
        <span className="life-big">♥ {ps.life}</span>
        <span className="small muted">{t.game.zones(ps.library.length, ps.hand.length, ps.graveyard.length)}</span>
      </div>
    );
  };

  const oppName = names[opp];
  const top = g.stack.at(-1);
  let prompt = '';
  let controls: ReactNode = null;
  if (g.winner !== null) {
    prompt = g.winner === 'draw' ? t.game.drawGame : g.winner === me ? t.game.youWin : t.game.theyWin(oppName);
    controls = endControls;
  } else if (g.mulligan) {
    const need = Math.min(g.mulligan.count[me], g.players[me].hand.length);
    if (!iAct) {
      prompt = g.mulligan.kept[me] ? t.game.oppDeciding(oppName) : t.game.oppDecidesFirst(oppName);
    } else if (need > 0) {
      prompt = t.game.bottomPrompt(g.mulligan.count[me], need, bottomSel.length);
      controls = (
        <>
          <button disabled={bottomSel.length !== need} onClick={() => act({ type: 'keep', bottom: bottomSel })}>{t.common.keep}</button>
          <button className="secondary" onClick={() => act({ type: 'mulligan' })}>{t.common.mulligan}</button>
        </>
      );
    } else {
      const lands = g.players[me].hand.filter((c) => isLandCard(c.card)).length;
      prompt = t.game.openingHand(lands);
      controls = (
        <>
          <button onClick={() => act({ type: 'keep', bottom: [] })}>{t.common.keep}</button>
          <button className="secondary" onClick={() => act({ type: 'mulligan' })}>{t.common.mulligan}</button>
        </>
      );
    }
  } else if (!iAct) {
    prompt = g.priority ? t.game.mayRespond(oppName) : g.step === 'block' ? t.game.choosingBlockers(oppName) : t.game.thinking(oppName);
  } else if (targeting) {
    prompt = t.game.chooseTarget(t.game.targetKinds[targeting.kind]);
    controls = <button className="secondary" onClick={() => setTargeting(null)}>{t.common.cancel}</button>;
  } else if (g.priority) {
    prompt = top
      ? t.game.onStack(show.name(top.card), top.controller === me ? null : names[top.controller])
      : t.game.windows[g.priority.reason](g.active === me);
    controls = <button onClick={() => act({ type: 'pass' })}>{top ? t.game.passResolve : t.game.pass}</button>;
  } else if (g.step === 'attack') {
    prompt = t.game.declareAttackers;
    controls = (
      <button onClick={() => act({ type: 'declareAttackers', attackers: attackSel })}>
        {attackSel.length ? t.game.attackWith(attackSel.length) : t.game.noAttack}
      </button>
    );
  } else if (g.step === 'block') {
    prompt = blockerSel ? t.game.clickAttacker : t.game.declareBlockers;
    controls = <button onClick={() => act({ type: 'declareBlockers', blocks })}>{t.game.confirmBlocks}</button>;
  } else {
    prompt = g.step === 'main1' ? t.game.main1 : t.game.main2;
    controls = <button onClick={() => act({ type: 'pass' })}>{g.step === 'main1' ? t.game.toCombat : t.game.endTurn}</button>;
  }

  return (
    <div className="play-layout">
      <div>
        {player(opp)}
        <div className="bot-hand">{g.players[opp].hand.map((c) => <div key={c.iid} className="card-back" />)}</div>
        {side(opp)}
        <div className="play-bar">
          <span className="small muted">{g.mulligan ? t.game.steps.mulligan : t.game.turnLabel(g.turn, t.game.steps[g.step])}</span>
          <strong>{prompt}</strong>
          <span className="spacer" />
          {controls}
        </div>
        {g.stack.length > 0 && (
          <div className="stack">
            <span className="small muted">{t.game.stack}</span>
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
                <img src={show.imageSmall(item.card)} alt={show.name(item.card)} />
                <span className="small">{names[item.controller]}</span>
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
                src={show.imageSmall(card)}
                alt={show.name(card)}
                onClick={() => onHandClick(iid, card)}
                onMouseEnter={() => setPreview(card)}
              />
            );
          })}
        </div>
      </div>

      <aside className="side-column">
        {preview?.imageNormal ? (
          <img className="card-preview" src={show.imageNormal(preview)} alt={show.name(preview)} />
        ) : (
          <div className="card-preview placeholder muted small">{t.common.hoverPreview}</div>
        )}
        {notice && <div className="small play-notice">{notice}</div>}
        {error && <div className="error small play-error">{errorText(t, error)}</div>}
        <h4>{t.common.log}</h4>
        <ol className="log small" reversed>
          {[...g.log].reverse().map((l, i) => <li key={i}>{logText(t, l, names, me, show.nameOf)}</li>)}
        </ol>
        {g.winner === null && (
          <>
            <label className="full-control small" title={t.game.fullControlHint(fullControl)}>
              <input
                type="checkbox"
                checked={fullControl}
                onChange={(e) => act({ type: 'setFullControl', player: me, on: e.target.checked })}
              />
              {t.game.fullControl}
            </label>
            <p className="small muted">{t.game.fullControlHint(fullControl)}</p>
            <button className="danger" onClick={() => act({ type: 'concede', player: me })}>{t.game.concede}</button>
          </>
        )}
      </aside>
    </div>
  );
}
