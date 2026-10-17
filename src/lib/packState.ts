/**
 * Games saved to storage (bot games in the browser, online rooms in the database) as compact JSON: a game state
 * repeats the same card data many times (decks, zones, the log), so each distinct card is written once and
 * referenced as {"$c": index}.
 */

/** A Card (see types.ts): the fields only cards have together. */
const isCard = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof (v as Record<string, unknown>).id === 'string' && typeof (v as Record<string, unknown>).typeLine === 'string'
  && typeof (v as Record<string, unknown>).oracleText === 'string' && Array.isArray((v as Record<string, unknown>).colorIdentity);

export function packState(value: unknown): string {
  const table: string[] = [];
  const index = new Map<string, number>();
  const data = JSON.stringify(value, (_key, v) => {
    if (!isCard(v)) return v;
    // Identical cards share an entry; a changed copy (another printing, a token) gets its own.
    const json = JSON.stringify(v);
    let i = index.get(json);
    if (i === undefined) {
      i = table.push(json) - 1;
      index.set(json, i);
    }
    return { $c: i };
  });
  return `{"cards":[${table.join(',')}],"data":${data}}`;
}

export function unpackState<T>(packed: string): T {
  const { cards, data } = JSON.parse(packed) as { cards: unknown[]; data: unknown };
  const restore = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(restore);
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    if (typeof o.$c === 'number' && Object.keys(o).length === 1) return cards[o.$c];
    for (const k of Object.keys(o)) o[k] = restore(o[k]);
    return o;
  };
  return restore(data) as T;
}
