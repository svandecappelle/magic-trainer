import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { FORMATS, type Board, type Card, type CollectionEntry, type Deck, type DeckEntry } from '../src/types';
import type { Accounts, SessionUser } from './auth';
import { isUuid } from './db/cards';
import { HttpError, rateLimiter, readJson, sendJson } from './http';

/** Saved decks and collection of the logged-in user (docs/accounts.md, HTTP API). */

export const LIMITS = { decks: 500, deckEntries: 300, collectionCards: 20_000, collectionPatch: 5_000 };
/** Deleted decks are remembered this long, so that other devices learn about the deletion. */
const TOMBSTONE_DAYS = 90;
/** GET /api/decks returns a cursor this far in the past: changes still being committed are not missed. */
const CURSOR_MARGIN_MS = 60_000;
const BOARDS: readonly Board[] = ['main', 'side', 'commander'];

/** A deck as the API returns it: the client's Deck, plus the version to send back when changing it. */
export type SavedDeck = Deck & { version: number };
export interface DeletedDeck {
  id: string;
  version: number;
  deletedAt: number;
}

type Lookup = (ids: string[]) => Promise<Map<string, Card>>;

interface DeckBody {
  name: string;
  format: string;
  entries: { cardId: string; board: Board; qty: number }[];
  createdAt: number;
  updatedAt: number;
  baseVersion: number;
}

const bad = (field: string) => new HttpError(400, 'invalid', { field });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Checks a PUT /api/decks/:id body. */
export function parseDeckBody(body: unknown): DeckBody {
  if (!isObject(body)) throw bad('body');
  const { name, format, entries, createdAt, updatedAt, baseVersion } = body;
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw bad('name');
  if (typeof format !== 'string' || !(FORMATS as readonly string[]).includes(format)) throw bad('format');
  if (!isInt(createdAt, 0, 8.64e15)) throw bad('createdAt');
  if (!isInt(updatedAt, 0, 8.64e15)) throw bad('updatedAt');
  if (!isInt(baseVersion ?? 0, 0, 2 ** 31 - 1)) throw bad('baseVersion');
  if (!Array.isArray(entries)) throw bad('entries');
  if (entries.length > LIMITS.deckEntries) throw new HttpError(422, 'tooManyEntries', { max: LIMITS.deckEntries });
  const seen = new Set<string>();
  for (const e of entries) {
    if (!isObject(e) || typeof e.cardId !== 'string' || !isUuid(e.cardId)) throw bad('entries.cardId');
    if (!BOARDS.includes(e.board as Board)) throw bad('entries.board');
    if (!isInt(e.qty, 1, 999)) throw bad('entries.qty');
    const key = `${e.cardId}/${e.board}`;
    if (seen.has(key)) throw bad('entries.duplicate');
    seen.add(key);
  }
  return {
    name: name.trim(),
    format,
    entries: (entries as DeckBody['entries']).map(({ cardId, board, qty }) => ({ cardId: cardId.toLowerCase(), board, qty })),
    createdAt,
    updatedAt,
    baseVersion: (baseVersion as number | undefined) ?? 0,
  };
}

/** Checks a PATCH /api/collection body: absolute quantities, 0 and 0 removes the card. */
export function parseCollectionBody(body: unknown): { cardId: string; qty: number; foilQty: number }[] {
  if (!Array.isArray(body)) throw bad('body');
  if (body.length > LIMITS.collectionPatch) throw new HttpError(413, 'tooLarge', { max: LIMITS.collectionPatch });
  const seen = new Set<string>();
  return body.map((e) => {
    if (!isObject(e) || typeof e.cardId !== 'string' || !isUuid(e.cardId)) throw bad('cardId');
    if (!isInt(e.qty, 0, 1_000_000)) throw bad('qty');
    if (!isInt(e.foilQty, 0, 1_000_000)) throw bad('foilQty');
    const cardId = e.cardId.toLowerCase();
    if (seen.has(cardId)) throw bad('duplicate');
    seen.add(cardId);
    return { cardId, qty: e.qty, foilQty: e.foilQty };
  });
}

/** Clamps a client time to the server's clock, so a device set in the future can't win every conflict. */
const clientTime = (ms: number) => new Date(Math.min(ms, Date.now()));

interface DeckRow {
  id: string;
  name: string;
  format: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  entries: DeckEntry[];
}

const DECK_SELECT = `
  SELECT d.id, d.name, d.format, d.version, d.created_at, d.updated_at, d.deleted_at,
         COALESCE(json_agg(json_build_object('card', c.data, 'qty', dc.qty, 'board', dc.board)
                           ORDER BY dc.board, c.data->>'name') FILTER (WHERE dc.deck_id IS NOT NULL), '[]') AS entries
    FROM decks d
    LEFT JOIN deck_cards dc ON dc.deck_id = d.id
    LEFT JOIN cards c ON c.id = dc.card_id`;

