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

export const isCreature = (card: Card) => primaryType(card) === 'Creature';
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
 */
export function parseManaText(text: string): Color[][] | null {
  const t = text.trim().replace(/\.$/, '');
  const any = t.match(/^(one|two|three|four|five) mana of any (?:one )?color$/i);
  if (any) return Array.from({ length: MANA_WORDS[any[1].toLowerCase()] }, () => [...ALL_COLORS]);
  if (/^(\{[WUBRGC]\})+$/.test(t)) return [...t.matchAll(/\{([WUBRGC])\}/g)].map((m) => [m[1] as Color]);
  // "{R} or {G}", "{W}, {U}, or {B}": one mana, a choice of colors.
  if (/^\{[WUBRGC]\}(?:,? (?:or )?\{[WUBRGC]\})+$/.test(t)) return [[...t.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as Color)];
  return null;
}

/**
 * The mana a permanent makes when tapped: basic land types plus "{T}: Add …" abilities. With several
 * one-mana abilities (pain lands), one mana of any of their colors; otherwise the biggest ability.
 */
export function manaUnits(card: Card): Color[][] {
  const single = new Set<Color>();
  let best: Color[][] = [];
  const front = card.typeLine.split('//')[0];
  for (const [type, color] of BASIC_TYPES) if (front.includes(type)) single.add(color);
  for (const line of frontText(card).split('\n')) {
    const m = line.match(/^\{T\}(?:, Sacrifice [^:]*)?:\s*Add ([^.]*)\./);
    if (!m) continue;
    const units = parseManaText(m[1]);
    if (!units) continue;
    if (units.length === 1) units[0].forEach((c) => single.add(c));
    else if (units.length > best.length) best = units;
  }
  if (best.length) return best;
  return single.size ? [[...single]] : [];
}

/** Colors a permanent can tap for. */
export const manaColors = (card: Card): Color[] => [...new Set(manaUnits(card).flat())];

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
  /** Spent only when nothing else can pay (convoke creatures, delve cards). */
  last?: boolean;
}

/** One mana spent: unit `index` of source `iid`. */
export interface ManaPick {
  iid: string;
  index: number;
}

/**
 * Picks the mana to spend on a cost, or null if it can't be paid. Mana in the pool is spent first,
 * then mana of sources tapped anyway (Sol Ring's second mana), then single-color sources.
 */
