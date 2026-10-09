import type { Board, Deck } from '../types';

export interface ParsedLine {
  qty: number;
  name: string;
  board: Board;
}

/**
 * Parse a decklist in the common text formats (MTG Arena, MTGO, plain):
 *   4 Lightning Bolt
 *   4x Lightning Bolt (M11) 149
 *   SB: 2 Duress
 *   Sideboard            <- following lines go to the sideboard
 */
export function parseDeckText(text: string): ParsedLine[] {
  const merged = new Map<string, ParsedLine>();
  let board: Board = 'main';

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    const header = line.toLowerCase().replace(/:$/, '');
    if (header === 'sideboard') { board = 'side'; continue; }
    if (header === 'deck' || header === 'mainboard' || header === 'commander' || header === 'companion') {
      board = 'main';
      continue;
    }

    let lineBoard = board;
    if (/^sb:\s*/i.test(line)) {
      lineBoard = 'side';
      line = line.replace(/^sb:\s*/i, '');
    }

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? Number(m[1]) : 1;
    // Strip a trailing set code and collector number: "Name (M11) 149"
    const name = (m ? m[2] : line).replace(/\s+\([A-Za-z0-9]+\)(\s+\S+)?$/, '').trim();
    if (!name || qty <= 0) continue;

    const key = `${lineBoard}|${name.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { qty, name, board: lineBoard });
  }
  return [...merged.values()];
}

export function formatDeckText(deck: Deck): string {
  const lines = (board: Board) =>
    deck.entries.filter((e) => e.board === board).map((e) => `${e.qty} ${e.card.name}`);
  const side = lines('side');
  return [...lines('main'), ...(side.length ? ['', 'Sideboard', ...side] : [])].join('\n');
}
