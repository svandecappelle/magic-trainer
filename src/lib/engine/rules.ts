import { primaryType } from '../stats';
import type { Card, CardFace } from '../../types';

// ---------- Card characteristics ----------

export const KEYWORDS = [
  'flying', 'reach', 'haste', 'vigilance', 'trample', 'deathtouch', 'lifelink',
  'defender', 'first strike', 'double strike', 'menace', 'flash', 'prowess',
  'hexproof', 'shroud', 'indestructible', 'infect',
] as const;
export type Keyword = (typeof KEYWORDS)[number];

/** Front face oracle text (toCard joins faces with "\n//\n"). */
const frontText = (card: Card) => card.oracleText.split('\n//\n')[0];
export { frontText };

export function hasKeyword(card: Card, kw: Keyword): boolean {
  if (card.keywords) return card.keywords.some((k) => k.toLowerCase() === kw);
  // Fallback for cards saved without Scryfall keywords: a line made only of keywords, e.g. "Flying, vigilance".
  return frontText(card)
    .split('\n')
    .some((line) => {
      const parts = line.toLowerCase().split(/,\s*/).map((p) => p.trim());
      return parts.includes(kw) && parts.every((p) => (KEYWORDS as readonly string[]).includes(p));
    });
}

export const hasFirstStrike = (card: Card) => hasKeyword(card, 'first strike') || hasKeyword(card, 'double strike');

function parseStat(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

/** "*" and other variable values are approximated: power 0, toughness 1. */
export const power = (card: Card) => parseStat(card.power, 0);
export const toughness = (card: Card) => parseStat(card.toughness, 1);

/** Has the Creature type (front face), also a land that is one: an animated manland, Dryad Arbor. */
export const isCreature = (card: Card) => /\bCreature\b/.test(card.typeLine.split('//')[0]);
export const isLandCard = (card: Card) => primaryType(card) === 'Land';

export const isInstant = (card: Card) => card.typeLine.split('//')[0].includes('Instant');

/** Can be cast whenever its controller has priority, not only in their own main phase. */
export const hasInstantSpeed = (card: Card) => isInstant(card) || hasKeyword(card, 'flash');

export function isInstantOrSorcery(card: Card): boolean {
  const front = card.typeLine.split('//')[0];
  return front.includes('Instant') || front.includes('Sorcery');
}

/** Rough worth of a creature, used by the bot to compare trades and pick removal targets. */
export function creatureValue(card: Card): number {
  let v = power(card) + toughness(card);
  if (hasKeyword(card, 'flying')) v += 1.5;
  if (hasKeyword(card, 'deathtouch')) v += 1.5;
  if (hasKeyword(card, 'lifelink')) v += 1;
  if (hasKeyword(card, 'double strike')) v += 2;
  else if (hasKeyword(card, 'first strike')) v += 1;
  if (hasKeyword(card, 'trample')) v += 0.5;
  return v;
}

// ---------- Mana ----------

export type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
const BASIC_TYPES: [string, Color][] = [['Plains', 'W'], ['Island', 'U'], ['Swamp', 'B'], ['Mountain', 'R'], ['Forest', 'G']];

const ALL_COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];
const MANA_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * Mana in an "Add …" text, one entry per mana with the colors it may be:
 * "{C}{C}" → [[C], [C]], "{R} or {G}" → [[R, G]], "two mana of any one color" → two entries of all colors
 * (simplified: they may be different colors). Null when not understood (X mana, "for each…").
 * `identity`: the controller's commanders' color identity, for "one mana of any color in your commander's color
 * identity" (no mana without a commander or with a colorless one).
 */
export function parseManaText(text: string, identity?: Color[]): Color[][] | null {
  const t = text.trim().replace(/\.$/, '');
  if (/^one mana of any color in your commander's color identity$/i.test(t)) return identity?.length ? [identity] : null;
  const any = t.match(/^(one|two|three|four|five) mana of any (?:one )?color$/i);
  if (any) return Array.from({ length: MANA_WORDS[any[1].toLowerCase()] }, () => [...ALL_COLORS]);
  if (/^(\{[WUBRGC]\})+$/.test(t)) return [...t.matchAll(/\{([WUBRGC])\}/g)].map((m) => [m[1] as Color]);
  // "{R} or {G}", "{W}, {U}, or {B}": one mana, a choice of colors.
  if (/^\{[WUBRGC]\}(?:,? (?:or )?\{[WUBRGC]\})+$/.test(t)) return [[...t.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as Color)];
  return null;
}

/** Mox Opal: the ability word before its mana ability. */
const METALCRAFT = /^Metalcraft — /;

/**
 * The mana a permanent makes when tapped: basic land types plus "{T}: Add …" abilities. With several
 * one-mana abilities (pain lands), one mana of any of their colors; otherwise the biggest ability.
 * `identity`: the controller's commanders' color identity (Command Tower).
 * A one-mana "{T}, Pay N life: Add …" next to a free ability adds its colors too: they cost life when spent as
 * them (Starting Town, see manaPain). Mana with a spending restriction ("Spend this mana only …") is left out.
 */
export function manaUnits(card: Card, identity?: Color[]): Color[][] {
  const single = new Set<Color>();
  let best: Color[][] = [];
  const front = card.typeLine.split('//')[0];
  for (const [type, color] of BASIC_TYPES) if (front.includes(type)) single.add(color);
  const life = manaLifeCost(card) > 0;
  for (const line of frontText(card).split('\n')) {
    // Mox Opal: "Metalcraft — {T}: Add one mana of any color. Activate only if …" (see manaConditions).
    const m = line.replace(METALCRAFT, '').match(/^\{T\}(?:, Sacrifice [^:]*|, Pay (\d+) life)?:\s*Add ([^.]*)\.(.*)$/);
    if (!m || /\bSpend this mana only\b/i.test(m[3])) continue;
    if (life && !m[1]) continue;
    const units = parseManaText(m[2], identity);
    if (!units) continue;
    if (m[1] && !life && units.length > 1) continue;
    if (units.length === 1) units[0].forEach((c) => single.add(c));
    else if (units.length > best.length) best = units;
  }
  if (best.length) return best;
  return single.size ? [[...single]] : [];
}

/** A mana ability's condition: control a permanent of one of these subtypes, or this many artifacts. */
export type ManaCondition = { colors: Color[] } & ({ subtypes: string[] } | { artifacts: number });

/**
 * Sunbillow Verge: "{T}: Add {R}. Activate only if you control a Mountain or a Plains." → the colors only that
 * ability makes, and the subtypes one of which its controller must control (see unitsOf in the engine).
 * Mox Opal: "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts."
 */
export function manaConditions(card: Card): ManaCondition[] {
  const free = new Set<Color>();
  for (const [type, color] of BASIC_TYPES) if (card.typeLine.split('//')[0].includes(type)) free.add(color);
  const conditional: ManaCondition[] = [];
  for (const line of frontText(card).split('\n')) {
    const metalcraft = METALCRAFT.test(line);
    const m = line.replace(METALCRAFT, '').match(/^\{T\}:\s*Add ([^.]*)\.(.*)$/);
    const units = m && parseManaText(m[1]);
    if (!m || !units || units.length !== 1) continue;
    const only = m[2].trim().match(/^Activate only if you control (an? [A-Z][a-z]+(?: or an? [A-Z][a-z]+)*)\.$/);
    const artifacts = metalcraft && /^Activate only if you control three or more artifacts\.$/.test(m[2].trim());
    if (only) conditional.push({ colors: units[0], subtypes: only[1].split(' or ').map((w) => w.replace(/^an? /, '').toLowerCase()) });
    else if (artifacts) conditional.push({ colors: units[0], artifacts: 3 });
    else if (metalcraft) continue; // another metalcraft wording: no mana rather than mana without its condition
    else if (!m[2].trim()) units[0].forEach((c) => free.add(c));
  }
  return conditional.map((c) => ({ ...c, colors: c.colors.filter((x) => !free.has(x)) })).filter((c) => c.colors.length);
}

/** Cavern of Souls: "As this land enters, choose a creature type." */
export const choosesCreatureType = (card: Card) =>
  /^As (?:this land|this permanent|this artifact) enters, choose a creature type\.$/m.test(frontText(card));

/**
 * Cavern of Souls: "{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and
 * that spell can't be countered." → those colors (for such a spell only; it then can't be countered).
 */
export function chosenTypeMana(card: Card): Color[] | null {
  const m = frontText(card).match(/^\{T\}: Add ([^.]+)\. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered\.$/m);
  const units = m && parseManaText(m[1]);
  return units?.length === 1 ? units[0] : null;
}

/**
 * Delighted Halfling: "{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell
 * can't be countered." → its colors, or null.
 */
export function legendaryMana(card: Card): Color[] | null {
  return /^\{T\}: Add one mana of any color\. Spend this mana only to cast a legendary spell, and that spell can't be countered\.$/m.test(frontText(card))
    ? ['W', 'U', 'B', 'R', 'G'] : null;
}

export const isLegendary = (card: Card) => /\bLegendary\b/.test(card.typeLine.split('//')[0]);

/** A mana ability "{T}: Add …" (or a basic land type) without a life cost. */
const freeMana = (card: Card) =>
  /^\{T\}(?:, Sacrifice [^:]*)?:\s*Add /m.test(frontText(card)) || BASIC_TYPES.some(([type]) => card.typeLine.split('//')[0].includes(type));

/**
 * Mana Confluence: "{T}, Pay 1 life: Add one mana of any color." → 1. Only for a permanent whose sole mana ability it
 * is: with a free one too, see manaPain.
 */
export function manaLifeCost(card: Card): number {
  const m = frontText(card).match(/^\{T\}, Pay (\d+) life:\s*Add /m);
  return m && !freeMana(card) ? Number(m[1]) : 0;
}

/**
 * Starting Town: "{T}: Add {C}." and "{T}, Pay 1 life: Add one mana of any color." → the colors only the life
 * ability makes, and its life: tapping makes one mana, which costs that life when spent as one of these colors.
 */
export function manaPain(card: Card, identity?: Color[]): { life: number; colors: Color[] } | null {
  if (!freeMana(card)) return null;
  const free = new Set<Color>();
  for (const [type, color] of BASIC_TYPES) if (card.typeLine.split('//')[0].includes(type)) free.add(color);
  let pain: { life: number; colors: Color[] } | null = null;
  for (const line of frontText(card).split('\n')) {
    const m = line.match(/^\{T\}(?:, Sacrifice [^:]*|, Pay (\d+) life)?:\s*Add ([^.]*)\.(.*)$/);
    if (!m || /\bSpend this mana only\b/i.test(m[3])) continue;
    const units = parseManaText(m[2], identity);
    if (!units || units.length !== 1) continue;
    if (m[1]) pain = { life: Number(m[1]), colors: units[0] };
    else units[0].forEach((c) => free.add(c));
  }
  if (!pain) return null;
  const colors = pain.colors.filter((c) => !free.has(c));
  return colors.length ? { life: pain.life, colors } : null;
}

/** Colors a permanent can tap for. */
export const manaColors = (card: Card, identity?: Color[]): Color[] => [...new Set(manaUnits(card, identity).flat())];

export interface Cost {
  generic: number;
  /** One entry per colored symbol: the colors that can pay it (hybrid has two). */
  colored: Color[][];
}

/** Parses the front face cost. X is treated as 0, Phyrexian as its color, {2/W} as {W}. */
export function parseCost(manaCost: string): Cost {
  const cost: Cost = { generic: 0, colored: [] };
  for (const [, sym] of manaCost.split('//')[0].matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(sym)) cost.generic += Number(sym);
    else if (sym === 'X' || sym === 'Y' || sym === 'Z') continue;
    else {
      const options = sym.split('/').filter((p) => /^[WUBRGC]$/.test(p)) as Color[];
      if (options.length) cost.colored.push(options);
      else cost.generic++; // {S} snow and anything unknown
    }
  }
  return cost;
}

/**
 * Something that can pay mana: a permanent (`units`: the mana one tap makes) or mana already in the
 * pool (`iid` "pool:N", one unit). `colors` alone means one mana of those colors.
 */
export interface ManaSource {
  iid: string;
  colors: Color[];
  units?: Color[][];
  /** Spent only when nothing else can pay (convoke creatures, delve cards, mana that costs life or deals damage). */
  last?: boolean;
  /** Starting Town: spending its mana as one of these colors costs this much life (see manaPain). */
  pain?: { life: number; colors: Color[] };
}

/** One mana spent: unit `index` of source `iid`. */
export interface ManaPick {
  iid: string;
  index: number;
  /** Life paid for spending it as a color its source makes for life (Starting Town). */
  life?: number;
}

/**
 * Picks the mana to spend on a cost, or null if it can't be paid. Mana in the pool is spent first,
 * then mana of sources tapped anyway (Sol Ring's second mana), then single-color sources.
 */
export function planPayment(sources: ManaSource[], cost: Cost): ManaPick[] | null {
  const units = sources.flatMap((s) => (s.units ?? [s.colors]).map((colors, index) => ({
    iid: s.iid, index, colors, pool: s.iid.startsWith('pool:'), size: (s.units ?? [s.colors]).length, last: !!s.last, pain: s.pain,
  })));
  if (units.length < cost.generic + cost.colored.length) return null;
  // Pool first, then bigger sources (their other mana would be wasted), then the least flexible.
  units.sort((a, b) => Number(b.pool) - Number(a.pool) || Number(a.last) - Number(b.last) || b.size - a.size || a.colors.length - b.colors.length);
  const reqs = [...cost.colored].sort((a, b) => a.length - b.length);
  const used = new Set<number>();
  /** Life paid when unit `u` pays requirement `req`: only when none of its free colors can. */
  const lifeFor = (u: number, req: Color[]) => {
    const { colors, pain } = units[u];
    return pain && !colors.some((c) => req.includes(c) && !pain.colors.includes(c)) ? pain.life : 0;
  };
  // Mana that costs life is tried last for a colored requirement.
  const order = (req: Color[]) => units.map((_, u) => u).sort((a, b) => Number(lifeFor(a, req) > 0) - Number(lifeFor(b, req) > 0));
  const paidBy = new Map<number, Color[]>();

  const assign = (i: number): boolean => {
    if (i === reqs.length) return true;
    for (const u of order(reqs[i])) {
      if (used.has(u) || !units[u].colors.some((c) => reqs[i].includes(c))) continue;
      used.add(u);
      paidBy.set(u, reqs[i]);
      if (assign(i + 1)) return true;
      used.delete(u);
      paidBy.delete(u);
    }
    return false;
  };
  if (!assign(0)) return null;

  // Generic mana: the pool, then sources already being tapped, then the rest in order.
  const tapped = () => new Set([...used].map((u) => units[u].iid));
  for (let n = 0; n < cost.generic; n++) {
    const open = units.map((_, u) => u).filter((u) => !used.has(u));
    if (!open.length) return null;
    const busy = tapped();
    // Mana that only comes for life (all its colors cost life) last.
    const free = open.filter((u) => !units[u].pain || units[u].colors.some((c) => !units[u].pain!.colors.includes(c)));
    const pick = free.find((u) => units[u].pool) ?? free.find((u) => busy.has(units[u].iid)) ?? free[0] ?? open[0];
    used.add(pick);
  }
  return [...used].map((u) => {
    const req = paidBy.get(u);
    const life = req ? lifeFor(u, req) : units[u].pain && units[u].colors.every((c) => units[u].pain!.colors.includes(c)) ? units[u].pain!.life : 0;
    return { iid: units[u].iid, index: units[u].index, ...(life ? { life } : {}) };
  });
}

/** Which sources a payment uses (the permanents to tap, and pool mana), or null if it can't be paid. */
export function findPayment(sources: ManaSource[], cost: Cost): string[] | null {
  const plan = planPayment(sources, cost);
  return plan && [...new Set(plan.map((p) => p.iid))];
}

// ---------- Card types ----------

export type CardType = 'creature' | 'artifact' | 'enchantment' | 'land' | 'planeswalker' | 'instant' | 'sorcery' | 'battle';
const CARD_TYPES: CardType[] = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'instant', 'sorcery', 'battle'];

/** Card types of the front face, e.g. "Artifact Creature — Golem" → artifact, creature. */
export function cardTypes(card: Card): CardType[] {
  const front = card.typeLine.split('//')[0].split('—')[0].toLowerCase();
  return CARD_TYPES.filter((t) => front.includes(t));
}

const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/** Card colors as Color letters (colorless cards have none). */
export const cardColors = (card: Card) => card.colors as Color[];

// ---------- Targets ----------

/** Restrictions on a target, e.g. "target nonblack creature an opponent controls". All must hold. */
export interface TargetFilter {
  /** The card must have at least one of these types ("artifact or enchantment"). */
  types?: CardType[];
  /** The card must have none of these types ("nonland", "noncreature"). */
  nonTypes?: CardType[];
  /** For permanents and spells: who controls it. For players: "you" or "opponent". */
  controller?: 'you' | 'opponent';
  colors?: Color[];
  nonColors?: Color[];
  keyword?: Keyword;
  withoutKeyword?: Keyword;
  tapped?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  /** "attacking or blocking creature" */
  inCombat?: boolean;
  /** For spell targets: abilities on the stack may be chosen too (ward counters abilities). */
  abilities?: boolean;
  maxManaValue?: number;
  minManaValue?: number;
  /** "with mana cost {0} or {1}" (Urza's Saga): exactly one of these mana costs. */
  manaCosts?: string[];
  minPower?: number;
  maxPower?: number;
  /** Basic lands only ("basic land card"). */
  basic?: boolean;
  /** Lands must be nonbasic: "artifact, enchantment, or nonbasic land" (Boseiju). */
  nonbasicLands?: boolean;
  /** Legendary only (Mjölnir's "worthy": a legendary non-Villain that's red and/or white). */
  legendary?: boolean;
  /** None of these subtypes, lower case ("non-Villain"). */
  nonSubtypes?: string[];
  /** At least one of these subtypes ("Forest or Plains card"), lower case. */
  subtypes?: string[];
  /** "creature token" (true), "nontoken creature" (false). */
  token?: boolean;
}

/**
 * What a target slot accepts. "any" is a creature, planeswalker or player; "permanent" is any
 * permanent matching the filter's types; "card" is a card in a graveyard (whose owner is
 * `filter.controller`: "your graveyard" / "an opponent's graveyard").
 */
export type TargetKind = 'any' | 'creature' | 'player' | 'spell' | 'permanent' | 'card';

export interface TargetSpec {
  kind: TargetKind;
  /** "up to two target creatures": min 0, max 2. */
  min: number;
  max: number;
  filter: TargetFilter;
}

