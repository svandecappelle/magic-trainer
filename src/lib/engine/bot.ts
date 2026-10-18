import {
  abilityMaxX, activatable, activationProblem, canPayAbility, actor, castSource, channelCost, crewOptions, crewPower, firstOpponent, mulliganBottom, isActivePlayer, opponentsOf, teamOf, canAttack, castCost, castOptions, castSources, findInGraveyard, landFaces, manaSources, canBlock, canCastNow, creaturesOf, findPermanent, firstStrikes, hasKw, hasUsefulTarget, isLegalTarget,
  legalTargets, matching, maxX, powerOf, toughnessOf, xCount,
  type Action, type Answer, type CastOption, type CardInst, type Choice, type GameState, type Permanent, type PlayerId, type StackItem, type Target, type Triggered,
} from './engine';
import {
  activatedOf, auraTarget, castInfo, castSpec, creatureValue, modeSets, faceCard, findPayment, hasInstantSpeed, isAdventure, isPlaneswalker, isSaga, isToken, staticsOf, hasKeyword, isCreature, isInstantOrSorcery, isLandCard, manaColors,
  cardColors, cardTypes, reconfiguresEnchanted, choosesBasicType, discardsLandInstead, parseCost, spellSpec, stateMana, planPayment, type AbilitySpec, type Amount, type Color, type Effect, type ManaSource,
} from './rules';
import type { Card } from '../../types';

/** Is p on my team (me included)? In a duel: p is me. */
const friend = (s: GameState, me: PlayerId, p: PlayerId) => teamOf(s, p) === teamOf(s, me);
/** All creatures of the other team. */
const foeCreatures = (s: GameState, me: PlayerId) => opponentsOf(s, me).flatMap((o) => creaturesOf(s, o));

/**
 * A heuristic opponent. It never looks at hidden information (your hand or library)
 * and evaluates combat one creature against one creature.
 */
export function botAction(s: GameState): Action {
  const me = actor(s);
  if (me === null) throw new Error('No one is to act');
  if (s.mulligan) return mulliganDecision(s, me);
  if (s.pending) return { type: 'choose', answer: answerChoice(s, s.pending.choice) };
  // Malcolm: a free spell, now or never.
  const free = s.castNow?.player === me ? s.players[me].graveyard.find((c) => c.iid === s.castNow!.iid) : undefined;
  if (free && castOptions(s, me, free.iid).length) {
    const action = isInstantOrSorcery(free.card) ? castWithGoodTarget(s, me, free) : { type: 'cast' as const, iid: free.iid };
    if (action) return action;
  }
  if (s.priority) return respond(s, me) ?? { type: 'pass' };
  if (s.step === 'block') return { type: 'declareBlockers', blocks: chooseBlocks(s, me) };
  if (s.step === 'attack') {
    // "attacks each combat if able" (Dragon's Rage Channeler with delirium) joins in any case.
    const must = creaturesOf(s, me).filter((x) => x.statics?.mustAttack && canAttack(x)).map((x) => x.iid);
    const attackers = [...new Set([...chooseAttackers(s, me), ...must])];
    const targets = chooseAttackTargets(s, me, attackers);
    return { type: 'declareAttackers', attackers, ...(Object.keys(targets).length ? { targets } : {}) };
  }

  const land = chooseLand(s, me);
  if (land) return { type: 'playLand', iid: land.iid, ...(land.face ? { face: land.face } : {}) };
  return chooseMainPhaseSpell(s, me) ?? { type: 'pass' };
}

/** A safe fallback if the chosen action turns out to be illegal. */
export function fallbackAction(s: GameState): Action {
  const me = actor(s);
  if (s.mulligan && me !== null) {
    const n = mulliganBottom(s, me);
    return { type: 'keep', bottom: s.players[me].hand.slice(0, n).map((c) => c.iid) };
  }
  if (s.pending) return { type: 'choose', answer: answerChoice(s, s.pending.choice, true) };
  if (s.priority) return { type: 'pass' };
  if (s.step === 'block') return { type: 'declareBlockers', blocks: {} };
  if (s.step === 'attack') return { type: 'declareAttackers', attackers: [] };
  return { type: 'pass' };
}

// ---------- Mulligan ----------

function mulliganDecision(s: GameState, me: PlayerId): Action {
  const hand = s.players[me].hand;
  const taken = s.mulligan!.count[me];
  const lands = hand.filter((c) => isLandCard(c.card)).length;
  const keepable = taken >= 2 || (lands >= 2 && lands <= 5);
  if (!keepable) return { type: 'mulligan' };
  return { type: 'keep', bottom: chooseBottom(hand, mulliganBottom(s, me)) };
}

/** Put cards on the bottom to keep the land/spell balance near 40% lands, expensive spells first. */
function chooseBottom(hand: CardInst[], n: number): string[] {
  let rest = [...hand];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const lands = rest.filter((c) => isLandCard(c.card));
    const spells = rest.filter((c) => !isLandCard(c.card)).sort((a, b) => b.card.cmc - a.card.cmc);
    const pick = lands.length / rest.length > 0.5 || !spells.length ? lands[0] : spells[0];
    out.push(pick.iid);
    rest = rest.filter((c) => c !== pick);
  }
  return out;
}

// ---------- Combat math ----------

const strikes = (x: Permanent) => (hasKw(x, 'double strike') ? 2 : 1);

/** Would `victim` die fighting `killer` one-on-one? */
export function dies(victim: Permanent, killer: Permanent): boolean {
  if (powerOf(killer) <= 0) return false;
  const victimKillsFirst =
    firstStrikes(victim) && !firstStrikes(killer) &&
    powerOf(victim) > 0 &&
    (hasKw(victim, 'deathtouch') || powerOf(victim) >= toughnessOf(killer) - killer.damage);
  if (victimKillsFirst) return false;
  return hasKw(killer, 'deathtouch') || powerOf(killer) * strikes(killer) >= toughnessOf(victim) - victim.damage;
}

const pumped = (perm: Permanent, e: Extract<Effect, { kind: 'pump' }>): Permanent => ({
  ...perm, boosts: [...perm.boosts, { power: e.power, toughness: e.toughness, keywords: e.keywords, until: 'endOfTurn' }],
});

/**
 * Send attackers at the opponent's planeswalkers when they can finish one off, unless the
 * attack is lethal for the player anyway. Smallest attackers first, one planeswalker at a time.
 */
function chooseAttackTargets(s: GameState, me: PlayerId, attackerIds: string[]): Record<string, string> {
  const opp = firstOpponent(s, me);
  const attackers = attackerIds.map((iid) => findPermanent(s, iid)!).sort((a, b) => powerOf(a) - powerOf(b));
  const total = attackers.reduce((n, a) => n + powerOf(a) * strikes(a), 0);
  if (total >= s.players[opp].life) return {};
  const walkers = s.battlefield
    .filter((x) => !friend(s, me, x.controller) && isPlaneswalker(x.card) && !isCreature(x.card))
    .sort((a, b) => (a.counters.loyalty ?? 0) - (b.counters.loyalty ?? 0));
  const out: Record<string, string> = {};
  let free = [...attackers];
  for (const pw of walkers) {
    const loyalty = pw.counters.loyalty ?? 0;
    const team: Permanent[] = [];
    for (const a of free) {
      if (team.reduce((n, x) => n + powerOf(x) * strikes(x), 0) >= loyalty) break;
      team.push(a);
    }
    if (team.reduce((n, x) => n + powerOf(x) * strikes(x), 0) < loyalty) continue;
    for (const a of team) out[a.iid] = pw.iid;
    free = free.filter((a) => !team.includes(a));
  }
  return out;
}

function chooseAttackers(s: GameState, me: PlayerId): string[] {
  const opp = firstOpponent(s, me);
  const attackers = creaturesOf(s, me).filter(canAttack);
  const blockers = foeCreatures(s, me).filter((b) => !b.tapped);

  // Alpha strike if damage still gets through when each blocker stops our biggest attackers.
  const damages = attackers.map((a) => powerOf(a) * strikes(a)).sort((x, y) => y - x);
  const unblocked = damages.slice(blockers.length).reduce((sum, n) => sum + n, 0);
  if (attackers.length && unblocked >= s.players[opp].life) return attackers.map((a) => a.iid);

  // Otherwise only attack where no single blocker can kill us without a good trade for us.
  return attackers
    .filter((a) =>
      blockers
        .filter((b) => canBlock(b, a))
        .every((b) => !dies(a, b) || (dies(b, a) && creatureValue(b.card) >= creatureValue(a.card))),
    )
    .map((a) => a.iid);
}

function chooseBlocks(s: GameState, me: PlayerId): Record<string, string[]> {
  const attackers = s.attackers
    .map((iid) => findPermanent(s, iid))
    .filter((x) => x !== undefined)
    .sort((a, b) => powerOf(b) * strikes(b) - powerOf(a) * strikes(a));
  const available = creaturesOf(s, me).filter((b) => !b.tapped);
  const used = new Set<string>();
  const blocks: Record<string, string[]> = {};
  let lifeAfter = s.players[me].life - attackers.reduce((sum, a) => sum + powerOf(a) * strikes(a), 0);
  const cheapest = (list: Permanent[]) =>
    list.sort((x, y) => creatureValue(x.card) - creatureValue(y.card))[0] as Permanent | undefined;

  for (const a of attackers) {
    const options = available.filter((b) => !used.has(b.iid) && canBlock(b, a));
    if (!options.length) continue;
    // Menace needs two blockers; other attackers may be worth a double block when no single block is good.
    const pair = chooseDoubleBlock(a, options, lifeAfter <= 0);
    if (hasKw(a, 'menace') || (pair && !options.some((b) => !dies(b, a) || (dies(a, b) && creatureValue(a.card) >= creatureValue(b.card))))) {
      if (!pair) continue;
      for (const b of pair) used.add(b.iid);
      blocks[a.iid] = pair.map((b) => b.iid);
      lifeAfter += powerOf(a) * strikes(a);
      continue;
    }

    const pick =
      cheapest(options.filter((b) => dies(a, b) && !dies(b, a))) ?? // kill it and survive
      cheapest(options.filter((b) => !dies(b, a))) ?? // absorb it safely
      cheapest(options.filter((b) => dies(a, b) && creatureValue(a.card) >= creatureValue(b.card))) ?? // good trade
      (lifeAfter <= 0 ? cheapest(options) : undefined); // chump block to stay alive
    if (!pick) continue;

    used.add(pick.iid);
    blocks[a.iid] = [pick.iid];
    const prevented = hasKw(a, 'trample')
      ? Math.min(powerOf(a), toughnessOf(pick)) * strikes(a)
      : powerOf(a) * strikes(a);
    lifeAfter += prevented;
  }
  return blocks;
}

