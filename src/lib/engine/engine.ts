import type { Card } from '../../types';
import { shuffle, type Rng } from '../goldfish';
import {
  findPayment, hasFirstStrike, hasInstantSpeed, hasKeyword, isCreature, isInstantOrSorcery, isLandCard, manaColors,
  parseCost, parseEffects, power, targetKind, toughness, type ManaSource,
} from './rules';

export type PlayerId = 0 | 1;

export interface CardInst {
  iid: string;
  card: Card;
}

export interface Permanent extends CardInst {
  controller: PlayerId;
  tapped: boolean;
  /** Summoning sick: entered this turn, can't attack or tap for mana. */
  sick: boolean;
  damage: number;
  deathtouched: boolean;
  /** "Until end of turn" boosts from pump spells. */
  pumpPower: number;
  pumpToughness: number;
}

export interface StackItem extends CardInst {
  controller: PlayerId;
  target?: Target;
}

export interface PlayerState {
  name: string;
  life: number;
  library: CardInst[];
  hand: CardInst[];
  graveyard: CardInst[];
  exile: CardInst[];
  landPlayed: boolean;
}

/** Untap, upkeep and draw happen automatically at the start of a turn. */
export type Step = 'mulligan' | 'main1' | 'attack' | 'block' | 'main2';

/**
 * Why both players get a chance to cast instants. Like MTG Arena, priority is only
 * offered at these moments, and skipped for a player with nothing castable.
 */
export type WindowReason =
  | 'main' // a spell was cast in a main phase
  | 'attack' // attackers declared, before blocks
  | 'block' // blockers declared, before damage
  | 'end'; // end of turn

export interface Priority {
  player: PlayerId;
  /** Consecutive passes: two means everyone passed. */
  passes: number;
  reason: WindowReason;
}

export interface MulliganState {
  /** Who is deciding now. Players decide in turn order. */
  player: PlayerId;
  count: [number, number];
  kept: [boolean, boolean];
}

/** Game log entries are data, rendered in each viewer's language (src/i18n). Card names stay as printed. */
export type LogEntry =
  | { k: 'goesFirst'; p: PlayerId }
  | { k: 'turn'; n: number; p: PlayerId }
  | { k: 'mulligan'; p: PlayerId; keeping: number }
  | { k: 'keep'; p: PlayerId; n: number }
  | { k: 'playLand'; p: PlayerId; card: string }
  | { k: 'cast'; p: PlayerId; card: string; targetCard?: string; targetPlayer?: PlayerId }
  | { k: 'enters'; card: string }
  | { k: 'attack'; p: PlayerId; cards: string[] }
  | { k: 'blocked'; card: string; by: string[] }
  | { k: 'damage'; card: string; n: number; target: string }
  | { k: 'damagePlayer'; card: string; n: number; p: PlayerId }
  | { k: 'dies'; card: string }
  | { k: 'destroyed'; card: string }
  | { k: 'exiled'; card: string }
  | { k: 'pump'; card: string; power: number; toughness: number }
  | { k: 'countered'; card: string }
  | { k: 'fizzles'; card: string }
  | { k: 'notSimulated'; card: string }
  | { k: 'gainLife'; p: PlayerId; n: number }
  | { k: 'discard'; p: PlayerId; card: string }
  | { k: 'emptyLibrary'; p: PlayerId }
  | { k: 'concede'; p: PlayerId }
  | { k: 'wins'; p: PlayerId }
  | { k: 'draw' };

export interface GameState {
  players: [PlayerState, PlayerState];
  battlefield: Permanent[];
  stack: StackItem[];
  active: PlayerId;
  turn: number;
  step: Step;
  priority: Priority | null;
  mulligan: MulliganState | null;
  attackers: string[];
  /** attacker iid → blocker iids */
  blocks: Record<string, string[]>;
  winner: PlayerId | 'draw' | null;
  log: LogEntry[];
  /** Random generator state, so shuffles during the game are reproducible. Secret: redacted for clients. */
  seed: number;
}

