import type { Card } from '../../types';
import { shuffle, type Rng } from '../goldfish';
import {
  cardTypes, findPayment, hasInstantSpeed, hasKeyword, isCreature, isInstantOrSorcery, isLandCard,
  activatedOf, entersTapped, entersWithCounters, isPlaneswalker, isToken, manaColors, startingLoyalty, parseCost, power, spellSpec, tokenCard, toughness, triggersOf,
  type AbilitySpec, type Affected, type Amount, type CounterKind, type Effect, type Keyword, type ManaSource, type Selector,
  type ActivatedSpec, type ObjectEvent, type TargetFilter, type TargetSpec, type TriggerEvent,
} from './rules';

export type PlayerId = 0 | 1;

export interface CardInst {
  iid: string;
  card: Card;
}

/** A lasting change to a permanent's power, toughness or abilities. */
export interface Boost {
  power: number;
  toughness: number;
  keywords: Keyword[];
  until: 'endOfTurn';
}

export interface Permanent extends CardInst {
  controller: PlayerId;
  tapped: boolean;
  /** Summoning sick: entered this turn, can't attack or tap for mana. */
  sick: boolean;
  damage: number;
  deathtouched: boolean;
  counters: Partial<Record<CounterKind, number>>;
  boosts: Boost[];
  /** Indexes of "once each turn" abilities already activated this turn. */
  used?: number[];
}

export interface StackItem extends CardInst {
  controller: PlayerId;
  /** Chosen targets, one list per target slot of the spell or ability. */
  targets: Target[][];
  /** Set for an ability: the rules to resolve. `card` is its source, which stays where it is. */
  ability?: AbilitySpec;
  /** The value chosen for X when cast. */
  x?: number;
  /** For an ability: the permanent it comes from ("this creature gets +1/+1"). */
  source?: string;
}

/** A triggered ability waiting to be put on the stack (the next time a player would get priority). */
export interface Triggered {
  source: CardInst;
  controller: PlayerId;
  ability: AbilitySpec;
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

/**
 * Untap, upkeep and draw happen automatically at the start of a turn. The game only stops in
 * the upkeep when abilities trigger there.
 */
export type Step = 'mulligan' | 'upkeep' | 'main1' | 'attack' | 'block' | 'main2';

/**
 * Why both players get a chance to cast instants. Like MTG Arena, priority is only
 * offered at these moments, and skipped for a player with nothing castable.
 */
export type WindowReason =
  | 'upkeep' // upkeep triggers are on the stack; the draw comes after
  | 'begin' // start of a turn, after the draw (full control only)
  | 'main' // a spell was cast in a main phase
  | 'combat' // beginning of combat, before attackers (full control only)
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

// ---------- Choices ----------

/** Why a player is asked to choose; decides the prompt and how the bot answers. */
export type ChoicePurpose =
  | 'cleanupDiscard' // discard down to seven at end of turn
  | 'payOrCounter' // "counter target spell unless its controller pays {N}"
  | 'discard' // "discard a card": the discarding player chooses
  | 'discardChosen' // Duress: the spell's controller chooses from a revealed hand
  | 'scry'
  | 'surveil'
  | 'search' // library search: find up to N matching cards
  | 'triggerTargets' // targets for a triggered ability going on the stack
  | 'optional' // "you may …" on resolution
  | 'sacrifice' // an edict: choose what to sacrifice
  | 'sacrificeCost'; // "Sacrifice a creature:" when activating

/** Where "arrange" choices may put cards (scry: top/bottom, surveil: top/graveyard). */
export type ArrangeZone = 'top' | 'bottom' | 'graveyard';

/**
 * A decision that pauses the game until `player` answers it with a `choose` action.
 * `params` feed the prompt, e.g. the card name.
 */
export type Choice = { player: PlayerId; purpose: ChoicePurpose; params?: ErrorParams } & (
  | { kind: 'cards'; min: number; max: number; options: CardInst[] }
  /** Put each card in one of `zones`; for "top", listed first means on top. */
  | { kind: 'arrange'; cards: CardInst[]; zones: ArrangeZone[] }
  | { kind: 'mode'; min: number; max: number; modes: string[] }
  | { kind: 'yesNo' }
  /** Targets for each slot, like casting a spell. `source` is where the ability comes from. */
  | { kind: 'targets'; slots: TargetSpec[]; source: CardInst }
);

export type Answer =
  | { kind: 'cards'; iids: string[] }
  | { kind: 'arrange'; zones: Partial<Record<ArrangeZone, string[]>> }
  | { kind: 'mode'; modes: number[] }
  | { kind: 'yesNo'; yes: boolean }
  | { kind: 'targets'; targets: Target[][] };

export interface Pending {
  choice: Choice;
  /**
   * What continues once answered: the end of turn, the spell or ability being resolved, or a
   * triggered ability waiting for targets (`trigger`).
   */
  resume: 'cleanup' | 'effect' | 'trigger' | 'activation';
  trigger?: Triggered;
  /** An ability whose cost includes sacrificing a permanent: it goes on the stack once chosen. */
  activation?: { item: StackItem; named: LogTarget[] };
}

/** A spell or ability halfway through resolving (paused on a choice). */
export interface Resolving {
  item: StackItem;
  /** Targets still legal when resolution started, per slot. */
  legal: Target[][];
  /** Index of the effect to run next. */
  next: number;
  /** Within an effect that asks several players in turn ("each player discards"), who is next. */
  sub?: number;
  /** An optional ability ("you may") whose controller said yes. */
  accepted?: boolean;
  reason: WindowReason;
}

// ---------- Log ----------

export type LogTarget = { card: string } | { p: PlayerId };

/** Game log entries are data, rendered in each viewer's language (src/i18n). Card names stay as printed. */
export type LogEntry =
  | { k: 'goesFirst'; p: PlayerId }
  | { k: 'turn'; n: number; p: PlayerId }
  | { k: 'mulligan'; p: PlayerId; keeping: number }
  | { k: 'keep'; p: PlayerId; n: number }
  | { k: 'playLand'; p: PlayerId; card: string }
  | { k: 'cast'; p: PlayerId; card: string; targets?: LogTarget[] }
  | { k: 'activate'; p: PlayerId; card: string; targets?: LogTarget[] }
  | { k: 'enters'; card: string }
  /** A triggered ability goes on the stack. */
  | { k: 'triggers'; card: string; targets?: LogTarget[] }
  /** A triggered ability has no legal target and is removed. */
  | { k: 'noTarget'; card: string }
  /** The controller chose not to use a "you may" ability. */
  | { k: 'declined'; card: string }
  | { k: 'attack'; p: PlayerId; cards: string[] }
  | { k: 'attackPlaneswalker'; card: string; pw: string }
  | { k: 'loyalty'; card: string; n: number }
  | { k: 'blocked'; card: string; by: string[] }
  | { k: 'damage'; card: string; n: number; target: string }
  | { k: 'damagePlayer'; card: string; n: number; p: PlayerId }
  | { k: 'dies'; card: string }
  | { k: 'destroyed'; card: string }
  | { k: 'exiled'; card: string }
  | { k: 'pump'; card: string; power: number; toughness: number; keywords: Keyword[] }
  | { k: 'counters'; card: string; counter: CounterKind; n: number }
  | { k: 'countered'; card: string }
  | { k: 'paid'; p: PlayerId; n: number; card: string }
  | { k: 'fizzles'; card: string }
  | { k: 'notSimulated'; card: string }
  | { k: 'gainLife'; p: PlayerId; n: number }
  /** `cleanup`: discarding down to seven at end of turn. */
  | { k: 'discard'; p: PlayerId; card: string; cleanup?: boolean }
  | { k: 'loseLife'; p: PlayerId; n: number }
  | { k: 'mill'; p: PlayerId; n: number }
  | { k: 'scry'; p: PlayerId; n: number; bottom: number }
  | { k: 'surveil'; p: PlayerId; n: number; graveyard: number }
  | { k: 'tapped'; card: string; untap: boolean }
  | { k: 'bounced'; card: string }
  | { k: 'sacrificed'; card: string }
  | { k: 'token'; p: PlayerId; card: string; n: number }
  /** A card left a graveyard: back to hand, onto the battlefield, or exiled. */
  | { k: 'returned'; card: string; dest: 'hand' | 'battlefield' }
  | { k: 'exiledCard'; card: string }
  /** `dest`: hand cards are not named (hidden); found cards put onto the battlefield are logged as entering. */
  | { k: 'search'; p: PlayerId; n: number; dest: 'hand' | 'battlefield' }
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
  /** A choice someone must make before anything else happens. */
  pending: Pending | null;
  resolving: Resolving | null;
  attackers: string[];
  /** Attackers attacking a planeswalker instead of the player: attacker iid → planeswalker iid. */
  attackTargets?: Record<string, string>;
  /** attacker iid → blocker iids */
  blocks: Record<string, string[]>;
  winner: PlayerId | 'draw' | null;
  log: LogEntry[];
  /**
   * Per player: stop at every priority window instead of auto-passing when nothing is castable.
   * Optional so states created before this option existed still load.
   */
  fullControl?: [boolean, boolean];
  /** Triggered abilities not on the stack yet. Optional so older saved states still load. */
  triggered?: Triggered[];
  /** Counter for ability ids on the stack. */
  abilities?: number;
  /** Random generator state, so shuffles during the game are reproducible. Secret: redacted for clients. */
  seed: number;
}

