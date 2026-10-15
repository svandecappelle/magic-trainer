import { createPortal } from 'react-dom';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  activatable, activationProblem, abilityMaxX, actor, apply, canAttack, canTapForMana, canUntapForMana, castCost, castOptions, castSources,
  landFaces, findInGraveyard, legalTargets, canBlock, findPermanent, hasKw, IllegalAction, isActivePlayer, mulliganBottom, isLegalTarget, isMainStep, firstOpponent, opponentsOf, teammatesOf, teamPlayers, wonBy,
  powerOf, toughnessOf, xCount,
  type Action, type CardInst, type CastOption, type GameState, type Permanent, type PlayerId, type Target,
} from '../lib/engine/engine';
import { errorText, logText, useT, type AppError } from '../i18n';
import { useCardDisplay } from '../lib/cardLocale';
import {
  activatedOf, castInfo, castSpec, faceCard, faceName, modeSimulated, findPayment, isCreature, isInstantOrSorcery, isLandCard, isPlaneswalker, parseCost, type AbilitySpec,
} from '../lib/engine/rules';
import { auditCard, type CardStatus } from '../lib/engine/audit';
import { ChoicePanel, choiceKey, choicePrompt } from './ChoicePanel';
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
  if (g.priority?.reason === 'begin' || g.step === 'upkeep') return 'begin';
  if (g.priority?.reason === 'end' || g.pending?.choice.purpose === 'cleanupDiscard') return 'end';
  if (g.priority?.reason === 'combat' || g.step === 'attack') return 'combat';
  if (g.step === 'block') return 'block';
  return g.step === 'main2' ? 'main2' : 'main1';
}

const sameTarget = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);
const targetKey = (t: Target) => (t.kind === 'player' ? `player:${t.player}` : t.kind === 'spell' ? `stack:${t.iid}` : `perm:${t.iid}`);

// A player with an empty name (the human in Play vs Bot) is shown as "You" in the current language.

/** How much of a card the rules engine simulates (cached: the audit reads the whole card text). */
const statusCache = new Map<string, CardStatus>();
function engineStatus(card: Card): CardStatus {
  const key = `${card.name}\n${card.oracleText}`;
  let status = statusCache.get(key);
  if (!status) {
    status = auditCard(card).status;
    // A permanent whose abilities aren't simulated still enters the battlefield (a creature still fights): partly.
    if (status === 'none' && !isInstantOrSorcery(card)) status = 'partial';
    statusCache.set(key, status);
  }
  return status;
}

type SideTab = 'card' | 'log' | 'settings';

