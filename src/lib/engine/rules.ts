import { primaryType } from '../stats';
import type { Card } from '../../types';

// ---------- Card characteristics ----------

export const KEYWORDS = [
  'flying', 'reach', 'haste', 'vigilance', 'trample', 'deathtouch', 'lifelink',
  'defender', 'first strike', 'double strike', 'menace', 'flash',
] as const;
export type Keyword = (typeof KEYWORDS)[number];

/** Front face oracle text (toCard joins faces with "\n//\n"). */
const frontText = (card: Card) => card.oracleText.split('\n//\n')[0];

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

/**
 * Colors a permanent can tap for: basic land types plus "{T}: Add …" abilities.
 * Simplification: every source makes one mana per tap (Sol Ring makes 1, not 2).
 */
export function manaColors(card: Card): Color[] {
  const out = new Set<Color>();
  const front = card.typeLine.split('//')[0];
  for (const [type, color] of BASIC_TYPES) if (front.includes(type)) out.add(color);
  for (const line of frontText(card).split('\n')) {
    const m = line.match(/\{T\}[^:]*:\s*Add ([^.]*)/);
    if (!m) continue;
    if (/any color/i.test(m[1])) (['W', 'U', 'B', 'R', 'G'] as Color[]).forEach((c) => out.add(c));
    for (const sym of m[1].matchAll(/\{([WUBRGC])\}/g)) out.add(sym[1] as Color);
  }
  return [...out];
}

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

export interface ManaSource {
  iid: string;
  colors: Color[];
}

/** Picks which sources to tap for a cost, or null if it can't be paid. */
export function findPayment(sources: ManaSource[], cost: Cost): string[] | null {
  if (sources.length < cost.generic + cost.colored.length) return null;
  // Hardest requirements first; spend single-color sources before flexible ones.
  const reqs = [...cost.colored].sort((a, b) => a.length - b.length);
  const ordered = [...sources].sort((a, b) => a.colors.length - b.colors.length);
  const used = new Set<string>();

  const assign = (i: number): boolean => {
    if (i === reqs.length) return true;
    for (const s of ordered) {
      if (used.has(s.iid) || !s.colors.some((c) => reqs[i].includes(c))) continue;
      used.add(s.iid);
      if (assign(i + 1)) return true;
      used.delete(s.iid);
    }
    return false;
  };
  if (!assign(0)) return null;

  const generic = ordered.filter((s) => !used.has(s.iid)).slice(0, cost.generic);
  if (generic.length < cost.generic) return null;
  return [...used, ...generic.map((s) => s.iid)];
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
  maxManaValue?: number;
  minManaValue?: number;
  minPower?: number;
  maxPower?: number;
}

/**
 * What a target slot accepts. "any" is a creature, planeswalker or player; "permanent" is any
 * permanent matching the filter's types.
 */
export type TargetKind = 'any' | 'creature' | 'player' | 'spell' | 'permanent';

export interface TargetSpec {
  kind: TargetKind;
  /** "up to two target creatures": min 0, max 2. */
  min: number;
  max: number;
  filter: TargetFilter;
}

// ---------- Effects ----------

/** Counter kinds placed on permanents. */
export type CounterKind = '+1/+1' | '-1/-1';

/** Who an effect applies to: the targets chosen for a slot, the controller, or everyone / each opponent. */
export type Affected = { slot: number } | 'you' | 'each-opponent' | 'each-player';

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
  | { kind: 'fight'; a: { slot: number }; b: { slot: number }; oneSided: boolean };

/** A spell's or ability's rules: what it targets and what it does, in text order. */
export interface AbilitySpec {
  targets: TargetSpec[];
  effects: Effect[];
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