export type Target =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'permanent'; iid: string }
  | { kind: 'spell'; iid: string }
  /** A card in a graveyard. */
  | { kind: 'card'; iid: string };

/** Actions are always taken by `actor(state)`. */
export type Action =
  | { type: 'mulligan' }
  | { type: 'keep'; bottom: string[] }
  | { type: 'playLand'; iid: string }
  /** `targets` has one list per target slot; `target` is a shorthand for a single-target spell. `x`: the value of X. */
  | { type: 'cast'; iid: string; targets?: Target[][]; target?: Target; x?: number }
  /** Activate ability number `index` (in activatedOf order) of a permanent you control. */
  | { type: 'activate'; iid: string; index: number; targets?: Target[][]; x?: number }
  | { type: 'pass' }
  /** `targets`: attackers that attack a planeswalker (attacker iid → planeswalker iid) instead of the player. */
  | { type: 'declareAttackers'; attackers: string[]; targets?: Record<string, string> }
  | { type: 'declareBlockers'; blocks: Record<string, string[]> }
  | { type: 'choose'; answer: Answer }
  | { type: 'concede'; player: PlayerId }
  /** Allowed at any time, like conceding. */
  | { type: 'setFullControl'; player: PlayerId; on: boolean };

/** Why an action was refused. Rendered in the player's language (src/i18n). */
export type GameErrorCode =
  | 'gameOver' | 'keepFirst' | 'notMulliganTime' | 'noMoreMulligans' | 'chooseBottom' | 'notInHand'
  | 'landTiming' | 'landAlreadyPlayed' | 'notALand' | 'notASpell' | 'sorcerySpeed' | 'castTiming'
  | 'needsTarget' | 'tooManyTargets' | 'targetMustBe' | 'illegalTarget' | 'notEnoughMana' | 'declareBlockersFirst'
  | 'notAttackStep' | 'cannotAttack' | 'notBlockStep' | 'notAttacking' | 'menace' | 'cannotBlock'
  | 'makeChoiceFirst' | 'nothingToChoose' | 'badChoice' | 'badX'
  | 'notEnoughLoyalty' | 'cannotAttackThat'
  | 'noSuchAbility' | 'activateTiming' | 'alreadyTapped' | 'summoningSick' | 'onceEachTurn' | 'notEnoughLife' | 'nothingToSacrifice';

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
  if (s.pending) return s.pending.choice.player;
  if (s.priority) return s.priority.player;
  return s.step === 'block' ? opponent(s.active) : s.active;
}

// ---------- Queries ----------

export const findPermanent = (s: GameState, iid: string) => s.battlefield.find((p) => p.iid === iid);

export const creaturesOf = (s: GameState, p: PlayerId) =>
  s.battlefield.filter((x) => x.controller === p && isCreature(x.card));

const isPermanent = (x: object): x is Permanent => 'boosts' in x;

/** Keyword printed on the card or granted until end of turn. */
export const hasKw = (x: CardInst, kw: Keyword) =>
  hasKeyword(x.card, kw) || (isPermanent(x) && x.boosts.some((b) => b.keywords.includes(kw)));

export const firstStrikes = (x: CardInst) => hasKw(x, 'first strike') || hasKw(x, 'double strike');

const sum = (perm: Permanent, key: 'power' | 'toughness') => perm.boosts.reduce((n, b) => n + b[key], 0);
const counterBonus = (perm: Permanent) => (perm.counters['+1/+1'] ?? 0) - (perm.counters['-1/-1'] ?? 0);

export const powerOf = (perm: Permanent) => power(perm.card) + sum(perm, 'power') + counterBonus(perm);
export const toughnessOf = (perm: Permanent) => toughness(perm.card) + sum(perm, 'toughness') + counterBonus(perm);

export function manaSources(s: GameState, p: PlayerId): ManaSource[] {
  return s.battlefield
    .filter((x) => x.controller === p && !x.tapped && !(isCreature(x.card) && x.sick))
    .map((x) => ({ iid: x.iid, colors: manaColors(x.card) }))
    .filter((x) => x.colors.length > 0);
}

/** How many {X} the cost has (Fireball: 1, some spells: 2). */
export const xCount = (card: Card) => (card.manaCost.split('//')[0].match(/\{X\}/g) ?? []).length;

/** The cost to pay, with X set. */
export function costWithX(card: Card, x = 0) {
  const cost = parseCost(card.manaCost);
  return { ...cost, generic: cost.generic + x * xCount(card) };
}

export const canPay = (s: GameState, p: PlayerId, card: Card, x = 0) =>
  findPayment(manaSources(s, p), costWithX(card, x)) !== null;

/** The largest X `p` can pay for right now (0 when the card has no X, or none can be paid). */
export function maxX(s: GameState, p: PlayerId, card: Card): number {
  if (!xCount(card)) return 0;
  let x = 0;
  while (canPay(s, p, card, x + 1)) x++;
  return x;
}

export function canAttack(perm: Permanent): boolean {
  return (
    isCreature(perm.card) && !perm.tapped && (!perm.sick || hasKw(perm, 'haste')) &&
    !hasKw(perm, 'defender') && powerOf(perm) > 0
  );
}

export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
  if (!isCreature(blocker.card) || blocker.tapped) return false;
  if (hasKw(attacker, 'flying')) return hasKw(blocker, 'flying') || hasKw(blocker, 'reach');
  return true;
}

export const isMainStep = (s: GameState) => s.step === 'main1' || s.step === 'main2';

/** Can `p` legally cast `card` right now (timing and mana; targets aside)? */
export function canCastNow(s: GameState, p: PlayerId, card: Card): boolean {
  if (isLandCard(card) || s.mulligan || s.pending || actor(s) !== p) return false;
  const timing = s.priority ? hasInstantSpeed(card) : isMainStep(s) && s.active === p;
  return timing && canPay(s, p, card);
}

// ---------- Activated abilities ----------

/** The mana part of an ability's cost, with X set. */
function abilityCost(spec: ActivatedSpec, x = 0) {
  const cost = parseCost(spec.cost.mana);
  return { ...cost, generic: cost.generic + x * (spec.cost.mana.match(/\{X\}/g) ?? []).length };
}

/** Mana sources that can pay for an ability of `perm`: not the permanent itself when it must tap. */
const sourcesFor = (s: GameState, perm: Permanent, spec: ActivatedSpec) =>
  manaSources(s, perm.controller).filter((m) => !(spec.cost.tap && m.iid === perm.iid));

