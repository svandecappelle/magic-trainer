import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newGame } from '../src/lib/engine/engine';
import { packReplay, unpackReplay, type ReplayFile } from '../src/lib/replay';
import type { Card } from '../src/types';
import { accounts, createSession, upsertDiscordUser, type AuthConfig } from './auth';
import { testDb, testDbUrl } from './db/testDb';
import { HttpError } from './http';
import { parseReplay, REPLAY_LIMITS, replayRoutes } from './replays';

const PUBLIC = 'https://magic.example.com';
const config: AuthConfig = { publicUrl: PUBLIC, discordClientId: 'client', discordClientSecret: 'secret' };

const land = (imageSmall: string): Card => ({
  id: '11111111-1111-4111-8111-111111111111', name: 'Mountain', manaCost: '', cmc: 0, typeLine: 'Basic Land — Mountain', oracleText: '',
  colors: [], colorIdentity: [], setCode: 'lea', setName: 'Alpha', rarity: 'common', imageSmall,
});

/** A replay of a game between two decks of Mountains (its first state only). */
function replayFile(id: string, image = 'https://cards.scryfall.io/small/front/x.jpg'): ReplayFile {
  const start = newGame({ decks: [Array(20).fill(land(image)), Array(20).fill(land(image))], names: ['Alice', 'Bot'], first: 0, rng: () => 0.5, mulligans: false });
  return { id, at: 1_700_000_000_000, title: 'Mountains vs Bot', me: 0, replay: { start, steps: [] }, end: { log: start.log.length, winner: null } };
}

function invalid(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : String(e);
  }
  return undefined;
}

describe('replay API bodies', () => {
  it('accepts a replay file, keeps only Scryfall images, and refuses anything else', () => {
    const file = parseReplay({ data: packReplay(replayFile('r1', 'https://tracker.example.com/pixel.gif')) });
    expect(file.title).toBe('Mountains vs Bot');
    expect(file.replay.start.players[0].library[0].card).not.toHaveProperty('imageSmall');
    expect(parseReplay({ data: packReplay(replayFile('r1')) }).replay.start.players[0].library[0].card.imageSmall).toBe('https://cards.scryfall.io/small/front/x.jpg');
    expect(invalid(() => parseReplay({}))).toBe('400 invalid');
    expect(invalid(() => parseReplay({ data: '{"cards":[],"data":{"format":"other"}}' }))).toBe('400 notReplay');
    expect(invalid(() => parseReplay({ data: 'x'.repeat(REPLAY_LIMITS.bytes + 1) }))).toBe('413 tooLarge');
  });
});

describe.skipIf(!testDbUrl)('replay sharing API', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ pool, drop } = await testDb());
    const account = accounts({ pool, config });
    const replays = replayRoutes({ pool, account });
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!(await account.handle(req, res, url)) && !(await replays.handle(req, res, url))) res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await drop?.();
  });
  afterEach(async () => {
    await pool.query('DELETE FROM users');
  });

  const login = async (id: string, name: string) => createSession(pool, await upsertDiscordUser(pool, { id, username: name }));

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

  it('shares a replay with anyone, until its owner stops', async () => {
    const alice = await login('1', 'alice');
    const bob = await login('2', 'bob');
    const data = packReplay(replayFile('r1'));
    expect((await call(null, 'POST', '/api/replays', { data })).status).toBe(401);
    expect((await call(alice, 'POST', '/api/replays', { data }, 'https://evil.example.com')).status).toBe(403);
    expect((await call(alice, 'POST', '/api/replays', { data: 'nope' })).status).toBe(400);
    const shared = await call(alice, 'POST', '/api/replays', { data });
    expect(shared).toMatchObject({ status: 200, json: { replayId: 'r1', title: 'Mountains vs Bot', at: 1_700_000_000_000 } });
    const shareId: string = shared.json.shareId;
    expect(shareId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    // Shared again: the same link.
    expect((await call(alice, 'POST', '/api/replays', { data })).json.shareId).toBe(shareId);
    expect((await call(alice, 'GET', '/api/replays')).json.shares).toEqual([{ replayId: 'r1', shareId, title: 'Mountains vs Bot', at: 1_700_000_000_000 }]);
    expect((await call(bob, 'GET', '/api/replays')).json.shares).toEqual([]);

    // Anyone can watch it, without logging in.
    const read = await call(null, 'GET', `/api/shared-replays/${shareId}`, undefined, '');
    expect(read.status).toBe(200);
    expect(read.json.owner).toMatchObject({ name: 'alice' });
    expect(unpackReplay(read.json.data)).toMatchObject({ id: 'r1', title: 'Mountains vs Bot' });
    expect((await call(null, 'GET', '/api/shared-replays/AAAAAAAAAAAA')).status).toBe(404);

    // Only its owner stops it; then the link is gone.
    expect((await call(bob, 'DELETE', `/api/replays/${shareId}`)).status).toBe(404);
    expect((await call(alice, 'DELETE', `/api/replays/${shareId}`)).status).toBe(204);
    expect((await call(null, 'GET', `/api/shared-replays/${shareId}`)).status).toBe(404);
  });

  it('limits how many replays an account shares', async () => {
    const alice = await login('1', 'alice');
    const data = packReplay(replayFile('r0'));
    await pool.query(
      `INSERT INTO replay_shares (share_id, user_id, replay_id, title, played_at, data)
       SELECT 'share' || lpad(i::text, 6, '0'), u.id, 'x' || i, 't', now(), '\\x00' FROM users u, generate_series(1, $1) i`,
      [REPLAY_LIMITS.perUser],
    );
    expect((await call(alice, 'POST', '/api/replays', { data })).status).toBe(409);
  });
});
