import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminRoutes } from './admin';
import { accounts, authConfig, createSession, upsertDiscordUser, type AuthConfig } from './auth';
import { testDb, testDbUrl } from './db/testDb';
import type { AdminRoom } from './rooms';

const PUBLIC = 'https://magic.example.com';
const ADMIN_ID = '100000000000000001';
const config: AuthConfig = { publicUrl: PUBLIC, discordClientId: 'client', discordClientSecret: 'secret', adminDiscordIds: [ADMIN_ID] };

describe('admin settings', () => {
  it('reads ADMIN_DISCORD_IDS (Discord ids only)', () => {
    const env = { PUBLIC_URL: PUBLIC, DISCORD_CLIENT_ID: 'c', DISCORD_CLIENT_SECRET: 's' };
    expect(authConfig({ ...env, ADMIN_DISCORD_IDS: '123456789012345678, 223456789012345678 nope' })?.adminDiscordIds).toEqual(['123456789012345678', '223456789012345678']);
    expect(authConfig(env)?.adminDiscordIds).toEqual([]);
  });
});

describe.skipIf(!testDbUrl)('administration API', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: Server;
  let base: string;
  const live: AdminRoom[] = [];
  const closed: string[] = [];

  beforeAll(async () => {
    ({ pool, drop } = await testDb());
    const account = accounts({ pool, config });
    const admin = adminRoutes({
      pool, account, adminIds: [ADMIN_ID],
      rooms: {
        adminRooms: () => live,
        adminClose: (code) => (live.some((r) => r.code === code) ? (closed.push(code), true) : false),
      },
      system: { version: 'abc1234', startedAt: 1, accounts: true, admins: 1, cardCheck: 'lenient', turnSeconds: 120, reconnectSeconds: 180 },
    });
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!(await account.handle(req, res, url)) && !(await admin.handle(req, res, url))) res.writeHead(404).end();
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
    live.length = 0;
    closed.length = 0;
  });

  const login = async (id: string, name: string) => createSession(pool, await upsertDiscordUser(pool, { id, username: name }));

  async function call(session: string | null, method: string, path: string, origin = PUBLIC) {
    const res = await fetch(base + path, { method, headers: { ...(session ? { Cookie: `mt_session=${session}` } : {}), ...(origin ? { Origin: origin } : {}) } });
    return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  }

  it('is only for administrators', async () => {
    const admin = await login(ADMIN_ID, 'boss');
    const bob = await login('200', 'bob');
    expect((await call(null, 'GET', '/api/admin/overview')).status).toBe(401);
    expect((await call(bob, 'GET', '/api/admin/overview')).status).toBe(403);
    expect((await call(admin, 'GET', '/api/admin/overview')).status).toBe(200);
    // /api/me tells the page.
    expect((await call(admin, 'GET', '/api/me')).json.user).toMatchObject({ name: 'boss', admin: true });
    expect((await call(bob, 'GET', '/api/me')).json.user.admin).toBeUndefined();
    // Changes only from our own pages.
    expect((await call(admin, 'POST', '/api/admin/maintenance/sessions', 'https://evil.example.com')).status).toBe(403);
  });

  it('counts users, sessions, matches and shared content', async () => {
    const admin = await login(ADMIN_ID, 'boss');
    const bob = await login('200', 'bob');
    const bobId = (await pool.query(`SELECT id FROM users WHERE display_name = 'bob'`)).rows[0].id;
    await pool.query(
      `INSERT INTO match_results (user_id, id, played_at, kind, two_headed, commander, best_of, deck, opponent, result, wins, losses)
       VALUES ($1, gen_random_uuid(), now(), 'bot', false, false, 1, 'Burn', 'Bot', 'win', 1, 0),
              ($1, gen_random_uuid(), now() - interval '2 days', 'online', false, false, 1, 'Burn', 'Ann', 'loss', 0, 1)`,
      [bobId],
    );
    live.push({ id: 'r1', code: 'K7QX', players: [{ name: 'bob', connected: true }, { name: 'ann', connected: false }], size: 2, mode: 'free', bestOf: 1, score: [0, 0], turn: 3, clock: null, watchers: 0, createdAt: 5 });
    const { json } = await call(admin, 'GET', '/api/admin/overview');
    expect(json).toMatchObject({ users: 2, newThisWeek: 2, sessions: 2, online: { rooms: 1, players: 1 }, matches7d: 2, botShare: 50 });
    expect(json.perDay).toHaveLength(14);
    expect(json.recentSignups.map((u: { name: string }) => u.name).sort()).toEqual(['bob', 'boss']);
    expect(bob).toBeTruthy();
  });

  it('lists users; signs one out, stops their shares, deletes them — never another administrator', async () => {
    const admin = await login(ADMIN_ID, 'boss');
    const bob = await login('200', 'bob');
    const bobId = (await pool.query(`SELECT id FROM users WHERE display_name = 'bob'`)).rows[0].id;
    const adminId = (await pool.query(`SELECT id FROM users WHERE display_name = 'boss'`)).rows[0].id;
    await pool.query(`INSERT INTO replay_shares (share_id, user_id, replay_id, title, played_at, data) VALUES ('abcdefghijkl', $1, 'r1', 'Burn vs Bot', now(), '\\x00')`, [bobId]);

    const list = (await call(admin, 'GET', '/api/admin/users?q=bo')).json;
    expect(list.total).toBe(2);
    expect(list.users.find((u: { name: string }) => u.name === 'bob')).toMatchObject({ discord: 'bob', sessions: 1, shares: 1, admin: false });
    expect(list.users.find((u: { name: string }) => u.name === 'boss')).toMatchObject({ admin: true });
    expect((await call(admin, 'GET', '/api/admin/users?q=nobody')).json.users).toEqual([]);

    expect((await call(admin, 'POST', `/api/admin/users/${bobId}/unshare`)).json).toEqual({ count: 1 });
    expect((await call(admin, 'POST', `/api/admin/users/${bobId}/signout`)).json).toEqual({ count: 1 });
    expect((await call(bob, 'GET', '/api/me')).json.user).toBeNull();
    expect((await call(admin, 'DELETE', `/api/admin/users/${adminId}`)).status).toBe(403);
    expect((await call(admin, 'DELETE', `/api/admin/users/${bobId}`)).status).toBe(204);
    expect((await pool.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(1);
    expect((await call(admin, 'DELETE', `/api/admin/users/${bobId}`)).status).toBe(404);
  });

  it('lists and closes live rooms; lists and stops shares; system and maintenance', async () => {
    const admin = await login(ADMIN_ID, 'boss');
    const adminId = (await pool.query(`SELECT id FROM users WHERE display_name = 'boss'`)).rows[0].id;
    live.push({ id: 'r1', code: 'K7QX', players: [], size: 2, mode: 'free', bestOf: 3, score: [1, 0], turn: null, clock: null, watchers: 2, createdAt: 5 });
    expect((await call(admin, 'GET', '/api/admin/rooms')).json.rooms).toHaveLength(1);
    expect((await call(admin, 'DELETE', '/api/admin/rooms/K7QX')).status).toBe(204);
    expect(closed).toEqual(['K7QX']);
    expect((await call(admin, 'DELETE', '/api/admin/rooms/NOPE')).status).toBe(404);

    await pool.query(`INSERT INTO replay_shares (share_id, user_id, replay_id, title, played_at, data) VALUES ('abcdefghijkl', $1, 'r1', 'Burn vs Bot', now(), '\\x00')`, [adminId]);
    expect((await call(admin, 'GET', '/api/admin/shares?kind=replays')).json.shares).toMatchObject([{ kind: 'replay', shareId: 'abcdefghijkl', title: 'Burn vs Bot', owner: 'boss' }]);
    expect((await call(admin, 'GET', '/api/admin/shares')).json.shares).toEqual([]);
    expect((await call(admin, 'DELETE', '/api/admin/shares/replay/abcdefghijkl')).status).toBe(204);
    expect((await call(admin, 'DELETE', '/api/admin/shares/replay/abcdefghijkl')).status).toBe(404);

    const system = (await call(admin, 'GET', '/api/admin/system')).json;
    expect(system).toMatchObject({ version: 'abc1234', accounts: true, admins: 1 });
    expect(system.migrations).toContain('007_replay_shares.sql');
    expect((await call(admin, 'POST', '/api/admin/maintenance/sessions')).json).toEqual({ count: 0 });
    expect((await call(admin, 'POST', '/api/admin/maintenance/nope')).status).toBe(404);
  });
});
