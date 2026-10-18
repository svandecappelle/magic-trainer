import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { addCookie, clientIp, cookie, parseCookies, rateLimiter, redirect, sendJson } from './http';

/** Accounts: login with Discord (OAuth2 authorization code flow) and sessions. See docs/accounts.md. */

export interface AuthConfig {
  /** Public address of the app, e.g. https://magic.example.com (redirect URI, cookie Secure flag, Origin check). */
  publicUrl: string;
  discordClientId: string;
  discordClientSecret: string;
}

export interface SessionUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** When the account was created (ms), for the profile page. */
  createdAt: number;
}

/** Discord's /users/@me (scope identify), the fields used. */
export interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

const SESSION_COOKIE = 'mt_session';
const STATE_COOKIE = 'mt_oauth';
const SESSION_DAYS = 30;
/** A session used during its last RENEW_DAYS days is extended to SESSION_DAYS again. */
const RENEW_DAYS = 15;
const DISCORD = 'https://discord.com';
const DISCORD_API = 'https://discord.com/api/v10';

/** The configuration from the environment, or null (accounts disabled) when a variable is missing. */
export function authConfig(env: NodeJS.ProcessEnv): AuthConfig | null {
  const { PUBLIC_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = env;
  if (!PUBLIC_URL || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return null;
  return { publicUrl: new URL(PUBLIC_URL).origin, discordClientId: DISCORD_CLIENT_ID, discordClientSecret: DISCORD_CLIENT_SECRET };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** A path of this site to go back to after login: "/decks?x=1" yes, "//evil.com" or "https://…" no. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 200 || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

/** Discord avatar URL; users without one get Discord's default avatar. */
export function discordAvatar(p: DiscordProfile): string {
  if (p.avatar) return `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=128`;
  const index = /^\d+$/.test(p.id) ? Number((BigInt(p.id) >> 22n) % 6n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Creates the user on their first login, refreshes their name and avatar on the next ones. Returns the user id. */
export async function upsertDiscordUser(pool: pg.Pool, p: DiscordProfile): Promise<string> {
  const name = (p.global_name || p.username).slice(0, 64) || 'Player';
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ user_id: string }>(
        `SELECT user_id FROM identities WHERE provider = 'discord' AND provider_user_id = $1 FOR UPDATE`,
        [p.id],
      );
      let userId = found.rows[0]?.user_id;
      if (userId) {
        await client.query(`UPDATE identities SET username = $2 WHERE provider = 'discord' AND provider_user_id = $1`, [p.id, p.username]);
        await client.query(`UPDATE users SET display_name = $2, avatar_url = $3, last_login_at = now() WHERE id = $1`, [userId, name, discordAvatar(p)]);
      } else {
        userId = (await client.query<{ id: string }>(`INSERT INTO users (display_name, avatar_url) VALUES ($1, $2) RETURNING id`, [name, discordAvatar(p)])).rows[0].id;
        await client.query(`INSERT INTO identities (user_id, provider, provider_user_id, username) VALUES ($1, 'discord', $2, $3)`, [userId, p.id, p.username]);
      }
      await client.query('COMMIT');
      return userId;
    } catch (e) {
      await client.query('ROLLBACK');
      // Two first logins at the same time: the other one created the user, read it again.
      if ((e as { code?: string }).code === '23505' && attempt === 0) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}

/** Opens a session: returns the token for the cookie (only its hash is stored). */
export async function createSession(pool: pg.Pool, userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [hashToken(token), userId, SESSION_DAYS, userAgent?.slice(0, 300) ?? null],
  );
  return token;
}

/** Deletes the expired sessions; returns how many. */
export async function purgeSessions(pool: pg.Pool): Promise<number> {
  return (await pool.query(`DELETE FROM sessions WHERE expires_at <= now()`)).rowCount ?? 0;
}

export interface AccountsOptions {
  pool: pg.Pool | null;
  config: AuthConfig | null;
  /** Discord requests go through this (tests replace it). */
  fetch?: typeof fetch;
}

export type Accounts = ReturnType<typeof accounts>;

/**
 * The account routes (/auth/…, /api/me) and `userOf`, the logged-in user of a request for the other API routes.
 * Without a database or the Discord configuration, accounts are disabled: /api/me says so, the rest answers 404.
 */
export function accounts({ pool, config, fetch: fetchFn = fetch }: AccountsOptions) {
  const enabled = !!(pool && config);
  const secure = !!config?.publicUrl.startsWith('https:');
  const redirectUri = config ? `${config.publicUrl}/auth/discord/callback` : '';
  const loginLimit = rateLimiter(30, 10 * 60_000);

  const clearSession = (res: ServerResponse) => addCookie(res, cookie(SESSION_COOKIE, '', { maxAge: 0, secure }));

  /** Requests that change something must come from our own pages (CSRF), on top of SameSite cookies. */
  const sameOrigin = (req: IncomingMessage) => req.headers.origin === config?.publicUrl;

  async function userOf(req: IncomingMessage, res: ServerResponse): Promise<SessionUser | null> {
    if (!pool) return null;
    const token = parseCookies(req).get(SESSION_COOKIE);
    if (!token) return null;
    const { rows } = await pool.query<{ id: string; name: string; avatar: string | null; created: Date; renew: boolean; seen: boolean }>(
      `SELECT u.id, u.display_name AS name, u.avatar_url AS avatar, u.created_at AS created,
              s.expires_at < now() + make_interval(days => $2) AS renew, s.last_seen_at < now() - interval '1 hour' AS seen
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token), RENEW_DAYS],
    );
    const row = rows[0];
    if (!row) {
      clearSession(res);
      return null;
    }
    if (row.renew) {
      await pool.query(`UPDATE sessions SET expires_at = now() + make_interval(days => $2), last_seen_at = now() WHERE token_hash = $1`, [hashToken(token), SESSION_DAYS]);
      addCookie(res, cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure }));
    } else if (row.seen) {
      await pool.query(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [hashToken(token)]);
    }
    return { id: row.id, name: row.name, avatarUrl: row.avatar, createdAt: row.created.getTime() };
  }

  /**
   * The logged-in user of a WebSocket connection (online games). Only for connections opened by our own pages:
   * browsers send cookies with WebSocket requests from any site, and SameSite doesn't cover every case.
   */
  async function socketUser(req: IncomingMessage): Promise<SessionUser | null> {
    if (!pool || !enabled || !sameOrigin(req)) return null;
    const token = parseCookies(req).get(SESSION_COOKIE);
    if (!token) return null;
    const { rows } = await pool.query<{ id: string; name: string; avatar: string | null; created: Date }>(
      `SELECT u.id, u.display_name AS name, u.avatar_url AS avatar, u.created_at AS created
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    const row = rows[0];
    return row ? { id: row.id, name: row.name, avatarUrl: row.avatar, createdAt: row.created.getTime() } : null;
  }

  /** GET /auth/discord?return=/path: off to Discord's consent page. */
  function login(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!loginLimit.hit(clientIp(req))) return sendJson(res, 429, { error: 'tooManyRequests' });
    const state = randomBytes(32).toString('base64url');
    const back = safeReturnPath(url.searchParams.get('return'));
    addCookie(res, cookie(STATE_COOKIE, `${state}|${back}`, { path: '/auth/discord', maxAge: 600, secure }));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config!.discordClientId,
      scope: 'identify',
      state,
      redirect_uri: redirectUri,
      prompt: 'none', // no consent page again once the app is authorized
    });
    redirect(res, `${DISCORD}/oauth2/authorize?${params}`);
  }

  /** GET /auth/discord/callback?code&state (or ?error when the user refused). */
  async function callback(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!loginLimit.hit(clientIp(req))) return sendJson(res, 429, { error: 'tooManyRequests' });
    const saved = parseCookies(req).get(STATE_COOKIE) ?? '';
    addCookie(res, cookie(STATE_COOKIE, '', { path: '/auth/discord', maxAge: 0, secure }));
    const sep = saved.indexOf('|');
    const state = sep > 0 ? saved.slice(0, sep) : '';
    const back = safeReturnPath(sep > 0 ? saved.slice(sep + 1) : '/');
    const done = (result: 'ok' | 'cancelled' | 'failed') => {
      const target = new URL(back, 'http://x');
      if (result !== 'ok') target.searchParams.set('login', result);
      redirect(res, target.pathname + target.search);
    };

    if (url.searchParams.get('error')) return done('cancelled');
    const code = url.searchParams.get('code');
    const given = url.searchParams.get('state') ?? '';
    // Compare hashes so the lengths match for timingSafeEqual.
    if (!code || !state || !timingSafeEqual(hashToken(state), hashToken(given))) return done('failed');

    let profile: DiscordProfile;
    try {
      const tokenRes = await fetchFn(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config!.discordClientId,
          client_secret: config!.discordClientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) throw new Error(`token: HTTP ${tokenRes.status}`);
      const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
      if (!accessToken) throw new Error('token: no access_token');
      const meRes = await fetchFn(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!meRes.ok) throw new Error(`users/@me: HTTP ${meRes.status}`);
      profile = (await meRes.json()) as DiscordProfile;
      if (typeof profile.id !== 'string' || typeof profile.username !== 'string') throw new Error('users/@me: unexpected answer');
      // The access token was only needed for the identity: revoke it rather than leave it valid.
      void fetchFn(`${DISCORD_API}/oauth2/token/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: accessToken, client_id: config!.discordClientId, client_secret: config!.discordClientSecret }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    } catch (e) {
      console.warn('Discord login failed:', (e as Error).message);
      return done('failed');
    }

    const userId = await upsertDiscordUser(pool!, profile);
    const token = await createSession(pool!, userId, req.headers['user-agent']);
    addCookie(res, cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure }));
    done('ok');
  }

  /** POST /auth/logout: ends this session (the user's other devices stay logged in). */
  async function logout(req: IncomingMessage, res: ServerResponse) {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'badOrigin' });
    const token = parseCookies(req).get(SESSION_COOKIE);
    if (token) await pool!.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
    clearSession(res);
    res.writeHead(204).end();
  }

  /** DELETE /api/me: deletes the account; cascades to identities, sessions, decks and collection. */
  async function deleteAccount(req: IncomingMessage, res: ServerResponse) {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'badOrigin' });
    const user = await userOf(req, res);
    if (!user) return sendJson(res, 401, { error: 'notLoggedIn' });
    await pool!.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    clearSession(res);
    res.writeHead(204).end();
  }

  /** Handles the account routes; false for any other path. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (path === '/api/me') {
      if (method === 'GET') {
        sendJson(res, 200, { enabled, user: enabled ? await userOf(req, res) : null });
      } else if (method === 'DELETE' && enabled) {
        await deleteAccount(req, res);
      } else {
        sendJson(res, 405, { error: 'methodNotAllowed' });
      }
      return true;
    }
    if (!path.startsWith('/auth/')) return false;
    if (!enabled) sendJson(res, 404, { error: 'accountsDisabled' });
    else if (path === '/auth/discord' && method === 'GET') login(req, res, url);
    else if (path === '/auth/discord/callback' && method === 'GET') await callback(req, res, url);
    else if (path === '/auth/logout' && method === 'POST') await logout(req, res);
    else sendJson(res, 404, { error: 'notFound' });
    return true;
  }

  return { enabled, handle, userOf, socketUser, sameOrigin };
}