function toApi(row: DeckRow): SavedDeck | DeletedDeck {
  if (row.deleted_at) return { id: row.id, version: row.version, deletedAt: row.deleted_at.getTime() };
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    entries: row.entries,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    version: row.version,
  };
}

async function deckOf(db: pg.Pool | pg.PoolClient, id: string): Promise<SavedDeck | DeletedDeck> {
  const { rows } = await db.query<DeckRow>(`${DECK_SELECT} WHERE d.id = $1 GROUP BY d.id`, [id]);
  return toApi(rows[0]);
}

/**
 * Makes sure every card is in the cards table (fetched from Scryfall if needed). 422 for ids Scryfall doesn't know,
 * 503 when Scryfall can't be reached (the client retries later).
 */
async function ensureCards(pool: pg.Pool, lookup: Lookup, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const { rows } = await pool.query<{ id: string }>(`SELECT id::text FROM cards WHERE id = ANY($1::uuid[])`, [unique]);
  const known = new Set(rows.map((r) => r.id));
  const missing = unique.filter((id) => !known.has(id));
  if (!missing.length) return;
  let found: Map<string, Card>;
  try {
    found = await lookup(missing);
  } catch (e) {
    console.warn('Scryfall unreachable:', (e as Error).message);
    throw new HttpError(503, 'scryfallUnavailable');
  }
  const unknown = missing.filter((id) => !found.has(id));
  if (unknown.length) throw new HttpError(422, 'unknownCards', { ids: unknown });
}

/** Deletes the tombstones older than TOMBSTONE_DAYS; returns how many. */
export async function purgeDeletedDecks(pool: pg.Pool): Promise<number> {
  return (await pool.query(`DELETE FROM decks WHERE deleted_at < now() - make_interval(days => $1)`, [TOMBSTONE_DAYS])).rowCount ?? 0;
}

export interface DeckRoutesOptions {
  pool: pg.Pool | null;
  account: Pick<Accounts, 'enabled' | 'userOf' | 'sameOrigin'>;
  /** Fetches cards from Scryfall and saves them in the cards table (storedLookup). */
  lookup: Lookup;
}