/**
 * Two blockers for one attacker: together they must kill it, and what the attacker kills in return
 * (it deals damage to them in order) must be worth less than it. When `mustBlock`, any pair that
 * keeps us alive will do.
 */
function chooseDoubleBlock(a: Permanent, options: Permanent[], mustBlock: boolean): Permanent[] | null {
  let best: { pair: Permanent[]; loss: number } | null = null;
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const pair = [options[i], options[j]];
      const damage = pair.reduce((n, b) => n + powerOf(b), 0);
      const kills = pair.some((b) => hasKw(b, 'deathtouch')) || damage >= toughnessOf(a) - a.damage;
      // The attacker kills the blockers it can, cheapest first (its controller orders them).
      let left = powerOf(a) * strikes(a);
      let loss = 0;
      for (const b of [...pair].sort((x, y) => toughnessOf(x) - toughnessOf(y))) {
        const need = hasKw(a, 'deathtouch') ? 1 : toughnessOf(b) - b.damage;
        if (left >= need) {
          left -= need;
          loss += creatureValue(b.card);
        }
      }
      const good = kills && loss < creatureValue(a.card);
      if ((good || mustBlock) && (!best || loss < best.loss)) best = { pair, loss };
    }
  }
  return best?.pair ?? null;
}

// ---------- Main phase ----------

function chooseLand(s: GameState, me: PlayerId): { iid: string; face: number } | null {
  const player = s.players[me];
  if (player.landPlayed) return null;
  // Urza's Saga makes {C} from its chapter I; Multiversal Passage becomes the basic land type it needs.
  // Gemstone Mine, Gemstone Caverns and Tolarian Academy: their mana depends on counters and artifacts.
  const colorsOf = (c: Card): string[] => {
    const state = stateMana(c);
    if (choosesBasicType(c) || state === 'mining') return ['W', 'U', 'B', 'R', 'G'];
    if (state === 'perArtifact') return ['U'];
    return isSaga(c) && !manaColors(c).length ? ['C'] : manaColors(c, player.identity);
  };
  // A land exiled "you may play those cards this turn" (Glimpse the Impossible) first: it would be lost.
  const exiled = player.exile.find((c) => c.playableOnTurn === s.turn && isLandCard(c.card));
  if (exiled) return { iid: exiled.iid, face: 0 };
  const lands = player.hand.filter((c) => isLandCard(c.card) && colorsOf(c.card).length);
  if (!lands.length) {
    // A modal double-faced card with a land on its back, when there's no other land to play.
    const mdfc = player.hand.find((c) => landFaces(c.card).some((f) => f > 0));
    return mdfc ? { iid: mdfc.iid, face: landFaces(mdfc.card).find((f) => f > 0)! } : null;
  }

  // Prefer the land whose colors are most demanded by the spells in hand.
  const pips = player.hand
    .filter((c) => !isLandCard(c.card))
    .flatMap((c) => parseCost(c.card.manaCost).colored.flat());
  const score = (colors: string[]) => pips.filter((c) => colors.includes(c)).length;
  return { iid: lands.reduce((best, l) => (score(colorsOf(l.card)) > score(colorsOf(best.card)) ? l : best)).iid, face: 0 };
}

/** One way to cast one card: the option (face, kicker, zone) and, for a modal spell, its modes. */
interface Candidate {
  iid: string;
  card: Card;
  opt: CastOption;
  face: Card;
  modes?: number[];
}

/** Every way the bot can cast something now: from hand, graveyard (flashback), exile (adventures) and the command zone. */
function candidates(s: GameState, me: PlayerId): Candidate[] {
  const ps = s.players[me];
  const out: Candidate[] = [];
  // Mox Diamond: only with a land to discard that isn't this turn's land drop.
  const lands = ps.hand.filter((c) => isLandCard(c.card)).length;
  for (const inst of [...ps.hand, ...ps.graveyard, ...ps.exile, ...(ps.command ?? [])]) {
    if (discardsLandInstead(inst.card) && lands < (ps.landPlayed ? 1 : 2)) continue;
    // Chrome Mox: only with a colored nonartifact, nonland card to exile.
    if (stateMana(inst.card) === 'imprinted' && !ps.hand.some((c) => c !== inst && imprintable(c.card))) continue;
    for (const opt of castOptions(s, me, inst.iid)) {
      const modal = castInfo(inst.card, opt.face).modal;
      for (const modes of modal ? modeSets(modal) : [undefined]) {
        // Spree, Tiered: only the modes it can pay for.
        if (modal?.costs && !findPayment(castSources(s, me, inst.card, inst.iid, opt.face), castCost(s, me, inst.card, { ...opt, iid: inst.iid, modes }))) continue;
        out.push({ iid: inst.iid, card: inst.card, opt, face: faceCard(inst.card, opt.face), ...(modes ? { modes } : {}) });
      }
    }
  }
  // Kicked first (more for the card), an adventure before its creature, then the most expensive.
  const adventure = (c: Candidate) => Number(c.opt.face > 0 && isAdventure(c.card));
  return out.sort((a, b) => Number(b.opt.kicked) - Number(a.opt.kicked) || adventure(b) - adventure(a) || b.face.cmc - a.face.cmc);
}

/** The largest X affordable for a cast option. */
function candidateMaxX(s: GameState, me: PlayerId, c: Candidate): number {
  if (!xCount(c.face)) return 0;
  let x = 0;
  while (findPayment(castSources(s, me, c.card, c.iid, c.opt.face), castCost(s, me, c.card, { ...c.opt, modes: c.modes }, x + 1))) x++;
  return x;
}

const castAction = (c: Candidate, targets: Target[][] = [], x?: number): Action => ({
  type: 'cast', iid: c.iid, ...(targets.length ? { targets } : {}), ...(xCount(c.face) ? { x: x ?? 0 } : {}),
  ...(c.opt.face ? { face: c.opt.face } : {}), ...(c.opt.kicked ? { kicked: true } : {}), ...(c.modes ? { modes: c.modes } : {}),
  ...(c.opt.alt !== undefined ? { alt: c.opt.alt } : {}), ...(c.opt.exiled ? { exiled: c.opt.exiled } : {}),
});

function castCandidate(s: GameState, me: PlayerId, c: Candidate, among?: Permanent[]): Action | null {
  return playWithGoodTarget(s, me, {
    spec: castSpec(c.card, { face: c.opt.face, modes: c.modes, kicked: c.opt.kicked, alt: c.opt.alt }),
    source: c.face,
    hasX: xCount(c.face) > 0,
    maxX: candidateMaxX(s, me, c),
    act: (targets, x) => castAction(c, targets, x),
  }, among);
}

/**
 * Cycling: a land-cycler while short of lands; otherwise a card too expensive to cast soon, or an
 * extra land late in the game.
 */
function chooseCycle(s: GameState, me: PlayerId): Action | null {
  const lands = s.battlefield.filter((x) => x.controller === me && isLandCard(x.card)).length;
  for (const c of s.players[me].hand) {
    const cycling = castInfo(c.card).cycling;
    if (!cycling || !findPayment(manaSources(s, me), parseCost(cycling.cost))) continue;
    const want = cycling.search ? lands < 5 : isLandCard(c.card) ? lands >= 5 : c.card.cmc > lands + 2;
    if (want) return { type: 'cycle', iid: c.iid };
  }
  return null;
}

/** A card Chrome Mox can exile for mana: nonartifact, nonland, with a color. */
const imprintable = (card: Card) => !isLandCard(card) && !/\bArtifact\b/.test(card.typeLine) && card.colors.length > 0;

function castable(s: GameState, me: PlayerId) {
  return s.players[me].hand
    .filter((c) => canCastNow(s, me, c.card))
    .sort((a, b) => b.card.cmc - a.card.cmc);
}

// ---------- Mana planning ----------

/** What would be left to pay with after paying for `c` (null: it can't be paid). */
function sourcesAfter(s: GameState, me: PlayerId, c: Candidate): ManaSource[] | null {
  const sources = castSources(s, me, c.card, c.iid, c.opt.face);
  const plan = planPayment(sources, castCost(s, me, c.card, { ...c.opt, modes: c.modes }));
  if (!plan) return null;
  const used = new Set(plan.map((m) => m.iid));
  // A source with several mana (Sol Ring) keeps its unspent mana in the pool.
  const spent = new Set(plan.map((m) => `${m.iid}#${m.index}`));
  return sources.flatMap((m): ManaSource[] => {
    if (!used.has(m.iid)) return [m];
    return (m.units ?? [m.colors]).flatMap((colors, i) => (spent.has(`${m.iid}#${i}`) ? [] : [{ iid: `left:${m.iid}#${i}`, colors }]));
  });
}

/** Instants to keep mana up for during our turn: counterspells (from the hand), when an opponent has cards to cast. */
function heldInstants(s: GameState, me: PlayerId): CardInst[] {
  if (!opponentsOf(s, me).some((o) => s.players[o].hand.length)) return [];
  return s.players[me].hand.filter((c) => isInstantOrSorcery(c.card) && hasInstantSpeed(c.card) && spellSpec(c.card).effects.some((e) => e.kind === 'counter'));
}

/**
 * Casting `c` now leaves mana for the instant we hold (or `c` is the bigger play: it costs more than that instant).
 */
function keepsInstantMana(s: GameState, me: PlayerId, c: Candidate): boolean {
  const held = heldInstants(s, me).filter((h) => h.iid !== c.iid);
  if (!held.length) return true;
  const cheapest = held.reduce((a, b) => (b.card.cmc < a.card.cmc ? b : a));
  if (c.face.cmc > cheapest.card.cmc) return true;
  // The counter can't be paid now anyway: nothing to keep.
  if (!findPayment(manaSources(s, me, cheapest.card), castCost(s, me, cheapest.card, { iid: cheapest.iid }))) return true;
  const left = sourcesAfter(s, me, c);
  return !!left && !!findPayment(left, castCost(s, me, cheapest.card, { iid: cheapest.iid }));
}

