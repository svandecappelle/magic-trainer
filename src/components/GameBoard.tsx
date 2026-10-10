import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  actor, apply, canAttack, canBlock, canCastNow, findPermanent, hasKw, hasUsefulTarget, IllegalAction, isLegalTarget, isMainStep, opponent,
  powerOf, toughnessOf,
  type Action, type CardInst, type GameState, type Permanent, type PlayerId, type Target,
} from '../lib/engine/engine';
import { errorText, logText, useT, type AppError } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import { isCreature, isLandCard, spellSpec, type AbilitySpec } from '../lib/engine/rules';
import { ChoicePanel, choicePrompt } from './ChoicePanel';
import { Lines, type Line } from './board/Lines';
import { useBoardFx, type Float } from './board/useBoardFx';
import type { Card } from '../types';
import './board/board.css';

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

type Phase = 'begin' | 'main1' | 'combat' | 'block' | 'main2' | 'end';
const PHASES: Phase[] = ['begin', 'main1', 'combat', 'block', 'main2', 'end'];

function currentPhase(g: GameState): Phase {
  if (g.priority?.reason === 'begin') return 'begin';
  if (g.priority?.reason === 'end' || g.pending?.choice.purpose === 'cleanupDiscard') return 'end';
  if (g.priority?.reason === 'combat' || g.step === 'attack') return 'combat';
  if (g.step === 'block') return 'block';
  return g.step === 'main2' ? 'main2' : 'main1';
}

const sameTarget = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);
const targetKey = (t: Target) => (t.kind === 'player' ? `player:${t.player}` : t.kind === 'spell' ? `stack:${t.iid}` : `perm:${t.iid}`);

// A player with an empty name (the human in Play vs Bot) is shown as "You" in the current language.

