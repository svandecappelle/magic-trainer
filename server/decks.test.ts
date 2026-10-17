import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Card } from '../src/types';
import { accounts, createSession, upsertDiscordUser, type AuthConfig } from './auth';
import { testDb, testDbUrl } from './db/testDb';
import { deckRoutes, LIMITS, parseCollectionBody, parseDeckBody, purgeDeletedDecks } from './decks';
import { HttpError } from './http';

const PUBLIC = 'https://magic.example.com';
const config: AuthConfig = { publicUrl: PUBLIC, discordClientId: 'client', discordClientSecret: 'secret' };

const BOLT = '11111111-1111-4111-8111-111111111111';
const SHOCK = '22222222-2222-4222-8222-222222222222';
const MOUNTAIN = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const card = (id: string, name: string): Card => ({
  id, name, manaCost: '{R}', cmc: 1, typeLine: 'Instant', oracleText: '', colors: ['R'], colorIdentity: ['R'],
  setCode: 'lea', setName: 'Alpha', rarity: 'common',
});
const SCRYFALL = new Map([card(BOLT, 'Lightning Bolt'), card(SHOCK, 'Shock'), card(MOUNTAIN, 'Mountain')].map((c) => [c.id, c]));

const deckBody = (over: Record<string, unknown> = {}) => ({
  name: 'Burn', format: 'modern', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, baseVersion: 0,
  entries: [{ cardId: BOLT, board: 'main', qty: 4 }, { cardId: MOUNTAIN, board: 'main', qty: 20 }, { cardId: SHOCK, board: 'side', qty: 2 }],
  ...over,
});