/** A ritual (only mana: Dark Ritual) worth casting: its mana makes a spell in hand affordable that isn't now. */
function ritualFor(s: GameState, me: PlayerId, all: Candidate[]): Candidate | null {
  for (const ritual of all) {
    const effects = spellSpec(ritual.face).effects;
    if (!isInstantOrSorcery(ritual.face) || !effects.length || !effects.every((e) => e.kind === 'addMana')) continue;
    const left = sourcesAfter(s, me, ritual);
    if (!left) continue;
    const made = effects.flatMap((e) => (e.kind === 'addMana' ? e.units : [])).map((colors, i): ManaSource => ({ iid: `ritual:${i}`, colors }));
    const ps = s.players[me];
    const enabled = ps.hand.some((c) => c.iid !== ritual.iid && !isLandCard(c.card) && !canCastNow(s, me, c.card)
      && spellSpec(c.card).effects.length + Number(!isInstantOrSorcery(c.card)) > 0
      && !!findPayment([...left, ...made], castCost(s, me, c.card, { iid: c.iid })));
    if (enabled) return ritual;
  }
  return null;
}

/** Flash creatures wait for the end of the opponent's turn (they still block, and dodge sorcery-speed removal). */
const waitsForEndStep = (s: GameState, me: PlayerId, card: Card) =>
  isCreature(card) && hasInstantSpeed(card) && !hasKeyword(card, 'haste') && opponentsOf(s, me).length > 0;

function chooseMainPhaseSpell(s: GameState, me: PlayerId): Action | null {
  const all = candidates(s, me);
  // A ritual first when its mana makes another spell castable (cast once the mana is in the pool): in the second main
  // phase, where creatures are cast too.
  const ritual = isActivePlayer(s, me) && !s.priority && s.step === 'main2' ? ritualFor(s, me, all) : null;
  if (ritual) return castAction(ritual);
  for (const c of all) {
    const card = c.face;
    // Counterspell mana stays up for the opponent's turn unless this is the bigger play.
    if (!hasInstantSpeed(card) && !keepsInstantMana(s, me, c)) continue;
    if (!isInstantOrSorcery(card)) {
      if (waitsForEndStep(s, me, card)) continue;
      // Creatures and other permanents: before combat only if they can attack right away.
      const aura = auraTarget(card);
      if (aura) {
        const host = chooseAuraHost(s, me, card);
        if (host) return castAction(c, [[{ kind: 'permanent', iid: host.iid }]]);
        continue;
      }
      // Bestow (Detective's Phoenix): an Aura on our best creature; another permanent cast with a target: skipped.
      const spec = castSpec(c.card, { face: c.opt.face, kicked: c.opt.kicked, alt: c.opt.alt });
      if (spec.targets.length) {
        const host = legalTargets(s, me, spec.targets[0], undefined, card)
          .flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []))
          .filter((x) => x.controller === me && isCreature(x.card))
          .sort((a, b) => creatureValue(b.card) - creatureValue(a.card))[0];
        if (host && spec.targets.length === 1 && (s.step === 'main1' || s.step === 'main2')) return castAction(c, [[{ kind: 'permanent', iid: host.iid }]]);
        continue;
      }
      if (s.step === 'main2' || (isCreature(card) && hasKeyword(card, 'haste'))) return castAction(c);
      continue;
    }
    const action = castCandidate(s, me, c);
    if (action) return action;
  }
  return usePlaneswalkers(s, me) ?? useAbility(s, me) ?? crewVehicles(s, me) ?? animateLands(s, me) ?? (s.step === 'main2' ? chooseCycle(s, me) : null);
}

/**
 * Crew a Vehicle before combat when it hits harder than the creatures tapped for it would (those that can't attack
 * anyway cost nothing).
 */
function crewVehicles(s: GameState, me: PlayerId): Action | null {
  if (s.step !== 'main1' || !isActivePlayer(s, me) || s.priority) return null;
  for (const v of s.battlefield) {
    if (v.controller !== me || isCreature(v.card) || (v.sick && !hasKeyword(v.card, 'haste'))) continue;
    const index = activatedOf(v.card).findIndex((a) => a.cost.crew !== undefined);
    if (index < 0 || activationProblem(s, me, v, index)) continue;
    const n = activatedOf(v.card)[index].cost.crew!;
    let power = 0;
    let lost = 0;
    for (const c of crewOptions(s, v).sort((a, b) => crewPower(a) - crewPower(b))) {
      if (power >= n) break;
      power += crewPower(c);
      if (canAttack(c)) lost += powerOf(c);
    }
    if (power >= n && powerOf(v) > lost) return { type: 'activate', iid: v.iid, index };
  }
  return null;
}

/** The reflexive ability resolving now ("When you do, …") has a legal target for each of its slots. */
function reflexiveUseful(s: GameState, me: PlayerId): boolean {
  const item = s.resolving?.item;
  const e = item?.ability?.effects.find((x) => x.kind === 'reflexive');
  if (!item || e?.kind !== 'reflexive') return false;
  return e.then.targets.every((slot) => legalTargets(s, me, slot, undefined, item.card).length >= Math.max(1, slot.min));
}

/**
 * The modes of a modal trigger: those that would be played as a spell (with a good target), targeted ones first; then
 * any allowed one if some must be chosen.
 */
function triggerModes(s: GameState, me: PlayerId, t: Triggered): number[] {
  const modal = t.ability.modal!;
  const disabled = s.pending?.choice.kind === 'mode' ? s.pending.choice.disabled ?? [] : [];
  const allowed = modal.specs.map((_, i) => i).filter((i) => !disabled.includes(i));
  const good = (i: number) => playWithGoodTarget(s, me, { spec: modal.specs[i], source: t.source.card, hasX: false, maxX: 0, act: () => ({ type: 'pass' }) }) !== null;
  const ranked = [...allowed.filter((i) => good(i) && modal.specs[i].targets.length), ...allowed.filter((i) => good(i) && !modal.specs[i].targets.length)];
  const picked = ranked.slice(0, modal.max);
  for (const i of allowed) if (picked.length < modal.min && !picked.includes(i)) picked.push(i);
  return picked.sort((a, b) => a - b);
}

/**
 * Turn a manland into a creature before combat, with the mana left once spells are cast, when no untapped creature of
 * the opponents could kill it in a block. (It isn't animated to block.)
 */
function animateLands(s: GameState, me: PlayerId): Action | null {
  if (s.step !== 'main1' || !isActivePlayer(s, me) || s.priority) return null;
  const blockers = opponentsOf(s, me).flatMap((p) => creaturesOf(s, p)).filter((c) => !c.tapped);
  for (const land of s.battlefield) {
    if (land.controller !== me || land.tapped || land.sick || isCreature(land.card)) continue;
    const index = activatedOf(land.card).findIndex((a) => a.ability.effects.some((e) => e.kind === 'animate' && e.to === 'self'));
    if (index < 0 || activationProblem(s, me, land, index)) continue;
    const animate = activatedOf(land.card)[index].ability.effects.find((e) => e.kind === 'animate')!;
    if (animate.kind !== 'animate' || !animate.power) continue;
    const flies = animate.keywords.includes('flying');
    const dangerous = blockers.filter((b) => !flies || hasKw(b, 'flying') || hasKw(b, 'reach'));
    if (dangerous.some((b) => powerOf(b) >= (animate.toughness ?? 0) || hasKw(b, 'deathtouch'))) continue;
    return { type: 'activate', iid: land.iid, index };
  }
  return null;
}

/**
 * One loyalty ability per planeswalker each turn: a minus ability that removes something and
 * leaves the planeswalker alive, otherwise a plus (or zero) ability, with targets if it needs them.
 */
function usePlaneswalkers(s: GameState, me: PlayerId): Action | null {
  const byWalker = new Map<string, ReturnType<typeof activatable>>();
  for (const a of activatable(s, me)) {
    // Tezzeret the Seeker's −X isn't planned by the bot.
    if (a.spec.cost.loyalty === undefined || a.spec.cost.loyaltyX) continue;
    byWalker.set(a.perm.iid, [...(byWalker.get(a.perm.iid) ?? []), a]);
  }
  for (const abilities of byWalker.values()) {
    const plays = abilities.map(({ perm, index, spec }) => ({
      loyalty: spec.cost.loyalty!, perm, spec,
      act: (targets: Target[][]): Action => ({ type: 'activate', iid: perm.iid, index, ...(targets.length ? { targets } : {}) }),
    }));
    for (const p of plays.filter((x) => x.loyalty < 0 && (x.perm.counters.loyalty ?? 0) + x.loyalty > 0)) {
      const action = playWithGoodTarget(s, me, { spec: p.spec.ability, hasX: false, maxX: 0, act: p.act });
      if (action && hitsTheirPermanent(s, me, action)) return action;
    }
    for (const p of plays.filter((x) => x.loyalty >= 0).sort((a, b) => b.loyalty - a.loyalty)) {
      const good = playWithGoodTarget(s, me, { spec: p.spec.ability, hasX: false, maxX: 0, act: p.act });
      if (good) return good;
      const targets = triggerTargets(s, me, p.spec.ability, false);
      if (targets.every((ts, i) => ts.length >= p.spec.ability.targets[i].min)) return p.act(targets);
    }
  }
  return null;
}

// ---------- Targets ----------

type Intent = 'harm' | 'help' | 'neutral';

/** The spell's rules with X replaced by a number, so amounts can be compared. */
function withX(spec: AbilitySpec, x: number): AbilitySpec {
  const n = (a: Amount) => (a === 'X' ? x : a === 'lifeGained' || a === 'sacrificed' ? 0 : a);
  const effects = spec.effects.map((e): Effect => {
    if (e.kind === 'damage' || e.kind === 'damageAll') return { ...e, amount: n(e.amount) };
    if (e.kind === 'dig') return e;
    if (e.kind === 'loseAbilitiesDestroy') return { ...e, maxManaValue: n(e.maxManaValue) };
    if ('n' in e) return { ...e, n: n(e.n) } as Effect;
    return e;
  });
  return { ...spec, effects };
}
const num = (a: Amount) => (typeof a === 'number' ? a : 0);