export type Target =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'permanent'; iid: string }
  | { kind: 'spell'; iid: string };

/** Actions are always taken by `actor(state)`. */
export type Action =
  | { type: 'mulligan' }
  | { type: 'keep'; bottom: string[] }
  | { type: 'playLand'; iid: string }
  | { type: 'cast'; iid: string; target?: Target }
  | { type: 'pass' }
  | { type: 'declareAttackers'; attackers: string[] }
  | { type: 'declareBlockers'; blocks: Record<string, string[]> }
  | { type: 'concede'; player: PlayerId };

/** Why an action was refused. Rendered in the player's language (src/i18n). */
export type GameErrorCode =
  | 'gameOver' | 'keepFirst' | 'notMulliganTime' | 'noMoreMulligans' | 'chooseBottom' | 'notInHand'
  | 'landTiming' | 'landAlreadyPlayed' | 'notALand' | 'notASpell' | 'sorcerySpeed' | 'castTiming'
  | 'needsTarget' | 'targetMustBe' | 'counterFilter' | 'notEnoughMana' | 'declareBlockersFirst'
  | 'notAttackStep' | 'cannotAttack' | 'notBlockStep' | 'notAttacking' | 'menace' | 'cannotBlock';

export type ErrorParams = Record<string, string | number>;

export class IllegalAction extends Error {
  constructor(
    readonly code: GameErrorCode,
    readonly params: ErrorParams = {},
  ) {
    super(code);
  }
}

export const opponent = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** Who has to act now. */
export function actor(s: GameState): PlayerId | null {
  if (s.winner !== null) return null;
  if (s.mulligan) return s.mulligan.player;
  if (s.priority) return s.priority.player;
  return s.step === 'block' ? opponent(s.active) : s.active;
}

// ---------- Queries ----------

export const findPermanent = (s: GameState, iid: string) => s.battlefield.find((p) => p.iid === iid);

export const creaturesOf = (s: GameState, p: PlayerId) =>
  s.battlefield.filter((x) => x.controller === p && isCreature(x.card));

export const powerOf = (perm: Permanent) => power(perm.card) + perm.pumpPower;
export const toughnessOf = (perm: Permanent) => toughness(perm.card) + perm.pumpToughness;

export function manaSources(s: GameState, p: PlayerId): ManaSource[] {
  return s.battlefield
    .filter((x) => x.controller === p && !x.tapped && !(isCreature(x.card) && x.sick))
    .map((x) => ({ iid: x.iid, colors: manaColors(x.card) }))
    .filter((x) => x.colors.length > 0);
}

export const canPay = (s: GameState, p: PlayerId, card: Card) =>
  findPayment(manaSources(s, p), parseCost(card.manaCost)) !== null;

export function canAttack(perm: Permanent): boolean {
  return (
    isCreature(perm.card) && !perm.tapped && (!perm.sick || hasKeyword(perm.card, 'haste')) &&
    !hasKeyword(perm.card, 'defender') && powerOf(perm) > 0
  );
}

export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
  if (!isCreature(blocker.card) || blocker.tapped) return false;
  if (hasKeyword(attacker.card, 'flying')) {
    return hasKeyword(blocker.card, 'flying') || hasKeyword(blocker.card, 'reach');
  }
  return true;
}

export const isMainStep = (s: GameState) => s.step === 'main1' || s.step === 'main2';

/** Can `p` legally cast `card` right now (timing and mana; targets aside)? */
export function canCastNow(s: GameState, p: PlayerId, card: Card): boolean {
  if (isLandCard(card) || s.mulligan || actor(s) !== p) return false;
  const timing = s.priority ? hasInstantSpeed(card) : isMainStep(s) && s.active === p;
  return timing && canPay(s, p, card);
}

/** Does the spell have something sensible to target? (Counterspells need an opposing spell.) */
export function hasUsefulTarget(s: GameState, p: PlayerId, card: Card): boolean {
  const effects = parseEffects(card);
  const kind = targetKind(effects);
  if (kind === 'spell') {
    const counter = effects.find((e) => e.kind === 'counter');
    return s.stack.some((item) => item.controller !== p && counter?.kind === 'counter' && counterAllows(counter.filter, item.card));
  }
  if (kind === 'creature') return s.battlefield.some((x) => isCreature(x.card));
  return true;
}