// ---------- Effects ----------

/** Counter kinds placed on permanents. */
export type CounterKind = '+1/+1' | '-1/-1' | 'loyalty' | 'lore' | 'rev' | 'luck' | 'mining' | 'age';

/**
 * Who an effect applies to: the targets chosen for a slot, the controller, everyone / each opponent,
 * or the ability's own source ("this creature gets +1/+1").
 */
/** `defending`: "defending player" in an attack trigger (Restless Fortress). */
export type Affected = { slot: number } | 'you' | 'each-opponent' | 'each-player' | 'self' | 'defending';

/** A number in rules text; "X" is the value chosen when casting. */
/** A number, X (paid when cast), or the life its controller gained this turn (Germinate Recruits). */
export type Amount = number | 'X' | 'lifeGained';

/** Which permanents an "all …" / "each …" effect touches, e.g. "creatures you don't control". */
export interface Selector {
  kind: 'creature' | 'permanent';
  filter: TargetFilter;
}

/** How a discard is chosen: by the discarding player, at random, or by the spell's controller from a revealed hand. */
export type DiscardMode = 'choose' | 'random' | 'casterChooses';

export type Effect =
  | { kind: 'damage'; amount: Amount; to: Affected }
  /** "Counter target spell unless its controller pays {N}" when `unlessPays` is set. */
  | { kind: 'counter'; to: Affected; unlessPays?: number; unlessPaysLife?: number }
  /** "gets +N/+N (and gains …) until end of turn". Negative values shrink. */
  | { kind: 'pump'; power: number; toughness: number; keywords: Keyword[]; to: Affected }
  /** `untilLeaves`: exiled until the ability's source leaves the battlefield (Seam Rip). */
  | { kind: 'destroy'; exile: boolean; to: Affected; untilLeaves?: boolean }
  | { kind: 'draw'; n: Amount; to: Affected }
  | { kind: 'gainLife'; n: Amount; to: Affected }
  | { kind: 'loseLife'; n: Amount; to: Affected }
  | { kind: 'addCounters'; counter: CounterKind; n: Amount; to: Affected }
  /** `filter` limits what the spell's controller may pick ("a nonland card") with casterChooses. */
  | { kind: 'discard'; n: Amount; to: Affected; mode: DiscardMode; filter?: TargetFilter }
  | { kind: 'mill'; n: Amount; to: Affected }
  | { kind: 'scry'; n: Amount }
  /**
   * `toHand`: Enlightened Confidant, "If you put a card with mana value less than or equal to the amount of life you
   * gained this turn into your graveyard this way, put that card into your hand."
   */
  | { kind: 'surveil'; n: Amount; toHand?: 'mvAtMostLifeGained' }
  | { kind: 'tap'; untap: boolean; to: Affected }
  /** Return to its owner's hand. */
  | { kind: 'bounce'; to: Affected }
  | { kind: 'bounceAll'; which: Selector }
  | { kind: 'destroyAll'; exile: boolean; which: Selector }
  /** Damage to each matching creature, and optionally to each player or each opponent. */
  | { kind: 'damageAll'; amount: Amount; which: Selector; players?: 'each-player' | 'each-opponent' }
  | { kind: 'pumpAll'; power: number; toughness: number; keywords: Keyword[]; which: Selector }
  /** `a` deals damage equal to its power to `b` (and back unless one-sided). `{ iid }`: a creature fixed when a reflexive
   * trigger was created (Thorin: "that creature deals damage equal to its power to up to one target creature"). */
  | { kind: 'fight'; a: { slot: number } | { iid: string }; b: { slot: number }; oneSided: boolean }
  /** Each affected player sacrifices N permanents of their choice ("edict"). */
  | { kind: 'sacrifice'; n: Amount; to: Affected; which: Selector }
  /** "Sacrifice this creature" as an effect (Ball Lightning). */
  | { kind: 'sacrificeSelf' }
  /** Create N tokens under the controller's control. */
  /** `attacking`: "tapped and attacking"; `sacrificeAtEnd`: "Sacrifice them at the beginning of the next end step". */
  | { kind: 'token'; n: Amount; token: TokenSpec; attacking?: boolean; sacrificeAtEnd?: boolean }
  /** A card in a graveyard goes to its owner's hand, or onto the battlefield under the controller's control. */
  | { kind: 'returnCard'; to: Affected; dest: 'hand' | 'battlefield' }
  /** "Put a +1/+1 counter on each creature you control" (`other`: except the source). */
  | { kind: 'addCountersAll'; counter: CounterKind; n: Amount; which: Selector; other: boolean }
  /** Mana into the controller's pool (rituals: "Add {B}{B}{B}"). One entry per mana, with its possible colors. */
  | { kind: 'addMana'; units: Color[][] }
  /** Search your library for up to `n` matching cards, then shuffle. */
  /** `searcher`: the controller of the permanent in that target slot searches instead of you (Path to Exile, Boseiju). */
  | { kind: 'search'; n: number; filter: TargetFilter; dest: 'hand' | 'battlefield'; tapped: boolean; searcher?: { slot: number } }
  /** Equip: attach the ability's source to the target. */
  | { kind: 'attach'; to: Affected }
  /** Chrome Mox: "you may exile a nonartifact, nonland card from your hand" (remembered by the source: imprint). */
  | { kind: 'exileFromHand'; filter: TargetFilter }
  /**
   * "Amass Orcs 1": if you don't control an Army, create a 0/0 black Orc Army token; then put N +1/+1 counters on an
   * Army you control.
   */
  | { kind: 'amass'; subtype: string; n: number }
  /**
   * Cumulative upkeep {1}: an age counter, then pay the cost once for each age counter on it, or sacrifice it.
   */
  | { kind: 'cumulativeUpkeep'; mana: string }
  /** Rhystic Study: "you may draw a card unless that player pays {1}" (that player: the ability's slot 0). */
  | { kind: 'drawUnlessPays'; n: number; mana: number | 'power' }
  /** Teferi, Time Raveler's +1: "Until your next turn, you may cast sorcery spells as though they had flash." */
  | { kind: 'sorceryFlash' }
  /**
   * Thorin: "attach any number of target Equipment you control to target creature you control. When one or more
   * Equipment become attached to that creature this way, that creature deals damage equal to its power to up to one
   * target creature." (`thenDamage`: the reflexive trigger's target.)
   */
  | { kind: 'attachEquipment'; what: { slot: number }; to: { slot: number }; thenDamage?: TargetSpec }
  /**
   * "Look at the top N cards of your library. You may reveal a Dwarf or Equipment card from among them and put it into
   * your hand. Put the rest on the bottom of your library in a random order." (`take` cards, `filter` to reveal.)
   */
  | { kind: 'dig'; n: number; take: number; optional: boolean; filter?: TargetFilter }
  /**
   * Until end of turn, a noncreature permanent becomes a creature: Iron Man Armor ("becomes a 0/0 Construct Hero
   * artifact creature with flying and \"…\""), crewed Vehicles and Chandra's ("becomes an artifact creature").
   * Without power and toughness, it keeps its own.
   */
  | {
    kind: 'animate'; to: Affected; power?: number; toughness?: number; subtypes: string[]; keywords: Keyword[]; text?: string;
    /** Manlands: its colors as a creature ("a 4/4 blue and black Shark creature"); colorless when none are named. */
    colors?: Color[];
    /** Mishra's Factory: "artifact creature" on a land. */
    artifact?: boolean;
    /** Mutavault: "with all creature types". */
    allTypes?: boolean;
  }
  /** Chandra's −7: "You get an emblem with \"…\"" (the emblem's ability). */
  | { kind: 'emblem'; text: string }
  /**
   * A reflexive trigger: "you may discard a card. When you do, …" (Inti), "you may pay {W}{B} and 2 life. When you
   * do, …" (Zoraline). Paid as it resolves; then `then` triggers, its targets chosen at that time.
   */
  | { kind: 'reflexive'; cost: { discard?: number; mana?: string; life?: number }; then: AbilitySpec }
  /** A modal trigger ("When … enters, choose one —"): stands for its modes (`AbilitySpec.modal`) until chosen. */
  | { kind: 'chooseModes' }
  /**
   * Chandra's +2: "You may sacrifice an artifact or discard a card. If you do, draw a card." (The draw is the next
   * effect; it's skipped when nothing was paid.)
   */
  | { kind: 'tradeForCard'; sacrifice: Selector }
  /** Urza's Saga: "This Saga gains \"…\"" — the ability's source gets this ability text while it stays. */
  | { kind: 'gainAbility'; text: string }
  | { kind: 'poison'; n: Amount; to: Affected }
  /** Add one counter of each kind already there: chosen automatically (the controller's side gains, opponents lose). */
  | { kind: 'proliferate' }
  /** Rest in Peace: "exile all graveyards"; Soul-Guide Lantern: "exile each opponent's graveyard". */
  | { kind: 'exileGraveyards'; to: Affected }
  /** Threaten effects also untap the creature and give it haste. */
  | { kind: 'gainControl'; to: Affected; untilEndOfTurn: boolean; untapHaste?: boolean }
  /** Copy a spell on the stack (same targets). */
  | { kind: 'copySpell'; to: Affected }
  /** "Create a token that's a copy of target creature". */
  | { kind: 'tokenCopy'; to: Affected }
  /** Fog: no combat damage this turn. */
  | { kind: 'preventCombat' }
  /** "Prevent the next N damage that would be dealt to any target this turn." */
  | { kind: 'preventDamage'; n: Amount; to: Affected }
  | { kind: 'extraTurn'; to: Affected };

/** A token's characteristics; the engine turns it into a card. */
export interface TokenSpec {
  name: string;
  typeLine: string;
  colors: Color[];
  power?: number;
  toughness?: number;
  keywords: Keyword[];
  oracleText: string;
}