/** Why `p` can't activate this ability now (timing, tapping, mana, life), or null if they can. */
export function activationProblem(s: GameState, p: PlayerId, perm: Permanent, index: number, x = 0): GameErrorCode | null {
  const spec = activatedOf(perm.card)[index];
  if (!spec || perm.controller !== p) return 'noSuchAbility';
  if (s.mulligan || s.pending || actor(s) !== p) return 'activateTiming';
  const sorcerySpeed = !s.priority && isMainStep(s) && s.active === p && !s.stack.length;
  if (spec.sorcery ? !sorcerySpeed : !s.priority && !(isMainStep(s) && s.active === p)) return 'activateTiming';
  if (spec.cost.tap && perm.tapped) return 'alreadyTapped';
  if (spec.cost.tap && isCreature(perm.card) && perm.sick && !hasKw(perm, 'haste')) return 'summoningSick';
  if (spec.once && perm.used?.includes(index)) return 'onceEachTurn';
  if (spec.cost.loyalty !== undefined) {
    // One loyalty ability per planeswalker each turn.
    if (perm.used?.some((i) => activatedOf(perm.card)[i]?.cost.loyalty !== undefined)) return 'onceEachTurn';
    if ((perm.counters.loyalty ?? 0) + spec.cost.loyalty < 0) return 'notEnoughLoyalty';
  }
  if (spec.cost.life && s.players[p].life < spec.cost.life) return 'notEnoughLife';
  if (spec.cost.sacrifice && !sacrificeOptions(s, perm, spec).length) return 'nothingToSacrifice';
  if (!findPayment(sourcesFor(s, perm, spec), abilityCost(spec, x))) return 'notEnoughMana';
  return null;
}

/** The largest X `p` can pay for an ability with {X} in its cost. */
export function abilityMaxX(s: GameState, perm: Permanent, index: number): number {
  const spec = activatedOf(perm.card)[index];
  if (!spec?.cost.mana.includes('{X}')) return 0;
  let x = 0;
  while (findPayment(sourcesFor(s, perm, spec), abilityCost(spec, x + 1))) x++;
  return x;
}

/** What may be sacrificed to pay an ability's "Sacrifice a creature" cost. */
function sacrificeOptions(s: GameState, perm: Permanent, spec: ActivatedSpec): Permanent[] {
  const cost = spec.cost.sacrifice!;
  return matching(s, perm.controller, cost.which).filter((x) => x.controller === perm.controller && !(cost.another && x.iid === perm.iid));
}

/** The ability's costs are paid: it goes on the stack and the opponent may respond. */
function finishActivation(d: GameState, item: StackItem, named: LogTarget[]) {
  const p = item.controller;
  d.stack.push(item);
  log(d, { k: 'activate', p, card: item.card.name, ...(named.length ? { targets: named } : {}) });
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = opponent(p);
  } else {
    openWindow(d, 'main', opponent(p), 0);
  }
}

/** Abilities `p` could activate right now with legal targets, as [permanent, index] pairs. */
export function activatable(s: GameState, p: PlayerId): { perm: Permanent; index: number; spec: ActivatedSpec }[] {
  return s.battlefield.flatMap((perm) =>
    perm.controller !== p ? [] : activatedOf(perm.card).flatMap((spec, index) =>
      spec.ability.effects.length && !activationProblem(s, p, perm, index) &&
      spec.ability.targets.every((slot) => legalTargets(s, p, slot).length >= slot.min)
        ? [{ perm, index, spec }] : []),
  );
}

// ---------- Targets ----------

const blockerIds = (s: GameState) => Object.values(s.blocks).flat();

/** Supertype and subtype conditions: "basic", "Forest or Plains". */
function fitsTypeLine(card: Card, f: TargetFilter): boolean {
  const [types, subtypes = ''] = card.typeLine.split('//')[0].toLowerCase().split('—');
  if (f.basic && !types.includes('basic')) return false;
  if (f.subtypes && !f.subtypes.some((t) => subtypes.split(' ').includes(t))) return false;
  return true;
}

/** Where a card is in a graveyard, if it is. */
export function findInGraveyard(s: GameState, iid: string): { inst: CardInst; owner: PlayerId } | undefined {
  for (const owner of [0, 1] as PlayerId[]) {
    const inst = s.players[owner].graveyard.find((c) => c.iid === iid);
    if (inst) return { inst, owner };
  }
  return undefined;
}

/** Does a card (a permanent, or a spell on the stack) pass the filter, from `caster`'s point of view? */
function matchesFilter(s: GameState, f: TargetFilter, caster: PlayerId, x: CardInst, controller: PlayerId): boolean {
  const perm = isPermanent(x) ? x : undefined;
  const types = cardTypes(x.card);
  const colors = x.card.colors;
  if (f.types && !f.types.some((t) => types.includes(t))) return false;
  if (f.nonTypes?.some((t) => types.includes(t))) return false;
  if (f.controller && (controller === caster) !== (f.controller === 'you')) return false;
  if (f.colors && !f.colors.some((c) => colors.includes(c))) return false;
  if (f.nonColors?.some((c) => colors.includes(c))) return false;
  if (f.keyword && !hasKw(x, f.keyword)) return false;
  if (f.withoutKeyword && hasKw(x, f.withoutKeyword)) return false;
  if (f.maxManaValue !== undefined && x.card.cmc > f.maxManaValue) return false;
  if (f.minManaValue !== undefined && x.card.cmc < f.minManaValue) return false;
  if (!fitsTypeLine(x.card, f)) return false;
  const pow = perm ? powerOf(perm) : power(x.card);
  if (f.minPower !== undefined && pow < f.minPower) return false;
  if (f.maxPower !== undefined && pow > f.maxPower) return false;
  // Battlefield-only conditions.
  if (f.tapped !== undefined && perm?.tapped !== f.tapped) return false;
  const attacking = !!perm && s.attackers.includes(perm.iid);
  const blocking = !!perm && blockerIds(s).includes(perm.iid);
  if (f.attacking && !attacking) return false;
  if (f.blocking && !blocking) return false;
  if (f.inCombat && !attacking && !blocking) return false;
  return true;
}

/** Is `t` a legal choice for a target slot of a spell or ability controlled by `caster`? */
export function isLegalTarget(s: GameState, caster: PlayerId, spec: TargetSpec, t: Target, selfIid?: string): boolean {
  if (t.kind === 'player') {
    if (spec.kind !== 'player' && spec.kind !== 'any') return false;
    return !spec.filter.controller || (t.player === caster) === (spec.filter.controller === 'you');
  }
  if (t.kind === 'card') {
    const found = findInGraveyard(s, t.iid);
    return spec.kind === 'card' && !!found && matchesFilter(s, spec.filter, caster, found.inst, found.owner);
  }
  if (t.kind === 'spell') {
    const item = s.stack.find((x) => x.iid === t.iid);
    if (spec.kind !== 'spell' || !item || item.iid === selfIid || item.ability) return false;
    return matchesFilter(s, spec.filter, caster, item, item.controller);
  }
  const perm = findPermanent(s, t.iid);
  if (!perm || spec.kind === 'card') return false;
  const types = cardTypes(perm.card);
  const kindOk =
    spec.kind === 'creature' ? types.includes('creature')
    : spec.kind === 'any' ? types.includes('creature') || types.includes('planeswalker')
    : spec.kind === 'permanent';
  return kindOk && matchesFilter(s, spec.filter, caster, perm, perm.controller);
}

/** Permanents an "all …"/"each …" effect controlled by `caster` touches. */
export function matching(s: GameState, caster: PlayerId, which: Selector): Permanent[] {
  const spec: TargetSpec = { kind: which.kind, min: 0, max: 0, filter: which.filter };
  return s.battlefield.filter((x) => isLegalTarget(s, caster, spec, { kind: 'permanent', iid: x.iid }));
}

/** Does the card match a filter of card words ("nonland", "creature")? Used for cards in hand. */
export const cardMatches = (card: Card, f: TargetFilter) => {
  const types = cardTypes(card);
  return (!f.types || f.types.some((t) => types.includes(t))) && !f.nonTypes?.some((t) => types.includes(t)) &&
    (f.maxManaValue === undefined || card.cmc <= f.maxManaValue) && fitsTypeLine(card, f);
};

/** Every legal choice for a target slot right now. */
export function legalTargets(s: GameState, caster: PlayerId, spec: TargetSpec, selfIid?: string): Target[] {
  const all: Target[] = [
    ...([0, 1] as PlayerId[]).map((player): Target => ({ kind: 'player', player })),
    ...s.battlefield.map((x): Target => ({ kind: 'permanent', iid: x.iid })),
    ...s.stack.map((x): Target => ({ kind: 'spell', iid: x.iid })),
    ...(spec.kind === 'card' ? [0, 1].flatMap((p) => s.players[p].graveyard.map((c): Target => ({ kind: 'card', iid: c.iid }))) : []),
  ];
  return all.filter((t) => isLegalTarget(s, caster, spec, t, selfIid));
}

