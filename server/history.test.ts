import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts, createSession, upsertDiscordUser, type AuthConfig } from './auth';
import { testDb, testDbUrl } from './db/testDb';
import { historyRoutes, historyStore, parseResults } from './history';
import { HttpError } from './http';

const PUBLIC = 'https://magic.example.com';
const config: AuthConfig = { publicUrl: PUBLIC, discordClientId: 'client', discordClientSecret: 'secret' };
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 9, 17);

const result = (over: Record<string, unknown> = {}) => ({
  id: M1, at: NOW - 60_000, twoHeaded: false, commander: false, bestOf: 3, deck: 'Burn', opponent: 'Elves',
  result: 'win', wins: 2, losses: 1, replays: ['local only'], ...over,
});

function invalid(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code} ${JSON.stringify(e.params ?? {})}` : String(e);
  }
  return undefined;
}

describe('history API bodies', () => {
  it('keeps the stored fields of bot results, refuses malformed ones', () => {
    expect(parseResults([result({ id: M1.toUpperCase(), kind: 'online' })], NOW)).toEqual([{
      id: M1, at: NOW - 60_000, kind: 'bot', twoHeaded: false, commander: false, bestOf: 3, deck: 'Burn', opponent: 'Elves',
      result: 'win', wins: 2, losses: 1,
    }]);
    expect(invalid(() => parseResults({}, NOW))).toContain('"field":"body"');
    expect(invalid(() => parseResults([result({ id: 'x' })], NOW))).toContain('"field":"id"');
    expect(invalid(() => parseResults([result({ at: NOW + 2 * 86400_000 })], NOW))).toContain('"field":"at"');
    expect(invalid(() => parseResults([result({ result: 'won' })], NOW))).toContain('"field":"result"');
    expect(invalid(() => parseResults([result({ bestOf: 5 })], NOW))).toContain('"field":"bestOf"');
    expect(invalid(() => parseResults([result({ deck: 'x'.repeat(101) })], NOW))).toContain('"field":"deck"');
  });
});

describe.skipIf(!testDbUrl)('history API', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ pool, drop } = await testDb());
    const account = accounts({ pool, config });
    const history = historyRoutes({ store: historyStore(pool), account });
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!(await history.handle(req, res, url))) res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await drop?.();
  });

  async function call(session: string | null, method: string, body?: unknown) {
    const res = await fetch(`${base}/api/history`, {
      method,
      headers: {
        ...(session ? { Cookie: `mt_session=${session}` } : {}),
        Origin: PUBLIC,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  it('keeps each account its results, once per match, the online ones from the server', async () => {
    const aliceId = await upsertDiscordUser(pool, { id: '1', username: 'alice' });
    const alice = await createSession(pool, aliceId);
    const bob = await createSession(pool, await upsertDiscordUser(pool, { id: '2', username: 'bob' }));
    expect((await call(null, 'GET')).status).toBe(401);

    const at = Date.now() - 60_000;
    expect(await call(alice, 'POST', [result({ at })])).toMatchObject({ status: 200, json: { count: 1 } });
    // Sent again (another device, a retry): still one line.
    await call(alice, 'POST', [result({ at, result: 'loss' })]);
    // An online match, recorded by the server.
    await historyStore(pool).add(aliceId, [{ ...parseResults([result({ id: M2, at: at + 1000, bestOf: 1, wins: 1, losses: 0 })])[0], kind: 'online', opponent: 'Bob' }]);

    const list = await call(alice, 'GET');
    expect(list.json.results.map((r: { id: string; kind: string; result: string }) => [r.id, r.kind, r.result])).toEqual([[M2, 'online', 'win'], [M1, 'bot', 'win']]);
    expect(list.json.results[1]).not.toHaveProperty('replays');
    expect((await call(bob, 'GET')).json.results).toEqual([]);
  });
});
