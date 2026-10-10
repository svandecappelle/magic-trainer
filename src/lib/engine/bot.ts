import {
  actor, canAttack, canBlock, canCastNow, creaturesOf, findPermanent, firstStrikes, hasKw, hasUsefulTarget, isLegalTarget,
  legalTargets, opponent, powerOf, toughnessOf,
  type Action, type Answer, type CardInst, type Choice, type GameState, type Permanent, type PlayerId, type StackItem, type Target,
} from './engine';
import {
  creatureValue, hasInstantSpeed, hasKeyword, isCreature, isInstantOrSorcery, isLandCard, manaColors,
  parseCost, parseEffects, spellSpec, type AbilitySpec, type Effect,
} from './rules';

/**
 * A heuristic opponent. It never looks at hidden information (your hand or library)
 * and evaluates combat one creature against one creature.
 */
export function botAction(s: GameState): Action {
  const me = actor(s);
  if (me === null) throw new Error('No one is to act');
  if (s.mulligan) return mulliganDecision(s, me);
  if (s.pending) return { type: 'choose', answer: answerChoice(s, s.pending.choice) };
  if (s.priority) return respond(s, me) ?? { type: 'pass' };
  if (s.step === 'block') return { type: 'declareBlockers', blocks: chooseBlocks(s, me) };
  if (s.step === 'attack') return { type: 'declareAttackers', attackers: chooseAttackers(s, me) };

  const land = chooseLand(s, me);
  if (land) return { type: 'playLand', iid: land };
  return chooseMainPhaseSpell(s, me) ?? { type: 'pass' };
}