/** Is the effect bad for what it hits (removal, burn, discard…) or good (pump, card draw…)? */
function intentOf(e: Effect): Intent {
  switch (e.kind) {
    case 'damage': case 'destroy': case 'counter': case 'loseLife': case 'mill': case 'discard': case 'bounce': case 'bounceAll': case 'sacrifice':
    case 'poison': case 'gainControl': case 'flickerAtEnd': case 'airbend': case 'plot': case 'setBasePT':
    // Hope of Ghirapur, Relic of Progenitus, Talon Gates of Madara: on the opponent.
    case 'noNoncreatureSpells': case 'exileOwnGraveCard': case 'phaseOut':
      return 'harm';
    case 'tap':
      return e.untap ? 'neutral' : 'harm';
    case 'pump':
      return e.power < 0 || e.toughness < 0 ? 'harm' : 'help';
    case 'addCounters':
      return e.counter === '-1/-1' ? 'harm' : 'help';
    case 'draw': case 'gainLife': case 'returnCard': case 'grantFlashback': case 'flicker': case 'search': case 'tokenCopy': case 'preventDamage': case 'extraTurn':
      return 'help';
    default:
      return 'neutral';
  }
}

/** Would these effects kill the creature? */
function kills(perm: Permanent, effects: Effect[]): boolean {
  // A planeswalker dies when damage takes all its loyalty.
  const walker = isPlaneswalker(perm.card) && !isCreature(perm.card);
  let damage = walker ? 0 : perm.damage;
  let toughness = walker ? (perm.counters.loyalty ?? 0) : toughnessOf(perm);
  for (const e of effects) {
    if (e.kind === 'destroy') return true;
    if (e.kind === 'damage' || e.kind === 'damageAll') damage += num(e.amount);
    if (e.kind === 'pump' || e.kind === 'pumpAll') toughness += e.toughness;
    // Multiply by Zero: the base toughness replaced.
    if (e.kind === 'setBasePT' && !walker) toughness += e.toughness - (Number(perm.card.toughness) || 0);
    if (e.kind === 'addCounters' && e.counter === '-1/-1') toughness -= num(e.n);
  }
  return toughness <= 0 || damage >= toughness;
}

/**
 * Value of what a board-wide effect would kill: theirs minus ours.
 * Wraths are only worth it when they hurt the opponent clearly more.
 */
function massValue(s: GameState, me: PlayerId, effects: Effect[]): number {
  let score = 0;
  for (const e of effects) {
    // Day of Black Sun: the creatures with mana value X or less (indestructible ones survive).
    if (e.kind === 'loseAbilitiesDestroy') {
      for (const perm of s.battlefield.filter((x) => isCreature(x.card) && x.card.cmc <= num(e.maxManaValue))) {
        if (hasKw(perm, 'indestructible')) continue;
        score += friend(s, me, perm.controller) ? -creatureValue(perm.card) : creatureValue(perm.card);
      }
      continue;
    }
    if (e.kind !== 'destroyAll' && e.kind !== 'damageAll' && e.kind !== 'pumpAll' && e.kind !== 'bounceAll') continue;
    for (const perm of matching(s, me, e.which)) {
      if (!isCreature(perm.card)) {
        if (e.kind === 'destroyAll') score += friend(s, me, perm.controller) ? -1 : 1;
        continue;
      }
      // Bounced creatures count for half: they come back.
      const dead = e.kind === 'destroyAll' || e.kind === 'bounceAll' || kills(perm, [e]);
      const value = (dead ? creatureValue(perm.card) : e.kind === 'pumpAll' ? (e.power + e.toughness) / 2 : 0) / (e.kind === 'bounceAll' ? 2 : 1);
      // A pump is good for our creatures; a kill is good on theirs.
      const good = e.kind === 'pumpAll' && !dead ? friend(s, me, perm.controller) : !friend(s, me, perm.controller);
      score += good ? value : -value;
    }
  }
  return score;
}

const asTarget = (x: Permanent | PlayerId): Target =>
  typeof x === 'number' ? { kind: 'player', player: x } : { kind: 'permanent', iid: x.iid };

/** Something the bot can do with targets: a spell to cast or an ability to activate. */
/**
 * Where an Aura goes: a helpful one ("gets +2/+2", "has flying") on our best creature, a harmful one
 * ("can't attack or block", "-2/-2") on their best creature.
 */
function chooseAuraHost(s: GameState, me: PlayerId, card: Card): Permanent | null {
  // Swift Reconfiguration: their best creature stops being one.
  if (reconfiguresEnchanted(card) !== null) {
    return legalTargets(s, me, auraTarget(card)!, undefined, card)
      .flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []))
      .filter((x) => !friend(s, me, x.controller) && isCreature(x.card))
      .sort((a, b) => creatureValue(b.card) - creatureValue(a.card))[0] ?? null;
  }
  const statics = staticsOf(card).filter((st) => st.who === 'enchanted');
  if (!statics.length) return null;
  const score = statics.reduce((n, st) => n + st.power + st.toughness + st.keywords.length * 1.5 - (st.cantAttack ? 4 : 0) - (st.cantBlock ? 2 : 0), 0);
  const helpful = score >= 0;
  const hosts = legalTargets(s, me, auraTarget(card)!, undefined, card)
    .flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []))
    .filter((x) => friend(s, me, x.controller) === helpful && isCreature(x.card))
    .sort((a, b) => creatureValue(b.card) - creatureValue(a.card));
  return hosts[0] ?? null;
}

interface Play {
  spec: AbilitySpec;
  hasX: boolean;
  /** The largest X affordable. */
  maxX: number;
  act: (targets: Target[][], x: number) => Action;
  /** The card targeting, for protection from its colors. */
  source?: Card;
  /** The permanent whose ability it is (Hope of Ghirapur: "a player dealt combat damage by Hope of Ghirapur"). */
  selfIid?: string;
}

function castWithGoodTarget(s: GameState, me: PlayerId, inst: { iid: string; card: Card }, among?: Permanent[]): Action | null {
  return playWithGoodTarget(s, me, {
    spec: spellSpec(inst.card),
    source: inst.card,
    hasX: xCount(inst.card) > 0,
    maxX: maxX(s, me, inst.card),
    act: (targets, x) => ({ type: 'cast', iid: inst.iid, ...(targets.length ? { targets } : {}), ...(xCount(inst.card) ? { x } : {}) }),
  }, among);
}

/**
 * Cast removal, burn, card draw, discard, board wipes… (or activate such an ability) if there is a
 * sensible target. Counterspells and pump spells are kept for responses. X is as large as we can pay.
 */
function playWithGoodTarget(s: GameState, me: PlayerId, play: Play, among?: Permanent[]): Action | null {
  const x = play.maxX;
  if (play.hasX && x === 0) return null; // X = 0 would do nothing
  const spec = withX(play.spec, x);
  const { effects } = spec;
  const cast = (targets: Target[][] = []): Action => play.act(targets, x);
  if (!effects.length) return null; // not simulated: casting it would do nothing
  if (effects.every((e) => e.kind === 'addMana')) return null; // rituals: the bot doesn't plan mana ahead
  if (effects.some((e) => e.kind === 'copySpell' || e.kind === 'preventCombat')) return null; // used in response only (fogs)
  // Threaten: only worth it before our attack.
  if (effects.some((e) => e.kind === 'gainControl' && e.untilEndOfTurn) && !(isActivePlayer(s, me) && s.step === 'main1' && !s.priority)) return null;
  // An edict needs something to hit.
  if (effects.some((e) => e.kind === 'sacrifice' && !opponentsOf(s, me).some((o) => matching(s, o, e.which).some((x) => x.controller === o)))) return null;
  if (effects.some((e) => e.kind === 'counter' || e.kind === 'gainProtection' || e.kind === 'gainProtectionAll' || (e.kind === 'pump' && intentOf(e) === 'help'))) return null; // used in response only
  if (effects.some((e) => e.kind === 'tap' && e.untap)) return null;

  const mass = effects.some((e) => e.kind === 'destroyAll' || e.kind === 'damageAll' || e.kind === 'pumpAll' || e.kind === 'bounceAll' || e.kind === 'loseAbilitiesDestroy');
  if (mass) {
    if (among) return null;
    // Positive pumps only before attacking; wipes when they clearly favour us.
    const pumpOnly = effects.every((e) => e.kind !== 'destroyAll' && e.kind !== 'damageAll' && e.kind !== 'bounceAll' && e.kind !== 'loseAbilitiesDestroy' && !(e.kind === 'pumpAll' && e.toughness < 0));
    if (pumpOnly && !(s.step === 'main1' && isActivePlayer(s, me) && creaturesOf(s, me).some(canAttack))) return null;
    if (massValue(s, me, effects) < (pumpOnly ? 3 : 2)) return null;
  }

  const fight = effects.find((e) => e.kind === 'fight');
  if (fight?.kind === 'fight') {
    const pair = chooseFight(s, me, spec, fight);
    return pair ? cast(pair) : null;
  }
  if (!spec.targets.length) return cast();
  if (spec.targets.length > 1) return null;
  if (spec.targets[0].kind === 'card') {
    if (among) return null;
    const card = chooseGraveCard(s, me, spec);
    return card ? cast([[card]]) : null;
  }
  // Step Through: "two target creatures": the most valuable of theirs, when there are enough.
  const slot = spec.targets[0];
  if (slot.min > 1) {
    const onSlot = effects.filter((e) => 'to' in e && typeof e.to === 'object' && e.to.slot === 0);
    if (!onSlot.length || !onSlot.every((e) => intentOf(e) === 'harm')) return null;
    const theirs = legalTargets(s, me, slot, undefined, play.source)
      .flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []))
      .filter((x) => !friend(s, me, x.controller) && (!among || among.includes(x)))
      .sort((a, b) => creatureValue(b.card) - creatureValue(a.card));
    return theirs.length >= slot.min ? cast([theirs.slice(0, slot.max).map(asTarget)]) : null;
  }
  const target = chooseTarget(s, me, spec, among, play.source, play.selfIid);
  return target === null ? null : cast([[asTarget(target)]]);
}

