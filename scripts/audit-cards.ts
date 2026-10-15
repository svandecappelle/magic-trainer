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
import { auditCard, formatAudit } from '../src/lib/engine/audit';
import type { Card } from '../src/types';
import { mtgtop8Url, namesOf, scryfallCards, slim } from './lib/sources';

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
    if (/^https?:\/\/(www\.)?mtgtop8\.com\//.test(input)) names.push(...(await mtgtop8Url(input)));
    else if (existsSync(input)) names.push(...namesOf(readFileSync(input, 'utf8')));
    else names.push(input);
  }
  const byName = new Map<string, Card>();
  const saved = value('--cards');
  if (saved) for (const c of JSON.parse(readFileSync(saved, 'utf8')) as Card[]) byName.set(c.name, c);
  const unique = [...new Set(names)].filter((n) => !byName.has(n));
  const missing: string[] = [];
  for (const c of await scryfallCards(unique, missing)) byName.set(c.name, c);
  if (missing.length) console.error(`Not found on Scryfall: ${missing.join(', ')}`);
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
