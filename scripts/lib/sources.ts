/**
 * Where audited cards come from: mtgtop8 decklists and Scryfall card data. Shared by audit-cards.ts and audit-meta.ts.
 * Both sites are asked politely: one request at a time, with a pause, and a User-Agent naming the tool.
 */
import { parseDecklist, type ParsedLine } from '../../src/lib/deckText';
import { toCard, type ScryfallCard } from '../../src/lib/scryfall';
import type { Card } from '../../src/types';

const USER_AGENT = 'magic-trainer-audit/1.0 (+https://github.com/svandecappelle/magic-trainer)';
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A page's text; mtgtop8 pages are Latin-1. */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder(/charset=utf-8/i.test(res.headers.get('content-type') ?? '') ? 'utf-8' : 'latin1').decode(bytes);
}

/** Card names of a decklist text. */
export const namesOf = (text: string) => parseDecklist(text).lines.map((l) => l.name);

/** A deck's list from mtgtop8 (its MTGO export). */
export async function mtgtop8DeckList(id: string): Promise<ParsedLine[]> {
  const text = await fetchText(`https://www.mtgtop8.com/mtgo?d=${id}`);
  await sleep(400);
  return parseDecklist(text).lines;
}

export interface TopDeck {
  id: string;
  /** The archetype name mtgtop8 gives it. */
  name: string;
  event: string;
  lines: ParsedLine[];
}

/** mtgtop8 format codes: Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Premodern, Duel Commander, cEDH. */
export const FORMATS: Record<string, string> = {
  ST: 'Standard', PI: 'Pioneer', MO: 'Modern', LE: 'Legacy', VI: 'Vintage', PAU: 'Pauper', PREM: 'Premodern', EDH: 'Duel Commander', cEDH: 'cEDH',
};

/** The deck ids and names of an event page, in finishing order. */
async function eventDecks(eventId: string, format: string): Promise<{ title: string; decks: { id: string; name: string }[] }> {
  const html = await fetchText(`https://www.mtgtop8.com/event?e=${eventId}&f=${format}`);
  await sleep(400);
  const title = (html.match(/<title>([^<]*)/)?.[1] ?? `event ${eventId}`).replace(/\s*@ mtgtop8\.com\s*$/, '').trim();
  const decks: { id: string; name: string }[] = [];
  for (const m of html.matchAll(/href=["']?\?e=\d+&d=(\d+)&f=\w+["']?[^>]*>([^<]*)</g)) {
    const name = m[2].trim();
    if (!name || name.startsWith('&') || /switch to/i.test(name) || decks.some((d) => d.id === m[1])) continue;
    decks.push({ id: m[1], name });
  }
  return { title, decks };
}

/** The top `count` decks of the most recent events of a format (the latest event first, then older ones if it has fewer). */
export async function topDecks(format: string, count: number, log: (s: string) => void = () => {}): Promise<TopDeck[]> {
  const page = await fetchText(`https://www.mtgtop8.com/format?f=${format}`);
  await sleep(400);
  const events = [...new Set([...page.matchAll(new RegExp(`event\\?e=(\\d+)&f=${format}\\b`, 'g'))].map((m) => m[1]))];
  const out: TopDeck[] = [];
  for (const e of events.slice(0, 4)) {
    if (out.length >= count) break;
    const { title, decks } = await eventDecks(e, format);
    for (const d of decks.slice(0, count - out.length)) {
      log(`  ${title} · ${d.name}`);
      out.push({ ...d, event: title, lines: await mtgtop8DeckList(d.id) });
    }
  }
  return out;
}

/** The decklists behind an mtgtop8 URL: one deck (d=…), or the first 8 decks of an event page. */
export async function mtgtop8Url(url: string): Promise<string[]> {
  const deck = url.match(/[?&]d=(\d+)/);
  if (deck) return (await mtgtop8DeckList(deck[1])).map((l) => l.name);
  const event = url.match(/[?&]e=(\d+)/);
  const format = url.match(/[?&]f=(\w+)/)?.[1] ?? 'ST';
  if (!event) throw new Error(`Not an mtgtop8 event or deck URL: ${url}`);
  const { decks } = await eventDecks(event[1], format);
  const names: string[] = [];
  for (const d of decks.slice(0, 8)) names.push(...(await mtgtop8DeckList(d.id)).map((l) => l.name));
  return names;
}

/** Oracle data from Scryfall, 75 names per request. Names not found are reported through `missing`. */
export async function scryfallCards(names: string[], missing: string[] = []): Promise<Card[]> {
  const cards: Card[] = [];
  const unique = [...new Set(names)];
  for (let i = 0; i < unique.length; i += 75) {
    const identifiers = unique.slice(i, i + 75).map((n) => ({ name: n.split(/\s*\/\/?\s*/)[0] }));
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) throw new Error(`Scryfall: HTTP ${res.status}`);
    const body = (await res.json()) as { data: ScryfallCard[]; not_found?: { name: string }[] };
    cards.push(...body.data.map(toCard));
    missing.push(...(body.not_found ?? []).map((m) => m.name));
    await sleep(150);
  }
  return cards;
}

/** A card without what the audit doesn't need (images, prices, legalities, translations). */
export function slim(c: Card): Card {
  const { imageSmall: _i, imageNormal: _n, priceUsd: _p, legalities: _l, lang: _g, printedName: _pn, printedTypeLine: _pt, ...rest } = c;
  return rest;
}