/** Predefined tokens ("create a Treasure token"). */
export const PREDEFINED_TOKENS: Record<string, TokenSpec> = {
  treasure: { name: 'Treasure', typeLine: 'Token Artifact — Treasure', colors: [], keywords: [], oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.' },
  clue: { name: 'Clue', typeLine: 'Token Artifact — Clue', colors: [], keywords: [], oracleText: '{2}, Sacrifice this artifact: Draw a card.' },
  food: { name: 'Food', typeLine: 'Token Artifact — Food', colors: [], keywords: [], oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.' },
};

/** Is the card a token (created by the engine)? */
export const isToken = (card: Card) => card.id.startsWith('token:');

/** A token card. Tokens have no mana cost and no image. */
export function tokenCard(t: TokenSpec): Card {
  return {
    id: `token:${t.name}`, name: t.name, manaCost: '', cmc: 0, typeLine: t.typeLine, oracleText: t.oracleText, colors: t.colors,
    colorIdentity: t.colors, setCode: '', setName: '', rarity: 'token',
    ...(t.power === undefined ? {} : { power: String(t.power), toughness: String(t.toughness) }),
    keywords: t.keywords.map((k) => k.replace(/^./, (c) => c.toUpperCase())),
  };
}

/** A spell's or ability's rules: what it targets and what it does, in text order. */
export interface AbilitySpec {
  targets: TargetSpec[];
  effects: Effect[];
  /** "you may …": the controller decides on resolution whether it happens. */
  optional?: boolean;
  /** Mana Vault: "you may pay {4}. If you do, …": optional, and saying yes pays this mana. */
  mayPay?: string;
  /**
   * "if you gained life this turn" (gained: 1), "if you've gained 3 or more life", "if you gained and lost life";
   * Mana Vault: "if this artifact is tapped" (tapped).
   */
  condition?: { gained?: number; lost?: boolean; tapped?: boolean };
  /** A Saga's chapter ability: its Saga isn't sacrificed while it waits or is on the stack. */
  chapter?: number;
  /**
   * A modal trigger: its modes, chosen as it goes on the stack. A mode with no effects isn't understood and can't be
   * chosen.
   */
  modal?: { min: number; max: number; texts: string[]; specs: AbilitySpec[] };
}

/** The ability a modal trigger becomes with these modes. */
export const chosenModes = (spec: AbilitySpec, modes: number[]): AbilitySpec =>
  ({ ...combine(modes.map((i) => spec.modal!.specs[i])), ...(spec.chapter ? { chapter: spec.chapter } : {}) });

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const toNumber = (s: string) => WORD_NUMBERS[s.toLowerCase()] ?? Number(s);
const NUMBER = '(?:a|an|one|two|three|four|five|six|seven|\\d+)';
/** A number or X. */
const AMOUNT = '(?:a|an|one|two|three|four|five|six|seven|\\d+|X)';
const toAmount = (s: string): Amount => (s.toUpperCase() === 'X' ? 'X' : toNumber(s));

const NOUNS: Record<string, string> = {
  creature: 'creature', creatures: 'creature', player: 'player', players: 'player', opponent: 'opponent', opponents: 'opponent',
  permanent: 'permanent', permanents: 'permanent', artifact: 'artifact', artifacts: 'artifact', enchantment: 'enchantment',
  enchantments: 'enchantment', land: 'land', lands: 'land', planeswalker: 'planeswalker', planeswalkers: 'planeswalker',
  spell: 'spell', spells: 'spell', battle: 'battle', battles: 'battle',
};

/**
 * Parses a target phrase such as "target creature", "up to two target creatures you control",
 * "target nonblack creature", "target artifact or enchantment", "any target", "target creature spell".
 * Returns null for anything it doesn't fully understand, so unknown restrictions are never ignored.
 */
export function parseTargetPhrase(phrase: string): TargetSpec | null {
  let text = phrase.trim().toLowerCase();
  if (text === 'any target') return { kind: 'any', min: 1, max: 1, filter: {} };
  const head = text.match(new RegExp(`^(?:(up to) (${NUMBER}) |(${NUMBER}) )?targets? (.+)$`));
  if (!head) return null;
  const count = toNumber(head[2] ?? head[3] ?? '1');
  const [min, max] = head[1] ? [0, count] : [count, count];
  text = head[4];
  const filter: TargetFilter = {};

  // "target creature card from your graveyard", "target card from a graveyard"
  const grave = text.match(/^(.*?)\bcards? (with [a-z0-9 ]+ )?(?:from|in) (your|a|an opponent's) graveyard$/);
  if (grave) {
    if (grave[3] !== 'a') filter.controller = grave[3] === 'your' ? 'you' : 'opponent';
    const words = grave[1].trim();
    const kinds = words === '' ? {} : words === 'permanent' ? { nonTypes: ['instant', 'sorcery'] as CardType[] } : cardWordsFilter(words);
    if (!kinds) return null;
    Object.assign(filter, kinds);
    if (grave[2]) {
      const mv = grave[2].match(/^with mana value (\d+) or (less|greater) $/);
      if (!mv) return null;
      if (mv[2] === 'less') filter.maxManaValue = Number(mv[1]);
      else filter.minManaValue = Number(mv[1]);
    }
    return { kind: 'card', min, max, filter };
  }

  // Trailing clauses.
  const isKeyword = (w: string): w is Keyword => (KEYWORDS as readonly string[]).includes(w);
  // Each returns false when the clause isn't understood.
  const suffixes: [RegExp, (m: RegExpMatchArray) => boolean][] = [
    [/ you control$/, () => !!(filter.controller = 'you')],
    [/ (?:an opponent controls|you don't control|your opponents control)$/, () => !!(filter.controller = 'opponent')],
    [/ with mana value (\d+) or less$/, (m) => ((filter.maxManaValue = Number(m[1])), true)],
    [/ with mana value (\d+) or greater$/, (m) => ((filter.minManaValue = Number(m[1])), true)],
    // Spell Snare: "with mana value 2".
    [/ with mana value (\d+)$/, (m) => ((filter.minManaValue = filter.maxManaValue = Number(m[1])), true)],
    // Terminal Criticism: "creature or planeswalker that's blue or red".
    [/ that's ((?:white|blue|black|red|green)(?:,? or (?:white|blue|black|red|green))*)$/, (m) => {
      filter.colors = m[1].split(/,? or /).map((w) => COLOR_WORDS[w]);
      return true;
    }],
    [/ with power (\d+) or greater$/, (m) => ((filter.minPower = Number(m[1])), true)],
    [/ with power (\d+) or less$/, (m) => ((filter.maxPower = Number(m[1])), true)],
    [/ without ([a-z ]+)$/, (m) => isKeyword(m[1]) && !!(filter.withoutKeyword = m[1])],
    [/ with ([a-z ]+)$/, (m) => isKeyword(m[1]) && !!(filter.keyword = m[1])],
  ];
  for (let again = true; again; ) {
    again = false;
    for (const [re, apply] of suffixes) {
      const m = text.match(re);
      if (!m) continue;
      if (!apply(m)) return null;
      text = text.slice(0, m.index).trim();
      again = true;
    }
  }

  if (text.startsWith('attacking or blocking ')) {
    filter.inCombat = true;
    text = text.slice('attacking or blocking '.length);
  }
  // "creature or planeswalker", "artifact, enchantment, or land", "instant or sorcery spell"
  const words = text.replace(/,? or |, /g, ' | ').split(' ');
  const nouns = new Set<string>();
  const adjectiveTypes: CardType[] = [];
  for (const w of words) {
    if (w === '|' || w === '') continue;
    if (NOUNS[w]) nouns.add(NOUNS[w]);
    else if (w === 'tapped' || w === 'untapped') filter.tapped = w === 'tapped';
    else if (w === 'token' || w === 'nontoken') filter.token = w === 'token';
    else if (w === 'nonbasic' && words[words.indexOf(w) + 1] === 'land') filter.nonbasicLands = true;
    // "target Equipment you control": a permanent with that subtype.
    else if (OTHER_SUBTYPES.includes(w)) {
      (filter.subtypes ??= []).push(w);
      nouns.add('permanent');
    }
    else if (w === 'attacking') filter.attacking = true;
    else if (w === 'blocking') filter.blocking = true;
    else if (COLOR_WORDS[w]) (filter.colors ??= []).push(COLOR_WORDS[w]);
    else if (w.startsWith('non') && COLOR_WORDS[w.slice(3).replace('-', '')]) (filter.nonColors ??= []).push(COLOR_WORDS[w.slice(3).replace('-', '')]);
    else if (w.startsWith('non') && CARD_TYPES.includes(w.slice(3).replace('-', '') as CardType)) (filter.nonTypes ??= []).push(w.slice(3).replace('-', '') as CardType);
    else if (CARD_TYPES.includes(w as CardType)) adjectiveTypes.push(w as CardType); // "creature spell", "instant or sorcery spell"
    else return null;
  }
  if (!nouns.size) return null;
  // A type word in a list is a noun: "target instant or sorcery" (no "spell" word) isn't a permanent.
  if (adjectiveTypes.length && !nouns.has('spell')) {
    if (adjectiveTypes.some((t) => t === 'instant' || t === 'sorcery')) return null;
    for (const t of adjectiveTypes) nouns.add(t);
  }

  if (nouns.has('spell')) {
    // "creature spell", "instant or sorcery spell": the other words are the spell's types.
    const types = [...new Set([...[...nouns].filter((n) => n !== 'spell'), ...adjectiveTypes])];
    if (types.some((t) => !CARD_TYPES.includes(t as CardType))) return null;
    if (types.length) filter.types = types as CardType[];
    return { kind: 'spell', min, max, filter };
  }
  const players = [...nouns].filter((n) => n === 'player' || n === 'opponent');
  const permanents = [...nouns].filter((n) => n !== 'player' && n !== 'opponent');
  if (nouns.has('opponent')) filter.controller = 'opponent';
  if (!permanents.length) return { kind: 'player', min, max, filter };
  // Battles aren't simulated: "creature or battle" means creature.
  const kinds = permanents.filter((n) => n !== 'battle');
  if (players.length) {
    // "target player or planeswalker": a player, or a permanent that is a planeswalker.
    if (kinds.length === 1 && kinds[0] === 'planeswalker') return { kind: 'any', min, max, filter: { ...filter, types: ['planeswalker'] } };
    if (!kinds.length) return { kind: 'player', min, max, filter };
    return kinds.every((k) => k === 'creature' || k === 'planeswalker') ? { kind: 'any', min, max, filter } : null;
  }
  if (!kinds.length) return null;
  if (kinds.length === 1 && kinds[0] === 'creature') return { kind: 'creature', min, max, filter };
  if (!kinds.includes('permanent')) filter.types = kinds as CardType[];
  return { kind: 'permanent', min, max, filter };
}

// "target …" up to a clause boundary; parsed by parseTargetPhrase.
const TARGET = `(?:any target|(?:up to ${NUMBER} )?(?:${NUMBER} )?targets? [a-z0-9 ,'-]+?)`;
/** Where a target phrase ends when nothing specific follows it. */
const END = '(?=\\.|\\n|$|,? then |,? and )';
const KEYWORD_LIST = `((?:${KEYWORDS.join('|')})(?:(?:,? and |, )(?:${KEYWORDS.join('|')}))*)`;

/** "nonland", "noncreature, nonland", "instant or sorcery" (card words in "choose a … card"). */
function cardWordsFilter(words: string): TargetFilter | null {
  const filter: TargetFilter = {};
  for (const w of words.toLowerCase().replace(/,? or |, /g, ' ').split(' ').filter(Boolean)) {
    const type = w.replace(/^non-?/, '') as CardType;
    if (!CARD_TYPES.includes(type)) return null;
    if (w.startsWith('non')) (filter.nonTypes ??= []).push(type);
    else (filter.types ??= []).push(type);
  }
  return filter;
}

const LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest', 'desert', 'gate', 'cave', 'sphere'];
/** Artifact and enchantment subtypes searched for or counted ("an Equipment card", "an Aura or Equipment card"). */
const OTHER_SUBTYPES = ['equipment', 'aura', 'vehicle'];

/** "basic land", "Forest or Plains", "creature" (the cards a library search may find). */
/** "Dwarf or Equipment", "creature", "Aura or Equipment" (a card revealed from the top of the library). */
function revealFilter(words: string): TargetFilter | null {
  const filter: TargetFilter = {};
  for (const w of words.split(' or ')) {
    if (CARD_TYPES.includes(w as CardType)) (filter.types ??= []).push(w as CardType);
    else if (/^[A-Z][a-z]+$/.test(w)) (filter.subtypes ??= []).push(w.toLowerCase());
    else return null;
  }
  // Types and subtypes would both be required: "creature or Equipment" isn't read.
  return filter.types && filter.subtypes ? null : filter;
}

function librarySearchFilter(words: string): TargetFilter | null {
  const filter: TargetFilter = {};
  for (const w of words.toLowerCase().replace(/,? or |, /g, ' ').split(' ').filter(Boolean)) {
    if (w === 'basic') filter.basic = true;
    else if (LAND_TYPES.includes(w) || OTHER_SUBTYPES.includes(w)) (filter.subtypes ??= []).push(w);
    else if (CARD_TYPES.includes(w as CardType)) (filter.types ??= []).push(w as CardType);
    else if (w === 'card') continue;
    else return null;
  }
  return filter;
}

/** Reads "flying and trample" / "first strike, vigilance, and lifelink". */
const keywordList = (s: string | undefined) =>
  (s ?? '').split(/,? and |, /).map((k) => k.trim()).filter(Boolean) as Keyword[];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ways rules text names its own card: "Goblin Guide", "Ragavan" (legends), "this creature". */
function selfWords(name: string): string[] {
  const front = name.split(' // ')[0];
  return [front, ...front.split(',').map((w) => w.trim()), 'this creature', 'this permanent', 'this artifact', 'this enchantment', 'this land', 'this token', 'this aura', 'this equipment', 'this saga', 'this emblem'];
}

/**
 * Recognizes common effects in rules text (a spell's text, or an ability's).
 * Anything else is not simulated. `self` is the name of the card the ability is on, so
 * "Goblin Guide gets +1/+1" or "put a +1/+1 counter on this creature" can refer to it.
 */
export function parseAbilityText(text: string, self?: string): AbilitySpec {
  // Germinate Recruits: "Create X … tokens, where X is the amount of life you gained this turn."
  const lifeX = /, where X is the amount of life you gained this turn(?=\.)/;
  if (lifeX.test(text)) {
    const spec = parseAbilityText(text.replace(lifeX, ''), self);
    const fix = (a: Amount): Amount => (a === 'X' ? 'lifeGained' : a);
    return {
      ...spec,
      effects: spec.effects.map((e): Effect => (e.kind === 'damage' || e.kind === 'damageAll' ? { ...e, amount: fix(e.amount) } : 'n' in e ? ({ ...e, n: fix(e.n as Amount) } as Effect) : e)),
    };
  }
  // Threaten: "Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn."
  // Act of Treason: "Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn."
  const threaten = /Untap target (creature[a-z ]*?) and gain control of it until end of turn\. (?:That creature|It) gains haste until end of turn\./i;
  const treason = /Gain control of target (creature[a-z ]*?) until end of turn\. Untap (?:that creature|it)\. (?:That creature|It) gains haste until end of turn\./i;
  const threat = text.match(threaten) ?? text.match(treason);
  if (threat) {
    const spec = parseTargetPhrase(`target ${threat[1]}`);
    if (spec) return { targets: [spec], effects: [{ kind: 'gainControl', to: { slot: 0 }, untilEndOfTurn: true, untapHaste: true }] };
  }
  const targets: TargetSpec[] = [];
  const effects: Effect[] = [];
  /** Adds a target slot for the phrase, if understood and accepted by the effect. */
  const slotFor = (phrase: string, accept: (spec: TargetSpec) => boolean = () => true): Affected | null => {
    const spec = parseTargetPhrase(phrase);
    if (!spec || !accept(spec)) return null;
    targets.push(spec);
    return { slot: targets.length - 1 };
  };
  // Effects are matched one pattern at a time but kept in text order, so slot numbers follow the text.
  const matches: { at: number; end: number; run: () => Effect | Effect[] | null }[] = [];
  // Quoted text is an ability granted to something else ("a token with \"Whenever …\""): never an effect here.
  const quoted = [...text.matchAll(/"[^"]*"/g)].map((q) => [q.index!, q.index! + q[0].length]);
  const inQuote = (at: number) => quoted.some(([a, b]) => at > a && at < b);
  const scan = (re: RegExp, make: (m: RegExpMatchArray) => Effect | Effect[] | null) => {
    for (const m of text.matchAll(re)) {
      if (!inQuote(m.index!)) matches.push({ at: m.index!, end: m.index! + m[0].length, run: () => make(m) });
    }
  };

  /** "each player" / "target opponent" / "you" as the subject or object of an effect. */
  const who = (phrase: string | undefined): Affected | null => {
    const w = (phrase ?? 'you').toLowerCase();
    if (w === 'you') return 'you';
    if (w === 'each opponent') return 'each-opponent';
    if (w === 'each player') return 'each-player';
    if (w === 'defending player') return 'defending';
    return slotFor(w, (spec) => spec.kind === 'player');
  };
  /** "creatures you don't control" → which permanents an "all"/"each" effect touches. */
  const selector = (phrase: string): Selector | null => {
    const spec = parseTargetPhrase(`target ${phrase.replace(/^(?:all|other) /i, '')}`);
    if (!spec || (spec.kind !== 'creature' && spec.kind !== 'permanent')) return null;
    return { kind: spec.kind, filter: spec.filter };
  };
  const PLAYER = '(target player|target opponent|each player|each opponent|defending player|you)';

  scan(new RegExp(`deals (\\d+|X) damage to (each opponent|each player|you|${TARGET})${END}`, 'gi'), (m) => {
    const w = m[2].toLowerCase();
    const to = w === 'each opponent' ? 'each-opponent' : w === 'each player' ? 'each-player' : w === 'you' ? 'you' : slotFor(m[2]);
    return to && { kind: 'damage', amount: toAmount(m[1]), to };
  });
  scan(/deals (\d+|X) damage to each (creature[a-z ,'-]*?)(?: and each (player|opponent))?(?=\.)/gi, (m) => {
    const which = selector(m[2].replace(/^creature/i, 'creatures'));
    const players = m[3] ? (m[3].toLowerCase() === 'player' ? 'each-player' : 'each-opponent') : undefined;
    return which && { kind: 'damageAll', amount: toAmount(m[1]), which, ...(players ? { players } : {}) };
  });
  scan(new RegExp(`\\bcounter (${TARGET})(?:\\.|,| unless its controller pays \\{(\\d+)\\}\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'counter', to, ...(m[2] ? { unlessPays: Number(m[2]) } : {}) };
  });
  scan(new RegExp(`(${TARGET}) (?:each )?gets? ([+-]\\d+)\\/([+-]\\d+)(?: and gains? ${KEYWORD_LIST})? until end of turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'pump', power: Number(m[2]), toughness: Number(m[3]), keywords: keywordList(m[4]), to };
  });
  scan(new RegExp(`(${TARGET}) gains? ${KEYWORD_LIST} until end of turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'pump', power: 0, toughness: 0, keywords: keywordList(m[2]), to };
  });
  scan(new RegExp(`\\b((?:all |other )?creatures(?: you control| you don't control| your opponents control)?) get ([+-]\\d+)\\/([+-]\\d+)(?: and gain ${KEYWORD_LIST})? until end of turn`, 'gi'), (m) => {
    const which = selector(m[1]);
    return which && { kind: 'pumpAll', power: Number(m[2]), toughness: Number(m[3]), keywords: keywordList(m[4]), which };
  });
  scan(new RegExp(`\\b((?:all |other )?creatures(?: you control| you don't control| your opponents control)?) gain ${KEYWORD_LIST} until end of turn`, 'gi'), (m) => {
    const which = selector(m[1]);
    return which && { kind: 'pumpAll', power: 0, toughness: 0, keywords: keywordList(m[2]), which };
  });
  scan(new RegExp(`\\b(destroy|exile) (${TARGET})${END}`, 'gi'), (m) => {
    const to = slotFor(m[2], (spec) => spec.kind === 'creature' || spec.kind === 'permanent' || (spec.kind === 'card' && m[1].toLowerCase() === 'exile'));
    return to && { kind: 'destroy', exile: m[1].toLowerCase() === 'exile', to };
  });
  // Seam Rip: "exile target nonland permanent … until this enchantment leaves the battlefield".
  scan(new RegExp(`\\bexile (${TARGET}) until (?:this [a-z]+|${self ? selfWords(self).map(escapeRe).join('|') : 'this permanent'}) leaves the battlefield(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'destroy', exile: true, to, untilLeaves: true };
  });
  scan(new RegExp(`\\b(destroy|exile) (?:all|each) ([a-z0-9 ,'-]+?)${END}`, 'gi'), (m) => {
    const which = selector(m[2]);
    return which && { kind: 'destroyAll', exile: m[1].toLowerCase() === 'exile', which };
  });
  scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1) counters? on each ((?:other )?creature(?: you control| you don't control| your opponents control)?)${END}`, 'gi'), (m) => {
    const which = selector(m[3].replace(/^(other )?creature/i, (_, o) => `${o ?? ''}creatures`));
    return which && { kind: 'addCountersAll', counter: m[2] as CounterKind, n: toAmount(m[1]), which, other: /^other /i.test(m[3]) };
  });
  // Poison: "Target player gets two poison counters", "each opponent gets a poison counter".
  scan(new RegExp(`${PLAYER} gets? (${AMOUNT}) poison counters?`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'poison', n: toAmount(m[2]), to };
  });
  scan(/(?:^|[.\n] *)Proliferate\./g, () => ({ kind: 'proliferate' }));
  scan(/\b[Ee]xile all graveyards(?=\.)/g, () => ({ kind: 'exileGraveyards', to: 'each-player' }));
  scan(/\b[Ee]xile each opponent's graveyard(?=\.)/g, () => ({ kind: 'exileGraveyards', to: 'each-opponent' }));
  scan(/\b[Ee]xile (target player)'s graveyard(?=\.)/g, (m) => {
    const to = slotFor(m[1]);
    return to && { kind: 'exileGraveyards', to };
  });
  scan(new RegExp(`\\bgain control of (${TARGET})( until end of turn)?(?=\\.|,| and |$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'gainControl', to, untilEndOfTurn: !!m[2] };
  });
  scan(new RegExp(`\\bcopy (${TARGET})(?=\\.|,| and |$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'copySpell', to };
  });
  scan(new RegExp(`\\b[Cc]reate a token that's a copy of (${TARGET})(?=\\.|,| and |$)`, 'g'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'tokenCopy', to };
  });
  scan(/\bPrevent all combat damage that would be dealt this turn\./gi, () => ({ kind: 'preventCombat' }));
  scan(new RegExp(`\\bPrevent the next (\\d+|X) damage that would be dealt to (${TARGET}) this turn`, 'gi'), (m) => {
    const to = slotFor(m[2], (spec) => spec.kind === 'any' || spec.kind === 'creature' || spec.kind === 'player');
    return to && { kind: 'preventDamage', n: toAmount(m[1]), to };
  });
  scan(/(?:^|[.\n] *)Take an extra turn after this one\./g, () => ({ kind: 'extraTurn', to: 'you' }));
  scan(new RegExp(`${PLAYER} takes an extra turn after this one`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'extraTurn', to };
  });
  // Rituals: "Add {B}{B}{B}." (sentence start: mana abilities of permanents are handled as mana sources).
  scan(/(?:^|[.\n] *)Add ([^.]+)\./g, (m) => {
    const units = parseManaText(m[1]);
    return units && { kind: 'addMana', units };
  });
  // "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
  scan(new RegExp(`\\bsearch your library for (up to ${NUMBER} |an? |${NUMBER} )([a-z ,-]+?) cards?(?: with mana value (\\d+) or less| with mana cost ((?:\\{\\d+\\})(?: or \\{\\d+\\})*))?, (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?)(?:,? (?:then|and) shuffle)?`, 'gi'), (m) => {
    const count = m[1].trim().replace(/^up to /i, '');
    const filter = librarySearchFilter(m[2]);
    if (!filter) return null;
    if (m[3]) filter.maxManaValue = Number(m[3]);
    // Urza's Saga: "an artifact card with mana cost {0} or {1}".
    if (m[4]) filter.manaCosts = m[4].split(' or ');
    return { kind: 'search', n: toNumber(count), filter, dest: m[5].toLowerCase() === 'into your hand' ? 'hand' : 'battlefield', tapped: !!m[6] };
  });
  // Path to Exile: "Its controller may search their library for a basic land card, put it onto the battlefield tapped,
  // then shuffle."; Boseiju: "That player may search their library for a land card with a basic land type, …".
  // Dáin's Company: "Look at the top four cards of your library. You may reveal a Dwarf or Equipment card from among them
  // and put it into your hand. Put the rest on the bottom of your library in a random order."
  scan(/\bLook at the top (\w+) cards of your library\. You may reveal an? ([A-Za-z ]+?) card from among them and put it into your hand\. Put the rest on the bottom of your library in (?:a random|any) order\./gi, (m) => {
    const filter = revealFilter(m[2]);
    return filter && { kind: 'dig', n: toNumber(m[1]), take: 1, optional: true, filter };
  });
  // Stock Up: "Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of
  // your library in any order."
  scan(/\bLook at the top (\w+) cards of your library\. Put (one|two) of them into your hand and the rest on the bottom of your library in (?:a random|any) order\./gi, (m) => ({
    kind: 'dig', n: toNumber(m[1]), take: toNumber(m[2]), optional: false,
  }));
  // Thorin (see the attachEquipment effect).
  scan(new RegExp(THORIN_ATTACH.source, 'g'), (m) => {
    targets.push({ kind: 'permanent', min: 0, max: 20, filter: { subtypes: ['equipment'], controller: 'you' } });
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    const thenDamage = parseTargetPhrase(m[2]);
    return to && thenDamage && typeof to === 'object' ? { kind: 'attachEquipment', what: { slot: targets.length - 2 }, to, thenDamage } : null;
  });
  // Iron Man Armor: "If this Equipment isn't a creature, it becomes a 0/0 Construct Hero artifact creature with flying
  // and \"This creature gets +1/+1 for each artifact you control\" until end of turn."
  scan(new RegExp(BECOMES_CREATURE.source, 'g'), (m) => {
    const keywords = keywordList(m[4]);
    if (!keywords.every((k) => (KEYWORDS as readonly string[]).includes(k))) return null;
    const text = m[5] && `${m[5].replace(/\.$/, '')}.`;
    if (text && !understoodAbilities(text)) return null;
    return { kind: 'animate', to: 'self', power: Number(m[1]), toughness: Number(m[2]), subtypes: m[3].split(' '), keywords, ...(text ? { text } : {}) };
  });
  // Manlands: "{2}{U}{B}: Until end of turn, this land becomes a 4/4 blue and black Shark creature with deathtouch. It's
  // still a land.", Mutavault's "a 2/2 creature with all creature types until end of turn".
  scan(new RegExp(LAND_BECOMES.source, 'g'), (m) => {
    if (!m[1] === !m[8]) return null; // "until end of turn" once, before or after
    const colors = (m[4] ?? '').split(' and ').filter(Boolean).map((c) => COLOR_WORDS[c]);
    let rest = m[7] ?? '';
    const text = rest.match(/"([^"]+)"/)?.[1];
    rest = rest.replace(/"[^"]+"/, '');
    const allTypes = /\ball creature types\b/.test(rest);
    rest = rest.replace(/\ball creature types\b/, '').trim().replace(/(?:^|,? and)$/, '').trim();
    const keywords = keywordList(rest);
    if (!keywords.every((k) => (KEYWORDS as readonly string[]).includes(k))) return null;
    if (text && !understoodAbilities(text)) return null;
    return {
      kind: 'animate', to: 'self', power: Number(m[2]), toughness: Number(m[3]), subtypes: m[5] ? m[5].split(' ') : [], keywords, colors,
      ...(m[6] ? { artifact: true } : {}), ...(allTypes ? { allTypes: true } : {}), ...(text ? { text } : {}),
    };
  });
  // Chandra's −7: "You get an emblem with \"Whenever an artifact you control enters, this emblem deals 3 damage to any target.\""
  scan(/\bYou get an emblem with "([^"]+)"/g, (m) => {
    const emblem: Card = { id: 'emblem', name: 'Emblem', manaCost: '', cmc: 0, typeLine: 'Emblem', oracleText: m[1], colors: [], colorIdentity: [], setCode: '', setName: '', rarity: '', keywords: [] };
    return triggersOf(emblem).some((t) => t.ability.effects.length) ? { kind: 'emblem', text: m[1] } : null;
  });
  // Chandra's +2: "You may sacrifice an artifact or discard a card. If you do, draw a card."
  scan(new RegExp(TRADE_FOR_CARD.source, 'g'), (m) => ({
    kind: 'tradeForCard', sacrifice: { kind: m[1] === 'creature' ? 'creature' : 'permanent', filter: { types: [m[1] as CardType], controller: 'you' } },
  }));
  scan(new RegExp(CONTROLLER_SEARCH.source, 'gi'), (m) => {
    if (targets.length !== 1 || (targets[0].kind !== 'creature' && targets[0].kind !== 'permanent')) return null;
    const filter: TargetFilter = /basic land type/i.test(m[1])
      ? { types: ['land'], subtypes: ['plains', 'island', 'swamp', 'mountain', 'forest'] }
      : { basic: true, types: ['land'] };
    return { kind: 'search', n: 1, filter, dest: 'battlefield', tapped: !!m[2], searcher: { slot: 0 } };
  });
  scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1) counters? on (${TARGET})${END}`, 'gi'), (m) => {
    const to = slotFor(m[3], (spec) => spec.kind === 'creature');
    return to && { kind: 'addCounters', counter: m[2] as CounterKind, n: toAmount(m[1]), to };
  });
  // Drawing: "Draw two cards", "Target player draws X cards", "Each player draws a card".
  scan(new RegExp(`(?:^|[^a-z])draw (${AMOUNT}) cards?\\b(?! and lose)`, 'gi'), (m) => ({ kind: 'draw', n: toAmount(m[1]), to: 'you' }));
  scan(new RegExp(`${PLAYER} draws (${AMOUNT}) cards?\\b(?! and loses)`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'draw', n: toAmount(m[2]), to };
  });
  // Sign in Blood: "Target player draws two cards and loses 2 life." Phyrexian Arena: "you draw a card and lose 1 life".
  scan(new RegExp(`${PLAYER} draws? (${AMOUNT}) cards? and loses? (\\d+|X) life`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && [{ kind: 'draw', n: toAmount(m[2]), to }, { kind: 'loseLife', n: toAmount(m[3]), to }];
  });
  // Life.
  scan(new RegExp(`${PLAYER} gains? (\\d+|X) life\\b`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'gainLife', n: toAmount(m[2]), to };
  });
  scan(new RegExp(`${PLAYER} loses? (\\d+|X) life\\b`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'loseLife', n: toAmount(m[2]), to };
  });
  // Discard: "Target player discards two cards", "… discards a card at random", "Draw two cards, then discard a card".
  scan(new RegExp(`${PLAYER} discards (${AMOUNT}) cards?( at random)?`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'discard', n: toAmount(m[2]), to, mode: m[3] ? 'random' : 'choose' };
  });
  scan(new RegExp(`(?:^|[.,] *|then )discard (${AMOUNT}) cards?( at random)?`, 'gi'), (m) => ({
    kind: 'discard', n: toAmount(m[1]), to: 'you', mode: m[2] ? 'random' : 'choose',
  }));
  // Duress / Thoughtseize: "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card."
  scan(/(target player|target opponent) reveals (?:their|his or her) hand\. you choose an? ([a-z, -]+?) card from it\. that player discards that card/gi, (m) => {
    const filter = cardWordsFilter(m[2]);
    const to = filter && who(m[1]);
    return to && filter && { kind: 'discard', n: 1, to, mode: 'casterChooses', filter };
  });
  // Mill.
  scan(new RegExp(`${PLAYER} mills? (${AMOUNT}) cards?`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'mill', n: toAmount(m[2]), to };
  });
  scan(new RegExp(`(?:^|[.,] *|then )mill (${AMOUNT}) cards?`, 'gi'), (m) => ({ kind: 'mill', n: toAmount(m[1]), to: 'you' }));
  scan(/\bscry (\d+|X)\b/gi, (m) => ({ kind: 'scry', n: toAmount(m[1]) }));
  // "Then amass Orcs 1." (the type in the plural: Orcs, Zombies).
  scan(/(?:^|[.] *)(?:Then )?amass ([A-Z][a-z]+?)(?:e?s)? (\d+)(?=\.|$)/g, (m) => ({ kind: 'amass', subtype: m[1], n: Number(m[2]) }));
  scan(new RegExp(`\\bsurveil (\\d+|X)\\b(?!\\. ${SURVEIL_TO_HAND.source})`, 'gi'), (m) => ({ kind: 'surveil', n: toAmount(m[1]) }));
  scan(new RegExp(`\\bsurveil (\\d+|X)\\. ${SURVEIL_TO_HAND.source}`, 'gi'), (m) => ({ kind: 'surveil', n: toAmount(m[1]), toHand: 'mvAtMostLifeGained' }));
  // Tap / untap.
  scan(new RegExp(`(?:^|[.,] *|then |and )(tap|untap) (${TARGET})${END}`, 'gi'), (m) => {
    const to = slotFor(m[2], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'tap', untap: m[1].toLowerCase() === 'untap', to };
  });
  // Bounce.
  scan(new RegExp(`\\breturn (${TARGET}) to (?:its|their) (?:owner's|owners') hands?`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'bounce', to };
  });
  // From a graveyard: "Return target creature card from your graveyard to your hand / to the battlefield".
  scan(new RegExp(`\\breturn (${TARGET}) to (your hand|its owner's hand|the battlefield(?: under your control)?)(?=\\.|,| and |$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'card');
    return to && { kind: 'returnCard', to, dest: m[2].toLowerCase().includes('battlefield') ? 'battlefield' : 'hand' };
  });
  scan(/\breturn all ([a-z0-9 ,'-]+?) to (?:its|their) (?:owner's|owners') hands?/gi, (m) => {
    const which = selector(m[1]);
    return which && { kind: 'bounceAll', which };
  });
  // Fight and "bite".
  scan(new RegExp(`(${TARGET}) fights (${TARGET}|another target creature)${END}`, 'gi'), (m) => {
    const a = slotFor(m[1], (spec) => spec.kind === 'creature');
    const b = a && slotFor(m[2].replace(/^another /i, ''), (spec) => spec.kind === 'creature');
    return a && b && typeof a === 'object' && typeof b === 'object' ? { kind: 'fight', a, b, oneSided: false } : null;
  });
  scan(new RegExp(`(${TARGET}) deals damage equal to its power to (${TARGET}|another target creature)${END}`, 'gi'), (m) => {
    const a = slotFor(m[1], (spec) => spec.kind === 'creature');
    const b = a && slotFor(m[2].replace(/^another /i, ''), (spec) => spec.kind === 'creature' || spec.kind === 'any');
    return a && b && typeof a === 'object' && typeof b === 'object' ? { kind: 'fight', a, b, oneSided: true } : null;
  });

  // Edicts: "Each opponent sacrifices a creature", "Target player sacrifices two creatures of their choice".
  scan(new RegExp(`${PLAYER} sacrifices? (${AMOUNT}) ([a-z ,-]+?)(?: of (?:their|his or her) choice)?(?=\\.|,| and )`, 'gi'), (m) => {
    // "a creature token", "two creature tokens", "a nontoken creature".
    const nouns = m[3].replace(/s$/, '').replace(/ies$/, 'y').replace(/^creature token$/, 'token creature');
    const which = selector(nouns.endsWith('creature') || nouns.endsWith('permanent') || nouns.endsWith('artifact') || nouns.endsWith('enchantment') || nouns.endsWith('land') ? nouns : '');
    const to = which && who(m[1]);
    return to && which && { kind: 'sacrifice', n: toAmount(m[2]), to, which };
  });
  // Tokens: "create two 1/1 white Soldier creature tokens with flying", "create a Treasure token".
  scan(new RegExp(`\\b[Cc]reates? (${AMOUNT}) (\\d+)\\/(\\d+) ((?:(?:white|blue|black|red|green|colorless)(?:,? and |, | ))+)([A-Z][A-Za-z' -]*?) ((?:artifact |enchantment )?)creature tokens?(?: named ([A-Z][A-Za-z' -]*?))?(?: with ${KEYWORD_LIST}| with "([^"]+)")?(?=\\.|,| and |$)`, 'g'), (m) => {
    const colors = m[4].toLowerCase().split(/,? and |, | /).filter((w) => COLOR_WORDS[w]).map((w) => COLOR_WORDS[w]);
    const kws = keywordList(m[8]);
    const types = `Token ${m[6] ? m[6].trim().replace(/^./, (c) => c.toUpperCase()) + ' ' : ''}Creature — ${m[5]}`;
    const token: TokenSpec = {
      name: m[7] ?? m[5], typeLine: types, colors, power: Number(m[2]), toughness: Number(m[3]), keywords: kws,
      oracleText: m[9] ?? kws.map((k) => k.replace(/^./, (c) => c.toUpperCase())).join(', '),
    };
    // A token with its own ability ("with \"This token gets +1/+1 for each artifact you control.\""): only when understood.
    if (m[9] && !staticsOf(tokenCard(token)).length) return null;
    return { kind: 'token', n: toAmount(m[1]), token };
  });
  // Chandra's 0: "Create a 3/2 colorless Vehicle artifact token with crew 1."
  scan(new RegExp(`\\b[Cc]reates? (${AMOUNT}) (\\d+)\\/(\\d+) colorless Vehicle artifact tokens? with crew (\\d+)(?=\\.)`, 'g'), (m) => ({
    kind: 'token', n: toAmount(m[1]),
    token: { name: 'Vehicle', typeLine: 'Token Artifact — Vehicle', colors: [], power: Number(m[2]), toughness: Number(m[3]), keywords: [], oracleText: `Crew ${m[4]}` },
  }));
  // Chandra: "choose up to one target Vehicle you control. Until end of turn, it becomes an artifact creature and gains haste."
  scan(/\bchoose (up to one target Vehicle you control)\. Until end of turn, it becomes an artifact creature and gains haste\./g, (m) => {
    const to = slotFor(m[1]);
    return to && { kind: 'animate', to, subtypes: [], keywords: ['haste'] };
  });
  scan(new RegExp(`\\bcreates? (${AMOUNT}) (Treasure|Clue|Food) tokens?`, 'gi'), (m) => ({
    kind: 'token', n: toAmount(m[1]), token: PREDEFINED_TOKENS[m[2].toLowerCase()],
  }));

  // "Put two +1/+1 counters on target creature. It gains lifelink until end of turn." "… Untap it.": the last target.
  const lastSlot = (): Affected | null => (targets.length ? { slot: targets.length - 1 } : null);
  scan(new RegExp(`(?:^|[.] *)(?:It|That creature) gets ([+-]\\d+)\\/([+-]\\d+)(?: and gains ${KEYWORD_LIST})? until end of turn`, 'g'), (m) => {
    const to = lastSlot();
    return to && { kind: 'pump', power: Number(m[1]), toughness: Number(m[2]), keywords: keywordList(m[3]), to };
  });
  scan(new RegExp(`(?:^|[.] *)(?:It|That creature) gains ${KEYWORD_LIST} until end of turn`, 'g'), (m) => {
    const to = lastSlot();
    return to && { kind: 'pump', power: 0, toughness: 0, keywords: keywordList(m[1]), to };
  });
  scan(/(?:^|[.] *)Untap (?:it|that creature)\./g, () => {
    const to = lastSlot();
    return to && { kind: 'tap', untap: true, to };
  });

  if (self) {
    // "it" only means the source when nothing else was targeted ("Target creature gets +1/+0. It gains…").
    const words = [...selfWords(self), ...(/\btargets?\b/i.test(text) ? [] : ['it'])].map(escapeRe).join('|');
    const SELF = `(?:${words})`;
    scan(new RegExp(`(?:^|[.,] *|then |and )${SELF} gets ([+-]\\d+)\\/([+-]\\d+)(?: and gains ${KEYWORD_LIST})? until end of turn`, 'gi'), (m) => ({
      kind: 'pump', power: Number(m[1]), toughness: Number(m[2]), keywords: keywordList(m[3]), to: 'self',
    }));
    scan(new RegExp(`(?:^|[.,] *|then |and )${SELF} gains ${KEYWORD_LIST} until end of turn`, 'gi'), (m) => ({
      kind: 'pump', power: 0, toughness: 0, keywords: keywordList(m[1]), to: 'self',
    }));
    scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1|loyalty|rev) counters? on ${SELF}(?=\\.|\\n|$|,)`, 'gi'), (m) => ({
      kind: 'addCounters', counter: m[2] as CounterKind, n: toAmount(m[1]), to: 'self',
    }));
    scan(new RegExp(`(?:^|[.,] *|then )sacrifice ${SELF}(?=\\.|$)`, 'gi'), () => ({ kind: 'sacrificeSelf' }));
    scan(/(?:^|[.] *)Until your next turn, you may cast sorcery spells as though they had flash(?=\.|$)/g, () => ({ kind: 'sorceryFlash' }));
    // Chrome Mox: "Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand."
    scan(/(?:^|[.,] *)(?:you )?exile an? ([a-z, -]+?) card from your hand(?=\.|$)/gi, (m) => {
      const filter = cardWordsFilter(m[1]);
      return filter && { kind: 'exileFromHand', filter };
    });
    // Grim Monolith: "{4}: Untap this artifact."
    scan(new RegExp(`(?:^|[.,] *|then )untap ${SELF}(?=\\.|$)`, 'gi'), () => ({ kind: 'tap', untap: true, to: 'self' }));
    // Iron Man Armor: "When this Equipment enters, attach it to target creature you control."
    scan(new RegExp(`\\battach (?:it|${SELF}) to (${TARGET})${END}`, 'gi'), (m) => {
      const to = slotFor(m[1], (spec) => spec.kind === 'creature' && spec.filter.controller === 'you');
      return to && { kind: 'attach', to };
    });
  }

  // Text that is understood: the effects matched, and sentences that change nothing the engine simulates.
  const covered = new Uint8Array(text.length);
  const cover = (from: number, to: number) => covered.fill(1, from, to);
  for (const m of text.matchAll(IGNORED)) cover(m.index!, m.index! + m[0].length);
  for (const { at, end, run } of matches.sort((a, b) => a.at - b.at)) {
    const effect = run();
    if (Array.isArray(effect)) effects.push(...effect);
    else if (effect) effects.push(effect);
    if (effect) cover(at, end);
  }
  // The subject before a matched effect ("Lightning Bolt deals…", "Target creature you control gets…") is part of it,
  // unless it is a condition or another clause ("defending player loses 2 life and you gain 2 life").
  for (const { at } of matches) {
    if (!covered[at]) continue;
    let from = at;
    while (from > 0 && !/[.\n]/.test(text[from - 1])) from--;
    const subject = text.slice(from, at);
    if (subject.trim().split(/\s+/).length <= 8 && !/\b(?:if|unless|until|when|whenever|as long as|instead|for each)\b/i.test(subject) && !OTHER_CLAUSE.test(subject)) cover(from, at);
  }
  // Anything else left in the text ("then return it…", "Its controller loses 3 life") means the ability is only partly
  // understood: it is not simulated rather than simulated wrongly.
  const rest = [...text].filter((_, i) => !covered[i]).join('');
  if (/[a-z0-9{]/i.test(rest.replace(/\([^)]*\)/g, '').replace(/\b(?:then|and|or)\b/gi, ''))) return { targets: [], effects: [] };
  return { targets, effects };
}

/** Verbs of an effect: a "subject" containing one is a clause of its own, not understood. */
const OTHER_CLAUSE = /\b(?:loses?|gains?|draws?|discards?|mills?|sacrifices?|creates?|destroys?|exiles?|returns?|puts?|searche?s?|counters?|taps?|untaps?|scry|surveil)\b/i;

/** Wordings parseAbilityText handles although they contain words UNSUPPORTED refuses ("if", "that creature", "this way"). */
const THORIN_ATTACH = /\battach any number of target Equipment you control to (target creature you control)\. When one or more Equipment become attached to that creature this way, that creature deals damage equal to its power to (up to one target creature)\./;
/**
 * Quoted abilities a permanent gains ("with \"…\""): read only when understood, a static ability or triggered and
 * activated abilities with effects.
 */
function understoodAbilities(text: string): boolean {
  const card = { ...tokenCard({ name: 'x', typeLine: 'Creature', colors: [], keywords: [], oracleText: text }), name: 'This creature' };
  const abilities = [...triggersOf(card), ...activatedOf(card)];
  if (abilities.some((a) => !a.ability.effects.length)) return false;
  return staticsOf(card).length + abilities.length > 0;
}

const LAND_BECOMES = /\b(Until end of turn, )?[Tt]his land becomes an? (\d+)\/(\d+) ((?:white|blue|black|red|green)(?: and (?:white|blue|black|red|green))?)? ?((?:[A-Z][\w'-]*)(?: [A-Z][\w'-]*)*)? ?(artifact )?creature(?: with (.+?))?( until end of turn)?(?:\.|(?<=")) It's still a land\./;
const BECOMES_CREATURE = /\bIf this (?:Equipment|artifact) isn't a creature, it becomes an? (\d+)\/(\d+) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) artifact creature(?: with ([a-z ,]+?))?(?: and "([^"]+)")? until end of turn\./;
const TRADE_FOR_CARD = /\bYou may sacrifice an? (artifact|creature) or discard a card\. If you do, draw a card\./;

/** Path to Exile, Boseiju: the removed permanent's controller may search for a land (see parseAbilityText). */
const CONTROLLER_SEARCH = /\b(?:Its|That (?:land|permanent|creature)'s|That player) (?:controller )?may search (?:their|his or her) library for (a basic land card|a land card with a basic land type), put it onto the battlefield( tapped)?, then shuffle(?=\.)/;

/** Enlightened Confidant's second sentence, after "surveil 1." */
const SURVEIL_TO_HAND = /If you put a card with mana value less than or equal to the amount of life you gained this turn into your graveyard this way, put that card into your hand\./;

/**
 * Sentences an ability can contain without being "partly understood": they change nothing the engine
 * simulates (no regeneration, no prevention of these effects…).
 */
const IGNORED = new RegExp([
  /(?:It|They|That creature) can't be regenerated\./,
  /You may choose new targets for the copy\./,
  /If that spell is countered this way, exile it instead of putting it into its owner's graveyard\./,
  // Small upsides for the opponent of a removal spell, not simulated (listed in TODO.md): Swords to Plowshares' life,
  // Get Lost's Map tokens.
  /Its controller gains life equal to its power\./,
  /Its controller creates two Map tokens\./,
  // Loyalty for a Jace you control (Countersculpt, Fatehold Charm): not simulated, listed in TODO.md.
  /Empower Jace \d+\./,
  /This spell can't be countered\./,
  /Damage can't be prevented this turn\./,
  /If (?:that creature|a permanent dealt damage by [^.]+|it) would die this turn, exile it instead\./,
].map((r) => r.source).join('|'), 'gi');

/** The rules of an instant or sorcery cast the usual way (front face, no modes, not kicked). */
export const spellSpec = (card: Card): AbilitySpec => castSpec(card, {});

// ---------- Faces and ways to cast ----------

/** Faces of a card, front first. Cards saved without faces are rebuilt from the joined name/type/text. */
export function cardFaces(card: Card): CardFace[] {
  if (card.faces?.length) return card.faces;
  const names = card.name.split(' // ');
  const front: CardFace = {
    name: names[0], manaCost: card.manaCost.split(' // ')[0], typeLine: card.typeLine.split(' // ')[0], oracleText: frontText(card),
    power: card.power, toughness: card.toughness, loyalty: card.loyalty, imageSmall: card.imageSmall, imageNormal: card.imageNormal,
  };
  if (names.length < 2) return [front];
  const types = card.typeLine.split(' // ');
  const texts = card.oracleText.split('\n//\n');
  const costs = card.manaCost.split(' // ');
  return [front, ...names.slice(1).map((name, i) => ({
    name, manaCost: costs[i + 1] ?? '', typeLine: types[i + 1] ?? '', oracleText: texts[i + 1] ?? '',
    imageSmall: card.imageSmall, imageNormal: card.imageNormal,
  }))];
}

const manaValue = (cost: string) => {
  const c = parseCost(cost);
  return c.generic + c.colored.length;
};

/** The name of one face ("Bonecrusher Giant", not "Bonecrusher Giant // Stomp"). */
export const faceName = (card: Card, face = 0) => cardFaces(card)[face]?.name ?? card.name;

/** A face as a card of its own (face 0 is the card itself). */
export function faceCard(card: Card, face: number): Card {
  if (!face) return card;
  const f = cardFaces(card)[face];
  if (!f) return card;
  return {
    ...card, id: `${card.id}#${face}`, name: f.name, manaCost: f.manaCost, cmc: manaValue(f.manaCost), typeLine: f.typeLine,
    oracleText: f.oracleText, colors: f.colors ?? card.colors, power: f.power, toughness: f.toughness, loyalty: f.loyalty,
    imageSmall: f.imageSmall ?? card.imageSmall, imageNormal: f.imageNormal ?? card.imageNormal,
    keywords: undefined, faces: undefined, layout: undefined,
  };
}

