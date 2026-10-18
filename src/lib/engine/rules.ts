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
  if (kw === 'lifelink' && gainsLifeFromDamage(card)) return true;
  if (card.keywords) return card.keywords.some((k) => k.toLowerCase() === kw);
  // Fallback for cards saved without Scryfall keywords: a line made only of keywords, e.g. "Flying, vigilance".
  return frontText(card)
    .split('\n')
    .some((line) => {
      const parts = line.toLowerCase().split(/,\s*/).map((p) => p.trim());
      return parts.includes(kw) && parts.every((p) => (KEYWORDS as readonly string[]).includes(p));
    });
}

/**
 * Exalted Angel: "Whenever this creature deals damage, you gain that much life." Played as lifelink (the life comes
 * with the damage instead of with a trigger on the stack).
 */
export const gainsLifeFromDamage = (card: Card) =>
  selfWords(card.name).some((w) => new RegExp(`^Whenever ${escapeRe(w)} deals damage, you gain that much life\\.$`, 'mi').test(frontText(card)));

/** Vedalken Shackles: "You may choose not to untap this artifact during your untap step." */
export const mayStayTapped = (card: Card) =>
  selfWords(card.name).some((w) => new RegExp(`^You may choose not to untap ${escapeRe(w)} during your untap step\\.$`, 'mi').test(frontText(card)));

/**
 * Wall of Essence: "Whenever this creature is dealt combat damage, you gain that much life." Gained with the damage (no
 * trigger on the stack), like Exalted Angel.
 */
export const gainsLifeFromCombatDamageTaken = (card: Card) =>
  selfWords(card.name).some((w) => new RegExp(`^Whenever ${escapeRe(w)} is dealt combat damage, you gain that much life\\.$`, 'mi').test(frontText(card)));

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

/** Mana that can only be spent on some spells or abilities: the units, and what they may pay for. */
export interface RestrictedMana {
  units: Color[][];
  /** The spells it may pay for ("artifact spells"). */
  spell?: TargetFilter;
  /** The abilities it may pay for, by their source ("abilities of creature sources"). */
  ability?: TargetFilter;
}

const COLORLESS_ELDRAZI: TargetFilter = { subtypes: ['eldrazi'], nonColors: ['W', 'U', 'B', 'R', 'G'] };
const MANA_USES: [RegExp, Omit<RestrictedMana, 'units'>][] = [
  [/^cast artifact spells$/i, { spell: { types: ['artifact'] } }],
  [/^cast a creature spell$/i, { spell: { types: ['creature'] } }],
  [/^cast a legendary spell$/i, { spell: { legendary: true } }],
  [/^cast colorless Eldrazi spells or activate abilities of colorless Eldrazi$/i, { spell: COLORLESS_ELDRAZI, ability: COLORLESS_ELDRAZI }],
  [/^activate abilities of creature sources$/i, { ability: { types: ['creature'] } }],
];

/**
 * Mishra's Workshop: "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells." Eldrazi Temple, Herd Heirloom,
 * Plaza of Heroes, Shang-Chi. (Cavern of Souls and Delighted Halfling: chosenTypeMana and legendaryMana.)
 */
export function restrictedMana(card: Card): RestrictedMana | null {
  for (const line of frontText(card).split('\n')) {
    const m = line.match(/^\{T\}: Add ([^.]+)\. Spend this mana only to ([^.,]+)\.$/);
    const units = m && parseManaText(m[1]);
    const use = m && MANA_USES.find(([re]) => re.test(m[2]));
    if (units && use) return { units, ...use[1] };
  }
  return null;
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
  /**
   * Talon Gates of Madara: "{1}, {T}: Add one mana of any color." Its one mana may be one of these colors instead,
   * spending one other mana on it (Giant's Boulder: `colors` empty, only that way).
   */
  paid?: Color[];
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
    iid: s.iid, index, colors, pool: s.iid.startsWith('pool:'), size: (s.units ?? [s.colors]).length, last: !!s.last, pain: s.pain, paid: s.paid,
  })));
  // Giant's Boulder makes mana only for another mana; delve cards and convoke creatures pay no mana ability's {1}.
  const spendable = (u: (typeof units)[number]) => u.colors.length > 0 || !u.paid;
  const feeable = (u: (typeof units)[number]) => u.colors.length > 0 && !/^(?:delve|convoke):/.test(u.iid);
  if (units.filter(spendable).length < cost.generic + cost.colored.length) return null;
  // Pool first, then bigger sources (their other mana would be wasted), then the least flexible.
  units.sort((a, b) => Number(b.pool) - Number(a.pool) || Number(a.last) - Number(b.last) || b.size - a.size || a.colors.length - b.colors.length
    || Number(!!a.paid) - Number(!!b.paid));
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
  // Talon Gates' mana made a color: one more mana to spend for each.
  let fees = 0;
  const open = (ok: (u: (typeof units)[number]) => boolean) => units.filter((x, u) => !used.has(u) && ok(x)).length;

  const assign = (i: number): boolean => {
    if (i === reqs.length) return open(spendable) >= cost.generic + fees && open(feeable) >= fees;
    for (const u of order(reqs[i])) {
      if (used.has(u) || !units[u].colors.some((c) => reqs[i].includes(c))) continue;
      used.add(u);
      paidBy.set(u, reqs[i]);
      if (assign(i + 1)) return true;
      used.delete(u);
      paidBy.delete(u);
    }
    for (const u of units.map((_, u) => u)) {
      if (used.has(u) || !units[u].paid?.some((c) => reqs[i].includes(c))) continue;
      used.add(u);
      fees++;
      if (assign(i + 1)) return true;
      used.delete(u);
      fees--;
    }
    return false;
  };
  if (!assign(0)) return null;

  // Talon Gates' fees first (real mana), then generic mana: the pool, then sources already being tapped, then the rest
  // in order.
  const tapped = () => new Set([...used].map((u) => units[u].iid));
  for (let n = 0; n < fees + cost.generic; n++) {
    const open = units.map((_, u) => u).filter((u) => !used.has(u) && (n < fees ? feeable(units[u]) : spendable(units[u])));
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
  /** Tale's End, Tidebinder: activated and/or triggered abilities on the stack may be chosen. */
  abilityKinds?: ('activated' | 'triggered')[];
  /** March of Otherworldly Light: "with mana value X or less": X as the spell was cast. */
  maxManaValueX?: boolean;
  /** Solitude, Phelia: "other target …": not the ability's source. */
  other?: boolean;
  /** Only abilities, no spell ("target activated or triggered ability"). */
  noSpells?: boolean;
  /** Stern Scolding: "with power or toughness 2 or less". */
  maxPowerOrToughness?: number;
  /** Wash Away: "that wasn't cast from its owner's hand". */
  notCastFromHand?: boolean;
  /** Turn Aside: "spell that targets a permanent you control". */
  targetsYourPermanent?: boolean;
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
  /** Hope of Ghirapur: "player who was dealt combat damage by <its source> this turn". */
  dealtCombatDamageBySource?: boolean;
  /** Legendary only (Mjölnir's "worthy": a legendary non-Villain that's red and/or white). */
  legendary?: boolean;
  /** Snow only (On Thin Ice: "Enchant snow land you control"). */
  snow?: boolean;
  /** None of these subtypes, lower case ("non-Villain"). */
  nonSubtypes?: string[];
  /** At least one of these subtypes ("Forest or Plains card"), lower case. */
  subtypes?: string[];
  /** Swift Reconfiguration: "creature or Vehicle": one of `types`, or one of these subtypes instead. */
  orSubtypes?: string[];
  /** "creature token" (true), "nontoken creature" (false). */
  token?: boolean;
  /** Vedalken Shackles: "with power less than or equal to the number of Islands you control". */
  maxPowerIslands?: boolean;
  /** "colorless" (Glaring Fleshraker). */
  colorless?: boolean;
  /** Aurora Eidolon: "a multicolored spell" (two colors or more). */
  multicolored?: boolean;
}

/**
 * What a target slot accepts. "any" is a creature, planeswalker or player; "permanent" is any
 * permanent matching the filter's types; "card" is a card in a graveyard (whose owner is
 * `filter.controller`: "your graveyard" / "an opponent's graveyard").
 */
export type TargetKind = 'any' | 'creature' | 'player' | 'spell' | 'permanent' | 'card' | 'spellOrPermanent';

export interface TargetSpec {
  kind: TargetKind;
  /** "up to two target creatures": min 0, max 2. */
  min: number;
  max: number;
  filter: TargetFilter;
}

// ---------- Effects ----------

/** Counter kinds placed on permanents. */
export type CounterKind = '+1/+1' | '-1/-1' | '-0/-1' | 'wish' | 'loyalty' | 'lore' | 'rev' | 'luck' | 'mining' | 'depletion' | 'charge' | 'age' | 'fade' | 'chorus'
  // Stun (Snaremaster Sprite): it doesn't untap, a counter is removed instead. Finality (Zoraline): exiled if it would die.
  | 'stun' | 'finality' | 'time'
  // Keyword counters (Ghost Vacuum's flying, Leatherhead's hexproof): the permanent has that keyword.
  | 'flying' | 'hexproof' | 'indestructible' | 'lifelink' | 'trample' | 'deathtouch' | 'menace' | 'reach' | 'vigilance' | 'first strike';

/**
 * Who an effect applies to: the targets chosen for a slot, the controller, everyone / each opponent,
 * or the ability's own source ("this creature gets +1/+1").
 */
/** `defending`: "defending player" in an attack trigger (Restless Fortress). */
/** `equipped`: Adventuring Gear's "equipped creature" (the creature its source is attached to). */
export type Affected = { slot: number } | 'you' | 'each-opponent' | 'each-player' | 'self' | 'defending' | 'equipped';

/** A number in rules text; "X" is the value chosen when casting. */
/** A number, X (paid when cast), or the life its controller gained this turn (Germinate Recruits). */
/** `sacrificed`: Obsessive Pursuit's "the number of permanents you've sacrificed this turn". */
/** `exiledMv`: Phyrexian Devourer's "where X is the exiled card's mana value" (the card exiled to pay the cost). */
/** `opponentsLostLife`: Kaito's "for each opponent who lost life this turn". */
export type Amount = number | 'X' | 'lifeGained' | 'sacrificed' | 'exiledMv' | 'opponentsLostLife';

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
  /**
   * `dest`: Memory Lapse (top of the library), Remand (hand), Force of Negation (exile) instead of the graveyard;
   * `stripsSource`: Tishana's Tidebinder (the countered ability's permanent loses all abilities while it stays).
   */
  | { kind: 'counter'; to: Affected; unlessPays?: number; unlessPaysLife?: number; dest?: 'top' | 'hand' | 'exile'; stripsSource?: boolean }
  /** Swords to Plowshares, Solitude: "Its controller gains life equal to its power." (the permanent removed in `of`). */
  | { kind: 'controllerGainsPower'; of: { slot: number } }
  /** Gitaxian Probe: "Look at target player's hand." (its cards are written in the log). */
  | { kind: 'lookAtHand'; to: Affected }
  /** Cryptic Command: "Tap all creatures your opponents control." */
  | { kind: 'tapAll'; which: Selector }
  // Mother of Runes, Reverent Mantra: protection from a color chosen as it resolves, until end of turn.
  | { kind: 'gainProtection'; to: Affected }
  | { kind: 'gainProtectionAll'; which: Selector }
  /** Subtlety: "Its owner puts it on their choice of the top or bottom of their library." */
  | { kind: 'tuckSpell'; to: Affected }
  /** "gets +N/+N (and gains …) until end of turn". Negative values shrink. */
  /** `ifSacrificed`: Obsessive Pursuit, "If X is three or more" (permanents sacrificed this turn). */
  /**
   * `plusX`: Tyvar's Stand's "+X/+X" (X paid; `power`/`toughness` are 0). `instead`: Groundswell's "If you had a land
   * enter the battlefield under your control this turn" and Might of Old Krosa's "If you cast this spell during your
   * main phase", it gets that much instead.
   */
  | { kind: 'pump'; power: number; toughness: number; keywords: Keyword[]; to: Affected; ifSacrificed?: number; plusX?: boolean; instead?: { power: number; toughness: number; if: 'landfall' | 'castInMain' } }
  /** Hapatra's Mark: "Remove all -1/-1 counters from it." */
  | { kind: 'removeAllCounters'; counter: CounterKind; to: Affected }
  /** Mossborn Hydra: "double the number of +1/+1 counters on this creature". */
  | { kind: 'doubleCounters'; to: Affected }
  /** Bristly Bill: "Double the number of +1/+1 counters on each creature you control." */
  | { kind: 'doubleCountersAll'; which: Selector }
  /** Tifa Lockhart: "double Tifa Lockhart's power until end of turn". */
  /** Tifa Lockhart: "double Tifa Lockhart's power until end of turn"; Berserk: "gains trample and gets +X/+0 …, where X is its power". */
  | { kind: 'doublePower'; to: Affected; keywords?: Keyword[] }
  /** Berserk: "At the beginning of the next end step, destroy that creature if it attacked this turn." */
  | { kind: 'destroyAtEnd'; to: Affected; ifAttacked: boolean }
  /** Embiggen: "+1/+1 for each supertype, card type, and subtype it has" until end of turn. */
  | { kind: 'embiggen'; to: Affected }
  /**
   * Bounty of the Hunt: "Distribute three +1/+1 counters among one, two, or three target creatures. For each +1/+1
   * counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next
   * cleanup step." (the targets are slot 0)
   */
  | { kind: 'distributeCounters'; n: number; untilCleanup: boolean }
  /**
   * Until end of turn, a creature "becomes a green Wurm with base power and toughness 6/4" (Scale Up), "has that base
   * power and toughness, becomes that creature type, and gains that ability" (Wild Shape), gains keywords and an
   * ability (Legolas's Quick Reflexes: `text`). `subtypes` replace its creature types; `colors` its colors.
   */
  | { kind: 'reshape'; to: Affected; power?: number; toughness?: number; subtypes?: string[]; colors?: Color[]; keywords: Keyword[]; text?: string }
  /** Scale Up's overload: "each creature you control" instead of the target. */
  | { kind: 'reshapeAll'; which: Selector; power?: number; toughness?: number; subtypes?: string[]; colors?: Color[]; keywords: Keyword[] }
  /** Legolas's granted trigger: "it deals damage equal to its power to up to one target creature" (it: the source). */
  | { kind: 'selfBite'; to: Affected }
  /** Royal Treatment: "Create a Royal Role token attached to that creature." */
  | { kind: 'role'; role: string; to: Affected }
  /**
   * Hope of Ghirapur: "Until your next turn, target player who was dealt combat damage by Hope of Ghirapur this turn
   * can't cast noncreature spells."
   */
  | { kind: 'noNoncreatureSpells'; to: Affected }
  /** Talon Gates of Madara: "up to one target creature phases out" (until its controller's next untap step). */
  | { kind: 'phaseOut'; to: Affected }
  /** Talon Gates of Madara: "{4}: Put this card from your hand onto the battlefield." */
  | { kind: 'putSelfFromHand' }
  /** Ninjutsu: the Ninja from the hand onto the battlefield tapped and attacking (`attacking`: a planeswalker attacked). */
  | { kind: 'ninjutsuEnter'; attacking?: string }
  /** Jeweled Amulet: "Put a charge counter on this artifact. Note the type of mana spent to pay this activation cost." */
  | { kind: 'chargeAmulet' }
  /**
   * Necropotence: "Exile the top card of your library face down. Put that card into your hand at the beginning of your
   * next end step."
   */
  | { kind: 'exileTopUntilEndStep' }
  /** Relic of Progenitus: "Target player exiles a card from their graveyard." (their choice) */
  | { kind: 'exileOwnGraveCard'; to: Affected }

  /** Moonshadow: "remove a -1/-1 counter from this creature". */
  | { kind: 'removeCounterSelf'; counter: CounterKind }
  /** Screaming Nemesis: "they can't gain life for the rest of the game" (a player hit). */
  | { kind: 'noLifeGain'; to: Affected }
  /** Fear of Missing Out: "After this phase, there is an additional combat phase." */
  | { kind: 'extraCombat' }
  /** Tamiyo: "exile Tamiyo, then return her to the battlefield transformed under her owner's control". */
  | { kind: 'flickerTransformed' }
  /** Shifting Woodland: "This land becomes a copy of target permanent card in your graveyard until end of turn." */
  | { kind: 'becomeCopy'; to: Affected }
  /**
   * Scythecat Cub: "put a +1/+1 counter on target creature you control. If this is the second time this ability has
   * resolved this turn, double the number of +1/+1 counters on that creature instead."
   */
  | { kind: 'counterOrDouble'; to: Affected }
  /** Escape Tunnel: "Target creature … can't be blocked this turn." */
  | { kind: 'unblockable'; to: Affected }
  /** Command Beacon: "Put your commander into your hand from the command zone." */
  | { kind: 'commanderToHand' }
  /**
   * Fabled Passage: "Then if you control four or more lands, untap that land." (`lands`); Elven Passage: "You may behold
   * an Elf. If you do, untap that land." (`behold`). The land the search just put onto the battlefield.
   */
  | { kind: 'untapFound'; lands?: number; behold?: string }
  /** Green Sun's Zenith: "Shuffle Green Sun's Zenith into its owner's library." (instead of its graveyard) */
  | { kind: 'shuffleSelfIntoLibrary' }
  /** `untilLeaves`: exiled until the ability's source leaves the battlefield (Seam Rip). */
  /** `ifArtifacts`: Dispatch's metalcraft, "If you control three or more artifacts, exile that creature." */
  | { kind: 'destroy'; exile: boolean; to: Affected; untilLeaves?: boolean; ifArtifacts?: number }
  | { kind: 'draw'; n: Amount; to: Affected }
  | { kind: 'gainLife'; n: Amount; to: Affected }
  | { kind: 'loseLife'; n: Amount; to: Affected }
  | { kind: 'addCounters'; counter: CounterKind; n: Amount; to: Affected }
  /** `filter` limits what the spell's controller may pick ("a nonland card") with casterChooses. */
  /** `unlessFilter`: Tezzeret, Betrayer of Flesh: "discard two cards unless you discard an artifact card" (one such card instead). */
  | { kind: 'discard'; n: Amount; to: Affected; mode: DiscardMode; filter?: TargetFilter; unlessFilter?: TargetFilter }
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
  /** `forTargetController`: Get Lost's "Its controller creates two Map tokens" (the target's controller gets them). */
  | { kind: 'token'; n: Amount; token: TokenSpec; attacking?: boolean; sacrificeAtEnd?: boolean; forTargetController?: { slot: number } }
  // Map tokens: "Target creature you control explores." (a land on top goes to the hand; otherwise a +1/+1 counter, and
  // the card may go to the graveyard).
  | { kind: 'explore'; to: Affected }
  /** A card in a graveyard goes to its owner's hand, or onto the battlefield under the controller's control. */
  // Pre-War Formalwear: "… to the battlefield and attach this Equipment to it".
  | { kind: 'returnCard'; to: Affected; dest: 'hand' | 'battlefield'; attachSource?: true; finality?: true }
  // Snapcaster Mage: "gains flashback until end of turn. The flashback cost is equal to its mana cost."
  | { kind: 'grantFlashback'; to: Affected }
  // Phelia: exiled, back under its owner's control at the next end step (and a +1/+1 counter on the source if it's yours).
  | { kind: 'flickerAtEnd'; to: Affected; counterIfYours: boolean }
  /** "Put a +1/+1 counter on each creature you control" (`other`: except the source). */
  | { kind: 'addCountersAll'; counter: CounterKind; n: Amount; which: Selector; other: boolean }
  /** Mana into the controller's pool (rituals: "Add {B}{B}{B}"). One entry per mana, with its possible colors. */
  /** `untilEndOfTurn`: Birgi's "Until end of turn, you don't lose this mana as steps and phases end." */
  | { kind: 'addMana'; units: Color[][]; untilEndOfTurn?: boolean }
  /** Biomancer's Familiar: "The next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it." */
  | { kind: 'adaptFresh'; to: Affected }
  /** Search your library for up to `n` matching cards, then shuffle. */
  /** `searcher`: the controller of the permanent in that target slot searches instead of you (Path to Exile, Boseiju). */
  /** `top`: Enlightened Tutor's "then shuffle and put that card on top". */
  | { kind: 'search'; n: number; filter: TargetFilter; dest: 'hand' | 'battlefield' | 'top'; tapped: boolean; searcher?: { slot: number } }
  /** Ponder: "Look at the top three cards of your library, then put them back in any order." */
  | { kind: 'reorderTop'; n: number }
  /** Ponder: "You may shuffle." */
  | { kind: 'mayShuffle' }
  /** Brainstorm: "put two cards from your hand on top of your library in any order". */
  | { kind: 'putBack'; n: number }
  /** Stoneforge Mystic: "put an Equipment card from your hand onto the battlefield" (or none). */
  | { kind: 'putFromHand'; filter: TargetFilter }
  /** Equip: attach the ability's source to the target. */
  | { kind: 'attach'; to: Affected }
  /** Cori-Steel Cutter: "You may attach this Equipment to it." (the token just created; asked when already attached) */
  | { kind: 'attachToToken' }
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
  /** Fading: remove a fade counter from it; if you can't, sacrifice it. */
  | { kind: 'fade' }
  /** Vanishing: a time counter removed; sacrificed when the last one is. */
  | { kind: 'vanish' }
  /** Sneaky Snacker: this card, if still in its owner's graveyard, onto the battlefield (`tapped`). */
  | { kind: 'returnFromOwnGraveyard'; tapped: boolean; toHand?: boolean }
  /** "Recruit": draw a card, then discard a card; a nonland card discarded makes a 1/1 white Human Soldier. */
  | { kind: 'recruit' }
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
  /** `n`: a number, or the lands you control (Consult the Star Charts). */
  /** `spellsTake`: Flow State takes that many with an instant card and a sorcery card in your graveyard. */
  | { kind: 'dig'; n: number | 'lands'; take: number; optional: boolean; filter?: TargetFilter; spellsTake?: number; rest?: 'graveyard' }
  /**
   * "Exile the top three cards of your library. You may play those cards this turn." Glimpse the Impossible
   * (`spawnAtEnd`): at the next end step, those still exiled go to the graveyard, an Eldrazi Spawn for each.
   */
  | { kind: 'impulse'; n: number; spawnAtEnd?: boolean; untilYourEndStep?: boolean }
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
    /** Tezzeret, Betrayer of Flesh's −2: for good, not until end of turn. */
    permanent?: boolean;
    /** Its power and toughness are base ones (layer 7b), a creature's too; not for a Vehicle ("If it isn't a Vehicle"). */
    baseUnlessVehicle?: boolean;
  }
  /** Chandra's −7: "You get an emblem with \"…\"" (the emblem's ability). */
  | { kind: 'emblem'; text: string }
  /**
   * A reflexive trigger: "you may discard a card. When you do, …" (Inti), "you may pay {W}{B} and 2 life. When you
   * do, …" (Zoraline). Paid as it resolves; then `then` triggers, its targets chosen at that time.
   */
  /**
   * Other costs: Ruthless Lawbringer's "you may sacrifice another creature" (`sacrifice`), Leatherhead's "you may remove a
   * counter from her" (`removeCounter`).
   */
  | { kind: 'reflexive'; cost: { discard?: number; mana?: string; life?: number; sacrifice?: { which: Selector; another: boolean }; removeCounter?: boolean }; then: AbilitySpec }
  /**
   * Seasoned Cryomancer: "When you discard one or more nonland cards this way, tap up to that many target creatures …"
   * A reflexive trigger after the discard, its target count (`upToThatMany`) the number of nonland cards discarded.
   */
  | { kind: 'whenDiscardedNonland'; upToThatMany: boolean; then: AbilitySpec }
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
  /** `whileSourceTapped`: Vedalken Shackles, "for as long as this artifact remains tapped". */
  | { kind: 'gainControl'; to: Affected; untilEndOfTurn: boolean; untapHaste?: boolean; whileSourceTapped?: boolean }
  /** Wishclaw Talisman: "An opponent gains control of this artifact." */
  | { kind: 'opponentGainsSource' }
  /** Seasoned Hallowblade aside: Sewer-veillance Cam's "tap or untap target creature" (untapped: tapped; tapped: untapped). */
  | { kind: 'toggleTap'; to: Affected }
  /** "Adapt 1": N +1/+1 counters on this creature if it has none. */
  | { kind: 'adapt'; n: number }
  /** Tezzeret the Seeker's −5: "Artifacts you control become artifact creatures with base power and toughness 5/5 until end of turn." */
  | { kind: 'animateAll'; which: Selector; power: number; toughness: number }
  /** Copy a spell on the stack (same targets). */
  | { kind: 'copySpell'; to: Affected }
  /** "Create a token that's a copy of target creature". */
  | { kind: 'tokenCopy'; to: Affected }
  // Ocelot Pride: "Then if you have the city's blessing, for each token you control that entered this turn,
  // create a token that's a copy of it."
  | { kind: 'copyNewTokens' }
  // Ghost Vacuum: "Put each creature card exiled with this artifact onto the battlefield under your control with a flying
  // counter on it. Each of them is a 1/1 Spirit in addition to its other types."
  | { kind: 'returnExiledSpirits' }
  // Aang: "airbend up to one other target creature or spell" (exiled; its owner may cast it for {2}).
  | { kind: 'airbend'; to: Affected }
  // Aven Interrupter: "exile target spell. It becomes plotted." (castable for free as a sorcery on a later turn).
  | { kind: 'plot'; to: Affected }
  // Malcolm: "If there are four or more chorus counters on Malcolm, you may cast the discarded card without paying its mana cost."
  | { kind: 'castDiscarded'; minCounters: number; counter: CounterKind }
  // "Transform Aang.": the permanent turns to its other face.
  | { kind: 'transform' }
  // Overlord of the Balemurk: "you may return a non-Avatar creature card or a planeswalker card from your graveyard to
  // your hand" (chosen as it resolves: not a target). A card matching any of the filters.
  | { kind: 'returnFromGraveyard'; filters: TargetFilter[]; optional: boolean }
  // All Aboard: "Exile target non-Pilot creature you control, then return that card to the battlefield under its owner's control."
  | { kind: 'flicker'; to: Affected }
  // Multiply by Zero: "Target creature has base power and toughness 0/0 until end of turn." (layer 7b)
  | { kind: 'setBasePT'; to: Affected; power: number; toughness: number }
  // Day of Black Sun: "Each creature with mana value X or less loses all abilities until end of turn. Destroy those
  // creatures." (layer 6, then destroyed: an indestructible one stays, without its abilities this turn)
  | { kind: 'loseAbilitiesDestroy'; maxManaValue: Amount }
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
/** Role tokens (Auras): what each one gives the creature it enchants. */
export const ROLES: Record<string, string> = {
  royal: 'Enchanted creature gets +1/+1 and has ward {1}.',
  monster: 'Enchanted creature gets +1/+1 and has trample.',
};