/** Pick our creature and theirs for a fight or "bite": ours must kill theirs (and survive a real fight). */
function chooseFight(s: GameState, me: PlayerId, spec: AbilitySpec, e: Extract<Effect, { kind: 'fight' }>, source?: Card): Target[][] | null {
  if ('iid' in e.a) {
    // Thorin's reflexive trigger: the creature is fixed; the best of theirs it kills, if any.
    const a = findPermanent(s, e.a.iid);
    const victim = a && legalTargets(s, me, spec.targets[e.b.slot], undefined, source).flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []))
      .filter((x) => !friend(s, me, x.controller) && powerOf(a) >= toughnessOf(x) - x.damage)
      .sort((x, y) => creatureValue(y.card) - creatureValue(x.card))[0];
    const out: Target[][] = spec.targets.map(() => []);
    if (victim) out[e.b.slot] = [{ kind: 'permanent', iid: victim.iid }];
    return out;
  }
  const slotA = spec.targets[e.a.slot];
  const slotB = spec.targets[e.b.slot];
  const legal = (slot: typeof slotA) => legalTargets(s, me, slot).flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []));
  const mine = legal(slotA).filter((x) => x.controller === me).sort((a, b) => powerOf(b) - powerOf(a));
  const theirs = legal(slotB).filter((x) => !friend(s, me, x.controller)).sort((a, b) => creatureValue(b.card) - creatureValue(a.card));
  for (const t of theirs) {
    const m = mine.find((x) => powerOf(x) >= toughnessOf(t) - t.damage && (e.oneSided || powerOf(t) < toughnessOf(x) - x.damage));
    if (m) {
      const out: Target[][] = spec.targets.map(() => []);
      out[e.a.slot] = [{ kind: 'permanent', iid: m.iid }];
      out[e.b.slot] = [{ kind: 'permanent', iid: t.iid }];
      return out;
    }
  }
  return null;
}

/** The best target for slot 0 of a spell, among legal ones (and `among`, if given). */
function chooseTarget(s: GameState, me: PlayerId, spec: AbilitySpec, among?: Permanent[], source?: Card, selfIid?: string): Permanent | PlayerId | null {
  const slot = spec.targets[0];
  const onSlot = spec.effects.filter((e) => 'to' in e && typeof e.to === 'object' && e.to.slot === 0);
  const harm = onSlot.some((e) => intentOf(e) === 'harm');
  const legal = legalTargets(s, me, slot, selfIid, source);
  // An opponent who can be targeted (Hope of Ghirapur: only one it dealt combat damage to).
  const opp = legal.find((t): t is { kind: 'player'; player: PlayerId } => t.kind === 'player' && !friend(s, me, t.player))?.player ?? firstOpponent(s, me);
  const perms = legal
    .filter((t) => t.kind === 'permanent')
    .map((t) => findPermanent(s, (t as { iid: string }).iid)!)
    .filter((x) => !among || among.includes(x))
    .sort((a, b) => creatureValue(b.card) - creatureValue(a.card));
  const canPick = (p: PlayerId) => !among && legal.some((t) => t.kind === 'player' && t.player === p);

  if (slot.kind === 'player') {
    // Discard, mill, life loss on the opponent; card draw and life gain for us. Drawing outweighs a
    // little life loss (Sign in Blood goes on ourselves) unless the loss is lethal for the opponent.
    const lethal = onSlot.some((e) => e.kind === 'loseLife' && num(e.n) >= s.players[opp].life);
    const p = lethal || (harm && !onSlot.some((e) => e.kind === 'draw')) ? opp : me;
    if (!canPick(p)) return null;
    if (onSlot.some((e) => e.kind === 'discard') && !s.players[opp].hand.length) return null;
    // Relic of Progenitus: only with something to exile.
    if (onSlot.some((e) => e.kind === 'exileOwnGraveCard') && !s.players[opp].graveyard.length) return null;
    return p;
  }
  if (harm) {
    const theirs = perms.filter((x) => !friend(s, me, x.controller));
    const dmg = onSlot.find((e) => e.kind === 'damage');
    const canGoFace = canPick(opp);
    if (dmg?.kind === 'damage' && canGoFace && num(dmg.amount) >= s.players[opp].life) return opp;
    const killable = theirs.find((x) => kills(x, onSlot));
    if (killable) return killable;
    if (onSlot.some((e) => e.kind === 'destroy' || e.kind === 'bounce')) return theirs[0] ?? null;
    // Tapping: their best untapped creature, before we attack.
    if (onSlot.some((e) => e.kind === 'tap')) {
      return isActivePlayer(s, me) && s.step === 'main1' ? (theirs.find((x) => !x.tapped && isCreature(x.card)) ?? null) : null;
    }
    return canGoFace && dmg ? opp : null;
  }
  // Helpful effects go on our own best creature.
  return perms.find((x) => x.controller === me) ?? null;
}

/** Worth of a card for graveyard and library choices. */
const cardWorth = (card: Card) => (isCreature(card) ? creatureValue(card) : card.cmc + (isLandCard(card) ? 1 : 0));

/** A card in a graveyard for slot 0: our best card to get back, or their best card to exile. */
function chooseGraveCard(s: GameState, me: PlayerId, spec: AbilitySpec): Target | null {
  const help = spec.effects.some((e) => 'to' in e && typeof e.to === 'object' && e.to.slot === 0 && intentOf(e) === 'help');
  const cards = legalTargets(s, me, spec.targets[0])
    .map((t) => ({ t, found: t.kind === 'card' ? findInGraveyard(s, t.iid) : undefined }))
    .filter((x) => x.found && friend(s, me, x.found.owner) === help)
    .sort((a, b) => cardWorth(b.found!.inst.card) - cardWorth(a.found!.inst.card));
  return cards[0]?.t ?? null;
}

/** Fetch lands and "sacrifice this land: search for a basic land": ramp, worth a little life. */
const isLandSearch = (spec: AbilitySpec) =>
  spec.effects.some((e) => e.kind === 'search' && e.dest === 'battlefield' && e.filter.types?.includes('land'));

// ---------- Activated abilities ----------

/** Abilities the bot may use now, with the rules it follows for their costs. */
function abilityPlays(s: GameState, me: PlayerId): (Play & { perm: Permanent; index: number; equip: boolean; tapsCreature: boolean; sacrifice: boolean; spendable: boolean; sacrificeForLock: boolean })[] {
  return activatable(s, me)
    // Never pay life (it could loop until death), except a little for a fetch land, and Necropotence's cards (three a
    // turn at most, with 12 life or more).
    .filter(({ spec }) => !spec.cost.life || (isLandSearch(spec.ability) && s.players[me].life > 6)
      || (spec.ability.effects.some((e) => e.kind === 'exileTopUntilEndStep') && s.players[me].life >= 12 && (s.handAtEndStep ?? []).filter((x) => x.p === me).length < 3))
    // Discarding for an ability (Psychic Frog, Survival of the Fittest) isn't planned by the bot.
    .filter(({ spec }) => !spec.cost.discard)
    // Wishclaw Talisman goes to the opponent: not planned by the bot.
    .filter(({ spec }) => !spec.ability.effects.some((e) => e.kind === 'opponentGainsSource'))
    // Free abilities could repeat forever; loyalty abilities are once a turn and handled by usePlaneswalkers.
    // Phyrexian Devourer: grows while its power is 2 or less (a card would have to be worth 5 to reach 7).
    .filter(({ perm, spec }) => ((spec.cost.tap || spec.cost.mana || spec.cost.sacrificeSelf || spec.cost.life) && spec.cost.loyalty === undefined)
      || (spec.cost.exileTop && powerOf(perm) <= 2 && s.players[me].library.length > 10))
    // Relic of Progenitus: exiling all graveyards only when the opponents' hold four cards or more.
    .filter(({ spec }) => !spec.ability.effects.some((e) => e.kind === 'exileGraveyards') || opponentsOf(s, me).reduce((n, o) => n + s.players[o].graveyard.length, 0) >= 4)
    // Becoming a creature until end of turn (Iron Man Armor) isn't planned by the bot; Vehicles are crewed by crewVehicles.
    .filter(({ spec }) => !spec.ability.effects.some((e) => e.kind === 'animate'))
    // Ghost Vacuum: only with creature cards exiled with it.
    .filter(({ perm, spec }) => !spec.ability.effects.some((e) => e.kind === 'returnExiledSpirits')
      || (s.exiledWith?.[perm.iid] ?? []).some((x) => s.players[x.owner].exile.some((c) => c.iid === x.iid && isCreature(c.card))))
    // Equipment already on a creature stays there.
    .filter(({ perm, spec }) => !(spec.ability.effects.some((e) => e.kind === 'attach') && perm.attachedTo && findPermanent(s, perm.attachedTo)))
    .map(({ perm, index, spec }) => ({
      perm,
      index,
      equip: !!spec.equip,
      spec: spec.ability,
      source: perm.card,
      hasX: spec.cost.mana.includes('{X}'),
      maxX: abilityMaxX(s, perm, index),
      tapsCreature: spec.cost.tap && isCreature(perm.card),
      sacrifice: spec.cost.sacrificeSelf || !!spec.cost.sacrifice,
      selfIid: perm.iid,
      /** Hope of Ghirapur: sacrificed for its lock, not as removal. */
      sacrificeForLock: spec.ability.effects.some((e) => e.kind === 'noNoncreatureSpells' || e.kind === 'exileGraveyards'),
      /** Clue, Food, fetch lands: made to be sacrificed. */
      spendable: (isToken(perm.card) && !isCreature(perm.card) && !spec.cost.sacrifice) || isLandSearch(spec.ability),
      act: (targets: Target[][], x: number): Action => ({
        type: 'activate', iid: perm.iid, index, ...(targets.length ? { targets } : {}), ...(spec.cost.mana.includes('{X}') ? { x } : {}),
      }),
    }));
}

/**
 * Channel abilities of cards in hand (Otawara, Boseiju, Eiganjo). The card is lost, and it's often a land: only to
 * remove something (see useAbility), and keeping a land to play this turn.
 */
