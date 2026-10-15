/**
 * Audits the metagame: the top decks of each format on mtgtop8, read by the rules engine.
 *
 *   npm run audit-meta                                  # 8 top decks of each format
 *   npm run audit-meta -- --formats ST,MO --decks 8     # some formats only
 *   npm run audit-meta -- --cards audit-reports/2026-10-15/cards.json   # reuse cards fetched earlier
 *
 * Writes to audit-reports/<date>/ (git-ignored): report.md (to read), report.json (for scripts/fix-meta.sh and the
 * card-audit skill), decks.json and cards.json (the decklists and the card data, to re-run offline).
 *
 * Problems are ranked for fixing: cards that play WRONGLY first (a line silently ignored, a cost the engine can't
 * pay), then the most played (in most decks, then most copies).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditCard, type CardStatus, type LineReport } from '../src/lib/engine/audit';
import type { Card } from '../src/types';
import { FORMATS, scryfallCards, slim, topDecks, type TopDeck } from './lib/sources';

interface Problem {
  name: string;
  status: CardStatus;
  /** A line is silently ignored, or the card can't be cast: it plays wrongly, not just partly. */
  wrong: boolean;
  formats: string[];
  decks: number;
  copies: number;
  gaps: { text: string; status: LineReport['status']; how: string }[];
  oracleText: string;
}

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const formats = (value('--formats') ?? Object.keys(FORMATS).join(',')).split(',').map((f) => f.trim()).filter(Boolean);
const perFormat = Number(value('--decks') ?? 8);
const date = new Date().toISOString().slice(0, 10);
const outDir = value('--out') ?? join('audit-reports', date);
const isBasic = (c: Card) => /^Basic\b/.test(c.typeLine);

async function main() {
  for (const f of formats) if (!FORMATS[f]) throw new Error(`Unknown format ${f}: use ${Object.keys(FORMATS).join(', ')}`);
  mkdirSync(outDir, { recursive: true });

  // 1. Decklists.
  const decks: Record<string, TopDeck[]> = {};
  for (const f of formats) {
    console.error(`${FORMATS[f]}…`);
    try {
      decks[f] = await topDecks(f, perFormat, console.error);
    } catch (e) {
      console.error(`  skipped: ${e instanceof Error ? e.message : e}`);
      decks[f] = [];
    }
  }
  writeFileSync(join(outDir, 'decks.json'), `${JSON.stringify(decks, null, 1)}\n`);

  // 2. Card data (from a previous run when given, else Scryfall).
  const byName = new Map<string, Card>();
  const saved = value('--cards');
  if (saved && existsSync(saved)) for (const c of JSON.parse(readFileSync(saved, 'utf8')) as Card[]) byName.set(c.name, c);
  const names = [...new Set(Object.values(decks).flat().flatMap((d) => d.lines.map((l) => l.name)))];
  const lookup = (n: string) => byName.get(n) ?? [...byName.values()].find((c) => c.name.split(' // ')[0] === n.split(/\s*\/\/?\s*/)[0]);
  const missing: string[] = [];
  const toFetch = names.filter((n) => !lookup(n));
  if (toFetch.length) {
    console.error(`Scryfall: ${toFetch.length} cards…`);
    for (const c of await scryfallCards(toFetch, missing)) byName.set(c.name, c);
  }
  writeFileSync(join(outDir, 'cards.json'), `${JSON.stringify([...byName.values()].map(slim), null, 1)}\n`);

  // 3. Audit: per format, per deck, and the problem cards across all formats.
  const problems = new Map<string, Problem>();
  const formatRows = formats.map((f) => {
    const rows = decks[f].map((d) => {
      const count = { ok: 0, partial: 0, none: 0 };
      for (const l of d.lines.filter((x) => x.board === 'main')) {
        const card = lookup(l.name);
        if (!card || isBasic(card)) { if (card) count.ok += l.qty; continue; }
        const report = auditCard(card);
        count[report.status === 'ok' ? 'ok' : report.status === 'partial' ? 'partial' : 'none'] += l.qty;
      }
      for (const l of d.lines) {
        const card = lookup(l.name);
        if (!card || isBasic(card)) continue;
        const report = auditCard(card);
        if (report.status === 'ok') continue;
        const p = problems.get(card.name) ?? {
          name: card.name, status: report.status, oracleText: card.oracleText, formats: [], decks: 0, copies: 0,
          wrong: report.status === 'refused' || report.lines.some((x) => x.status === 'unread'),
          gaps: report.lines.filter((x) => x.status !== 'ok').map((x) => ({ text: x.text, status: x.status, how: x.how })),
        };
        if (!p.formats.includes(f)) p.formats.push(f);
        p.decks++;
        p.copies += l.qty;
        problems.set(card.name, p);
      }
      const total = count.ok + count.partial + count.none;
      return { id: d.id, name: d.name, event: d.event, total, ...count, coverage: total ? Math.round((count.ok / total) * 100) : 0 };
    });
    return { code: f, name: FORMATS[f], decks: rows };
  });
  const ranked = [...problems.values()].sort((a, b) => Number(b.wrong) - Number(a.wrong) || b.decks - a.decks || b.copies - a.copies || a.name.localeCompare(b.name));

  const report = { date, perFormat, formats: formatRows, missingOnScryfall: missing, problems: ranked };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);

  // 4. The readable report.
  const md: string[] = [`# Rules engine audit — ${date}`, '', `Top ${perFormat} decks of each format on mtgtop8, read by the rules engine.`, ''];
  md.push('| Format | Decks | Fully simulated (main deck copies) |', '|---|---|---|');
  for (const f of formatRows) {
    const ok = f.decks.reduce((n, d) => n + d.ok, 0);
    const total = f.decks.reduce((n, d) => n + d.total, 0);
    md.push(`| ${f.name} | ${f.decks.length} | ${total ? Math.round((ok / total) * 100) : 0}% |`);
  }
  for (const f of formatRows) {
    md.push('', `## ${f.name}`, '', '| Deck | Event | Simulated | Partly | Not |', '|---|---|---|---|---|');
    for (const d of f.decks) md.push(`| ${d.name} | ${d.event} | ${d.coverage}% | ${d.partial} | ${d.none} |`);
  }
  md.push('', `## Cards to fix (${ranked.length})`, '', 'Plays wrongly (✱) first, then the most played. ✗ recognized but not simulated · ? silently ignored.', '');
  for (const p of ranked.slice(0, 80)) {
    md.push(`- ${p.wrong ? '✱ ' : ''}**${p.name}** — ${p.status}, ${p.decks} deck${p.decks > 1 ? 's' : ''}, ${p.copies} copies (${p.formats.map((f) => FORMATS[f]).join(', ')})`);
    for (const g of p.gaps) md.push(`  - ${g.status === 'unread' ? '?' : '✗'} ${g.text.length > 110 ? `${g.text.slice(0, 109)}…` : g.text} — ${g.how}`);
  }
  if (ranked.length > 80) md.push('', `…and ${ranked.length - 80} more in report.json.`);
  if (missing.length) md.push('', `Not found on Scryfall: ${missing.join(', ')}`);
  writeFileSync(join(outDir, 'report.md'), `${md.join('\n')}\n`);

  console.error(`\n${ranked.length} cards to fix (${ranked.filter((p) => p.wrong).length} playing wrongly). Report: ${join(outDir, 'report.md')}`);
  console.log(join(outDir, 'report.json'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