export const PREDEFINED_TOKENS: Record<string, TokenSpec> = {
  treasure: { name: 'Treasure', typeLine: 'Token Artifact — Treasure', colors: [], keywords: [], oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.' },
  clue: { name: 'Clue', typeLine: 'Token Artifact — Clue', colors: [], keywords: [], oracleText: '{2}, Sacrifice this artifact: Draw a card.' },
  food: { name: 'Food', typeLine: 'Token Artifact — Food', colors: [], keywords: [], oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.' },
  lander: { name: 'Lander', typeLine: 'Token Artifact — Lander', colors: [], keywords: [], oracleText: '{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' },
  map: { name: 'Map', typeLine: 'Token Artifact — Map', colors: [], keywords: [], oracleText: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.' },
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
  /** `delirium`: Fear of Missing Out's "if there are four or more card types among cards in your graveyard". */
  /** `notEscaped`: Phlage, Uro: "sacrifice it unless it escaped". `noAttack`: Curious Obsession's "if you didn't attack with a creature this turn". */
  condition?: { gained?: number; lost?: boolean; tapped?: boolean; cast?: boolean; delirium?: boolean; notEscaped?: boolean; noAttack?: boolean };
  /** A Saga's chapter ability: its Saga isn't sacrificed while it waits or is on the stack. */
  chapter?: number;
  /**
   * Crown, Scepter and Throne of Empires: "… instead if you control artifacts named Scepter of Empires and Throne of
   * Empires": these effects replace `effects` when its controller does as it resolves.
   */
  insteadIfNamed?: { names: string[]; effects: Effect[] };
  /**
   * A modal trigger: its modes, chosen as it goes on the stack. A mode with no effects isn't understood and can't be
   * chosen.
   */
  modal?: { min: number; max: number; texts: string[]; specs: AbilitySpec[]; fresh?: boolean };
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

/** "Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws." */
const OUTLAWS = ['assassin', 'mercenary', 'pirate', 'rogue', 'warlock'];

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
  const head = text.match(new RegExp(`^(?:(up to) (${NUMBER}) |(${NUMBER}) )?(other )?targets? (.+)$`));
  if (!head) return null;
  const count = toNumber(head[2] ?? head[3] ?? '1');
  const [min, max] = head[1] ? [0, count] : [count, count];
  text = head[5];
  // Solitude: "up to one other target creature": not the ability's own source.
  const filter: TargetFilter = head[4] ? { other: true } : {};

  // "target creature card from your graveyard", "target card from a graveyard"
  // Faerie Macabre: "up to two target cards from graveyards".
  const grave = text.match(/^(.*?)\bcards? (with [a-z0-9 ]+ )?(?:from|in) (your|a|an opponent's) graveyard$/)
    ?? text.match(/^(.*?)\bcards? (with [a-z0-9 ]+ )?(?:from|in) (graveyards)$/);
  if (grave) {
    if (grave[3] !== 'a' && grave[3] !== 'graveyards') filter.controller = grave[3] === 'your' ? 'you' : 'opponent';
    const words = grave[1].trim();
    // "permanent card": not an instant or sorcery ("nonland permanent card": not a land either).
    const permanent = /(?:^|\s)permanent$/.test(words);
    const rest = permanent ? words.replace(/\s*permanent$/, '') : words;
    const base = rest === '' ? {} : cardWordsFilter(rest);
    const kinds = base && permanent ? { ...base, nonTypes: [...(base.nonTypes ?? []), 'instant', 'sorcery'] as CardType[] } : base;
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
    // Turn Aside: "spell that targets a permanent you control" (before "you control": it's not the spell's controller).
    [/ that targets a permanent you control$/, () => !!(filter.targetsYourPermanent = true)],
    // Vedalken Shackles: "with power less than or equal to the number of Islands you control".
    [/ with power less than or equal to the number of islands you control$/, () => !!(filter.maxPowerIslands = true)],
    [/ you control$/, () => !!(filter.controller = 'you')],
    [/ (?:an opponent controls|you don't control|your opponents control)$/, () => !!(filter.controller = 'opponent')],
    [/ with mana value (\d+) or less$/, (m) => ((filter.maxManaValue = Number(m[1])), true)],
    // March of Otherworldly Light: "with mana value X or less" (X as cast).
    [/ with mana value x or less$/, () => !!(filter.maxManaValueX = true)],
    [/ with mana value (\d+) or greater$/, (m) => ((filter.minManaValue = Number(m[1])), true)],
    // Spell Snare: "with mana value 2".
    [/ with mana value (\d+)$/, (m) => ((filter.minManaValue = filter.maxManaValue = Number(m[1])), true)],
    // Terminal Criticism: "creature or planeswalker that's blue or red".
    [/ that's ((?:white|blue|black|red|green)(?:,? or (?:white|blue|black|red|green))*)$/, (m) => {
      filter.colors = m[1].split(/,? or /).map((w) => COLOR_WORDS[w]);
      return true;
    }],
    [/ with power or toughness (\d+) or less$/, (m) => ((filter.maxPowerOrToughness = Number(m[1])), true)],
    [/ that wasn't cast from its owner's hand$/, () => !!(filter.notCastFromHand = true)],
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
  // Abilities on the stack, maybe with spells: "target activated or triggered ability", "target instant spell, sorcery
  // spell, or triggered ability", "target activated ability, triggered ability, or legendary spell".
  const parts = text.split(/,? or |, /);
  if (parts.some((p) => /^(?:activated|triggered)(?: ability)?$/.test(p)) && parts.some((p) => / ability$/.test(p))) {
    for (const p of parts) {
      const ability = p.match(/^(activated|triggered)(?: ability)?$/);
      const spell = p.match(/^(?:([a-z]+) )?spell$/);
      if (ability) (filter.abilityKinds ??= []).push(ability[1] as 'activated' | 'triggered');
      else if (spell && !spell[1]) continue;
      else if (spell && spell[1] === 'legendary') filter.legendary = true;
      else if (spell && CARD_TYPES.includes(spell[1] as CardType)) (filter.types ??= []).push(spell[1] as CardType);
      else return null;
    }
    if (!parts.some((p) => /spell$/.test(p))) filter.noSpells = true;
    return { kind: 'spell', min, max, filter };
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
    else if (w === 'snow') filter.snow = true;
    // Okina: "target legendary creature".
    else if (w === 'legendary') filter.legendary = true;
    // Arbor Elf: "target Forest" (a permanent with that land type).
    else if (LAND_TYPES.includes(w) && phrase.includes(`${w[0].toUpperCase()}${w.slice(1)}`)) {
      (filter.subtypes ??= []).push(w);
      nouns.add('permanent');
    }
    // Glaring Fleshraker: "another colorless creature you control".
    else if (w === 'colorless') filter.colorless = true;
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
    // Shoot the Sheriff: "non-outlaw": none of the outlaw creature types.
    else if (w === 'non-outlaw') (filter.nonSubtypes ??= []).push(...OUTLAWS);
    // All Aboard: "non-Pilot creature" (a capitalized subtype; "outlaw" above is a group of types).
    else if (/^non-[a-z]+$/.test(w) && phrase.includes(`non-${w[4].toUpperCase()}${w.slice(5)}`)) (filter.nonSubtypes ??= []).push(w.slice(4));
    else return null;
  }
  if (!nouns.size) return null;
  // A type word in a list is a noun: "target instant or sorcery" (no "spell" word) isn't a permanent.
  if (adjectiveTypes.length && !nouns.has('spell')) {
    if (adjectiveTypes.some((t) => t === 'instant' || t === 'sorcery')) return null;
    for (const t of adjectiveTypes) nouns.add(t);
  }

  // Sink into Stupor: "target spell or nonland permanent an opponent controls"; Fatehold Charm: "target spell or
  // creature" (a bare "spell" in the list: any spell, or such a permanent; the type words are the permanent's).
  const listed = text.split(/,? or |, /);
  if (listed.includes('spell') && listed.length > 1 && listed.every((p) => p === 'spell' || !/\bspells?\b/.test(p))) {
    const kinds = [...nouns].filter((n) => n !== 'spell');
    if (!kinds.every((k) => k === 'permanent' || CARD_TYPES.includes(k as CardType)) || adjectiveTypes.length) return null;
    if (!kinds.includes('permanent')) filter.types = kinds as CardType[];
    return { kind: 'spellOrPermanent', min, max, filter };
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
  // "creature or Vehicle": a creature, or a permanent with that subtype.
  if (filter.subtypes && kinds.length > 1 && words.includes('|') && kinds.every((k) => k === 'permanent' || CARD_TYPES.includes(k as CardType))) {
    filter.orSubtypes = filter.subtypes;
    delete filter.subtypes;
    filter.types = kinds.filter((k) => k !== 'permanent') as CardType[];
    return { kind: 'permanent', min, max, filter };
  }
  if (kinds.length === 1 && kinds[0] === 'creature') return { kind: 'creature', min, max, filter };
  if (!kinds.includes('permanent')) filter.types = kinds as CardType[];
  return { kind: 'permanent', min, max, filter };
}

// "target …" up to a clause boundary; parsed by parseTargetPhrase.
const TARGET = `(?:any target|(?:up to ${NUMBER} )?(?:${NUMBER} )?(?:other )?targets? [a-z0-9 ,'-]+?)`;
/** Where a target phrase ends when nothing specific follows it. */
const END = '(?=\\.|\\n|$|,? then |,? and )';
const KEYWORD_LIST = `((?:${KEYWORDS.join('|')})(?:(?:,? and |, )(?:${KEYWORDS.join('|')}))*)`;

/** "nonland", "noncreature, nonland", "instant or sorcery" (card words in "choose a … card"). */
function cardWordsFilter(words: string): TargetFilter | null {
  const filter: TargetFilter = {};
  for (const w of words.toLowerCase().replace(/,? or |, /g, ' ').split(' ').filter(Boolean)) {
    if (w === 'multicolored') {
      filter.multicolored = true;
      continue;
    }
    // Solitary Cell: "Discard a legendary card".
    if (w === 'legendary') {
      filter.legendary = true;
      continue;
    }
    // Glaring Fleshraker: "Whenever you cast a colorless spell".
    if (w === 'colorless') {
      filter.colorless = true;
      continue;
    }
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
    // Green Sun's Zenith: "a green creature card".
    else if (COLOR_WORDS[w]) (filter.colors ??= []).push(COLOR_WORDS[w]);
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
/** `selfIt`: "it" may mean the source (not in a trigger about another object: Tifa's landfall names her). */
export function parseAbilityText(text: string, self?: string, selfIt = true): AbilitySpec {
  // Warping Wail: "Create a 1/1 colorless Eldrazi Scion creature token. It has \"Sacrifice this token: Add {C}.\"" is
  // read as "… token with \"…\"".
  text = text.replace(/(creature tokens?)\. (?:It has|They have) ("[^"]+")/g, '$1 with $2');
  // Tezzeret, Betrayer of Flesh's −2: "Target artifact becomes an artifact creature. If it isn't a Vehicle, it has base
  // power and toughness 4/4." (for good)
  const tezzeret = text.match(/^Target artifact becomes an artifact creature\. If it isn't a Vehicle, it has base power and toughness (\d+)\/(\d+)\.$/);
  if (tezzeret) {
    return {
      targets: [{ kind: 'permanent', min: 1, max: 1, filter: { types: ['artifact'] } }],
      effects: [{ kind: 'animate', to: { slot: 0 }, power: Number(tezzeret[1]), toughness: Number(tezzeret[2]), subtypes: [], keywords: [], artifact: true, permanent: true, baseUnlessVehicle: true }],
    };
  }
  // Tezzeret the Seeker's −5: "Artifacts you control become artifact creatures with base power and toughness 5/5 until
  // end of turn."
  const seeker = text.match(/^Artifacts you control become artifact creatures with base power and toughness (\d+)\/(\d+) until end of turn\.$/);
  if (seeker) {
    return { targets: [], effects: [{ kind: 'animateAll', which: { kind: 'permanent', filter: { types: ['artifact'], controller: 'you' } }, power: Number(seeker[1]), toughness: Number(seeker[2]) }] };
  }
  // Obsessive Pursuit: "put X +1/+1 counters on target attacking creature, where X is the number of permanents you've
  // sacrificed this turn. If X is three or more, that creature gains lifelink until end of turn."
  const pursuit = text.match(/^put X \+1\/\+1 counters on (target [a-z ]+?), where X is the number of permanents you've sacrificed this turn\. If X is (\w+) or more, that creature gains lifelink until end of turn\.$/i);
  const pursuitTarget = pursuit && parseTargetPhrase(pursuit[1]);
  if (pursuit && pursuitTarget) {
    return {
      targets: [pursuitTarget],
      effects: [
        { kind: 'addCounters', counter: '+1/+1', n: 'sacrificed', to: { slot: 0 } },
        { kind: 'pump', power: 0, toughness: 0, keywords: ['lifelink'], to: { slot: 0 }, ifSacrificed: toNumber(pursuit[2]) },
      ],
    };
  }
  // Tezzeret, Betrayer of Flesh: "Draw two cards. Then discard two cards unless you discard an artifact card."
  const unlessArtifact = text.match(/^(.+?\.) Then discard two cards unless you discard an artifact card\.$/);
  if (unlessArtifact) {
    const base = parseAbilityText(unlessArtifact[1], self);
    return base.effects.length && !base.targets.length
      ? { ...base, effects: [...base.effects, { kind: 'discard', n: 2, to: 'you', mode: 'choose', unlessFilter: { types: ['artifact'] } }] } : NO_EFFECT;
  }
  // Crown of Empires: "Tap target creature. Gain control of that creature instead if you control artifacts named Scepter
  // of Empires and Throne of Empires." Scepter: "It deals 3 damage instead …"; Throne: "Create five of those tokens instead …"
  const named = text.match(/^(.+?\.) ([^.]+?) instead if you control artifacts named ([^.]+?) and ([^.]+?)\.$/);
  if (named) {
    const base = parseAbilityText(named[1], self);
    const more = named[2];
    const damage = more.match(/^It deals (\d+) damage$/);
    const tokens = more.match(/^Create (one|two|three|four|five|six|seven|eight|nine|ten) of those tokens$/);
    const effects: Effect[] | null = damage && base.effects.length === 1 && base.effects[0].kind === 'damage' ? [{ ...base.effects[0], amount: Number(damage[1]) }]
      : tokens && base.effects.length === 1 && base.effects[0].kind === 'token' ? [{ ...base.effects[0], n: toNumber(tokens[1]) }]
      : /^Gain control of that creature$/.test(more) && base.targets.length === 1 && base.targets[0].kind === 'creature' ? [{ kind: 'gainControl', to: { slot: 0 }, untilEndOfTurn: false }]
      : null;
    return effects && base.effects.length ? { ...base, insteadIfNamed: { names: [named[3], named[4]], effects } } : NO_EFFECT;
  }
  // Dispatch: "Tap target creature.\nMetalcraft — If you control three or more artifacts, exile that creature."
  const metalcraft = text.match(/^([^]+?)\s*\nMetalcraft — If you control three or more artifacts, exile that creature\.$/);
  if (metalcraft) {
    const spec = parseAbilityText(metalcraft[1], self);
    const one = spec.targets.length === 1 && spec.targets[0].max === 1 && spec.effects.length > 0;
    return one ? { ...spec, effects: [...spec.effects, { kind: 'destroy', exile: true, to: { slot: 0 }, ifArtifacts: 3 }] } : NO_EFFECT;
  }
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
  // Memory Lapse, Remand, Force of Negation: "If that spell is countered this way, put it on top of its owner's library
  // / into its owner's hand / exile it instead of …"
  scan(new RegExp(`\\bcounter (${TARGET})\\. ${COUNTER_DEST.source}`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    const dest = /top of/i.test(m[2]) ? 'top' : /hand/i.test(m[2]) ? 'hand' : 'exile';
    return to && { kind: 'counter', to, dest };
  });
  // Tishana's Tidebinder: "counter up to one target activated or triggered ability. If an ability of an artifact,
  // creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature
  // remains on the battlefield."
  scan(new RegExp(`\\bcounter (${TARGET})\\. ${TIDEBINDER.source}`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'counter', to, stripsSource: true };
  });
  scan(new RegExp(`\\blook at (target player|target opponent)'s hand(?=\\.|$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'player');
    return to && { kind: 'lookAtHand', to };
  });
  scan(/\btap all ([a-z ,'-]+?)(?=\.|$)/gi, (m) => {
    const which = selector(m[1]);
    return which && { kind: 'tapAll', which };
  });
  // Subtlety: "choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the
  // top or bottom of their library."
  scan(new RegExp(`\\bchoose (${TARGET})\\. Its owner puts it on their choice of the top or bottom of their library(?=\\.|$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'tuckSpell', to };
  });
  // A comma inside a list of targets ("target instant spell, sorcery spell, or triggered ability") isn't its end.
  scan(new RegExp(`\\bcounter (${TARGET})(?:\\.(?! ${COUNTER_DEST.source.slice(0, 20)}| ${TIDEBINDER.source.slice(0, 20)})|,(?! (?:or )?(?:activated|triggered|[a-z]+ spell))| unless its controller pays \\{(\\d+)\\}\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'counter', to, ...(m[2] ? { unlessPays: Number(m[2]) } : {}) };
  });
  // Adventuring Gear: "equipped creature gets +2/+2 until end of turn."
  scan(/(?:^|[.,] *)equipped creature gets ([+-]\d+)\/([+-]\d+) until end of turn(?=\.)/gi, (m) => ({ kind: 'pump', power: Number(m[1]), toughness: Number(m[2]), keywords: [], to: 'equipped' }));
  // Bristly Bill: "Double the number of +1/+1 counters on each creature you control."
  scan(/(?:^|[.,] *)double the number of \+1\/\+1 counters on each creature you control(?=\.)/gi, () => ({ kind: 'doubleCountersAll', which: { kind: 'creature', filter: { controller: 'you' } } }));
  // Escape Tunnel: "Target creature with power 2 or less can't be blocked this turn."
  scan(new RegExp(`(${TARGET}) can't be blocked this turn(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'unblockable', to };
  });
  scan(/(?:^|[.] *)Put your commander into your hand from the command zone\./g, () => ({ kind: 'commanderToHand' }));
  scan(new RegExp(FABLED.source, 'g'), (m) => ({ kind: 'untapFound', lands: toNumber(m[1]) }));
  scan(new RegExp(BEHOLD.source, 'g'), (m) => ({ kind: 'untapFound', behold: m[1].toLowerCase() }));
  // Scythecat Cub (see the counterOrDouble effect).
  scan(new RegExp(SCYTHECAT.source, 'g'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'counterOrDouble', to };
  });
  // Berserk: "Target creature gains trample and gets +X/+0 until end of turn, where X is its power. At the beginning of the
  // next end step, destroy that creature if it attacked this turn."
  scan(new RegExp(BERSERK.source, 'g'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && [{ kind: 'doublePower', to, keywords: ['trample'] }, { kind: 'destroyAtEnd', to, ifAttacked: true }];
  });
  // Embiggen: "Until end of turn, target non-Brushwagg creature gets +1/+1 for each supertype, card type, and subtype it has."
  scan(/\bUntil end of turn, (target (?:non-[A-Z][a-z]+ )?creature) gets \+1\/\+1 for each supertype, card type, and subtype it has(?=\.)/g, (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'embiggen', to };
  });
  // Bounty of the Hunt (see the distributeCounters effect).
  scan(new RegExp(BOUNTY.source, 'g'), () => {
    targets.push({ kind: 'creature', min: 1, max: 3, filter: {} });
    return { kind: 'distributeCounters', n: 3, untilCleanup: true };
  });
  // Scale Up: "Until end of turn, target creature you control becomes a green Wurm with base power and toughness 6/4."
  // (overloaded: "each creature you control")
  scan(/\bUntil end of turn, (target creature you control|each creature you control) becomes an? (white|blue|black|red|green) ([A-Z][a-z]+) with base power and toughness (\d+)\/(\d+)(?=\.)/g, (m) => {
    const shape = { power: Number(m[4]), toughness: Number(m[5]), subtypes: [m[3]], colors: [COLOR_WORDS[m[2]]], keywords: [] as Keyword[] };
    if (m[1].startsWith('each')) return { kind: 'reshapeAll', which: { kind: 'creature', filter: { controller: 'you' } }, ...shape };
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'reshape', to, ...shape };
  });
  // Legolas's Quick Reflexes: "Until end of turn, it gains reach, hexproof, and \"Whenever this creature becomes tapped, …\""
  scan(/(?:^|[.] *)Until end of turn, (?:it|that creature) gains ((?:[a-z ]+, )*[a-z ]+), and "([^"]+)"(?=\.|$)/g, (m) => {
    const keywords = keywordList(m[1]);
    if (!keywords.every((k) => (KEYWORDS as readonly string[]).includes(k)) || !understoodAbilities(m[2])) return null;
    return targets.length ? { kind: 'reshape', to: { slot: targets.length - 1 }, keywords, text: m[2] } : null;
  });
  // Royal Treatment: "Create a Royal Role token attached to that creature."
  scan(/(?:^|[.] *)Create an? ([A-Z][a-z]+(?: [A-Z][a-z]+)?) Role token attached to (?:it|that creature)(?=\.)/g, (m) => {
    const role = m[1].toLowerCase();
    return ROLES[role] && targets.length ? { kind: 'role', role, to: { slot: targets.length - 1 } } : null;
  });
  // Hope of Ghirapur (see the noNoncreatureSpells effect).
  scan(/\bUntil your next turn, target player who was dealt combat damage by [^.]+? this turn can't cast noncreature spells(?=\.)/g, () => {
    targets.push({ kind: 'player', min: 1, max: 1, filter: { dealtCombatDamageBySource: true } });
    return { kind: 'noNoncreatureSpells', to: { slot: targets.length - 1 } };
  });
  // Talon Gates of Madara: "up to one target creature phases out."
  scan(new RegExp(`(${TARGET}) phases out(?=\\.)`, 'g'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'phaseOut', to };
  });
  scan(/(?:^|[.] *)Put this card from your hand onto the battlefield\./g, () => ({ kind: 'putSelfFromHand' }));
  // Shifting Woodland: "This land becomes a copy of target permanent card in your graveyard until end of turn."
  scan(new RegExp(`(?:^|[.] *)This (?:land|artifact|creature) becomes a copy of (${TARGET}) until end of turn(?=\\.)`, 'g'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'card');
    return to && { kind: 'becomeCopy', to };
  });
  scan(new RegExp(AMULET.source, 'g'), () => ({ kind: 'chargeAmulet' }));
  scan(new RegExp(NECRO.source, 'g'), () => ({ kind: 'exileTopUntilEndStep' }));
  scan(new RegExp(`(${TARGET}) exiles a card from their graveyard(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'player');
    return to && { kind: 'exileOwnGraveCard', to };
  });
  // Tyvar's Stand: "Target creature you control gets +X/+X and gains hexproof and indestructible until end of turn."
  scan(new RegExp(`(${TARGET}) gets \\+X\\/\\+X(?: and gains? ${KEYWORD_LIST})? until end of turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'pump', power: 0, toughness: 0, keywords: keywordList(m[2]), to, plusX: true };
  });
  // Vines of Vastwood: "Target creature can't be the target of spells or abilities your opponents control this turn." (hexproof)
  scan(new RegExp(`(${TARGET}) can't be the target of spells or abilities your opponents control this turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'pump', power: 0, toughness: 0, keywords: ['hexproof'], to };
  });
  // Hapatra's Mark: "Remove all -1/-1 counters from it."
  scan(/(?:^|[.] *)Remove all -1\/-1 counters from (?:it|that creature)\./g, () => {
    const to = targets.length ? { slot: targets.length - 1 } : null;
    return to && { kind: 'removeAllCounters', counter: '-1/-1', to };
  });
  // Bridgeworks Battle: "It fights up to one target creature you don't control."
  scan(new RegExp(`(?:^|[.] *)It fights (${TARGET})${END}`, 'g'), (m) => {
    const a = targets.length ? { slot: targets.length - 1 } : null;
    const b = a && slotFor(m[1], (spec) => spec.kind === 'creature');
    return a && b && typeof b === 'object' ? { kind: 'fight', a, b, oneSided: false } : null;
  });
  // Green Sun's Zenith: "Shuffle Green Sun's Zenith into its owner's library."
  scan(/(?:^|[.] *)Shuffle this spell into its owner's library\./g, () => ({ kind: 'shuffleSelfIntoLibrary' }));
  scan(new RegExp(`(${TARGET}) (?:each )?gets? ([+-]\\d+)\\/([+-]\\d+)(?: and gains? ${KEYWORD_LIST})? until end of turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'pump', power: Number(m[2]), toughness: Number(m[3]), keywords: keywordList(m[4]), to };
  });
  scan(new RegExp(`(${TARGET}) gains protection from the color of your choice until end of turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'gainProtection', to };
  });
  scan(/\bChoose a color\. ((?:all |other )?creatures(?: you control)?) gain protection from the chosen color until end of turn/gi, (m) => {
    const which = selector(m[1]);
    return which && { kind: 'gainProtectionAll', which };
  });
  // Tamiyo's Safekeeping: "Target permanent you control gains hexproof and indestructible until end of turn."
  scan(new RegExp(`(${TARGET}) gains? ${KEYWORD_LIST} until end of turn`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
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
  // Not Phelia's "exile … . At the beginning of the next end step, return that card" (flickerAtEnd).
  scan(new RegExp(`\\b(destroy|exile) (${TARGET})${END}(?!\\. At the beginning of the next end step, return that card|\\. It becomes plotted|, then return that card to the battlefield)`, 'gi'), (m) => {
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
  // Aang and La: "on each tapped creature you control".
  scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1) counters? on each ((?:other )?(?:tapped |untapped )?creature(?: you control| you don't control| your opponents control)?)${END}`, 'gi'), (m) => {
    const which = selector(m[3].replace(/\bcreature\b/i, 'creatures'));
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
  // Vedalken Shackles: "… for as long as this artifact remains tapped".
  scan(new RegExp(`\\bgain control of (${TARGET})( until end of turn| for as long as this artifact remains tapped)?(?=\\.|,| and |$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    const whileTapped = /remains tapped/.test(m[2] ?? '');
    return to && { kind: 'gainControl', to, untilEndOfTurn: !!m[2] && !whileTapped, ...(whileTapped ? { whileSourceTapped: true } : {}) };
  });
  scan(new RegExp(`\\bcopy (${TARGET})(?=\\.|,| and |$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'copySpell', to };
  });
  scan(new RegExp(`\\b[Cc]reate a token that's a copy of (${TARGET})(?=\\.|,| and |$)`, 'g'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'tokenCopy', to };
  });
  scan(new RegExp(`\\bexile (${TARGET}), then return that card to the battlefield under its owner's control(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'flicker', to };
  });
  scan(new RegExp(`(${TARGET}) has base power and toughness (\\d+)\\/(\\d+) until end of turn(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'setBasePT', to, power: Number(m[2]), toughness: Number(m[3]) };
  });
  scan(/\bEach creature with mana value (\d+|X) or less loses all abilities until end of turn\. Destroy those creatures(?=\.)/g, (m) => ({
    kind: 'loseAbilitiesDestroy', maxManaValue: toAmount(m[1]),
  }));
  scan(new RegExp(`\\bairbend (${TARGET})(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent' || spec.kind === 'spell' || spec.kind === 'spellOrPermanent');
    return to && { kind: 'airbend', to };
  });
  scan(new RegExp(`\\bexile (${TARGET})\\. It becomes plotted(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'spell');
    return to && { kind: 'plot', to };
  });
  scan(/\bput a chorus counter on it(?=\.)/gi, () => ({ kind: 'addCounters', counter: 'chorus', n: 1, to: 'self' }));
  scan(/\bIf there are (\w+) or more chorus counters on [^,]+, you may cast the discarded card without paying its mana cost(?=\.)/g, (m) => {
    const n = toNumber(m[1]);
    return n ? { kind: 'castDiscarded', minCounters: n, counter: 'chorus' } : null;
  });
  scan(/\b(?:then )?(you may )?return an? ([A-Za-z -]+?) card(?: or an? ([A-Za-z -]+?) card)? from your graveyard to your hand(?=\.)/g, (m) => {
    const filters = [m[2], m[3]].filter(Boolean).map((words) => {
      // "non-Avatar creature": a subtype excluded, then card words.
      const non = words.match(/^non-([A-Z][a-z]+) (.+)$/);
      const f = cardWordsFilter(non ? non[2] : words);
      return f && non ? { ...f, nonSubtypes: [non[1].toLowerCase()] } : f;
    });
    if (!filters.length || filters.some((f) => !f)) return null;
    return { kind: 'returnFromGraveyard', filters: filters as TargetFilter[], optional: !!m[1] };
  });
  scan(/\bPut each creature card exiled with this artifact onto the battlefield under your control with a flying counter on it\. Each of them is a 1\/1 Spirit in addition to its other types(?=\.)/g, () => ({ kind: 'returnExiledSpirits' }));
  scan(/\bThen if you have the city's blessing, for each token you control that entered (?:the battlefield )?this turn, create a token that's a copy of it(?=\.)/g, () => ({ kind: 'copyNewTokens' }));
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
  // Birgi: "add {R}. Until end of turn, you don't lose this mana as steps and phases end."
  scan(/(?:^|[.\n] *)[Aa]dd ((?:\{[WUBRGC]\})+)\. Until end of turn, you don't lose this mana as steps and phases end\./g, (m) => {
    const units = parseManaText(m[1]);
    return units && { kind: 'addMana', units, untilEndOfTurn: true };
  });
  // Biomancer's Familiar.
  scan(/\bThe next time (target creature) adapts this turn, it adapts as though it had no \+1\/\+1 counters on it\./g, (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'adaptFresh', to };
  });
  // Rituals: "Add {B}{B}{B}." (sentence start: mana abilities of permanents are handled as mana sources).
  scan(/(?:^|[.\n] *)Add ([^.]+)\./g, (m) => {
    const units = parseManaText(m[1]);
    return units && { kind: 'addMana', units };
  });
  // "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
  // Wishclaw Talisman, Demonic Tutor: "for a card" (any card).
  scan(new RegExp(`\\bsearch your library for (up to ${NUMBER} |an? |${NUMBER} )(?:([a-z ,-]+?) )?cards?(?: with mana value (\\d+|X) or less| with mana cost ((?:\\{\\d+\\})(?: or \\{\\d+\\})*))?, (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?)(?:,? (?:then|and) shuffle)?`, 'gi'), (m) => {
    const count = m[1].trim().replace(/^up to /i, '');
    const filter = m[2] ? librarySearchFilter(m[2]) : {};
    if (!filter) return null;
    // Tezzeret the Seeker: "with mana value X or less" (X as activated).
    if (m[3] === 'X') filter.maxManaValueX = true;
    else if (m[3]) filter.maxManaValue = Number(m[3]);
    // Urza's Saga: "an artifact card with mana cost {0} or {1}".
    if (m[4]) filter.manaCosts = m[4].split(' or ');
    return { kind: 'search', n: toNumber(count), filter, dest: m[5].toLowerCase() === 'into your hand' ? 'hand' : 'battlefield', tapped: !!m[6] };
  });
  // Enlightened Tutor: "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that
  // card on top."
  scan(/\bsearch your library for an? ([a-z ,-]+?) card, reveal it, then shuffle and put that card on top(?=\.|$)/gi, (m) => {
    const filter = librarySearchFilter(m[1]);
    return filter && { kind: 'search', n: 1, filter, dest: 'top', tapped: false };
  });
  // Ponder: "Look at the top three cards of your library, then put them back in any order. You may shuffle."
  scan(new RegExp(`\\blook at the top (${NUMBER}) cards of your library, then put them back in any order(?=\\.|$)`, 'gi'), (m) => ({ kind: 'reorderTop', n: toNumber(m[1]) }));
  scan(/(?:^|[.] *)You may shuffle(?=\.|$)/g, () => ({ kind: 'mayShuffle' }));
  // Brainstorm: "then put two cards from your hand on top of your library in any order".
  scan(new RegExp(`\\bput (${NUMBER}) cards from your hand on top of your library in any order(?=\\.|$)`, 'gi'), (m) => ({ kind: 'putBack', n: toNumber(m[1]) }));
  // Stoneforge Mystic: "put an Equipment card from your hand onto the battlefield".
  // Uro: "then you may put a land card from your hand onto the battlefield" (choosing none is the "may").
  scan(/\b(?:you may )?put an? ([A-Za-z ]+?) card from your hand onto the battlefield(?=\.|$)/g, (m) => {
    // Goblin Lackey: "a Goblin permanent card".
    const permanent = m[1].match(/^([A-Z][a-z]+) permanent$/);
    const filter = permanent ? { subtypes: [permanent[1].toLowerCase()], nonTypes: ['instant', 'sorcery'] as CardType[] } : revealFilter(m[1]);
    return filter && { kind: 'putFromHand', filter };
  });
  // Path to Exile: "Its controller may search their library for a basic land card, put it onto the battlefield tapped,
  // then shuffle."; Boseiju: "That player may search their library for a land card with a basic land type, …".
  // Dáin's Company: "Look at the top four cards of your library. You may reveal a Dwarf or Equipment card from among them
  // and put it into your hand. Put the rest on the bottom of your library in a random order."
  scan(/\bLook at the top (\w+) cards of your library\. You may reveal an? ([A-Za-z ]+?) card from among them and put it into your hand\. Put the rest on the bottom of your library in (?:a random|any) order\./gi, (m) => {
    const filter = revealFilter(m[2]);
    return filter && { kind: 'dig', n: toNumber(m[1]), take: 1, optional: true, filter };
  });
  // Malevolent Rumble: "Reveal the top four cards of your library. You may put a permanent card from among them into your
  // hand. Put the rest into your graveyard."
  scan(/\bReveal the top (\w+) cards of your library\. You may put an? ([a-z ]+?) card from among them into your hand\. Put the rest into your graveyard\./gi, (m) => {
    const filter = m[2] === 'permanent' ? { nonTypes: ['instant', 'sorcery'] as CardType[] } : cardWordsFilter(m[2]);
    return filter && { kind: 'dig', n: toNumber(m[1]), take: 1, optional: true, filter, rest: 'graveyard' };
  });
  // Exile the top cards, playable this turn (see IMPULSE).
  scan(new RegExp(IMPULSE.source, 'g'), (m) => ({ kind: 'impulse', n: m[1] ? toNumber(m[1]) : 1, ...(m[2] ? { spawnAtEnd: true } : {}) }));
  // Stock Up: "Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of
  // your library in any order."
  // Sleight of Hand: "Put one of them into your hand and the other on the bottom of your library."
  // Flow State: "If there is an instant card and a sorcery card in your graveyard, instead put two of them into your hand
  // and the rest on the bottom of your library in any order."
  scan(/\bLook at the top (\w+) cards of your library\. Put (one|two) of them into your hand and (?:the rest on the bottom of your library in (?:a random|any) order|the other on the bottom of your library)\.(?: If there is an instant card and a sorcery card in your graveyard, instead put (one|two) of them into your hand and the rest on the bottom of your library in (?:a random|any) order\.)?/gi, (m) => ({
    kind: 'dig', n: toNumber(m[1]), take: toNumber(m[2]), optional: false, ...(m[3] ? { spellsTake: toNumber(m[3]) } : {}),
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
    // Kaito's +1: "Ninjas you control get +1/+1." (a static ability)
    return triggersOf(emblem).some((t) => t.ability.effects.length) || staticsOf(emblem).length ? { kind: 'emblem', text: m[1] } : null;
  });
  // Chandra's +2: "You may sacrifice an artifact or discard a card. If you do, draw a card."
  scan(new RegExp(TRADE_FOR_CARD.source, 'g'), (m) => ({
    kind: 'tradeForCard', sacrifice: { kind: m[1] === 'creature' ? 'creature' : 'permanent', filter: { types: [m[1] as CardType], controller: 'you' } },
  }));
  // Get Lost: "Its controller creates two Map tokens."
  scan(/(?:^|[.] *)Its controller creates (\w+) Map tokens?(?=\.)/g, (m) => {
    const n = toNumber(m[1]);
    if (targets.length !== 1 || (targets[0].kind !== 'creature' && targets[0].kind !== 'permanent') || !n) return null;
    return { kind: 'token', n, token: PREDEFINED_TOKENS.map, forTargetController: { slot: 0 } };
  });
  scan(new RegExp(`(${TARGET}) explores(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature');
    return to && { kind: 'explore', to };
  });
  // Swords to Plowshares: "Exile target creature. Its controller gains life equal to its power."
  scan(new RegExp(`(?:^|[.] *)${POWER_LIFE.source}`, 'g'), () => {
    if (targets.length !== 1 || targets[0].kind !== 'creature') return null;
    return { kind: 'controllerGainsPower', of: { slot: 0 } };
  });
  scan(new RegExp(CONTROLLER_SEARCH.source, 'gi'), (m) => {
    if (targets.length !== 1 || (targets[0].kind !== 'creature' && targets[0].kind !== 'permanent')) return null;
    const filter: TargetFilter = /basic land type/i.test(m[1])
      ? { types: ['land'], subtypes: ['plains', 'island', 'swamp', 'mountain', 'forest'] }
      : { basic: true, types: ['land'] };
    return { kind: 'search', n: 1, filter, dest: 'battlefield', tapped: !!m[2], searcher: { slot: 0 } };
  });
  // Not Scythecat Cub's (see SCYTHECAT).
  scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1) counters? on (${TARGET})${END}(?!\\. If this is the second time this ability has resolved this turn)`, 'gi'), (m) => {
    const to = slotFor(m[3], (spec) => spec.kind === 'creature');
    return to && { kind: 'addCounters', counter: m[2] as CounterKind, n: toAmount(m[1]), to };
  });
  // Drawing: "Draw two cards", "Target player draws X cards", "Each player draws a card".
  scan(new RegExp(`(?:^|[^a-z])draw (${AMOUNT}) cards?\\b(?! and lose| for each opponent who lost life this turn)`, 'gi'), (m) => ({ kind: 'draw', n: toAmount(m[1]), to: 'you' }));
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
  // "Investigate" (Thraben Inspector): create a Clue token.
  // Sewer-veillance Cam: "tap or untap target creature" (whichever changes it).
  scan(new RegExp(`(?:^|[.,] *|then |and )(?:you )?tap or untap (${TARGET})${END}`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'toggleTap', to };
  });
  // Basking Broodscale: "Adapt 1." (If this creature has no +1/+1 counters on it, put that many on it.)
  scan(/(?:^|[.,] *|then )adapt (\d+)(?=\.|$)/gi, (m) => ({ kind: 'adapt', n: Number(m[1]) }));
  // Wishclaw Talisman: "An opponent gains control of this artifact."
  scan(/\bAn opponent gains control of this artifact(?=\.)/g, () => ({ kind: 'opponentGainsSource' }));
  // Cori-Steel Cutter: "create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it."
  scan(/(?<=token[^.]*\. )You may attach this Equipment to it(?=\.)/g, () => ({ kind: 'attachToToken' }));
  scan(/(?:^|[.,] *|then )investigate(?= *\.|$)/gi, () => ({ kind: 'token', n: 1, token: PREDEFINED_TOKENS.clue }));
  // "Then amass Orcs 1." (the type in the plural: Orcs, Zombies).
  scan(/(?:^|[.] *)(?:Then )?amass ([A-Z][a-z]+?)(?:e?s)? (\d+)(?=\.|$)/g, (m) => ({ kind: 'amass', subtype: m[1], n: Number(m[2]) }));
  scan(new RegExp(`\\bsurveil (\\d+|X)\\b(?!\\. ${SURVEIL_TO_HAND.source})`, 'gi'), (m) => ({ kind: 'surveil', n: toAmount(m[1]) }));
  scan(new RegExp(`\\bsurveil (\\d+|X)\\. ${SURVEIL_TO_HAND.source}`, 'gi'), (m) => ({ kind: 'surveil', n: toAmount(m[1]), toHand: 'mvAtMostLifeGained' }));
  // Tap / untap.
  scan(new RegExp(`(?:^|[.,] *|then |and )(tap|untap) (${TARGET})${END}`, 'gi'), (m) => {
    const to = slotFor(m[2], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'tap', untap: m[1].toLowerCase() === 'untap', to };
  });
  // Snaremaster Sprite: "tap target creature an opponent controls and put a stun counter on it".
  // Seasoned Cryomancer: "tap up to that many target creatures and put a stun counter on each of them".
  // Kaito's −2: "Put two stun counters on it."
  scan(/(?:^|[.,] *|then |and )put (an?|two|three) (stun|finality) counters? on (?:it|each of them)(?=\.)/gi, (m) => (targets.length === 1 ? { kind: 'addCounters', counter: m[2].toLowerCase() as CounterKind, n: /^an?$/i.test(m[1]) ? 1 : toNumber(m[1].toLowerCase()), to: { slot: 0 } } : null));
  // Kaito's 0: "Then draw a card for each opponent who lost life this turn."
  scan(new RegExp(LOST_LIFE_DRAW.source, 'g'), () => ({ kind: 'draw', n: 'opponentsLostLife', to: 'you' }));
  // Bounce.
  scan(new RegExp(`\\breturn (${TARGET}) to (?:its|their) (?:owner's|owners') hands?`, 'gi'), (m) => {
    // Reprieve: "Return target spell to its owner's hand"; Sink into Stupor: "target spell or nonland permanent".
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent' || spec.kind === 'spell' || spec.kind === 'spellOrPermanent');
    return to && { kind: 'bounce', to };
  });
  scan(new RegExp(`\\bexile (${TARGET})\\. At the beginning of the next end step, return that card to the battlefield under its owner's control(\\. If it entered under your control, put a \\+1\\/\\+1 counter on [^.]+)?(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'flickerAtEnd', to, counterIfYours: !!m[2] };
  });
  scan(new RegExp(`(${TARGET}) gains flashback until end of turn\\. The flashback cost is equal to its mana cost(?=\\.)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'card');
    return to && { kind: 'grantFlashback', to };
  });
  // From a graveyard: "Return target creature card from your graveyard to your hand / to the battlefield".
  // Zoraline: "… to the battlefield with a finality counter on it".
  scan(new RegExp(`\\breturn (${TARGET}) to (your hand|its owner's hand|the battlefield(?: under your control)?)( and attach this Equipment to it| with a finality counter on it)?(?=\\.|,| and |$)`, 'gi'), (m) => {
    const to = slotFor(m[1], (spec) => spec.kind === 'card');
    const dest = m[2].toLowerCase().includes('battlefield') ? 'battlefield' : 'hand';
    if (m[3] && dest !== 'battlefield') return null;
    const extra = !m[3] ? {} : /finality/.test(m[3]) ? { finality: true as const } : { attachSource: true as const };
    return to && { kind: 'returnCard', to, dest, ...extra };
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
    // Eldrazi Spawn: "with \"Sacrifice this token: Add {C}.\"" (a mana ability).
    // Defend the Rider's Pilot: "This token saddles Mounts and crews Vehicles as though its power were 2 greater."
    if (m[9] && !staticsOf(tokenCard(token)).length && !sacrificeMana(tokenCard(token)) && !crewBonus(tokenCard(token))) return null;
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
  scan(new RegExp(`\\bcreates? (${AMOUNT}) (Treasure|Clue|Food|Lander) tokens?`, 'gi'), (m) => ({
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
    const words = [...selfWords(self), ...(!selfIt || /\btargets?\b/i.test(text) ? [] : ['it'])].map(escapeRe).join('|');
    const SELF = `(?:${words})`;
    scan(new RegExp(`(?:^|\\. )Transform ${SELF}(?=\\.)`, 'g'), () => ({ kind: 'transform' }));
    // Triskelion: "Remove a +1/+1 counter from this creature: It deals 1 damage to any target." (an ability: "It" is its source)
    scan(new RegExp(`^It deals (\\\\d+) damage to (${TARGET})(?=\\\\.)`, 'g'), (m) => {
      if (!/^It deals \\d+ damage to [^.]+\\.$/.test(text)) return null;
      const to = slotFor(m[2]);
      return to && { kind: 'damage', amount: Number(m[1]), to };
    });
    // Legolas's Quick Reflexes' granted trigger: "it deals damage equal to its power to up to one target creature."
    scan(new RegExp(`(?:^|[.] *)(?:it|${selfWords(self).map(escapeRe).join('|')}) deals damage equal to its power to (${TARGET})(?=\\.)`, 'gi'), (m) => {
      const to = slotFor(m[1], (spec) => spec.kind === 'creature');
      return to && { kind: 'selfBite', to };
    });
    // Mossborn Hydra: "double the number of +1/+1 counters on this creature."
    scan(new RegExp(`(?:^|[.,] *)double the number of \\+1\\/\\+1 counters on ${SELF}(?=\\.)`, 'gi'), () => ({ kind: 'doubleCounters', to: 'self' }));
    // Tifa Lockhart: "double Tifa Lockhart's power until end of turn."
    scan(new RegExp(`(?:^|[.,] *)double ${SELF}'s power until end of turn(?=\\.)`, 'gi'), () => ({ kind: 'doublePower', to: 'self' }));
    scan(new RegExp(`(?:^|[.,] *|then |and )${SELF} gets ([+-]\\d+)\\/([+-]\\d+)(?: and gains ${KEYWORD_LIST})? until end of turn`, 'gi'), (m) => ({
      kind: 'pump', power: Number(m[1]), toughness: Number(m[2]), keywords: keywordList(m[3]), to: 'self',
    }));
    scan(new RegExp(`(?:^|[.,] *|then |and )${SELF} gains ${KEYWORD_LIST} until end of turn`, 'gi'), (m) => ({
      kind: 'pump', power: 0, toughness: 0, keywords: keywordList(m[1]), to: 'self',
    }));
    // Not Phelia's "If it entered under your control, put a +1/+1 counter on Phelia" (part of flickerAtEnd).
    scan(new RegExp(`(?<!If it entered under your control, )\\bput (${AMOUNT}) ([+-]1\\/[+-]1|loyalty|rev) counters? on ${SELF}(?=\\.|\\n|$|,)`, 'gi'), (m) => ({
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
    // Iron-Shield Elf: "This creature gains indestructible until end of turn. Tap it."
    scan(new RegExp(`(?<=^${SELF} gains [a-z ,]+ until end of turn\\. )Tap it(?=\\.|$)`, 'gi'), () => ({ kind: 'tap', untap: false, to: 'self' }));
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

/** Swords to Plowshares, Solitude: the removed creature's controller gains life equal to its power. */
const POWER_LIFE = /(?:Its|That creature's) controller gains life equal to its power(?=\.)/;

/** Memory Lapse, Remand, Force of Negation: where the countered spell goes instead. */
const COUNTER_DEST = /If that spell is countered this way, (put it on top of its owner's library|put it into its owner's hand|exile it) instead of (?:into that player's graveyard|putting it into its owner's graveyard)(?=\.)/;
/** Tishana's Tidebinder: the countered ability's permanent loses all abilities. */
/** Day of Black Sun: "Destroy those creatures" refers to the creatures that lost their abilities. */
const BLACK_SUN = /Each creature with mana value (?:\d+|X) or less loses all abilities until end of turn\. Destroy those creatures\./g;
/** All Aboard: exiled and back at once (flicker). */
const FLICKER = /, then return that card to the battlefield under its owner's control\./g;
/** Malcolm: the discarded card may be cast for free with four chorus counters (castDiscarded). */
const MALCOLM = /If there are (\w+) or more chorus counters on [^,]+, you may cast the discarded card without paying its mana cost\./g;
/** Ghost Vacuum: the creature cards it exiled come back as 1/1 Spirits with flying counters (returnExiledSpirits). */
const GHOST_VACUUM = /Put each creature card exiled with this artifact onto the battlefield under your control with a flying counter on it\. Each of them is a 1\/1 Spirit in addition to its other types\./g;
/** Ocelot Pride: copies of the tokens that entered this turn, with the city's blessing (copyNewTokens). */
const CITY_COPIES = /Then if you have the city's blessing, for each token you control that entered (?:the battlefield )?this turn, create a token that's a copy of it\./g;
/** Phelia: the exiled card comes back at the next end step (flickerAtEnd). */
const PHELIA = /At the beginning of the next end step, return that card to the battlefield under its owner's control(?:\. If it entered under your control, put a \+1\/\+1 counter on [^.]+)?\./gi;
const TIDEBINDER = /If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield(?=\.)/;

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

/** Survival of the Fittest: "Search your library for a creature card, reveal that card, put it into your hand". */
const REVEAL_FOUND = /\bsearch your library for [a-z ,-]+? card, reveal that card, (?=put it into your hand)/i;

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
/** A cost paid instead of the spell's mana cost. */
export type AltCost =
  /** Daze: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost." */
  | { kind: 'returnLand'; subtype: string }
  /**
   * Force of Negation ("If it's not your turn, …"), Reverent Mantra: "you may exile a blue card from your hand rather
   * than pay this spell's mana cost"; evoke ("Evoke—Exile a white card from your hand"): sacrificed when it enters.
   */
  | { kind: 'exileCard'; color: Color; notYourTurn?: boolean; evoke?: boolean }
  /** Cleave (the words in brackets removed), warp (exiled at the next end step), web-slinging (and a tapped creature you control returned). */
  /** Impending N: enters with N time counters, not a creature until the last is removed (one each end step). */
  | { kind: 'mana'; cost: string; name: 'cleave' | 'warp' | 'webSlinging' | 'impending' | 'overload'; counters?: number }
  /** Phyrexian mana ({U/P}): 2 life for each one instead of its mana. */
  | { kind: 'phyrexian'; n: number }
  /** Invigorate: "If you control a Forest, rather than pay this spell's mana cost, you may have an opponent gain 3 life." */
  | { kind: 'opponentGainsLife'; n: number; subtype: string }
  /**
   * Escape (cast from the graveyard): its mana (`cost`, or '' for the card's mana cost: Underworld Breach) and other
   * cards exiled from the graveyard: `exile` of them, or any number with `minTypes` card types among them (Nethergoyf).
   */
  | { kind: 'escape'; cost: string; exile: number; minTypes?: number }
  /**
   * Bestow (Detective's Phoenix: "Bestow—{R}, Collect evidence 6."): cast as an Aura on a creature; `evidence`: cards
   * with that total mana value exiled from the graveyard. `fromGraveyard`: "You may cast this card from your graveyard
   * using its bestow ability."
   */
  | { kind: 'bestow'; cost: string; evidence?: number; fromGraveyard?: boolean };

export interface CastInfo {
  /** Alternative costs ("rather than pay this spell's mana cost", evoke, cleave, warp, web-slinging, Phyrexian mana). */
  alts: AltCost[];
  /**
   * March of Otherworldly Light: "As an additional cost to cast this spell, you may exile any number of white cards from
   * your hand. This spell costs {2} less to cast for each card exiled this way."
   */
  exileDiscount?: { color: Color; per: number };
  /** "Choose one —" / "Choose one or both —": the modes' texts, and how many to choose. */
  /** `costs`: Spree and Tiered, each mode's additional cost (added to the mana cost for the modes chosen). */
  modal?: { min: number; max: number; modes: string[]; costs?: string[] };
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
  /** `keepsCard`: Talon Gates of Madara's "{4}: Put this card from your hand onto the battlefield." (not discarded). */
  channel?: { cost: string; ability: AbilitySpec; legendaryDiscount: boolean; keyword: boolean; keepsCard?: boolean };
  /** Ninjutsu {1}{U}{B}: "Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking." */
  ninjutsu?: string;
  /** Berserk: "Cast this spell only before the combat damage step." */
  beforeCombatDamage?: boolean;
  convoke: boolean;
  delve: boolean;
  /** "Affinity for artifacts": costs {1} less for each matching permanent you control. */
  affinity?: TargetFilter;
  /**
   * "This spell costs {1} less to cast for each instant and sorcery card in your graveyard" (Eddymurk Crab: `filter`),
   * "… for each card type among cards in your graveyard" (Emrakul, the Promised End: `types`).
   */
  /** `adventure`: Hearth Elemental's "instant cards, sorcery cards, and/or have an Adventure". */
  graveDiscount?: { filter: TargetFilter } | { types: true } | { adventure: true };
  /** Sunderflock: "{X} less, where X is the greatest mana value among Elementals you control". */
  greatestMvDiscount?: TargetFilter;
  /** Leyline Binding: "Domain — This spell costs {1} less to cast for each basic land type among lands you control." */
  domainDiscount?: boolean;
  /** Hollow One: "{2} less to cast for each card you've cycled or discarded this turn". */
  discardDiscount?: number;
  /** Obsidian Charmaw: "{1} less to cast for each land your opponents control that could produce {C}". */
  opponentLandsDiscount?: Color;
}

const MODE_COUNTS: Record<string, [number, number]> = {
  one: [1, 1], two: [2, 2], three: [3, 3], 'one or both': [1, 2], 'one or more': [1, 9], 'up to one': [0, 1], 'up to two': [0, 2],
};

/** Wild Shape: the sentence before its modes ("1/3 Turtle with hexproof."). */
const WILD_SHAPE = /Until end of turn, target creature you control has that base power and toughness, becomes that creature type, and gains that ability\./;

/** Removes reminder text: it never carries rules, and may say "Draw a card." (cycling). */
const stripReminder = (text: string) => text.replace(/\s*\([^)]*\)/g, '');

export function castInfo(card: Card, face = 0): CastInfo {
  const c = faceCard(card, face);
  const text = stripReminder(frontText(c));
  const info: CastInfo = { convoke: false, delve: false, alts: [] };
  const kw = (c.keywords ?? []).map((k) => k.toLowerCase());
  for (const line of text.split('\n').map((l) => l.trim())) {
    let m;
    if ((m = line.match(/^You may return an? (Plains|Island|Swamp|Mountain|Forest) you control to its owner's hand rather than pay this spell's mana cost\.$/i))) {
      info.alts.push({ kind: 'returnLand', subtype: m[1].toLowerCase() });
    } else if ((m = line.match(/^(If it's not your turn, )?you may exile an? (white|blue|black|red|green) card from your hand rather than pay this spell's mana cost\.$/i))) {
      info.alts.push({ kind: 'exileCard', color: COLOR_WORDS[m[2].toLowerCase()], ...(m[1] ? { notYourTurn: true } : {}) });
    } else if ((m = line.match(/^Bestow—((?:\{[^}]+\})+)(?:, Collect evidence (\d+))?\.?$/))) {
      info.alts.push({ kind: 'bestow', cost: m[1], ...(m[2] ? { evidence: Number(m[2]) } : {}), ...(/^You may cast this card from your graveyard using its bestow ability\.$/m.test(text) ? { fromGraveyard: true } : {}) });
    } else if ((m = line.match(/^Escape—((?:\{[^}]+\})+), Exile (any number of|\w+) other cards? from your graveyard(?: with (\w+) or more card types among them)?\.$/))) {
      // Nethergoyf: "Escape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them."
      const any = m[2] === 'any number of';
      if (!any || m[3]) info.alts.push({ kind: 'escape', cost: m[1], exile: any ? 0 : toNumber(m[2]), ...(m[3] ? { minTypes: toNumber(m[3]) } : {}) });
    } else if ((m = line.match(/^If you control an? (Plains|Island|Swamp|Mountain|Forest), rather than pay this spell's mana cost, you may have an opponent gain (\d+) life\.$/i))) {
      info.alts.push({ kind: 'opponentGainsLife', n: Number(m[2]), subtype: m[1].toLowerCase() });
    } else if ((m = line.match(/^Evoke—Exile an? (white|blue|black|red|green) card from your hand\.$/i))) {
      info.alts.push({ kind: 'exileCard', color: COLOR_WORDS[m[1].toLowerCase()], evoke: true });
    } else if ((m = line.match(/^(Cleave|Warp|Web-slinging|Overload) ((?:\{[^}]+\})+)$/))) {
      info.alts.push({ kind: 'mana', cost: m[2], name: m[1] === 'Cleave' ? 'cleave' : m[1] === 'Warp' ? 'warp' : m[1] === 'Overload' ? 'overload' : 'webSlinging' });
    } else if ((m = line.match(/^Impending (\d+)—((?:\{[^}]+\})+)$/))) {
      info.alts.push({ kind: 'mana', cost: m[2], name: 'impending', counters: Number(m[1]) });
    } else if ((m = line.match(/^Kicker ((?:\{[^}]+\})+)$/))) info.kicker = m[1];
    else if ((m = line.match(/^Flashback ((?:\{[^}]+\})+)$/))) info.flashback = m[1];
    else if ((m = line.match(/^Cycling ((?:\{[^}]+\})+)$/))) info.cycling = { cost: m[1] };
    else if ((m = line.match(/^(Basic land|[A-Z][a-z]+)cycling ((?:\{[^}]+\})+)$/))) {
      // Landcycling and other typecycling (Step Through's "Wizardcycling {2}": search for a Wizard card).
      info.cycling = { cost: m[2], search: m[1] === 'Basic land' ? { basic: true, types: ['land'] } : { subtypes: [m[1].toLowerCase()] } };
    } else if ((m = line.match(/^Ninjutsu ((?:\{[^}]+\})+)$/))) {
      info.ninjutsu = m[1];
    } else if (/^Cast this spell only before the combat damage step\.$/.test(line)) {
      info.beforeCombatDamage = true;
    } else if ((m = line.match(/^((?:\{[^}]+\})+): Put this card from your hand onto the battlefield\.$/))) {
      info.channel = { cost: m[1], ability: { targets: [], effects: [{ kind: 'putSelfFromHand' }] }, legendaryDiscount: false, keyword: false, keepsCard: true };
    } else if ((m = line.match(/^(?:Channel — )?((?:\{[^}]+\})+), Discard this card: (.+)$/) ?? line.match(/^()Discard this card: (.+)$/))) {
      // Faerie Macabre: "Discard this card: Exile up to two target cards from graveyards." (no mana)
      // Also Mjölnir's "{2}{R}, Discard this card: It deals 2 damage to each creature." (from the hand, like channel).
      const discount = / This ability costs \{1\} less to activate for each legendary creature you control\.$/;
      const body = m[2].replace(discount, '');
      info.channel = { cost: m[1], ability: UNSUPPORTED.test(body.replace(CONTROLLER_SEARCH, '')) ? NO_EFFECT : parseAbilityText(body, selfName(c)), legendaryDiscount: discount.test(m[2]), keyword: line.startsWith('Channel') };
    } else if (/^Affinity for artifacts$/i.test(line)) info.affinity = { types: ['artifact'] };
    else if (/^This spell costs \{1\} less to cast for each card type among cards in your graveyard\.$/i.test(line)) info.graveDiscount = { types: true };
    else if ((m = line.match(/^This spell costs \{1\} less to cast for each land your opponents control that could produce \{([WUBRGC])\}\.$/))) info.opponentLandsDiscount = m[1] as Color;
    else if (/^(?:Domain — )?This spell costs \{1\} less to cast for each basic land type among lands you control\.$/.test(line)) info.domainDiscount = true;
    else if ((m = line.match(/^This spell costs \{(\d+)\} less to cast for each card you've cycled or discarded this turn\.$/))) info.discardDiscount = Number(m[1]);
    else if (/^This spell costs \{X\} less to cast, where X is the number of cards in your graveyard that are instant cards, sorcery cards, and\/or have an Adventure\.$/i.test(line)) info.graveDiscount = { adventure: true };
    else if ((m = line.match(/^This spell costs \{X\} less to cast, where X is the greatest mana value among ([A-Z][a-z]+)s you control\.$/))) {
      info.greatestMvDiscount = { subtypes: [m[1].toLowerCase()] };
    }
    else if ((m = line.match(/^This spell costs \{1\} less to cast for each ([a-z ]+?) card in your graveyard\.$/i))) {
      const filter = cardWordsFilter(m[1].replace(/ and /g, ' or '));
      if (filter) info.graveDiscount = { filter };
    }
    else if (/^[A-Za-z ,]+$/.test(line) && line.split(/,\s*/).some((w) => /^(convoke|delve)$/i.test(w.trim()))) {
      for (const w of line.split(/,\s*/).map((x) => x.trim().toLowerCase())) {
        if (w === 'convoke') info.convoke = true;
        if (w === 'delve') info.delve = true;
      }
    }
  }
  // Phyrexian mana: each {U/P} may be paid with 2 life.
  const phyrexian = (c.manaCost.split('//')[0].match(/\{[WUBRG]\/P\}/g) ?? []).length;
  if (phyrexian) info.alts.push({ kind: 'phyrexian', n: phyrexian });
  if (kw.includes('convoke')) info.convoke = true;
  if (kw.includes('delve')) info.delve = true;
  // Spree: "+ {1}{U} — Counter target spell." (one or more); Tiered: "• Fira — {2} — …" (exactly one).
  const spree = /^Spree\b/m.test(text) ? [...text.matchAll(/^\+ ((?:\{[^}]+\})+) — (.+)$/gm)] : [];
  const tiered = /^Tiered\b/m.test(text) ? [...text.matchAll(/^• [^—\n]+ — ((?:\{[^}]+\})+) — (.+)$/gm)] : [];
  const modal = text.match(/Choose (one or both|one or more|up to one|up to two|one|two|three) —\n((?:• [^\n]+\n?)+)/)
    // Wild Shape: "Choose one. Until end of turn, target creature you control has that base power and toughness, …"
    ?? text.match(new RegExp(`^Choose (one)\\. ${WILD_SHAPE.source}\\n((?:• [^\\n]+\\n?)+)`, 'm'));
  if (spree.length || tiered.length) {
    const lines = spree.length ? spree : tiered;
    info.modal = { min: 1, max: spree.length ? lines.length : 1, modes: lines.map((m) => m[2].trim()), costs: lines.map((m) => m[1]) };
  } else if (modal) {
    const [min, max] = MODE_COUNTS[modal[1]];
    const modes = modal[2].split('\n').filter((l) => l.startsWith('• ')).map((l) => l.slice(2).trim());
    info.modal = { min, max: Math.min(max, modes.length), modes };
  }
  const march = text.match(/As an additional cost to cast this spell, you may exile any number of (white|blue|black|red|green) cards from your hand\. This spell costs \{(\d+)\} less to cast for each card exiled this way\./);
  if (march) info.exileDiscount = { color: COLOR_WORDS[march[1]], per: Number(march[2]) };
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
  // Wild Shape: a mode read with the spell's other text ("1/3 Turtle with hexproof.").
  return !!modal && (parseAbilityText(modal.modes[i] ?? '').effects.length > 0 || castSpec(card, { face, modes: [i] }).effects.length > 0);
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
  /** The alternative cost paid (an index in CastInfo.alts): cleave removes the words in brackets. */
  alt?: number;
  /** X paid (March of Otherworldly Light: "with mana value X or less"). */
  x?: number;
}

/**
 * The rules of a spell cast a given way. Auras target what they'll enchant; other permanents have no
 * spell effects. Modal spells need their modes; "If this spell was kicked, …" applies when kicked.
 */
function castSpecRaw(card: Card, choice: CastChoice): AbilitySpec {
  const c = faceCard(card, choice.face ?? 0);
  // Bestow: an Aura spell targeting a creature (no effects: it enters attached).
  if (choice.alt !== undefined && castInfo(card, choice.face ?? 0).alts[choice.alt]?.kind === 'bestow') {
    return { targets: [{ kind: 'creature', min: 1, max: 1, filter: {} }], effects: [] };
  }
  // Consult the Star Charts: "Look at the top X cards of your library, where X is the number of lands you control. Put
  // one of those cards into your hand. If this spell was kicked, put two of those cards into your hand instead. Put the
  // rest on the bottom of your library in a random order."
  if (/^Look at the top X cards of your library, where X is the number of lands you control\. Put one of those cards into your hand\. If this spell was kicked, put two of those cards into your hand instead\. Put the rest on the bottom of your library in a random order\.$/m.test(frontText(c))) {
    return { targets: [], effects: [{ kind: 'dig', n: 'lands', take: choice.kicked ? 2 : 1, optional: false }] };
  }
  const aura = auraTarget(c);
  if (aura) return { targets: [aura], effects: [] };
  if (!isInstantOrSorcery(c)) return { targets: [], effects: [] };
  const info = castInfo(card, choice.face ?? 0);
  if (info.unknownCost) return { targets: [], effects: [] };
  let text = stripReminder(frontText(c))
    .split('\n')
    // Other ways to cast it that are never used here (Harmonize, Web-slinging, Paradigm), and options never taken
    // (a gift never promised, a spell never bargained).
    .filter((l) => !/^(Kicker|Flashback|Cycling|Convoke|Delve|Affinity for|(Basic land|[A-Z][a-z]+)cycling|Harmonize|Web-slinging|Cleave|Warp|Overload|Evoke|Paradigm|Bargain$|Gift an? |Split second$)\b/.test(l.trim()))
    // Berserk: "Cast this spell only before the combat damage step." (checked when casting)
    .filter((l) => !/^Cast this spell only before the combat damage step\.$/.test(l.trim()))
    // Alternative costs ("You may return an Island you control … rather than pay this spell's mana cost.").
    .filter((l) => !/rather than pay this spell's mana cost\.$|rather than pay this spell's mana cost, you may have an opponent gain \d+ life\.$/.test(l.trim()))
    .join('\n')
    // Cleave: the words in brackets are removed; cast normally, they're read without the brackets.
    .replace(/\s*\[([^\]]*)\]/g, (_, words: string) => (choice.alt !== undefined && info.alts[choice.alt]?.kind === 'mana' && (info.alts[choice.alt] as { name: string }).name === 'cleave' ? '' : ` ${words}`))
    .replace(/As an additional cost to cast this spell, [^.]+\.\s*(?:This spell costs \{\d+\} less to cast for each card exiled this way\.\s*)?/, '')
    .replace(/If (?:the gift was promised|this spell was bargained|this spell's additional cost was paid|evidence was collected), [^.]+\.\s*/g, '');
  // Groundswell: "Landfall — If you had a land enter the battlefield under your control this turn, that creature gets +4/+4
  // until end of turn instead."; Might of Old Krosa: "If you cast this spell during your main phase, …".
  let instead: { power: number; toughness: number; if: 'landfall' | 'castInMain' } | undefined;
  text = text.replace(/\s*(?:Landfall — )?If (you had a land enter the battlefield under your control this turn|you cast this spell during your main phase), that creature gets \+(\d+)\/\+(\d+) until end of turn instead\./, (_, cond: string, pw: string, tg: string) => {
    instead = { power: Number(pw), toughness: Number(tg), if: cond.startsWith('you had') ? 'landfall' : 'castInMain' };
    return '';
  });
  // Overload: "change \"target\" in its text to \"each\"".
  if (choice.alt !== undefined && info.alts[choice.alt]?.kind === 'mana' && (info.alts[choice.alt] as { name: string }).name === 'overload') {
    text = text.replace(/\btarget\b/g, 'each');
  }
  // Wild Shape: each mode is "1/3 Turtle with hexproof.": its base power and toughness, creature type and ability.
  if (info.modal && new RegExp(`^Choose one\\. ${WILD_SHAPE.source}`, 'm').test(text)) {
    const mode = info.modal.modes[choice.modes?.[0] ?? -1]?.match(/^(\d+)\/(\d+) ([A-Z][a-z]+) with ([a-z ]+)\.$/);
    if (!mode || choice.modes?.length !== 1 || !(KEYWORDS as readonly string[]).includes(mode[4])) return { targets: [], effects: [] };
    return {
      targets: [{ kind: 'creature', min: 1, max: 1, filter: { controller: 'you' } }],
      effects: [{ kind: 'reshape', to: { slot: 0 }, power: Number(mode[1]), toughness: Number(mode[2]), subtypes: [mode[3]], keywords: [mode[4] as Keyword] }],
    };
  }
  // Green Sun's Zenith: "Shuffle Green Sun's Zenith into its owner's library."
  text = text.split(`Shuffle ${c.name} into its owner's library.`).join('Shuffle this spell into its owner\'s library.');
  // Grow Extra Arms: "This spell costs {1} less to cast if it targets a Spider." (never taken: listed in TODO.md)
  text = text.replace(/^This spell costs \{\d+\} less to cast if it targets an? [A-Z][a-z]+\.\n?/m, '');
  const kickedTexts: string[] = [];
  text = text.replace(/If this spell was kicked, ([^.]+\.)\s*/g, (_, rest: string) => {
    kickedTexts.push(rest);
    return '';
  });
  let spec: AbilitySpec;
  if (info.modal) {
    const modes = choice.modes ?? [];
    if (modes.length < Math.max(1, info.modal.min) || modes.length > info.modal.max) return { targets: [], effects: [] };
    // Spree and Tiered have no text besides their modes.
    const head = info.modal.costs ? '' : text.slice(0, text.indexOf('Choose ')).trim();
    const parsed = modes.map((i) => parseAbilityText(info.modal!.modes[i] ?? ''));
    // A mode that isn't understood makes the whole spell "not simulated" rather than half-simulated.
    if (parsed.some((p) => !p.effects.length)) return { targets: [], effects: [] };
    spec = combine([head ? parseAbilityText(head) : { targets: [], effects: [] }, ...parsed]);
  } else {
    spec = parseAbilityText(text);
  }
  if (instead) {
    const pumps = spec.effects.filter((e) => e.kind === 'pump');
    if (pumps.length !== 1) return { targets: [], effects: [] };
    spec = { ...spec, effects: spec.effects.map((e) => (e.kind === 'pump' ? { ...e, instead } : e)) };
  }
  if (choice.kicked) {
    for (const k of kickedTexts) {
      // Vines of Vastwood: "that creature gets +4/+4 until end of turn" (the spell's target).
      const bigger = k.match(/^that creature gets \+(\d+)\/\+(\d+) until end of turn\.$/i);
      if (bigger && spec.targets.length === 1) {
        spec = { ...spec, effects: [...spec.effects, { kind: 'pump', power: Number(bigger[1]), toughness: Number(bigger[2]), keywords: [], to: { slot: 0 } }] };
        continue;
      }
      // "it deals 4 damage instead": the spell's damage changes.
      const instead = k.match(/deals (\d+) damage(?: to [a-z ]+)? instead\.$/i);
      const dmg = spec.effects.find((e) => e.kind === 'damage');
      if (instead && dmg?.kind === 'damage') dmg.amount = Number(instead[1]);
      else if (!/\binstead\b/i.test(k)) spec = combine([spec, parseAbilityText(k)]);
    }
  }
  return spec;
}

export function castSpec(card: Card, choice: CastChoice): AbilitySpec {
  const spec = castSpecRaw(card, choice);
  // March of Otherworldly Light: "with mana value X or less" becomes the X paid.
  if (!spec.targets.some((t) => t.filter.maxManaValueX)) return spec;
  return { ...spec, targets: spec.targets.map((t) => (t.filter.maxManaValueX ? { ...t, filter: { ...t.filter, maxManaValue: choice.x ?? 0 } } : t)) };

}

/** Just the effects of an instant or sorcery. */
export const parseEffects = (card: Card): Effect[] => spellSpec(card).effects;

// ---------- Triggered abilities ----------

/** `combatDamageWalker`: combat damage to a planeswalker (Psychic Frog: "to a player or planeswalker"). */
/** `leaves`: Sewer-veillance Cam's "enters or leaves the battlefield". */
export type ObjectEvent = 'enters' | 'dies' | 'attacks' | 'combatDamage' | 'combatDamageWalker' | 'leaves';
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
  /** Whenever you cast a spell matching the card words ("noncreature", "instant or sorcery"); `nth`: only your second spell each turn (flurry). */
  | { on: 'cast'; filter: TargetFilter; nth?: number }
  /** Whenever you gain life. */
  | { on: 'gainLife' }
  /** "Whenever you attack": once when its controller declares one or more attackers. */
  | { on: 'youAttack' }
  /** Vexing Bauble: "Whenever a player casts a spell, if no mana was spent to cast it, …" (the ability's slot 0 is that spell). */
  | { on: 'castWithoutMana'; colored?: boolean; opponents?: boolean }
  /** Archivist of Oghma: "Whenever an opponent searches their library, …" */
  | { on: 'opponentSearches' }
  /** Sneaky Snacker: "When you draw your third card in a turn, return this card from your graveyard …" (from the graveyard). */
  | { on: 'youDrawNth'; nth: number; fromGraveyard: boolean }
  /**
   * City of Brass: "Whenever this land becomes tapped, …" (not when it enters tapped); Tezzeret's emblem: "Whenever an
   * artifact you control becomes tapped" (`which`).
   */
  | { on: 'becomesTapped'; which?: Selector }
  /** Basking Broodscale: "Whenever one or more +1/+1 counters are put on this creature, …" */
  | { on: 'countersPut' }
  /** Phantasmal Image's copies: "When this creature becomes the target of a spell or ability, …" */
  | { on: 'becomesTarget' }
  /**
   * Surrak, Elusive Hunter: "Whenever a creature you control or a creature spell you control becomes the target of a
   * spell or ability an opponent controls, …"
   */
  | { on: 'yourCreatureTargeted' }
  /** Guardian of New Benalia: "Whenever this creature enlists a creature, …" */
  | { on: 'enlists' }
  /**
   * Chalice of the Void: "Whenever a player casts a spell with mana value equal to the number of charge counters on this
   * artifact, …" (the ability's slot 0 is that spell).
   */
  | { on: 'castMvCounters'; counter: CounterKind }
  /** Screaming Nemesis: "Whenever this creature is dealt damage, …" (the ability's X is that much damage). */
  | { on: 'dealtDamage' }
  /** The Cabbage Merchant: "Whenever a creature deals combat damage to you, …" */
  | { on: 'combatDamageToYou' }
  /** Goblin Lackey: "Whenever this creature deals damage to a player, …" */
  | { on: 'damagesPlayer' }
  /** Aurora Eidolon: "Whenever you cast a multicolored spell, you may return this card from your graveyard to your hand." (in the graveyard) */
  | { on: 'castFromGraveyard'; filter: TargetFilter }
  /** Murktide Regent: "Whenever an instant or sorcery card leaves your graveyard, …" (once for each card). */
  | { on: 'leavesYourGraveyard'; filter: TargetFilter }
  /** Fear of Missing Out: "Whenever this creature attacks for the first time each turn, …" */
  | { on: 'attacksFirstTime' }
  /**
   * Moonshadow: "Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has
   * a -1/-1 counter on it, …" (once for cards put there together).
   */
  | { on: 'permanentCardsToGraveyard'; whileCounter?: CounterKind }
  /** Phyrexian Devourer: "When this creature's power is 7 or greater, …" (a state trigger, checked with state-based actions). */
  | { on: 'powerAtLeast'; n: number }
  /** Monument to Endurance: "Whenever you discard a card, …" (once per card). */
  | { on: 'youDiscard' }
  /** Biotech Specialist: "Whenever you sacrifice an artifact, …"; The Sackville-Bagginses: "a token" (`token`). */
  | { on: 'youSacrifice'; filter: TargetFilter; token?: boolean }
  /** Hypnotic Specter: "Whenever this creature deals damage to an opponent, that player …" (slot 0 is that player). */
  | { on: 'damagesOpponent' }
  /**
   * Each card an opponent draws (Orcish Bowmasters: `notFirstInDrawStep`, "except the first one they draw in each of
   * their draw steps"); Faerie Mastermind: only their `nth` (second) card each turn.
   */
  | { on: 'opponentDraws'; nth?: number; notFirstInDrawStep?: boolean; anyPlayer?: boolean }
  /** Skullclamp: "Whenever equipped creature dies, …" */
  | { on: 'equippedDies' }
  /** City of Traitors: "When you play another land, …" */
  | { on: 'youPlayLand' }
  /** Sowing Mycospawn: "When you cast this spell, …" (`kicked`: "if it was kicked"). */
  | { on: 'castSelf'; kicked?: boolean }
  /** Rhystic Study: "Whenever an opponent casts a spell, …" (the ability's slot 0 is that player); Esper Sentinel: only their first noncreature spell each turn. */
  | { on: 'opponentCasts'; filter: TargetFilter; firstNoncreature?: boolean; nth?: number; spellTarget?: boolean };

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
/** Crown, Scepter and Throne of Empires: "… instead if you control artifacts named … and …" (see parseAbilityText). */
const EMPIRES = /\. [^.]+? instead if you control artifacts named [^.]+? and [^.]+?(?=\.$)/;
/** Tezzeret, Betrayer of Flesh: "Then discard two cards unless you discard an artifact card." */
const UNLESS_ARTIFACT = / Then discard two cards unless you discard an artifact card(?=\.$)/;
/** Tezzeret, Betrayer of Flesh's −2 and Obsessive Pursuit's attack trigger (see parseAbilityText). */
const TEZZERET_ANIMATE = /^Target artifact becomes an artifact creature\. If it isn't a Vehicle, it has base power and toughness \d+\/\d+\.$/;
const PURSUIT = /, where X is the number of permanents you've sacrificed this turn\. If X is \w+ or more, that creature gains lifelink until end of turn/;
/**
 * "Exile the top card of your library. You may play it this turn."; Glimpse the Impossible: "… At the beginning of the
 * next end step, if any of those cards remain exiled, put them into your graveyard, then create a 0/1 colorless Eldrazi
 * Spawn creature token for each card put into your graveyard this way. Those tokens have \"Sacrifice this token: Add
 * {C}.\"" (see the impulse effect).
 */
const IMPULSE = /\bExile the top (?:card|(\w+) cards) of your library\. You may play (?:it|them|those cards) this turn\.( At the beginning of the next end step, if any of those cards remain exiled, put them into your graveyard, then create a 0\/1 colorless Eldrazi Spawn creature token for each card put into your graveyard this way\. Those tokens have "Sacrifice this token: Add \{C\}\.")?/;
/** Fabled Passage: "Then if you control four or more lands, untap that land." */
const FABLED = /(?:^|[.] *)Then if you control (\w+) or more lands, untap that land\./;
/** Elven Passage: "You may behold an Elf. If you do, untap that land." */
const BEHOLD = /(?:^|[.] *)You may behold an? ([A-Z][a-z]+)\. If you do, untap that land\./;
/**
 * Scythecat Cub: "put a +1/+1 counter on target creature you control. If this is the second time this ability has
 * resolved this turn, double the number of +1/+1 counters on that creature instead."
 */
const SCYTHECAT = /\bput a \+1\/\+1 counter on (target creature you control)\. If this is the second time this ability has resolved this turn, double the number of \+1\/\+1 counters on that creature instead\./;
/** Berserk (see parseAbilityText). */
const BERSERK = /\b(Target creature) gains trample and gets \+X\/\+0 until end of turn, where X is its power\. At the beginning of the next end step, destroy that creature if it attacked this turn\./;
/** Bounty of the Hunt (see parseAbilityText). */
const BOUNTY = /\bDistribute three \+1\/\+1 counters among one, two, or three target creatures\. For each \+1\/\+1 counter you put on a creature this way, remove a \+1\/\+1 counter from that creature at the beginning of the next cleanup step\./;
/** Kaito's 0: "Then draw a card for each opponent who lost life this turn." */
const LOST_LIFE_DRAW = /(?:^|[.] *)Then draw a card for each opponent who lost life this turn(?=\.)/;
/** Necropotence (see the exileTopUntilEndStep effect). */
const NECRO = /\bExile the top card of your library face down\. Put that card into your hand at the beginning of your next end step\./;
/** Jeweled Amulet (see activatedOf). */
const AMULET = /\bPut a charge counter on this artifact\. Note the type of mana spent to pay this activation cost\./;
const UNSUPPORTED_WORDS = /\b(?:if|unless|for each|where|instead|that (?:creature|card|player|land|spell|permanent)|those|otherwise|this way|exiled with)\b/i;
/** Wordings the effect parser would misread. Quoted text is an ability given to something else (a token), read on its own. */
const UNSUPPORTED = {
  test: (text: string) => {
    let rest = text;
    for (const handled of [CONTROLLER_SEARCH, REVEAL_FOUND, SURVEIL_TO_HAND, THORIN_ATTACH, BECOMES_CREATURE, LAND_BECOMES, TRADE_FOR_CARD, COUNTER_DEST, TIDEBINDER, POWER_LIFE, PHELIA, CITY_COPIES, GHOST_VACUUM, MALCOLM, FLICKER, BLACK_SUN, EMPIRES, UNLESS_ARTIFACT, TEZZERET_ANIMATE, PURSUIT, IMPULSE, FABLED, BEHOLD, SCYTHECAT, BERSERK, BOUNTY, AMULET, NECRO, LOST_LIFE_DRAW]) rest = rest.replace(handled, '');
    return UNSUPPORTED_WORDS.test(rest.replace(/"[^"]*"/g, '""'));
  },
};

const NO_EFFECT: AbilitySpec = { targets: [], effects: [] };

/** "a creature you control", "another nontoken creature", "a land" → which permanents a trigger watches. */
function triggerSubject(subject: string, underYourControl: boolean): { which: Selector; another: boolean } | null {
  // Kíli: "another Dwarf or Equipment you control": any permanent of these subtypes.
  // Zoraline: "a Bat you control" (one subtype).
  const kinds = subject.match(/^(a|an|another) ((?:[A-Z][a-z]+)(?: or [A-Z][a-z]+)*)( you control)?$/);
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

/** "you may sacrifice another creature or artifact. If you do, …" as the reflexive match (sacrifice in group 4). */
function sacrificeIfYouDo(text: string): (string | undefined)[] | null {
  const m = text.match(/^you may sacrifice ((?:a|an|another) [a-z ]+?)\. If you do, (.+)$/i);
  return m && [m[0], undefined, undefined, undefined, m[1], undefined, m[2]];
}

/** The effect text of a trigger: "you may" makes it optional; unsupported wordings give no effects. */
function triggerAbility(text: string, name: string, self: boolean): AbilitySpec {
  // Curious Obsession: "if you didn't attack with a creature this turn, sacrifice this Aura."
  const noAttack = text.match(/^if you didn't attack with a creature this turn, (.+)$/i);
  if (noAttack) {
    const then = triggerAbility(noAttack[1], name, self);
    return then.effects.length ? { ...then, condition: { ...then.condition, noAttack: true } } : NO_EFFECT;
  }
  // Brokers Hideout: "sacrifice it. When you do, search your library for …" (it's always done: read as one ability).
  const sacrificeThen = text.match(/^sacrifice it\. When you do, (.+)$/i);
  if (sacrificeThen) return triggerAbility(`sacrifice it. ${sacrificeThen[1].replace(/^./, (c) => c.toUpperCase())}`, name, self);
  // "you may discard a card. When you do, …", "you may pay {W}{B} and 2 life. When you do, …"
  // The Sackville-Bagginses: "you may sacrifice another creature or artifact. If you do, …" (no target: the same).
  const reflexive = text.match(/^you may (?:(discard a card)|pay ((?:\{(?:\d+|[WUBRGC])\})+)(?: and (\d+) life)?|sacrifice ((?:a|an|another) [a-z ]+?)|(remove a counter from (?:it|him|her|them|this creature)))\. When you do, (.+)$/i)
    ?? sacrificeIfYouDo(text);
  if (reflexive) {
    const inner = reflexive[6]!;
    // "It" in the reflexive part is its own target ("put a +1/+1 counter on target attacking creature. It gains trample").
    const then = UNSUPPORTED.test(inner) ? NO_EFFECT : parseAbilityText(inner, self ? name : undefined);
    if (!then.effects.length) return NO_EFFECT;
    const sacrifice = reflexive[4] ? triggerSubject(reflexive[4], true) : undefined;
    if (reflexive[4] && !sacrifice) return NO_EFFECT;
    const cost = reflexive[1] ? { discard: 1 } : sacrifice ? { sacrifice } : reflexive[5] ? { removeCounter: true }
      : { mana: reflexive[2], ...(reflexive[3] ? { life: Number(reflexive[3]) } : {}) };
    return { targets: [], effects: [{ kind: 'reflexive', cost, then }] };
  }
  // Seasoned Cryomancer: "draw two cards, then discard two cards. When you discard one or more nonland cards this way, …"
  const thisWay = text.match(/^(.+?\bdiscard (?:a|two|three) cards?)\. When you discard one or more nonland cards this way, (.+)$/i);
  if (thisWay) {
    const first = parseAbilityText(`${thisWay[1]}.`, self ? name : undefined);
    const upToThatMany = /\bup to that many target\b/i.test(thisWay[2]);
    const inner = thisWay[2].replace(/\bup to that many target\b/i, 'up to five target');
    const then = UNSUPPORTED.test(inner) ? NO_EFFECT : parseAbilityText(inner, self ? name : undefined);
    const discards = first.effects.some((e) => e.kind === 'discard' && e.to === 'you' && e.mode === 'choose');
    if (!discards || first.targets.length || !then.effects.length || (upToThatMany && then.targets.length !== 1)) return NO_EFFECT;
    return { targets: [], effects: [...first.effects, { kind: 'whenDiscardedNonland', upToThatMany, then }] };
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
  // Monument to Endurance: "choose one that hasn't been chosen this turn —".
  const modal = text.match(/^choose (one|up to one|one or both|one or more|two|one that hasn't been chosen this turn) — (• .+)$/i);
  if (modal) {
    const texts = modal[2].split(/ ?• /).filter(Boolean).map((m) => m.trim());
    const specs = texts.map((m) => triggerBody(m, name, self));
    if (!specs.some((sp) => sp.effects.length)) return NO_EFFECT;
    const fresh = /hasn't been chosen/i.test(modal[1]);
    const [min, max] = fresh ? [1, 1] : ({ one: [1, 1], 'up to one': [0, 1], 'one or both': [1, 2], 'one or more': [1, texts.length], two: [2, 2] } as Record<string, number[]>)[modal[1].toLowerCase()];
    return { targets: [], effects: [{ kind: 'chooseModes' }], modal: { min, max, texts, specs, ...(fresh ? { fresh } : {}) } };
  }
  // Life this turn: "if you gained life this turn, …", "… if you've gained 3 or more life this turn."
  let condition: AbilitySpec['condition'];
  // Sunderflock: "When this creature enters, if you cast it, …"
  const castIt = self && text.match(/^if you cast it, (.+)$/i);
  if (castIt) {
    const then = triggerBody(castIt[1], name, self);
    return then.effects.length ? { ...then, condition: { ...then.condition, cast: true } } : NO_EFFECT;
  }
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
  // Tifa Lockhart's landfall: "double Tifa Lockhart's power" (its own name; "it" was refused above).
  const spec = parseAbilityText(body, name, self);
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

    // Fading N: "At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it."
    if (/^Fading \d+$/i.test(line)) {
      out.push({ event: { on: 'upkeep', whose: 'you' }, ability: { targets: [], effects: [{ kind: 'fade' }] } });
      continue;
    }
    // Vanishing N: "At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it."
    if (/^Vanishing \d+$/i.test(line)) {
      out.push({ event: { on: 'upkeep', whose: 'you' }, ability: { targets: [], effects: [{ kind: 'vanish' }] } });
      continue;
    }
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
    // The Queen of Dale: "Whenever an opponent casts their first noncreature spell each turn, you recruit."
    if (/^Whenever an opponent casts their first noncreature spell each turn, you recruit\.$/i.test(line)) {
      out.push({ event: { on: 'opponentCasts', filter: { nonTypes: ['creature'] }, firstNoncreature: true }, ability: { targets: [], effects: [{ kind: 'recruit' }] } });
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
    // Skullclamp: "Whenever equipped creature dies, draw two cards."
    const equippedDies = line.match(/^Whenever equipped creature dies, (.+)$/i);
    if (equippedDies) {
      out.push({ event: { on: 'equippedDies' }, ability: triggerAbility(equippedDies[1], name, true) });
      continue;
    }
    // City of Traitors: "When you play another land, sacrifice this land."
    const playLand = line.match(/^When(?:ever)? you play another land, (.+)$/i);
    if (playLand) {
      out.push({ event: { on: 'youPlayLand' }, ability: triggerAbility(playLand[1], name, true) });
      continue;
    }
    // King T'Challa: "Whenever a player draws their second card each turn, you draw a card."
    const anyDraw = line.match(/^Whenever a player draws their second card each turn, (.+)$/i);
    if (anyDraw) {
      out.push({ event: { on: 'opponentDraws', nth: 2, anyPlayer: true }, ability: triggerAbility(anyDraw[1], name, true) });
      continue;
    }
    // Faerie Mastermind: "Whenever an opponent draws their second card each turn, you draw a card."
    const draws = line.match(/^Whenever an opponent draws (a card|their second card each turn), (.+)$/i);
    if (draws) {
      out.push({ event: { on: 'opponentDraws', ...(draws[1].startsWith('their') ? { nth: 2 } : {}) }, ability: triggerAbility(draws[2], name, true) });
      continue;
    }

    // Sneaky Snacker: "When you draw your third card in a turn, return this card from your graveyard to the battlefield tapped."
    const snack = line.match(/^When you draw your (second|third|fourth) card in a turn, return this card from your graveyard to the battlefield( tapped)?\.$/i);
    if (snack) {
      out.push({
        event: { on: 'youDrawNth', nth: { second: 2, third: 3, fourth: 4 }[snack[1].toLowerCase() as 'second' | 'third' | 'fourth'], fromGraveyard: true },
        ability: { targets: [], effects: [{ kind: 'returnFromOwnGraveyard', tapped: !!snack[2] }] },
      });
      continue;
    }
    // Phyrexian Devourer: "When this creature's power is 7 or greater, sacrifice it." (a state trigger, see powerLimit)
    if (powerLimitLine(line, selves)) {
      out.push({ event: { on: 'powerAtLeast', n: powerLimitLine(line, selves)! }, ability: { targets: [], effects: [{ kind: 'sacrificeSelf' }] } });
      continue;
    }
    if (/^Whenever a creature you control or a creature spell you control becomes the target of a spell or ability an opponent controls, /i.test(line)) {
      out.push({ event: { on: 'yourCreatureTargeted' }, ability: triggerAbility(line.replace(/^[^,]+, /, ''), name, true) });
      continue;
    }
    // Phlage, Uro: "When Phlage enters, sacrifice it unless it escaped."
    const unlessEscaped = line.match(/^When (.+?) enters(?: the battlefield)?, sacrifice it unless it escaped\.$/i);
    if (unlessEscaped && selves.includes(unlessEscaped[1].toLowerCase())) {
      out.push({ event: { on: 'enters', self: true }, ability: { targets: [], effects: [{ kind: 'sacrificeSelf' }], condition: { notEscaped: true } } });
      continue;
    }
    // Screaming Nemesis: "Whenever this creature is dealt damage, it deals that much damage to any other target. If a
    // player is dealt damage this way, they can't gain life for the rest of the game."
    const nemesis = line.match(/^Whenever (.+?) is dealt damage, it deals that much damage to any other target\.( If a player is dealt damage this way, they can't gain life for the rest of the game\.)?$/i);
    if (nemesis && selves.includes(nemesis[1].toLowerCase())) {
      out.push({
        event: { on: 'dealtDamage' },
        ability: { targets: [{ kind: 'any', min: 1, max: 1, filter: { other: true } }], effects: [{ kind: 'damage', amount: 'X', to: { slot: 0 } }, ...(nemesis[2] ? [{ kind: 'noLifeGain' as const, to: { slot: 0 } }] : [])] },
      });
      continue;
    }
    // Fear of Missing Out: "Whenever this creature attacks for the first time each turn, if there are four or more card
    // types among cards in your graveyard, untap target creature. After this phase, there is an additional combat phase."
    const fomo = line.match(/^Whenever (.+?) attacks for the first time each turn, (if there are four or more card types among cards in your graveyard, )?untap target creature\. After this phase, there is an additional combat phase\.$/i);
    if (fomo && selves.includes(fomo[1].toLowerCase())) {
      out.push({
        event: { on: 'attacksFirstTime' },
        ability: {
          targets: [{ kind: 'creature', min: 1, max: 1, filter: {} }], effects: [{ kind: 'tap', untap: true, to: { slot: 0 } }, { kind: 'extraCombat' }],
          ...(fomo[2] ? { condition: { delirium: true } } : {}),
        },
      });
      continue;
    }
    // Tamiyo, Inquisitive Student: "When you draw your third card in a turn, exile Tamiyo, then return her to the
    // battlefield transformed under her owner's control."
    const flips = line.match(/^When you draw your (second|third|fourth) card in a turn, exile (.+?), then return (?:her|him|it|them) to the battlefield transformed under (?:her|his|its|their) owner's control\.$/i);
    if (flips && selves.includes(flips[2].toLowerCase())) {
      out.push({
        event: { on: 'youDrawNth', nth: { second: 2, third: 3, fourth: 4 }[flips[1].toLowerCase() as 'second' | 'third' | 'fourth'], fromGraveyard: false },
        ability: { targets: [], effects: [{ kind: 'flickerTransformed' }] },
      });
      continue;
    }
    // Archivist of Oghma: "Whenever an opponent searches their library, you gain 1 life and draw a card."
    const searches = line.match(/^Whenever an opponent searches their library, (.+)$/i);
    if (searches) {
      out.push({ event: { on: 'opponentSearches' }, ability: triggerAbility(searches[1], name, false) });
      continue;
    }
    // Murktide Regent: "Whenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on this creature."
    const leavesGrave = line.match(/^Whenever an? ([a-z ]+?) card leaves your graveyard, (.+)$/i);
    const leavesFilter = leavesGrave && cardWordsFilter(leavesGrave[1]);
    if (leavesGrave && leavesFilter) {
      out.push({ event: { on: 'leavesYourGraveyard', filter: leavesFilter }, ability: triggerAbility(leavesGrave[2], name, true) });
      continue;
    }
    // Inti: "Whenever you discard one or more cards, exile the top card of your library. You may play that card until
    // your next end step." (once for cards discarded together)
    if (/^Whenever you discard one or more cards, exile the top card of your library\. You may play that card until your next end step\.$/i.test(line)) {
      out.push({ event: { on: 'youDiscard' }, ability: { targets: [], effects: [{ kind: 'impulse', n: 1, untilYourEndStep: true }] }, batch: true });
      continue;
    }
    // Necropotence: "Whenever you discard a card, exile that card from your graveyard." (slot 0: that card)
    if (/^Whenever you discard a card, exile that card from your graveyard\.$/i.test(line)) {
      out.push({ event: { on: 'youDiscard' }, ability: { targets: [{ kind: 'card', min: 1, max: 1, filter: { controller: 'you' } }], effects: [{ kind: 'destroy', exile: true, to: { slot: 0 } }] } });
      continue;
    }
    // The Cabbage Merchant: "Whenever a creature deals combat damage to you, sacrifice a Food token."
    const hitMe = line.match(/^Whenever a creature deals combat damage to you, (.+)$/i);
    if (hitMe) {
      const food = /^sacrifice an? ([A-Z][a-z]+) token\.$/.exec(hitMe[1]);
      out.push({
        event: { on: 'combatDamageToYou' },
        ability: food ? { targets: [], effects: [{ kind: 'sacrifice', n: 1, to: 'you', which: { kind: 'permanent', filter: { subtypes: [food[1].toLowerCase()], token: true } } }] } : triggerAbility(hitMe[1], name, false),
      });
      continue;
    }
    // "Whenever an opponent casts a noncreature spell, create a Food token." (The Cabbage Merchant)
    const oppCasts = line.match(/^Whenever an opponent casts an? ([a-z ]*?)spell, (.+)$/i);
    const oppFilter = oppCasts && (oppCasts[1].trim() ? cardWordsFilter(oppCasts[1].trim()) : {});
    if (oppCasts && oppFilter && !/\bthat (?:player|spell)\b/i.test(oppCasts[2])) {
      out.push({ event: { on: 'opponentCasts', filter: oppFilter }, ability: triggerAbility(oppCasts[2], name, false) });
      continue;
    }
    // Chalice of the Void: "Whenever a player casts a spell with mana value equal to the number of charge counters on this
    // artifact, counter that spell."
    if (/^Whenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter that spell\.$/i.test(line)) {
      out.push({ event: { on: 'castMvCounters', counter: 'charge' }, ability: { targets: [{ kind: 'spell', min: 1, max: 1, filter: {} }], effects: [{ kind: 'counter', to: { slot: 0 } }] } });
      continue;
    }
    // Moonshadow: "… while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature."
    const permanentsToGrave = line.match(/^Whenever one or more permanent cards are put into your graveyard from anywhere(?: while (.+?) has a -1\/-1 counter on it)?, remove a -1\/-1 counter from (.+?)\.$/i);
    if (permanentsToGrave && (!permanentsToGrave[1] || selves.includes(permanentsToGrave[1].toLowerCase())) && selves.includes(permanentsToGrave[2].toLowerCase())) {
      out.push({
        event: { on: 'permanentCardsToGraveyard', ...(permanentsToGrave[1] ? { whileCounter: '-1/-1' as CounterKind } : {}) },
        ability: { targets: [], effects: [{ kind: 'removeCounterSelf', counter: '-1/-1' }] },
      });
      continue;
    }
    // Phantasmal Image's copies: "When this creature becomes the target of a spell or ability, sacrifice it."
    const targeted = line.match(/^When(?:ever)? (.+?) becomes the target of a spell or ability, (.+)$/i);
    if (targeted && selves.includes(targeted[1].toLowerCase())) {
      out.push({ event: { on: 'becomesTarget' }, ability: triggerAbility(targeted[2], name, true) });
      continue;
    }
    // Guardian of New Benalia: "Whenever this creature enlists a creature, scry 2."
    const enlists = line.match(/^Whenever (.+?) enlists a creature, (.+)$/i);
    if (enlists && selves.includes(enlists[1].toLowerCase())) {
      out.push({ event: { on: 'enlists' }, ability: triggerAbility(enlists[2], name, true) });
      continue;
    }
    // Basking Broodscale: "Whenever one or more +1/+1 counters are put on this creature, …"
    const countersPut = line.match(/^Whenever one or more \+1\/\+1 counters are put on (.+?), (.+)$/i);
    if (countersPut && selves.includes(countersPut[1].toLowerCase())) {
      out.push({ event: { on: 'countersPut' }, ability: triggerAbility(countersPut[2], name, true) });
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
    // Obsessive Pursuit: "When this enchantment enters and at the beginning of your upkeep, …"
    const entersAndUpkeep = line.match(/^When (.+?) enters and at the beginning of your upkeep, (.+)$/i);
    if (entersAndUpkeep && selves.includes(entersAndUpkeep[1].toLowerCase())) {
      const ability = triggerAbility(entersAndUpkeep[2], name, true);
      out.push({ event: { on: 'enters', self: true }, ability }, { event: { on: 'upkeep', whose: 'you' }, ability });
      continue;
    }
    // Monument to Endurance: "Whenever you discard a card, …"
    const discarded = line.match(/^Whenever you discard a card, (.+)$/i);
    if (discarded) {
      out.push({ event: { on: 'youDiscard' }, ability: triggerAbility(discarded[1], name, true) });
      continue;
    }
    // Biotech Specialist: "Whenever you sacrifice an artifact, …"; The Sackville-Bagginses: "a token".
    const sacrificed = line.match(/^Whenever you sacrifice (?:an? |another )?([a-z ]+?), (.+)$/i);
    if (sacrificed) {
      const token = sacrificed[1].toLowerCase() === 'token';
      const filter = token ? {} : cardWordsFilter(sacrificed[1]);
      if (filter) out.push({ event: { on: 'youSacrifice', filter, ...(token ? { token } : {}) }, ability: triggerAbility(sacrificed[2], name, true) });
      continue;
    }
    const matched = line.replace(/ This ability triggers only once each turn\.$/, '')
      .match(/^(?:When|Whenever) (.+?) (enters?(?: the battlefield)?( under your control)?|attacks?|dies|leaves the battlefield|deals combat damage to a player(?: or (?:a )?planeswalker)?)(?: or (enters|attacks|dies|leaves)(?: the battlefield)?)?, (.+)$/i);
    // "attack" / "enter" only for a plural name ("Whenever Aang and La attack", "When The Sackville-Bagginses enter"), not
    // "Whenever you attack".
    const plural = matched && /^(?:attack|enter)$/i.test(matched[2].split(' ')[0]);
    const ev = matched && (!plural || selves.includes(matched[1].toLowerCase())) ? matched : null;
    if (ev) {
      const [, rawSubject, verb, under, alsoVerb, text] = ev;
      // "Whenever Aang and La attack": a plural name.
      const ons = [verb, alsoVerb].filter(Boolean).map((v): ObjectEvent => (v.startsWith('deals') ? 'combatDamage' : (v.toLowerCase().split(' ')[0].replace(/^attack$/, 'attacks').replace(/^enter$/, 'enters') as ObjectEvent)));
      if (/planeswalker$/i.test(verb)) ons.push('combatDamageWalker');
      // "this creature or another creature you control" is any creature you control, itself included.
      const orAnother = rawSubject.match(/^(.+?) or another (.+)$/i);
      const subject = orAnother && selves.includes(orAnother[1].toLowerCase()) ? `a ${orAnother[2]}` : rawSubject;
      const self = selves.includes(subject.toLowerCase());
      const watched = self ? null : triggerSubject(subject, !!under);
      if (!self && !watched) continue;
      const ability = triggerAbility(text, name, self);
      for (const on of ons) {
        // "leaves the battlefield" not understood: left unread (Parallax Wave and Skyclave Apparition have their own code).
        if (on === 'leaves' && !ability.effects.length) continue;
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

    // Vexing Bauble: "Whenever a player casts a spell, if no mana was spent to cast it, counter that spell."; Void Mirror:
    // "if no colored mana was spent to cast it".
    // Boromir: "Whenever an opponent casts a spell, if no mana was spent to cast it, counter that spell."
    const noMana = line.match(/^Whenever (a player|an opponent) casts a spell, if no (colored )?mana was spent to cast it, counter that spell\.$/i);
    if (noMana) {
      out.push({
        event: { on: 'castWithoutMana', ...(noMana[2] ? { colored: true } : {}), ...(noMana[1] === 'an opponent' ? { opponents: true } : {}) },
        ability: { targets: [{ kind: 'spell', min: 1, max: 1, filter: {} }], effects: [{ kind: 'counter', to: { slot: 0 } }] },
      });
      continue;
    }

    // Goblin Lackey: "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto
    // the battlefield."
    const toPlayer = line.match(/^Whenever (.+?) deals damage to a player, (.+)$/i);
    if (toPlayer && selves.includes(toPlayer[1].toLowerCase()) && !/\bthat player\b/i.test(toPlayer[2])) {
      out.push({ event: { on: 'damagesPlayer' }, ability: triggerAbility(toPlayer[2], name, true) });
      continue;
    }
    // Aurora Eidolon: "Whenever you cast a multicolored spell, you may return this card from your graveyard to your hand."
    const back = line.match(/^Whenever you cast an? ([a-z ]*?)spell, you may return this card from your graveyard to your hand\.$/i);
    const backFilter = back && (back[1].trim() ? cardWordsFilter(back[1].trim()) : {});
    if (back && backFilter) {
      out.push({ event: { on: 'castFromGraveyard', filter: backFilter }, ability: { targets: [], effects: [{ kind: 'returnFromOwnGraveyard', tapped: false, toHand: true }], optional: true } });
      continue;
    }
    // Chancellor of the Annex: "Whenever an opponent casts a spell, counter it unless that player pays {1}." (slot 0: the spell)
    const tax = line.match(/^Whenever an opponent casts a spell, counter it unless that player pays \{(\d+)\}\.$/i);
    if (tax) {
      out.push({ event: { on: 'opponentCasts', filter: {}, spellTarget: true }, ability: { targets: [{ kind: 'spell', min: 1, max: 1, filter: {} }], effects: [{ kind: 'counter', to: { slot: 0 }, unlessPays: Number(tax[1]) }] } });
      continue;
    }
    // Hypnotic Specter: "Whenever this creature deals damage to an opponent, that player discards a card at random."
    const toOpponent = line.match(/^Whenever (.+?) deals damage to an opponent, that player (.+)$/i);
    if (toOpponent && selves.includes(toOpponent[1].toLowerCase())) {
      const ability = triggerAbility(`target opponent ${toOpponent[2]}`, name, true);
      out.push({ event: { on: 'damagesOpponent' }, ability: ability.targets.length === 1 && ability.targets[0].kind === 'player' ? ability : NO_EFFECT });
      continue;
    }

    const tapped = line.match(/^Whenever (.+?) becomes tapped, (.+)$/i);
    if (tapped && selves.includes(tapped[1].toLowerCase())) {
      out.push({ event: { on: 'becomesTapped' }, ability: triggerAbility(tapped[2], name, true) });
      continue;
    }
    // Tezzeret's emblem: "Whenever an artifact you control becomes tapped, draw a card."
    const watched = tapped && triggerSubject(tapped[1], false);
    if (tapped && watched && !watched.another) {
      out.push({ event: { on: 'becomesTapped', which: watched.which }, ability: triggerAbility(tapped[2], name, false) });
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
    // Flurry: "Whenever you cast your second spell each turn, …"; Kraum: "Whenever an opponent casts their second spell
    // each turn"; Lotho: "Whenever a player casts …" (both).
    const second = line.replace(/^Flurry — /, '').match(/^Whenever (you cast your|an opponent casts their|a player casts their) second spell each turn, (.+)$/i);
    if (second) {
      const ability = triggerAbility(second[2], name, true);
      const who = second[1].toLowerCase();
      if (who !== 'an opponent casts their') out.push({ event: { on: 'cast', filter: {}, nth: 2 }, ability });
      if (who !== 'you cast your') out.push({ event: { on: 'opponentCasts', filter: {}, nth: 2 }, ability: { ...ability, targets: [] } });
      continue;
    }
    // Magecraft: "Whenever you cast or copy …" (copies aren't simulated, casting is).
    const cast = line.match(/^Whenever you cast (?:or copy )?an? (?:([a-z, -]+?) )?spell, (.+)$/i);
    if (cast) {
      const filter = cast[1] ? cardWordsFilter(cast[1]) : {};
      if (filter) out.push({ event: { on: 'cast', filter }, ability: triggerAbility(cast[2], name, true) });
    }
  }
  // Thought-Knot Seer: "When this creature leaves the battlefield, target opponent draws a card." pays back its enters
  // trigger; with that one not simulated, neither is this one (no drawback without the upside).
  const entersUnread = out.some((t) => t.event.on === 'enters' && t.event.self && !t.ability.effects.length);
  for (const t of out) if (entersUnread && t.event.on === 'leaves' && t.event.self) t.ability = NO_EFFECT;
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
  /** Tezzeret the Seeker: "−X: …" (X more loyalty removed, X chosen as it's activated). */
  loyaltyX?: boolean;
  /** Crew N: tap untapped creatures you control with total power N or more (chosen when activating). */
  crew?: number;
  /** Parallax Wave: "Remove a fade counter from this enchantment". */
  removeCounter?: CounterKind;
  /**
   * Moorland Haunt: "Exile a creature card from your graveyard"; Psychic Frog: "Exile three cards from your graveyard"
   * (`exileCount` cards, chosen when activating).
   */
  exileFromGraveyard?: TargetFilter;
  exileCount?: number;
  /** Psychic Frog: "Discard a card"; Survival of the Fittest: "Discard a creature card" (`discardFilter`). */
  discard?: number;
  discardFilter?: TargetFilter;
  /** Waterbend {N}: each artifact or creature tapped while paying pays for {1}. */
  waterbend?: boolean;
  /** Devoted Druid: "Put a -1/-1 counter on this creature". */
  putCounter?: CounterKind;
  /** Attunement: "Return this enchantment to its owner's hand". */
  returnSelf?: boolean;
  /** Relic of Progenitus: "Exile this artifact" (it leaves as a cost). */
  exileSelf?: boolean;
  /** Phyrexian Devourer: "Exile the top card of your library". */
  exileTop?: boolean;
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
  /** Wishclaw Talisman: "Activate only during your turn." */
  yourTurn?: boolean;
  /** Centaur Garden (threshold): "Activate only if there are seven or more cards in your graveyard." */
  minGraveyard?: number;
  /** Jeweled Amulet: "Activate only if there are no charge counters on this artifact." */
  noCounter?: CounterKind;
  /** Shifting Woodland (delirium): "Activate only if there are four or more card types among cards in your graveyard." */
  delirium?: boolean;
  /** Tectonic Edge: "Activate only if an opponent controls four or more lands." */
  opponentLands?: number;
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
    // Tezzeret the Seeker: "−X: Search your library for an artifact card with mana value X or less, …"
    if (/^[−-]X$/.test(m[1].trim())) {
      const ability = UNSUPPORTED.test(text) ? NO_EFFECT : parseAbilityText(text, name);
      out.push({ text: line, cost: { mana: '', tap: false, sacrificeSelf: false, life: 0, loyalty: 0, loyaltyX: true }, ability, sorcery: true, once: false });
      continue;
    }
    if (/^(?:\[|[+−])/.test(m[1])) continue; // other loyalty costs
    // Deathrite Shaman: "{T}: Exile target land card from a graveyard. Add one mana of any color." (a target: not a mana
    // ability, played as an activated one)
    const exileForMana = /^Exile target land card from a graveyard\. Add one mana of any color\.$/.test(text.replace(/\s*\([^)]*\)/g, ''));
    if (!exileForMana && /\badd \{|\badd (?:one|two|three) mana|\badd [a-z]+ mana/i.test(text)) continue; // mana ability
    const cost: ActivationCost = { mana: '', tap: false, sacrificeSelf: false, life: 0 };
    let ok = true;
    for (const part of m[1].split(/,\s*/)) {
      const p = part.trim();
      if (/^(\{[^}]+\})+$/.test(p) && !p.includes('{T}') && !p.includes('{Q}')) cost.mana += p;
      else if (p === '{T}') cost.tap = true;
      else if (/^Waterbend (\{\d+\})$/.test(p)) {
        cost.mana += p.slice('Waterbend '.length);
        cost.waterbend = true;
      }
      else if (/^sacrifice /i.test(p) && selves.includes(p.slice('sacrifice '.length).toLowerCase())) cost.sacrificeSelf = true;
      else if (/^sacrifice (?:a|an|another) /i.test(p)) {
        const subject = triggerSubject(p.slice('sacrifice '.length), true);
        if (subject) cost.sacrifice = subject;
        else ok = false;
      }
      else if (/^pay (\d+) life$/i.test(p)) cost.life = Number(p.match(/\d+/)![0]);
      else if (/^exile an? ([a-z ]+?) card from your graveyard$/i.test(p)) {
        const filter = cardWordsFilter(p.match(/^exile an? ([a-z ]+?) card from your graveyard$/i)![1]);
        if (filter) cost.exileFromGraveyard = filter;
        else ok = false;
      }
      else if (new RegExp(`^exile (${NUMBER}) cards? from your graveyard$`, 'i').test(p)) {
        cost.exileFromGraveyard = {};
        cost.exileCount = toNumber(p.split(' ')[1]);
      }
      else if (new RegExp(`^discard (${NUMBER}) cards?$`, 'i').test(p)) cost.discard = toNumber(p.split(' ')[1]);
      else if (/^discard an? ([a-z ]+?) card$/i.test(p)) {
        const filter = cardWordsFilter(p.match(/^discard an? ([a-z ]+?) card$/i)![1]);
        if (filter) {
          cost.discard = 1;
          cost.discardFilter = filter;
        } else ok = false;
      }
      else if (/^exile the top card of your library$/i.test(p)) cost.exileTop = true;
      else if (/^exile /i.test(p) && selves.includes(p.slice('exile '.length).toLowerCase())) cost.exileSelf = true;
      else if (/^put a -1\/-1 counter on /i.test(p) && selves.includes(p.replace(/^put a -1\/-1 counter on /i, '').toLowerCase())) cost.putCounter = '-1/-1';
      // Wishclaw Talisman: "Remove a wish counter from this artifact".
      else if (/^remove an? (fade|age|lore|wish|\+1\/\+1) counter from /i.test(p) && selves.includes(p.replace(/^remove an? \S+ counter from /i, '').toLowerCase())) {
        // Triskelion: "Remove a +1/+1 counter from this creature".
        cost.removeCounter = p.match(/^remove an? (\S+)/i)![1].toLowerCase() as CounterKind;
      }
      // Attunement: "Return this enchantment to its owner's hand".
      else if (/^return /i.test(p) && / to its owner's hand$/i.test(p) && selves.includes(p.replace(/^return /i, '').replace(/ to its owner's hand$/i, '').toLowerCase())) cost.returnSelf = true;
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
    const yourTurn = /Activate only during your turn/i.test(text);
    const threshold = text.match(/Activate only if there are (\w+) or more cards in your graveyard\./i);
    const minGraveyard = threshold ? toNumber(threshold[1]) : undefined;
    const needsDelirium = /Activate only if there are four or more card types among cards in your graveyard\./i.test(text);
    const oppLands = text.match(/Activate only if an opponent controls (\w+) or more lands\./i);
    const noCounter = text.match(/Activate only if there are no (charge) counters on this artifact\./i)?.[1] as CounterKind | undefined;
    if (/Activate (?:only|this ability only)/i.test(text.replace(/Activate only (?:as a sorcery|once each turn|during your turn|if there are \w+ or more cards in your graveyard|if there are no charge counters on this artifact|if there are four or more card types among cards in your graveyard|if an opponent controls \w+ or more lands)\.?/gi, ''))) continue;
    text = text.replace(/\s*Activate (?:only|this ability only)[^.]*\./gi, '').trim();
    // Phyrexian Devourer: "Put X +1/+1 counters on this creature, where X is the exiled card's mana value."
    if (cost.exileTop) {
      const counters = text.match(/^Put X \+1\/\+1 counters on (.+?), where X is the exiled card's mana value\.$/i);
      if (counters && selves.includes(counters[1].toLowerCase())) {
        out.push({ text: line, cost, ability: { targets: [], effects: [{ kind: 'addCounters', counter: '+1/+1', n: 'exiledMv', to: 'self' }] }, sorcery, once });
      }
      continue;
    }
    // Seasoned Hallowblade: "Tap this creature. It gains indestructible until end of turn." (read as Iron-Shield Elf's)
    text = text.replace(/^Tap this creature\. It gains ([a-z ,]+ until end of turn)\.$/i, 'This creature gains $1. Tap it.');
    const optional = /^you may /i.test(text);
    const body = optional ? `you ${text.slice('you may '.length)}` : text;
    // {S} must be paid with mana from a snow source, which the engine doesn't track (Faceless Haven).
    let ability = UNSUPPORTED.test(body) || cost.mana.includes('{S}') ? NO_EFFECT : parseAbilityText(body, name);
    // Parallax Wave: "When this enchantment leaves the battlefield, each player returns to the battlefield all cards
    // they own exiled with it." → its exile lasts until it leaves.
    if (returnsExiledWhenLeaving(card)) ability = { ...ability, effects: ability.effects.map((x) => (x.kind === 'destroy' && x.exile ? { ...x, untilLeaves: true } : x)) };
    // Stoneforge Mystic: choosing no card is the "may".
    const choosesNone = ability.effects.length === 1 && ability.effects[0].kind === 'putFromHand';
    out.push({ text: line, cost, ability: optional && ability.effects.length && !choosesNone ? { ...ability, optional } : ability, sorcery, once, ...(discountPer ? { discountPer } : {}), ...(yourTurn ? { yourTurn } : {}), ...(minGraveyard ? { minGraveyard } : {}), ...(noCounter ? { noCounter } : {}), ...(needsDelirium ? { delirium: true } : {}), ...(oppLands ? { opponentLands: toNumber(oppLands[1]) } : {}) });
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
export function stateMana(card: Card): 'imprinted' | 'legends' | 'luck' | 'perArtifact' | 'mining' | 'depletion' | 'noted' | 'reflect' | 'reflectThree' | 'perCreature' | 'perElf' | 'opponentLands' | null {
  const text = frontText(card);
  // Priest of Titania: "{T}: Add {G} for each Elf on the battlefield."
  if (/^\{T\}: Add \{G\} for each Elf on the battlefield\.$/m.test(text)) return 'perElf';
  // Gaea's Cradle: "{T}: Add {G} for each creature you control."
  if (/^\{T\}: Add \{G\} for each creature you control\.$/m.test(text)) return 'perCreature';
  // Fellwar Stone: "{T}: Add one mana of any color that a land an opponent controls could produce."
  if (/^\{T\}: Add one mana of any color that a land an opponent controls could produce\.$/m.test(text)) return 'opponentLands';
  // Reflecting Pool: "{T}: Add one mana of any type that a land you control could produce."
  if (/^\{T\}: Add one mana of any type that a land you control could produce\.$/m.test(text)) return 'reflect';
  // Incubation Druid: "… If this creature has a +1/+1 counter on it, add three mana of that type instead."
  if (/^\{T\}: Add one mana of any type that a land you control could produce\. If this creature has a \+1\/\+1 counter on it, add three mana of that type instead\.$/m.test(text)) return 'reflectThree';
  // Gemstone Mine: "{T}, Remove a mining counter from this land: Add one mana of any color. If there are no mining
  // counters on this land, sacrifice it."
  if (/^\{T\}, Remove a mining counter from this land: Add one mana of any color\. If there are no mining counters on this land, sacrifice it\.$/m.test(text)) return 'mining';
  // Jeweled Amulet: "{T}, Remove a charge counter from this artifact: Add one mana of this artifact's last noted type."
  if (/^\{T\}, Remove a charge counter from this artifact: Add one mana of this artifact's last noted type\.$/m.test(text)) return 'noted';
  // Hickory Woodlot: "{T}, Remove a depletion counter from this land: Add {G}{G}. If there are no depletion counters on
  // this land, sacrifice it."
  if (/^\{T\}, Remove a depletion counter from this land: Add \{G\}\{G\}\. If there are no depletion counters on this land, sacrifice it\.$/m.test(text)) return 'depletion';
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
export function entersCounters(card: Card): { counter: CounterKind; n: Amount | 'delvedSpells' } | null {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  // Leatherhead: "Leatherhead enters with a hexproof counter on her."
  const keyword = frontText(card).match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? with an? (flying|hexproof|indestructible|lifelink|trample|deathtouch|menace|reach|vigilance|first strike) counter on (?:it|him|her|them)\\.`, 'i'));
  if (keyword) return { counter: keyword[1].toLowerCase() as CounterKind, n: 1 };
  // Gemstone Mine: "This land enters with three mining counters on it."
  // Wishclaw Talisman: "This artifact enters with three wish counters on it."
  // Hickory Woodlot: "This land enters tapped with two depletion counters on it." (tapped: see entersTapped)
  const mining = frontText(card).match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)?(?: tapped)? with (${AMOUNT}) (mining|wish|depletion|charge) counters? on it\\.`, 'i'));
  if (mining) return { counter: mining[2].toLowerCase() as CounterKind, n: toAmount(mining[1]) };
  // Murktide Regent: "This creature enters with a +1/+1 counter on it for each instant and sorcery card exiled with it."
  if (new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? with a \\+1\\/\\+1 counter on it for each instant and sorcery card exiled with it\\.`, 'i').test(frontText(card))) return { counter: '+1/+1', n: 'delvedSpells' };
  const m = frontText(card).match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? with (${AMOUNT}) ([+-]1\\/[+-]1) counters? on (?:it|him|her|them)\\.`, 'i'));
  return m && (m[2] === '+1/+1' || m[2] === '-1/-1') ? { counter: m[2], n: toAmount(m[1]) } : null;
}

/** "This creature enters with N +1/+1 counters on it" (X: the value paid when cast). */
export function entersWithCounters(card: Card): Amount | null {
  const c = entersCounters(card);
  return c?.counter === '+1/+1' && c.n !== 'delvedSpells' ? c.n : null;
}

/** "This land enters tapped." (unconditional only: "unless …" and "if …" are not checked yet). */
export function entersTapped(card: Card): boolean {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  return new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped(?: with (?:${AMOUNT}) depletion counters? on it)?\\.(?:\\n|$)`, 'i').test(frontText(card));
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
  /** Elvish Reclaimer: "as long as there are three or more land cards in your graveyard". */
  graveCards?: { n: number; types?: CardType[] };
  /** "attacks each combat if able". */
  mustAttack?: boolean;
  /**
   * Lhurgoyfs: "+1/+1 for each card type among cards in your graveyard" (Nethergoyf: `you`) or "in all graveyards"
   * (Barrowgoyf, Tarmogoyf: `all`).
   */
  perGraveType?: 'you' | 'all';
  /** Dark Matter Manipulator: "for every seven cards in your graveyard". */
  perGraveCards?: number;
  keywords: Keyword[];
  /** "has … ward {2}" (Lavaspur Boots, Sheltered by Ghosts). */
  ward?: number;
  /** Hexing Squelcher: "Other creatures you control have "Ward—Pay 2 life."" */
  wardLife?: number;
  /** Dragonfire Blade: "has hexproof from monocolored". */
  hexproofFromMonocolored?: boolean;
  /** Curious Obsession: "has \"Whenever this creature deals combat damage to a player, you may draw a card.\"" */
  grants?: string;
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
    // Curious Obsession: the line may end with the granted ability's quote ("… draw a card.\"").
    const attached = line.match(/^(Enchanted|Equipped) creature (.+?)(?:\.|(?<=\."))$/);
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
      // Curious Obsession: "gets +1/+1 and has \"Whenever this creature deals combat damage to a player, you may draw a card.\""
      const granted = body.match(/^(?:gets ([+-]\d+)\/([+-]\d+) and )?has "([^"]+)"$/i);
      if (granted && understoodAbilities(granted[3])) {
        out.push({ who, power: Number(granted[1] ?? 0), toughness: Number(granted[2] ?? 0), keywords: [], grants: granted[3], ...extra });
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
    // Skrelv: "Skrelv can't block."
    const cant = line.match(new RegExp(`^(?:${selves}) can't (attack or block|attack|block)\\.$`, 'i'));
    if (cant) {
      out.push({ who: 'self', power: 0, toughness: 0, keywords: [], ...(/attack/i.test(cant[1]) ? { cantAttack: true } : {}), ...(/block/i.test(cant[1]) ? { cantBlock: true } : {}) });
      continue;
    }
    // Dark Matter Manipulator: "This creature gets +2/+0 for every seven cards in your graveyard."
    const perGrave = line.match(new RegExp(`^(?:${selves}) gets \\+(\\d+)\\/\\+(\\d+) for every (\\w+) cards in your graveyard\\.$`, 'i'));
    if (perGrave) {
      out.push({ who: 'self', power: Number(perGrave[1]), toughness: Number(perGrave[2]), keywords: [], perGraveCards: toNumber(perGrave[3]) });
      continue;
    }
    // Barrowgoyf: "Barrowgoyf's power is equal to the number of card types among cards in all graveyards and its
    // toughness is equal to that number plus 1." (its printed */1+* is 0/1)
    const goyf = line.match(new RegExp(`^(?:${selves})'s power is equal to the number of card types among cards in (all graveyards|your graveyard) and its toughness is equal to that number plus 1\\.$`, 'i'));
    if (goyf) {
      out.push({ who: 'self', power: 1, toughness: 1, keywords: [], perGraveType: goyf[1].toLowerCase() === 'your graveyard' ? 'you' : 'all' });
      continue;
    }
    // Elvish Reclaimer: "This creature gets +2/+2 as long as there are three or more land cards in your graveyard."
    const grave = line.match(new RegExp(`^(?:${selves}) gets \\+(\\d+)\\/\\+(\\d+) as long as there are (\\w+) or more ([a-z]+ )?cards in your graveyard\\.$`, 'i'));
    const graveTypes = grave?.[4] ? cardWordsFilter(grave[4].trim())?.types : undefined;
    if (grave && (!grave[4] || graveTypes)) {
      out.push({ who: 'self', power: Number(grave[1]), toughness: Number(grave[2]), keywords: [], graveCards: { n: toNumber(grave[3]), ...(graveTypes ? { types: graveTypes } : {}) } });
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
    // Ardyn: "Demons you control have menace, lifelink, and haste." (a creature type without the word "creatures")
    const tribal = line.match(/^(Other )?([A-Z][a-z]+?)s you control (get|have) /);
    const tribe = tribal && tribal[2].replace(/ve$/, 'f'); // Elves, Wolves, Dwarves
    const anthemLine = tribal && !/^Creature$/i.test(tribal[2]) ? line.replace(tribal[0], `${tribal[1] ?? ''}${tribe} creatures you control ${tribal[3]} `) : line;
    const anthem = anthemLine.match(/^((?:Other )?[A-Za-z ]*?[Cc]reatures?(?: you control| your opponents control| you don't control)?) (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?|have (.+))\.$/);
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
  // Utopia Sprawl: "Enchant Forest".
  const basic = m?.[1].match(/^(Plains|Island|Swamp|Mountain|Forest)$/);
  if (basic) return { kind: 'permanent', min: 1, max: 1, filter: { types: ['land'], subtypes: [basic[1].toLowerCase()] } };
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
/** Black Panther: "Prevent all damage that would be dealt to Black Panther." */
export function preventsDamageToSelf(card: Card): boolean {
  const selves = selfWords(selfName(card)).map(escapeRe).join('|');
  return new RegExp(`^Prevent all damage that would be dealt to (?:${selves})\\.$`, 'mi').test(frontText(card));
}

/** Skycoach Conductor: "This creature enters prepared." (a copy of its other face's spell can be cast once). */
export const entersPrepared = (card: Card) => /^This creature enters prepared\.(?: \([^)]*\))?$/m.test(frontText(card));

/**
 * Swift Reconfiguration: "Enchanted permanent is a Vehicle artifact with crew 5 and it loses all other card types."
 * The crew number.
 */
export function reconfiguresEnchanted(card: Card): number | null {
  const m = frontText(card).match(/^Enchanted permanent is a Vehicle artifact with crew (\d+) and it loses all other card types\.(?: \([^)]*\))?$/m);
  return m ? Number(m[1]) : null;
}

/**
 * Filter lands: two mana for one other mana. Mystic Gate: "{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}." (the fee: one
 * mana of the two colors); Skycloud Expanse: "{1}, {T}: Add {W}{U}." (the fee: any one mana, `fee` null).
 */
export function filterMana(card: Card): { fee: Color[] | null; units: Color[][] } | null {
  const text = frontText(card);
  const gate = text.match(/^\{([WUBRG])\/([WUBRG])\}, \{T\}: Add \{\1\}\{\1\}, \{\1\}\{\2\}, or \{\2\}\{\2\}\.$/m);
  if (gate) {
    const pair = [gate[1], gate[2]] as Color[];
    return { fee: pair, units: [pair, pair] };
  }
  const two = text.match(/^\{1\}, \{T\}: Add \{([WUBRG])\}\{([WUBRG])\}\.$/m);
  return two ? { fee: null, units: [[two[1] as Color], [two[2] as Color]] } : null;
}

/**
 * Talon Gates of Madara, Giant's Boulder: "{1}, {T}: Add one mana of any color." Its mana costs one other mana (the
 * payment planner spends that one too; see `paid` in ManaSource).
 */
export const paidAnyColor = (card: Card) => /^\{1\}, \{T\}: Add one mana of any color\.$/m.test(frontText(card));

/**
 * Wall of Roots: "Put a -0/-1 counter on this creature: Add {G}. Activate only once each turn." The color, or null. (It
 * doesn't tap: usable tapped or summoning sick.)
 */
export function counterMana(card: Card): Color | null {
  const m = frontText(card).match(new RegExp(`^Put a -0/-1 counter on (?:${selfWords(card.name).map(escapeRe).join('|')}): Add \\{([WUBRG])\\}\\. Activate only once each turn\\.$`, 'im'));
  return m ? (m[1] as Color) : null;
}

/** Eldrazi Spawn: "Sacrifice this token: Add {C}." (no tap: usable summoning sick). The color, or null. */
export function sacrificeMana(card: Card): Color[][] | null {
  // Tinder Wall: "Sacrifice this creature: Add {R}{R}."
  const m = frontText(card).match(/^Sacrifice this (?:token|creature|artifact): Add ((?:\{[WUBRGC]\})+)\.$/m);
  return m ? [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => [x[1] as Color]) : null;
}

/** The Cabbage Merchant: "Tap two untapped Foods you control: Add one mana of any color." */
export const foodMana = (card: Card) => /^Tap two untapped Foods you control: Add one mana of any color\.$/m.test(frontText(card));

/** Lion's Eye Diamond: "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant." */
export const diamondMana = (card: Card) =>
  /^Discard your hand, Sacrifice this artifact: Add three mana of any one color\. Activate only as an instant\.$/m.test(frontText(card));

/** Extra mana when a permanent is tapped for mana (a triggered mana ability). */
export interface ExtraMana {
  /** Wild Growth: the enchanted permanent's taps; Badgermole Cub: its controller's; Mana Flare: anyone's. */
  whose: 'enchanted' | 'yours' | 'anyones';
  /** What is tapped: Badgermole Cub a creature, Kinnan a nonland permanent, Mana Flare a land. */
  kind: 'land' | 'creature' | 'nonland' | 'permanent';
  /**
   * The mana added; 'same': one mana of a type that permanent produced (Kinnan, Mana Flare); 'chosen': one mana of the
   * color chosen as it entered (Utopia Sprawl).
   */
  add: Color[][] | 'same' | 'chosen';
}

const extraManaText = (text: string): ExtraMana['add'] | null =>
  /^(?:one )?(?:additional )?(?:one )?mana of any type that (?:land|permanent) produced$/i.test(text) ? 'same'
    : /^one mana of the chosen color$/i.test(text) ? 'chosen' : parseManaText(text);

/**
 * Wild Growth: "Whenever enchanted land is tapped for mana, its controller adds an additional {G}."
 * Badgermole Cub: "Whenever you tap a creature for mana, add an additional {G}." Kinnan: "Whenever you tap a nonland
 * permanent for mana, add one mana of any type that permanent produced." Mana Flare: "Whenever a player taps a land for
 * mana, that player adds one mana of any type that land produced."
 */
export function extraManaOf(card: Card): ExtraMana | null {
  for (const line of frontText(card).split('\n')) {
    const aura = line.match(/^Whenever enchanted (land|creature|permanent|Plains|Island|Swamp|Mountain|Forest) is tapped for mana, its controller adds an additional (.+)\.$/);
    const tap = line.match(/^Whenever (you tap|a player taps) an? (land|creature|nonland permanent|permanent) for mana, (?:that player adds|add) (?:an additional )?(.+)\.$/);
    const add = aura ? extraManaText(aura[2]) : tap ? extraManaText(tap[3]) : null;
    if (!add) continue;
    // "As this Aura enters, choose a color." goes with the chosen color.
    if (add === 'chosen' && !choosesColor(card)) continue;
    if (aura) return { whose: 'enchanted', kind: /^[a-z]/.test(aura[1]) ? aura[1] as ExtraMana['kind'] : 'land', add };
    return { whose: tap![1] === 'you tap' ? 'yours' : 'anyones', kind: tap![2] === 'nonland permanent' ? 'nonland' : tap![2] as ExtraMana['kind'], add };
  }
  return null;
}

/** Utopia Sprawl: "As this Aura enters, choose a color." */
export const choosesColor = (card: Card) => /^As this (?:Aura|enchantment|artifact|creature|land|permanent) enters, choose a color\.$/m.test(frontText(card));

/** Nyxbloom Ancient: "If you tap a permanent for mana, it produces three times as much of that mana instead." → 3. */
export function manaMultiplier(card: Card): number {
  const m = frontText(card).match(/^If you tap a permanent for mana, it produces (twice|three times) as much of that mana instead\.$/m);
  return m ? (m[1] === 'twice' ? 2 : 3) : 1;
}

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
/** Anointed Peacekeeper: "As this creature enters, look at an opponent's hand, then choose any card name." */
export const namesAnyCard = (card: Card) =>
  /^As this creature enters, look at an opponent's hand, then choose any card name\.$/m.test(frontText(card));

/**
 * Spells with the permanent's chosen name cost more: Disruptor Flute "Spells with the chosen name cost {3} more to
 * cast." (everyone's), Anointed Peacekeeper "Spells your opponents cast with the chosen name cost {2} more to cast."
 * `abilities`: Peacekeeper's "Activated abilities of sources with the chosen name cost {2} more to activate unless
 * they're mana abilities."
 */
export function chosenNameTax(card: Card): { spells: number; opponents: boolean; abilities: number } | null {
  const text = frontText(card);
  const m = text.match(/^Spells (your opponents cast )?with the chosen name (?:your opponents cast )?cost \{(\d+)\} more to cast\.$/m);
  if (!m) return null;
  const abilities = text.match(/^Activated abilities of sources with the chosen name cost \{(\d+)\} more to activate unless they're mana abilities\.$/m);
  return { spells: Number(m[2]), opponents: !!m[1], abilities: abilities ? Number(abilities[1]) : 0 };
}

export const namesSpellToStop = (card: Card) =>
  /^As this creature enters, choose a nonland card name\.$/m.test(frontText(card)) && /^Spells with the chosen name can't be cast\.$/m.test(frontText(card));

/**
 * Skyclave Apparition: "When this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion
 * creature token, where X is the mana value of the exiled card."
 */
export const illusionWhenLeaving = (card: Card) =>
  /^When this creature leaves the battlefield, the exiled card's owner creates an X\/X blue Illusion creature token, where X is the mana value of the exiled card\.$/m.test(frontText(card));

/** Parallax Wave: "When this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it." */
export const returnsExiledWhenLeaving = (card: Card) =>
  /^When this (?:enchantment|artifact|creature|permanent) leaves the battlefield, each player returns to the battlefield all cards they own exiled with it\.$/m.test(frontText(card));

/** Fading N: "This enchantment enters with N fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it." */
export function fadingOf(card: Card): number {
  const m = frontText(card).match(/^Fading (\d+)$/m);
  return m ? Number(m[1]) : 0;
}

/** "When this creature's power is 7 or greater, sacrifice it." → 7 (the line's subject is one of `selves`). */
function powerLimitLine(line: string, selves: string[]): number | null {
  const m = line.match(/^When (.+?)'s power is (\d+) or greater, sacrifice it\.$/i);
  return m && selves.includes(m[1].toLowerCase()) ? Number(m[2]) : null;
}

/** Split second: "As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities." */
export const hasSplitSecond = (card: Card) => /^Split second(?: \(|$)/m.test(frontText(card));

/** A permanent changing what spells cost: Helm of Awakening, Goblin Warchief, God-Pharaoh's Statue. */
export interface SpellCostMod {
  /** Whose spells: everyone's, its controller's, or its controller's opponents'. */
  whose: 'all' | 'you' | 'opponents';
  /** Negative: less; positive: more. */
  n: number;
  /** Goblin Warchief: "Goblin spells"; Ancient Cellarspawn: "a Demon, Horror, or Nightmare". */
  subtypes?: string[];
}

export function spellCostMods(card: Card): SpellCostMod[] {
  const out: SpellCostMod[] = [];
  for (const line of frontText(card).split('\n')) {
    let m;
    // Helm of Awakening: "Spells cost {1} less to cast."; God-Pharaoh's Statue: "Spells your opponents cast cost {2} more to cast."
    if ((m = line.match(/^Spells (your opponents cast |you cast )?cost \{(\d+)\} (less|more) to cast\.$/))) {
      out.push({ whose: !m[1] ? 'all' : m[1].startsWith('your') ? 'opponents' : 'you', n: Number(m[2]) * (m[3] === 'less' ? -1 : 1) });
    } else if ((m = line.match(/^([A-Z][a-z]+) spells you cast cost \{(\d+)\} (less|more) to cast\.$/))) {
      // Goblin Warchief: "Goblin spells you cast cost {1} less to cast."
      out.push({ whose: 'you', n: Number(m[2]) * (m[3] === 'less' ? -1 : 1), subtypes: [m[1].toLowerCase()] });
    } else if ((m = line.match(/^Each spell you cast that's an? ((?:[A-Z][a-z]+, )*[A-Z][a-z]+,? or [A-Z][a-z]+) costs \{(\d+)\} less to cast\.$/))) {
      // Ancient Cellarspawn: "Each spell you cast that's a Demon, Horror, or Nightmare costs {1} less to cast."
      out.push({ whose: 'you', n: -Number(m[2]), subtypes: m[1].split(/,? or |, /).map((t) => t.toLowerCase()) });
    }
  }
  return out;
}

/**
 * Defend the Rider's Pilot: "This token saddles Mounts and crews Vehicles as though its power were 2 greater." → 2 (saddle
 * isn't simulated: crewing only).
 */
export function crewBonus(card: Card): number {
  const m = frontText(card).match(/^This (?:token|creature) saddles Mounts and crews Vehicles as though its power were (\d+) greater\.$/m);
  return m ? Number(m[1]) : 0;
}

/**
 * Kaito, Bane of Nightmares: "During your turn, as long as Kaito has one or more loyalty counters on him, he's a 3/4 Ninja
 * creature and has hexproof."
 */
export function creatureOnYourTurn(card: Card): { power: number; toughness: number; subtype: string; keywords: Keyword[] } | null {
  const selves = selfWords(card.name).map(escapeRe).join('|');
  const m = frontText(card).match(new RegExp(`^During your turn, as long as (?:${selves}) has one or more loyalty counters on (?:him|her|it), (?:he|she|it)'s an? (\\d+)\\/(\\d+) ([A-Z][a-z]+) creature(?: and has ${KEYWORD_LIST})?\\.$`, 'im'));
  return m ? { power: Number(m[1]), toughness: Number(m[2]), subtype: m[3], keywords: keywordList(m[4]) } : null;
}

/** Vanishing N: "This permanent enters with N time counters on it." */
export function vanishingOf(card: Card): number {
  const m = frontText(card).match(/^Vanishing (\d+)(?: \(|$)/m);
  return m ? Number(m[1]) : 0;
}

/**
 * Enlist: "As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When
 * you do, add its power to this creature's until end of turn."
 */
export const hasEnlist = (card: Card) => /^Enlist(?: \(|$)/m.test(frontText(card));

/** True-Name Nemesis: "As this creature enters, choose a player." and "This creature has protection from the chosen player." */
export const protectionFromChosenPlayer = (card: Card) =>
  /^As this creature enters, choose a player\.$/m.test(frontText(card)) && /^This creature has protection from the chosen player\.$/m.test(frontText(card));

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
  | { kind: 'unlessEarlyTurn'; n: number }
  /** Eddymurk Crab: "This creature enters tapped if it's not your turn." */
  | { kind: 'notYourTurn' }
  /** Rejuvenating Springs: "This land enters tapped unless you have two or more opponents." */
  | { kind: 'unlessOpponents'; n: number }
  /** Theorist's Sanctum: "As this land enters, you may behold a Jace. If you don't, this land enters tapped." */
  | { kind: 'unlessBehold'; subtype: string };

/** When a permanent enters tapped. */
export function entersTappedRule(card: Card): EntersTappedRule | null {
  const text = frontText(card);
  const behold = text.match(/^As this land enters, you may behold an? ([A-Z][a-z]+)\. If you don't, this land enters tapped\.(?: \([^)]*\))?$/m);
  if (behold) return { kind: 'unlessBehold', subtype: behold[1].toLowerCase() };
  const selves = selfWords(card.name).map(escapeRe).join('|');
  if (entersTapped(card)) return { kind: 'always' };
  const early = text.match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped unless it's your (first|first or second|first, second, or third) turn of the game\\.`, 'i'));
  if (early) return { kind: 'unlessEarlyTurn', n: early[1].split(/,? or |, /).length };
  if (new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped if it's not your turn\\.`, 'i').test(text)) return { kind: 'notYourTurn' };
  const opponents = text.match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped unless you have (two|three) or more opponents\\.`, 'i'));
  if (opponents) return { kind: 'unlessOpponents', n: toNumber(opponents[1]) };
  // Lair of the Hydra: "If you control two or more other lands, this land enters tapped." (a fast land)
  const fast = text.match(new RegExp(`(?:^|\\n)If you control (two|three) or more other lands, (?:${selves}) enters(?: the battlefield)? tapped\\.`, 'i'));
  if (fast) return { kind: 'unlessOtherLands', max: toNumber(fast[1]) - 1 };
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
  /** Jace, Wielder of Mysteries: "If you would draw a card while your library has no cards in it, you win the game instead." */
  | 'emptyLibraryWins'
  /** High Noon: "Each player can't cast more than one spell each turn." */
  | 'oneSpellEachTurn'
  /** Yavimaya, Cradle of Growth: "Each land is a Forest in addition to its other land types." */
  | 'landsAreForests'
  /** Urborg, Tomb of Yawgmoth: "Each land is a Swamp in addition to its other land types." */
  | 'landsAreSwamps'
  /** Cryptolith Rite, Enduring Vitality: "Creatures you control have "{T}: Add one mana of any color."" */
  | 'creaturesTapForAnyColor'
  /** Tezzeret, Betrayer of Flesh: "The first activated ability of an artifact you activate each turn costs {2} less to activate." */
  | 'firstArtifactAbilityCostsLess'
  /**
   * Biomancer's Familiar: "Activated abilities of creatures you control cost {2} less to activate. This effect can't
   * reduce the mana in that cost to less than one mana."
   */
  | 'creatureAbilitiesCostLess'
  /** Samut, Tyrant of Naktamun: "Instant and sorcery spells you control have split second." */
  | 'yourSpellsSplitSecond'
  /**
   * Underworld Breach: "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost
   * plus exile three other cards from your graveyard."
   */
  | 'graveyardEscape'
  /** Lurrus: "Once during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard." */
  | 'lurrus'
  /**
   * Grand Abolisher: "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures,
   * or enchantments." (mana abilities included)
   */
  | 'abolisher'
  /** Necropotence: "Skip your draw step." */
  | 'skipDraw'
  /** Shang-Chi: "You may activate abilities of creatures you control as though those creatures had haste." */
  | 'abilitiesHaste'
  /** Karn, the Great Creator: "Activated abilities of artifacts your opponents control can't be activated." */
  | 'opponentsArtifactAbilitiesForbidden'
  /** Cursed Totem: "Activated abilities of creatures can't be activated." (mana abilities included) */
  | 'noCreatureAbilities'
  /** Ashiok, Dream Render: "Spells and abilities your opponents control can't cause their controller to search their library." */
  | 'opponentsCantSearch'
  /** Archon of Emeria: "Nonbasic lands your opponents control enter tapped." */
  | 'opponentsNonbasicsEnterTapped'
  /** Manglehorn: "Artifacts your opponents control enter tapped." */
  | 'opponentsArtifactsEnterTapped'
  /** Root Maze: "Artifacts and lands enter tapped." */
  | 'artifactsLandsEnterTapped'
  /** Bilbo, Thief in the Night: "Spells you cast from anywhere other than your hand cost {1} less to cast." */
  | 'notFromHandCostsLess'
  /** Valley Floodcaller: "You may cast noncreature spells as though they had flash." */
  | 'noncreatureFlash'
  /** Frenzied Baloth: "Creature spells you control can't be countered." */
  | 'creatureSpellsUncounterable'
  /** Frenzied Baloth: "Combat damage can't be prevented." */
  | 'combatDamageCantBePrevented'
  /** Exploration: "You may play an additional land on each of your turns." */
  | 'extraLand'
  /** Sunspine Lynx: "Players can't gain life." */
  | 'noLifeGain'
  /** Sunspine Lynx: "Damage can't be prevented." (protection, shields and Fog included) */
  | 'damageCantBePrevented'
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
  | 'nonbasicLandsAreMountains'
  /** Harbinger of the Seas: "Nonbasic lands are Islands." */
  | 'nonbasicLandsAreIslands'
  /** Aven Interrupter: "Spells your opponents cast from graveyards or from exile cost {2} more to cast." */
  | 'opponentsGraveyardExileSpellsCost2';

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
  [/^Artifacts and creatures entering(?: the battlefield)? don't cause abilities to trigger\.$/m, 'noEntersTriggers'],
  [/^If you would draw a card while your library has no cards in it, you win the game instead\.$/m, 'emptyLibraryWins'],
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
  [/^Nonbasic lands are Islands\.$/m, 'nonbasicLandsAreIslands'],
  [/^Spells your opponents cast from graveyards or from exile cost \{2\} more to cast\.$/m, 'opponentsGraveyardExileSpellsCost2'],
  [/^Players can't gain life\.$/m, 'noLifeGain'],
  [/^Activated abilities of artifacts your opponents control can't be activated\.$/m, 'opponentsArtifactAbilitiesForbidden'],
  [/^Activated abilities of creatures can't be activated\.$/m, 'noCreatureAbilities'],
  [/^Spells and abilities your opponents control can't cause their controller to search their library\.$/m, 'opponentsCantSearch'],
  [/^Nonbasic lands your opponents control enter(?: the battlefield)? tapped\.$/m, 'opponentsNonbasicsEnterTapped'],
  [/^Artifacts your opponents control enter(?: the battlefield)? tapped\.$/m, 'opponentsArtifactsEnterTapped'],
  [/^Artifacts and lands enter(?: the battlefield)? tapped\.$/m, 'artifactsLandsEnterTapped'],
  [/^Spells you cast from anywhere other than your hand cost \{1\} less to cast\.$/m, 'notFromHandCostsLess'],
  [/^You may cast noncreature spells as though they had flash\.$/m, 'noncreatureFlash'],
  [/^Creature spells you control can't be countered\.$/m, 'creatureSpellsUncounterable'],
  [/^Combat damage can't be prevented\.$/m, 'combatDamageCantBePrevented'],
  [/^You may play an additional land on each of your turns\.$/m, 'extraLand'],
  [/^Creatures you control have "\{T\}: Add one mana of any color\."$/m, 'creaturesTapForAnyColor'],
  [/^The first activated ability of an artifact you activate each turn costs \{2\} less to activate\.$/m, 'firstArtifactAbilityCostsLess'],
  [/^Activated abilities of creatures you control cost \{2\} less to activate\. This effect can't reduce the mana in that cost to less than one mana\.$/m, 'creatureAbilitiesCostLess'],
  [/^Instant and sorcery spells you control have split second\.(?: \([^)]*\))?$/m, 'yourSpellsSplitSecond'],
  [/^Each nonland card in your graveyard has escape\. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard\.(?: \([^)]*\))?$/m, 'graveyardEscape'],
  [/^Once during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard\.$/m, 'lurrus'],
  [/^During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments\.$/m, 'abolisher'],
  [/^Skip your draw step\.$/m, 'skipDraw'],
  [/^You may activate abilities of creatures you control as though those creatures had haste\.$/m, 'abilitiesHaste'],
  [/^Damage can't be prevented\.$/m, 'damageCantBePrevented'],
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

/** What a clone copies, and what its copy has in addition (see cloneOf). */
export interface CloneSpec {
  filter: TargetFilter;
  mine: boolean;
  subtypes: string[];
  artifact?: boolean;
  /** Phantasmal Image: "and it has \"When this creature becomes the target of a spell or ability, sacrifice it.\"" */
  grants?: string;
  /** Flesh Duplicate: "except it has vanishing 3 if that creature doesn't have vanishing". */
  vanishing?: number;
  /** Superior Spider-Man: a creature card in any graveyard, exiled once copied. */
  graveyard?: boolean;
  /** Superior Spider-Man: "except his name is Superior Spider-Man and he's a 4/4". */
  name?: string;
  pt?: [number, number];
}

/**
 * Clones: "You may have this creature enter as a copy of any creature on the battlefield." What may be copied
 * (Glasspool Mimic: "a creature you control"; Clever Impersonator: "any nonland permanent"; Copy Enchantment: "any
 * enchantment"), and the creature types added by "except it's a Shapeshifter Rogue in addition to its other types".
 */
export function cloneOf(card: Card): CloneSpec | null {
  const text = frontText(card).replace(/\s*\([^)]*\)/g, '');
  // Superior Spider-Man: "Mind Swap — You may have Superior Spider-Man enter as a copy of any creature card in a
  // graveyard, except his name is Superior Spider-Man and he's a 4/4 Spider Human Hero in addition to his other types.
  // When you do, exile that card."
  const grave = text.match(/^(?:[A-Z][A-Za-z' ]+ — )?You may have [^.]+? enter as a copy of any creature card in a graveyard, except (?:his|her|its) name is ([^.]+?) and (?:he's|she's|it's) an? (\d+)\/(\d+) ([A-Z][a-z]+(?: [A-Z][a-z]+)*) in addition to (?:his|her|its) other types\. When you do, exile that card\.$/m);
  if (grave) {
    return { filter: { types: ['creature'] }, mine: false, subtypes: grave[4].split(' '), graveyard: true, name: grave[1], pt: [Number(grave[2]), Number(grave[3])] };
  }
  const m = text.match(/^You may have (?:this (?:creature|artifact|enchantment)|[^.]+?) enter(?: the battlefield)? as a copy of (any creature|a creature you control|any nonland permanent|any artifact or creature|any artifact|any enchantment)(?: on the battlefield)?(?:, except (?:it's|they're) an? ([A-Z][a-z]+(?: [A-Z][a-z]+)*|artifact) in addition to (?:its|their) other types(?: and it has "([^"]+)")?|, except it has vanishing (\d+) if that creature doesn't have vanishing)?(?:\.|(?<=\."))$/m);
  if (!m) return null;
  const what = m[1];
  const filter: TargetFilter = what === 'any nonland permanent' ? { nonTypes: ['land'] }
    // Phyrexian Metamorph: "any artifact or creature".
    : what === 'any artifact or creature' ? { types: ['artifact', 'creature'] }
    : { types: [what.split(' ').pop() === 'enchantment' ? 'enchantment' : what.split(' ').pop() === 'artifact' ? 'artifact' : 'creature'] };
  // Phyrexian Metamorph: "except it's an artifact in addition to its other types" (a card type, not a subtype).
  if (m[2] === 'artifact') return { filter, mine: false, subtypes: [], artifact: true };
  return {
    filter, mine: what === 'a creature you control', subtypes: m[2] ? m[2].split(' ') : [],
    ...(m[3] ? { grants: m[3] } : {}), ...(m[4] ? { vanishing: Number(m[4]) } : {}),
  };
}

export const entersAsCopy = (card: Card) => !!cloneOf(card);