function channelPlays(s: GameState, me: PlayerId): Play[] {
  const hand = s.players[me].hand;
  const landsInHand = hand.filter((c) => isLandCard(c.card)).length;
  return hand.flatMap((c) => {
    const channel = castInfo(c.card).channel;
    const cost = channel && channelCost(s, me, c.card);
    if (!channel || !cost || !findPayment(manaSources(s, me), cost)) return [];
    // A land kept for the land drop (Talon Gates of Madara's {4} puts it onto the battlefield instead: no loss).
    if (isLandCard(c.card) && !channel.keepsCard && !s.players[me].landPlayed && landsInHand <= 1) return [];
    return [{ spec: channel.ability, source: c.card, hasX: false, maxX: 0, act: (targets: Target[][]): Action => ({ type: 'channel', iid: c.iid, ...(targets.length ? { targets } : {}) }) }];
  });
}

/** Does the action hit one of the opponent's permanents (removal, as opposed to burn to the face or card draw)? */
const hitsTheirPermanent = (s: GameState, me: PlayerId, action: Action) =>
  (action.type === 'activate' || action.type === 'channel') && (action.targets ?? []).flat().some((t) => {
    const perm = t.kind === 'permanent' ? findPermanent(s, t.iid) : undefined;
    return !!perm && !friend(s, me, perm.controller);
  });

/**
 * Use an ability. Tapping a creature or sacrificing a permanent has a price, so:
 * creatures tap in the second main phase or at the end of the opponent's turn unless it removes
 * something; sacrifices only to remove something, or when the source is about to die anyway.
 */
function useAbility(s: GameState, me: PlayerId, among?: Permanent[]): Action | null {
  const top = s.stack.at(-1);
  const doomed = (perm: Permanent) => !!top && !friend(s, me, top.controller) && top.targets.flat().some((t) => t.kind === 'permanent' && t.iid === perm.iid);
  const freeTime = (isActivePlayer(s, me) && s.step === 'main2' && !s.priority) || (s.priority?.reason === 'end' && !isActivePlayer(s, me));
  for (const play of abilityPlays(s, me)) {
    // Equip costs depend on the creature (Dwarven Mauler, Dragonfire Blade): only the ones we can pay for.
    const affordable = play.equip ? creaturesOf(s, me).filter((c) => canPayAbility(s, play.perm, play.index, c)) : undefined;
    const action = playWithGoodTarget(s, me, play, affordable ? (among ? among.filter((x) => affordable.includes(x)) : affordable) : among);
    if (!action) continue;
    const removal = hitsTheirPermanent(s, me, action);
    if (play.sacrifice && !removal && !doomed(play.perm) && !(play.spendable && freeTime) && !play.sacrificeForLock) continue;
    if (play.tapsCreature && !removal && !freeTime) continue;
    return action;
  }
  for (const play of channelPlays(s, me)) {
    const action = playWithGoodTarget(s, me, play, among);
    if (action && hitsTheirPermanent(s, me, action)) return action;
    // Talon Gates of Madara: onto the battlefield with spare mana at the end of the opponent's turn.
    if (action && play.spec.effects.some((e) => e.kind === 'putSelfFromHand') && s.priority?.reason === 'end' && !isActivePlayer(s, me) && !among) return action;
  }
  return null;
}

// ---------- Responding with instants ----------

function respond(s: GameState, me: PlayerId): Action | null {
  const top = s.stack.at(-1);
  const spells = castable(s, me).filter((c) => hasInstantSpeed(c.card) && hasUsefulTarget(s, me, c.card));
  const withEffect = (kind: Effect['kind'], intent?: Intent) =>
    spells
      .map((c) => {
        const spec = withX(spellSpec(c.card), maxX(s, me, c.card));
        return { ...c, spec, effects: spec.effects };
      })
      .filter((c) => c.spec.targets.length <= 1 && c.effects.some((e) => e.kind === kind && (!intent || intentOf(e) === intent)));

  if (top && !friend(s, me, top.controller)) {
    // Counter anything that matters: non-creature spells and creatures of mana value 3+.
    if (!isCreature(top.card) || top.card.cmc >= 3) {
      const target: Target = { kind: 'spell', iid: top.iid };
      for (const c of withEffect('counter')) {
        if (isLegalTarget(s, me, c.spec.targets[0], target)) return { type: 'cast', iid: c.iid, targets: [[target]] };
      }
    }
    // Skycoach Conductor: All Aboard's copy blinks our creature out of the way.
    const blinked = blinkFrom(s, me, top);
    if (blinked) return blinked;
    // Mother of Runes, Reverent Mantra: protection from the color of what targets our creature.
    const shielded = protectFrom(s, me, top, spells);
    if (shielded) return shielded;
    // Save a creature from a burn spell with a pump spell.
    const saved = saveFromBurn(s, me, top, withEffect('pump', 'help'));
    if (saved) return saved;
    // A permanent about to be removed can still be sacrificed for value.
    return useAbility(s, me);
  }
  if (top) return null; // our own spell is on top: let it resolve

  const reason = s.priority!.reason;
  if (reason === 'attack' && !isActivePlayer(s, me)) {
    // Before blocks: shoot down the best attacker we can kill.
    const attackers = s.attackers.map((iid) => findPermanent(s, iid)).filter((x) => x !== undefined);
    for (const c of [...withEffect('destroy'), ...withEffect('damage'), ...withEffect('pump', 'harm')]) {
      const action = castWithGoodTarget(s, me, c, attackers);
      if (action) return action;
    }
    const shot = useAbility(s, me, attackers);
    if (shot) return shot;
  }
  if (reason === 'block') {
    const trick = combatTrick(s, me, withEffect('pump', 'help'));
    if (trick) return trick;
    // Fog when the attack would kill us.
    if (!isActivePlayer(s, me)) {
      const incoming = s.attackers
        .filter((aid) => !(s.blocks[aid]?.length))
        .reduce((n, aid) => { const a = findPermanent(s, aid); return n + (a ? powerOf(a) * strikes(a) : 0); }, 0);
      const fog = withEffect('preventCombat')[0];
      if (fog && incoming >= s.players[me].life) return { type: 'cast', iid: fog.iid };
    }
  }
  if (reason === 'end' && !isActivePlayer(s, me)) {
    // End of the opponent's turn: flash creatures held back, then mana that would otherwise go to waste.
    const flash = candidates(s, me).find((c) => waitsForEndStep(s, me, c.face) && !auraTarget(c.face));
    if (flash) return castAction(flash);
    for (const c of spells) {
      const action = castWithGoodTarget(s, me, c);
      if (action) return action;
    }
    return useAbility(s, me) ?? chooseCycle(s, me);
  }
  return null;
}

/** A prepared flicker spell (All Aboard) for our creature an opponent's spell or ability targets. */
function blinkFrom(s: GameState, me: PlayerId, top: StackItem): Action | null {
  for (const perm of s.battlefield) {
    if (perm.controller !== me || !perm.prepared || !castOptions(s, me, perm.iid).length) continue;
    const spell = castSource(s, me, perm.iid)!.inst.card;
    const slot = spellSpec(spell).targets[0];
    if (!slot || !spellSpec(spell).effects.some((e) => e.kind === 'flicker')) continue;
    const target = top.targets.flat().find((t) => t.kind === 'permanent' && findPermanent(s, t.iid)?.controller === me && isLegalTarget(s, me, slot, t));
    if (target) return { type: 'cast', iid: perm.iid, targets: [[target]] };
  }
  return null;
}

/** Protection from the color of the opponent's spell or ability targeting one of our creatures. */
function protectFrom(s: GameState, me: PlayerId, top: StackItem, spells: CardInst[]): Action | null {
  if (!cardColors(top.card).length) return null;
  const mine = top.targets.flat().flatMap((t) => {
    const perm = t.kind === 'permanent' ? findPermanent(s, t.iid) : undefined;
    return perm && friend(s, me, perm.controller) && isCreature(perm.card) ? [perm] : [];
  });
  if (!mine.length) return null;
  for (const play of abilityPlays(s, me)) {
    if (!play.spec.effects.some((e) => e.kind === 'gainProtection')) continue;
    const target = mine.map((x): Target => ({ kind: 'permanent', iid: x.iid })).find((t) => isLegalTarget(s, me, play.spec.targets[0], t));
    if (target) return play.act([[target]], 0);
  }
  const mantra = spells.find((c) => spellSpec(c.card).effects.some((e) => e.kind === 'gainProtectionAll'));
  return mantra ? { type: 'cast', iid: mantra.iid } : null;
}

type PumpSpell = CardInst & { effects: Effect[]; spec: AbilitySpec };

function pumpOf(spell: PumpSpell) {
  return spell.effects.find((e) => e.kind === 'pump') as Extract<Effect, { kind: 'pump' }>;
}

/** Can this pump spell target that creature? */
const canPump = (s: GameState, me: PlayerId, spell: PumpSpell, perm: Permanent) =>
  isLegalTarget(s, me, spell.spec.targets[0], { kind: 'permanent', iid: perm.iid });

function saveFromBurn(s: GameState, me: PlayerId, top: StackItem, pumps: PumpSpell[]): Action | null {
  const t = top.targets[0]?.[0];
  if (t?.kind !== 'permanent') return null;
  const victim = findPermanent(s, t.iid);
  const dmg = withX(spellSpec(top.card), top.x ?? 0).effects.find((e) => e.kind === 'damage');
  if (!victim || !friend(s, me, victim.controller) || !dmg || dmg.kind !== 'damage') return null;
  const amount = num(dmg.amount);
  const left = toughnessOf(victim) - victim.damage;
  if (amount < left) return null;
  const pump = pumps.find((p) => left + pumpOf(p).toughness > amount && canPump(s, me, p, victim));
  return pump ? { type: 'cast', iid: pump.iid, targets: [[{ kind: 'permanent', iid: victim.iid }]] } : null;
}

/** After blocks: pump one of our creatures if it turns a losing or even fight into a win. */
function combatTrick(s: GameState, me: PlayerId, pumps: PumpSpell[]): Action | null {
  if (!pumps.length) return null;
  for (const [aid, bids] of Object.entries(s.blocks)) {
    const attacker = findPermanent(s, aid);
    const blocker = bids.length === 1 ? findPermanent(s, bids[0]) : undefined;
    if (!attacker || !blocker) continue;
    const [mine, theirs] = friend(s, me, attacker.controller) ? [attacker, blocker] : [blocker, attacker];
    for (const p of pumps) {
      if (!canPump(s, me, p, mine)) continue;
      const boosted = pumped(mine, pumpOf(p));
      const better = (dies(mine, theirs) && !dies(boosted, theirs)) || (!dies(theirs, mine) && dies(theirs, boosted) && !dies(boosted, theirs));
      if (better) return { type: 'cast', iid: p.iid, targets: [[{ kind: 'permanent', iid: mine.iid }]] };
    }
  }
  return null;
}

