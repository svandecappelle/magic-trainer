import type { Card } from '../../types';
import { shuffle, type Rng } from '../goldfish';
import {
  findPayment, hasFirstStrike, hasKeyword, isCreature, isInstantOrSorcery, isLandCard, manaColors,
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
export type Step = 'main1' | 'attack' | 'block' | 'main2';

export interface GameState {
  players: [PlayerState, PlayerState];
  battlefield: Permanent[];
  active: PlayerId;
  turn: number;
  step: Step;
  attackers: string[];
  /** attacker iid → blocker iids */
  blocks: Record<string, string[]>;
  winner: PlayerId | 'draw' | null;
  log: string[];
}

export type Target = { kind: 'player'; player: PlayerId } | { kind: 'permanent'; iid: string };

/** Actions are always taken by `actor(state)`. */
export type Action =
  | { type: 'playLand'; iid: string }
  | { type: 'cast'; iid: string; target?: Target }
  | { type: 'pass' }
  | { type: 'declareAttackers'; attackers: string[] }
  | { type: 'declareBlockers'; blocks: Record<string, string[]> }
  | { type: 'concede'; player: PlayerId };

export class IllegalAction extends Error {}

export const opponent = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** Who has to act now: the defender during blocks, otherwise the active player. */
export function actor(s: GameState): PlayerId | null {
  if (s.winner !== null) return null;
  return s.step === 'block' ? opponent(s.active) : s.active;
}

// ---------- Queries ----------

export const findPermanent = (s: GameState, iid: string) => s.battlefield.find((p) => p.iid === iid);

export const creaturesOf = (s: GameState, p: PlayerId) =>
  s.battlefield.filter((x) => x.controller === p && isCreature(x.card));

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
    !hasKeyword(perm.card, 'defender') && power(perm.card) > 0
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

// ---------- Setup ----------

export interface NewGameOptions {
  decks: [Card[], Card[]];
  names: [string, string];
  first: PlayerId;
  rng?: Rng;
}

export function newGame({ decks, names, first, rng = Math.random }: NewGameOptions): GameState {
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
    active: first,
    turn: 0,
    step: 'main1',
    attackers: [],
    blocks: {},
    winner: null,
    log: [`${names[first]} goes first`],
  };
  draw(d, 0, 7);
  draw(d, 1, 7);
  beginTurn(d, first, true);
  return d;
}

// ---------- Mutating helpers (only ever used on a fresh clone) ----------

function log(d: GameState, msg: string) {
  d.log.push(msg);
  if (d.log.length > 200) d.log.splice(0, d.log.length - 200);
}

/** "Bot attacks" but "You attack". */
function says(d: GameState, p: PlayerId, verb: string): string {
  const name = d.players[p].name;
  return name === 'You' ? `You ${verb}` : `${name} ${verb}s`;
}