/** Could the spell be cast with legal targets right now? (A counterspell needs a spell to counter.) */
export function hasUsefulTarget(s: GameState, p: PlayerId, card: Card): boolean {
  return spellSpec(card).targets.every((spec) => legalTargets(s, p, spec).length >= spec.min);
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.iid === (b as { iid: string }).iid);

function targetName(s: GameState, t: Target): LogTarget {
  if (t.kind === 'player') return { p: t.player };
  const x = t.kind === 'spell' ? s.stack.find((i) => i.iid === t.iid) : t.kind === 'card' ? findInGraveyard(s, t.iid)?.inst : findPermanent(s, t.iid);
  return { card: x?.card.name ?? '?' };
}

/** Checks chosen targets against the spell's slots; returns them with one list per slot. */
function checkTargets(s: GameState, caster: PlayerId, card: Card, spec: AbilitySpec, chosen: Target[][]): Target[][] {
  if (chosen.length > spec.targets.length) throw new IllegalAction('tooManyTargets', { card: card.name });
  return spec.targets.map((slot, i) => {
    const ts = chosen[i] ?? [];
    if (ts.length < slot.min) throw new IllegalAction('needsTarget', { card: card.name });
    if (ts.length > slot.max) throw new IllegalAction('tooManyTargets', { card: card.name });
    ts.forEach((t, j) => {
      if (ts.slice(0, j).some((u) => sameTarget(t, u))) throw new IllegalAction('tooManyTargets', { card: card.name });
      if (!isLegalTarget(s, caster, slot, t)) {
        const kindOk =
          (t.kind === 'player' && (slot.kind === 'player' || slot.kind === 'any')) ||
          (t.kind === 'spell' && slot.kind === 'spell') ||
          (t.kind === 'card' && slot.kind === 'card') ||
          (t.kind === 'permanent' && slot.kind !== 'player' && slot.kind !== 'spell' && slot.kind !== 'card');
        if (!kindOk) throw new IllegalAction('targetMustBe', { kind: slot.kind });
        throw new IllegalAction('illegalTarget', { card: card.name });
      }
    });
    return ts;
  });
}

// ---------- Choices ----------

/** Throws if `answer` doesn't answer `choice`. */
export function validateAnswer(choice: Choice, answer: Answer): void {
  const bad = () => new IllegalAction('badChoice');
  if (answer.kind !== choice.kind) throw bad();
  if (choice.kind === 'cards' && answer.kind === 'cards') {
    const ids = new Set(answer.iids);
    if (ids.size !== answer.iids.length || ids.size < choice.min || ids.size > choice.max) throw bad();
    if (answer.iids.some((iid) => !choice.options.some((c) => c.iid === iid))) throw bad();
  } else if (choice.kind === 'arrange' && answer.kind === 'arrange') {
    const placed = Object.entries(answer.zones).flatMap(([zone, iids]) => {
      if (!choice.zones.includes(zone as ArrangeZone)) throw bad();
      return iids ?? [];
    });
    const expected = choice.cards.map((c) => c.iid).sort();
    if (placed.length !== expected.length || [...placed].sort().some((iid, i) => iid !== expected[i])) throw bad();
  } else if (choice.kind === 'mode' && answer.kind === 'mode') {
    const modes = new Set(answer.modes);
    if (modes.size !== answer.modes.length || modes.size < choice.min || modes.size > choice.max) throw bad();
    if (answer.modes.some((m) => !Number.isInteger(m) || m < 0 || m >= choice.modes.length)) throw bad();
  } else if (choice.kind === 'targets' && answer.kind === 'targets') {
    if (!Array.isArray(answer.targets) || answer.targets.length > choice.slots.length || answer.targets.some((ts) => !Array.isArray(ts))) throw bad();
  }
}

// ---------- Setup ----------

export interface NewGameOptions {
  decks: [Card[], Card[]];
  names: [string, string];
  first: PlayerId;
  rng?: Rng;
  /** Start with London mulligan decisions (default true). */
  mulligans?: boolean;
  /** Players who stop at every priority window (see GameState.fullControl). */
  fullControl?: [boolean, boolean];
}

export function newGame({ decks, names, first, rng = Math.random, mulligans = true, fullControl }: NewGameOptions): GameState {
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
    pending: null,
    resolving: null,
    attackers: [],
    blocks: {},
    winner: null,
    log: [{ k: 'goesFirst', p: first }],
    seed: Math.floor(rng() * 2 ** 32),
    ...(fullControl ? { fullControl: [...fullControl] as [boolean, boolean] } : {}),
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
    delete perm.used;
  }
  log(d, { k: 'turn', n: d.turn, p });
  fireStep(d, 'upkeep');
  if (d.triggered?.length) {
    // Upkeep triggers resolve before the draw (see closeWindow).
    d.step = 'upkeep';
    d.priority = { player: p, passes: 0, reason: 'upkeep' };
    return;
  }
  drawStep(d, skipDraw);
}

/** Draw for the turn, then the opponent may act before the first main phase (the active player has passed). */
function drawStep(d: GameState, skipDraw: boolean) {
  d.step = 'main1';
  if (!skipDraw) draw(d, d.active, 1);
  if (d.winner === null) openWindow(d, 'begin', opponent(d.active), 1);
}

/** Cleanup step: the active player discards down to seven (their choice), then the turn passes. */
function endTurn(d: GameState) {
  const hand = d.players[d.active].hand;
  const excess = hand.length - 7;
  if (excess > 0) {
    d.pending = {
      choice: { kind: 'cards', player: d.active, purpose: 'cleanupDiscard', min: excess, max: excess, options: [...hand], params: { n: excess } },
      resume: 'cleanup',
    };
    return;
  }
  finishTurn(d);
}

function finishCleanup(d: GameState, iids: string[]) {
  const me = d.players[d.active];
  for (const iid of iids) {
    const inst = me.hand.find((c) => c.iid === iid)!;
    me.hand = me.hand.filter((c) => c !== inst);
    me.graveyard.push(inst);
    log(d, { k: 'discard', p: d.active, card: inst.card.name, cleanup: true });
  }
  finishTurn(d);
}

function finishTurn(d: GameState) {
  for (const perm of d.battlefield) {
    perm.damage = 0;
    perm.deathtouched = false;
    perm.boosts = perm.boosts.filter((b) => b.until !== 'endOfTurn');
  }
  beginTurn(d, opponent(d.active), false);
}

const newPermanent = (inst: CardInst, controller: PlayerId): Permanent => ({
  iid: inst.iid, card: inst.card, controller, tapped: false, sick: true, damage: 0, deathtouched: false, counters: {}, boosts: [],
});

function removePermanent(d: GameState, perm: Permanent, zone: 'graveyard' | 'exile') {
  d.battlefield = d.battlefield.filter((x) => x.iid !== perm.iid);
  // A token that leaves the battlefield ceases to exist (it still "dies").
  if (!isToken(perm.card)) d.players[perm.controller][zone].push({ iid: perm.iid, card: perm.card });
  if (zone === 'graveyard' && isCreature(perm.card)) fireObject(d, 'dies', perm);
}

/** Taps the permanents paying for something; those whose mana ability sacrifices them (Treasure) are sacrificed. */
function payMana(d: GameState, iids: string[]) {
  for (const iid of iids) {
    const perm = findPermanent(d, iid)!;
    perm.tapped = true;
    if (/\{T\}, Sacrifice [^:]*: Add/i.test(perm.card.oracleText)) sacrifice(d, perm);
  }
}

/** Sacrifice a permanent (as a cost or an effect). */
function sacrifice(d: GameState, perm: Permanent) {
  removePermanent(d, perm, 'graveyard');
  log(d, { k: 'sacrificed', card: perm.card.name });
}

/** A permanent enters: put it on the battlefield and check "enters" triggers (its own, landfall…). */
function enterBattlefield(d: GameState, inst: CardInst, controller: PlayerId, opts: { x?: number; tapped?: boolean } = {}): Permanent {
  const perm = newPermanent(inst, controller);
  if (opts.tapped || entersTapped(inst.card)) perm.tapped = true;
  const counters = entersWithCounters(inst.card);
  if (counters !== null) {
    const n = counters === 'X' ? (opts.x ?? 0) : counters;
    if (n > 0) perm.counters = { '+1/+1': n };
  }
  if (isPlaneswalker(inst.card)) perm.counters = { ...perm.counters, loyalty: startingLoyalty(inst.card) };
  d.battlefield.push(perm);
  fireObject(d, 'enters', perm);
  return perm;
}