// ---------- Choices ----------

/** Answers any pending choice. `safe` gives the simplest valid answer (used as a fallback). */
function answerChoice(s: GameState, choice: Choice, safe = false): Answer {
  switch (choice.kind) {
    case 'cards': {
      let options = [...choice.options];
      if (choice.purpose === 'clone') {
        if (safe) return { kind: 'cards', iids: [] };
        // Copy the best creature on the battlefield (Clever Impersonator: the best permanent).
        const worth = (c: Card) => (isCreature(c) ? creatureValue(c) : cardWorth(c));
        const best = [...options].sort((a, b) => worth(b.card) - worth(a.card))[0];
        return { kind: 'cards', iids: best ? [best.iid] : [] };
      }
      if (choice.purpose === 'collectEvidence') {
        // Collect evidence: the fewest cards reaching the total mana value (the biggest first).
        const n = Number(choice.params?.n ?? 0);
        const picked: string[] = [];
        let total = 0;
        for (const c of [...options].sort((a, b) => b.card.cmc - a.card.cmc)) {
          if (total >= n) break;
          picked.push(c.iid);
          total += c.card.cmc;
        }
        return { kind: 'cards', iids: picked };
      }
      if (choice.purpose === 'escapeExile') {
        // Escape: the least useful cards; Nethergoyf: one of each card type until there are enough.
        const n = Number(choice.params?.n ?? 0);
        const types = Number(choice.params?.types ?? 0);
        const cheap = [...options].sort((a, b) => cardWorth(a.card) - cardWorth(b.card));
        if (!types) return { kind: 'cards', iids: cheap.slice(0, n).map((c) => c.iid) };
        const picked: typeof options = [];
        const seen = new Set<string>();
        for (const c of cheap) {
          if (seen.size >= types) break;
          if (cardTypes(c.card).some((t) => !seen.has(t))) {
            picked.push(c);
            for (const t of cardTypes(c.card)) seen.add(t);
          }
        }
        return { kind: 'cards', iids: picked.map((c) => c.iid) };
      }
      if (choice.purpose === 'distributeTwo') {
        // Bounty of the Hunt: two counters on the best creature.
        const best = [...options].sort((a, b) => creatureValue(b.card) - creatureValue(a.card))[0];
        return { kind: 'cards', iids: best ? [best.iid] : [] };
      }
      if (choice.purpose === 'enlist') {
        if (safe) return { kind: 'cards', iids: [] };
        // The strongest creature staying home, unless it has a tap ability (a mana creature, a looter).
        const idle = options
          .filter((c) => !activatedOf(c.card).some((a) => a.cost.tap) && !/\{T\}[^:\n]*: Add\b/.test(c.card.oracleText) && powerOf(findPermanent(s, c.iid)!) > 0)
          .sort((a, b) => powerOf(findPermanent(s, b.iid)!) - powerOf(findPermanent(s, a.iid)!));
        return { kind: 'cards', iids: idle.length ? [idle[0].iid] : [] };
      }
      if (choice.purpose === 'crewCost') {
        // The weakest creatures that are enough; all of them when unsure (always enough: crewing was allowed).
        const n = Number(choice.params?.n ?? 0);
        if (safe) return { kind: 'cards', iids: options.map((c) => c.iid) };
        const crew: string[] = [];
        let power = 0;
        for (const c of [...options].sort((a, b) => powerOf(findPermanent(s, a.iid)!) - powerOf(findPermanent(s, b.iid)!))) {
          if (power >= n) break;
          crew.push(c.iid);
          power += powerOf(findPermanent(s, c.iid)!);
        }
        return { kind: 'cards', iids: crew };
      }
      if (!safe && choice.purpose === 'dig') {
        // The best cards: Equipment and creatures we can cast soon.
        options.sort((a, b) => cardWorth(b.card) - cardWorth(a.card));
        return { kind: 'cards', iids: options.slice(0, choice.max).map((c) => c.iid) };
      }
      // Brainstorm: the cards worth least go back on top.
      if (choice.purpose === 'putBack') return { kind: 'cards', iids: [...options].sort((a, b) => cardWorth(a.card) - cardWorth(b.card)).slice(0, choice.min).map((c) => c.iid) };
      // Stoneforge Mystic: the most expensive Equipment.
      if (choice.purpose === 'putFromHand') return { kind: 'cards', iids: [...options].sort((a, b) => b.card.cmc - a.card.cmc).slice(0, 1).map((c) => c.iid) };
      // Gemstone Caverns: a spare land, or the card worth least with a full hand.
      if (choice.purpose === 'gemstoneCaverns') {
        const hand = s.players[choice.player].hand;
        const lands = options.filter((c) => isLandCard(c.card));
        const spare = lands.length >= 3 ? lands[0] : hand.length >= 7 ? [...options].sort((a, b) => cardWorth(a.card) - cardWorth(b.card))[0] : undefined;
        return { kind: 'cards', iids: !safe && spare ? [spare.iid] : [] };
      }
      // Chrome Mox: the colored card worth least.
      if (choice.purpose === 'exileFromHand') {
        const colored = options.filter((c) => imprintable(c.card)).sort((a, b) => cardWorth(a.card) - cardWorth(b.card));
        return { kind: 'cards', iids: safe ? [] : colored.slice(0, 1).map((c) => c.iid) };
      }
      // Mox Diamond: a land, always (it goes to the graveyard otherwise).
      if (choice.purpose === 'discardLandInstead') return { kind: 'cards', iids: options.slice(0, 1).map((c) => c.iid) };
      // Overlord of the Balemurk: the best card back.
      if (choice.purpose === 'returnFromGraveyard') {
        const best = [...options].sort((a, b) => cardWorth(b.card) - cardWorth(a.card))[0];
        return { kind: 'cards', iids: best ? [best.iid] : [] };
      }
      // Ruthless Lawbringer: a creature worth less than what the "When you do" part destroys.
      if (!safe && choice.purpose === 'reflexiveSacrifice') {
        const victim = [...options].sort((a, b) => creatureValue(a.card) - creatureValue(b.card))[0];
        const item = s.resolving?.item;
        const e = item?.ability?.effects.find((x) => x.kind === 'reflexive');
        const best = e?.kind === 'reflexive' && e.then.targets[0]
          ? legalTargets(s, choice.player, e.then.targets[0], undefined, item!.card)
            .flatMap((t) => (t.kind === 'permanent' ? [findPermanent(s, t.iid)!] : []))
            .filter((x) => !friend(s, choice.player, x.controller))
            .reduce((n, x) => Math.max(n, isCreature(x.card) ? creatureValue(x.card) : x.card.cmc + 1), 0)
          : 0;
        return { kind: 'cards', iids: victim && reflexiveUseful(s, choice.player) && creatureValue(victim.card) < best ? [victim.iid] : [] };
      }
      if (!safe && choice.purpose === 'reflexiveCost') {
        // Inti: a spare land, when the "When you do" part has something to target.
        const hand = s.players[choice.player].hand;
        const spareLand = hand.filter((c) => isLandCard(c.card)).length >= 2 ? options.find((c) => isLandCard(c.card)) : undefined;
        return { kind: 'cards', iids: spareLand && reflexiveUseful(s, choice.player) ? [spareLand.iid] : [] };
      }
      if (!safe && choice.purpose === 'tradeForCard') {
        // Chandra's +2: a spare land from the hand, or an artifact token; otherwise nothing.
        const hand = s.players[choice.player].hand;
        const spareLand = hand.filter((c) => isLandCard(c.card)).length >= 2 ? options.find((c) => isLandCard(c.card) && hand.includes(c)) : undefined;
        const token = options.find((c) => isToken(c.card) && !isCreature(c.card) && !/\bVehicle\b/.test(c.card.typeLine));
        const pick = spareLand ?? token;
        return { kind: 'cards', iids: pick ? [pick.iid] : [] };
      }
      if (!safe && choice.purpose === 'legendRule') {
        // Keep the copy with the most counters (loyalty, +1/+1).
        const counters = (c: CardInst) => Object.values(findPermanent(s, c.iid)?.counters ?? {}).reduce((n, x) => n + (x ?? 0), 0);
        options.sort((a, b) => counters(b) - counters(a));
      } else if (!safe && (choice.purpose === 'sacrifice' || choice.purpose === 'sacrificeCost')) {
        // Give up what is worth least: tokens and small creatures first.
        const worth = (c: CardInst) => (isCreature(c.card) ? creatureValue(c.card) : c.card.cmc) - (isToken(c.card) ? 1 : 0);
        options.sort((a, b) => worth(a) - worth(b));
      } else if (!safe && choice.purpose === 'search') {
        // Lands of the colors our hand needs most; otherwise the most expensive card.
        const pips = s.players[choice.player].hand.flatMap((c) => parseCost(c.card.manaCost).colored.flat());
        const have = new Set(s.battlefield.filter((x) => x.controller === choice.player).flatMap((x) => manaColors(x.card, s.players[choice.player].identity)));
        const score = (c: CardInst) => isLandCard(c.card)
          ? manaColors(c.card, s.players[choice.player].identity).reduce((n, col) => n + pips.filter((p) => p === col).length + (have.has(col) ? 0 : 2), 0)
          : cardWorth(c.card);
        options.sort((a, b) => score(b) - score(a));
        return { kind: 'cards', iids: options.slice(0, choice.max).map((c) => c.iid) };
      } else if (!safe && choice.purpose === 'exileCost') {
        // Exile what we won't get back: lands and spells before creature cards.
        options.sort((a, b) => Number(isCreature(a.card)) - Number(isCreature(b.card)));
      } else if (!safe && choice.purpose === 'discardChosen') {
        // Take their best card: the most expensive spell.
        options.sort((a, b) => b.card.cmc - a.card.cmc);
      } else if (choice.purpose === 'discardUnlessArtifact') {
        // Tezzeret, Betrayer of Flesh: the cheapest artifact card, otherwise two cards.
        const artifact = options.filter((c) => cardTypes(c.card).includes('artifact')).sort((a, b) => a.card.cmc - b.card.cmc)[0];
        return { kind: 'cards', iids: artifact ? [artifact.iid] : options.slice(0, choice.max).map((c) => c.iid) };
      } else if (!safe && (choice.purpose === 'cleanupDiscard' || choice.purpose === 'discard' || choice.purpose === 'discardCost')) {
        // Discard what we can use least: extra lands beyond what the hand needs, then the most expensive spells.
        const lands = options.filter((c) => isLandCard(c.card));
        const spells = options.filter((c) => !isLandCard(c.card)).sort((a, b) => b.card.cmc - a.card.cmc);
        const landsOnField = s.battlefield.filter((x) => x.controller === choice.player && isLandCard(x.card)).length;
        options = landsOnField >= 5 ? [...lands, ...spells] : [...spells, ...lands];
      }
      return { kind: 'cards', iids: options.slice(0, choice.min).map((c) => c.iid) };
    }
    case 'arrange': {
      if (choice.purpose === 'damageOrder') {
        // Kill the most: the blockers that need the least damage first.
        const left = (c: CardInst) => { const p = findPermanent(s, c.iid); return p ? toughnessOf(p) - p.damage : 0; };
        return { kind: 'arrange', zones: { top: [...choice.cards].sort((a, b) => left(a) - left(b)).map((c) => c.iid) } };
      }
      const keep = choice.zones.includes('top') ? 'top' : choice.zones[0];
      if (safe || choice.zones.length < 2) return { kind: 'arrange', zones: { [keep]: choice.cards.map((c) => c.iid) } };
      // Scry/surveil: keep lands while short on them, and spells we can cast soon.
      const away = choice.zones.find((z) => z !== 'top')!;
      // Enlightened Confidant: a card cheap enough comes back to hand from the graveyard; put it there.
      const toHandMax = choice.params?.toHandMax;
      if (typeof toHandMax === 'number') {
        const cheap = (c: CardInst) => c.card.cmc <= toHandMax;
        return { kind: 'arrange', zones: { top: choice.cards.filter((c) => !cheap(c)).map((c) => c.iid), [away]: choice.cards.filter(cheap).map((c) => c.iid) } };
      }
      const lands = s.battlefield.filter((x) => x.controller === choice.player && isLandCard(x.card)).length +
        s.players[choice.player].hand.filter((c) => isLandCard(c.card)).length;
      const wanted = (c: CardInst) => (isLandCard(c.card) ? lands < 5 : c.card.cmc <= lands + 1);
      return {
        kind: 'arrange',
        zones: { top: choice.cards.filter(wanted).map((c) => c.iid), [away]: choice.cards.filter((c) => !wanted(c)).map((c) => c.iid) },
      };
    }
    case 'mode':
      // Multiversal Passage: the basic type of the color its hand and library need most.
      // Utopia Sprawl's mana: the same.
      if (choice.purpose === 'basicType' || choice.purpose === 'manaColor') {
        const ps = s.players[choice.player];
        const need = (color: string) => [...ps.hand, ...ps.library].reduce((n, c) => n + (c.card.manaCost.match(new RegExp(`\\{${color}\\}`, 'g'))?.length ?? 0), 0);
        const order = ['W', 'U', 'B', 'R', 'G'];
        const best = order.reduce((a, b) => (need(b) > need(a) ? b : a));
        return { kind: 'mode', modes: [order.indexOf(best)] };
      }
      // Protection: from the color of the opponent's spell on the stack, or the color they play most.
      if (choice.purpose === 'color') {
        const top = s.stack.at(-1);
        const theirs = top && !friend(s, choice.player, top.controller) ? cardColors(top.card) : [];
        const order: Color[] = ['W', 'U', 'B', 'R', 'G'];
        const seen = (color: Color) => s.battlefield.filter((x) => !friend(s, choice.player, x.controller) && cardColors(x.card).includes(color)).length;
        const best = theirs[0] ?? order.reduce((a, b) => (seen(b) > seen(a) ? b : a));
        return { kind: 'mode', modes: [order.indexOf(best)] };
      }
      if (choice.purpose === 'triggerMode' && s.pending?.trigger?.ability.modal) return { kind: 'mode', modes: triggerModes(s, choice.player, s.pending.trigger) };
      return { kind: 'mode', modes: Array.from({ length: choice.min }, (_, i) => i) };
    case 'yesNo':
      // Explore: a card it can't cast soon goes to the graveyard.
      if (choice.purpose === 'exploreMill') {
        const revealed = s.players[choice.player].library[0];
        const lands = s.battlefield.filter((x) => x.controller === choice.player && isLandCard(x.card)).length;
        return { kind: 'yesNo', yes: !!revealed && revealed.card.cmc > lands + 1 };
      }
      // Ponder: the top cards were just arranged, keep them.
      if (choice.purpose === 'mayShuffle') return { kind: 'yesNo', yes: false };
      // Cori-Steel Cutter: it stays on the creature it already equips.
      if (choice.purpose === 'attachToToken') return { kind: 'yesNo', yes: false };
      // Paying to keep our spell is worth it; our own "you may" abilities are used.
      // Shock lands: pay while life is comfortable.
      if (choice.purpose === 'payLife') return { kind: 'yesNo', yes: !safe && s.players[choice.player].life > 10 };
      // "Discard a card or pay 3 life": life while it is comfortable, otherwise the first cost.
      if (choice.purpose === 'costChoice') {
        const life = String(choice.params?.no).startsWith('life:');
        return { kind: 'yesNo', yes: safe || !life || s.players[choice.player].life <= 10 };
      }
      // Mana Vault: paying {4} in the upkeep to untap a source of {C}{C}{C} loses mana this turn; anything else is used.
      if (choice.purpose === 'mayPay') {
        const effects = s.resolving?.item.ability?.effects ?? [];
        return { kind: 'yesNo', yes: !safe && !effects.every((e) => e.kind === 'tap' && e.untap && e.to === 'self') };
      }
      if (choice.purpose === 'reflexiveRemoveCounter') return { kind: 'yesNo', yes: !safe && reflexiveUseful(s, choice.player) };
      if (choice.purpose === 'reflexivePay') return { kind: 'yesNo', yes: !safe && reflexiveUseful(s, choice.player) && s.players[choice.player].life > Number(choice.params?.life ?? 0) + 5 };
      // Ward—Pay N life: while life stays comfortable.
      // Subtlety: our spell goes back on top, to be drawn again.
      if (choice.purpose === 'tuckTop') return { kind: 'yesNo', yes: true };
      // Cumulative upkeep: kept while it costs at most {2}.
      if (choice.purpose === 'cumulativeUpkeep') return { kind: 'yesNo', yes: !safe && Number(choice.params?.n ?? 0) <= 2 };
      // Rhystic Study: pay the tax when the mana isn't needed for anything else in hand.
      if (choice.purpose === 'payOrDraw') return { kind: 'yesNo', yes: !safe && castable(s, choice.player).length === 0 };
      if (choice.purpose === 'payLifeOrCounter') return { kind: 'yesNo', yes: !safe && s.players[choice.player].life > Number(choice.params?.n ?? 0) + 5 };
      return { kind: 'yesNo', yes: !safe && (choice.purpose === 'payOrCounter' || choice.purpose === 'optional') };
    case 'targets':
      return { kind: 'targets', targets: triggerTargets(s, choice.player, { targets: choice.slots, effects: triggerEffects(s, choice) }, safe, choice.source.card, choice.source.iid) };
  }
}