export function planPayment(sources: ManaSource[], cost: Cost): ManaPick[] | null {
  const units = sources.flatMap((s) => (s.units ?? [s.colors]).map((colors, index) => ({
    iid: s.iid, index, colors, pool: s.iid.startsWith('pool:'), size: (s.units ?? [s.colors]).length, last: !!s.last,
  })));
  if (units.length < cost.generic + cost.colored.length) return null;
  // Pool first, then bigger sources (their other mana would be wasted), then the least flexible.
  units.sort((a, b) => Number(b.pool) - Number(a.pool) || Number(a.last) - Number(b.last) || b.size - a.size || a.colors.length - b.colors.length);
  const reqs = [...cost.colored].sort((a, b) => a.length - b.length);
  const used = new Set<number>();

  const assign = (i: number): boolean => {
    if (i === reqs.length) return true;
    for (let u = 0; u < units.length; u++) {
      if (used.has(u) || !units[u].colors.some((c) => reqs[i].includes(c))) continue;
      used.add(u);
      if (assign(i + 1)) return true;
      used.delete(u);
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
    const pick = open.find((u) => units[u].pool) ?? open.find((u) => busy.has(units[u].iid)) ?? open[0];
    used.add(pick);
  }
  return [...used].map((u) => ({ iid: units[u].iid, index: units[u].index }));
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
  minPower?: number;
  maxPower?: number;
  /** Basic lands only ("basic land card"). */
  basic?: boolean;
  /** At least one of these subtypes ("Forest or Plains card"), lower case. */
  subtypes?: string[];
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
export type CounterKind = '+1/+1' | '-1/-1' | 'loyalty';

/**
 * Who an effect applies to: the targets chosen for a slot, the controller, everyone / each opponent,
 * or the ability's own source ("this creature gets +1/+1").
 */
export type Affected = { slot: number } | 'you' | 'each-opponent' | 'each-player' | 'self';

/** A number in rules text; "X" is the value chosen when casting. */
export type Amount = number | 'X';

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
  | { kind: 'counter'; to: Affected; unlessPays?: number }
  /** "gets +N/+N (and gains …) until end of turn". Negative values shrink. */
  | { kind: 'pump'; power: number; toughness: number; keywords: Keyword[]; to: Affected }
  | { kind: 'destroy'; exile: boolean; to: Affected }
  | { kind: 'draw'; n: Amount; to: Affected }
  | { kind: 'gainLife'; n: Amount; to: Affected }
  | { kind: 'loseLife'; n: Amount; to: Affected }
  | { kind: 'addCounters'; counter: CounterKind; n: Amount; to: Affected }
  /** `filter` limits what the spell's controller may pick ("a nonland card") with casterChooses. */
  | { kind: 'discard'; n: Amount; to: Affected; mode: DiscardMode; filter?: TargetFilter }
  | { kind: 'mill'; n: Amount; to: Affected }
  | { kind: 'scry'; n: Amount }
  | { kind: 'surveil'; n: Amount }
  | { kind: 'tap'; untap: boolean; to: Affected }
  /** Return to its owner's hand. */
  | { kind: 'bounce'; to: Affected }
  | { kind: 'bounceAll'; which: Selector }
  | { kind: 'destroyAll'; exile: boolean; which: Selector }
  /** Damage to each matching creature, and optionally to each player or each opponent. */
  | { kind: 'damageAll'; amount: Amount; which: Selector; players?: 'each-player' | 'each-opponent' }
  | { kind: 'pumpAll'; power: number; toughness: number; keywords: Keyword[]; which: Selector }
  /** `a` and `b` deal damage equal to their power to each other; only `a` deals damage when `oneSided` ("bite"). */
  | { kind: 'fight'; a: { slot: number }; b: { slot: number }; oneSided: boolean }
  /** Each affected player sacrifices N permanents of their choice ("edict"). */
  | { kind: 'sacrifice'; n: Amount; to: Affected; which: Selector }
  /** "Sacrifice this creature" as an effect (Ball Lightning). */
  | { kind: 'sacrificeSelf' }
  /** Create N tokens under the controller's control. */
  | { kind: 'token'; n: Amount; token: TokenSpec }
  /** A card in a graveyard goes to its owner's hand, or onto the battlefield under the controller's control. */
  | { kind: 'returnCard'; to: Affected; dest: 'hand' | 'battlefield' }
  /** "Put a +1/+1 counter on each creature you control" (`other`: except the source). */
  | { kind: 'addCountersAll'; counter: CounterKind; n: Amount; which: Selector; other: boolean }
  /** Mana into the controller's pool (rituals: "Add {B}{B}{B}"). One entry per mana, with its possible colors. */
  | { kind: 'addMana'; units: Color[][] }
  /** Search your library for up to `n` matching cards, then shuffle. */
  | { kind: 'search'; n: number; filter: TargetFilter; dest: 'hand' | 'battlefield'; tapped: boolean }
  /** Equip: attach the ability's source to the target. */
  | { kind: 'attach'; to: Affected }
  | { kind: 'poison'; n: Amount; to: Affected }
  /** Add one counter of each kind already there: chosen automatically (the controller's side gains, opponents lose). */
  | { kind: 'proliferate' }
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
}

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

/** "basic land", "Forest or Plains", "creature" (the cards a library search may find). */
function librarySearchFilter(words: string): TargetFilter | null {
  const filter: TargetFilter = {};
  for (const w of words.toLowerCase().replace(/,? or |, /g, ' ').split(' ').filter(Boolean)) {
    if (w === 'basic') filter.basic = true;
    else if (LAND_TYPES.includes(w)) (filter.subtypes ??= []).push(w);
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
  return [front, front.split(',')[0], 'this creature', 'this permanent', 'this artifact', 'this enchantment', 'this land', 'this token', 'this aura', 'this equipment'];
}

/**
 * Recognizes common effects in rules text (a spell's text, or an ability's).
 * Anything else is not simulated. `self` is the name of the card the ability is on, so
 * "Goblin Guide gets +1/+1" or "put a +1/+1 counter on this creature" can refer to it.
 */
export function parseAbilityText(text: string, self?: string): AbilitySpec {
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
    return slotFor(w, (spec) => spec.kind === 'player');
  };
  /** "creatures you don't control" → which permanents an "all"/"each" effect touches. */
  const selector = (phrase: string): Selector | null => {
    const spec = parseTargetPhrase(`target ${phrase.replace(/^(?:all|other) /i, '')}`);
    if (!spec || (spec.kind !== 'creature' && spec.kind !== 'permanent')) return null;
    return { kind: spec.kind, filter: spec.filter };
  };
  const PLAYER = '(target player|target opponent|each player|each opponent|you)';

  scan(new RegExp(`deals (\\d+|X) damage to (each opponent|each player|${TARGET})${END}`, 'gi'), (m) => {
    const w = m[2].toLowerCase();
    const to = w === 'each opponent' ? 'each-opponent' : w === 'each player' ? 'each-player' : slotFor(m[2]);
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
  scan(new RegExp(`\\bsearch your library for (up to ${NUMBER} |an? |${NUMBER} )([a-z ,-]+?) cards?(?: with mana value (\\d+) or less)?, (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?)(?:,? (?:then|and) shuffle)?`, 'gi'), (m) => {
    const count = m[1].trim().replace(/^up to /i, '');
    const filter = librarySearchFilter(m[2]);
    if (!filter) return null;
    if (m[3]) filter.maxManaValue = Number(m[3]);
    return { kind: 'search', n: toNumber(count), filter, dest: m[4].toLowerCase() === 'into your hand' ? 'hand' : 'battlefield', tapped: !!m[5] };
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
  scan(/\bsurveil (\d+|X)\b/gi, (m) => ({ kind: 'surveil', n: toAmount(m[1]) }));
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
    const nouns = m[3].replace(/s$/, '').replace(/ies$/, 'y');
    const which = selector(nouns.endsWith('creature') || nouns.endsWith('permanent') || nouns.endsWith('artifact') || nouns.endsWith('enchantment') || nouns.endsWith('land') ? nouns : '');
    const to = which && who(m[1]);
    return to && which && { kind: 'sacrifice', n: toAmount(m[2]), to, which };
  });
  // Tokens: "create two 1/1 white Soldier creature tokens with flying", "create a Treasure token".
  scan(new RegExp(`\\b[Cc]reates? (${AMOUNT}) (\\d+)\\/(\\d+) ((?:(?:white|blue|black|red|green|colorless)(?:,? and |, | ))+)([A-Z][A-Za-z' -]*?) ((?:artifact |enchantment )?)creature tokens?(?: with ${KEYWORD_LIST})?(?=\\.|,| and |$)`, 'g'), (m) => {
    const colors = m[4].toLowerCase().split(/,? and |, | /).filter((w) => COLOR_WORDS[w]).map((w) => COLOR_WORDS[w]);
    const kws = keywordList(m[7]);
    const types = `Token ${m[6] ? m[6].trim().replace(/^./, (c) => c.toUpperCase()) + ' ' : ''}Creature — ${m[5]}`;
    return {
      kind: 'token', n: toAmount(m[1]),
      token: { name: m[5], typeLine: types, colors, power: Number(m[2]), toughness: Number(m[3]), keywords: kws, oracleText: kws.map((k) => k.replace(/^./, (c) => c.toUpperCase())).join(', ') },
    };
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
    scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1) counters? on ${SELF}(?=\\.|\\n|$|,)`, 'gi'), (m) => ({
      kind: 'addCounters', counter: m[2] as CounterKind, n: toAmount(m[1]), to: 'self',
    }));
    scan(new RegExp(`(?:^|[.,] *|then )sacrifice ${SELF}(?=\\.|$)`, 'gi'), () => ({ kind: 'sacrificeSelf' }));
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
  // unless it is a condition.
  for (const { at } of matches) {
    if (!covered[at]) continue;
    let from = at;
    while (from > 0 && !/[.\n]/.test(text[from - 1])) from--;
    const subject = text.slice(from, at);
    if (subject.trim().split(/\s+/).length <= 8 && !/\b(?:if|unless|until|when|whenever|as long as|instead|for each)\b/i.test(subject)) cover(from, at);
  }
  // Anything else left in the text ("then return it…", "Its controller loses 3 life") means the ability is only partly
  // understood: it is not simulated rather than simulated wrongly.
  const rest = [...text].filter((_, i) => !covered[i]).join('');
  if (/[a-z0-9{]/i.test(rest.replace(/\([^)]*\)/g, '').replace(/\b(?:then|and|or)\b/gi, ''))) return { targets: [], effects: [] };
  return { targets, effects };
}

/**
 * Sentences an ability can contain without being "partly understood": they change nothing the engine
 * simulates (no regeneration, no prevention of these effects…).
 */
const IGNORED = new RegExp([
  /(?:It|They|That creature) can't be regenerated\./,
  /You may choose new targets for the copy\./,
  /If that spell is countered this way, exile it instead of putting it into its owner's graveyard\./,
  // Small upsides for the opponent of a removal spell, not simulated (listed in TODO.md): Swords to Plowshares' life,
  // Path to Exile's and Erode's basic land, Get Lost's Map tokens.
  /Its controller gains life equal to its power\./,
  /(?:Its|That (?:land|permanent)'s) controller may search (?:their|his or her) library for a basic land card, put it onto the battlefield(?: tapped)?, then shuffle\./,
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
    if (e.kind === 'fight') return { ...e, a: { slot: e.a.slot + offset }, b: { slot: e.b.slot + offset } };
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

/** What makes a triggered ability trigger. */
export type TriggerEvent =
  /** This permanent enters / dies / attacks / deals combat damage to a player. */
  | { on: ObjectEvent; self: true }
  /** A matching permanent does ("Whenever another creature you control enters", landfall). */
  | { on: ObjectEvent; self: false; which: Selector; another: boolean }
  /** At the beginning of an upkeep or end step: yours, each one, or each opponent's. */
  | { on: 'upkeep' | 'endStep'; whose: 'you' | 'each' | 'opponent' }
  /** Whenever you cast a spell matching the card words ("noncreature", "instant or sorcery"). */
  | { on: 'cast'; filter: TargetFilter }
  /** Whenever you gain life. */
  | { on: 'gainLife' };

export interface TriggerSpec {
  event: TriggerEvent;
  /** What it does. No effects means the ability is recognized as a trigger but not simulated. */
  ability: AbilitySpec;
}

/**
 * Words that change what an ability does in ways the parser can't follow (conditions,
 * replacements, references to the triggering object). Such abilities are not simulated rather
 * than simulated wrongly.
 */
const UNSUPPORTED = /\b(?:if|unless|for each|where|instead|that (?:creature|card|player|land|spell|permanent)|those|otherwise|this way|exiled with)\b/i;

const NO_EFFECT: AbilitySpec = { targets: [], effects: [] };

/** "a creature you control", "another nontoken creature", "a land" → which permanents a trigger watches. */
function triggerSubject(subject: string, underYourControl: boolean): { which: Selector; another: boolean } | null {
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
  const optional = /^you may /i.test(text);
  // "you may gain 1 life" → "you gain 1 life"
  const body = optional ? `you ${text.slice('you may '.length)}` : text;
  // "it" in "Whenever a creature you control attacks, it gets +1/+0" is the attacker, not this card.
  if (UNSUPPORTED.test(body) || (!self && /\bits?\b/i.test(body))) return NO_EFFECT;
  const spec = parseAbilityText(body, self ? name : undefined);
  return optional && spec.effects.length ? { ...spec, optional } : spec;
}

const triggerCache = new Map<string, TriggerSpec[]>();

/** Triggered abilities printed on a permanent card (front face), plus prowess. */
export function triggersOf(card: Card): TriggerSpec[] {
  const key = `${card.name}\n${card.oracleText}`;
  const cached = triggerCache.get(key);
  if (cached) return cached;
  const out: TriggerSpec[] = [];
  const name = card.name.split(' // ')[0];
  // A trigger's subject may also be a legend's first name ("When Loran enters").
  const selves = [...selfWords(name), name.split(' ')[0]].map((w) => w.toLowerCase());

  if (hasKeyword(card, 'prowess')) {
    out.push({
      event: { on: 'cast', filter: { nonTypes: ['creature'] } },
      ability: { targets: [], effects: [{ kind: 'pump', power: 1, toughness: 1, keywords: [], to: 'self' }] },
    });
  }

  for (const raw of frontText(card).split('\n')) {
    // Drop reminder text and ability words ("Landfall — Whenever…").
    const line = raw.replace(/\s*\([^)]*\)/g, '').replace(/^[A-Z][A-Za-z' ]+ — /, '').trim();

    const ev = line.match(/^(?:When|Whenever) (.+?) (enters(?: the battlefield)?( under your control)?|attacks|dies|deals combat damage to a player)(?: or (enters|attacks|dies)(?: the battlefield)?)?, (.+)$/i);
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
        out.push({ event: self ? { on, self: true } : { on, self: false, ...watched! }, ability });
      }
      continue;
    }

    const step = line.match(/^At the beginning of (your|each|each player's|each opponent's|the) (upkeep|end step), (.+)$/i);
    if (step) {
      const w = step[1].toLowerCase();
      const whose = w === 'your' ? 'you' : w === "each opponent's" ? 'opponent' : 'each';
      out.push({ event: { on: step[2].toLowerCase() === 'upkeep' ? 'upkeep' : 'endStep', whose }, ability: triggerAbility(step[3], name, true) });
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
  const name = card.name.split(' // ')[0];
  const selves = selfWords(name).map((w) => w.toLowerCase());

  for (const raw of frontText(card).split('\n')) {
    const line = raw.replace(/\s*\([^)]*\)/g, '').replace(/^[A-Z][A-Za-z' ]+ — /, '').trim();
    // "Equip {2}": attach to target creature you control, as a sorcery.
    const equip = line.match(/^Equip ((?:\{[^}]+\})+)$/);
    if (equip) {
      out.push({
        text: line, cost: { mana: equip[1], tap: false, sacrificeSelf: false, life: 0 }, sorcery: true, once: false,
        ability: { targets: [{ kind: 'creature', min: 1, max: 1, filter: { controller: 'you' } }], effects: [{ kind: 'attach', to: { slot: 0 } }] },
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
    const sorcery = /Activate only as a sorcery/i.test(text);
    const once = /Activate only once each turn/i.test(text);
    // Other restrictions ("only during your turn", "only if …") aren't checked: leave the ability out.
    if (/Activate (?:only|this ability only)/i.test(text.replace(/Activate only (?:as a sorcery|once each turn)\.?/gi, ''))) continue;
    text = text.replace(/\s*Activate (?:only|this ability only)[^.]*\./gi, '').trim();
    const optional = /^you may /i.test(text);
    const body = optional ? `you ${text.slice('you may '.length)}` : text;
    const ability = UNSUPPORTED.test(body) ? NO_EFFECT : parseAbilityText(body, name);
    out.push({ text: line, cost, ability: optional && ability.effects.length ? { ...ability, optional } : ability, sorcery, once });
  }
  activatedCache.set(key, out);
  return out;
}

// ---------- Entering the battlefield ----------

/** "This creature enters with N +1/+1 counters on it" (X: the value paid when cast); Moonshadow: "six -1/-1 counters". */
export function entersCounters(card: Card): { counter: '+1/+1' | '-1/-1'; n: Amount } | null {
  const selves = selfWords(card.name).map(escapeRe).join('|');
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
  /** The creature this Aura / Equipment is attached to, or every creature matching a selector (anthems). */
  who: 'enchanted' | 'equipped' | { which: Selector; other: boolean };
  power: number;
  toughness: number;
  keywords: Keyword[];
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
    const attached = line.match(/^(Enchanted|Equipped) creature (.+)\.$/);
    if (attached) {
      const who = attached[1] === 'Enchanted' ? 'enchanted' : 'equipped';
      const body = attached[2];
      const pump = body.match(new RegExp(`^gets ([+-]\\d+)\\/([+-]\\d+)(?: and has ${KEYWORD_LIST})?$`, 'i'));
      const has = body.match(new RegExp(`^has ${KEYWORD_LIST}$`, 'i'));
      if (pump) out.push({ who, power: Number(pump[1]), toughness: Number(pump[2]), keywords: kws(pump[3]) });
      else if (has) out.push({ who, power: 0, toughness: 0, keywords: kws(has[1]) });
      else if (/^can't attack or block$/i.test(body)) out.push({ who, power: 0, toughness: 0, keywords: [], cantAttack: true, cantBlock: true });
      else if (/^can't attack$/i.test(body)) out.push({ who, power: 0, toughness: 0, keywords: [], cantAttack: true });
      else if (/^can't block$/i.test(body)) out.push({ who, power: 0, toughness: 0, keywords: [], cantBlock: true });
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
  | { kind: 'payLife'; n: number };

/** When a permanent enters tapped. */
export function entersTappedRule(card: Card): EntersTappedRule | null {
  const text = frontText(card);
  const selves = selfWords(card.name).map(escapeRe).join('|');
  if (entersTapped(card)) return { kind: 'always' };
  const unless = text.match(new RegExp(`(?:^|\\n)(?:${selves}) enters(?: the battlefield)? tapped unless you control (.+?)\\.`, 'i'));
  if (unless) {
    const what = unless[1].toLowerCase();
    const lands = what.match(/^(two|three) or (fewer|more) other lands$/);
    if (lands) return { kind: 'unlessOtherLands', [lands[2] === 'fewer' ? 'max' : 'min']: toNumber(lands[1]) };
    const types = what.split(/,? or |, /).map((w) => w.replace(/^an? /, ''));
    if (types.every((t) => LAND_TYPES.includes(t))) return { kind: 'unlessSubtypes', subtypes: types };
    return null;
  }
  const shock = text.match(/As (?:this land|this permanent) enters(?: the battlefield)?, you may pay (\d+) life\. If you don't, it enters(?: the battlefield)? tapped\./i);
  return shock ? { kind: 'payLife', n: Number(shock[1]) } : null;
}

/** "Toxic 2": combat damage to a player also gives that many poison counters. */
export function toxicOf(card: Card): number {
  const m = frontText(card).match(/(?:^|\n|, )Toxic (\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** Clones: "You may have this creature enter as a copy of any creature on the battlefield." */
export const entersAsCopy = (card: Card) =>
  /you may have (?:this creature|[^.]+?) enter(?: the battlefield)? as a copy of (?:any|a) creature on the battlefield\./i.test(frontText(card));