/** The two-player game table, shared by Play vs Bot and online multiplayer. */
export function GameBoard({ game: g, me, onAction, endControls, notice }: Props) {
  const t = useT();
  const show = useCardDisplay();
  const opp = opponent(me);
  const names = g.players.map((p) => p.name || t.game.you) as [string, string];
  const [error, setError] = useState<AppError | null>(null);
  const [preview, setPreview] = useState<Card | null>(null);
  const [zoneView, setZoneView] = useState<{ p: PlayerId; zone: 'graveyard' | 'exile' } | null>(null);
  const fx = useBoardFx(g, me);

  // Board elements by key, for drawing arrows between them.
  const boardRef = useRef<HTMLDivElement>(null);
  const registry = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) registry.current.set(key, el);
    else registry.current.delete(key);
  };

  // Selection state for multi-click interactions.
  /** Casting a spell with targets: the slot being filled and the targets picked so far, per slot. */
  const [targeting, setTargeting] = useState<{ iid: string; spec: AbilitySpec; slot: number; picked: Target[][] } | null>(null);
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
  }, [g.step, g.turn, g.priority?.player, g.stack.length, g.mulligan?.player, g.mulligan?.count[me], g.pending]);

  // Errors fade after a few seconds.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4500);
    return () => clearTimeout(timer);
  }, [error]);

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
    if (targeting?.iid === iid) return setTargeting(null);
    if (isLandCard(card)) return act({ type: 'playLand', iid });
    const spec = spellSpec(card);
    if (spec.targets.length) {
      if (!canCastNow(g, me, card)) {
        return setError({ code: g.priority ? 'cannotCastNow' : 'notEnoughMana', params: { card: show.name(card) } });
      }
      if (!hasUsefulTarget(g, me, card)) return setError({ code: 'nothingToTarget', params: { card: show.name(card) } });
      setTargeting({ iid, spec, slot: 0, picked: spec.targets.map(() => []) });
      setError(null);
    } else {
      act({ type: 'cast', iid });
    }
  }

  const slotSpec = targeting ? targeting.spec.targets[targeting.slot] : null;
  const canTarget = (tg: Target) => !!slotSpec && isLegalTarget(g, me, slotSpec, tg);
  const isPicked = (tg: Target) => !!targeting && targeting.picked.flat().some((x) => sameTarget(x, tg));

  /** Move on to the next target slot, casting the spell after the last one. */
  function nextSlot(tg: NonNullable<typeof targeting>) {
    if (tg.slot + 1 < tg.spec.targets.length) return setTargeting({ ...tg, slot: tg.slot + 1 });
    act({ type: 'cast', iid: tg.iid, targets: tg.picked });
    setTargeting(null);
  }

  /** Click on a possible target while casting: pick it, or unpick it. */
  function pickTarget(tg: Target) {
    if (!targeting || !slotSpec) return;
    const current = targeting.picked[targeting.slot];
    if (current.some((x) => sameTarget(x, tg))) {
      const picked = targeting.picked.map((ts, i) => (i === targeting.slot ? ts.filter((x) => !sameTarget(x, tg)) : ts));
      return setTargeting({ ...targeting, picked });
    }
    if (!canTarget(tg)) return setError({ code: 'chooseTargetKind', params: { kind: slotSpec.kind } });
    setError(null);
    const picked = targeting.picked.map((ts, i) => (i === targeting.slot ? [...ts, tg] : ts));
    const next = { ...targeting, picked };
    if (picked[targeting.slot].length >= slotSpec.max) nextSlot(next);
    else setTargeting(next);
  }

  const declaringAttack = iAct && !g.priority && !g.pending && g.step === 'attack';
  const declaringBlocks = iAct && !g.priority && !g.pending && g.step === 'block';

  function onPermanentClick(perm: Permanent) {
    if (targeting) return pickTarget({ kind: 'permanent', iid: perm.iid });
    if (declaringAttack && perm.controller === me && canAttack(perm)) {
      setAttackSel((sel) => (sel.includes(perm.iid) ? sel.filter((x) => x !== perm.iid) : [...sel, perm.iid]));
      return;
    }
    if (declaringBlocks) {
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
    if (targeting) pickTarget({ kind: 'player', player: p });
  }

  // ---------- Prompt and actions ----------

  const oppName = names[opp];
  const top = g.stack.at(-1);
  let prompt = '';
  let controls: ReactNode = null;
  /** What Space / Enter does. */
  let primary: (() => void) | null = null;
  const waiting = !iAct && g.winner === null;

  if (g.winner !== null) {
    prompt = g.winner === 'draw' ? t.game.drawGame : g.winner === me ? t.game.youWin : t.game.theyWin(oppName);
    controls = endControls;
  } else if (g.mulligan) {
    const need = Math.min(g.mulligan.count[me], g.players[me].hand.length);
    if (!iAct) {
      prompt = g.mulligan.kept[me] ? t.game.oppDeciding(oppName) : t.game.oppDecidesFirst(oppName);
    } else if (need > 0) {
      prompt = t.game.bottomPrompt(g.mulligan.count[me], need, bottomSel.length);
      if (bottomSel.length === need) primary = () => act({ type: 'keep', bottom: bottomSel });
      controls = (
        <>
          <button className="secondary" onClick={() => act({ type: 'mulligan' })}>{t.common.mulligan}</button>
          <button className="primary" disabled={bottomSel.length !== need} onClick={() => act({ type: 'keep', bottom: bottomSel })}>{t.common.keep}</button>
        </>
      );
    } else {
      const lands = g.players[me].hand.filter((c) => isLandCard(c.card)).length;
      prompt = t.game.openingHand(lands);
      primary = () => act({ type: 'keep', bottom: [] });
      controls = (
        <>
          <button className="secondary" onClick={() => act({ type: 'mulligan' })}>{t.common.mulligan}</button>
          <button className="primary" onClick={primary}>{t.common.keep}</button>
        </>
      );
    }
  } else if (g.pending) {
    if (g.pending.choice.player === me) prompt = choicePrompt(t, g.pending.choice, show.nameOf);
    else prompt = t.game.choosing(oppName);
  } else if (!iAct) {
    prompt = g.priority ? t.game.mayRespond(oppName) : g.step === 'block' ? t.game.choosingBlockers(oppName) : t.game.thinking(oppName);
  } else if (targeting && slotSpec) {
    const n = targeting.picked[targeting.slot].length;
    const several = slotSpec.max > 1 || slotSpec.min < slotSpec.max;
    prompt = t.game.chooseTarget(t.game.targetKinds[slotSpec.kind]) + (several ? ` ${t.game.targetsPicked(n, slotSpec.min, slotSpec.max)}` : '');
    if (several && n >= slotSpec.min) primary = () => nextSlot(targeting);
    controls = (
      <>
        <button className="secondary" onClick={() => setTargeting(null)}>{t.common.cancel}</button>
        {several && <button className="primary" disabled={n < slotSpec.min} onClick={() => nextSlot(targeting)}>{t.game.doneTargeting}</button>}
      </>
    );
  } else if (g.priority) {
    prompt = top
      ? t.game.onStack(show.name(top.card), top.controller === me ? null : names[top.controller])
      : t.game.windows[g.priority.reason](g.active === me);
    primary = () => act({ type: 'pass' });
    controls = <button className="primary" onClick={primary}>{top ? t.game.passResolve : t.game.pass}</button>;
  } else if (g.step === 'attack') {
    prompt = t.game.declareAttackers;
    const all = g.battlefield.filter((x) => x.controller === me && canAttack(x)).map((x) => x.iid);
    primary = () => act({ type: 'declareAttackers', attackers: attackSel });
    controls = (
      <>
        {attackSel.length < all.length && <button className="secondary" onClick={() => setAttackSel(all)}>{t.game.attackAll}</button>}
        {attackSel.length > 0 && <button className="secondary" onClick={() => setAttackSel([])}>{t.game.clearSelection}</button>}
        <button className="primary" onClick={primary}>{attackSel.length ? t.game.attackWith(attackSel.length) : t.game.noAttack}</button>
      </>
    );
  } else if (g.step === 'block') {
    prompt = blockerSel ? t.game.clickAttacker : t.game.declareBlockers;
    primary = () => act({ type: 'declareBlockers', blocks });
    controls = (
      <>
        {Object.values(blocks).some((b) => b.length) && <button className="secondary" onClick={() => setBlocks({})}>{t.game.clearSelection}</button>}
        <button className="primary" onClick={primary}>{t.game.confirmBlocks}</button>
      </>
    );
  } else {
    prompt = g.step === 'main1' ? t.game.main1 : t.game.main2;
    primary = () => act({ type: 'pass' });
    controls = <button className="primary" onClick={primary}>{g.step === 'main1' ? t.game.toCombat : t.game.endTurn}</button>;
  }

  // Keyboard: Space / Enter for the main action, Escape to cancel a selection.
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Buttons outside the game keep their usual keyboard behaviour. A game button that kept
        // the focus after a click must not be clicked again: Space always means the main action.
        if (el.closest('button') && !el.closest('.game')) return;
        if (!primaryRef.current) return;
        e.preventDefault();
        (el as HTMLElement).blur?.();
        primaryRef.current();
      } else if (e.key === 'Escape') {
        setTargeting(null);
        setBlockerSel(null);
        setZoneView(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- Arrows ----------

  const lines: Line[] = [];
  const shownBlocks = declaringBlocks ? blocks : g.blocks;
  for (const [aid, bids] of Object.entries(shownBlocks)) {
    for (const bid of bids) lines.push({ from: `perm:${bid}`, to: `perm:${aid}`, kind: declaringBlocks ? 'pending' : 'block' });
  }
  const attackers = declaringAttack ? attackSel : g.attackers;
  const defender = opponent(g.active);
  for (const aid of attackers) {
    if (!shownBlocks[aid]?.length) lines.push({ from: `perm:${aid}`, to: `player:${defender}`, kind: declaringAttack ? 'pending' : 'attack' });
  }
  for (const item of g.stack) {
    for (const tg of item.targets.flat()) lines.push({ from: `stack:${item.iid}`, to: targetKey(tg), kind: 'target' });
  }
  if (targeting) {
    for (const tg of targeting.picked.flat()) lines.push({ from: `hand:${targeting.iid}`, to: targetKey(tg), kind: 'pending' });
  }

  // ---------- Rendering ----------

  const floatsFor = (anchor: string) =>
    fx.floats.filter((f) => f.anchor === anchor).map((f: Float, i) => (
      <span key={f.id} className={`float float-${f.kind}`} style={{ '--n': i } as CSSProperties}>{f.text}</span>
    ));

  const blockedBy = (iid: string) => Object.entries(shownBlocks).find(([, b]) => b.includes(iid))?.[0];
  const attackerIds = new Set([...g.attackers, ...(declaringAttack ? attackSel : [])]);

  const renderPermanent = (perm: Permanent, ghost = false) => {
    const attacking = attackerIds.has(perm.iid);
    const blocking = !!blockedBy(perm.iid);
    const selected = blockerSel === perm.iid;
    const asTarget: Target = { kind: 'permanent', iid: perm.iid };
    const targetable = !ghost && canTarget(asTarget);
    const picked = isPicked(asTarget);
    // Hints for what can be clicked right now.
    const canAct =
      !ghost &&
      ((declaringAttack && perm.controller === me && canAttack(perm)) ||
        (declaringBlocks && perm.controller === me && isCreature(perm.card) && !perm.tapped) ||
        (declaringBlocks && !!blockerSel && attackerIds.has(perm.iid) && canBlock(findPermanent(g, blockerSel)!, perm)));
    const classes = [
      'perm', perm.tapped && 'tapped', attacking && 'attacking', blocking && 'blocking', selected && 'selected',
      targetable && 'targetable', picked && 'picked', canAct && 'actionable', ghost && 'leaving',
      targeting && !targetable && !ghost && 'dimmed', perm.controller === me ? 'mine' : 'theirs',
    ].filter(Boolean).join(' ');
    const granted = [...new Set(perm.boosts.flatMap((b) => b.keywords))];
    const counters = Object.entries(perm.counters).filter(([, n]) => n);
    const hurt = perm.damage > 0;
    return (
      <div
        key={ghost ? `ghost-${perm.iid}` : perm.iid}
        ref={ghost ? undefined : reg(`perm:${perm.iid}`)}
        className={classes}
        onClick={ghost ? undefined : () => onPermanentClick(perm)}
        onMouseEnter={() => setPreview(perm.card)}
      >
        <img src={show.imageSmall(perm.card)} alt={show.name(perm.card)} draggable={false} />
        {isCreature(perm.card) && (
          <span className={`pt ${hurt ? 'hurt' : ''} ${perm.boosts.length || counters.length ? 'pumped' : ''}`}>
            {powerOf(perm)}/{toughnessOf(perm) - perm.damage}
          </span>
        )}
        {perm.sick && isCreature(perm.card) && !hasKw(perm, 'haste') && <span className="sick" title={t.game.sick}>💤</span>}
        {counters.length > 0 && <span className="counters">{counters.map(([c, n]) => t.game.counters(c, n!)).join(' ')}</span>}
        {granted.length > 0 && <span className="granted">{granted.join(', ')}</span>}
        {!ghost && floatsFor(`perm:${perm.iid}`)}
      </div>
    );
  };

  /** One battlefield row, with permanents that just left still fading out where they were. */
  const row = (p: PlayerId, lands: boolean) => {
    const perms = g.battlefield.filter((x) => x.controller === p && isLandCard(x.card) === lands);
    const items = perms.map((perm) => renderPermanent(perm));
    for (const ghost of fx.ghosts) {
      if (ghost.perm.controller !== p || isLandCard(ghost.perm.card) !== lands) continue;
      items.splice(Math.min(ghost.index, items.length), 0, renderPermanent(ghost.perm, true));
    }
    return <div className={`perm-row ${lands ? 'lands' : 'creatures'}`}>{items}</div>;
  };

  const field = (p: PlayerId) => (
    <div className={`battlefield ${p === me ? 'mine' : 'theirs'}`}>
      {p === me ? <>{row(p, false)}{row(p, true)}</> : <>{row(p, true)}{row(p, false)}</>}
    </div>
  );

  const hud = (p: PlayerId) => {
    const ps = g.players[p];
    const asTarget: Target = { kind: 'player', player: p };
    const cls = [
      'hud', p === me ? 'mine' : 'theirs', g.active === p && 'active', acting === p && 'acting',
      canTarget(asTarget) && 'targetable', isPicked(asTarget) && 'picked',
    ].filter(Boolean).join(' ');
    const zone = (z: 'graveyard' | 'exile', icon: string) => (
      <button className="zone-chip" title={t.game.zoneNames[z]} onClick={(e) => { e.stopPropagation(); setZoneView(zoneView?.p === p && zoneView.zone === z ? null : { p, zone: z }); }}>
        {icon} {ps[z].length}
      </button>
    );
    return (
      <div ref={reg(`player:${p}`)} className={cls} onClick={() => onPlayerClick(p)}>
        <div className="hud-name">
          <strong>{p === me && ps.name ? t.game.nameYou(ps.name) : names[p]}</strong>
          {g.active === p && <span className="turn-dot" title={t.game.turnOf(p === me, names[p])} />}
        </div>
        <div className="life" key={ps.life}>♥ {ps.life}{floatsFor(`player:${p}`)}</div>
        <div className="zones small">
          <span title={t.game.zoneNames.library}>📚 {ps.library.length}</span>
          <span title={t.game.zoneNames.hand}>✋ {ps.hand.length}</span>
          {zone('graveyard', '🪦')}
          {zone('exile', '🌀')}
        </div>
      </div>
    );
  };

  const phase = currentPhase(g);
  const myHand = g.players[me].hand;
  const handStyle = { '--overlap': `${Math.max(0, (myHand.length - 7) * 9)}px` } as CSSProperties;

  return (
    <div className="game">
      <div className="board" ref={boardRef}>
        {/* Opponent */}
        <div className="player-bar theirs">
          {hud(opp)}
          <div className="opp-hand">
            {g.players[opp].hand.map((c, i) => (
              <div key={c.iid} className="card-back" style={{ '--i': i - (g.players[opp].hand.length - 1) / 2 } as CSSProperties} />
            ))}
          </div>
        </div>
        {field(opp)}

        {/* Center: phases, prompt, actions */}
        <div className={`center-bar ${iAct && g.winner === null ? 'your-move' : ''} ${waiting ? 'waiting' : ''}`}>
          <ol className="phases" aria-label={t.game.turnOf(g.active === me, names[g.active])}>
            {g.mulligan ? (
              <li className="current">{t.game.steps.mulligan}</li>
            ) : (
              PHASES.map((ph) => (
                <li key={ph} className={`${ph === phase ? 'current' : ''} ${g.active === me ? 'mine' : 'theirs'}`}>{t.game.phases[ph]}</li>
              ))
            )}
          </ol>
          <div className="prompt">
            <span className="small muted">{g.mulligan ? '' : `${t.game.turnOf(g.active === me, names[g.active])} · ${t.game.turnLabel(g.turn, t.game.phases[phase])}`}</span>
            <strong>{prompt}</strong>
          </div>
          <div className="actions">
            {controls}
            {primary && <kbd className="key-hint">{t.game.keyHint}</kbd>}
          </div>
          {error && <div className="board-error" key={JSON.stringify(error)}>{errorText(t, error)}</div>}

          {/* Anchored to the center bar: what just happened (above), the stack (above, right), a choice to make (below). */}
          <div className="toasts" aria-live="polite">
            {fx.toasts.map((x) => (
              <div key={x.id} className="toast">{logText(t, x.entry, names, me, show.nameOf)}</div>
            ))}
          </div>
          {g.stack.length > 0 && (
            <div className="stack-zone">
              <span className="small muted">{t.game.stack}</span>
              {[...g.stack].reverse().map((item, i) => (
                <div
                  key={item.iid}
                  ref={reg(`stack:${item.iid}`)}
                  className={`stack-card ${i === 0 ? 'top' : ''} ${canTarget({ kind: 'spell', iid: item.iid }) ? 'targetable' : ''} ${item.ability ? 'ability' : ''} ${item.controller === me ? 'mine' : 'theirs'}`}
                  onMouseEnter={() => setPreview(item.card)}
                  onClick={() => pickTarget({ kind: 'spell', iid: item.iid })}
                >
                  <img src={show.imageSmall(item.card)} alt={show.name(item.card)} draggable={false} />
                  <span className="small">{names[item.controller]}</span>
                </div>
              ))}
            </div>
          )}
          {g.pending && g.pending.choice.player === me && g.winner === null && (
            <div className="choice-dock">
              <ChoicePanel choice={g.pending.choice} onAnswer={(answer) => act({ type: 'choose', answer })} onPreview={setPreview} />
            </div>
          )}
        </div>

        {field(me)}

        {/* You */}
        <div className="player-bar mine">
          {hud(me)}
          <div className="my-hand" style={handStyle}>
            {myHand.map(({ iid, card }, i) => {
              const playable = isLandCard(card)
                ? iAct && !g.priority && !g.pending && !g.mulligan && isMainStep(g) && g.active === me && !g.players[me].landPlayed
                : canCastNow(g, me, card) && hasUsefulTarget(g, me, card);
              const selected = targeting?.iid === iid || bottomSel.includes(iid);
              const offset = i - (myHand.length - 1) / 2;
              return (
                <div
                  key={iid}
                  ref={reg(`hand:${iid}`)}
                  className={`hand-card ${playable ? 'playable' : ''} ${selected ? 'selected' : ''}`}
                  style={{ '--rot': `${offset * 1.6}deg`, '--drop': `${Math.abs(offset) * 2.5}px` } as CSSProperties}
                  onClick={() => onHandClick(iid, card)}
                  onMouseEnter={() => setPreview(card)}
                >
                  <img src={show.imageSmall(card)} alt={show.name(card)} draggable={false} />
                </div>
              );
            })}
          </div>
        </div>

        {fx.banner && (
          <div key={fx.banner.id} className={`turn-banner ${fx.banner.player === me ? 'mine' : 'theirs'}`}>
            {t.game.turnBanner(fx.banner.player === me, names[fx.banner.player])}
          </div>
        )}

        {zoneView && (
          <div className="zone-view" onClick={() => setZoneView(null)}>
            <div className="zone-view-panel" onClick={(e) => e.stopPropagation()}>
              <div className="row">
                <strong>{names[zoneView.p]} · {t.game.zoneNames[zoneView.zone]}</strong>
                <span className="spacer" />
                <button className="secondary small" onClick={() => setZoneView(null)}>{t.game.close}</button>
              </div>
              <div className="zone-cards">
                {g.players[zoneView.p][zoneView.zone].length === 0 && <span className="muted">{t.game.emptyZone}</span>}
                {[...g.players[zoneView.p][zoneView.zone]].reverse().map((c: CardInst) => (
                  <img key={c.iid} src={show.imageSmall(c.card)} alt={show.name(c.card)} onMouseEnter={() => setPreview(c.card)} />
                ))}
              </div>
            </div>
          </div>
        )}

        <Lines container={boardRef} registry={registry} lines={lines} />
      </div>

      <aside className="game-side">
        {preview?.imageNormal ? (
          <img className="card-preview" src={show.imageNormal(preview)} alt={show.name(preview)} />
        ) : (
          <div className="card-preview placeholder muted small">{t.common.hoverPreview}</div>
        )}
        {notice && <div className="small play-notice">{notice}</div>}
        <h4>{t.common.log}</h4>
        <ol className="log small" reversed>
          {[...g.log].reverse().map((l, i) => (
            <li key={g.log.length - i} className={i < fx.freshLog ? 'fresh' : ''}>{logText(t, l, names, me, show.nameOf)}</li>
          ))}
        </ol>
        {g.winner === null && (
          <div className="game-options">
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
          </div>
        )}
      </aside>
    </div>
  );
}