/** A safe fallback if the chosen action turns out to be illegal. */
export function fallbackAction(s: GameState): Action {
  const me = actor(s);
  if (s.mulligan && me !== null) {
    const n = Math.min(s.mulligan.count[me], s.players[me].hand.length);
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
  return { type: 'keep', bottom: chooseBottom(hand, Math.min(taken, hand.length)) };
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

function chooseAttackers(s: GameState, me: PlayerId): string[] {
  const opp = opponent(me);
  const attackers = creaturesOf(s, me).filter(canAttack);
  const blockers = creaturesOf(s, opp).filter((b) => !b.tapped);

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
    if (hasKw(a, 'menace')) continue; // would need two blockers; keep it simple
    const options = available.filter((b) => !used.has(b.iid) && canBlock(b, a));
    if (!options.length) continue;

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

// ---------- Main phase ----------

function chooseLand(s: GameState, me: PlayerId): string | null {
  const player = s.players[me];
  if (player.landPlayed) return null;
  const lands = player.hand.filter((c) => isLandCard(c.card) && manaColors(c.card).length);
  if (!lands.length) return null;

  // Prefer the land whose colors are most demanded by the spells in hand.
  const pips = player.hand
    .filter((c) => !isLandCard(c.card))
    .flatMap((c) => parseCost(c.card.manaCost).colored.flat());
  const score = (colors: string[]) => pips.filter((c) => colors.includes(c)).length;
  return lands.reduce((best, l) => (score(manaColors(l.card)) > score(manaColors(best.card)) ? l : best)).iid;
}

function castable(s: GameState, me: PlayerId) {
  return s.players[me].hand
    .filter((c) => canCastNow(s, me, c.card))
    .sort((a, b) => b.card.cmc - a.card.cmc);
}

function chooseMainPhaseSpell(s: GameState, me: PlayerId): Action | null {
  for (const { iid, card } of castable(s, me)) {
    if (!isInstantOrSorcery(card)) {
      // Creatures and other permanents: before combat only if they can attack right away.
      if (s.step === 'main2' || (isCreature(card) && hasKeyword(card, 'haste'))) return { type: 'cast', iid };
      continue;
    }
    const action = castWithGoodTarget(s, me, iid, spellSpec(card));
    if (action) return action;
  }
  return null;
}

// ---------- Targets ----------

type Intent = 'harm' | 'help' | 'neutral';

/** Is the effect bad for what it hits (removal, burn, shrinking) or good (pump, +1/+1 counters)? */
function intentOf(e: Effect): Intent {
  if (e.kind === 'damage' || e.kind === 'destroy' || e.kind === 'counter') return 'harm';
  if (e.kind === 'pump') return e.power < 0 || e.toughness < 0 ? 'harm' : 'help';
  if (e.kind === 'addCounters') return e.counter === '-1/-1' ? 'harm' : 'help';
  return 'neutral';
}

/** Would these effects kill the creature? */
function kills(perm: Permanent, effects: Effect[]): boolean {
  let damage = perm.damage;
  let toughness = toughnessOf(perm);
  for (const e of effects) {
    if (e.kind === 'destroy') return true;
    if (e.kind === 'damage') damage += e.amount;
    if (e.kind === 'pump') toughness += e.toughness;
    if (e.kind === 'addCounters' && e.counter === '-1/-1') toughness -= e.n;
  }
  return toughness <= 0 || damage >= toughness;
}

const asTarget = (x: Permanent | PlayerId): Target =>
  typeof x === 'number' ? { kind: 'player', player: x } : { kind: 'permanent', iid: x.iid };

/**
 * Cast removal, burn, card draw, life gain or +1/+1 counters if there is a sensible target.
 * Counterspells and pump spells are kept for responses. Only single-target-slot spells.
 */
function castWithGoodTarget(s: GameState, me: PlayerId, iid: string, spec: AbilitySpec, among?: Permanent[]): Action | null {
  const { effects } = spec;
  if (!effects.length) return null; // not simulated: casting it would do nothing
  if (effects.some((e) => e.kind === 'counter' || (e.kind === 'pump' && intentOf(e) === 'help'))) return null; // used in response only
  if (!spec.targets.length) return { type: 'cast', iid };
  if (spec.targets.length > 1) return null;
  const target = chooseTarget(s, me, spec, among);
  return target === null ? null : { type: 'cast', iid, targets: [[asTarget(target)]] };
}

/** The best target for slot 0 of a spell, among legal ones (and `among`, if given). */
function chooseTarget(s: GameState, me: PlayerId, spec: AbilitySpec, among?: Permanent[]): Permanent | PlayerId | null {
  const opp = opponent(me);
  const slot = spec.targets[0];
  const onSlot = spec.effects.filter((e) => typeof e.to === 'object' && e.to.slot === 0);
  const harm = onSlot.some((e) => intentOf(e) === 'harm');
  const legal = legalTargets(s, me, slot);
  const perms = legal
    .filter((t) => t.kind === 'permanent')
    .map((t) => findPermanent(s, (t as { iid: string }).iid)!)
    .filter((x) => !among || among.includes(x))
    .sort((a, b) => creatureValue(b.card) - creatureValue(a.card));

  if (harm) {
    const theirs = perms.filter((x) => x.controller === opp);
    const dmg = onSlot.find((e) => e.kind === 'damage');
    const canGoFace = !among && legal.some((t) => t.kind === 'player' && t.player === opp);
    if (dmg?.kind === 'damage' && canGoFace && dmg.amount >= s.players[opp].life) return opp;
    const killable = theirs.find((x) => kills(x, onSlot));
    if (killable) return killable;
    if (onSlot.some((e) => e.kind === 'destroy')) return theirs[0] ?? null;
    return canGoFace && dmg ? opp : null;
  }
  // Helpful effects go on our own best creature.
  return perms.find((x) => x.controller === me) ?? null;
}

// ---------- Responding with instants ----------

function respond(s: GameState, me: PlayerId): Action | null {
  const opp = opponent(me);
  const top = s.stack.at(-1);
  const spells = castable(s, me).filter((c) => hasInstantSpeed(c.card) && hasUsefulTarget(s, me, c.card));
  const withEffect = (kind: Effect['kind'], intent?: Intent) =>
    spells
      .map((c) => ({ ...c, spec: spellSpec(c.card), effects: parseEffects(c.card) }))
      .filter((c) => c.spec.targets.length <= 1 && c.effects.some((e) => e.kind === kind && (!intent || intentOf(e) === intent)));

  if (top && top.controller === opp) {
    // Counter anything that matters: non-creature spells and creatures of mana value 3+.
    if (!isCreature(top.card) || top.card.cmc >= 3) {
      const target: Target = { kind: 'spell', iid: top.iid };
      for (const c of withEffect('counter')) {
        if (isLegalTarget(s, me, c.spec.targets[0], target)) return { type: 'cast', iid: c.iid, targets: [[target]] };
      }
    }
    // Save a creature from a burn spell with a pump spell.
    const saved = saveFromBurn(s, me, top, withEffect('pump', 'help'));
    if (saved) return saved;
    return null;
  }
  if (top) return null; // our own spell is on top: let it resolve

  const reason = s.priority!.reason;
  if (reason === 'attack' && s.active === opp) {
    // Before blocks: shoot down the best attacker we can kill.
    const attackers = s.attackers.map((iid) => findPermanent(s, iid)).filter((x) => x !== undefined);
    for (const c of [...withEffect('destroy'), ...withEffect('damage'), ...withEffect('pump', 'harm')]) {
      const action = castWithGoodTarget(s, me, c.iid, c.spec, attackers);
      if (action) return action;
    }
  }
  if (reason === 'block') {
    const trick = combatTrick(s, me, withEffect('pump', 'help'));
    if (trick) return trick;
  }
  if (reason === 'end' && s.active === opp) {
    // End of the opponent's turn: use mana that would otherwise go to waste.
    for (const c of spells) {
      const action = castWithGoodTarget(s, me, c.iid, spellSpec(c.card));
      if (action) return action;
    }
  }
  return null;
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
  const dmg = parseEffects(top.card).find((e) => e.kind === 'damage');
  if (!victim || victim.controller !== me || !dmg || dmg.kind !== 'damage') return null;
  const left = toughnessOf(victim) - victim.damage;
  if (dmg.amount < left) return null;
  const pump = pumps.find((p) => left + pumpOf(p).toughness > dmg.amount && canPump(s, me, p, victim));
  return pump ? { type: 'cast', iid: pump.iid, targets: [[{ kind: 'permanent', iid: victim.iid }]] } : null;
}

/** After blocks: pump one of our creatures if it turns a losing or even fight into a win. */
function combatTrick(s: GameState, me: PlayerId, pumps: PumpSpell[]): Action | null {
  if (!pumps.length) return null;
  for (const [aid, bids] of Object.entries(s.blocks)) {
    const attacker = findPermanent(s, aid);
    const blocker = bids.length === 1 ? findPermanent(s, bids[0]) : undefined;
    if (!attacker || !blocker) continue;
    const [mine, theirs] = attacker.controller === me ? [attacker, blocker] : [blocker, attacker];
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
      if (!safe && choice.purpose === 'cleanupDiscard') {
        // Discard what we can use least: extra lands beyond what the hand needs, then the most expensive spells.
        const lands = options.filter((c) => isLandCard(c.card));
        const spells = options.filter((c) => !isLandCard(c.card)).sort((a, b) => b.card.cmc - a.card.cmc);
        const landsOnField = s.battlefield.filter((x) => x.controller === choice.player && isLandCard(x.card)).length;
        options = landsOnField >= 5 ? [...lands, ...spells] : [...spells, ...lands];
      }
      return { kind: 'cards', iids: options.slice(0, choice.min).map((c) => c.iid) };
    }
    case 'arrange': {
      // Keep everything on top in the same order: always valid.
      const zone = choice.zones.includes('top') ? 'top' : choice.zones[0];
      return { kind: 'arrange', zones: { [zone]: choice.cards.map((c) => c.iid) } };
    }
    case 'mode':
      return { kind: 'mode', modes: Array.from({ length: choice.min }, (_, i) => i) };
    case 'yesNo':
      // Paying to keep our spell is worth it.
      return { kind: 'yesNo', yes: !safe && choice.purpose === 'payOrCounter' };
  }
}