// ---------- Triggers ----------

function queueTrigger(d: GameState, source: CardInst, controller: PlayerId, ability: AbilitySpec) {
  if (!ability.effects.length) {
    log(d, { k: 'notSimulated', card: source.card.name });
    return;
  }
  (d.triggered ??= []).push({ source: { iid: source.iid, card: source.card }, controller, ability });
}

/** Does `perm` match what a trigger watches, seen from the trigger controller's side? Works for permanents that just left too. */
function fits(d: GameState, viewer: PlayerId, which: Selector, perm: Permanent): boolean {
  if (which.kind === 'creature' && !isCreature(perm.card)) return false;
  return matchesFilter(d, which.filter, viewer, perm, perm.controller);
}

/**
 * `perm` entered, died or attacked: trigger its own abilities and those of permanents watching
 * for it. A creature that died still sees its own death ("When this creature dies").
 */
function fireObject(d: GameState, on: ObjectEvent, perm: Permanent) {
  const watchers = d.battlefield.some((x) => x.iid === perm.iid) ? d.battlefield : [...d.battlefield, perm];
  for (const x of watchers) {
    for (const t of triggersOf(x.card)) {
      const e: TriggerEvent = t.event;
      if (e.on !== on) continue;
      const hit = e.self ? x.iid === perm.iid : !(e.another && x.iid === perm.iid) && fits(d, x.controller, e.which, perm);
      if (hit) queueTrigger(d, x, x.controller, t.ability);
    }
  }
}

/** The beginning of the active player's upkeep or end step. */
function fireStep(d: GameState, on: 'upkeep' | 'endStep') {
  for (const x of d.battlefield) {
    for (const t of triggersOf(x.card)) {
      if (t.event.on !== on) continue;
      const mine = x.controller === d.active;
      if (t.event.whose === 'each' || (t.event.whose === 'you') === mine) queueTrigger(d, x, x.controller, t.ability);
    }
  }
}

/** `p` cast `card`: "whenever you cast …" and prowess. */
function fireCast(d: GameState, p: PlayerId, card: Card) {
  for (const x of d.battlefield) {
    if (x.controller !== p) continue;
    for (const t of triggersOf(x.card)) {
      if (t.event.on === 'cast' && cardMatches(card, t.event.filter)) queueTrigger(d, x, p, t.ability);
    }
  }
}

function pushAbility(d: GameState, t: Triggered, targets: Target[][]) {
  d.abilities = (d.abilities ?? 0) + 1;
  d.stack.push({
    iid: `${t.source.iid}-ability-${d.abilities}`, card: t.source.card, controller: t.controller, targets, ability: t.ability, source: t.source.iid,
  });
  const named = targets.flat().map((tg) => targetName(d, tg));
  log(d, { k: 'triggers', card: t.source.card.name, ...(named.length ? { targets: named } : {}) });
  // Both players get priority again, starting with the active player.
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = d.active;
  } else {
    d.priority = { player: d.active, passes: 0, reason: 'main' };
  }
}

/**
 * Puts the next waiting trigger on the stack (the active player's first, so they resolve last).
 * Returns false when its controller must choose targets first.
 */
function flushTrigger(d: GameState): boolean {
  const queue = d.triggered!;
  const i = Math.max(0, queue.findIndex((t) => t.controller === d.active));
  const [t] = queue.splice(i, 1);
  if (!queue.length) delete d.triggered;
  const slots = t.ability.targets;
  if (!slots.length) {
    pushAbility(d, t, []);
    return true;
  }
  if (slots.some((slot) => legalTargets(d, t.controller, slot).length < slot.min)) {
    log(d, { k: 'noTarget', card: t.source.card.name });
    return true;
  }
  d.pending = {
    choice: { kind: 'targets', player: t.controller, purpose: 'triggerTargets', slots, source: t.source, params: { card: t.source.card.name } },
    resume: 'trigger',
    trigger: t,
  };
  return false;
}

