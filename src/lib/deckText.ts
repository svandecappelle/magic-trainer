import type { Board, Deck } from '../types';

export interface ParsedLine {
  qty: number;
  name: string;
  board: Board;
}

export interface ParsedDecklist {
  /** From an Arena "About / Name …" header, if present. */
  name?: string;
  lines: ParsedLine[];
}

/**
 * Parse a decklist in the common text formats (MTG Arena, MTGO, Moxfield, plain):
 *   About                <- Arena header; "Name My Deck" sets the deck name
 *   Name My Deck
 *   Deck
 *   4 Lightning Bolt
 *   4x Lightning Bolt (M11) 149 *F*
 *   2 Counterspell [MH2]
 *   SB: 2 Duress
 *   Sideboard            <- following lines go to the sideboard
 */
export function parseDecklist(text: string): ParsedDecklist {
  const merged = new Map<string, ParsedLine>();
  let board: Board = 'main';
  let inAbout = false;
  let name: string | undefined;

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    const header = line.toLowerCase().replace(/:$/, '');
    if (header === 'about') { inAbout = true; continue; }
    if (header === 'sideboard') { board = 'side'; inAbout = false; continue; }
    if (header === 'commander') { board = 'commander'; inAbout = false; continue; }
    if (header === 'deck' || header === 'mainboard' || header === 'companion') {
      board = 'main';
      inAbout = false;
      continue;
    }
    if (inAbout) {
      const m = line.match(/^name\s+(.+)$/i);
      if (m) name = m[1].trim();
      continue;
    }

    let lineBoard = board;
    if (/^sb:\s*/i.test(line)) {
      lineBoard = 'side';
      line = line.replace(/^sb:\s*/i, '');
    }

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? Number(m[1]) : 1;
    const cardName = (m ? m[2] : line)
      .replace(/\s+\*[A-Z]+\*$/, '') // Moxfield foil/etched marker: *F*, *E*
      .replace(/\s+\([A-Za-z0-9]+\)(\s+\S+)?$/, '') // set and collector number: (M11) 149
      .replace(/\s+\[[^\]]+\]$/, '') // set in brackets: [M11]
      .trim();
    if (!cardName || qty <= 0) continue;

    const key = `${lineBoard}|${cardName.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { qty, name: cardName, board: lineBoard });
  }
  return { name, lines: [...merged.values()] };
}

export const parseDeckText = (text: string): ParsedLine[] => parseDecklist(text).lines;

export function formatDeckText(deck: Deck): string {
  const lines = (board: Board) =>
    deck.entries.filter((e) => e.board === board).map((e) => `${e.qty} ${e.card.name}`);
  const side = lines('side');
  const commander = lines('commander');
  return [
    ...(commander.length ? ['Commander', ...commander, '', 'Deck'] : []),
    ...lines('main'),
    ...(side.length ? ['', 'Sideboard', ...side] : []),
  ].join('\n');
}