/** /api/decks and /api/collection. Every query is limited to the session's user. */
export function deckRoutes({ pool, account, lookup }: DeckRoutesOptions) {
  const writeLimit = rateLimiter(300, 60_000);

  async function listDecks(user: SessionUser, url: URL, res: ServerResponse) {
    const since = Number(url.searchParams.get('since') ?? NaN);
    const { rows } = await pool!.query<DeckRow & { now: Date }>(
      `${DECK_SELECT} WHERE d.user_id = $1 AND ($2::timestamptz IS NULL OR d.synced_at > $2) GROUP BY d.id ORDER BY d.created_at`,
      [user.id, Number.isFinite(since) ? new Date(since) : null],
    );
    const items = rows.map(toApi);
    sendJson(res, 200, {
      decks: items.filter((d): d is SavedDeck => !('deletedAt' in d)),
      deleted: items.filter((d): d is DeletedDeck => 'deletedAt' in d),
      cursor: Date.now() - CURSOR_MARGIN_MS,
    });
  }

  async function saveDeck(user: SessionUser, id: string, req: IncomingMessage, res: ServerResponse) {
    const body = parseDeckBody(await readJson(req));
    await ensureCards(pool!, lookup, body.entries.map((e) => e.cardId));
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ user_id: string; version: number }>(`SELECT user_id, version FROM decks WHERE id = $1 FOR UPDATE`, [id]);
      const current = rows[0];
      // Another user's deck id answers like a missing deck, so ids can't be probed.
      if (current && current.user_id !== user.id) throw new HttpError(404, 'notFound');
      if (current && current.version !== body.baseVersion) {
        await client.query('ROLLBACK');
        return sendJson(res, 409, { error: 'conflict', deck: await deckOf(pool!, id) });
      }
      if (!current) {
        if (body.baseVersion !== 0) throw new HttpError(404, 'notFound');
        // Serialize the user's creations, so two at once can't both pass the count.
        await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
        const { rows: [{ n }] } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM decks WHERE user_id = $1 AND deleted_at IS NULL`, [user.id]);
        if (n >= LIMITS.decks) throw new HttpError(422, 'tooManyDecks', { max: LIMITS.decks });
        await client.query(
          `INSERT INTO decks (id, user_id, name, format, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, user.id, body.name, body.format, clientTime(body.createdAt), clientTime(body.updatedAt)],
        );
      } else {
        // Saving a deleted deck with its current version brings it back (undo).
        await client.query(
          `UPDATE decks SET name = $2, format = $3, updated_at = $4, version = version + 1, synced_at = now(), deleted_at = NULL WHERE id = $1`,
          [id, body.name, body.format, clientTime(body.updatedAt)],
        );
        await client.query(`DELETE FROM deck_cards WHERE deck_id = $1`, [id]);
      }
      if (body.entries.length) {
        await client.query(
          `INSERT INTO deck_cards (deck_id, card_id, board, qty)
           SELECT $1::uuid, * FROM unnest($2::uuid[], $3::deck_board[], $4::smallint[])`,
          [id, body.entries.map((e) => e.cardId), body.entries.map((e) => e.board), body.entries.map((e) => e.qty)],
        );
      }
      await client.query('COMMIT');
      sendJson(res, current ? 200 : 201, await deckOf(pool!, id));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function deleteDeck(user: SessionUser, id: string, res: ServerResponse) {
    const { rows } = await pool!.query<{ version: number; deleted_at: Date }>(
      `UPDATE decks SET deleted_at = COALESCE(deleted_at, now()), version = version + (deleted_at IS NULL)::int,
                        synced_at = CASE WHEN deleted_at IS NULL THEN now() ELSE synced_at END
        WHERE id = $1 AND user_id = $2 RETURNING version, deleted_at`,
      [id, user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'notFound');
    // The cards of a deleted deck are not needed any more: only the tombstone stays.
    await pool!.query(`DELETE FROM deck_cards WHERE deck_id = $1`, [id]);
    sendJson(res, 200, { id, version: rows[0].version, deletedAt: rows[0].deleted_at.getTime() });
  }

  async function getCollection(user: SessionUser, res: ServerResponse) {
    const { rows } = await pool!.query<CollectionEntry>(
      `SELECT c.data AS card, cc.qty, cc.foil_qty AS "foilQty"
         FROM collection_cards cc JOIN cards c ON c.id = cc.card_id
        WHERE cc.user_id = $1 ORDER BY c.data->>'name'`,
      [user.id],
    );
    sendJson(res, 200, { cards: rows });
  }

  async function patchCollection(user: SessionUser, req: IncomingMessage, res: ServerResponse) {
    const changes = parseCollectionBody(await readJson(req));
    const kept = changes.filter((c) => c.qty + c.foilQty > 0);
    await ensureCards(pool!, lookup, kept.map((c) => c.cardId));
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
      const removed = changes.filter((c) => c.qty + c.foilQty === 0).map((c) => c.cardId);
      if (removed.length) await client.query(`DELETE FROM collection_cards WHERE user_id = $1 AND card_id = ANY($2::uuid[])`, [user.id, removed]);
      if (kept.length) {
        await client.query(
          `INSERT INTO collection_cards (user_id, card_id, qty, foil_qty, updated_at)
           SELECT $1::uuid, *, now() FROM unnest($2::uuid[], $3::int[], $4::int[])
           ON CONFLICT (user_id, card_id) DO UPDATE SET qty = EXCLUDED.qty, foil_qty = EXCLUDED.foil_qty, updated_at = now()`,
          [user.id, kept.map((c) => c.cardId), kept.map((c) => c.qty), kept.map((c) => c.foilQty)],
        );
      }
      const { rows: [{ n }] } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM collection_cards WHERE user_id = $1`, [user.id]);
      if (n > LIMITS.collectionCards) throw new HttpError(422, 'tooManyCards', { max: LIMITS.collectionCards });
      await client.query('COMMIT');
      sendJson(res, 200, { count: n });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Handles /api/decks… and /api/collection; false for any other path. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    const deckId = /^\/api\/decks\/([^/]+)$/.exec(path)?.[1];
    if (path !== '/api/decks' && path !== '/api/collection' && deckId === undefined) return false;
    try {
      if (!account.enabled || !pool) throw new HttpError(404, 'accountsDisabled');
      const method = req.method ?? 'GET';
      const write = method !== 'GET';
      if (write && !account.sameOrigin(req)) throw new HttpError(403, 'badOrigin');
      const user = await account.userOf(req, res);
      if (!user) throw new HttpError(401, 'notLoggedIn');
      if (write && !writeLimit.hit(user.id)) throw new HttpError(429, 'tooManyRequests');
      if (deckId !== undefined) {
        if (!isUuid(deckId)) throw new HttpError(404, 'notFound');
        const id = deckId.toLowerCase();
        if (method === 'PUT') await saveDeck(user, id, req, res);
        else if (method === 'DELETE') await deleteDeck(user, id, res);
        else throw new HttpError(405, 'methodNotAllowed');
      } else if (path === '/api/decks') {
        if (method === 'GET') await listDecks(user, url, res);
        else throw new HttpError(405, 'methodNotAllowed');
      } else if (method === 'GET') await getCollection(user, res);
      else if (method === 'PATCH') await patchCollection(user, req, res);
      else throw new HttpError(405, 'methodNotAllowed');
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      sendJson(res, e.status, { error: e.code, ...e.params });
    }
    return true;
  }

  return { handle };
}
