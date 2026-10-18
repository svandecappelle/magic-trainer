import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';
import type pg from 'pg';
import { packReplay, ReplayFileError, unpackReplay, type ReplayFile } from '../src/lib/replay';
import type { Accounts, SessionUser } from './auth';
import { clientIp, HttpError, rateLimiter, readJson, sendJson } from './http';

/** Shared game replays (007_replay_shares.sql): sent by their owner, read by anyone with the link. */

/** The packed replay's size, and how many replays one account may share. */
export const REPLAY_LIMITS = { bytes: 3_000_000, perUser: 50 };

/** A replay share as its owner lists it. */
export interface ReplayShare {
  replayId: string;
  shareId: string;
  title: string;
  at: number;
}

/** A shared replay as anyone reads it: the replay file (packed), its owner's public name and avatar. */
export interface SharedReplay {
  data: string;
  owner: { name: string; avatarUrl: string | null };
}

const SHARE_ID = /^[A-Za-z0-9_-]{8,32}$/;
const newShareId = () => randomBytes(9).toString('base64url');
const IMAGES = 'https://cards.scryfall.io/';

/**
 * Keeps only card images from Scryfall: a replay is written by its sender, and the page showing it to others loads
 * the images it names.
 */
function cleanImages(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) cleanImages(v);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (/^image/i.test(k) && typeof v === 'string') {
      if (!v.startsWith(IMAGES)) delete o[k];
    } else cleanImages(v);
  }
}

/** Checks a POST /api/replays body ({ data: a packed replay file }); the file to keep, its images checked. */
export function parseReplay(body: unknown): ReplayFile {
  const data = (body as { data?: unknown } | null)?.data;
  if (typeof data !== 'string') throw new HttpError(400, 'invalid', { field: 'data' });
  if (data.length > REPLAY_LIMITS.bytes) throw new HttpError(413, 'tooLarge', { max: REPLAY_LIMITS.bytes });
  let file: ReplayFile;
  try {
    file = unpackReplay(data);
  } catch (e) {
    throw new HttpError(400, e instanceof ReplayFileError && e.code === 'otherVersion' ? 'otherVersion' : 'notReplay');
  }
  if (file.id.length > 100 || typeof file.title !== 'string' || !Number.isFinite(file.at)) throw new HttpError(400, 'notReplay');
  cleanImages(file);
  return { ...file, title: file.title.slice(0, 200) };
}

export interface ReplayRoutesOptions {
  pool: pg.Pool | null;
  account: Pick<Accounts, 'enabled' | 'userOf' | 'sameOrigin'>;
}

/**
 * GET /api/replays: the user's shared replays. POST /api/replays: shares a replay (its share id; the same one for a
 * replay shared again). DELETE /api/replays/:shareId: the link stops working. GET /api/shared-replays/:shareId: a
 * shared replay, for anyone.
 */
export function replayRoutes({ pool, account }: ReplayRoutesOptions) {
  const writeLimit = rateLimiter(30, 60_000);
  /** Shared replays are public: limited per address. */
  const readShared = rateLimiter(60, 60_000);

  async function share(user: SessionUser, req: IncomingMessage, res: ServerResponse) {
    const file = parseReplay(await readJson(req, 2 * REPLAY_LIMITS.bytes) /* the data is JSON text in a JSON string: its quotes are escaped */);
    const { rows: [count] } = await pool!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM replay_shares WHERE user_id = $1 AND replay_id <> $2`, [user.id, file.id],
    );
    if (count.n >= REPLAY_LIMITS.perUser) throw new HttpError(409, 'tooManyReplays', { max: REPLAY_LIMITS.perUser });
    const { rows } = await pool!.query<{ share_id: string }>(
      `INSERT INTO replay_shares (share_id, user_id, replay_id, title, played_at, data) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, replay_id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data
       RETURNING share_id`,
      [newShareId(), user.id, file.id, file.title, new Date(file.at), gzipSync(packReplay(file))],
    );
    const shared: ReplayShare = { replayId: file.id, shareId: rows[0].share_id, title: file.title, at: file.at };
    sendJson(res, 200, shared);
  }

  async function list(user: SessionUser, res: ServerResponse) {
    const { rows } = await pool!.query<{ replay_id: string; share_id: string; title: string; played_at: Date }>(
      `SELECT replay_id, share_id, title, played_at FROM replay_shares WHERE user_id = $1 ORDER BY created_at DESC`, [user.id],
    );
    const shares: ReplayShare[] = rows.map((r) => ({ replayId: r.replay_id, shareId: r.share_id, title: r.title, at: r.played_at.getTime() }));
    sendJson(res, 200, { shares });
  }

  async function unshare(user: SessionUser, shareId: string, res: ServerResponse) {
    const { rowCount } = await pool!.query(`DELETE FROM replay_shares WHERE share_id = $1 AND user_id = $2`, [shareId, user.id]);
    if (!rowCount) throw new HttpError(404, 'notFound');
    res.writeHead(204).end();
  }

  async function getShared(shareId: string, res: ServerResponse) {
    if (!SHARE_ID.test(shareId)) throw new HttpError(404, 'notFound');
    const { rows } = await pool!.query<{ data: Buffer; owner: string; avatar: string | null }>(
      `SELECT r.data, u.display_name AS owner, u.avatar_url AS avatar FROM replay_shares r JOIN users u ON u.id = r.user_id
        WHERE r.share_id = $1`,
      [shareId],
    );
    if (!rows[0]) throw new HttpError(404, 'notFound');
    const shared: SharedReplay = { data: gunzipSync(rows[0].data).toString('utf8'), owner: { name: rows[0].owner, avatarUrl: rows[0].avatar } };
    sendJson(res, 200, shared);
  }

  /** Handles /api/replays… and /api/shared-replays/…; false for any other path. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    const own = /^\/api\/replays(?:\/([^/]+))?$/.exec(path);
    const shared = /^\/api\/shared-replays\/([^/]+)$/.exec(path)?.[1];
    if (!own && shared === undefined) return false;
    try {
      if (!account.enabled || !pool) throw new HttpError(404, 'accountsDisabled');
      const method = req.method ?? 'GET';
      if (shared !== undefined) {
        if (method !== 'GET') throw new HttpError(405, 'methodNotAllowed');
        if (!readShared.hit(clientIp(req))) throw new HttpError(429, 'tooManyRequests');
        await getShared(shared, res);
        return true;
      }
      const write = method !== 'GET';
      if (write && !account.sameOrigin(req)) throw new HttpError(403, 'badOrigin');
      const user = await account.userOf(req, res);
      if (!user) throw new HttpError(401, 'notLoggedIn');
      if (write && !writeLimit.hit(user.id)) throw new HttpError(429, 'tooManyRequests');
      const shareId = own![1];
      if (shareId === undefined) {
        if (method === 'GET') await list(user, res);
        else if (method === 'POST') await share(user, req, res);
        else throw new HttpError(405, 'methodNotAllowed');
      } else if (method === 'DELETE') await unshare(user, shareId, res);
      else throw new HttpError(405, 'methodNotAllowed');
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      sendJson(res, e.status, { error: e.code, ...e.params });
    }
    return true;
  }

  return { handle };
}
