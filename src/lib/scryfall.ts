import type { Card } from '../types';

const API = 'https://api.scryfall.com';

interface ScryfallImages {
  small?: string;
  normal?: string;
}

interface ScryfallFace {
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
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
  };
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

/** Full-text search using Scryfall syntax, e.g. "t:dragon c:r" or "lightning". */
export async function searchCards(query: string, page = 1, signal?: AbortSignal): Promise<SearchResult> {
  await throttle();
  const url = `${API}/cards/search?q=${encodeURIComponent(query)}&page=${page}`;
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
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
    const body = await res.json();
    found.push(...body.data.map(toCard));
    notFound.push(...body.not_found.map((n: { name: string }) => n.name));
  }
  return { found, notFound };
}