/** The two-player game table, shared by Play vs Bot and online multiplayer. */
export function GameBoard({ game: g, me, onAction, endControls, notice }: Props) {
  const t = useT();
  const show = useCardDisplay();
  const opponents = opponentsOf(g, me);
  const mates = teammatesOf(g, me);
  /** Several players per side (Two-Headed Giant). */
  const multi = g.players.length > 2;
  /** "A & B" for a team. */
  const teamName = (p: PlayerId) => teamPlayers(g, p).map((q) => names[q]).join(' & ');
  const myTurn = isActivePlayer(g, me);
  const names = g.players.map((p) => p.name || t.game.you) as [string, string];
  const [error, setError] = useState<AppError | null>(null);
  const [preview, setPreview] = useState<Card | null>(null);
  // Under 1000px the side panel goes below the table and has no room for a large preview: start on the log.
  const [sideTab, setSideTab] = useState<SideTab>(() => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1000px)').matches ? 'log' : 'card'));
  const [zoneView, setZoneView] = useState<{ p: PlayerId; zone: 'graveyard' | 'exile' | 'command' } | null>(null);
  const zoneCards = (p: PlayerId, z: 'graveyard' | 'exile' | 'command') => (z === 'command' ? g.players[p].command ?? [] : g.players[p][z]);
  /** A card shown large after a long press (touch screens have no hover preview) or a right click. */
  const [zoom, setZoom] = useState<Card | null>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const fx = useBoardFx(g, me);

  // Board elements by key, for drawing arrows between them.
  const boardRef = useRef<HTMLDivElement>(null);
  const registry = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) registry.current.set(key, el);
    else registry.current.delete(key);
  };

  // Selection state for multi-click interactions.
  /**
   * Picking targets, slot by slot: for a spell being cast, or for a triggered ability (`choice`),
   * whose arrows start from `from`.
   */
  const [targeting, setTargeting] = useState<{
    iid: string; spec: AbilitySpec; slot: number; picked: Target[][]; x?: number; choice?: boolean; from?: string;
    /** Set when activating ability number `activate` of permanent `iid`. */
    activate?: number;
    /** Set when casting a spell: the cast action, targets aside. */
    cast?: Extract<Action, { type: 'cast' }>;
  } | null>(null);
  /** Choosing X before casting a spell (`plan`) or activating an ability (`ability`) with {X} in its cost. */
  const [xPick, setXPick] = useState<{
    iid: string; card: Card; x: number; max: number; ability?: number; plan?: { card: Card; opt: CastOption; modes?: number[] };
  } | null>(null);
  /** A card with several ways to play it (kicker, adventure, land face, cycling…): which one? */
  const [castMenu, setCastMenu] = useState<{ card: Card; items: { key: string; label: string; run: () => void }[] } | null>(null);
  /** Choosing the modes of a modal spell ("Choose one —"). */
  const [modePick, setModePick] = useState<{ iid: string; card: Card; opt: CastOption; picked: number[] } | null>(null);
  /** A permanent with several abilities was clicked: which one? */
  const [abilityMenu, setAbilityMenu] = useState<Permanent | null>(null);
  const [attackSel, setAttackSel] = useState<string[]>([]);
  /** Selected attackers sent at a planeswalker: attacker iid → planeswalker iid. */
  const [attackAt, setAttackAt] = useState<Record<string, string>>({});
  const [blockerSel, setBlockerSel] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Record<string, string[]>>({});
  const [bottomSel, setBottomSel] = useState<string[]>([]);

  // Reset selections whenever the game moves on.
  useEffect(() => {
    const c = g.pending?.choice;
    // A triggered ability of ours needs targets: pick them on the board like for a spell.
    if (c?.kind === 'targets' && c.player === me) {
      setTargeting({ iid: '', spec: { targets: c.slots, effects: [] }, slot: 0, picked: c.slots.map(() => []), choice: true, from: `perm:${c.source.iid}` });
    } else setTargeting(null);
    setXPick(null);
    setAbilityMenu(null);
    setCastMenu(null);
    setModePick(null);
    setAttackSel([]);
    setAttackAt({});
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

  /** Handlers that make `card` zoomable: hold it ~0.45 s, or right click it. Hovering still previews it. */
  const zoomable = (card: Card) => ({
    onMouseEnter: () => setPreview(card),
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      setZoom(card);
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const at = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
      at.timer = window.setTimeout(() => {
        at.fired = true;
        setZoom(card);
      }, 450);
      press.current = at;
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const at = press.current;
      if (at && !at.fired && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) clearTimeout(at.timer);
    },
    onPointerUp: () => press.current && clearTimeout(press.current.timer),
    onPointerCancel: () => press.current && clearTimeout(press.current.timer),
  });
  /** The click that ends a long press must not also play the card. */
  const swallowZoomClick = (e: ReactMouseEvent) => {
    if (press.current?.fired) {
      e.stopPropagation();
      e.preventDefault();
      press.current = null;
    }
  };

  function onHandClick(iid: string, card: Card) {
    if (!iAct) return;
    if (g.mulligan) {
      setBottomSel((sel) => (sel.includes(iid) ? sel.filter((x) => x !== iid) : [...sel, iid]));
      return;
    }
    if (targeting?.iid === iid || xPick?.iid === iid || modePick?.iid === iid) {
      setTargeting(null);
      setModePick(null);
      return setXPick(null);
    }
    playCard(iid, card);
  }

  const canPlayLand = iAct && !g.priority && !g.pending && !g.mulligan && isMainStep(g) && myTurn && !g.players[me].landPlayed;

  /** Every way to play a card right now (land faces, casts, cycling). */
  function playItems(iid: string, card: Card) {
    const items: { key: string; label: string; run: () => void }[] = [];
    const inHand = g.players[me].hand.some((c) => c.iid === iid);
    if (inHand && canPlayLand) {
      for (const face of landFaces(card)) {
        items.push({ key: `land${face}`, label: t.game.playAsLand(show.name(faceCard(card, face))), run: () => act({ type: 'playLand', iid, ...(face ? { face } : {}) }) });
      }
    }
    for (const opt of castOptions(g, me, iid)) {
      const name = opt.face ? show.name(faceCard(card, opt.face)) : show.nameOf(faceName(card));
      const info = castInfo(card, opt.face);
      const label = opt.from === 'graveyard' ? t.game.castFlashback(name, info.flashback ?? '')
        : opt.from === 'exile' ? t.game.castFromExile(name)
        : opt.kicked ? t.game.castKicked(name, info.kicker ?? '')
        : t.game.castNamed(name);
      items.push({ key: `cast${opt.face}${opt.kicked}`, label, run: () => beginCast(iid, card, opt) });
    }
    const cycling = inHand ? castInfo(card).cycling : undefined;
    const cycleTiming = !!g.priority || (isMainStep(g) && myTurn);
    if (cycling && cycleTiming && !g.pending && findPayment(castSources(g, me, card, iid), parseCost(cycling.cost))) {
      items.push({ key: 'cycle', label: t.game.cycleFor(cycling.cost), run: () => act({ type: 'cycle', iid }) });
    }
    return items;
  }

  /** Plays a card: its only way at once, a menu when there are several. */
  function playCard(iid: string, card: Card) {
    const items = playItems(iid, card);
    setError(null);
    if (items.length === 1) return items[0].run();
    if (items.length > 1) return setCastMenu({ card, items });
    // Nothing possible: let the rules explain why.
    if (isLandCard(card)) return act({ type: 'playLand', iid });
    setError({ code: g.priority ? 'cannotCastNow' : 'notEnoughMana', params: { card: show.name(card) } });
  }

  /** Cast a card a given way: modes first if it's modal, then X, then targets. */
  function beginCast(iid: string, card: Card, opt: CastOption) {
    setCastMenu(null);
    if (castInfo(card, opt.face).modal) return setModePick({ iid, card, opt, picked: [] });
    continueCast(iid, card, opt);
  }

  function continueCast(iid: string, card: Card, opt: CastOption, modes?: number[], x?: number) {
    const face = faceCard(card, opt.face);
    if (xCount(face) && x === undefined) {
      let max = 0;
      while (findPayment(castSources(g, me, card, iid, opt.face), castCost(g, me, card, opt, max + 1))) max++;
      setTargeting(null);
      return setXPick({ iid, card: face, x: max, max, plan: { card, opt, modes } });
    }
    const cast: Extract<Action, { type: 'cast' }> = {
      type: 'cast', iid, ...(opt.face ? { face: opt.face } : {}), ...(opt.kicked ? { kicked: true } : {}),
      ...(modes ? { modes } : {}), ...(x === undefined ? {} : { x }),
    };
    const spec = castSpec(card, { face: opt.face, modes, kicked: opt.kicked });
    if (!spec.targets.length) return act(cast);
    if (spec.targets.some((slot) => legalTargets(g, me, slot, undefined, face).length < slot.min)) {
      return setError({ code: 'nothingToTarget', params: { card: show.name(face) } });
    }
    setTargeting({ iid, spec, slot: 0, picked: spec.targets.map(() => []), cast });
    setError(null);
  }

  const slotSpec = targeting ? targeting.spec.targets[targeting.slot] : null;
  /** The card doing the targeting (for protection from its colors). */
  const targetingSource = targeting
    ? (g.players[me].hand.find((c) => c.iid === targeting.iid)?.card ?? findPermanent(g, targeting.iid)?.card ??
      (g.pending?.choice.kind === 'targets' ? g.pending.choice.source.card : undefined))
    : undefined;
  const canTarget = (tg: Target) => !!slotSpec && isLegalTarget(g, me, slotSpec, tg, undefined, targetingSource);
  const isPicked = (tg: Target) => !!targeting && targeting.picked.flat().some((x) => sameTarget(x, tg));

  /** Move on to the next target slot, casting the spell after the last one. */
  function nextSlot(tg: NonNullable<typeof targeting>) {
    if (tg.slot + 1 < tg.spec.targets.length) return setTargeting({ ...tg, slot: tg.slot + 1 });
    if (tg.choice) return act({ type: 'choose', answer: { kind: 'targets', targets: tg.picked } });
    if (tg.cast) {
      act({ ...tg.cast, targets: tg.picked });
      return setTargeting(null);
    }
    if (tg.activate !== undefined) {
      act({ type: 'activate', iid: tg.iid, index: tg.activate, targets: tg.picked, ...(tg.x === undefined ? {} : { x: tg.x }) });
      return setTargeting(null);
    }
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
  /** Permanents with an ability you could activate right now. */
  const canActivate = new Set(
    iAct && !declaringAttack && !declaringBlocks && !targeting && !xPick ? activatable(g, me).map((a) => a.perm.iid) : [],
  );

  /** Activate an ability: choose X first if its cost has one, then its targets. */
  function startActivation(perm: Permanent, index: number, x?: number) {
    setAbilityMenu(null);
    const spec = activatedOf(perm.card)[index];
    const problem = activationProblem(g, me, perm, index, x ?? 0);
    if (problem) return setError({ code: problem, params: { card: show.name(perm.card) } });
    if (x === undefined && spec.cost.mana.includes('{X}')) {
      const max = abilityMaxX(g, perm, index);
      return setXPick({ iid: perm.iid, card: perm.card, x: max, max, ability: index });
    }
    const xs = x === undefined ? {} : { x };
    if (!spec.ability.targets.length) return act({ type: 'activate', iid: perm.iid, index, ...xs });
    setTargeting({ iid: perm.iid, spec: spec.ability, slot: 0, picked: spec.ability.targets.map(() => []), activate: index, from: `perm:${perm.iid}`, ...xs });
    setError(null);
  }

  function onPermanentClick(perm: Permanent) {
    if (targeting) return pickTarget({ kind: 'permanent', iid: perm.iid });
    if (declaringAttack && perm.controller === me && canAttack(perm)) {
      setAttackSel((sel) => (sel.includes(perm.iid) ? sel.filter((x) => x !== perm.iid) : [...sel, perm.iid]));
      setAttackAt(({ [perm.iid]: _, ...rest }) => rest);
      return;
    }
    // Send the selected attackers that aren't assigned yet at this planeswalker; click again to take them back.
    if (declaringAttack && perm.controller !== me && isPlaneswalker(perm.card)) {
      const waiting = attackSel.filter((a) => !attackAt[a]);
      if (waiting.length) setAttackAt({ ...attackAt, ...Object.fromEntries(waiting.map((a) => [a, perm.iid])) });
      else setAttackAt(Object.fromEntries(Object.entries(attackAt).filter(([, pw]) => pw !== perm.iid)));
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
      return;
    }
    // Your own permanent: take back unspent mana, activate an ability, or tap it for mana.
    if (perm.controller === me && !declaringAttack) {
      if (canUntapForMana(g, me, perm)) return act({ type: 'untapForMana', iid: perm.iid });
      const abilities = activatedOf(perm.card).map((spec, index) => ({ spec, index })).filter((a) => a.spec.ability.effects.length);
      const mana = canTapForMana(g, perm);
      if (abilities.length + (mana ? 1 : 0) > 1) setAbilityMenu(perm);
      else if (abilities.length === 1) startActivation(perm, abilities[0].index);
      else if (mana) act({ type: 'tapForMana', iid: perm.iid });
    }
  }

  function onPlayerClick(p: PlayerId) {
    if (targeting) pickTarget({ kind: 'player', player: p });
  }

  // ---------- Prompt and actions ----------

  /** Who the others are waiting for. */
  const oppName = acting !== null ? names[acting] : '';
  const top = g.stack.at(-1);
  let prompt = '';
  let controls: ReactNode = null;
  /** What Space / Enter does. */
  let primary: (() => void) | null = null;
  const waiting = !iAct && g.winner === null;

  if (g.winner !== null) {
    prompt = g.winner === 'draw' ? t.game.drawGame : wonBy(g, me) ? t.game.youWin : t.game.theyWin(teamName(g.winner));
    controls = endControls;
  } else if (g.mulligan) {
    const need = mulliganBottom(g, me);
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
  } else if (g.pending && !targeting?.choice) {
    if (g.pending.choice.player === me) prompt = choicePrompt(t, g.pending.choice, show.nameOf, names);
    else prompt = t.game.choosing(oppName);
  } else if (!iAct) {
    prompt = g.priority ? t.game.mayRespond(oppName) : g.step === 'block' ? t.game.choosingBlockers(oppName) : t.game.thinking(oppName);
  } else if (castMenu) {
    prompt = t.game.chooseHowToPlay(show.name(castMenu.card));
    controls = (
      <>
        <button className="secondary" onClick={() => setCastMenu(null)}>{t.common.cancel}</button>
        {castMenu.items.map((it) => (
          <button key={it.key} className="ability-option" onClick={() => { setCastMenu(null); it.run(); }}>{it.label}</button>
        ))}
      </>
    );
  } else if (modePick) {
    const modal = castInfo(modePick.card, modePick.opt.face).modal!;
    const ok = modePick.picked.length >= Math.max(1, modal.min) && modePick.picked.length <= modal.max;
    const confirm = () => {
      const m = [...modePick.picked].sort((a, b) => a - b);
      setModePick(null);
      continueCast(modePick.iid, modePick.card, modePick.opt, m);
    };
    prompt = t.game.choice.mode(Math.max(1, modal.min), modal.max);
    if (ok) primary = confirm;
    controls = (
      <>
        <button className="secondary" onClick={() => setModePick(null)}>{t.common.cancel}</button>
        {modal.modes.map((text, i) => {
          const on = modePick.picked.includes(i);
          const usable = modeSimulated(modePick.card, modePick.opt.face, i);
          return (
            <button
              key={i}
              className={`ability-option mode ${on ? 'on' : ''}`}
              title={usable ? text : t.game.modeNotSimulated}
              onClick={() => {
                const picked = on ? modePick.picked.filter((x) => x !== i) : modal.max === 1 ? [i] : [...modePick.picked, i].slice(0, modal.max);
                setModePick({ ...modePick, picked });
              }}
            >
              {usable ? text : `${text} ✗`}
            </button>
          );
        })}
        <button className="primary" disabled={!ok} onClick={confirm}>{t.game.confirm}</button>
      </>
    );
  } else if (abilityMenu) {
    prompt = t.game.chooseAbility(show.name(abilityMenu.card));
    controls = (
      <>
        <button className="secondary" onClick={() => setAbilityMenu(null)}>{t.common.cancel}</button>
        {canTapForMana(g, abilityMenu) && (
          <button className="ability-option" onClick={() => { setAbilityMenu(null); act({ type: 'tapForMana', iid: abilityMenu.iid }); }}>{t.game.addMana}</button>
        )}
        {activatedOf(abilityMenu.card).map((spec, index) => spec.ability.effects.length ? (
          <button key={index} className="ability-option" title={spec.text} onClick={() => startActivation(abilityMenu, index)}>{spec.text}</button>
        ) : null)}
      </>
    );
  } else if (xPick) {
    prompt = t.game.chooseX(show.name(xPick.card));
    const confirm = () => {
      setXPick(null);
      const perm = xPick.ability === undefined ? undefined : findPermanent(g, xPick.iid);
      if (perm) startActivation(perm, xPick.ability!, xPick.x);
      else if (xPick.plan) continueCast(xPick.iid, xPick.plan.card, xPick.plan.opt, xPick.plan.modes, xPick.x);
    };
    primary = confirm;
    controls = (
      <>
        <button className="secondary" onClick={() => setXPick(null)}>{t.common.cancel}</button>
        <button className="secondary" disabled={xPick.x <= 0} onClick={() => setXPick({ ...xPick, x: xPick.x - 1 })}>−</button>
        <strong className="x-value">{t.game.xValue(xPick.x)}</strong>
        <button className="secondary" disabled={xPick.x >= xPick.max} onClick={() => setXPick({ ...xPick, x: xPick.x + 1 })}>+</button>
        <button className="primary" onClick={confirm}>{t.game.confirm}</button>
      </>
    );
  } else if (targeting && slotSpec) {
    const n = targeting.picked[targeting.slot].length;
    const several = slotSpec.max > 1 || slotSpec.min < slotSpec.max;
    const source = g.pending?.choice.kind === 'targets' ? g.pending.choice.source.card : null;
    prompt = (source
      ? t.game.choice.triggerTargets({ card: show.name(source), kind: t.game.targetKinds[slotSpec.kind] })
      : t.game.chooseTarget(t.game.targetKinds[slotSpec.kind])) + (several ? ` ${t.game.targetsPicked(n, slotSpec.min, slotSpec.max)}` : '');
    if (several && n >= slotSpec.min) primary = () => nextSlot(targeting);
    controls = (
      <>
        {!targeting.choice && <button className="secondary" onClick={() => setTargeting(null)}>{t.common.cancel}</button>}
        {several && <button className="primary" disabled={n < slotSpec.min} onClick={() => nextSlot(targeting)}>{t.game.doneTargeting}</button>}
      </>
    );
  } else if (g.priority) {
    prompt = top
      ? t.game.onStack(show.name(top.card), top.controller === me ? null : names[top.controller])
      : t.game.windows[g.priority.reason](myTurn);
    primary = () => act({ type: 'pass' });
    controls = <button className="primary" onClick={primary}>{top ? t.game.passResolve : t.game.pass}</button>;
  } else if (g.step === 'attack') {
    const walkers = g.battlefield.some((x) => opponents.includes(x.controller) && isPlaneswalker(x.card));
    prompt = walkers ? t.game.declareAttackersPw : t.game.declareAttackers;
    const all = g.battlefield.filter((x) => x.controller === me && canAttack(x)).map((x) => x.iid);
    const targets = Object.fromEntries(Object.entries(attackAt).filter(([a]) => attackSel.includes(a)));
    primary = () => act({ type: 'declareAttackers', attackers: attackSel, ...(Object.keys(targets).length ? { targets } : {}) });
    controls = (
      <>
        {attackSel.length < all.length && <button className="secondary" onClick={() => setAttackSel(all)}>{t.game.attackAll}</button>}
        {attackSel.length > 0 && <button className="secondary" onClick={() => { setAttackSel([]); setAttackAt({}); }}>{t.game.clearSelection}</button>}
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
        setTargeting((tg) => (tg?.choice ? tg : null)); // a trigger's targets can't be cancelled
        setAbilityMenu(null);
        setCastMenu(null);
        setModePick(null);
        setXPick(null);
        setBlockerSel(null);
        setZoneView(null);
        setZoom(null);
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
  const defender = firstOpponent(g, g.active);
  for (const aid of attackers) {
    const pw = declaringAttack ? attackAt[aid] : g.attackTargets?.[aid];
    if (!shownBlocks[aid]?.length) lines.push({ from: `perm:${aid}`, to: pw ? `perm:${pw}` : `player:${defender}`, kind: declaringAttack ? 'pending' : 'attack' });
  }
  for (const item of g.stack) {
    for (const tg of item.targets.flat()) lines.push({ from: `stack:${item.iid}`, to: targetKey(tg), kind: 'target' });
  }
  if (targeting) {
    for (const tg of targeting.picked.flat()) lines.push({ from: targeting.from ?? `hand:${targeting.iid}`, to: targetKey(tg), kind: 'pending' });
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
      (canActivate.has(perm.iid) ||
        (declaringAttack && perm.controller === me && canAttack(perm)) ||
        (declaringAttack && perm.controller !== me && isPlaneswalker(perm.card) && attackSel.length > 0) ||
        (declaringBlocks && perm.controller === me && isCreature(perm.card) && !perm.tapped) ||
        (declaringBlocks && !!blockerSel && attackerIds.has(perm.iid) && canBlock(findPermanent(g, blockerSel)!, perm)));
    const classes = [
      'perm', perm.tapped && 'tapped', attacking && 'attacking', blocking && 'blocking', selected && 'selected',
      targetable && 'targetable', picked && 'picked', canAct && 'actionable', ghost && 'leaving',
      targeting && !targetable && !ghost && 'dimmed', perm.controller === me ? 'mine' : 'theirs',
    ].filter(Boolean).join(' ');
    const granted = [...new Set([...perm.boosts.flatMap((b) => b.keywords), ...(perm.statics?.keywords ?? [])])];
    const counters = Object.entries(perm.counters).filter(([c, n]) => n && c !== 'loyalty');
    const loyalty = isPlaneswalker(perm.card) ? perm.counters.loyalty ?? 0 : null;
    const hurt = perm.damage > 0;
    return (
      <div
        key={ghost ? `ghost-${perm.iid}` : perm.iid}
        ref={ghost ? undefined : reg(`perm:${perm.iid}`)}
        className={classes}
        onClick={ghost ? undefined : () => onPermanentClick(perm)}
        {...zoomable(perm.card)}
      >
        <img src={show.imageSmall(perm.card)} alt={show.name(perm.card)} draggable={false} />
        {isCreature(perm.card) && (
          <span className={`pt ${hurt ? 'hurt' : ''} ${perm.boosts.length || counters.length || perm.statics?.power || perm.statics?.toughness ? 'pumped' : ''}`}>
            {powerOf(perm)}/{toughnessOf(perm) - perm.damage}
          </span>
        )}
        {perm.commander && <span className="crown" title={t.game.commanderTitle}>👑</span>}
        {perm.sick && isCreature(perm.card) && !hasKw(perm, 'haste') && <span className="sick" title={t.game.sick}>💤</span>}
        {loyalty !== null && <span className="loyalty" title={t.game.loyaltyTitle}>{loyalty}</span>}
        {counters.length > 0 && <span className="counters">{counters.map(([c, n]) => t.game.counters(c, n!)).join(' ')}</span>}
        {granted.length > 0 && <span className="granted">{granted.join(', ')}</span>}
        {!ghost && floatsFor(`perm:${perm.iid}`)}
      </div>
    );
  };

  /** One battlefield row, with permanents that just left still fading out where they were. */
  // Auras and Equipment are drawn behind what they're attached to, whoever controls them.
  const attachedTo = (perm: Permanent) => (perm.attachedTo && findPermanent(g, perm.attachedTo) ? perm.attachedTo : null);
  const attachments = (host: Permanent) => g.battlefield.filter((x) => x.attachedTo === host.iid && attachedTo(x));
  const withAttachments = (perm: Permanent) => {
    const on = attachments(perm);
    if (!on.length) return renderPermanent(perm);
    return (
      <div key={`host-${perm.iid}`} className="perm-host" style={{ '--n': on.length } as CSSProperties}>
        {on.map((a, i) => (
          <div key={a.iid} className="attached" style={{ '--i': i } as CSSProperties}>{renderPermanent(a)}</div>
        ))}
        {renderPermanent(perm)}
      </div>
    );
  };

  const row = (p: PlayerId, lands: boolean) => {
    const perms = g.battlefield.filter((x) => x.controller === p && isLandCard(x.card) === lands && !attachedTo(x));
    const items = perms.map((perm) => withAttachments(perm));
    for (const ghost of fx.ghosts) {
      if (ghost.perm.controller !== p || isLandCard(ghost.perm.card) !== lands) continue;
      items.splice(Math.min(ghost.index, items.length), 0, renderPermanent(ghost.perm, true));
    }
    return <div className={`perm-row ${lands ? 'lands' : 'creatures'}`}>{items}</div>;
  };

  const ours = (p: PlayerId) => p === me || mates.includes(p);
  const field = (p: PlayerId) => (
    <div key={p} className={`battlefield ${ours(p) ? 'mine' : 'theirs'}`}>
      {multi && <span className="field-name small muted">{names[p]}</span>}
      {ours(p) ? <>{row(p, false)}{row(p, true)}</> : <>{row(p, true)}{row(p, false)}</>}
    </div>
  );

  const hud = (p: PlayerId) => {
    const ps = g.players[p];
    const asTarget: Target = { kind: 'player', player: p };
    const cls = [
      'hud', ours(p) ? 'mine' : 'theirs', p !== me && ours(p) && 'ally', isActivePlayer(g, p) && 'active', acting === p && 'acting',
      canTarget(asTarget) && 'targetable', isPicked(asTarget) && 'picked',
    ].filter(Boolean).join(' ');
    const zone = (z: 'graveyard' | 'exile' | 'command', icon: string) => (
      <button className={`zone-chip ${p === me && zoneCards(p, z).some((c) => castOptions(g, me, c.iid).length > 0) ? 'castable' : ''}`} title={t.game.zoneNames[z]} onClick={(e) => { e.stopPropagation(); setZoneView(zoneView?.p === p && zoneView.zone === z ? null : { p, zone: z }); }}>
        {icon} {zoneCards(p, z).length}
      </button>
    );
    // The most combat damage this player took from one commander (21 loses).
    const commanderDamage = Math.max(0, ...Object.values(ps.commanderDamage ?? {}));
    return (
      <div ref={reg(`player:${p}`)} className={cls} onClick={() => onPlayerClick(p)}>
        <div className="hud-name">
          <strong>{p === me && ps.name ? t.game.nameYou(ps.name) : names[p]}</strong>
          {isActivePlayer(g, p) && <span className="turn-dot" title={t.game.turnOf(ours(p), teamName(p))} />}
        </div>
        <div className="life" key={ps.life}>♥ {ps.life}{floatsFor(`player:${p}`)}</div>
        {ps.pool && ps.pool.length > 0 && (
          <div className="pool" title={t.game.manaPool}>
            {ps.pool.map((m, i) => (
              <span key={i} className={`mana-dot mana-${m.colors.length === 1 ? m.colors[0] : 'any'}`}>{m.colors.length === 1 ? m.colors[0] : '✦'}</span>
            ))}
          </div>
        )}
        <div className="zones small">
          <span title={t.game.zoneNames.library}>📚 {ps.library.length}</span>
          <span title={t.game.zoneNames.hand}>✋ {ps.hand.length}</span>
          {zone('graveyard', '🪦')}
          {!!ps.poison && <span className="poison" title={t.game.poisonTitle}>☠ {ps.poison}</span>}
          {zone('exile', '🌀')}
          {ps.command && zone('command', '👑')}
          {commanderDamage > 0 && <span className="poison" title={t.game.commanderDamageTitle}>⚔ {commanderDamage}</span>}
        </div>
      </div>
    );
  };

  const phase = currentPhase(g);
  const myHand = g.players[me].hand;

  return (
    <div className="game">
      <div className="board" ref={boardRef} onClickCapture={swallowZoomClick}>
        {/* Opponents */}
        <div className="player-bar theirs">
          {opponents.map((o) => (
            <div key={o} className="seat">
              {hud(o)}
              <div className="opp-hand">
                {g.players[o].hand.map((c, i) => (
                  <div key={c.iid} className="card-back" style={{ '--i': i - (g.players[o].hand.length - 1) / 2 } as CSSProperties} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className={`fields theirs ${multi ? 'multi' : ''}`}>{opponents.map(field)}</div>

        {/* Center: phases, prompt, actions */}
        <div className={`center-bar ${iAct && g.winner === null ? 'your-move' : ''} ${waiting ? 'waiting' : ''}`}>
          <ol className="phases" aria-label={t.game.turnOf(myTurn, teamName(g.active))}>
            {g.mulligan ? (
              <li className="current">{t.game.steps.mulligan}</li>
            ) : (
              PHASES.map((ph) => (
                <li key={ph} className={`${ph === phase ? 'current' : ''} ${myTurn ? 'mine' : 'theirs'}`}>{t.game.phases[ph]}</li>
              ))
            )}
          </ol>
          <div className="prompt">
            <span className="small muted">{g.mulligan ? '' : `${t.game.turnOf(myTurn, teamName(g.active))} · ${t.game.turnLabel(g.turn, t.game.phases[phase])}`}</span>
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
                  {...zoomable(item.card)}
                  onClick={() => pickTarget({ kind: 'spell', iid: item.iid })}
                >
                  <img src={show.imageSmall(item.card)} alt={show.name(item.card)} draggable={false} />
                  <span className="small">{names[item.controller]}</span>
                </div>
              ))}
            </div>
          )}
          {/* Targets in a graveyard: pick them here. */}
          {targeting && slotSpec?.kind === 'card' && (
            <div className="choice-dock">
              <div className="choice-panel">
                <div className="choice-cards">
                  {legalTargets(g, me, slotSpec, undefined, targetingSource).map((tg) => {
                    const found = tg.kind === 'card' ? findInGraveyard(g, tg.iid) : undefined;
                    if (!found) return null;
                    return (
                      <figure key={tg.kind === 'card' ? tg.iid : ''} className="grave-pick">
                        <img
                          className={`choice-card ${isPicked(tg) ? 'selected' : ''}`}
                          src={show.imageSmall(found.inst.card)}
                          alt={show.name(found.inst.card)}
                          onClick={() => pickTarget(tg)}
                          {...zoomable(found.inst.card)}
                        />
                        <figcaption className="small muted">{names[found.owner]}</figcaption>
                      </figure>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {g.pending && g.pending.choice.player === me && g.pending.choice.kind !== 'targets' && g.winner === null && (() => {
            const choice = g.pending.choice;
            // One panel per choice: a choice following another one right away must not keep its picks.
            const panel = (
              <ChoicePanel
                key={choiceKey(choice)}
                choice={choice}
                title={choicePrompt(t, choice, show.nameOf, names)}
                onAnswer={(answer) => act({ type: 'choose', answer })}
                onPreview={setPreview}
              />
            );
            // Scry, surveil and damage order open a window over the whole page (outside the table's layout).
            return choice.kind === 'arrange'
              ? createPortal(<div className="choice-dock modal">{panel}</div>, document.body)
              : <div className="choice-dock">{panel}</div>;
          })()}
        </div>

        <div className={`fields mine ${multi ? 'multi' : ''}`}>{[me, ...mates].map(field)}</div>

        {/* You (and your teammate) */}
        <div className="player-bar mine">
          {hud(me)}
          {mates.map((m) => <Fragment key={m}>{hud(m)}</Fragment>)}
          {/* Your command zone: commanders are cast from here, like cards in hand (with their tax). */}
          {(g.players[me].command?.length ?? 0) > 0 && (
            <div className="command-zone" title={t.game.zoneNames.command}>
              {g.players[me].command!.map((c) => {
                const castable = castOptions(g, me, c.iid).length > 0;
                const tax = 2 * (g.players[me].commanderCasts?.[c.iid] ?? 0);
                return (
                  <div
                    key={c.iid}
                    className={`hand-card commander-card ${castable ? 'playable' : ''}`}
                    onClick={() => iAct && playCard(c.iid, c.card)}
                    {...zoomable(c.card)}
                  >
                    <img src={show.imageSmall(c.card)} alt={show.name(c.card)} draggable={false} />
                    <span className="crown" title={t.game.zoneNames.command}>👑</span>
                    {tax > 0 && <span className="tax" title={t.game.commanderTax(tax)}>+{tax}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="my-hand">
            {myHand.map(({ iid, card }) => {
              const playable = (landFaces(card).length > 0 && canPlayLand) || castOptions(g, me, iid).length > 0;
              const selected = targeting?.iid === iid || xPick?.iid === iid || modePick?.iid === iid || bottomSel.includes(iid);
              const status = engineStatus(card);
              return (
                <div
                  key={iid}
                  ref={reg(`hand:${iid}`)}
                  className={`hand-card ${playable ? 'playable' : ''} ${selected ? 'selected' : ''}`}
                  onClick={() => onHandClick(iid, card)}
                  {...zoomable(card)}
                >
                  <img src={show.imageSmall(card)} alt={show.name(card)} draggable={false} />
                  {status !== 'ok' && <span className={`engine-badge ${status}`} title={t.game.engineStatus[status]}>{t.game.engineBadge[status]}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {fx.banner && (
          <div key={fx.banner.id} className={`turn-banner ${ours(fx.banner.player) ? 'mine' : 'theirs'}`}>
            {t.game.turnBanner(ours(fx.banner.player), teamName(fx.banner.player))}
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
                {zoneCards(zoneView.p, zoneView.zone).length === 0 && <span className="muted">{t.game.emptyZone}</span>}
                {[...zoneCards(zoneView.p, zoneView.zone)].reverse().map((c: CardInst) => {
                  // Flashback cards in your graveyard and adventurers in your exile can be cast from here.
                  const castable = zoneView.p === me && castOptions(g, me, c.iid).length > 0;
                  return (
                    <img
                      key={c.iid}
                      className={castable ? 'castable' : ''}
                      src={show.imageSmall(c.card)}
                      alt={show.name(c.card)}
                      onClick={castable ? () => { setZoneView(null); playCard(c.iid, c.card); } : undefined}
                      {...zoomable(c.card)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <Lines container={boardRef} registry={registry} lines={lines} />
      </div>

      {zoom && (
        <div className="card-zoom" onClick={() => setZoom(null)}>
          <img src={show.imageNormal(zoom)} alt={show.name(zoom)} />
        </div>
      )}

      <aside className="game-side">
        {notice && <div className="small play-notice">{notice}</div>}
        <div className="side-tabs" role="tablist" aria-label={t.common.log}>
          {(['card', 'log', 'settings'] as SideTab[]).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={sideTab === tab} className={sideTab === tab ? 'on' : ''} onClick={() => setSideTab(tab)}>
              {t.game.sideTabs[tab]}
            </button>
          ))}
        </div>
        {sideTab === 'card' && (() => {
          // The hovered card, large; when it's in your hand, its engine status and the ways to play it now.
          const inHand = preview ? g.players[me].hand.find((c) => c.card.id === preview.id) : undefined;
          const items = inHand && iAct && !g.pending && !targeting ? playItems(inHand.iid, inHand.card) : [];
          const status = preview ? engineStatus(preview) : null;
          return (
            <div className="side-card">
              {preview?.imageNormal ? (
                <img className="card-preview" src={show.imageNormal(preview)} alt={show.name(preview)} />
              ) : (
                <div className="card-preview placeholder muted small">{t.common.hoverPreview}</div>
              )}
              {status && <span className={`engine-status ${status}`}>{t.game.engineStatus[status]}</span>}
              {items.length > 0 && (
                <div className="side-play">
                  <span className="small muted">{t.game.playThisCard}</span>
                  {items.map((it) => (
                    <button key={it.key} type="button" className="ability-option" onClick={() => { setCastMenu(null); it.run(); }}>{it.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        {sideTab === 'log' && (
          <ol className="log small" reversed>
            {[...g.log].reverse().map((l, i) => (
              <li key={g.log.length - i} className={`${i < fx.freshLog ? 'fresh' : ''} ${l.k === 'turn' ? 'log-turn' : ''}`}>{logText(t, l, names, me, show.nameOf)}</li>
            ))}
          </ol>
        )}
        {sideTab === 'settings' && g.winner === null && (
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
