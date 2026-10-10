import type { Deck } from '../types';

/** A problem with a deck for its format. */
export type DeckIssue =
  | { kind: 'tooFew'; n: number; min: number }
  | { kind: 'tooMany'; n: number; max: number }
  | { kind: 'sideboard'; n: number; max: number }
  | { kind: 'copies'; card: string; n: number; max: number }
  | { kind: 'banned'; card: string }
  | { kind: 'notLegal'; card: string }
  /** Cards saved without legality data: refresh them to check. */
  | { kind: 'unknown'; n: number };

interface FormatRules {
  min: number;
  max?: number;
  sideboard: number;
  copies: number;
}

const RULES: Record<string, FormatRules> = {
  standard: { min: 60, sideboard: 15, copies: 4 },
  pioneer: { min: 60, sideboard: 15, copies: 4 },
  modern: { min: 60, sideboard: 15, copies: 4 },
  legacy: { min: 60, sideboard: 15, copies: 4 },
  vintage: { min: 60, sideboard: 15, copies: 4 },
  pauper: { min: 60, sideboard: 15, copies: 4 },
  // The commander itself is part of the 100 cards here.
  commander: { min: 100, max: 100, sideboard: 0, copies: 1 },
};

/** Cards a deck may hold any number of: basic lands, and "A deck can have any number of cards named …". */
const unlimited = (typeLine: string, oracleText: string) =>
  /\bBasic\b/.test(typeLine) || /A deck can have any number of cards named/i.test(oracleText);

/** Checks a deck against its format (casual decks have no rules). */
export function checkDeck(deck: Deck): DeckIssue[] {
  const rules = RULES[deck.format];
  if (!rules) return [];
  const issues: DeckIssue[] = [];
  const count = (board: 'main' | 'side') => deck.entries.filter((e) => e.board === board).reduce((n, e) => n + e.qty, 0);
  const main = count('main');
  const side = count('side');
  if (main < rules.min) issues.push({ kind: 'tooFew', n: main, min: rules.min });
  if (rules.max !== undefined && main > rules.max) issues.push({ kind: 'tooMany', n: main, max: rules.max });
  if (side > rules.sideboard) issues.push({ kind: 'sideboard', n: side, max: rules.sideboard });

  // Copies count across main deck and sideboard, by card name.
  const byName = new Map<string, { n: number; typeLine: string; oracleText: string; legal?: string }>();
  let unknown = 0;
  for (const e of deck.entries) {
    const cur = byName.get(e.card.name) ?? { n: 0, typeLine: e.card.typeLine, oracleText: e.card.oracleText, legal: e.card.legalities?.[deck.format] };
    cur.n += e.qty;
    byName.set(e.card.name, cur);
    if (!e.card.legalities) unknown += e.qty;
  }
  for (const [card, c] of byName) {
    const restricted = c.legal === 'restricted';
    const max = restricted ? 1 : rules.copies;
    if (c.n > max && !unlimited(c.typeLine, c.oracleText)) issues.push({ kind: 'copies', card, n: c.n, max });
    if (c.legal === 'banned') issues.push({ kind: 'banned', card });
    else if (c.legal === 'not_legal') issues.push({ kind: 'notLegal', card });
  }
  if (unknown) issues.push({ kind: 'unknown', n: unknown });
  return issues;
}
