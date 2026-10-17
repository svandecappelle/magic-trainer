import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { accounts, discordAvatar, purgeSessions, safeReturnPath, type AuthConfig, type DiscordProfile } from './auth';
import { testDb, testDbUrl } from './db/testDb';
import { cookie, parseCookies, rateLimiter } from './http';

const PUBLIC = 'https://magic.example.com';
const config: AuthConfig = { publicUrl: PUBLIC, discordClientId: 'client', discordClientSecret: 'secret' };

/** Runs the account routes on a local port; `call` sends a request with the given cookies, without following redirects. */
async function serve(options: Parameters<typeof accounts>[0]) {
  const account = accounts(options);
  const server: Server = createServer(async (req, res) => {
    if (!(await account.handle(req, res, new URL(req.url ?? '/', 'http://x')))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit & { cookies?: Record<string, string> } = {}) =>
    fetch(base + path, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.headers as Record<string, string>),
        Cookie: Object.entries(init.cookies ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '),
      },
    });
  return { call, close: () => new Promise((r) => server.close(r)) };
}

/** The cookies a response sets, by name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((c) => [c.slice(0, c.indexOf('=')), c]));
}
const valueOf = (setCookie: string | undefined) => decodeURIComponent(setCookie?.split(';')[0].split('=')[1] ?? '');

describe('account helpers', () => {
  it('only goes back to a path of this site after login', () => {
    expect(safeReturnPath('/decks?id=1')).toBe('/decks?id=1');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '', null, `/${'x'.repeat(300)}`]) expect(safeReturnPath(bad)).toBe('/');
  });

  it('builds Discord avatar URLs, with the default avatar for users without one', () => {
    expect(discordAvatar({ id: '80351110224678912', username: 'a', avatar: 'abc' })).toBe('https://cdn.discordapp.com/avatars/80351110224678912/abc.png?size=128');
    expect(discordAvatar({ id: '80351110224678912', username: 'a', avatar: null })).toMatch(/embed\/avatars\/[0-5]\.png$/);
  });

  it('reads and writes cookies', () => {
    expect(cookie('a', 'x y', { secure: true, maxAge: 10 })).toBe('a=x%20y; Path=/; HttpOnly; SameSite=Lax; Max-Age=10; Secure');
    const cookies = parseCookies({ headers: { cookie: 'a=x%20y; b=2; a=3; bad=%E0' } } as never);
    expect([...cookies]).toEqual([['a', 'x y'], ['b', '2']]);
  });

  it('limits requests per key in a window', () => {
    let t = 0;
    const limit = rateLimiter(2, 1000, () => t);
    expect([limit.hit('ip'), limit.hit('ip'), limit.hit('ip'), limit.hit('other')]).toEqual([true, true, false, true]);
    t = 1001;
    expect(limit.hit('ip')).toBe(true);
  });

  it('says accounts are disabled without a database or Discord configuration', async () => {
    const { call, close } = await serve({ pool: null, config });
    try {
      expect(await (await call('/api/me')).json()).toEqual({ enabled: false, user: null });
      expect((await call('/auth/discord')).status).toBe(404);
      expect((await call('/elsewhere')).status).toBe(404);
    } finally {
      await close();
    }
  });
});

describe.skipIf(!testDbUrl)('login with Discord', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let profile: DiscordProfile;
  let discordDown = false;
  const discordCalls: string[] = [];

  /** Discord's token, identity and revoke endpoints; the code "good" is the only valid one. */
  const fakeDiscord: typeof fetch = async (input, init) => {
    const url = String(input);
    discordCalls.push(url);
    if (discordDown) throw new Error('offline');
    if (url.endsWith('/oauth2/token')) {
      const body = new URLSearchParams(String(init?.body));
      const ok = body.get('code') === 'good' && body.get('client_secret') === 'secret' && body.get('redirect_uri') === `${PUBLIC}/auth/discord/callback`;
      return ok ? Response.json({ access_token: 'access', token_type: 'Bearer' }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (url.endsWith('/users/@me')) {
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access' ? Response.json(profile) : new Response(null, { status: 401 });
    }
    return new Response(null, { status: 200 });
  };

  beforeAll(async () => {
    ({ pool, drop } = await testDb());
  });
  afterAll(() => drop?.());
  afterEach(async () => {
    discordDown = false;
    discordCalls.length = 0;
    await pool.query('DELETE FROM users');
  });

  /** Goes through the whole login: returns the session token, or the callback response when there is none. */
  async function login(call: Awaited<ReturnType<typeof serve>>['call'], code = 'good') {
    const start = await call('/auth/discord?return=/decks');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const back = await call(`/auth/discord/callback?code=${code}&state=${state}`, { cookies: { mt_oauth: valueOf(setCookies(start).get('mt_oauth')) } });
    return { back, session: valueOf(setCookies(back).get('mt_session')) };
  }

  it('creates the account on the first login, and logs in again to the same account', async () => {
    profile = { id: '80351110224678912', username: 'aang', global_name: 'Aang', avatar: 'abc' };
    const { call, close } = await serve({ pool, config, fetch: fakeDiscord });
    try {
      const start = await call('/auth/discord?return=/decks');
      expect(start.status).toBe(302);
      const to = new URL(start.headers.get('location')!);
      expect(to.origin + to.pathname).toBe('https://discord.com/oauth2/authorize');
      expect(Object.fromEntries(to.searchParams)).toMatchObject({ client_id: 'client', scope: 'identify', response_type: 'code', redirect_uri: `${PUBLIC}/auth/discord/callback` });
      expect(setCookies(start).get('mt_oauth')).toMatch(/Path=\/auth\/discord; HttpOnly; SameSite=Lax; Max-Age=600; Secure/);

      const { back, session } = await login(call);
      expect(back.headers.get('location')).toBe('/decks');
      expect(setCookies(back).get('mt_session')).toMatch(/HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
      // The Discord token is revoked once the identity is known.
      expect(discordCalls.some((u) => u.endsWith('/oauth2/token/revoke'))).toBe(true);
      const me = await (await call('/api/me', { cookies: { mt_session: session } })).json();
      expect(me).toMatchObject({ enabled: true, user: { name: 'Aang', avatarUrl: 'https://cdn.discordapp.com/avatars/80351110224678912/abc.png?size=128' } });
      // Only the hash of the token is stored.
      const stored = await pool.query(`SELECT encode(token_hash, 'hex') AS h FROM sessions`);
      expect(stored.rows[0].h).not.toContain(Buffer.from(session).toString('hex'));

      profile = { ...profile, global_name: 'Avatar Aang' };
      const again = await login(call);
      const me2 = await (await call('/api/me', { cookies: { mt_session: again.session } })).json();
      expect(me2.user).toEqual({ ...me.user, name: 'Avatar Aang' });
      expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(1);
    } finally {
      await close();
    }
  });

  it('refuses a callback whose state does not match, and reports a refusal or a Discord failure', async () => {
    profile = { id: '1', username: 'zuko' };
    const { call, close } = await serve({ pool, config, fetch: fakeDiscord });
    try {
      const start = await call('/auth/discord?return=/decks');
      const saved = valueOf(setCookies(start).get('mt_oauth'));
      const forged = await call('/auth/discord/callback?code=good&state=forged', { cookies: { mt_oauth: saved } });
      expect(forged.headers.get('location')).toBe('/decks?login=failed');
      expect(setCookies(forged).has('mt_session')).toBe(false);
      const noCookie = await call('/auth/discord/callback?code=good&state=x');
      expect(noCookie.headers.get('location')).toBe('/?login=failed');
      expect(discordCalls).toEqual([]);

      const refused = await call('/auth/discord/callback?error=access_denied', { cookies: { mt_oauth: saved } });
      expect(refused.headers.get('location')).toBe('/decks?login=cancelled');

      expect((await login(call, 'bad')).back.headers.get('location')).toBe('/decks?login=failed');
      discordDown = true;
      const warn = console.warn;
      console.warn = () => {};
      try {
        expect((await login(call)).back.headers.get('location')).toBe('/decks?login=failed');
      } finally {
        console.warn = warn;
      }
      expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(0);
    } finally {
      await close();
    }
  });

  it('ends a session on logout, ignores expired ones and extends those used near their end', async () => {
    profile = { id: '2', username: 'katara' };
    const { call, close } = await serve({ pool, config, fetch: fakeDiscord });
    try {
      const { session } = await login(call);
      const other = (await login(call)).session; // another device
      expect((await call('/auth/logout', { method: 'POST', cookies: { mt_session: session } })).status).toBe(403);
      const out = await call('/auth/logout', { method: 'POST', headers: { Origin: PUBLIC }, cookies: { mt_session: session } });
      expect(out.status).toBe(204);
      expect(setCookies(out).get('mt_session')).toMatch(/Max-Age=0/);
      expect((await (await call('/api/me', { cookies: { mt_session: session } })).json()).user).toBeNull();
      expect((await (await call('/api/me', { cookies: { mt_session: other } })).json()).user).toMatchObject({ name: 'katara' });

      await pool.query(`UPDATE sessions SET expires_at = now() + interval '10 days'`);
      const renewed = await call('/api/me', { cookies: { mt_session: other } });
      expect(setCookies(renewed).get('mt_session')).toMatch(/Max-Age=2592000/);
      const left = await pool.query(`SELECT expires_at > now() + interval '29 days' AS ok FROM sessions`);
      expect(left.rows[0].ok).toBe(true);

      await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
      const expired = await call('/api/me', { cookies: { mt_session: other } });
      expect((await expired.json()).user).toBeNull();
      expect(setCookies(expired).get('mt_session')).toMatch(/Max-Age=0/);
      expect(await purgeSessions(pool)).toBe(1);
    } finally {
      await close();
    }
  });

  it('knows the user of a WebSocket connection opened by our own pages only', async () => {
    profile = { id: '5', username: 'toph' };
    const { call, close } = await serve({ pool, config, fetch: fakeDiscord });
    try {
      const { session } = await login(call);
      const { socketUser } = accounts({ pool, config });
      const req = (origin: string | undefined, token = session) =>
        ({ headers: { ...(origin ? { origin } : {}), cookie: `mt_session=${token}` } }) as unknown as import('node:http').IncomingMessage;
      expect(await socketUser(req(PUBLIC))).toMatchObject({ name: 'toph' });
      // Another site opening a WebSocket with the user's cookie: no account.
      expect(await socketUser(req('https://evil.example'))).toBeNull();
      expect(await socketUser(req(undefined))).toBeNull();
      expect(await socketUser(req(PUBLIC, 'wrong'))).toBeNull();
    } finally {
      await close();
    }
  });

  it('deletes the account and everything it owns', async () => {
    profile = { id: '3', username: 'sokka' };
    const { call, close } = await serve({ pool, config, fetch: fakeDiscord });
    try {
      const { session } = await login(call);
      const { rows: [user] } = await pool.query('SELECT id FROM users');
      await pool.query(`INSERT INTO decks (id, user_id, name, format, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'Boomerang', 'casual', now(), now())`, [user.id]);
      expect((await call('/api/me', { method: 'DELETE', cookies: { mt_session: session } })).status).toBe(403);
      expect((await call('/api/me', { method: 'DELETE', headers: { Origin: PUBLIC } })).status).toBe(401);
      expect((await call('/api/me', { method: 'DELETE', headers: { Origin: PUBLIC }, cookies: { mt_session: session } })).status).toBe(204);
      const left = await pool.query(`SELECT (SELECT count(*) FROM users)::int + (SELECT count(*) FROM identities)::int + (SELECT count(*) FROM sessions)::int + (SELECT count(*) FROM decks)::int AS n`);
      expect(left.rows[0].n).toBe(0);
    } finally {
      await close();
    }
  });

  it('limits login attempts per address', async () => {
    const { call, close } = await serve({ pool, config, fetch: fakeDiscord });
    try {
      const statuses = [];
      for (let i = 0; i < 31; i++) statuses.push((await call('/auth/discord', { headers: { 'X-Real-IP': '203.0.113.9' } })).status);
      expect(statuses.slice(0, 30).every((s) => s === 302)).toBe(true);
      expect(statuses[30]).toBe(429);
      expect((await call('/auth/discord', { headers: { 'X-Real-IP': '203.0.113.10' } })).status).toBe(302);
    } finally {
      await close();
    }
  });
});