const counterAllows = (filter: 'any' | 'creature' | 'noncreature', card: Card) =>
  filter === 'any' || (filter === 'creature') === isCreature(card);

// ---------- Setup ----------

export interface NewGameOptions {
  decks: [Card[], Card[]];
  names: [string, string];
  first: PlayerId;
  rng?: Rng;
  /** Start with London mulligan decisions (default true). */
  mulligans?: boolean;
}

export function newGame({ decks, names, first, rng = Math.random, mulligans = true }: NewGameOptions): GameState {
  const player = (p: PlayerId): PlayerState => ({
    name: names[p],
    life: 20,
    library: shuffle(decks[p].map((card, i) => ({ iid: `${p}-${i}`, card })), rng),
    hand: [],
    graveyard: [],
    exile: [],
    landPlayed: false,
  });
  const d: GameState = {
    players: [player(0), player(1)],
    battlefield: [],
    stack: [],
    active: first,
    turn: 0,
    step: 'mulligan',
    priority: null,
    mulligan: null,
    attackers: [],
    blocks: {},
    winner: null,
    log: [{ k: 'goesFirst', p: first }],
    seed: Math.floor(rng() * 2 ** 32),
  };
  draw(d, 0, 7);
  draw(d, 1, 7);
  if (mulligans) d.mulligan = { player: first, count: [0, 0], kept: [false, false] };
  else beginTurn(d, first, true);
  return d;
}

// ---------- Mutating helpers (only ever used on a fresh clone) ----------