/** The effects of the trigger waiting for targets, to know whether its targets are hurt or helped. */
function triggerEffects(s: GameState, choice: Choice): Effect[] {
  return s.pending?.choice === choice ? (s.pending.trigger?.ability.effects ?? []) : [];
}

/**
 * Targets for a triggered ability. Unlike a spell, it can't be kept for later: when the only
 * legal targets are bad ones, the least bad are chosen.
 */
function triggerTargets(s: GameState, me: PlayerId, spec: AbilitySpec, safe: boolean, source?: Card, sourceIid?: string): Target[][] {
  const fight = spec.effects.find((e) => e.kind === 'fight');
  const pair = !safe && fight?.kind === 'fight' ? chooseFight(s, me, spec, fight, source) : null;
  if (pair) return pair;
  return spec.targets.map((slot, i) => {
    // With the source, for protection and hexproof from monocolored.
    const legal = legalTargets(s, me, slot, sourceIid, source);
    if (safe) return legal.slice(0, slot.min);
    const onSlot = spec.effects.filter((e) => 'to' in e && typeof e.to === 'object' && e.to.slot === i);
    const harm = onSlot.some((e) => intentOf(e) === 'harm');
    const ours = (t: Target) => {
      if (t.kind === 'player') return friend(s, me, t.player);
      if (t.kind === 'card') return friend(s, me, findInGraveyard(s, t.iid)?.owner ?? -1);
      return friend(s, me, (t.kind === 'permanent' ? findPermanent(s, t.iid)?.controller : s.stack.find((x) => x.iid === t.iid)?.controller) ?? -1);
    };
    const value = (t: Target) => {
      if (t.kind === 'card') return cardWorth(findInGraveyard(s, t.iid)!.inst.card);
      if (t.kind !== 'permanent') return t.kind === 'player' ? 2.5 : 3;
      const perm = findPermanent(s, t.iid)!;
      if (harm && kills(perm, onSlot)) return 10 + creatureValue(perm.card);
      // Damage that doesn't kill is better spent on the player.
      if (harm && onSlot.some((e) => e.kind === 'damage')) return 1;
      return isCreature(perm.card) ? creatureValue(perm.card) : perm.card.cmc;
    };
    // Good targets first (theirs for harm, ours for help), the most valuable first; then the least valuable others.
    const good = legal.filter((t) => ours(t) !== harm).sort((a, b) => value(b) - value(a));
    const bad = legal.filter((t) => ours(t) === harm).sort((a, b) => value(a) - value(b));
    const n = Math.max(slot.min, Math.min(slot.max, good.length));
    return [...good, ...bad].slice(0, n);
  });
}
