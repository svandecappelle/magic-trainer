import {
  actor, canAttack, canBlock, canPay, creaturesOf, findPermanent, opponent,
  type Action, type GameState, type Permanent, type PlayerId,
} from './engine';
import {
  creatureValue, hasFirstStrike, hasKeyword, isCreature, isInstantOrSorcery, isLandCard, manaColors,
  parseCost, parseEffects, power, targetKind, toughness, type Effect,
} from './rules';

/**
 * A heuristic opponent. It never looks at hidden information (your hand or library)
 * and evaluates combat one creature against one creature.
 */
export function botAction(s: GameState): Action {
  const me = actor(s);
  if (me === null) throw new Error('No one is to act');
  if (s.step === 'block') return { type: 'declareBlockers', blocks: chooseBlocks(s, me) };
  if (s.step === 'attack') return { type: 'declareAttackers', attackers: chooseAttackers(s, me) };

  const land = chooseLand(s, me);
  if (land) return { type: 'playLand', iid: land };
  return chooseSpell(s, me) ?? { type: 'pass' };
}

/** A safe fallback if the chosen action turns out to be illegal. */
export function fallbackAction(s: GameState): Action {
  if (s.step === 'block') return { type: 'declareBlockers', blocks: {} };
  if (s.step === 'attack') return { type: 'declareAttackers', attackers: [] };
  return { type: 'pass' };
}

// ---------- Combat math ----------

const strikes = (x: Permanent) => (hasKeyword(x.card, 'double strike') ? 2 : 1);

/** Would `victim` die fighting `killer` one-on-one? */
export function dies(victim: Permanent, killer: Permanent): boolean {
  if (power(killer.card) <= 0) return false;
  const victimKillsFirst =
    hasFirstStrike(victim.card) && !hasFirstStrike(killer.card) &&
    power(victim.card) > 0 &&
    (hasKeyword(victim.card, 'deathtouch') || power(victim.card) >= toughness(killer.card) - killer.damage);
  if (victimKillsFirst) return false;
  return hasKeyword(killer.card, 'deathtouch') || power(killer.card) * strikes(killer) >= toughness(victim.card) - victim.damage;
}

function chooseAttackers(s: GameState, me: PlayerId): string[] {
  const opp = opponent(me);
  const attackers = creaturesOf(s, me).filter(canAttack);
  const blockers = creaturesOf(s, opp).filter((b) => !b.tapped);

  // Alpha strike if damage still gets through when each blocker stops our biggest attackers.
  const damages = attackers.map((a) => power(a.card) * strikes(a)).sort((x, y) => y - x);
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
    .sort((a, b) => power(b.card) * strikes(b) - power(a.card) * strikes(a));
  const available = creaturesOf(s, me).filter((b) => !b.tapped);
  const used = new Set<string>();
  const blocks: Record<string, string[]> = {};
  let lifeAfter = s.players[me].life - attackers.reduce((sum, a) => sum + power(a.card) * strikes(a), 0);
  const cheapest = (list: Permanent[]) =>
    list.sort((x, y) => creatureValue(x.card) - creatureValue(y.card))[0] as Permanent | undefined;

  for (const a of attackers) {
    if (hasKeyword(a.card, 'menace')) continue; // would need two blockers; keep it simple
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
    const prevented = hasKeyword(a.card, 'trample')
      ? Math.min(power(a.card), toughness(pick.card)) * strikes(a)
      : power(a.card) * strikes(a);
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

function chooseSpell(s: GameState, me: PlayerId): Action | null {
  const opp = opponent(me);
  const spells = s.players[me].hand
    .filter((c) => !isLandCard(c.card) && canPay(s, me, c.card))
    .sort((a, b) => b.card.cmc - a.card.cmc);

  for (const { iid, card } of spells) {
    if (!isInstantOrSorcery(card)) {
      // Creatures and other permanents: before combat only if they can attack right away.
      if (s.step === 'main2' || (isCreature(card) && hasKeyword(card, 'haste'))) return { type: 'cast', iid };
      continue;
    }

    const effects = parseEffects(card);
    if (!effects.length) continue; // not simulated: casting it would do nothing
    const needs = targetKind(effects);
    if (!needs) return { type: 'cast', iid };

    const target = chooseTarget(s, me, effects);
    if (target === 'face') return { type: 'cast', iid, target: { kind: 'player', player: opp } };
    if (target) return { type: 'cast', iid, target: { kind: 'permanent', iid: target.iid } };
  }

  return null;
}

function chooseTarget(s: GameState, me: PlayerId, effects: Effect[]): Permanent | 'face' | null {
  const opp = opponent(me);
  const theirs = creaturesOf(s, opp).sort((a, b) => creatureValue(b.card) - creatureValue(a.card));
  const destroy = effects.find((e) => e.kind === 'destroy');
  if (destroy) return theirs[0] ?? null;

  const dmg = effects.find((e) => e.kind === 'damage');
  if (!dmg || dmg.kind !== 'damage') return null;
  const canGoFace = dmg.target === 'any' || dmg.target === 'player';
  if (canGoFace && dmg.amount >= s.players[opp].life) return 'face';
  if (dmg.target !== 'player') {
    const killable = theirs.find((c) => toughness(c.card) - c.damage <= dmg.amount);
    if (killable) return killable;
  }
  return canGoFace ? 'face' : null;
}