/** "Bonecrusher Giant // Stomp": face 1 is an Adventure (an instant or sorcery cast from hand, then the creature from exile). */
export const isAdventure = (card: Card) => card.layout === 'adventure' || /\bAdventure\b/.test(cardFaces(card)[1]?.typeLine ?? '');
/** Modal double-faced card: either face can be played (from hand). */
export const isModalDfc = (card: Card) => card.layout === 'modal_dfc';
/** Split card ("Fire // Ice"): either half can be cast. */
export const isSplit = (card: Card) => card.layout === 'split' || (card.layout === undefined && cardFaces(card).length === 2 &&
  cardFaces(card).every((f) => /\b(Instant|Sorcery)\b/.test(f.typeLine)) && !isAdventure(card));
/** Transforming double-faced card (the back face only comes from transforming). */
export const isTransform = (card: Card) => card.layout === 'transform';

/** Which faces can be cast or played from hand. */
export function playableFaces(card: Card): number[] {
  if (isModalDfc(card) || isAdventure(card) || isSplit(card)) return cardFaces(card).map((_, i) => i);
  return [0];
}

/** An extra cost paid when casting: "As an additional cost to cast this spell, …". */
export type AdditionalCost =
  | { kind: 'sacrifice'; which: Selector }
  | { kind: 'discard'; n: number }
  | { kind: 'life'; n: number }
  /** Abhorrent Oculus: "exile six cards from your graveyard". */
  | { kind: 'exileGraveyard'; n: number }
  /** Mana added to the cost ("behold a Jace or pay {1}": paying is always possible). */
  | { kind: 'mana'; cost: string }
  /** Bitter Triumph: "discard a card or pay 3 life", the caster's choice. */
  | { kind: 'either'; options: [AdditionalCost, AdditionalCost] };