function draw(d: GameState, p: PlayerId, n: number) {
  for (let i = 0; i < n; i++) {
    const card = d.players[p].library.shift();
    if (!card) {
      log(d, `${d.players[p].name} can't draw from an empty library: ${says(d, p, 'lose')}`);
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
  log(d, `— Turn ${d.turn}: ${d.players[p].name} —`);
  if (!skipDraw) draw(d, p, 1);
}

function endTurn(d: GameState) {
  for (const perm of d.battlefield) {
    perm.damage = 0;
    perm.deathtouched = false;
  }
  const me = d.players[d.active];
  // Cleanup: discard down to 7, highest mana value first (simplification: no choice).
  while (me.hand.length > 7) {
    const worst = me.hand.reduce((a, b) => (b.card.cmc > a.card.cmc ? b : a));
    me.hand = me.hand.filter((c) => c !== worst);
    me.graveyard.push(worst);
    log(d, `${says(d, d.active, 'discard')} ${worst.card.name} (hand size)`);
  }
  beginTurn(d, opponent(d.active), false);
}

function removePermanent(d: GameState, perm: Permanent, zone: 'graveyard' | 'exile') {
  d.battlefield = d.battlefield.filter((x) => x.iid !== perm.iid);
  d.players[perm.controller][zone].push({ iid: perm.iid, card: perm.card });
}

/** State-based actions: lethal damage, 0 life. */
function checkStateBased(d: GameState) {
  for (const perm of [...d.battlefield]) {
    if (isCreature(perm.card) && (perm.deathtouched || perm.damage >= toughness(perm.card))) {
      removePermanent(d, perm, 'graveyard');
      log(d, `${perm.card.name} dies`);
    }
  }
  if (d.winner !== null) return;
  const dead = ([0, 1] as PlayerId[]).filter((p) => d.players[p].life <= 0);
  if (dead.length === 2) d.winner = 'draw';
  else if (dead.length === 1) d.winner = opponent(dead[0]);
  if (d.winner !== null) log(d, d.winner === 'draw' ? 'The game is a draw' : `${says(d, d.winner, 'win')}!`);
}

function dealDamage(d: GameState, source: Permanent | CardInst, controller: PlayerId, target: Permanent | PlayerId, amount: number) {
  if (amount <= 0) return;
  if (typeof target === 'number') {
    d.players[target].life -= amount;
    log(d, `${source.card.name} deals ${amount} to ${d.players[target].name}`);
  } else {
    target.damage += amount;
    if (hasKeyword(source.card, 'deathtouch')) target.deathtouched = true;
    log(d, `${source.card.name} deals ${amount} to ${target.card.name}`);
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
      let remaining = power(a.card);
      const declared = d.blocks[aid] ?? [];
      if (declared.length === 0) {
        hits.push({ source: a, target: def, amount: remaining });
        continue;
      }
      const blockers = declared.map(get).filter((x) => x !== undefined);
      const trample = hasKeyword(a.card, 'trample');
      blockers.forEach((b, i) => {
        const lethal = hasKeyword(a.card, 'deathtouch') ? 1 : Math.max(0, toughness(b.card) - b.damage);
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
        if (b && dealsNow(b)) hits.push({ source: b, target: a, amount: power(b.card) });
      }
    }

    for (const h of hits) dealDamage(d, h.source, h.source.controller, h.target, h.amount);
    checkStateBased(d);
    if (d.winner !== null) return;
  }
}

// ---------- Actions ----------

export function apply(state: GameState, action: Action): GameState {
  if (state.winner !== null) throw new IllegalAction('The game is over');
  const d = structuredClone(state);

  if (action.type === 'concede') {
    d.winner = opponent(action.player);
    log(d, says(d, action.player, 'concede'));
    return d;
  }

  const p = actor(d)!;
  const me = d.players[p];

  switch (action.type) {
    case 'playLand': {
      if (!isMainStep(d)) throw new IllegalAction('Lands can only be played in a main phase');
      if (me.landPlayed) throw new IllegalAction('You already played a land this turn');
      const inst = me.hand.find((c) => c.iid === action.iid);
      if (!inst || !isLandCard(inst.card)) throw new IllegalAction('That is not a land in your hand');
      me.hand = me.hand.filter((c) => c !== inst);
      d.battlefield.push({ ...inst, controller: p, tapped: false, sick: true, damage: 0, deathtouched: false });
      me.landPlayed = true;
      log(d, `${says(d, p, 'play')} ${inst.card.name}`);
      break;
    }

    case 'cast': {
      if (!isMainStep(d)) throw new IllegalAction('Spells can only be cast in a main phase');
      const inst = me.hand.find((c) => c.iid === action.iid);
      if (!inst || isLandCard(inst.card)) throw new IllegalAction('That is not a spell in your hand');

      const effects = parseEffects(inst.card);
      const needs = targetKind(effects);
      let target: Permanent | PlayerId | undefined;
      if (needs) {
        if (!action.target) throw new IllegalAction(`${inst.card.name} needs a target`);
        if (action.target.kind === 'player') {
          if (needs === 'creature') throw new IllegalAction('Target must be a creature');
          target = action.target.player;
        } else {
          const perm = findPermanent(d, action.target.iid);
          if (!perm || !isCreature(perm.card)) throw new IllegalAction('Target must be a creature');
          if (needs === 'player') throw new IllegalAction('Target must be a player');
          target = perm;
        }
      }

      const payment = findPayment(manaSources(d, p), parseCost(inst.card.manaCost));
      if (!payment) throw new IllegalAction(`Not enough mana for ${inst.card.name}`);
      for (const iid of payment) findPermanent(d, iid)!.tapped = true;
      me.hand = me.hand.filter((c) => c !== inst);

      if (!isInstantOrSorcery(inst.card)) {
        d.battlefield.push({ ...inst, controller: p, tapped: false, sick: true, damage: 0, deathtouched: false });
        log(d, `${says(d, p, 'cast')} ${inst.card.name}`);
        break;
      }

      const targetName = target === undefined ? '' : typeof target === 'number' ? d.players[target].name : target.card.name;
      log(d, `${says(d, p, 'cast')} ${inst.card.name}${targetName ? ` targeting ${targetName}` : ''}`);
      if (!effects.length) log(d, `(${inst.card.name}'s effect is not simulated)`);
      for (const e of effects) {
        if (e.kind === 'damage') {
          const t = e.target === 'each-opponent' ? opponent(p) : target;
          if (t !== undefined) dealDamage(d, inst, p, t, e.amount);
        } else if (e.kind === 'destroy' && target !== undefined && typeof target !== 'number') {
          if (d.battlefield.includes(target)) {
            removePermanent(d, target, e.exile ? 'exile' : 'graveyard');
            log(d, `${target.card.name} is ${e.exile ? 'exiled' : 'destroyed'}`);
          }
        } else if (e.kind === 'draw') {
          draw(d, p, e.n);
        } else if (e.kind === 'gainLife') {
          me.life += e.n;
          log(d, `${says(d, p, 'gain')} ${e.n} life`);
        }
      }
      me.graveyard.push(inst);
      break;
    }

    case 'pass': {
      if (d.step === 'main1') {
        // Skip combat entirely when nothing can attack.
        d.step = creaturesOf(d, p).some(canAttack) ? 'attack' : 'main2';
      } else if (d.step === 'attack') {
        d.step = 'main2';
      } else if (d.step === 'main2') {
        endTurn(d);
      } else {
        throw new IllegalAction('Declare blockers (or no blocks) to continue');
      }
      break;
    }

    case 'declareAttackers': {
      if (d.step !== 'attack') throw new IllegalAction('Not the declare attackers step');
      const attackers = [...new Set(action.attackers)].map((iid) => {
        const perm = findPermanent(d, iid);
        if (!perm || perm.controller !== p || !canAttack(perm)) throw new IllegalAction('That creature cannot attack');
        return perm;
      });
      if (!attackers.length) {
        d.step = 'main2';
        break;
      }
      for (const a of attackers) if (!hasKeyword(a.card, 'vigilance')) a.tapped = true;
      d.attackers = attackers.map((a) => a.iid);
      d.blocks = {};
      d.step = 'block';
      log(d, `${says(d, p, 'attack')} with ${attackers.map((a) => a.card.name).join(', ')}`);
      break;
    }

    case 'declareBlockers': {
      if (d.step !== 'block') throw new IllegalAction('Not the declare blockers step');
      const used = new Set<string>();
      const blocks: Record<string, string[]> = {};
      for (const [aid, bids] of Object.entries(action.blocks)) {
        const a = findPermanent(d, aid);
        if (!a || !d.attackers.includes(aid)) throw new IllegalAction('That creature is not attacking');
        if (!bids.length) continue;
        if (hasKeyword(a.card, 'menace') && bids.length < 2) {
          throw new IllegalAction(`${a.card.name} has menace and needs two or more blockers`);
        }
        for (const bid of bids) {
          const b = findPermanent(d, bid);
          if (!b || b.controller !== p || used.has(bid) || !canBlock(b, a)) {
            throw new IllegalAction(`${b?.card.name ?? 'That creature'} cannot block ${a.card.name}`);
          }
          used.add(bid);
        }
        blocks[aid] = bids;
        log(d, `${a.card.name} is blocked by ${bids.map((b) => findPermanent(d, b)!.card.name).join(', ')}`);
      }
      d.blocks = blocks;
      resolveCombat(d);
      d.attackers = [];
      d.blocks = {};
      d.step = 'main2';
      break;
    }
  }

  checkStateBased(d);
  return d;
}