  // Trailing clauses.
  const isKeyword = (w: string): w is Keyword => (KEYWORDS as readonly string[]).includes(w);
  // Each returns false when the clause isn't understood.
  const suffixes: [RegExp, (m: RegExpMatchArray) => boolean][] = [
    [/ you control$/, () => !!(filter.controller = 'you')],
    [/ (?:an opponent controls|you don't control|your opponents control)$/, () => !!(filter.controller = 'opponent')],
    [/ with mana value (\d+) or less$/, (m) => ((filter.maxManaValue = Number(m[1])), true)],
    [/ with mana value (\d+) or greater$/, (m) => ((filter.minManaValue = Number(m[1])), true)],
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
    const types = [...nouns].filter((n) => n !== 'spell');
    if (types.some((t) => !CARD_TYPES.includes(t as CardType))) return null;
    if (types.length) filter.types = types as CardType[];
    return { kind: 'spell', min, max, filter };
  }
  const players = [...nouns].filter((n) => n === 'player' || n === 'opponent');
  const permanents = [...nouns].filter((n) => n !== 'player' && n !== 'opponent');
  if (nouns.has('opponent')) filter.controller = 'opponent';
  if (!permanents.length) return { kind: 'player', min, max, filter };
  // Planeswalkers and battles aren't simulated yet: "creature or planeswalker" means creature.
  const kinds = permanents.filter((n) => n !== 'planeswalker' && n !== 'battle');
  if (players.length) {
    if (!kinds.length) return { kind: 'player', min, max, filter }; // "target player or planeswalker"
    return kinds.length === 1 && kinds[0] === 'creature' ? { kind: 'any', min, max, filter } : null;
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

/** Reads "flying and trample" / "first strike, vigilance, and lifelink". */
const keywordList = (s: string | undefined) =>
  (s ?? '').split(/,? and |, /).map((k) => k.trim()).filter(Boolean) as Keyword[];

/**
 * Recognizes common effects in rules text (a spell's text, or later an ability's).
 * Anything else is not simulated. `name` is the card's own name, for "Shock deals 2 damage…".
 */
export function parseAbilityText(text: string): AbilitySpec {
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
  const matches: { at: number; run: () => Effect | Effect[] | null }[] = [];
  const scan = (re: RegExp, make: (m: RegExpMatchArray) => Effect | Effect[] | null) => {
    for (const m of text.matchAll(re)) matches.push({ at: m.index!, run: () => make(m) });
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
    const to = slotFor(m[2], (spec) => spec.kind === 'creature' || spec.kind === 'permanent');
    return to && { kind: 'destroy', exile: m[1].toLowerCase() === 'exile', to };
  });
  scan(new RegExp(`\\b(destroy|exile) (?:all|each) ([a-z0-9 ,'-]+?)${END}`, 'gi'), (m) => {
    const which = selector(m[2]);
    return which && { kind: 'destroyAll', exile: m[1].toLowerCase() === 'exile', which };
  });
  scan(new RegExp(`\\bput (${AMOUNT}) ([+-]1\\/[+-]1) counters? on (${TARGET})${END}`, 'gi'), (m) => {
    const to = slotFor(m[3], (spec) => spec.kind === 'creature');
    return to && { kind: 'addCounters', counter: m[2] as CounterKind, n: toAmount(m[1]), to };
  });
  // Drawing: "Draw two cards", "Target player draws X cards", "Each player draws a card".
  scan(new RegExp(`(?:^|[^a-z])draw (${AMOUNT}) cards?\\b`, 'gi'), (m) => ({ kind: 'draw', n: toAmount(m[1]), to: 'you' }));
  scan(new RegExp(`${PLAYER} draws (${AMOUNT}) cards?\\b(?! and loses)`, 'gi'), (m) => {
    const to = who(m[1]);
    return to && { kind: 'draw', n: toAmount(m[2]), to };
  });
  // Sign in Blood: "Target player draws two cards and loses 2 life."
  scan(new RegExp(`${PLAYER} draws (${AMOUNT}) cards? and loses (\\d+|X) life`, 'gi'), (m) => {
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

  for (const { run } of matches.sort((a, b) => a.at - b.at)) {
    const effect = run();
    if (Array.isArray(effect)) effects.push(...effect);
    else if (effect) effects.push(effect);
  }
  return { targets, effects };
}

/** The rules of an instant or sorcery, from its front face text. Other cards have none. */
export function spellSpec(card: Card): AbilitySpec {
  if (!isInstantOrSorcery(card)) return { targets: [], effects: [] };
  return parseAbilityText(frontText(card));
}

/** Just the effects of an instant or sorcery. */
export const parseEffects = (card: Card): Effect[] => spellSpec(card).effects;