/** One additional cost ("discard a card", "pay 3 life", "sacrifice a creature"…), or null if not understood. */
function parseAdditionalCost(what: string): AdditionalCost | null {
  let m;
  if ((m = what.match(/^discard (a|two|three) cards?$/))) return { kind: 'discard', n: toNumber(m[1]) };
  if ((m = what.match(/^pay (\d+) life$/))) return { kind: 'life', n: Number(m[1]) };
  if ((m = what.match(/^pay ((?:\{\d+\})+)$/))) return { kind: 'mana', cost: m[1] };
  if ((m = what.match(new RegExp(`^exile (${NUMBER}) cards? from your graveyard$`)))) return { kind: 'exileGraveyard', n: toNumber(m[1]) };
  if ((m = what.match(/^sacrifice (?:a|an) ([a-z ]+)$/))) {
    const spec = parseTargetPhrase(`target ${m[1]}`);
    if (spec && (spec.kind === 'creature' || spec.kind === 'permanent')) return { kind: 'sacrifice', which: { kind: spec.kind, filter: spec.filter } };
  }
  return null;
}

/** What a card's text says about the ways to cast it. */
export interface CastInfo {
  /** "Choose one —" / "Choose one or both —": the modes' texts, and how many to choose. */
  modal?: { min: number; max: number; modes: string[] };
  kicker?: string;
  additional?: AdditionalCost;
  /** The additional-cost sentence exists but isn't understood: the spell is not simulated. */
  unknownCost?: boolean;
  flashback?: string;
  /** Cycling (draw a card) or landcycling (search for a land card: `search`). */
  cycling?: { cost: string; search?: TargetFilter };
  /**
   * "Channel — {3}{U}, Discard this card: …", activated from the hand at instant speed (no effects: not simulated);
   * `keyword` is false for the same ability without the word (Mjölnir's "{2}{R}, Discard this card: …").
   * `legendaryDiscount`: "This ability costs {1} less to activate for each legendary creature you control."
   */
  channel?: { cost: string; ability: AbilitySpec; legendaryDiscount: boolean; keyword: boolean };
  convoke: boolean;
  delve: boolean;
  /** "Affinity for artifacts": costs {1} less for each matching permanent you control. */
  affinity?: TargetFilter;
}

const MODE_COUNTS: Record<string, [number, number]> = {
  one: [1, 1], two: [2, 2], three: [3, 3], 'one or both': [1, 2], 'one or more': [1, 9], 'up to one': [0, 1], 'up to two': [0, 2],
};

/** Removes reminder text: it never carries rules, and may say "Draw a card." (cycling). */
const stripReminder = (text: string) => text.replace(/\s*\([^)]*\)/g, '');

export function castInfo(card: Card, face = 0): CastInfo {
  const c = faceCard(card, face);
  const text = stripReminder(frontText(c));
  const info: CastInfo = { convoke: false, delve: false };
  const kw = (c.keywords ?? []).map((k) => k.toLowerCase());
  for (const line of text.split('\n').map((l) => l.trim())) {
    let m;
    if ((m = line.match(/^Kicker ((?:\{[^}]+\})+)$/))) info.kicker = m[1];
    else if ((m = line.match(/^Flashback ((?:\{[^}]+\})+)$/))) info.flashback = m[1];
    else if ((m = line.match(/^Cycling ((?:\{[^}]+\})+)$/))) info.cycling = { cost: m[1] };
    else if ((m = line.match(/^(Basic land|Plains|Island|Swamp|Mountain|Forest)cycling ((?:\{[^}]+\})+)$/))) {
      info.cycling = { cost: m[2], search: m[1] === 'Basic land' ? { basic: true, types: ['land'] } : { subtypes: [m[1].toLowerCase()] } };
    } else if ((m = line.match(/^(?:Channel — )?((?:\{[^}]+\})+), Discard this card: (.+)$/))) {
      // Also Mjölnir's "{2}{R}, Discard this card: It deals 2 damage to each creature." (from the hand, like channel).
      const discount = / This ability costs \{1\} less to activate for each legendary creature you control\.$/;
      const body = m[2].replace(discount, '');
      info.channel = { cost: m[1], ability: UNSUPPORTED.test(body.replace(CONTROLLER_SEARCH, '')) ? NO_EFFECT : parseAbilityText(body, selfName(c)), legendaryDiscount: discount.test(m[2]), keyword: line.startsWith('Channel') };
    } else if (/^Affinity for artifacts$/i.test(line)) info.affinity = { types: ['artifact'] };
    else if (/^[A-Za-z ,]+$/.test(line) && line.split(/,\s*/).some((w) => /^(convoke|delve)$/i.test(w.trim()))) {
      for (const w of line.split(/,\s*/).map((x) => x.trim().toLowerCase())) {
        if (w === 'convoke') info.convoke = true;
        if (w === 'delve') info.delve = true;
      }
    }
  }
  if (kw.includes('convoke')) info.convoke = true;
  if (kw.includes('delve')) info.delve = true;
  const modal = text.match(/Choose (one or both|one or more|up to one|up to two|one|two|three) —\n((?:• [^\n]+\n?)+)/);
  if (modal) {
    const [min, max] = MODE_COUNTS[modal[1]];
    const modes = modal[2].split('\n').filter((l) => l.startsWith('• ')).map((l) => l.slice(2).trim());
    info.modal = { min, max: Math.min(max, modes.length), modes };
  }
  const extra = text.match(/As an additional cost to cast this spell, ([^.]+)\./);
  // "you may blight 1", "you may collect evidence 6": an optional cost, never paid here (its bonus is left out too).
  if (extra && !/^you may /i.test(extra[1])) {
    const what = extra[1].toLowerCase();
    const whole = parseAdditionalCost(what);
    // "A or B": both understood → the caster chooses; one understood → paying that one is always allowed.
    const split = what.match(/^(.+?) or (.+)$/);
    const a = split && parseAdditionalCost(split[1]);
    const b = split && parseAdditionalCost(split[2]);
    const cost = whole ?? (a && b ? { kind: 'either' as const, options: [a, b] as [AdditionalCost, AdditionalCost] } : (a ?? b));
    if (cost) info.additional = cost;
    else info.unknownCost = true;
  }
  return info;
}

/** Is mode `i` of a modal spell simulated (understood on its own)? */
export function modeSimulated(card: Card, face: number, i: number): boolean {
  const modal = castInfo(card, face).modal;
  return !!modal && parseAbilityText(modal.modes[i] ?? '').effects.length > 0;
}

/** The allowed mode combinations of a modal spell, the most modes first ("one or both": both, then each). */
export function modeSets(modal: { min: number; max: number; modes: string[] }): number[][] {
  const n = modal.modes.length;
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const set = Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i));
    if (set.length >= Math.max(1, modal.min) && set.length <= modal.max) out.push(set);
  }
  return out.sort((a, b) => b.length - a.length || a[0] - b[0]);
}

/** Moves slot numbers in effects by `offset`, to put several parsed texts together. */
function shiftSlots(effects: Effect[], offset: number): Effect[] {
  const shift = (a: Affected): Affected => (typeof a === 'object' ? { slot: a.slot + offset } : a);
  return effects.map((e) => {
    if (e.kind === 'fight') return { ...e, a: 'iid' in e.a ? e.a : { slot: e.a.slot + offset }, b: { slot: e.b.slot + offset } };
    if ('to' in e) return { ...e, to: shift(e.to) } as Effect;
    return e;
  });
}

function combine(specs: AbilitySpec[]): AbilitySpec {
  const out: AbilitySpec = { targets: [], effects: [] };
  for (const sp of specs) {
    out.effects.push(...shiftSlots(sp.effects, out.targets.length));
    out.targets.push(...sp.targets);
  }
  return out;
}

/** How a card is cast: which face, which modes, kicked or not. */
export interface CastChoice {
  face?: number;
  modes?: number[];
  kicked?: boolean;
}

/**
 * The rules of a spell cast a given way. Auras target what they'll enchant; other permanents have no
 * spell effects. Modal spells need their modes; "If this spell was kicked, …" applies when kicked.
 */
