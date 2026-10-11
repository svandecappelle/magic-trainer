/**
 * What the rules engine understands of a deck's cards.
 *
 *   npm run audit-cards -- deck.txt                     # a decklist (Arena, MTGO, plain "4 Lightning Bolt")
 *   npm run audit-cards -- https://www.mtgtop8.com/event?e=1&d=2&f=ST   # mtgtop8 decks (any URL with d=…)
 *   npm run audit-cards -- "Lightning Bolt" "Opt"       # card names
 *   npm run audit-cards -- --cards cards.json           # cards saved earlier with --save (no network)
 *
 * Options: --problems (hide fully simulated cards), --json (machine-readable), --save file.json (keep the cards,
 * e.g. as a fixture for src/lib/engine/audit.test.ts). Several inputs can be given; cards are merged by name.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseDecklist } from '../src/lib/deckText';
import { auditCard, formatAudit } from '../src/lib/engine/audit';
import { toCard, type ScryfallCard } from '../src/lib/scryfall';
import type { Card } from '../src/types';

const HEADERS = { 'User-Agent': 'magic-trainer-audit/1.0', Accept: 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Card names of a decklist text. */
const namesOf = (text: string) => parseDecklist(text).lines.map((l) => l.name);

/** The decklists behind an mtgtop8 URL: the deck (d=…), or the first 8 decks of an event page. */
async function mtgtop8(url: string): Promise<string[]> {
  const deck = url.match(/[?&]d=(\d+)/);
  let ids = deck ? [deck[1]] : [];
  if (!ids.length) {
    const page = await (await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } })).text();
    ids = [...new Set([...page.matchAll(/[?&]d=(\d+)/g)].map((m) => m[1]))].slice(0, 8);
  }
  const names: string[] = [];
  for (const id of ids) {
    const res = await fetch(`https://www.mtgtop8.com/mtgo?d=${id}`, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    if (!res.ok) throw new Error(`mtgtop8 deck ${id}: HTTP ${res.status}`);
    names.push(...namesOf(await res.text()));
    await sleep(300);
  }
  return names;
}

/** Oracle data from Scryfall, 75 names per request. */
async function scryfall(names: string[]): Promise<Card[]> {
  const cards: Card[] = [];
  const missing: string[] = [];
  for (let i = 0; i < names.length; i += 75) {
    const identifiers = names.slice(i, i + 75).map((n) => ({ name: n.split(/\s*\/\/?\s*/)[0] }));
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) throw new Error(`Scryfall: HTTP ${res.status}`);
    const body = (await res.json()) as { data: ScryfallCard[]; not_found?: { name: string }[] };
    cards.push(...body.data.map(toCard));
    missing.push(...(body.not_found ?? []).map((m) => m.name));
    await sleep(120);
  }
  if (missing.length) console.error(`Not found on Scryfall: ${missing.join(', ')}`);
  return cards;
}

/** A card without what the audit doesn't need (images, prices, legalities, translations). */
function slim(c: Card): Card {
  const { imageSmall: _i, imageNormal: _n, priceUsd: _p, legalities: _l, lang: _g, printedName: _pn, printedTypeLine: _pt, ...rest } = c;
  return rest;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const skip = new Set(['--cards', '--save'].flatMap((f) => { const i = args.indexOf(f); return i >= 0 ? [i, i + 1] : []; }));
  const inputs = args.filter((a, i) => !skip.has(i) && !a.startsWith('--'));
  if (!inputs.length && !value('--cards')) {
    console.error('Usage: npm run audit-cards -- <deck.txt | mtgtop8 URL | card name>… [--cards saved.json] [--problems] [--json] [--save file.json]');
    process.exit(2);
  }

  const names: string[] = [];
  for (const input of inputs) {
    if (/^https?:\/\/(www\.)?mtgtop8\.com\//.test(input)) names.push(...(await mtgtop8(input)));
    else if (existsSync(input)) names.push(...namesOf(readFileSync(input, 'utf8')));
    else names.push(input);
  }
  const byName = new Map<string, Card>();
  const saved = value('--cards');
  if (saved) for (const c of JSON.parse(readFileSync(saved, 'utf8')) as Card[]) byName.set(c.name, c);
  const unique = [...new Set(names)].filter((n) => !byName.has(n));
  for (const c of await scryfall(unique)) byName.set(c.name, c);
  const cards = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  const savePath = value('--save');
  if (savePath) {
    writeFileSync(savePath, `${JSON.stringify(cards.map(slim), null, 1)}\n`);
    console.error(`Saved ${cards.length} cards to ${savePath}`);
  }
  // Basic lands say nothing worth auditing.
  const reports = cards.filter((c) => !/^Basic Land/.test(c.typeLine)).map(auditCard);
  console.log(flag('--json') ? JSON.stringify(reports, null, 1) : formatAudit(reports, flag('--problems')));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
