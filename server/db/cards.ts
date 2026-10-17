import type pg from 'pg';
import type { Card } from '../../src/types';

/** Cards older than this are fetched from Scryfall again (errata, legalities, prices). */
const MAX_AGE_DAYS = 30;

type Lookup = (ids: string[]) => Promise<Map<string, Card>>;

/**
 * The cards table: Scryfall data shared by every user, filled by the server only (never with data sent by a
 * client). Wraps a Scryfall lookup: cards found in the table are not asked again, the others are fetched and saved.
 * If the database fails, Scryfall is used alone.
 */
export function storedLookup(pool: pg.Pool, scryfall: Lookup): Lookup {
  return async (ids) => {
    const unique = [...new Set(ids)];
    const found = new Map<string, Card>();
    try {
      const { rows } = await pool.query<{ id: string; data: Card }>(
        `SELECT id::text, data FROM cards WHERE id = ANY($1::uuid[]) AND fetched_at > now() - make_interval(days => $2)`,
        [unique.filter(isUuid), MAX_AGE_DAYS],
      );
      for (const r of rows) found.set(r.id, r.data);
    } catch (e) {
      console.warn('Card table unavailable:', (e as Error).message);
    }
    const missing = unique.filter((id) => !found.has(id));
    if (!missing.length) return found;
    const fetched = await scryfall(missing);
    const fresh = [...fetched.values()].filter((c) => isUuid(c.id));
    if (fresh.length) {
      await pool
        .query(
          `INSERT INTO cards (id, data, fetched_at)
           SELECT (c->>'id')::uuid, c, now() FROM jsonb_array_elements($1::jsonb) AS c
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
          [JSON.stringify(fresh)],
        )
        .catch((e) => console.warn('Cards not saved:', (e as Error).message));
    }
    for (const [id, card] of fetched) found.set(id, card);
    return found;
  };
}

/** Scryfall ids are UUIDs; anything else (a forged id) can't be in the table. */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