export function castSpec(card: Card, choice: CastChoice): AbilitySpec {
  const c = faceCard(card, choice.face ?? 0);
  const aura = auraTarget(c);
  if (aura) return { targets: [aura], effects: [] };
  if (!isInstantOrSorcery(c)) return { targets: [], effects: [] };
  const info = castInfo(card, choice.face ?? 0);
  if (info.unknownCost) return { targets: [], effects: [] };
  let text = stripReminder(frontText(c))
    .split('\n')
    // Other ways to cast it that are never used here (Harmonize, Web-slinging, Paradigm), and options never taken
    // (a gift never promised, a spell never bargained).
    .filter((l) => !/^(Kicker|Flashback|Cycling|Convoke|Delve|Affinity for|(Basic land|Plains|Island|Swamp|Mountain|Forest)cycling|Harmonize|Web-slinging|Paradigm|Bargain$|Gift an? )\b/.test(l.trim()))
    .join('\n')
    .replace(/As an additional cost to cast this spell, [^.]+\.\s*/, '')
    .replace(/If (?:the gift was promised|this spell was bargained|this spell's additional cost was paid|evidence was collected), [^.]+\.\s*/g, '');
  const kickedTexts: string[] = [];
  text = text.replace(/If this spell was kicked, ([^.]+\.)\s*/g, (_, rest: string) => {
    kickedTexts.push(rest);
    return '';
  });
  let spec: AbilitySpec;
  if (info.modal) {
    const modes = choice.modes ?? [];
    if (modes.length < Math.max(1, info.modal.min) || modes.length > info.modal.max) return { targets: [], effects: [] };
    const head = text.slice(0, text.indexOf('Choose ')).trim();
    const parsed = modes.map((i) => parseAbilityText(info.modal!.modes[i] ?? ''));
    // A mode that isn't understood makes the whole spell "not simulated" rather than half-simulated.
    if (parsed.some((p) => !p.effects.length)) return { targets: [], effects: [] };
    spec = combine([head ? parseAbilityText(head) : { targets: [], effects: [] }, ...parsed]);
  } else {
    spec = parseAbilityText(text);
  }
  if (choice.kicked) {
    for (const k of kickedTexts) {
      // "it deals 4 damage instead": the spell's damage changes.
      const instead = k.match(/deals (\d+) damage(?: to [a-z ]+)? instead\.$/i);
      const dmg = spec.effects.find((e) => e.kind === 'damage');
      if (instead && dmg?.kind === 'damage') dmg.amount = Number(instead[1]);
      else if (!/\binstead\b/i.test(k)) spec = combine([spec, parseAbilityText(k)]);
    }
  }
  return spec;
}

/** Just the effects of an instant or sorcery. */
export const parseEffects = (card: Card): Effect[] => spellSpec(card).effects;

// ---------- Triggered abilities ----------

export type ObjectEvent = 'enters' | 'dies' | 'attacks' | 'combatDamage';
export type StepEvent = 'upkeep' | 'draw' | 'endStep' | 'beginCombat';

/** What makes a triggered ability trigger. */
export type TriggerEvent =
  /** This permanent enters / dies / attacks / deals combat damage to a player. */
  | { on: ObjectEvent; self: true }
  /** A matching permanent does ("Whenever another creature you control enters", landfall). */
  | { on: ObjectEvent; self: false; which: Selector; another: boolean }
  /** At the beginning of an upkeep or end step: yours, each one, or each opponent's. */
  | { on: StepEvent; whose: 'you' | 'each' | 'opponent' }
  /** A Saga's chapter: lore counters reach `n` ("I — …", "II, III — …"). */
  | { on: 'chapter'; n: number }
  /** Whenever you cast a spell matching the card words ("noncreature", "instant or sorcery"). */
  | { on: 'cast'; filter: TargetFilter }
  /** Whenever you gain life. */
  | { on: 'gainLife' }
  /** "Whenever you attack": once when its controller declares one or more attackers. */
  | { on: 'youAttack' }
  /** Vexing Bauble: "Whenever a player casts a spell, if no mana was spent to cast it, …" (the ability's slot 0 is that spell). */
  | { on: 'castWithoutMana' }
  /** City of Brass: "Whenever this land becomes tapped, …" (not when it enters tapped). */
  | { on: 'becomesTapped' }
  /**
   * Each card an opponent draws (Orcish Bowmasters: `notFirstInDrawStep`, "except the first one they draw in each of
   * their draw steps"); Faerie Mastermind: only their `nth` (second) card each turn.
   */
  | { on: 'opponentDraws'; nth?: number; notFirstInDrawStep?: boolean }
  /** City of Traitors: "When you play another land, …" */
  | { on: 'youPlayLand' }
  /** Sowing Mycospawn: "When you cast this spell, …" (`kicked`: "if it was kicked"). */
  | { on: 'castSelf'; kicked?: boolean }
  /** Rhystic Study: "Whenever an opponent casts a spell, …" (the ability's slot 0 is that player); Esper Sentinel: only their first noncreature spell each turn. */
  | { on: 'opponentCasts'; filter: TargetFilter; firstNoncreature?: boolean };

export interface TriggerSpec {
  event: TriggerEvent;
  /** "This ability triggers only once each turn." */
  oncePerTurn?: boolean;
  /** "Whenever one or more creatures die": once for creatures dying at the same time. */
  batch?: boolean;
  /** What it does. No effects means the ability is recognized as a trigger but not simulated. */
  ability: AbilitySpec;
}

/**
 * Words that change what an ability does in ways the parser can't follow (conditions,
 * replacements, references to the triggering object). Such abilities are not simulated rather
 * than simulated wrongly.
 */
const UNSUPPORTED_WORDS = /\b(?:if|unless|for each|where|instead|that (?:creature|card|player|land|spell|permanent)|those|otherwise|this way|exiled with)\b/i;
/** Wordings the effect parser would misread. Quoted text is an ability given to something else (a token), read on its own. */
const UNSUPPORTED = {
  test: (text: string) => {
    let rest = text;
    for (const handled of [CONTROLLER_SEARCH, SURVEIL_TO_HAND, THORIN_ATTACH, BECOMES_CREATURE, LAND_BECOMES, TRADE_FOR_CARD]) rest = rest.replace(handled, '');
    return UNSUPPORTED_WORDS.test(rest.replace(/"[^"]*"/g, '""'));
  },
};

const NO_EFFECT: AbilitySpec = { targets: [], effects: [] };

/** "a creature you control", "another nontoken creature", "a land" → which permanents a trigger watches. */
function triggerSubject(subject: string, underYourControl: boolean): { which: Selector; another: boolean } | null {
  // Kíli: "another Dwarf or Equipment you control": any permanent of these subtypes.
  const kinds = subject.match(/^(a|an|another) ((?:[A-Z][a-z]+)(?: or [A-Z][a-z]+)+)( you control)?$/);
  if (kinds) {
    const filter: TargetFilter = { subtypes: kinds[2].toLowerCase().split(' or ') };
    if (kinds[3] || underYourControl) filter.controller = 'you';
    return { which: { kind: 'permanent', filter }, another: kinds[1] === 'another' };
  }
  const m = subject.toLowerCase().match(/^(a|an|another) (.+)$/);
  if (!m) return null;
  const spec = parseTargetPhrase(`target ${m[2]}`);
  if (!spec || (spec.kind !== 'creature' && spec.kind !== 'permanent')) return null;
  if (underYourControl) {
    if (spec.filter.controller === 'opponent') return null;
    spec.filter.controller = 'you';
  }
  return { which: { kind: spec.kind, filter: spec.filter }, another: m[1] === 'another' };
}

/** The effect text of a trigger: "you may" makes it optional; unsupported wordings give no effects. */
function triggerAbility(text: string, name: string, self: boolean): AbilitySpec {
  // "you may discard a card. When you do, …", "you may pay {W}{B} and 2 life. When you do, …"
  const reflexive = text.match(/^you may (?:(discard a card)|pay ((?:\{(?:\d+|[WUBRGC])\})+)(?: and (\d+) life)?)\. When you do, (.+)$/i);
  if (reflexive) {
    const inner = reflexive[4];
    // "It" in the reflexive part is its own target ("put a +1/+1 counter on target attacking creature. It gains trample").
    const then = UNSUPPORTED.test(inner) ? NO_EFFECT : parseAbilityText(inner, self ? name : undefined);
    if (!then.effects.length) return NO_EFFECT;
    const cost = reflexive[1] ? { discard: 1 } : { mana: reflexive[2], ...(reflexive[3] ? { life: Number(reflexive[3]) } : {}) };
    return { targets: [], effects: [{ kind: 'reflexive', cost, then }] };
  }
  // Mana Vault: "you may pay {4}. If you do, untap this artifact."
  const mayPay = text.match(/^you may pay ((?:\{(?:\d+|[WUBRGC])\})+)\. If you do, (.+)$/i);
  if (mayPay) {
    const then = triggerBody(mayPay[2], name, self);
    return then.effects.length && !then.optional ? { ...then, optional: true, mayPay: mayPay[1] } : NO_EFFECT;
  }
  // Mana Vault: "if this artifact is tapped, it deals 1 damage to you." (checked as it triggers and resolves)
  const ifTapped = self && text.match(new RegExp(`^if (?:${selfWords(name).map(escapeRe).join('|')}) is tapped, (.+)$`, 'i'));
  if (ifTapped) {
    const then = triggerBody(ifTapped[1], name, self);
    return then.effects.length ? { ...then, condition: { ...then.condition, tapped: true } } : NO_EFFECT;
  }
  // "choose one — • … • …", "choose up to one —", "choose one or both —".
  const modal = text.match(/^choose (one|up to one|one or both|one or more|two) — (• .+)$/i);
  if (modal) {
    const texts = modal[2].split(/ ?• /).filter(Boolean).map((m) => m.trim());
    const specs = texts.map((m) => triggerBody(m, name, self));
    if (!specs.some((sp) => sp.effects.length)) return NO_EFFECT;
    const [min, max] = ({ one: [1, 1], 'up to one': [0, 1], 'one or both': [1, 2], 'one or more': [1, texts.length], two: [2, 2] } as Record<string, number[]>)[modal[1].toLowerCase()];
    return { targets: [], effects: [{ kind: 'chooseModes' }], modal: { min, max, texts, specs } };
  }
  // Life this turn: "if you gained life this turn, …", "… if you've gained 3 or more life this turn."
  let condition: AbilitySpec['condition'];
  const lead = text.match(/^if you gained (and lost )?life this turn, (.+)$/i);
  const tail = text.match(/^(.+?) if you've gained (\w+) or more life this turn\.$/i);
  if (lead) {
    condition = { gained: 1, ...(lead[1] ? { lost: true } : {}) };
    text = lead[2];
  } else if (tail) {
    condition = { gained: toNumber(tail[2]) };
    text = `${tail[1]}.`;
  }
  const spec = triggerBody(text, name, self);
  return condition && spec.effects.length ? { ...spec, condition } : spec;
}

function triggerBody(text: string, name: string, self: boolean): AbilitySpec {
  const optional = /^you may /i.test(text);
  // "you may gain 1 life" → "you gain 1 life"
  const body = optional ? `you ${text.slice('you may '.length)}` : text;
  // "it" in "Whenever a creature you control attacks, it gets +1/+0" is the attacker, not this card.
  // Clauses the parser handles although they contain words it otherwise refuses ("if", "this way", "that card").
  const checked = body.replace(SURVEIL_TO_HAND, '');
  if (UNSUPPORTED.test(checked) || (!self && /\bits?\b/i.test(checked))) return NO_EFFECT;
  const spec = parseAbilityText(body, self ? name : undefined);
  // Chrome Mox: choosing no card is the "may".
  const choosesNone = spec.effects.length === 1 && spec.effects[0].kind === 'exileFromHand';
  return optional && spec.effects.length && !choosesNone ? { ...spec, optional } : spec;
}

/**
 * The name an ability uses for its own card. Legends are often called by their first name ("put a loyalty counter
 * on Ajani" on Ajani Resolute): "Ajani Resolute, Ajani" makes both forms self-references (see selfWords).
 */
function selfName(card: Card): string {
  const front = card.name.split(' // ')[0];
  return /\bLegendary\b/.test(card.typeLine) && !front.includes(',') && front.includes(' ') ? `${front}, ${front.split(' ')[0]}` : front;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

/** "II, III — Effect." → chapters [2, 3] and the effect text. */
function sagaChapter(line: string): { ns: number[]; text: string } | null {
  const m = line.match(/^((?:I|II|III|IV|V|VI|VII)(?:, (?:I|II|III|IV|V|VI|VII))*) — (.+)$/);
  return m ? { ns: m[1].split(', ').map((r) => ROMAN[r]), text: m[2].trim() } : null;
}

/** A Saga (CR 714): an enchantment with chapter abilities (Urza's Saga is also a land). */
export const isSaga = (card: Card) => /\bSaga\b/.test(card.typeLine.split('//')[0].split('—')[1] ?? '');

/** The Saga's last chapter: it's sacrificed once it has that many lore counters (and that chapter has resolved). */
export function finalChapter(card: Card): number {
  return Math.max(0, ...frontText(card).split('\n').flatMap((l) => sagaChapter(l)?.ns ?? []));
}

/**
 * A chapter's effect. "This Saga gains \"{T}: Add {C}.\"" (Urza's Saga) gives the Saga that ability for as long as it
 * stays, when the engine understands it; inner quotes ('…') become the granted ability's own quotes.
 */
function chapterAbility(text: string, name: string): AbilitySpec {
  const gains = text.match(/^(?:This Saga|This permanent) gains "(.+)"$/);
  if (gains) {
    const granted = gains[1].replace(/ with '([^']+)'/g, ' with "$1"');
    const test: Card = { id: 'granted', name, manaCost: '', cmc: 0, typeLine: 'Enchantment', oracleText: granted, colors: [], colorIdentity: [], setCode: '', setName: '', rarity: '', keywords: [] };
    const understood = manaUnits({ ...test, typeLine: 'Land' }).length > 0 || activatedOf(test).some((a) => a.ability.effects.length);
    return understood ? { targets: [], effects: [{ kind: 'gainAbility', text: granted }] } : NO_EFFECT;
  }
  return triggerAbility(text, name, true);
}

const triggerCache = new Map<string, TriggerSpec[]>();

/** Triggered abilities printed on a permanent card (front face), plus prowess. */
export function triggersOf(card: Card): TriggerSpec[] {
  const key = `${card.name}\n${card.oracleText}`;
  const cached = triggerCache.get(key);
  if (cached) return cached;
  const out: TriggerSpec[] = [];
  const name = selfName(card);
  // A trigger's subject may also be a legend's first name ("When Loran enters").
  const selves = [...selfWords(name), name.split(' ')[0]].map((w) => w.toLowerCase());

  if (hasKeyword(card, 'prowess')) {
    out.push({
      event: { on: 'cast', filter: { nonTypes: ['creature'] } },
      ability: { targets: [], effects: [{ kind: 'pump', power: 1, toughness: 1, keywords: [], to: 'self' }] },
    });
  }

  // A modal trigger's modes are on the next lines: "When … enters, choose one —\n• …\n• …" is read as one line.
  for (const raw of frontText(card).replace(/ —((?:\n• [^\n]*)+)/g, (_, modes: string) => ` —${modes.replace(/\n/g, ' ')}`).split('\n')) {
    // A Saga's chapters: "I — …", "II, III — …".
    const chapter = sagaChapter(raw);
    if (chapter) {
      const ability = chapterAbility(chapter.text, name);
      for (const n of chapter.ns) out.push({ event: { on: 'chapter', n }, ability: ability.effects.length ? { ...ability, chapter: n } : ability });
      continue;
    }
    // Drop reminder text and ability words ("Landfall — Whenever…").
    const line = raw.replace(/\s*\([^)]*\)/g, '').replace(/^[A-Z][A-Za-z' ]+ — /, '').trim();

    // Cumulative upkeep {1}: "At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it
    // unless you pay its upkeep cost for each age counter on it."
    const cumulative = line.match(/^Cumulative upkeep ((?:\{(?:\d+|[WUBRGC])\})+)$/i);
    if (cumulative) {
      out.push({ event: { on: 'upkeep', whose: 'you' }, ability: { targets: [], effects: [{ kind: 'cumulativeUpkeep', mana: cumulative[1] }] } });
      continue;
    }
    // Mobilize N: "Whenever this creature attacks, create N tapped and attacking 1/1 red Warrior creature tokens.
    // Sacrifice them at the beginning of the next end step."
    const mobilize = line.match(/^Mobilize (\d+)$/i);
    if (mobilize) {
      const warrior: TokenSpec = { name: 'Warrior', typeLine: 'Token Creature — Warrior', colors: ['R'], power: 1, toughness: 1, keywords: [], oracleText: '' };
      out.push({
        event: { on: 'attacks', self: true },
        ability: { targets: [], effects: [{ kind: 'token', n: Number(mobilize[1]), token: warrior, attacking: true, sacrificeAtEnd: true }] },
      });
      continue;
    }

    // "Whenever one or more other creatures you control with power 2 or less enter, draw a card. This ability triggers
    // only once each turn." (Without the once-each-turn limit, several entering together would trigger once: not simulated.)
    const batch = line.match(/^Whenever one or more (other )?(.+?) enter, (.+?) This ability triggers only once each turn\.$/i);
    if (batch) {
      const singular = batch[2].replace(/^(\w+?)s\b/, '$1');
      const watched = triggerSubject(`${batch[1] ? 'another' : 'a'} ${singular}`, false);
      if (watched) out.push({ event: { on: 'enters', self: false, ...watched }, ability: triggerAbility(batch[3], name, false), oncePerTurn: true });
      continue;
    }

    // Orcish Bowmasters: "When this creature enters and whenever an opponent draws a card except the first one they
    // draw in each of their draw steps, …"
    const bowmasters = line.match(/^When (.+?) enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, (.+)$/i);
    if (bowmasters && selves.includes(bowmasters[1].toLowerCase())) {
      const ability = triggerAbility(bowmasters[2], name, true);
      out.push({ event: { on: 'enters', self: true }, ability }, { event: { on: 'opponentDraws', notFirstInDrawStep: true }, ability });
      continue;
    }
    // Esper Sentinel: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player
    // pays {X}, where X is this creature's power."
    if (/^Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays \{X\}, where X is this creature's power\.$/i.test(line)) {
      out.push({
        event: { on: 'opponentCasts', filter: { nonTypes: ['creature'] }, firstNoncreature: true },
        ability: { targets: [{ kind: 'player', min: 1, max: 1, filter: {} }], effects: [{ kind: 'drawUnlessPays', n: 1, mana: 'power' }] },
      });
      continue;
    }
    // Sowing Mycospawn: "When you cast this spell, search …", "When you cast this spell, if it was kicked, exile target land."
    const castSelf = line.match(/^When you cast this spell, (if it was kicked, )?(.+)$/i);
    if (castSelf) {
      out.push({ event: { on: 'castSelf', ...(castSelf[1] ? { kicked: true } : {}) }, ability: triggerAbility(castSelf[2], name, true) });
      continue;
    }
    // Rhystic Study: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."
    const taxed = line.match(/^Whenever an opponent casts an? ([a-z ]*?)spell, you may draw (a|two) cards? unless that player pays \{(\d+)\}\.$/i);
    const taxedFilter = taxed && (taxed[1].trim() ? cardWordsFilter(taxed[1].trim()) : {});
    if (taxed && taxedFilter) {
      out.push({
        event: { on: 'opponentCasts', filter: taxedFilter },
        ability: { targets: [{ kind: 'player', min: 1, max: 1, filter: {} }], effects: [{ kind: 'drawUnlessPays', n: taxed[2] === 'two' ? 2 : 1, mana: Number(taxed[3]) }] },
      });
      continue;
    }
    // Nihil Spellbomb: "When this artifact is put into a graveyard from the battlefield, …" (like dying).
    const toGrave = line.match(/^When (.+?) is put into a graveyard from the battlefield, (.+)$/i);
    if (toGrave && selves.includes(toGrave[1].toLowerCase())) {
      out.push({ event: { on: 'dies', self: true }, ability: triggerAbility(toGrave[2], name, true) });
      continue;
    }
    // City of Traitors: "When you play another land, sacrifice this land."
    const playLand = line.match(/^When(?:ever)? you play another land, (.+)$/i);
    if (playLand) {
      out.push({ event: { on: 'youPlayLand' }, ability: triggerAbility(playLand[1], name, true) });
      continue;
    }
    // Faerie Mastermind: "Whenever an opponent draws their second card each turn, you draw a card."
    const draws = line.match(/^Whenever an opponent draws (a card|their second card each turn), (.+)$/i);
    if (draws) {
      out.push({ event: { on: 'opponentDraws', ...(draws[1].startsWith('their') ? { nth: 2 } : {}) }, ability: triggerAbility(draws[2], name, true) });
      continue;
    }

    // Chainsaw: "Whenever one or more creatures die, put a rev counter on this Equipment."
    const died = line.match(/^Whenever one or more creatures die, (.+)$/i);
    if (died) {
      out.push({ event: { on: 'dies', self: false, which: { kind: 'creature', filter: {} }, another: false }, ability: triggerAbility(died[1], name, true), batch: true });
      continue;
    }

    // Kíli: "Whenever another Dwarf or Equipment you control enters, draw a card. This ability triggers only once each turn."
    const oncePerTurn = / This ability triggers only once each turn\.$/.test(line);
    const ev = line.replace(/ This ability triggers only once each turn\.$/, '')
      .match(/^(?:When|Whenever) (.+?) (enters(?: the battlefield)?( under your control)?|attacks|dies|deals combat damage to a player)(?: or (enters|attacks|dies)(?: the battlefield)?)?, (.+)$/i);
    if (ev) {
      const [, rawSubject, verb, under, alsoVerb, text] = ev;
      const ons = [verb, alsoVerb].filter(Boolean).map((v): ObjectEvent => (v.startsWith('deals') ? 'combatDamage' : (v.toLowerCase().split(' ')[0] as ObjectEvent)));
      // "this creature or another creature you control" is any creature you control, itself included.
      const orAnother = rawSubject.match(/^(.+?) or another (.+)$/i);
      const subject = orAnother && selves.includes(orAnother[1].toLowerCase()) ? `a ${orAnother[2]}` : rawSubject;
      const self = selves.includes(subject.toLowerCase());
      const watched = self ? null : triggerSubject(subject, !!under);
      if (!self && !watched) continue;
      const ability = triggerAbility(text, name, self);
      for (const on of ons) {
        out.push({ event: self ? { on, self: true } : { on, self: false, ...watched! }, ability, ...(oncePerTurn ? { oncePerTurn } : {}) });
      }
      continue;
    }

    // Chandra, Spark Hunter: "At the beginning of combat on your turn, …"
    const combat = line.match(/^At the beginning of combat on your turn, (.+)$/i);
    if (combat) {
      out.push({ event: { on: 'beginCombat', whose: 'you' }, ability: triggerAbility(combat[1], name, true) });
      continue;
    }
    const step = line.match(/^At the beginning of (your|each|each player's|each opponent's|the) (upkeep|draw step|end step), (.+)$/i);
    if (step) {
      const w = step[1].toLowerCase();
      const whose = w === 'your' ? 'you' : w === "each opponent's" ? 'opponent' : 'each';
      const on = ({ upkeep: 'upkeep', 'draw step': 'draw', 'end step': 'endStep' } as const)[step[2].toLowerCase() as 'upkeep' | 'draw step' | 'end step'];
      out.push({ event: { on, whose }, ability: triggerAbility(step[3], name, true) });
      continue;
    }

    // Vexing Bauble: "Whenever a player casts a spell, if no mana was spent to cast it, counter that spell."
    if (/^Whenever a player casts a spell, if no mana was spent to cast it, counter that spell\.$/i.test(line)) {
      out.push({
        event: { on: 'castWithoutMana' },
        ability: { targets: [{ kind: 'spell', min: 1, max: 1, filter: {} }], effects: [{ kind: 'counter', to: { slot: 0 } }] },
      });
      continue;
    }

    const tapped = line.match(/^Whenever (.+?) becomes tapped, (.+)$/i);
    if (tapped && selves.includes(tapped[1].toLowerCase())) {
      out.push({ event: { on: 'becomesTapped' }, ability: triggerAbility(tapped[2], name, true) });
      continue;
    }

    const youAttack = line.match(/^Whenever you attack, (.+)$/i);
    if (youAttack) {
      out.push({ event: { on: 'youAttack' }, ability: triggerAbility(youAttack[1], name, false) });
      continue;
    }
    const gain = line.match(/^Whenever you gain life, (.+)$/i);
    if (gain) {
      out.push({ event: { on: 'gainLife' }, ability: triggerAbility(gain[1], name, true) });
      continue;
    }
    // Magecraft: "Whenever you cast or copy …" (copies aren't simulated, casting is).
    const cast = line.match(/^Whenever you cast (?:or copy )?an? (?:([a-z, -]+?) )?spell, (.+)$/i);
    if (cast) {
      const filter = cast[1] ? cardWordsFilter(cast[1]) : {};
      if (filter) out.push({ event: { on: 'cast', filter }, ability: triggerAbility(cast[2], name, true) });
    }
  }
  triggerCache.set(key, out);
  return out;
}

// ---------- Activated abilities ----------

/** What activating an ability costs, besides its mana. */
export interface ActivationCost {
  /** Mana symbols, e.g. "{2}{R}" (may contain {X}). */
  mana: string;
  tap: boolean;
  /** "Sacrifice this creature". */
  sacrificeSelf: boolean;
  /** "Sacrifice a creature" / "Sacrifice another artifact": chosen when activating. */
  sacrifice?: { which: Selector; another: boolean };
  /** "Pay N life". */
  life: number;
  /** Loyalty ability: loyalty counters added (positive) or removed (negative). */
  loyalty?: number;
  /** Crew N: tap untapped creatures you control with total power N or more (chosen when activating). */
  crew?: number;
}

export interface ActivatedSpec {
  /** The ability as printed, for menus. */
  text: string;
  cost: ActivationCost;
  ability: AbilitySpec;
  /** "Activate only as a sorcery." */
  sorcery: boolean;
  /** "Activate only once each turn." */
  once: boolean;
  /**
   * An equip ability (Dwarven Mauler and Kíli make some cheaper). `perColor`: Dragonfire Blade's "This ability costs
   * {1} less to activate for each color of the creature it targets."
   */
  equip?: { perColor?: boolean };
  /** The Lonely Mountain: "This ability costs {1} less to activate for each Equipment you control." */
  discountPer?: Selector;
}

const activatedCache = new Map<string, ActivatedSpec[]>();

/**
 * Activated abilities of a permanent card ("{T}: …", "{2}{R}, Sacrifice this creature: …").
 * Mana abilities ("{T}: Add {G}") are handled by manaColors; loyalty abilities and costs the
 * engine can't pay yet (sacrificing another permanent, discarding, removing counters…) are left out.
 */
export function activatedOf(card: Card): ActivatedSpec[] {
  const key = `${card.name}\n${card.oracleText}`;
  const cached = activatedCache.get(key);
  if (cached) return cached;
  const out: ActivatedSpec[] = [];
  const name = selfName(card);
  const selves = selfWords(name).map((w) => w.toLowerCase());

  for (const raw of frontText(card).split('\n')) {
    const line = raw.replace(/\s*\([^)]*\)/g, '').replace(/^[A-Z][A-Za-z' ]+ — /, '').trim();
    // "Equip {2}": attach to target creature you control, as a sorcery.
    const equip = line.match(/^Equip( worthy)? ((?:\{[^}]+\})+)(\. This ability costs \{1\} less to activate for each color of the creature it targets\.)?$/);
    if (equip) {
      // Mjölnir: "Equip worthy {1} (A creature is worthy if it's a legendary non-Villain that's red and/or white.)"
      const worthy: TargetFilter = equip[1] ? { legendary: true, nonSubtypes: ['villain'], colors: ['R', 'W'] } : {};
      out.push({
        text: line, cost: { mana: equip[2], tap: false, sacrificeSelf: false, life: 0 }, sorcery: true, once: false, equip: equip[3] ? { perColor: true } : {},
        ability: { targets: [{ kind: 'creature', min: 1, max: 1, filter: { controller: 'you', ...worthy } }], effects: [{ kind: 'attach', to: { slot: 0 } }] },
      });
      continue;
    }
    // Vehicles: "Crew 1" (tap creatures with total power 1 or more: it becomes an artifact creature until end of turn).
    const crew = line.match(/^Crew (\d+)$/);
    if (crew) {
      out.push({
        text: line, cost: { mana: '', tap: false, sacrificeSelf: false, life: 0, crew: Number(crew[1]) }, sorcery: false, once: false,
        ability: { targets: [], effects: [{ kind: 'animate', to: 'self', subtypes: [], keywords: [] }] },
      });
      continue;
    }
    const m = line.match(/^([^:"]+): (.+)$/);
    if (!m) continue;
    let text = m[2];
    // Loyalty abilities: "+1: …", "−3: …", "0: …" (activated as a sorcery, one per turn per planeswalker).
    const loyalty = m[1].trim().match(/^\[?([+−-]?)(\d+)\]?$/);
    if (loyalty) {
      const n = Number(loyalty[2]) * (loyalty[1] === '−' || loyalty[1] === '-' ? -1 : 1);
      const ability = UNSUPPORTED.test(text) ? NO_EFFECT : parseAbilityText(text, name);
      out.push({ text: line, cost: { mana: '', tap: false, sacrificeSelf: false, life: 0, loyalty: n }, ability, sorcery: true, once: false });
      continue;
    }
    if (/^(?:\[|[+−])/.test(m[1])) continue; // "−X: …" and other loyalty costs
    if (/\badd \{|\badd (?:one|two|three) mana|\badd [a-z]+ mana/i.test(text)) continue; // mana ability
    const cost: ActivationCost = { mana: '', tap: false, sacrificeSelf: false, life: 0 };
    let ok = true;
    for (const part of m[1].split(/,\s*/)) {
      const p = part.trim();
      if (/^(\{[^}]+\})+$/.test(p) && !p.includes('{T}') && !p.includes('{Q}')) cost.mana += p;
      else if (p === '{T}') cost.tap = true;
      else if (/^sacrifice /i.test(p) && selves.includes(p.slice('sacrifice '.length).toLowerCase())) cost.sacrificeSelf = true;
      else if (/^sacrifice (?:a|an|another) /i.test(p)) {
        const subject = triggerSubject(p.slice('sacrifice '.length), true);
        if (subject) cost.sacrifice = subject;
        else ok = false;
      }
      else if (/^pay (\d+) life$/i.test(p)) cost.life = Number(p.match(/\d+/)![0]);
      else ok = false;
    }
    if (!ok) continue;
    // "This ability costs {1} less to activate for each Equipment you control."
    let discountPer: Selector | undefined;
    const discount = text.match(/ This ability costs \{1\} less to activate for each ([A-Za-z ]+?) you control\./);
    if (discount) {
      const counted = parseTargetPhrase(`target ${discount[1]} you control`);
      if (!counted || (counted.kind !== 'creature' && counted.kind !== 'permanent')) continue;
      discountPer = { kind: counted.kind, filter: counted.filter };
      text = text.replace(discount[0], '');
    }
    const sorcery = /Activate only as a sorcery/i.test(text);
    const once = /Activate only once each turn/i.test(text);
    // Other restrictions ("only during your turn", "only if …") aren't checked: leave the ability out.
    if (/Activate (?:only|this ability only)/i.test(text.replace(/Activate only (?:as a sorcery|once each turn)\.?/gi, ''))) continue;
    text = text.replace(/\s*Activate (?:only|this ability only)[^.]*\./gi, '').trim();
    const optional = /^you may /i.test(text);
    const body = optional ? `you ${text.slice('you may '.length)}` : text;
    // {S} must be paid with mana from a snow source, which the engine doesn't track (Faceless Haven).
    const ability = UNSUPPORTED.test(body) || cost.mana.includes('{S}') ? NO_EFFECT : parseAbilityText(body, name);
    out.push({ text: line, cost, ability: optional && ability.effects.length ? { ...ability, optional } : ability, sorcery, once, ...(discountPer ? { discountPer } : {}) });
  }
  activatedCache.set(key, out);
  return out;
}

/** Dwarven Mauler: "Equip abilities you activate that target this creature cost {2} less to activate." → 2. */
export function equipDiscount(card: Card): number {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  const m = frontText(card).match(new RegExp(`^Equip abilities you activate that target (?:${selves}) cost \\{(\\d+)\\} less to activate\\.$`, 'im'));
  return m ? Number(m[1]) : 0;
}

/**
 * Kíli: "As long as you have an enduring story, you may pay {0} rather than pay the equip cost of the first equip
 * ability you activate each turn." (Always taken: it only saves mana.)
 */
export const freeFirstEquip = (card: Card) =>
  /^As long as you have an enduring story, you may pay \{0\} rather than pay the equip cost of the first equip ability you activate each turn\.$/m.test(frontText(card));

/** "Storied": three or more artifacts, legendaries and/or Sagas give its controller an enduring story for the game. */
export const isStoried = (card: Card) => /^Storied\b/m.test(frontText(card));

/**
 * Cloud: "As long as Cloud is equipped, if a triggered ability of Cloud or an Equipment attached to it triggers, that
 * ability triggers an additional time."
 */
export function doublesEquippedTriggers(card: Card): boolean {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  return new RegExp(`^As long as (?:${selves}) is equipped, if a triggered ability of (?:${selves}) or an Equipment attached to it triggers, that ability triggers an additional time\\.$`, 'im').test(frontText(card));
}

/** Leylines: "If this card is in your opening hand, you may begin the game with it on the battlefield." */
/**
 * Mana that depends on the game: Chrome Mox "{T}: Add one mana of any of the exiled card's colors." (imprinted), Mox
 * Amber "{T}: Add one mana of any color among legendary creatures and planeswalkers you control." (legends),
 * Gemstone Caverns (luck: any color with a luck counter, otherwise {C}).
 */
export function stateMana(card: Card): 'imprinted' | 'legends' | 'luck' | 'perArtifact' | 'mining' | 'reflect' | 'perCreature' | 'opponentLands' | null {
  const text = frontText(card);
  // Gaea's Cradle: "{T}: Add {G} for each creature you control."
  if (/^\{T\}: Add \{G\} for each creature you control\.$/m.test(text)) return 'perCreature';
  // Fellwar Stone: "{T}: Add one mana of any color that a land an opponent controls could produce."
  if (/^\{T\}: Add one mana of any color that a land an opponent controls could produce\.$/m.test(text)) return 'opponentLands';
  // Reflecting Pool: "{T}: Add one mana of any type that a land you control could produce."
  if (/^\{T\}: Add one mana of any type that a land you control could produce\.$/m.test(text)) return 'reflect';
  // Gemstone Mine: "{T}, Remove a mining counter from this land: Add one mana of any color. If there are no mining
  // counters on this land, sacrifice it."
  if (/^\{T\}, Remove a mining counter from this land: Add one mana of any color\. If there are no mining counters on this land, sacrifice it\.$/m.test(text)) return 'mining';
  // Tolarian Academy: "{T}: Add {U} for each artifact you control."
  if (/^\{T\}: Add \{U\} for each artifact you control\.$/m.test(text)) return 'perArtifact';
  // Gemstone Caverns: "{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color."
  if (/^\{T\}: Add \{C\}\. If (?:this land|.+) has a luck counter on it, instead add one mana of any color\.$/m.test(text)) return 'luck';
  if (/^\{T\}: Add one mana of any of the exiled card's colors\.$/m.test(text)) return 'imprinted';
  if (/^\{T\}: Add one mana of any color among legendary creatures and planeswalkers you control\.$/m.test(text)) return 'legends';
  return null;
}

/** Mox Diamond: "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard." */
export const discardsLandInstead = (card: Card) =>
  /^If this (?:artifact|permanent) would enter(?: the battlefield)?, you may discard a land card instead\. If you do, put (?:this artifact|it) onto the battlefield\. If you don't, put it into its owner's graveyard\.$/m.test(frontText(card));

/** Grim Monolith, Mana Vault: "This artifact doesn't untap during your untap step." */
export const doesntUntap = (card: Card) =>
  new RegExp(`^(?:${selfWords(card.name).map(escapeRe).join('|')}) doesn't untap during (?:your|its controller's) untap step\\.$`, 'im').test(frontText(card));

/**
 * Gemstone Caverns: "If this card is in your opening hand and you're not the starting player, you may begin the game
 * with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand."
 */
export const beginsWithLuck = (card: Card) =>
  /^If this card is in your opening hand and you're not the starting player, you may begin the game with (?:this land|.+) on the battlefield with a luck counter on it\. If you do, exile a card from your hand\.$/m.test(frontText(card));

export const beginsOnBattlefield = (card: Card) =>
  /^If this card is in your opening hand, you may begin the game with it on the battlefield\.$/m.test(frontText(card));

// ---------- Entering the battlefield ----------

/** "This creature enters with N +1/+1 counters on it" (X: the value paid when cast); Moonshadow: "six -1/-1 counters". */
export function entersCounters(card: Card): { counter: '+1/+1' | '-1/-1' | 'mining'; n: Amount } | null {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  // Gemstone Mine: "This land enters with three mining counters on it."
  const mining = frontText(card).match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? with (${AMOUNT}) mining counters? on it\\.`, 'i'));
  if (mining) return { counter: 'mining', n: toAmount(mining[1]) };
  const m = frontText(card).match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? with (${AMOUNT}) ([+-]1\\/[+-]1) counters? on (?:it|him|her|them)\\.`, 'i'));
  return m && (m[2] === '+1/+1' || m[2] === '-1/-1') ? { counter: m[2], n: toAmount(m[1]) } : null;
}

/** "This creature enters with N +1/+1 counters on it" (X: the value paid when cast). */
export function entersWithCounters(card: Card): Amount | null {
  const c = entersCounters(card);
  return c?.counter === '+1/+1' ? c.n : null;
}

/** "This land enters tapped." (unconditional only: "unless …" and "if …" are not checked yet). */
export function entersTapped(card: Card): boolean {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  return new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped\\.(?:\\n|$)`, 'i').test(frontText(card));
}

/** A planeswalker's starting loyalty (3 for cards saved without it). */
export function startingLoyalty(card: Card): number {
  const n = parseInt(card.loyalty ?? '', 10);
  return Number.isNaN(n) ? 3 : n;
}

export const isPlaneswalker = (card: Card) => cardTypes(card).includes('planeswalker');

// ---------- Static abilities ----------

/** What a static ability changes on the creatures it applies to. */
export interface StaticSpec {
  /** The creature this Aura / Equipment is attached to, itself, or every creature matching a selector (anthems). */
  who: 'enchanted' | 'equipped' | 'self' | { which: Selector; other: boolean };
  power: number;
  toughness: number;
  /** "gets +1/+1 for each artifact you control": power and toughness count these permanents of its controller. */
  perEach?: Selector;
  /** Kellan: "for each Aura and Equipment attached to Kellan". */
  perAttached?: boolean;
  /** Chainsaw: "+X/+0, where X is the number of rev counters on this Equipment". */
  perCounter?: CounterKind;
  /** Dáin's Company: "as long as you control another Dwarf" (a creature type, lower case). */
  ifAnother?: string;
  /** Delirium: "as long as there are four or more card types among cards in your graveyard". */
  delirium?: boolean;
  /** "attacks each combat if able". */
  mustAttack?: boolean;
  keywords: Keyword[];
  /** "has … ward {2}" (Lavaspur Boots, Sheltered by Ghosts). */
  ward?: number;
  /** Hexing Squelcher: "Other creatures you control have "Ward—Pay 2 life."" */
  wardLife?: number;
  /** Dragonfire Blade: "has hexproof from monocolored". */
  hexproofFromMonocolored?: boolean;
  /** Mjölnir: "Double all damage equipped creature would deal." */
  doubleDamage?: boolean;
  cantAttack?: boolean;
  cantBlock?: boolean;
}

/** "Other Elf creatures you control", "White creatures you control", "Creatures your opponents control". */
function anthemSubject(subject: string): { which: Selector; other: boolean } | null {
  const words = subject.split(' ');
  const other = words[0].toLowerCase() === 'other';
  if (other) words.shift();
  const filter: TargetFilter = {};
  let i = 0;
  for (; i < words.length && !/^creatures?$/i.test(words[i]); i++) {
    const w = words[i];
    const lower = w.toLowerCase();
    if (COLOR_WORDS[lower]) (filter.colors ??= []).push(COLOR_WORDS[lower]);
    else if (lower.startsWith('non') && COLOR_WORDS[lower.slice(3)]) (filter.nonColors ??= []).push(COLOR_WORDS[lower.slice(3)]);
    else if (lower === 'artifact' || lower === 'enchantment') (filter.types ??= []).push(lower);
    else if (/^[A-Z][a-z]+$/.test(w)) (filter.subtypes ??= []).push(lower); // a creature type: Elf, Goblin…
    else return null;
  }
  const rest = words.slice(i + 1).join(' ').toLowerCase();
  if (i === words.length) return null;
  if (rest === 'you control') filter.controller = 'you';
  else if (rest === 'your opponents control' || rest === "you don't control") filter.controller = 'opponent';
  else if (rest !== '') return null;
  return { which: { kind: 'creature', filter }, other };
}

const staticCache = new Map<string, StaticSpec[]>();

/** Static abilities of a permanent card: anthems, and what an Aura or Equipment gives. */
export function staticsOf(card: Card): StaticSpec[] {
  const key = `${card.name}\n${card.oracleText}`;
  const cached = staticCache.get(key);
  if (cached) return cached;
  const out: StaticSpec[] = [];
  for (const raw of frontText(card).split('\n')) {
    const line = raw.replace(/\s*\([^)]*\)/g, '').trim();
    const kws = (text: string | undefined) => keywordList(text?.toLowerCase());
    const doubled = line.match(/^Double all damage (enchanted|equipped) creature would deal\.$/i);
    if (doubled) {
      out.push({ who: doubled[1].toLowerCase() as 'enchanted' | 'equipped', power: 0, toughness: 0, keywords: [], doubleDamage: true });
      continue;
    }
    const attached = line.match(/^(Enchanted|Equipped) creature (.+)\.$/);
    if (attached) {
      const who = attached[1] === 'Enchanted' ? 'enchanted' : 'equipped';
      // "has haste and ward {1}", "has hexproof from monocolored": abilities that aren't plain keywords.
      const extra: Partial<StaticSpec> = {};
      const body = attached[2]
        .replace(/(?:,? and |, | )ward \{(\d+)\}$/i, (_, n) => ((extra.ward = Number(n)), ''))
        .replace(/(?:,? and |, | )hexproof from monocolored$/i, () => ((extra.hexproofFromMonocolored = true), ''))
        .replace(/ and has$| has$/, '');
      // Chainsaw: "gets +X/+0, where X is the number of rev counters on this Equipment".
      const perCounter = body.match(/^gets \+X\/\+0, where X is the number of ([a-z]+) counters on this (?:Equipment|Aura)$/i);
      if (perCounter) {
        out.push({ who, power: 1, toughness: 0, keywords: [], perCounter: perCounter[1].toLowerCase() as CounterKind });
        continue;
      }
      const pump = body.match(new RegExp(`^gets ([+-]\\d+)\\/([+-]\\d+)(?: and has ${KEYWORD_LIST})?$`, 'i'));
      const has = body.match(new RegExp(`^has ${KEYWORD_LIST}$`, 'i'));
      if (pump) out.push({ who, power: Number(pump[1]), toughness: Number(pump[2]), keywords: kws(pump[3]), ...extra });
      else if (has) out.push({ who, power: 0, toughness: 0, keywords: kws(has[1]), ...extra });
      else if (body === '' && (extra.ward || extra.hexproofFromMonocolored)) out.push({ who, power: 0, toughness: 0, keywords: [], ...extra });
      else if (/^can't attack or block$/i.test(body)) out.push({ who, power: 0, toughness: 0, keywords: [], cantAttack: true, cantBlock: true });
      else if (/^can't attack$/i.test(body)) out.push({ who, power: 0, toughness: 0, keywords: [], cantAttack: true });
      else if (/^can't block$/i.test(body)) out.push({ who, power: 0, toughness: 0, keywords: [], cantBlock: true });
      continue;
    }
    // Construct tokens: "This token gets +1/+1 for each artifact you control."
    const selves = selfWords(card.name).map(escapeRe).join('|');
    const each = line.match(new RegExp(`^(?:${selves}) gets \\+(\\d+)\\/\\+(\\d+) for each ([a-z ]+?) you control\\.$`, 'i'));
    const counted = each && parseTargetPhrase(`target ${each[3]} you control`);
    if (each && counted && (counted.kind === 'creature' || counted.kind === 'permanent')) {
      out.push({ who: 'self', power: Number(each[1]), toughness: Number(each[2]), keywords: [], perEach: { kind: counted.kind, filter: counted.filter } });
      continue;
    }
    // Dragon's Rage Channeler: "Delirium — As long as there are four or more card types among cards in your graveyard,
    // this creature gets +2/+2, has flying, and attacks each combat if able."
    const delirium = line.match(new RegExp(`^Delirium — As long as there are four or more card types among cards in your graveyard, (?:${selves}) gets \\+(\\d+)\\/\\+(\\d+)(?:, has ${KEYWORD_LIST},)?( and attacks each combat if able)?\\.$`, 'i'));
    if (delirium) {
      out.push({ who: 'self', power: Number(delirium[1]), toughness: Number(delirium[2]), keywords: kws(delirium[3]), delirium: true, ...(delirium[4] ? { mustAttack: true } : {}) });
      continue;
    }
    // Dáin's Company: "This creature has lifelink as long as you control another Dwarf."
    const ifAnother = line.match(new RegExp(`^(?:${selves}) has ${KEYWORD_LIST} as long as you control another ([A-Z][a-z]+)\\.$`, 'i'));
    if (ifAnother) {
      out.push({ who: 'self', power: 0, toughness: 0, keywords: kws(ifAnother[1]), ifAnother: ifAnother[2].toLowerCase() });
      continue;
    }
    // Kellan: "Other creatures you control get +1/+0 for each Aura and Equipment attached to Kellan."
    const perAttached = line.match(new RegExp(`^(Other creatures you control) get \\+(\\d+)\\/\\+(\\d+) for each Aura and Equipment attached to (?:${selves})\\.$`, 'i'));
    const attachedSubject = perAttached && anthemSubject(perAttached[1]);
    if (attachedSubject) {
      out.push({ who: attachedSubject, power: Number(perAttached![2]), toughness: Number(perAttached![3]), keywords: [], perAttached: true });
      continue;
    }
    // Hexing Squelcher: "Other creatures you control have "Ward—Pay 2 life."" (ward {N} the same way).
    const grantedWard = line.match(/^((?:Other )?[A-Za-z ]*?[Cc]reatures?(?: you control)?) have "Ward(?:—Pay (\d+) life| \{(\d+)\})\."$/);
    const wardSubject = grantedWard && anthemSubject(grantedWard[1]);
    if (wardSubject) {
      out.push({ who: wardSubject, power: 0, toughness: 0, keywords: [], ...(grantedWard![2] ? { wardLife: Number(grantedWard![2]) } : { ward: Number(grantedWard![3]) }) });
      continue;
    }
    const anthem = line.match(/^((?:Other )?[A-Za-z ]*?[Cc]reatures?(?: you control| your opponents control| you don't control)?) (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?|have (.+))\.$/);
    if (anthem) {
      const subject = anthemSubject(anthem[1]);
      const keywordText = anthem[4] ?? anthem[5];
      const keywords = keywordText ? kws(keywordText) : [];
      if (!subject || (keywordText && !keywords.every((k) => (KEYWORDS as readonly string[]).includes(k)))) continue;
      out.push({ who: subject, power: Number(anthem[2] ?? 0), toughness: Number(anthem[3] ?? 0), keywords });
    }
  }
  staticCache.set(key, out);
  return out;
}

/** What an Aura can enchant ("Enchant creature", "Enchant creature you control", "Enchant land"), as a target. */
export function auraTarget(card: Card): TargetSpec | null {
  if (!/\bAura\b/.test(card.typeLine.split('//')[0])) return null;
  const m = frontText(card).match(/^Enchant ([a-z ,]+?)\s*$/im);
  return m ? parseTargetPhrase(`target ${m[1]}`) : null;
}

/** "Ward {2}": the mana an opponent must pay for each spell or ability targeting it (0 if none). */
export function wardCost(card: Card): number {
  const m = frontText(card).match(/(?:^|\n|, )Ward \{(\d+)\}/i);
  return m ? Number(m[1]) : 0;
}

/** "Ward—Pay 2 life.": the life an opponent must pay for each spell or ability targeting it (0 if none). */
export function wardLife(card: Card): number {
  const m = frontText(card).match(/(?:^|\n)Ward—Pay (\d+) life\./i);
  return m ? Number(m[1]) : 0;
}

/**
 * Pithing Needle: "As this artifact enters, choose a card name." and "Activated abilities of sources with the chosen
 * name can't be activated unless they're mana abilities." (both lines, or neither is read).
 */
export function namesCardToStop(card: Card): boolean {
  const text = frontText(card);
  return /^As (?:this [a-z]+|.+?) enters(?: the battlefield)?, choose a card name\.$/m.test(text)
    && /^Activated abilities of sources with the chosen name can't be activated unless they're mana abilities\.$/m.test(text);
}

/**
 * Quantum Riddler: "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that
 * many cards plus one instead."
 */
export const drawsOneMore = (card: Card) =>
  /^As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead\.$/m.test(frontText(card));

/**
 * Springleaf Drum: "{T}, Tap an untapped creature you control: Add one mana of any color." (creature); Gene Pollinator:
 * "{T}, Tap an untapped permanent you control: …" (permanent). Null for other cards.
 */
export function tapsAnotherForMana(card: Card): 'creature' | 'permanent' | null {
  const m = frontText(card).match(/^\{T\}, Tap an untapped (creature|permanent) you control: Add one mana of any color\.$/m);
  return m ? (m[1] as 'creature' | 'permanent') : null;
}

/** Brazen Borrower: "This creature can block only creatures with flying." */
export const blocksOnlyFlyers = (card: Card) =>
  new RegExp(`^(?:${selfWords(card.name).map(escapeRe).join('|')}) can block only creatures with flying\\.$`, 'im').test(frontText(card));

/** Elvish Spirit Guide: "Exile this card from your hand: Add {G}." (the color), or null. */
export function handMana(card: Card): Color | null {
  const m = frontText(card).match(/^Exile this card from your hand: Add \{([WUBRGC])\}\.$/m);
  return m ? (m[1] as Color) : null;
}

/** Multiversal Passage: "As this land enters, choose a basic land type." and "This land is the chosen type." */
export const choosesBasicType = (card: Card) =>
  /^As this land enters, choose a basic land type\./m.test(frontText(card)) && /^This land is the chosen type\.$/m.test(frontText(card));

/** Meddling Mage: "As this creature enters, choose a nonland card name." and "Spells with the chosen name can't be cast." */
export const namesSpellToStop = (card: Card) =>
  /^As this creature enters, choose a nonland card name\.$/m.test(frontText(card)) && /^Spells with the chosen name can't be cast\.$/m.test(frontText(card));

/** Hexing Squelcher: "Spells you control can't be countered." */
export const protectsSpells = (card: Card) => /^Spells you control can't be countered\.$/m.test(frontText(card));

/** "Protection from red", "protection from white and from blue": colors it is protected from. */
export function protectionsOf(card: Card): Color[] {
  const out: Color[] = [];
  for (const m of frontText(card).matchAll(/protection from ((?:(?:white|blue|black|red|green)(?:,? and from |, from |, )?)+)/gi)) {
    for (const w of m[1].toLowerCase().split(/,? and from |, from |, /)) if (COLOR_WORDS[w]) out.push(COLOR_WORDS[w]);
  }
  return out;
}

export type EntersTappedRule =
  | { kind: 'always' }
  /** "unless you control a Plains or an Island" */
  | { kind: 'unlessSubtypes'; subtypes: string[] }
  /** Fast lands "unless you control two or fewer other lands" (max), slow lands "two or more" (min). */
  | { kind: 'unlessOtherLands'; max?: number; min?: number }
  /** Shock lands: "As this land enters, you may pay 2 life. If you don't, it enters tapped." */
  | { kind: 'payLife'; n: number }
  /** "unless you control a basic land" (Abandoned Air Temple). */
  | { kind: 'unlessBasic' }
  /** Starting Town: "enters tapped unless it's your first, second, or third turn of the game" (n: 3). */
  | { kind: 'unlessEarlyTurn'; n: number };

/** When a permanent enters tapped. */
export function entersTappedRule(card: Card): EntersTappedRule | null {
  const text = frontText(card);
  const selves = selfWords(card.name).map(escapeRe).join('|');
  if (entersTapped(card)) return { kind: 'always' };
  const early = text.match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped unless it's your (first|first or second|first, second, or third) turn of the game\\.`, 'i'));
  if (early) return { kind: 'unlessEarlyTurn', n: early[1].split(/,? or |, /).length };
  const unless = text.match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped unless you control (.+?)\\.`, 'i'));
  if (unless) {
    const what = unless[1].toLowerCase();
    const lands = what.match(/^(two|three) or (fewer|more) other lands$/);
    if (lands) return { kind: 'unlessOtherLands', [lands[2] === 'fewer' ? 'max' : 'min']: toNumber(lands[1]) };
    if (what === 'a basic land') return { kind: 'unlessBasic' };
    const types = what.split(/,? or |, /).map((w) => w.replace(/^an? /, ''));
    // "unless you control a Mountain or a Forest"; The Lonely Mountain: "unless you control an Equipment".
    if (types.every((t) => LAND_TYPES.includes(t) || OTHER_SUBTYPES.includes(t))) return { kind: 'unlessSubtypes', subtypes: types };
    return null;
  }
  // Multiversal Passage: "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, …"
  const shock = text.match(/As (?:this land|this permanent) enters(?: the battlefield)?, (?:choose a basic land type\. Then )?you may pay (\d+) life\. If you don't, it enters(?: the battlefield)? tapped\./i);
  return shock ? { kind: 'payLife', n: Number(shock[1]) } : null;
}

/** Static abilities that change the rules of the game for everyone. */
export type GameRule =
  /** Voice of Victory: "Your opponents can't cast spells during your turn." */
  | 'opponentsCantCastOnYourTurn'
  /** Clarion Conqueror: "Activated abilities of artifacts, creatures, and planeswalkers can't be activated." */
  | 'noActivatedAbilities'
  /** Rest in Peace: "If a card or token would be put into a graveyard from anywhere, exile it instead." */
  | 'graveyardsExiled'
  /** Leyline of the Void: "If a card would be put into an opponent's graveyard from anywhere, exile it instead." */
  | 'opponentGraveyardsExiled'
  /** Teferi, Time Raveler: "Each opponent can cast spells only any time they could cast a sorcery." */
  | 'opponentsSorcerySpeed'
  /** Containment Priest: "If a nontoken creature would enter and it wasn't cast, exile it instead." */
  | 'uncastCreaturesExiled'
  /** Grafdigger's Cage: "Creature cards in graveyards and libraries can't enter the battlefield." */
  | 'noCreaturesFromGraveyardsLibraries'
  /** Grafdigger's Cage: "Players can't cast spells from graveyards or libraries." */
  | 'noCastingFromGraveyardsLibraries'
  /** Defense Grid: "Each spell costs {3} more to cast except during its controller's turn." */
  | 'offTurnSpellsCost3'
  /** Doorkeeper Thrull: "Artifacts and creatures entering don't cause abilities to trigger." */
  | 'noEntersTriggers'
  /** High Noon: "Each player can't cast more than one spell each turn." */
  | 'oneSpellEachTurn'
  /** Yavimaya, Cradle of Growth: "Each land is a Forest in addition to its other land types." */
  | 'landsAreForests'
  /** Urborg, Tomb of Yawgmoth: "Each land is a Swamp in addition to its other land types." */
  | 'landsAreSwamps'
  /** Thalia, Guardian of Thraben: "Noncreature spells cost {1} more to cast." */
  | 'noncreatureSpellsCost1'
  /** Trinisphere: "As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast." */
  | 'spellsCostAtLeast3'
  /** Damping Sphere: "If a land is tapped for two or more mana, it produces {C} instead of any other type and amount." */
  | 'landsMakeOneColorless'
  /** Damping Sphere: "Each spell a player casts costs {1} more to cast for each other spell that player has cast this turn." */
  | 'spellsCostMorePerSpell'
  /** Null Rod: "Activated abilities of artifacts can't be activated." */
  | 'noArtifactAbilities'
  /** Drannith Magistrate: "Your opponents can't cast spells from anywhere other than their hands." */
  | 'opponentsCastFromHandOnly'
  /** Magus of the Moon: "Nonbasic lands are Mountains." */
  | 'nonbasicLandsAreMountains';

const GAME_RULES: [RegExp, GameRule][] = [
  [/^Your opponents can't cast spells during your turn\.$/m, 'opponentsCantCastOnYourTurn'],
  [/^Activated abilities of artifacts, creatures, and planeswalkers can't be activated\.$/m, 'noActivatedAbilities'],
  [/^If a card or token would be put into a graveyard from anywhere, exile it instead\.$/m, 'graveyardsExiled'],
  [/^If a card would be put into an opponent's graveyard from anywhere, exile it instead\.$/m, 'opponentGraveyardsExiled'],
  [/^Each opponent can cast spells only any time they could cast a sorcery\.$/m, 'opponentsSorcerySpeed'],
  [/^If a nontoken creature would enter(?: the battlefield)? and it wasn't cast, exile it instead\.$/m, 'uncastCreaturesExiled'],
  [/^Creature cards in graveyards and libraries can't enter the battlefield\.$/m, 'noCreaturesFromGraveyardsLibraries'],
  [/^Players can't cast spells from graveyards or libraries\.$/m, 'noCastingFromGraveyardsLibraries'],
  [/^Each spell costs \{3\} more to cast except during its controller's turn\.$/m, 'offTurnSpellsCost3'],
  [/^Artifacts and creatures entering don't cause abilities to trigger\.$/m, 'noEntersTriggers'],
  [/^Each player can't cast more than one spell each turn\.$/m, 'oneSpellEachTurn'],
  [/^Each land is a Forest in addition to its other land types\.$/m, 'landsAreForests'],
  [/^Each land is a Swamp in addition to its other land types\.$/m, 'landsAreSwamps'],
  [/^Noncreature spells cost \{1\} more to cast\.$/m, 'noncreatureSpellsCost1'],
  [/^As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast\./m, 'spellsCostAtLeast3'],
  [/^If a land is tapped for two or more mana, it produces \{C\} instead of any other type and amount\.$/m, 'landsMakeOneColorless'],
  [/^Each spell a player casts costs \{1\} more to cast for each other spell that player has cast this turn\.$/m, 'spellsCostMorePerSpell'],
  [/^Activated abilities of artifacts can't be activated\.$/m, 'noArtifactAbilities'],
  [/^Your opponents can't cast spells from anywhere other than their hands\.$/m, 'opponentsCastFromHandOnly'],
  [/^Nonbasic lands are Mountains\.$/m, 'nonbasicLandsAreMountains'],
];

const rulesCache = new Map<string, GameRule[]>();

export function gameRulesOf(card: Card): GameRule[] {
  const key = `${card.name}\n${card.oracleText}`;
  let rules = rulesCache.get(key);
  if (!rules) {
    rules = GAME_RULES.filter(([re]) => re.test(frontText(card))).map(([, rule]) => rule);
    rulesCache.set(key, rules);
  }
  return rules;
}

/** "Toxic 2": combat damage to a player also gives that many poison counters. */
export function toxicOf(card: Card): number {
  const m = frontText(card).match(/(?:^|\n|, )Toxic (\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** Clones: "You may have this creature enter as a copy of any creature on the battlefield." */
/**
 * Mockingbird: "You may have this creature enter as a copy of any creature on the battlefield with mana value less than
 * or equal to the amount of mana spent to cast this creature, except it's a Bird in addition to its other types and it
 * has flying."
 */
export const entersAsBirdCopy = (card: Card) =>
  /^You may have this creature enter as a copy of any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast this creature, except it's a Bird in addition to its other types and it has flying\.$/m.test(frontText(card));

export const entersAsCopy = (card: Card) =>
  /you may have (?:this creature|[^.]+?) enter(?: the battlefield)? as a copy of (?:any|a) creature on the battlefield\./i.test(frontText(card));
