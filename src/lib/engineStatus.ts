import type { Card } from '../types';
import { auditCard, type CardStatus, type LineReport } from './engine/audit';
import { isInstantOrSorcery } from './engine/rules';

/** How much of a card the rules engine simulates, and the lines it doesn't (cached: the audit reads the whole text). */
const cache = new Map<string, { status: CardStatus; gaps: LineReport[] }>();

function audit(card: Card) {
  const key = `${card.name}\n${card.oracleText}`;
  let found = cache.get(key);
  if (!found) {
    const report = auditCard(card);
    // A permanent whose abilities aren't simulated still enters the battlefield (a creature still fights): partly.
    const status = report.status === 'none' && !isInstantOrSorcery(card) ? 'partial' : report.status;
    found = { status, gaps: report.lines.filter((l) => l.status !== 'ok') };
    cache.set(key, found);
  }
  return found;
}

export const engineStatus = (card: Card): CardStatus => audit(card).status;

/** The card's lines the engine doesn't simulate (✗) or silently ignores (?). */
export const engineGaps = (card: Card): LineReport[] => audit(card).gaps;
