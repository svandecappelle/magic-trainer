import { LEGALITIES, type Card } from '../types';

const API = 'https://api.scryfall.com';

interface ScryfallImages {
  small?: string;
  normal?: string;
}

interface ScryfallFace {
  name?: string;
  printed_name?: string;
  printed_type_line?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: ScryfallImages;
}

export interface ScryfallCard extends ScryfallFace {
  id: string;
  name: string;
  cmc?: number;
  color_identity?: string[];
  card_faces?: ScryfallFace[];
  prices?: { usd?: string | null };
  set: string;
  set_name: string;
  rarity: string;
  keywords?: string[];
  lang?: string;
  layout?: string;
  legalities?: Record<string, string>;
}

/** Convert a Scryfall card to our slim Card. Double-faced cards keep their data on card_faces. */
export function toCard(c: ScryfallCard): Card {
  const face = c.card_faces?.[0];
  const images = c.image_uris ?? face?.image_uris;
  return {
    id: c.id,
    name: c.name,
    manaCost: c.mana_cost ?? face?.mana_cost ?? '',
    cmc: c.cmc ?? 0,
    typeLine: c.type_line ?? face?.type_line ?? '',
    oracleText: c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n//\n') ?? '',
    colors: c.colors ?? face?.colors ?? [],
    colorIdentity: c.color_identity ?? [],
    imageSmall: images?.small,
    imageNormal: images?.normal,
    priceUsd: c.prices?.usd ? Number(c.prices.usd) : undefined,
    setCode: c.set,
    setName: c.set_name,
    rarity: c.rarity,
    power: c.power ?? face?.power,
    toughness: c.toughness ?? face?.toughness,
    ...((c.loyalty ?? face?.loyalty) ? { loyalty: c.loyalty ?? face?.loyalty } : {}),
    ...(c.layout && c.layout !== 'normal' ? { layout: c.layout } : {}),
    ...(c.legalities ? { legalities: Object.fromEntries(LEGALITIES.filter((f) => c.legalities![f]).map((f) => [f, c.legalities![f]])) } : {}),
    ...(c.card_faces?.length ? {
      faces: c.card_faces.map((f) => ({
        name: f.name ?? '', manaCost: f.mana_cost ?? '', typeLine: f.type_line ?? '', oracleText: f.oracle_text ?? '',
        ...(f.colors ? { colors: f.colors } : {}), ...(f.power ? { power: f.power, toughness: f.toughness } : {}),
        ...(f.loyalty ? { loyalty: f.loyalty } : {}),
        ...(f.image_uris ? { imageSmall: f.image_uris.small, imageNormal: f.image_uris.normal } : {}),
      })),
    } : {}),
    keywords: c.keywords,
    ...(c.lang && c.lang !== 'en' ? localizedText(c) : {}),
  };
}

/** Printed (localized) name and type line of a non-English printing, if Scryfall has them. */
function localizedText(c: ScryfallCard): Pick<Card, 'lang' | 'printedName' | 'printedTypeLine'> {
  const faces = c.card_faces ?? [];
  const facesName = faces.every((f) => f.printed_name) && faces.length ? faces.map((f) => f.printed_name).join(' // ') : undefined;
  const facesType = faces.every((f) => f.printed_type_line) && faces.length ? faces.map((f) => f.printed_type_line).join(' // ') : undefined;
  return { lang: c.lang, printedName: c.printed_name ?? facesName, printedTypeLine: c.printed_type_line ?? facesType };
}

// Scryfall asks clients to wait 50–100 ms between requests; queue them 100 ms apart.
let queue: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  const ready = queue;
  queue = queue.then(() => new Promise((r) => setTimeout(r, 100)));
  return ready;
}

export interface SearchResult {
  cards: Card[];
  total: number;
  hasMore: boolean;
}

/**
 * Full-text search using Scryfall syntax, e.g. "t:dragon c:r" or "lightning".
 * `multilingual` also matches names printed in other languages ("Foudre" finds Lightning Bolt).
 */
