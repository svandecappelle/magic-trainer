import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import type { Accounts, SessionUser } from './auth';
import { purgeSessions } from './auth';
import { purgeDeletedDecks } from './decks';
import { isUuid } from './db/cards';
import { HttpError, rateLimiter, sendJson } from './http';
import type { AdminRoom } from './rooms';

/**
 * The administration page's API (/api/admin/…): only for administrators (ADMIN_DISCORD_IDS, see docs/accounts.md).
 * Overview figures, users (sign out, stop their shares, delete), live online rooms, shared decks and replays, and the
 * server's settings and maintenance.
 */

export interface AdminOverview {
  users: number;
  newThisWeek: number;
  /** Users seen (a session used) today and in the last 7 days. */
  activeToday: number;
  active7d: number;
  sessions: number;
  online: { players: number; rooms: number };
  matches7d: number;
  /** Share of the last 7 days' matches played against the bot (0–100). */
  botShare: number | null;
  /** Matches per day, the last 14 days (oldest first). */
  perDay: { day: string; bot: number; online: number }[];
  storage: { decks: number; sharedDecks: number; sharedReplays: number; cards: number };
  recentSignups: { name: string; avatarUrl: string | null; createdAt: number }[];
}

export interface AdminUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  discord: string | null;
  createdAt: number;
  lastSeen: number | null;
  decks: number;
  matches: number;
  sessions: number;
  shares: number;
  admin: boolean;
}

export interface AdminShare {
  kind: 'deck' | 'replay';
  shareId: string;
  title: string;
  owner: string;
  /** When it was shared (replays) or last changed (decks). */
  at: number;
}

export interface AdminSystem {
  version: string;
  startedAt: number;
  migrations: string[];
  accounts: boolean;
  admins: number;
  cardCheck: string;
  turnSeconds: number;
  reconnectSeconds: number;
}

/** The online rooms, for the Live games tab (the RoomManager). */
export interface AdminRooms {
  adminRooms(): AdminRoom[];
  adminClose(code: string): boolean;
}

export interface AdminRoutesOptions {
  pool: pg.Pool | null;
  account: Pick<Accounts, 'enabled' | 'userOf' | 'sameOrigin'>;
  rooms: AdminRooms;
  system: Omit<AdminSystem, 'migrations'>;
  /** ADMIN_DISCORD_IDS (the users list marks them; they can't be signed out, unshared or deleted from here). */
  adminIds: string[];
}

const LIMIT = 200;
const SHARE_ID = /^[A-Za-z0-9_-]{8,32}$/;