/** State-based actions: +1/+1 and -1/-1 counters cancel out, 0 toughness, lethal damage, 0 life. */
function checkStateBased(d: GameState) {
  for (const perm of [...d.battlefield]) {
    const plus = perm.counters['+1/+1'] ?? 0;
    const minus = perm.counters['-1/-1'] ?? 0;
    if (plus && minus) {
      const both = Math.min(plus, minus);
      perm.counters = { ...perm.counters, '+1/+1': plus - both, '-1/-1': minus - both };
    }
    if (isCreature(perm.card) && (toughnessOf(perm) <= 0 || perm.deathtouched || perm.damage >= toughnessOf(perm))) {
      removePermanent(d, perm, 'graveyard');
      log(d, { k: 'dies', card: perm.card.name });
    } else if (isPlaneswalker(perm.card) && !isCreature(perm.card) && (perm.counters.loyalty ?? 0) <= 0) {
      removePermanent(d, perm, 'graveyard');
      log(d, { k: 'destroyed', card: perm.card.name });
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
  } else if (isPlaneswalker(target.card) && !isCreature(target.card)) {
    // Damage to a planeswalker removes that many loyalty counters.
    target.counters = { ...target.counters, loyalty: (target.counters.loyalty ?? 0) - amount };
    log(d, { k: 'damage', card: source.card.name, n: amount, target: target.card.name });
  } else {
    target.damage += amount;
    if (hasKw(source, 'deathtouch')) target.deathtouched = true;
    log(d, { k: 'damage', card: source.card.name, n: amount, target: target.card.name });
  }
  if (hasKw(source, 'lifelink')) d.players[controller].life += amount;
}

function resolveCombat(d: GameState) {
  const def = opponent(d.active);
  const get = (iid: string) => findPermanent(d, iid);
  const involved = [...d.attackers, ...blockerIds(d)].map(get).filter((x) => x !== undefined);
  const strikeSteps = involved.some(firstStrikes) ? [true, false] : [false];

  for (const firstStrikeStep of strikeSteps) {
    const dealsNow = (x: Permanent) =>
      firstStrikeStep ? firstStrikes(x) : !hasKw(x, 'first strike') || hasKw(x, 'double strike');

    // Collect all damage first: combat damage is dealt simultaneously.
    const hits: { source: Permanent; target: Permanent | PlayerId; amount: number }[] = [];

    for (const aid of d.attackers) {
      const a = get(aid);
      if (!a || !dealsNow(a)) continue;
      // What it attacks: the player, or a planeswalker (no damage if that planeswalker is gone).
      const pwIid = d.attackTargets?.[aid];
      const attacked: Permanent | PlayerId | undefined = pwIid ? get(pwIid) : def;
      let remaining = powerOf(a);
      const declared = d.blocks[aid] ?? [];
      if (declared.length === 0) {
        if (attacked !== undefined) hits.push({ source: a, target: attacked, amount: remaining });
        continue;
      }
      const blockers = declared.map(get).filter((x) => x !== undefined);
      const trample = hasKw(a, 'trample');
      blockers.forEach((b, i) => {
        const lethal = hasKw(a, 'deathtouch') ? 1 : Math.max(0, toughnessOf(b) - b.damage);
        const isLast = i === blockers.length - 1;
        const amount = isLast && !trample ? remaining : Math.min(remaining, lethal);
        hits.push({ source: a, target: b, amount });
        remaining -= amount;
      });
      // A blocked creature only hits the player if it tramples (even if its blockers are gone).
      if (trample && remaining > 0 && attacked !== undefined) hits.push({ source: a, target: attacked, amount: remaining });
    }

    for (const [aid, bids] of Object.entries(d.blocks)) {
      const a = get(aid);
      if (!a) continue;
      for (const bid of bids) {
        const b = get(bid);
        if (b && dealsNow(b)) hits.push({ source: b, target: a, amount: powerOf(b) });
      }
    }

    for (const h of hits) {
      dealDamage(d, h.source, h.source.controller, h.target, h.amount);
      if (typeof h.target === 'number' && h.amount > 0) fireObject(d, 'combatDamage', h.source);
    }
    checkStateBased(d);
    if (d.winner !== null) return;
  }
}

// ---------- Resolving spells and abilities ----------

const specOf = (item: StackItem): AbilitySpec => item.ability ?? spellSpec(item.card);

/** What an effect applies to, looked up again now: earlier effects may have changed the game. */
/** A card in a graveyard that an effect applies to. */
interface GraveCard {
  grave: CardInst;
  owner: PlayerId;
}
type Affectable = Permanent | PlayerId | StackItem | GraveCard;

function affected(d: GameState, r: Resolving, to: Affected): Affectable[] {
  if (to === 'you') return [r.item.controller];
  if (to === 'self') {
    const src = r.item.source ? findPermanent(d, r.item.source) : undefined;
    return src ? [src] : [];
  }
  if (to === 'each-opponent') return [opponent(r.item.controller)];
  // Each player, starting with the active player.
  if (to === 'each-player') return [d.active, opponent(d.active)];
  return (r.legal[to.slot] ?? []).flatMap((t): Affectable[] => {
    if (t.kind === 'player') return [t.player];
    if (t.kind === 'card') {
      const found = findInGraveyard(d, t.iid);
      return found ? [{ grave: found.inst, owner: found.owner }] : [];
    }
    const x = t.kind === 'spell' ? d.stack.find((i) => i.iid === t.iid) : findPermanent(d, t.iid);
    return x ? [x] : [];
  });
}

const amount = (r: Resolving, a: Amount) => (a === 'X' ? (r.item.x ?? 0) : a);

function moveToGraveyard(d: GameState, p: PlayerId, inst: CardInst, from: 'hand' | 'library') {
  const ps = d.players[p];
  ps[from] = ps[from].filter((c) => c.iid !== inst.iid);
  ps.graveyard.push(inst);
}

/** Runs one effect. Returns a choice to pause on; it is run again with the answer. */
function runEffect(d: GameState, r: Resolving, e: Effect, answer?: Answer): Choice | undefined {
  const { item } = r;
  const caster = item.controller;
  const things = 'to' in e ? affected(d, r, e.to) : [];
  const players = things.filter((x): x is PlayerId => typeof x === 'number');
  const perms = things.filter((x): x is Permanent => typeof x !== 'number' && isPermanent(x));
  const spells = things.filter((x): x is StackItem => typeof x !== 'number' && 'targets' in x);
  const graveCards = things.filter((x): x is GraveCard => typeof x !== 'number' && 'grave' in x);
  /** Takes a card out of its graveyard. */
  const unbury = (g: GraveCard) => {
    d.players[g.owner].graveyard = d.players[g.owner].graveyard.filter((c) => c.iid !== g.grave.iid);
  };

  switch (e.kind) {
    case 'damage':
      for (const t of [...players, ...perms]) dealDamage(d, item, caster, t, amount(r, e.amount));
      break;
    case 'counter':
      for (const target of spells) {
        if (e.unlessPays) {
          const payer = target.controller;
          const payment = findPayment(manaSources(d, payer), { generic: e.unlessPays, colored: [] });
          if (payment && !answer) {
            return { kind: 'yesNo', player: payer, purpose: 'payOrCounter', params: { card: target.card.name, n: e.unlessPays } };
          }
          if (payment && answer?.kind === 'yesNo' && answer.yes) {
            payMana(d, payment);
            log(d, { k: 'paid', p: payer, n: e.unlessPays, card: target.card.name });
            continue;
          }
        }
        d.stack = d.stack.filter((x) => x !== target);
        d.players[target.controller].graveyard.push({ iid: target.iid, card: target.card });
        log(d, { k: 'countered', card: target.card.name });
      }
      break;
    case 'pump':
      for (const perm of perms) {
        perm.boosts.push({ power: e.power, toughness: e.toughness, keywords: e.keywords, until: 'endOfTurn' });
        log(d, { k: 'pump', card: perm.card.name, power: e.power, toughness: e.toughness, keywords: e.keywords });
      }
      break;
    case 'pumpAll':
      for (const perm of matching(d, caster, e.which)) {
        perm.boosts.push({ power: e.power, toughness: e.toughness, keywords: e.keywords, until: 'endOfTurn' });
        log(d, { k: 'pump', card: perm.card.name, power: e.power, toughness: e.toughness, keywords: e.keywords });
      }
      break;
    case 'destroy':
      for (const perm of perms) {
        removePermanent(d, perm, e.exile ? 'exile' : 'graveyard');
        log(d, { k: e.exile ? 'exiled' : 'destroyed', card: perm.card.name });
      }
      for (const g of graveCards) {
        unbury(g);
        d.players[g.owner].exile.push(g.grave);
        log(d, { k: 'exiledCard', card: g.grave.card.name });
      }
      break;
    case 'returnCard':
      for (const g of graveCards) {
        unbury(g);
        log(d, { k: 'returned', card: g.grave.card.name, dest: e.dest });
        if (e.dest === 'hand') d.players[g.owner].hand.push(g.grave);
        else enterBattlefield(d, g.grave, caster);
      }
      break;
    case 'addCountersAll': {
      const n = amount(r, e.n);
      for (const perm of matching(d, caster, e.which)) {
        if (e.other && perm.iid === item.source) continue;
        perm.counters = { ...perm.counters, [e.counter]: (perm.counters[e.counter] ?? 0) + n };
        log(d, { k: 'counters', card: perm.card.name, counter: e.counter, n });
      }
      break;
    }
    case 'search': {
      const ps = d.players[caster];
      const found = ps.library.filter((c) => cardMatches(c.card, e.filter));
      if (found.length && (!answer || answer.kind !== 'cards')) {
        return { kind: 'cards', player: caster, purpose: 'search', min: 0, max: Math.min(e.n, found.length), options: found, params: { n: e.n } };
      }
      const chosen = answer?.kind === 'cards' ? answer.iids.map((iid) => found.find((c) => c.iid === iid)!) : [];
      ps.library = ps.library.filter((c) => !chosen.includes(c));
      log(d, { k: 'search', p: caster, n: chosen.length, dest: e.dest });
      for (const inst of chosen) {
        if (e.dest === 'hand') ps.hand.push(inst);
        else enterBattlefield(d, inst, caster, { tapped: e.tapped });
      }
      ps.library = shuffle(ps.library, () => random(d));
      break;
    }
    case 'destroyAll':
      for (const perm of matching(d, caster, e.which)) {
        removePermanent(d, perm, e.exile ? 'exile' : 'graveyard');
        log(d, { k: e.exile ? 'exiled' : 'destroyed', card: perm.card.name });
      }
      break;
    case 'damageAll': {
      const n = amount(r, e.amount);
      for (const perm of matching(d, caster, e.which)) if (isCreature(perm.card)) dealDamage(d, item, caster, perm, n);
      if (e.players) for (const p of affected(d, r, e.players) as PlayerId[]) dealDamage(d, item, caster, p, n);
      break;
    }
    case 'addCounters':
      for (const perm of perms) {
        const n = amount(r, e.n);
        perm.counters = { ...perm.counters, [e.counter]: (perm.counters[e.counter] ?? 0) + n };
        log(d, { k: 'counters', card: perm.card.name, counter: e.counter, n });
      }
      break;
    case 'draw':
      for (const p of players) draw(d, p, amount(r, e.n));
      break;
    case 'gainLife':
      for (const p of players) {
        d.players[p].life += amount(r, e.n);
        log(d, { k: 'gainLife', p, n: amount(r, e.n) });
      }
      break;
    case 'loseLife':
      for (const p of players) {
        d.players[p].life -= amount(r, e.n);
        log(d, { k: 'loseLife', p, n: amount(r, e.n) });
      }
      break;
    case 'mill':
      for (const p of players) {
        const milled = d.players[p].library.slice(0, amount(r, e.n));
        for (const inst of milled) moveToGraveyard(d, p, inst, 'library');
        log(d, { k: 'mill', p, n: milled.length });
      }
      break;
    case 'discard':
      // Players are asked one after the other; `r.sub` remembers who is next.
      for (let i = r.sub ?? 0; i < players.length; i++) {
        const p = players[i];
        const hand = d.players[p].hand;
        if (e.mode === 'random') {
          for (let k = 0; k < amount(r, e.n) && hand.length; k++) {
            const inst = d.players[p].hand[Math.floor(random(d) * d.players[p].hand.length)];
            moveToGraveyard(d, p, inst, 'hand');
            log(d, { k: 'discard', p, card: inst.card.name });
          }
          continue;
        }
        const options = e.mode === 'casterChooses' && e.filter ? hand.filter((c) => cardMatches(c.card, e.filter!)) : hand;
        const n = Math.min(amount(r, e.n), options.length);
        if (!n) continue;
        if (!answer || answer.kind !== 'cards') {
          r.sub = i;
          const chooser = e.mode === 'casterChooses' ? caster : p;
          const purpose = e.mode === 'casterChooses' ? 'discardChosen' : 'discard';
          return { kind: 'cards', player: chooser, purpose, min: n, max: n, options: [...options], params: { n, p } };
        }
        for (const iid of answer.iids) {
          const inst = hand.find((c) => c.iid === iid)!;
          moveToGraveyard(d, p, inst, 'hand');
          log(d, { k: 'discard', p, card: inst.card.name });
        }
        answer = undefined;
      }
      r.sub = 0;
      break;
    case 'scry':
    case 'surveil': {
      const top = d.players[caster].library.slice(0, amount(r, e.n));
      if (!top.length) break;
      if (!answer || answer.kind !== 'arrange') {
        const zones: ArrangeZone[] = e.kind === 'scry' ? ['top', 'bottom'] : ['top', 'graveyard'];
        return { kind: 'arrange', player: caster, purpose: e.kind, cards: top, zones, params: { n: top.length } };
      }
      const ps = d.players[caster];
      const byIid = (iid: string) => top.find((c) => c.iid === iid)!;
      const rest = ps.library.slice(top.length);
      const onTop = (answer.zones.top ?? []).map(byIid);
      const away = (answer.zones[e.kind === 'scry' ? 'bottom' : 'graveyard'] ?? []).map(byIid);
      if (e.kind === 'scry') {
        ps.library = [...onTop, ...rest, ...away];
        log(d, { k: 'scry', p: caster, n: top.length, bottom: away.length });
      } else {
        ps.library = [...onTop, ...rest];
        ps.graveyard.push(...away);
        log(d, { k: 'surveil', p: caster, n: top.length, graveyard: away.length });
      }
      break;
    }
    case 'tap':
      for (const perm of perms) {
        perm.tapped = !e.untap;
        log(d, { k: 'tapped', card: perm.card.name, untap: e.untap });
      }
      break;
    case 'bounce':
    case 'bounceAll':
      for (const perm of e.kind === 'bounceAll' ? matching(d, caster, e.which) : perms) {
        d.battlefield = d.battlefield.filter((x) => x.iid !== perm.iid);
        if (!isToken(perm.card)) d.players[perm.controller].hand.push({ iid: perm.iid, card: perm.card });
        log(d, { k: 'bounced', card: perm.card.name });
      }
      break;
    case 'fight': {
      const [a] = affected(d, r, e.a) as Permanent[];
      const [b] = affected(d, r, e.b);
      if (!a || b === undefined) break;
      if (typeof b === 'number') {
        dealDamage(d, a, a.controller, b, powerOf(a));
      } else if (isPermanent(b)) {
        dealDamage(d, a, a.controller, b, powerOf(a));
        if (!e.oneSided) dealDamage(d, b, b.controller, a, powerOf(b));
      }
      break;
    }
    case 'sacrifice':
      // Players choose one after the other, like discarding.
      for (let i = r.sub ?? 0; i < players.length; i++) {
        const p = players[i];
        const options = matching(d, p, e.which).filter((x) => x.controller === p);
        const n = Math.min(amount(r, e.n), options.length);
        if (!n) continue;
        if (n === options.length) {
          for (const perm of options) sacrifice(d, perm);
          continue;
        }
        if (!answer || answer.kind !== 'cards') {
          r.sub = i;
          return { kind: 'cards', player: p, purpose: 'sacrifice', min: n, max: n, options, params: { n } };
        }
        for (const iid of answer.iids) sacrifice(d, findPermanent(d, iid)!);
        answer = undefined;
      }
      r.sub = 0;
      break;
    case 'sacrificeSelf': {
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (src) sacrifice(d, src);
      break;
    }
    case 'token': {
      const n = amount(r, e.n);
      for (let i = 0; i < n; i++) {
        d.abilities = (d.abilities ?? 0) + 1;
        enterBattlefield(d, { iid: `token-${d.abilities}`, card: tokenCard(e.token) }, caster);
      }
      if (n > 0) log(d, { k: 'token', p: caster, card: e.token.name, n });
      break;
    }
  }
  return undefined;
}

function startResolving(d: GameState, reason: WindowReason) {
  const item = d.stack.pop()!;

  if (!item.ability && !isInstantOrSorcery(item.card)) {
    log(d, { k: 'enters', card: item.card.name });
    enterBattlefield(d, { iid: item.iid, card: item.card }, item.controller, { x: item.x });
    afterResolving(d, reason);
    return;
  }

  // Targets are checked again on resolution. If none is still legal, the spell does nothing.
  const spec = specOf(item);
  const legal = item.targets.map((ts, slot) => ts.filter((t) => spec.targets[slot] && isLegalTarget(d, item.controller, spec.targets[slot], t, item.iid)));
  if (item.targets.some((ts) => ts.length) && legal.every((ts) => !ts.length)) {
    log(d, { k: 'fizzles', card: item.card.name });
    if (!item.ability) d.players[item.controller].graveyard.push({ iid: item.iid, card: item.card });
    afterResolving(d, reason);
    return;
  }
  if (!spec.effects.length) log(d, { k: 'notSimulated', card: item.card.name });
  d.resolving = { item, legal, next: 0, reason };
  continueResolving(d);
}

function continueResolving(d: GameState, answer?: Answer) {
  const r = d.resolving!;
  const spec = specOf(r.item);
  const effects = spec.effects;
  if (spec.optional && !r.accepted) {
    if (answer?.kind !== 'yesNo') {
      d.pending = { choice: { kind: 'yesNo', player: r.item.controller, purpose: 'optional', params: { card: r.item.card.name } }, resume: 'effect' };
      return;
    }
    if (!answer.yes) {
      log(d, { k: 'declined', card: r.item.card.name });
      r.next = effects.length;
    }
    r.accepted = true;
    answer = undefined;
  }
  while (r.next < effects.length) {
    const choice = runEffect(d, r, effects[r.next], answer);
    answer = undefined;
    if (choice) {
      d.pending = { choice, resume: 'effect' };
      return;
    }
    r.next++;
  }
  d.resolving = null;
  if (!r.item.ability) d.players[r.item.controller].graveyard.push({ iid: r.item.iid, card: r.item.card });
  afterResolving(d, r.reason);
}

/** After something resolves, the active player gets priority again (except for a main phase spell). */
function afterResolving(d: GameState, reason: WindowReason) {
  checkStateBased(d);
  d.priority = d.winner !== null || (!d.stack.length && reason === 'main') ? null : { player: d.active, passes: 0, reason };
}

// ---------- Priority ----------

/** Whether `p` should be asked to act in a priority window (Arena-style auto-pass otherwise). */
function wantsPriority(d: GameState, p: PlayerId): boolean {
  if (d.fullControl?.[p]) return true;
  const reason = d.priority!.reason;
  if (!d.stack.length) {
    // Like Arena, these stops are only made in full control.
    if (reason === 'begin' || reason === 'combat' || reason === 'upkeep') return false;
    if (reason === 'attack' && p === d.active) return false; // the attacker just acted
  }
  if (d.stack.at(-1)?.controller === p) return false; // don't respond to your own spell
  return d.players[p].hand.some((c) => canCastNow(d, p, c.card) && hasUsefulTarget(d, p, c.card)) || activatable(d, p).length > 0;
}

function openWindow(d: GameState, reason: WindowReason, player: PlayerId, passes: number) {
  d.priority = { player, passes, reason };
  settle(d);
}

/**
 * Runs the game forward until someone has to decide something: state-based actions, then
 * waiting triggers go on the stack, then players who wouldn't do anything pass automatically.
 */
function settle(d: GameState) {
  for (;;) {
    checkStateBased(d);
    if (d.winner !== null || d.pending || d.mulligan) return;
    if (d.triggered?.length) {
      if (!flushTrigger(d)) return;
      continue;
    }
    if (!d.priority || wantsPriority(d, d.priority.player)) return;
    passOnce(d);
  }
}

function passOnce(d: GameState) {
  const pr = d.priority!;
  pr.passes++;
  if (pr.passes < 2) {
    pr.player = opponent(pr.player);
    return;
  }
  d.priority = null;
  if (d.stack.length) startResolving(d, pr.reason);
  else closeWindow(d, pr.reason);
}

/** Everyone passed with an empty stack: the game moves on. */
function closeWindow(d: GameState, reason: WindowReason) {
  if (reason === 'upkeep') {
    drawStep(d, d.turn === 1);
  } else if (reason === 'combat') {
    // Attackers may have been removed during the window.
    d.step = creaturesOf(d, d.active).some(canAttack) ? 'attack' : 'main2';
  } else if (reason === 'attack') {
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
    delete d.attackTargets;
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

/**
 * Puts an ability on the stack (for triggered and activated abilities). Its source stays where
 * it is; the ability resolves like a spell, with the same effects. Both players then get priority.
 */
export function addAbility(state: GameState, source: CardInst, controller: PlayerId, spec: AbilitySpec, targets: Target[][] = []): GameState {
  const d = structuredClone(state);
  const n = d.stack.length + d.log.length;
  d.stack.push({ iid: `${source.iid}-ability-${n}`, card: source.card, controller, targets, ability: spec, source: source.iid });
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = d.active;
    settle(d);
  } else {
    openWindow(d, 'main', d.active, 0);
  }
  return d;
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
  if (action.type === 'setFullControl') {
    d.fullControl = [...(d.fullControl ?? [false, false])] as [boolean, boolean];
    d.fullControl[action.player] = action.on;
    return d;
  }

  const p = actor(d)!;
  const me = d.players[p];

  if (d.mulligan && action.type !== 'mulligan' && action.type !== 'keep') {
    throw new IllegalAction('keepFirst');
  }
  if (d.pending && action.type !== 'choose') throw new IllegalAction('makeChoiceFirst');

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

    case 'choose': {
      const pending = d.pending;
      if (!pending) throw new IllegalAction('nothingToChoose');
      validateAnswer(pending.choice, action.answer);
      d.pending = null;
      if (pending.resume === 'cleanup' && action.answer.kind === 'cards') finishCleanup(d, action.answer.iids);
      else if (pending.resume === 'trigger' && action.answer.kind === 'targets') {
        const t = pending.trigger!;
        pushAbility(d, t, checkTargets(d, t.controller, t.source.card, t.ability, action.answer.targets));
      } else if (pending.resume === 'activation' && action.answer.kind === 'cards') {
        sacrifice(d, findPermanent(d, action.answer.iids[0])!);
        finishActivation(d, pending.activation!.item, pending.activation!.named);
      } else continueResolving(d, action.answer);
      break;
    }

    case 'playLand': {
      if (d.priority || !isMainStep(d) || p !== d.active) throw new IllegalAction('landTiming');
      if (me.landPlayed) throw new IllegalAction('landAlreadyPlayed');
      const inst = me.hand.find((c) => c.iid === action.iid);
      if (!inst || !isLandCard(inst.card)) throw new IllegalAction('notALand');
      me.hand = me.hand.filter((c) => c !== inst);
      me.landPlayed = true;
      log(d, { k: 'playLand', p, card: inst.card.name });
      enterBattlefield(d, inst, p);
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

      const spec = spellSpec(inst.card);
      const chosen = action.targets ?? (action.target ? [[action.target]] : []);
      const targets = checkTargets(d, p, inst.card, spec, chosen);
      const x = xCount(inst.card) ? (action.x ?? 0) : 0;
      if (!Number.isInteger(x) || x < 0) throw new IllegalAction('badX');

      const payment = findPayment(manaSources(d, p), costWithX(inst.card, x));
      if (!payment) throw new IllegalAction('notEnoughMana', { card: inst.card.name });
      payMana(d, payment);
      me.hand = me.hand.filter((c) => c !== inst);
      const named = targets.flat().map((t) => targetName(d, t));
      d.stack.push({ ...inst, controller: p, targets, ...(xCount(inst.card) ? { x } : {}) });
      log(d, { k: 'cast', p, card: inst.card.name, ...(named.length ? { targets: named } : {}) });
      fireCast(d, p, inst.card);

      // The opponent may respond.
      if (d.priority) {
        d.priority.passes = 0;
        d.priority.player = opponent(p);
      } else {
        openWindow(d, 'main', opponent(p), 0);
      }
      break;
    }

    case 'activate': {
      const perm = findPermanent(d, action.iid);
      if (!perm) throw new IllegalAction('noSuchAbility');
      const spec = activatedOf(perm.card)[action.index];
      const x = spec?.cost.mana.includes('{X}') ? (action.x ?? 0) : 0;
      if (!Number.isInteger(x) || x < 0) throw new IllegalAction('badX');
      const problem = activationProblem(d, p, perm, action.index, x);
      if (problem) throw new IllegalAction(problem, { card: perm.card.name });
      const targets = checkTargets(d, p, perm.card, spec.ability, action.targets ?? []);

      payMana(d, findPayment(sourcesFor(d, perm, spec), abilityCost(spec, x))!);
      if (spec.cost.tap) perm.tapped = true;
      if (spec.cost.life) d.players[p].life -= spec.cost.life;
      if (spec.once || spec.cost.loyalty !== undefined) perm.used = [...(perm.used ?? []), action.index];
      if (spec.cost.loyalty !== undefined) {
        perm.counters = { ...perm.counters, loyalty: (perm.counters.loyalty ?? 0) + spec.cost.loyalty };
        log(d, { k: 'loyalty', card: perm.card.name, n: spec.cost.loyalty });
      }
      const named = targets.flat().map((t) => targetName(d, t));
      d.abilities = (d.abilities ?? 0) + 1;
      const item: StackItem = {
        iid: `${perm.iid}-ability-${d.abilities}`, card: perm.card, controller: p, targets, ability: spec.ability, source: perm.iid,
        ...(spec.cost.mana.includes('{X}') ? { x } : {}),
      };
      if (spec.cost.sacrifice) {
        // The rest of the cost is paid; the player now picks what to sacrifice.
        d.pending = {
          choice: { kind: 'cards', player: p, purpose: 'sacrificeCost', min: 1, max: 1, options: sacrificeOptions(d, perm, spec), params: { card: perm.card.name } },
          resume: 'activation',
          activation: { item, named },
        };
        if (spec.cost.sacrificeSelf) sacrifice(d, perm);
        break;
      }
      if (spec.cost.sacrificeSelf) sacrifice(d, perm);
      finishActivation(d, item, named);
      break;
    }

    case 'pass': {
      if (d.priority) {
        passOnce(d);
      } else if (d.step === 'main1') {
        // Skip combat entirely when nothing can attack.
        if (creaturesOf(d, p).some(canAttack)) openWindow(d, 'combat', opponent(p), 1);
        else d.step = 'main2';
      } else if (d.step === 'attack') {
        d.step = 'main2';
      } else if (d.step === 'main2') {
        // The active player is done; the opponent gets an end-of-turn window.
        fireStep(d, 'endStep');
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
      const targets: Record<string, string> = {};
      for (const [aid, pwIid] of Object.entries(action.targets ?? {})) {
        const pw = findPermanent(d, pwIid);
        if (!attackers.some((a) => a.iid === aid) || !pw || pw.controller === p || !isPlaneswalker(pw.card)) {
          throw new IllegalAction('cannotAttackThat');
        }
        targets[aid] = pwIid;
      }
      for (const a of attackers) if (!hasKw(a, 'vigilance')) a.tapped = true;
      d.attackers = attackers.map((a) => a.iid);
      if (Object.keys(targets).length) d.attackTargets = targets;
      else delete d.attackTargets;
      d.blocks = {};
      log(d, { k: 'attack', p, cards: attackers.map((a) => a.card.name) });
      for (const [aid, pwIid] of Object.entries(targets)) {
        log(d, { k: 'attackPlaneswalker', card: findPermanent(d, aid)!.card.name, pw: findPermanent(d, pwIid)!.card.name });
      }
      for (const a of attackers) fireObject(d, 'attacks', a);
      // The attacking player gets priority first.
      openWindow(d, 'attack', p, 0);
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
        if (hasKw(a, 'menace') && bids.length < 2) {
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

  settle(d);
  return d;
}