function invalid(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code} ${JSON.stringify(e.params ?? {})}` : String(e);
  }
  return undefined;
}

describe('deck API bodies', () => {
  it('accepts a valid deck and refuses malformed ones', () => {
    expect(parseDeckBody(deckBody({ name: '  Burn ', baseVersion: undefined }))).toMatchObject({ name: 'Burn', baseVersion: 0 });
    expect(invalid(() => parseDeckBody(deckBody({ name: '' })))).toContain('"field":"name"');
    expect(invalid(() => parseDeckBody(deckBody({ format: 'brawl' })))).toContain('"field":"format"');
    expect(invalid(() => parseDeckBody(deckBody({ entries: [{ cardId: 'not-an-id', board: 'main', qty: 1 }] })))).toContain('entries.cardId');
    expect(invalid(() => parseDeckBody(deckBody({ entries: [{ cardId: BOLT, board: 'maybe', qty: 1 }] })))).toContain('entries.board');
    expect(invalid(() => parseDeckBody(deckBody({ entries: [{ cardId: BOLT, board: 'main', qty: 0 }] })))).toContain('entries.qty');
    expect(invalid(() => parseDeckBody(deckBody({ entries: [{ cardId: BOLT, board: 'main', qty: 1 }, { cardId: BOLT, board: 'main', qty: 2 }] })))).toContain('duplicate');
    const many = Array.from({ length: LIMITS.deckEntries + 1 }, (_, i) => ({ cardId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, board: 'main', qty: 1 }));
    expect(invalid(() => parseDeckBody(deckBody({ entries: many })))).toContain('422 tooManyEntries');
  });

  it('accepts absolute collection quantities', () => {
    expect(parseCollectionBody([{ cardId: BOLT.toUpperCase(), qty: 3, foilQty: 1 }])).toEqual([{ cardId: BOLT, qty: 3, foilQty: 1 }]);
    expect(invalid(() => parseCollectionBody({}))).toContain('"field":"body"');
    expect(invalid(() => parseCollectionBody([{ cardId: BOLT, qty: -1, foilQty: 0 }]))).toContain('"field":"qty"');
    expect(invalid(() => parseCollectionBody([{ cardId: BOLT, qty: 1, foilQty: 0 }, { cardId: BOLT, qty: 2, foilQty: 0 }]))).toContain('duplicate');
  });
});

describe.skipIf(!testDbUrl)('deck and collection API', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: Server;
  let base: string;
  let scryfallDown = false;
  const asked: string[][] = [];
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ({ pool, drop } = await testDb());
    const account = accounts({ pool, config });
    const lookup = async (ids: string[]) => {
      asked.push(ids);
      if (scryfallDown) throw new Error('offline');
      const found = new Map(ids.filter((id) => SCRYFALL.has(id)).map((id) => [id, SCRYFALL.get(id)!]));
      await pool.query(`INSERT INTO cards (id, data) SELECT (c->>'id')::uuid, c FROM jsonb_array_elements($1::jsonb) c ON CONFLICT DO NOTHING`, [JSON.stringify([...found.values()])]);
      return found;
    };
    const decks = deckRoutes({ pool, account, lookup });
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!(await account.handle(req, res, url)) && !(await decks.handle(req, res, url))) res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await drop?.();
  });
  afterEach(async () => {
    scryfallDown = false;
    asked.length = 0;
    await pool.query('DELETE FROM users; DELETE FROM cards');
  });

  async function login(id: string, name: string) {
    return createSession(pool, await upsertDiscordUser(pool, { id, username: name }));
  }

  /** A request as `session`, from our own pages unless `origin` says otherwise. */
  async function call(session: string | null, method: string, path: string, body?: unknown, origin = PUBLIC) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(session ? { Cookie: `mt_session=${session}` } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  }

  const DECK = '44444444-4444-4444-8444-444444444444';

  it('saves a deck with versions, detects conflicts and returns full card data', async () => {
    alice = await login('1', 'alice');
    const created = await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody());
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ id: DECK, name: 'Burn', format: 'modern', version: 1, createdAt: 1_700_000_000_000 });
    expect(created.json.entries).toContainEqual({ card: SCRYFALL.get(BOLT), qty: 4, board: 'main' });
    expect(asked).toEqual([[BOLT, MOUNTAIN, SHOCK]]);

    const updated = await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody({ name: 'Burn 2', baseVersion: 1, updatedAt: 1_700_000_100_000, entries: [{ cardId: BOLT, board: 'main', qty: 3 }] }));
    expect(updated).toMatchObject({ status: 200, json: { name: 'Burn 2', version: 2, entries: [{ qty: 3 }] } });
    // Known cards are not asked to Scryfall again.
    expect(asked).toHaveLength(1);

    // A device that saw version 1 is told about version 2.
    const stale = await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody({ baseVersion: 1 }));
    expect(stale).toMatchObject({ status: 409, json: { error: 'conflict', deck: { name: 'Burn 2', version: 2 } } });
    // A new deck's id that exists already is a conflict too, never an overwrite.
    expect((await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody())).status).toBe(409);

    const list = await call(alice, 'GET', '/api/decks');
    expect(list.json.decks.map((d: { name: string }) => d.name)).toEqual(['Burn 2']);
    expect(list.json.deleted).toEqual([]);
    expect(typeof list.json.cursor).toBe('number');
  });

  it("keeps each user's decks private", async () => {
    alice = await login('1', 'alice');
    bob = await login('2', 'bob');
    await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody());
    expect((await call(bob, 'PUT', `/api/decks/${DECK}`, deckBody())).status).toBe(404);
    expect((await call(bob, 'PUT', `/api/decks/${DECK}`, deckBody({ baseVersion: 1 }))).status).toBe(404);
    expect((await call(bob, 'DELETE', `/api/decks/${DECK}`)).status).toBe(404);
    expect((await call(bob, 'GET', '/api/decks')).json.decks).toEqual([]);
    expect((await call(alice, 'GET', '/api/decks')).json.decks).toHaveLength(1);
  });

  it('refuses requests without a session, from other sites, or with bad cards', async () => {
    alice = await login('1', 'alice');
    expect((await call(null, 'GET', '/api/decks')).status).toBe(401);
    expect((await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody(), 'https://evil.example')).status).toBe(403);
    expect((await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody(), '')).status).toBe(403);
    expect((await call(alice, 'PUT', '/api/decks/not-a-uuid', deckBody())).status).toBe(404);
    expect((await call(alice, 'POST', '/api/decks')).status).toBe(405);
    const text = await fetch(`${base}/api/decks/${DECK}`, { method: 'PUT', headers: { Cookie: `mt_session=${alice}`, Origin: PUBLIC }, body: '{}' });
    expect(text.status).toBe(415);
    const unknown = await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody({ entries: [{ cardId: UNKNOWN, board: 'main', qty: 1 }] }));
    expect(unknown).toMatchObject({ status: 422, json: { error: 'unknownCards', ids: [UNKNOWN] } });
    scryfallDown = true;
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect((await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody())).status).toBe(503);
    } finally {
      console.warn = warn;
    }
    expect((await call(alice, 'GET', '/api/decks')).json.decks).toEqual([]);
  });

  it('deletes decks as tombstones, lists changes since a cursor, and can bring a deck back', async () => {
    alice = await login('1', 'alice');
    const OTHER = '55555555-5555-4555-8555-555555555555';
    await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody());
    await call(alice, 'PUT', `/api/decks/${OTHER}`, deckBody({ name: 'Other' }));
    const deleted = await call(alice, 'DELETE', `/api/decks/${DECK}`);
    expect(deleted.json).toMatchObject({ id: DECK, version: 2 });
    expect((await call(alice, 'DELETE', `/api/decks/${DECK}`)).json.version).toBe(2); // already deleted: unchanged
    const list = await call(alice, 'GET', '/api/decks');
    expect(list.json.decks.map((d: { id: string }) => d.id)).toEqual([OTHER]);
    expect(list.json.deleted).toEqual([{ id: DECK, version: 2, deletedAt: deleted.json.deletedAt }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM deck_cards WHERE deck_id = $1', [DECK])).rows[0].n).toBe(0);

    // Only what changed after the cursor.
    await pool.query(`UPDATE decks SET synced_at = now() - interval '1 hour' WHERE id = $1`, [OTHER]);
    const since = (await call(alice, 'GET', `/api/decks?since=${Date.now() - 30 * 60_000}`)).json;
    expect(since.decks).toEqual([]);
    expect(since.deleted.map((d: { id: string }) => d.id)).toEqual([DECK]);

    const back = await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody({ baseVersion: 2 }));
    expect(back).toMatchObject({ status: 200, json: { version: 3, name: 'Burn' } });
    expect((await call(alice, 'GET', '/api/decks')).json.deleted).toEqual([]);

    await call(alice, 'DELETE', `/api/decks/${DECK}`);
    await pool.query(`UPDATE decks SET deleted_at = now() - interval '91 days' WHERE id = $1`, [DECK]);
    expect(await purgeDeletedDecks(pool)).toBe(1);
  });

  it('limits the number of decks', async () => {
    alice = await login('1', 'alice');
    const max = LIMITS.decks;
    LIMITS.decks = 1;
    try {
      expect((await call(alice, 'PUT', `/api/decks/${DECK}`, deckBody())).status).toBe(201);
      const second = await call(alice, 'PUT', '/api/decks/55555555-5555-4555-8555-555555555555', deckBody());
      expect(second).toMatchObject({ status: 422, json: { error: 'tooManyDecks', max: 1 } });
    } finally {
      LIMITS.decks = max;
    }
  });

  it('keeps the collection with absolute quantities', async () => {
    alice = await login('1', 'alice');
    bob = await login('2', 'bob');
    const patch = await call(alice, 'PATCH', '/api/collection', [{ cardId: BOLT, qty: 4, foilQty: 1 }, { cardId: SHOCK, qty: 2, foilQty: 0 }]);
    expect(patch).toMatchObject({ status: 200, json: { count: 2 } });
    await call(alice, 'PATCH', '/api/collection', [{ cardId: BOLT, qty: 3, foilQty: 1 }, { cardId: SHOCK, qty: 0, foilQty: 0 }]);
    const all = (await call(alice, 'GET', '/api/collection')).json;
    expect(all).toMatchObject({ cards: [{ card: SCRYFALL.get(BOLT), qty: 3, foilQty: 1 }], removed: [] });
    expect((await call(bob, 'GET', '/api/collection')).json).toMatchObject({ cards: [], removed: [] });
    // Changes since a cursor include the removed cards; removing a card never saved changes nothing.
    await pool.query(`UPDATE collection_cards SET updated_at = now() - interval '1 hour' WHERE card_id = $1`, [BOLT]);
    expect((await call(alice, 'PATCH', '/api/collection', [{ cardId: MOUNTAIN, qty: 0, foilQty: 0 }])).status).toBe(200);
    const since = (await call(alice, 'GET', `/api/collection?since=${Date.now() - 30 * 60_000}`)).json;
    expect(since).toMatchObject({ cards: [], removed: [SHOCK] });
    await pool.query(`UPDATE collection_cards SET updated_at = now() - interval '91 days' WHERE card_id = $1`, [SHOCK]);
    expect(await purgeDeletedDecks(pool)).toBe(1);

    const max = LIMITS.collectionCards;
    LIMITS.collectionCards = 2;
    try {
      const over = await call(alice, 'PATCH', '/api/collection', [{ cardId: SHOCK, qty: 1, foilQty: 0 }, { cardId: MOUNTAIN, qty: 1, foilQty: 0 }]);
      expect(over).toMatchObject({ status: 422, json: { error: 'tooManyCards' } });
      expect((await call(alice, 'GET', '/api/collection')).json.cards).toHaveLength(1); // nothing saved
    } finally {
      LIMITS.collectionCards = max;
    }
  });

  it('answers 404 when accounts are disabled', async () => {
    const decks = deckRoutes({ pool: null, account: accounts({ pool: null, config: null }), lookup: async () => new Map() });
    const res = { status: 0, body: '', writeHead(s: number) { this.status = s; return this; }, end(b: string) { this.body = b; } };
    expect(await decks.handle({ method: 'GET', headers: {} } as never, res as never, new URL('http://x/api/decks'))).toBe(true);
    expect([res.status, JSON.parse(res.body)]).toEqual([404, { error: 'accountsDisabled' }]);
  });
});