export async function searchCards(query: string, page = 1, signal?: AbortSignal, multilingual = false): Promise<SearchResult> {
  await throttle();
  const url = `${API}/cards/search?q=${encodeURIComponent(query)}&page=${page}${multilingual ? '&include_multilingual=true' : ''}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (res.status === 404) return { cards: [], total: 0, hasMore: false };
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  const body = await res.json();
  return { cards: body.data.map(toCard), total: body.total_cards, hasMore: body.has_more };
}

/** Look up many cards by exact name (used by deck import). */
export async function fetchCardsByName(names: string[]): Promise<{ found: Card[]; notFound: string[] }> {
  const found: Card[] = [];
  const notFound: string[] = [];
  for (let i = 0; i < names.length; i += 75) {
    const batch = names.slice(i, i + 75);
    await throttle();
    const res = await fetch(`${API}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'MagicTrainer/1.0' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
    const body = await res.json();
    found.push(...body.data.map(toCard));
    notFound.push(...body.not_found.map((n: { name: string }) => n.name));
  }
  return { found, notFound };
}

/** Look up cards by Scryfall id (refreshing saved card data, server-side deck checks). Unknown ids are left out. */
export async function fetchCardsById(ids: string[]): Promise<Map<string, Card>> {
  const out = new Map<string, Card>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    await throttle();
    const res = await fetch(`${API}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'MagicTrainer/1.0' },
      body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
    const body = await res.json();
    for (const c of body.data as ScryfallCard[]) out.set(c.id, toCard(c));
  }
  return out;
}

const exactNames = (names: string[]) => `(${names.map((n) => `!"${n.replace(/"/g, '\\"')}"`).join(' or ')})`;

/** All results of a search, following pagination. Returns [] when nothing matches. */
async function searchAll(query: string, multilingual: boolean): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  let url: string | null = `${API}/cards/search?q=${encodeURIComponent(query)}${multilingual ? '&include_multilingual=true' : ''}`;
  while (url) {
    await throttle();
    // Scryfall refuses requests without a User-Agent (Node scripts; browsers send their own).
    const res: Response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MagicTrainer/1.0' } });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
    const body = await res.json();
    out.push(...body.data);
    url = body.has_more ? body.next_page : null;
  }
  return out;
}

/**
 * A printing in `lang` for each English card name (when one exists), keyed by English name.
 * Batched: one request per 20 names.
 */
export async function fetchPrintings(names: string[], lang: string): Promise<Map<string, Card>> {
  const wanted = new Set(names);
  const found = new Map<string, Card>();
  for (let i = 0; i < names.length; i += 20) {
    const results = await searchAll(`${exactNames(names.slice(i, i + 20))} lang:${lang}`, false);
    // "!Lightning Bolt" also matches cards with that name on a face: keep exact names only.
    for (const c of results) if (wanted.has(c.name) && !found.has(c.name)) found.set(c.name, toCard(c));
  }
  return found;
}

/** Look up cards by their printed name in any language ("Foudre"), keyed by that lowercased name. */
/**
 * One card per name with Scryfall's exact lookup, which also knows flavor names (crossover printings: "Mayor Tong of
 * Chin Village" is Drannith Magistrate). Keyed by the name asked, lower case. For the few names nothing else found.
 */
export async function fetchByExactNames(names: string[]): Promise<Map<string, Card>> {
  const found = new Map<string, Card>();
  for (const name of names) {
    await throttle();
    const res = await fetch(`${API}/cards/named?exact=${encodeURIComponent(name)}`, { headers: { Accept: 'application/json', 'User-Agent': 'MagicTrainer/1.0' } });
    if (res.ok) found.set(name.toLowerCase(), toCard(await res.json()));
  }
  return found;
}

export async function fetchByPrintedNames(names: string[]): Promise<Map<string, Card>> {
  const found = new Map<string, Card>();
  for (let i = 0; i < names.length; i += 20) {
    for (const c of await searchAll(exactNames(names.slice(i, i + 20)), true)) {
      const card = toCard(c);
      // English printings may have another name too ("Ademi of the Silkchutes" is Spectacular Spider-Man).
      for (const n of [card.printedName, card.printedName?.split(' // ')[0], c.printed_name, card.name]) {
        if (n && !found.has(n.toLowerCase())) found.set(n.toLowerCase(), card);
      }
    }
  }
  return found;
}