/** mulberry32: small, fast, good enough for shuffling. */
function random(d: GameState): number {
  d.seed = (d.seed + 0x6d2b79f5) | 0;
  let t = d.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function log(d: GameState, entry: LogEntry) {
  d.log.push(entry);
  if (d.log.length > 200) d.log.splice(0, d.log.length - 200);
}

function draw(d: GameState, p: PlayerId, n: number) {
  for (let i = 0; i < n; i++) {
    const card = d.players[p].library.shift();
    if (!card) {
      log(d, { k: 'emptyLibrary', p });
      d.winner = d.winner === null ? opponent(p) : 'draw';
      return;
    }
    d.players[p].hand.push(card);
  }
}

function beginTurn(d: GameState, p: PlayerId, skipDraw: boolean) {
  d.active = p;
  d.turn++;
  d.step = 'main1';
  d.players[p].landPlayed = false;
  for (const perm of d.battlefield) {
    if (perm.controller === p) {
      perm.tapped = false;
      perm.sick = false;
    }
  }
  log(d, { k: 'turn', n: d.turn, p });
  if (!skipDraw) draw(d, p, 1);
}

function endTurn(d: GameState) {
  for (const perm of d.battlefield) {
    perm.damage = 0;
    perm.deathtouched = false;
    perm.pumpPower = 0;
    perm.pumpToughness = 0;
  }
  const me = d.players[d.active];
  // Cleanup: discard down to 7, highest mana value first (simplification: no choice).
  while (me.hand.length > 7) {
    const worst = me.hand.reduce((a, b) => (b.card.cmc > a.card.cmc ? b : a));
    me.hand = me.hand.filter((c) => c !== worst);
    me.graveyard.push(worst);
    log(d, { k: 'discard', p: d.active, card: worst.card.name });
  }
  beginTurn(d, opponent(d.active), false);
}

const newPermanent = (inst: CardInst, controller: PlayerId): Permanent => ({
  iid: inst.iid, card: inst.card, controller, tapped: false, sick: true, damage: 0, deathtouched: false, pumpPower: 0, pumpToughness: 0,
});

function removePermanent(d: GameState, perm: Permanent, zone: 'graveyard' | 'exile') {
  d.battlefield = d.battlefield.filter((x) => x.iid !== perm.iid);
  d.players[perm.controller][zone].push({ iid: perm.iid, card: perm.card });
}

/** State-based actions: lethal damage, 0 life. */
function checkStateBased(d: GameState) {
  for (const perm of [...d.battlefield]) {
    if (isCreature(perm.card) && (perm.deathtouched || perm.damage >= toughnessOf(perm))) {
      removePermanent(d, perm, 'graveyard');
      log(d, { k: 'dies', card: perm.card.name });
    }
  }
  if (d.winner !== null) return;
  const dead = ([0, 1] as PlayerId[]).filter((p) => d.players[p].life <= 0);
  if (dead.length === 2) d.winner = 'draw';
  else if (dead.length === 1) d.winner = opponent(dead[0]);
  if (d.winner !== null) log(d, d.winner === 'draw' ? { k: 'draw' } : { k: 'wins', p: d.winner });
}

function dealDamage(d: GameState, source: CardInst, controller: PlayerId, target: Permanent | PlayerId, amount: number) {
  if (amount <= 0) return;
  if (typeof target === 'number') {
    d.players[target].life -= amount;
    log(d, { k: 'damagePlayer', card: source.card.name, n: amount, p: target });
  } else {
    target.damage += amount;
    if (hasKeyword(source.card, 'deathtouch')) target.deathtouched = true;
    log(d, { k: 'damage', card: source.card.name, n: amount, target: target.card.name });
  }
  if (hasKeyword(source.card, 'lifelink')) d.players[controller].life += amount;
}

function resolveCombat(d: GameState) {
  const def = opponent(d.active);
  const get = (iid: string) => findPermanent(d, iid);
  const involved = [...d.attackers, ...Object.values(d.blocks).flat()].map(get).filter((x) => x !== undefined);
  const strikeSteps = involved.some((x) => hasFirstStrike(x.card)) ? [true, false] : [false];

  for (const firstStrikeStep of strikeSteps) {
    const dealsNow = (x: Permanent) =>
      firstStrikeStep
        ? hasFirstStrike(x.card)
        : !hasKeyword(x.card, 'first strike') || hasKeyword(x.card, 'double strike');

    // Collect all damage first: combat damage is dealt simultaneously.
    const hits: { source: Permanent; target: Permanent | PlayerId; amount: number }[] = [];

    for (const aid of d.attackers) {
      const a = get(aid);
      if (!a || !dealsNow(a)) continue;
      let remaining = powerOf(a);
      const declared = d.blocks[aid] ?? [];
      if (declared.length === 0) {
        hits.push({ source: a, target: def, amount: remaining });
        continue;
      }
      const blockers = declared.map(get).filter((x) => x !== undefined);
      const trample = hasKeyword(a.card, 'trample');
      blockers.forEach((b, i) => {
        const lethal = hasKeyword(a.card, 'deathtouch') ? 1 : Math.max(0, toughnessOf(b) - b.damage);
        const isLast = i === blockers.length - 1;
        const amount = isLast && !trample ? remaining : Math.min(remaining, lethal);
        hits.push({ source: a, target: b, amount });
        remaining -= amount;
      });
      // A blocked creature only hits the player if it tramples (even if its blockers are gone).
      if (trample && remaining > 0) hits.push({ source: a, target: def, amount: remaining });
    }

    for (const [aid, bids] of Object.entries(d.blocks)) {
      const a = get(aid);
      if (!a) continue;
      for (const bid of bids) {
        const b = get(bid);
        if (b && dealsNow(b)) hits.push({ source: b, target: a, amount: powerOf(b) });
      }
    }

    for (const h of hits) dealDamage(d, h.source, h.source.controller, h.target, h.amount);
    checkStateBased(d);
    if (d.winner !== null) return;
  }
}

// ---------- Stack and priority ----------

function resolveTop(d: GameState) {
  const item = d.stack.pop()!;
  const owner = d.players[item.controller];

  if (!isInstantOrSorcery(item.card)) {
    d.battlefield.push(newPermanent(item, item.controller));
    log(d, { k: 'enters', card: item.card.name });
    return;
  }

  // Targets are checked again on resolution: if the target is gone, the spell does nothing.
  const t = item.target;
  let target: Permanent | PlayerId | StackItem | undefined;
  if (t?.kind === 'player') target = t.player;
  else if (t?.kind === 'permanent') target = findPermanent(d, t.iid);
  else if (t?.kind === 'spell') target = d.stack.find((x) => x.iid === t.iid);
  if (t && target === undefined) {
    log(d, { k: 'fizzles', card: item.card.name });
    owner.graveyard.push({ iid: item.iid, card: item.card });
    return;
  }

  const effects = parseEffects(item.card);
  if (!effects.length) log(d, { k: 'notSimulated', card: item.card.name });
  const perm = target !== undefined && typeof target !== 'number' && 'tapped' in target ? target : undefined;
  for (const e of effects) {
    if (e.kind === 'damage') {
      const t = e.target === 'each-opponent' ? opponent(item.controller) : typeof target === 'number' ? target : perm;
      if (t !== undefined) dealDamage(d, item, item.controller, t, e.amount);
    } else if (e.kind === 'destroy' && perm && d.battlefield.includes(perm)) {
      removePermanent(d, perm, e.exile ? 'exile' : 'graveyard');
      log(d, { k: e.exile ? 'exiled' : 'destroyed', card: perm.card.name });
    } else if (e.kind === 'pump' && perm) {
      perm.pumpPower += e.power;
      perm.pumpToughness += e.toughness;
      log(d, { k: 'pump', card: perm.card.name, power: e.power, toughness: e.toughness });
    } else if (e.kind === 'counter' && target !== undefined && typeof target !== 'number' && !('tapped' in target)) {
      d.stack = d.stack.filter((x) => x !== target);
      d.players[target.controller].graveyard.push({ iid: target.iid, card: target.card });
      log(d, { k: 'countered', card: target.card.name });
    } else if (e.kind === 'draw') {
      draw(d, item.controller, e.n);
    } else if (e.kind === 'gainLife') {
      owner.life += e.n;
      log(d, { k: 'gainLife', p: item.controller, n: e.n });
    }
  }
  owner.graveyard.push({ iid: item.iid, card: item.card });
}

/** Whether `p` should be asked to act in a priority window (Arena-style auto-pass otherwise). */
function wantsPriority(d: GameState, p: PlayerId): boolean {
  if (d.stack.at(-1)?.controller === p) return false; // don't respond to your own spell
  return d.players[p].hand.some((c) => canCastNow(d, p, c.card) && hasUsefulTarget(d, p, c.card));
}

function openWindow(d: GameState, reason: WindowReason, player: PlayerId, passes: number) {
  d.priority = { player, passes, reason };
  autoPass(d);
}

function autoPass(d: GameState) {
  while (d.priority && d.winner === null && !wantsPriority(d, d.priority.player)) passOnce(d);
}

function passOnce(d: GameState) {
  const pr = d.priority!;
  pr.passes++;
  if (pr.passes < 2) {
    pr.player = opponent(pr.player);
    return;
  }
  if (d.stack.length) {
    resolveTop(d);
    checkStateBased(d);
    if (d.winner !== null || (!d.stack.length && pr.reason === 'main')) {
      d.priority = null;
      return;
    }
    // After something resolves, the active player gets priority again.
    d.priority = { player: d.active, passes: 0, reason: pr.reason };
    return;
  }
  d.priority = null;
  closeWindow(d, pr.reason);
}

/** Everyone passed with an empty stack: the game moves on. */
function closeWindow(d: GameState, reason: WindowReason) {
  if (reason === 'attack') {
    d.attackers = d.attackers.filter((iid) => findPermanent(d, iid));
    if (!d.attackers.length) {
      d.step = 'main2';
      return;
    }
    d.step = 'block';
    // Skip the blockers prompt when the defender has nothing that could block.
    const attackers = d.attackers.map((iid) => findPermanent(d, iid)!);
    const canAnyBlock = creaturesOf(d, opponent(d.active)).some((b) => attackers.some((a) => canBlock(b, a)));
    if (!canAnyBlock) setBlocks(d, {});
  } else if (reason === 'block') {
    resolveCombat(d);
    d.attackers = [];
    d.blocks = {};
    d.step = 'main2';
  } else if (reason === 'end') {
    endTurn(d);
  }
}

function setBlocks(d: GameState, blocks: Record<string, string[]>) {
  d.blocks = blocks;
  openWindow(d, 'block', d.active, 0);
}

// ---------- Actions ----------

export function apply(state: GameState, action: Action): GameState {
  if (state.winner !== null) throw new IllegalAction('gameOver');
  const d = structuredClone(state);

  if (action.type === 'concede') {
    d.winner = opponent(action.player);
    log(d, { k: 'concede', p: action.player });
    return d;
  }

  const p = actor(d)!;
  const me = d.players[p];

  if (d.mulligan && action.type !== 'mulligan' && action.type !== 'keep') {
    throw new IllegalAction('keepFirst');
  }

  switch (action.type) {
    case 'mulligan': {
      const m = d.mulligan;
      if (!m) throw new IllegalAction('notMulliganTime');
      if (m.count[p] >= 7) throw new IllegalAction('noMoreMulligans');
      m.count[p]++;
      me.library = shuffle([...me.library, ...me.hand], () => random(d));
      me.hand = [];
      draw(d, p, 7);
      log(d, { k: 'mulligan', p, keeping: 7 - m.count[p] });
      break;
    }

    case 'keep': {
      const m = d.mulligan;
      if (!m) throw new IllegalAction('notMulliganTime');
      const need = Math.min(m.count[p], me.hand.length);
      const bottom = [...new Set(action.bottom ?? [])];
      if (bottom.length !== need) throw new IllegalAction('chooseBottom', { n: need });
      for (const iid of bottom) {
        const inst = me.hand.find((c) => c.iid === iid);
        if (!inst) throw new IllegalAction('notInHand');
        me.hand = me.hand.filter((c) => c !== inst);
        me.library.push(inst);
      }
      m.kept[p] = true;
      log(d, { k: 'keep', p, n: me.hand.length });
      if (!m.kept[opponent(p)]) {
        m.player = opponent(p);
      } else {
        d.mulligan = null;
        beginTurn(d, d.active, true);
      }
      break;
    }

    case 'playLand': {
      if (d.priority || !isMainStep(d) || p !== d.active) throw new IllegalAction('landTiming');
      if (me.landPlayed) throw new IllegalAction('landAlreadyPlayed');
      const inst = me.hand.find((c) => c.iid === action.iid);
      if (!inst || !isLandCard(inst.card)) throw new IllegalAction('notALand');
      me.hand = me.hand.filter((c) => c !== inst);
      d.battlefield.push(newPermanent(inst, p));
      me.landPlayed = true;
      log(d, { k: 'playLand', p, card: inst.card.name });
      break;
    }

    case 'cast': {
      const inst = me.hand.find((c) => c.iid === action.iid);
      if (!inst || isLandCard(inst.card)) throw new IllegalAction('notASpell');
      if (d.priority) {
        if (!hasInstantSpeed(inst.card)) throw new IllegalAction('sorcerySpeed', { card: inst.card.name });
      } else if (!isMainStep(d) || p !== d.active) {
        throw new IllegalAction('castTiming');
      }

      const effects = parseEffects(inst.card);
      const needs = targetKind(effects);
      const targetLog: { targetCard?: string; targetPlayer?: PlayerId } = {};
      if (needs) {
        const t = action.target;
        if (!t) throw new IllegalAction('needsTarget', { card: inst.card.name });
        if (t.kind === 'player') {
          if (needs !== 'any' && needs !== 'player') throw new IllegalAction('targetMustBe', { kind: needs });
          targetLog.targetPlayer = t.player;
        } else if (t.kind === 'permanent') {
          const perm = findPermanent(d, t.iid);
          if (needs !== 'any' && needs !== 'creature') throw new IllegalAction('targetMustBe', { kind: needs });
          if (!perm || !isCreature(perm.card)) throw new IllegalAction('targetMustBe', { kind: 'creature' });
          targetLog.targetCard = perm.card.name;
        } else {
          const counter = effects.find((e) => e.kind === 'counter');
          const item = d.stack.find((x) => x.iid === t.iid);
          if (needs !== 'spell' || !item || counter?.kind !== 'counter') throw new IllegalAction('targetMustBe', { kind: 'spell' });
          if (!counterAllows(counter.filter, item.card)) throw new IllegalAction('counterFilter', { card: inst.card.name, filter: counter.filter });
          targetLog.targetCard = item.card.name;
        }
      }

      const payment = findPayment(manaSources(d, p), parseCost(inst.card.manaCost));
      if (!payment) throw new IllegalAction('notEnoughMana', { card: inst.card.name });
      for (const iid of payment) findPermanent(d, iid)!.tapped = true;
      me.hand = me.hand.filter((c) => c !== inst);
      d.stack.push({ ...inst, controller: p, target: needs ? action.target : undefined });
      log(d, { k: 'cast', p, card: inst.card.name, ...targetLog });

      // The opponent may respond.
      if (d.priority) {
        d.priority.passes = 0;
        d.priority.player = opponent(p);
        autoPass(d);
      } else {
        openWindow(d, 'main', opponent(p), 0);
      }
      break;
    }

    case 'pass': {
      if (d.priority) {
        passOnce(d);
        autoPass(d);
      } else if (d.step === 'main1') {
        // Skip combat entirely when nothing can attack.
        d.step = creaturesOf(d, p).some(canAttack) ? 'attack' : 'main2';
      } else if (d.step === 'attack') {
        d.step = 'main2';
      } else if (d.step === 'main2') {
        // The active player is done; the opponent gets an end-of-turn window.
        openWindow(d, 'end', opponent(p), 1);
      } else {
        throw new IllegalAction('declareBlockersFirst');
      }
      break;
    }

    case 'declareAttackers': {
      if (d.step !== 'attack' || d.priority) throw new IllegalAction('notAttackStep');
      const attackers = [...new Set(action.attackers)].map((iid) => {
        const perm = findPermanent(d, iid);
        if (!perm || perm.controller !== p || !canAttack(perm)) throw new IllegalAction('cannotAttack');
        return perm;
      });
      if (!attackers.length) {
        d.step = 'main2';
        break;
      }
      for (const a of attackers) if (!hasKeyword(a.card, 'vigilance')) a.tapped = true;
      d.attackers = attackers.map((a) => a.iid);
      d.blocks = {};
      log(d, { k: 'attack', p, cards: attackers.map((a) => a.card.name) });
      openWindow(d, 'attack', opponent(p), 1);
      break;
    }

    case 'declareBlockers': {
      if (d.step !== 'block' || d.priority) throw new IllegalAction('notBlockStep');
      const used = new Set<string>();
      const blocks: Record<string, string[]> = {};
      for (const [aid, bids] of Object.entries(action.blocks)) {
        const a = findPermanent(d, aid);
        if (!a || !d.attackers.includes(aid)) throw new IllegalAction('notAttacking');
        if (!bids.length) continue;
        if (hasKeyword(a.card, 'menace') && bids.length < 2) {
          throw new IllegalAction('menace', { card: a.card.name });
        }
        for (const bid of bids) {
          const b = findPermanent(d, bid);
          if (!b || b.controller !== p || used.has(bid) || !canBlock(b, a)) {
            throw new IllegalAction('cannotBlock', { blocker: b?.card.name ?? '?', attacker: a.card.name });
          }
          used.add(bid);
        }
        blocks[aid] = bids;
        log(d, { k: 'blocked', card: a.card.name, by: bids.map((b) => findPermanent(d, b)!.card.name) });
      }
      setBlocks(d, blocks);
      break;
    }
  }

  checkStateBased(d);
  return d;
}
