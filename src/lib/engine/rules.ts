import { primaryType } from '../stats';
import type { Card } from '../../types';

// ---------- Card characteristics ----------

export const KEYWORDS = [
  'flying', 'reach', 'haste', 'vigilance', 'trample', 'deathtouch', 'lifelink',
  'defender', 'first strike', 'double strike', 'menace',
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

// ---------- Spell effects ----------

export type DamageTarget = 'any' | 'creature' | 'player' | 'each-opponent';

export type Effect =
  | { kind: 'damage'; amount: number; target: DamageTarget }
  | { kind: 'destroy'; exile: boolean }
  | { kind: 'draw'; n: number }
  | { kind: 'gainLife'; n: number };

export type TargetKind = 'any' | 'creature' | 'player';

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const toNumber = (s: string) => WORD_NUMBERS[s.toLowerCase()] ?? Number(s);

/**
 * Recognizes the most common instant/sorcery effects from oracle text. Anything else
 * is not simulated. Targeting restrictions such as "nonblack" are ignored.
 */
export function parseEffects(card: Card): Effect[] {
  if (!isInstantOrSorcery(card)) return [];
  const text = frontText(card);
  const effects: Effect[] = [];

  const dmg = text.match(
    /deals (\d+) damage to (any target|target creature or planeswalker|target creature|target player or planeswalker|target player|target opponent or planeswalker|target opponent|each opponent)/i,
  );
  if (dmg) {
    const t = dmg[2].toLowerCase();
    const target: DamageTarget =
      t === 'any target' ? 'any' : t.startsWith('target creature') ? 'creature' : t === 'each opponent' ? 'each-opponent' : 'player';
    effects.push({ kind: 'damage', amount: Number(dmg[1]), target });
  }

  const removal = text.match(/\b(destroy|exile) target (?:[\w-]+ )?creature\b/i);
  if (removal) effects.push({ kind: 'destroy', exile: removal[1].toLowerCase() === 'exile' });

  const draw = text.match(/\bdraw (a|one|two|three|four|five|\d+) cards?\b/i);
  if (draw) effects.push({ kind: 'draw', n: toNumber(draw[1]) });

  const gain = text.match(/\byou gain (\d+) life\b/i);
  if (gain) effects.push({ kind: 'gainLife', n: Number(gain[1]) });

  return effects;
}

/** What the spell needs to target, if anything (one target per spell). */
export function targetKind(effects: Effect[]): TargetKind | null {
  for (const e of effects) {
    if (e.kind === 'destroy') return 'creature';
    if (e.kind === 'damage' && e.target !== 'each-opponent') return e.target;
  }
  return null;
}