export function adminRoutes({ pool, account, rooms, system, adminIds }: AdminRoutesOptions) {
  const writeLimit = rateLimiter(60, 60_000);

  async function overview(res: ServerResponse) {
    const db = pool!;
    const one = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0].n);
    const [users, newThisWeek, activeToday, active7d, sessions, decks, sharedDecks, sharedReplays, cards] = await Promise.all([
      one(`SELECT count(*) AS n FROM users`),
      one(`SELECT count(*) AS n FROM users WHERE created_at > now() - interval '7 days'`),
      one(`SELECT count(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at > date_trunc('day', now())`),
      one(`SELECT count(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at > now() - interval '7 days'`),
      one(`SELECT count(*) AS n FROM sessions WHERE expires_at > now()`),
      one(`SELECT count(*) AS n FROM decks WHERE deleted_at IS NULL`),
      one(`SELECT count(*) AS n FROM decks WHERE deleted_at IS NULL AND share_id IS NOT NULL`),
      one(`SELECT count(*) AS n FROM replay_shares`),
      one(`SELECT count(*) AS n FROM cards`),
    ]);
    // An online match is recorded once per player: counted once (by its id).
    const { rows: days } = await db.query<{ day: string; bot: string; online: string }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              count(DISTINCT m.id) FILTER (WHERE m.kind = 'bot') AS bot,
              count(DISTINCT m.id) FILTER (WHERE m.kind = 'online') AS online
         FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS d(day)
         LEFT JOIN match_results m ON m.played_at >= d.day AND m.played_at < d.day + interval '1 day'
        GROUP BY d.day ORDER BY d.day`,
    );
    const perDay = days.map((r) => ({ day: r.day, bot: Number(r.bot), online: Number(r.online) }));
    const week = perDay.slice(-7);
    const matches7d = week.reduce((n, d) => n + d.bot + d.online, 0);
    const bot7d = week.reduce((n, d) => n + d.bot, 0);
    const { rows: recent } = await db.query<{ name: string; avatar: string | null; created: Date }>(
      `SELECT display_name AS name, avatar_url AS avatar, created_at AS created FROM users ORDER BY created_at DESC LIMIT 5`,
    );
    const live = rooms.adminRooms();
    const result: AdminOverview = {
      users, newThisWeek, activeToday, active7d, sessions,
      online: { rooms: live.length, players: live.reduce((n, r) => n + r.players.filter((p) => p.connected).length, 0) },
      matches7d, botShare: matches7d ? Math.round((100 * bot7d) / matches7d) : null, perDay,
      storage: { decks, sharedDecks, sharedReplays, cards },
      recentSignups: recent.map((r) => ({ name: r.name, avatarUrl: r.avatar, createdAt: r.created.getTime() })),
    };
    sendJson(res, 200, result);
  }

  async function listUsers(url: URL, res: ServerResponse) {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
    const sort = url.searchParams.get('sort') === 'joined' ? 'u.created_at DESC' : 'last_seen DESC NULLS LAST';
    const { rows } = await pool!.query<{
      id: string; name: string; avatar: string | null; discord: string | null; created: Date; last_seen: Date | null;
      decks: string; matches: string; sessions: string; shares: string; admin: boolean;
    }>(
      `SELECT u.id, u.display_name AS name, u.avatar_url AS avatar, u.created_at AS created,
              (SELECT i.username FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' LIMIT 1) AS discord,
              (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
              (SELECT count(*) FROM decks d WHERE d.user_id = u.id AND d.deleted_at IS NULL) AS decks,
              (SELECT count(*) FROM match_results m WHERE m.user_id = u.id) AS matches,
              (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions,
              (SELECT count(*) FROM decks d WHERE d.user_id = u.id AND d.share_id IS NOT NULL AND d.deleted_at IS NULL)
                + (SELECT count(*) FROM replay_shares r WHERE r.user_id = u.id) AS shares,
              EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' AND i.provider_user_id = ANY($3::text[])) AS admin
         FROM users u
        WHERE $1 = '' OR u.display_name ILIKE '%' || $1 || '%'
           OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.username ILIKE '%' || $1 || '%')
        ORDER BY ${sort} LIMIT $2`,
      [q.replace(/[%_\\]/g, (c) => `\\${c}`), LIMIT, admins()],
    );
    const users: AdminUser[] = rows.map((r) => ({
      id: r.id, name: r.name, avatarUrl: r.avatar, discord: r.discord, createdAt: r.created.getTime(), lastSeen: r.last_seen?.getTime() ?? null,
      decks: Number(r.decks), matches: Number(r.matches), sessions: Number(r.sessions), shares: Number(r.shares), admin: r.admin,
    }));
    sendJson(res, 200, { users, total: Number((await pool!.query<{ n: string }>(`SELECT count(*) AS n FROM users`)).rows[0].n) });
  }

  /** Sign out everywhere, stop all shares, or delete: never on another administrator. */
  async function userAction(me: SessionUser, id: string, action: 'signout' | 'unshare' | 'delete', res: ServerResponse) {
    const db = pool!;
    const { rows } = await db.query<{ admin: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = 'discord' AND i.provider_user_id = ANY($2::text[])) AS admin
         FROM users u WHERE u.id = $1`,
      [id, admins()],
    );
    if (!rows[0]) throw new HttpError(404, 'notFound');
    if (rows[0].admin && id !== me.id) throw new HttpError(403, 'adminUser');
    if (action === 'delete' && id === me.id) throw new HttpError(403, 'adminUser');
    if (action === 'signout') {
      const { rowCount } = await db.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
      sendJson(res, 200, { count: rowCount ?? 0 });
    } else if (action === 'unshare') {
      const decks = await db.query(`UPDATE decks SET share_id = NULL WHERE user_id = $1 AND share_id IS NOT NULL`, [id]);
      const replays = await db.query(`DELETE FROM replay_shares WHERE user_id = $1`, [id]);
      sendJson(res, 200, { count: (decks.rowCount ?? 0) + (replays.rowCount ?? 0) });
    } else {
      // Everything of the account goes with it (ON DELETE CASCADE), like "Delete my account".
      await db.query(`DELETE FROM users WHERE id = $1`, [id]);
      res.writeHead(204).end();
    }
  }

  async function listShares(url: URL, res: ServerResponse) {
    const kind = url.searchParams.get('kind') === 'replays' ? 'replay' : 'deck';
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`);
    const { rows } = kind === 'deck'
      ? await pool!.query<{ share_id: string; title: string; owner: string; at: Date }>(
        `SELECT d.share_id, d.name AS title, u.display_name AS owner, d.updated_at AS at FROM decks d JOIN users u ON u.id = d.user_id
          WHERE d.share_id IS NOT NULL AND d.deleted_at IS NULL AND ($1 = '' OR d.name ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
          ORDER BY d.updated_at DESC LIMIT $2`, [q, LIMIT])
      : await pool!.query<{ share_id: string; title: string; owner: string; at: Date }>(
        `SELECT r.share_id, r.title, u.display_name AS owner, r.created_at AS at FROM replay_shares r JOIN users u ON u.id = r.user_id
          WHERE $1 = '' OR r.title ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%'
          ORDER BY r.created_at DESC LIMIT $2`, [q, LIMIT]);
    const shares: AdminShare[] = rows.map((r) => ({ kind, shareId: r.share_id, title: r.title, owner: r.owner, at: r.at.getTime() }));
    sendJson(res, 200, { shares });
  }

  async function stopShare(kind: string, shareId: string, res: ServerResponse) {
    if (!SHARE_ID.test(shareId)) throw new HttpError(404, 'notFound');
    const { rowCount } = kind === 'deck'
      ? await pool!.query(`UPDATE decks SET share_id = NULL WHERE share_id = $1`, [shareId])
      : await pool!.query(`DELETE FROM replay_shares WHERE share_id = $1`, [shareId]);
    if (!rowCount) throw new HttpError(404, 'notFound');
    res.writeHead(204).end();
  }

  async function systemInfo(res: ServerResponse) {
    const { rows } = await pool!.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name`);
    const info: AdminSystem = { ...system, migrations: rows.map((r) => r.name) };
    sendJson(res, 200, info);
  }

  async function maintenance(task: string, res: ServerResponse) {
    if (task === 'sessions') sendJson(res, 200, { count: await purgeSessions(pool!) });
    else if (task === 'tombstones') sendJson(res, 200, { count: await purgeDeletedDecks(pool!) });
    else throw new HttpError(404, 'notFound');
  }

  const admins = () => adminIds;

  /** Handles /api/admin/…; false for any other path. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith('/api/admin/')) return false;
    try {
      if (!account.enabled || !pool) throw new HttpError(404, 'accountsDisabled');
      const method = req.method ?? 'GET';
      const write = method !== 'GET';
      if (write && !account.sameOrigin(req)) throw new HttpError(403, 'badOrigin');
      const user = await account.userOf(req, res);
      if (!user) throw new HttpError(401, 'notLoggedIn');
      if (!user.admin) throw new HttpError(403, 'notAdmin');
      if (write && !writeLimit.hit(user.id)) throw new HttpError(429, 'tooManyRequests');
      const parts = path.slice('/api/admin/'.length).split('/');
      const [section, id, action] = parts;
      if (section === 'overview' && method === 'GET' && parts.length === 1) await overview(res);
      else if (section === 'users' && method === 'GET' && parts.length === 1) await listUsers(url, res);
      else if (section === 'users' && id && isUuid(id) && parts.length === 3 && method === 'POST' && (action === 'signout' || action === 'unshare')) await userAction(user, id.toLowerCase(), action, res);
      else if (section === 'users' && id && isUuid(id) && parts.length === 2 && method === 'DELETE') await userAction(user, id.toLowerCase(), 'delete', res);
      else if (section === 'rooms' && method === 'GET' && parts.length === 1) sendJson(res, 200, { rooms: rooms.adminRooms() });
      else if (section === 'rooms' && id && parts.length === 2 && method === 'DELETE') {
        if (!rooms.adminClose(id)) throw new HttpError(404, 'notFound');
        res.writeHead(204).end();
      } else if (section === 'shares' && method === 'GET' && parts.length === 1) await listShares(url, res);
      else if (section === 'shares' && (id === 'deck' || id === 'replay') && action && parts.length === 3 && method === 'DELETE') await stopShare(id, action, res);
      else if (section === 'system' && method === 'GET' && parts.length === 1) await systemInfo(res);
      else if (section === 'maintenance' && id && parts.length === 2 && method === 'POST') await maintenance(id, res);
      else throw new HttpError(404, 'notFound');
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      sendJson(res, e.status, { error: e.code, ...e.params });
    }
    return true;
  }

  return { handle };
}
