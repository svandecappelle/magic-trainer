import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp, HttpError, rateLimiter, sendJson } from './http';

/**
 * Import a deck from a link (GET /api/import-deck?url=…): an mtgtop8, Moxfield or Archidekt deck page. The browser can't
 * read those sites itself (cross-origin), so the server asks them, and answers the deck as decklist text (the Decks
 * page's import reads it like a pasted list). Only these sites, with the address built here from the deck's id.
 */

export interface ImportedDeck {
  name: string;
  /** One of the app's formats when the site says (FORMATS in src/types.ts). */
  format?: string;
  /** "Commander" / "Deck" / "Sideboard" sections, one "N Card Name" a line. */
  text: string;
  source: 'mtgtop8' | 'moxfield' | 'archidekt';
}

type Site = { site: 'mtgtop8'; id: string; event?: string; format?: string } | { site: 'moxfield'; id: string } | { site: 'archidekt'; id: string };

/** The site and deck id of a link, or null (not a supported deck page). */
export function parseDeckUrl(raw: string): Site | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'mtgtop8.com') {
    const d = url.searchParams.get('d');
    if (!d || !/^\d{1,10}$/.test(d)) return null;
    const e = url.searchParams.get('e');
    const f = url.searchParams.get('f');
    return { site: 'mtgtop8', id: d, ...(e && /^\d{1,10}$/.test(e) ? { event: e } : {}), ...(f && /^\w{1,8}$/.test(f) ? { format: f } : {}) };
  }
  if (host === 'moxfield.com') {
    const m = url.pathname.match(/^\/decks\/([A-Za-z0-9_-]{6,40})\/?$/);
    return m ? { site: 'moxfield', id: m[1] } : null;
  }
  if (host === 'archidekt.com') {
    const m = url.pathname.match(/^\/decks\/(\d{1,12})(?:\/|$)/);
    return m ? { site: 'archidekt', id: m[1] } : null;
  }
  return null;
}

/** mtgtop8's format codes (the f= of its links). */
const MTGTOP8_FORMATS: Record<string, string> = { ST: 'standard', PI: 'pioneer', MO: 'modern', LE: 'legacy', VI: 'vintage', PAU: 'pauper', EDH: 'commander', cEDH: 'commander' };
/** Archidekt's format numbers (the ones the app has). */
const ARCHIDEKT_FORMATS: Record<number, string> = { 1: 'standard', 2: 'modern', 3: 'commander', 4: 'legacy', 5: 'vintage', 6: 'pauper', 15: 'pioneer' };
const APP_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'];

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const USER_AGENT = 'magic-trainer/1.0 (deck import; +https://github.com/svandecappelle/magic-trainer)';
const MAX_BYTES = 2_000_000;

/** A page or API answer: 10 s at most, 2 MB at most. */
async function get(fetchFn: Fetch, url: string): Promise<{ text: string; type: string }> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, text/html' }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, 'sourceUnreachable');
  }
  if (res.status === 404) throw new HttpError(404, 'deckNotFound');
  // Moxfield keeps other sites out (its bot protection): the decklist is to be copied from its export instead.
  if (res.status === 403 || res.status === 401) throw new HttpError(502, 'sourceRefused');
  if (!res.ok) throw new HttpError(502, 'sourceUnreachable', { status: res.status });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new HttpError(502, 'sourceUnreachable');
  const type = res.headers.get('content-type') ?? '';
  // mtgtop8 pages are Latin-1.
  return { text: new TextDecoder(/charset=utf-8|json/i.test(type) ? 'utf-8' : 'latin1').decode(bytes), type };
}

const section = (title: string, lines: string[]) => (lines.length ? `${title}\n${lines.join('\n')}\n` : '');

export async function importDeck(fetchFn: Fetch, site: Site): Promise<ImportedDeck> {
  if (site.site === 'mtgtop8') {
    // Its MTGO export; a commander format lists the commander(s) as the sideboard.
    const { text } = await get(fetchFn, `https://www.mtgtop8.com/mtgo?d=${site.id}`);
    if (!/^\d+\s+\S/m.test(text)) throw new HttpError(404, 'deckNotFound');
    const format = site.format ? MTGTOP8_FORMATS[site.format] : undefined;
    const body = format === 'commander' ? text.replace(/^Sideboard\s*$/m, 'Commander') : text;
    let name = `mtgtop8 ${site.id}`;
    if (site.event) {
      const page = await get(fetchFn, `https://www.mtgtop8.com/event?e=${site.event}&d=${site.id}${site.format ? `&f=${site.format}` : ''}`).catch(() => null);
      const title = page?.text.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*@ mtgtop8\.com\s*$/, '').trim();
      if (title) name = title;
    }
    return { name, ...(format ? { format } : {}), text: body.startsWith('Commander') ? body : `Deck\n${body}`, source: 'mtgtop8' };
  }
  if (site.site === 'moxfield') {
    const { text } = await get(fetchFn, `https://api2.moxfield.com/v3/decks/all/${site.id}`);
    const deck = JSON.parse(text) as { name?: string; format?: string; boards?: Record<string, { cards?: Record<string, { quantity: number; card?: { name?: string } }> }> };
    const lines = (board: string) => Object.values(deck.boards?.[board]?.cards ?? {})
      .filter((c) => c.card?.name && c.quantity > 0).map((c) => `${c.quantity} ${c.card!.name}`);
    const out = section('Commander', lines('commanders')) + section('Deck', [...lines('mainboard'), ...lines('companions')]) + section('Sideboard', lines('sideboard'));
    if (!out) throw new HttpError(404, 'deckNotFound');
    const format = deck.format?.toLowerCase() === 'duelcommander' ? 'commander' : APP_FORMATS.find((f) => f === deck.format?.toLowerCase());
    return { name: deck.name?.slice(0, 100) || `Moxfield ${site.id}`, ...(format ? { format } : {}), text: out, source: 'moxfield' };
  }
  const { text } = await get(fetchFn, `https://archidekt.com/api/decks/${site.id}/`);
  const deck = JSON.parse(text) as {
    name?: string; deckFormat?: number;
    categories?: { name: string; includedInDeck: boolean }[];
    cards?: { quantity: number; categories?: string[] | null; card?: { oracleCard?: { name?: string } } }[];
  };
  // Cards in a category left out of the deck (Maybeboard…) aren't imported.
  const excluded = new Set((deck.categories ?? []).filter((c) => !c.includedInDeck).map((c) => c.name));
  const commander: string[] = [];
  const main: string[] = [];
  const side: string[] = [];
  for (const c of deck.cards ?? []) {
    const name = c.card?.oracleCard?.name;
    const cats = c.categories ?? [];
    if (!name || c.quantity <= 0 || cats.some((x) => excluded.has(x) && x !== 'Sideboard' && x !== 'Commander')) continue;
    const line = `${c.quantity} ${name}`;
    if (cats.includes('Commander')) commander.push(line);
    else if (cats.includes('Sideboard')) side.push(line);
    else main.push(line);
  }
  const out = section('Commander', commander) + section('Deck', main) + section('Sideboard', side);
  if (!out) throw new HttpError(404, 'deckNotFound');
  const format = deck.deckFormat !== undefined ? ARCHIDEKT_FORMATS[deck.deckFormat] : undefined;
  return { name: deck.name?.slice(0, 100) || `Archidekt ${site.id}`, ...(format ? { format } : {}), text: out, source: 'archidekt' };
}

export interface ImportRoutesOptions {
  fetch?: Fetch;
}

/** GET /api/import-deck?url=…: public (no account needed), 20 imports a minute per address. */
export function importRoutes({ fetch: fetchFn = fetch }: ImportRoutesOptions = {}) {
  const limit = rateLimiter(20, 60_000);
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== '/api/import-deck') return false;
    try {
      if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'methodNotAllowed');
      const site = parseDeckUrl(url.searchParams.get('url') ?? '');
      if (!site) throw new HttpError(400, 'unsupportedLink');
      if (!limit.hit(clientIp(req))) throw new HttpError(429, 'tooManyRequests');
      sendJson(res, 200, await importDeck(fetchFn, site));
    } catch (e) {
      if (e instanceof SyntaxError) {
        sendJson(res, 502, { error: 'sourceUnreachable' });
      } else if (e instanceof HttpError) {
        sendJson(res, e.status, { error: e.code, ...e.params });
      } else throw e;
    }
    return true;
  }
  return { handle };
}
