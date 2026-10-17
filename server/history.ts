import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { RESULTS, type MatchResult } from '../src/lib/history';
import type { Accounts } from './auth';
import { isUuid } from './db/cards';
import { HttpError, rateLimiter, readJson, sendJson } from './http';

/** Match results of the logged-in user (005_match_results.sql, src/lib/history.ts). */

export const HISTORY_LIMITS = { list: 1000, post: 200 };

/** A result as stored: what the browser keeps only (replays, synced) is left out. */
export type StoredResult = Omit<MatchResult, 'replays' | 'synced'>;

const bad = (field: string) => new HttpError(400, 'invalid', { field });

/** Checks a POST /api/history body: results of matches against the bot. */
export function parseResults(body: unknown, now = Date.now()): StoredResult[] {
  if (!Array.isArray(body)) throw bad('body');
  if (body.length > HISTORY_LIMITS.post) throw new HttpError(413, 'tooLarge', { max: HISTORY_LIMITS.post });
  return body.map((r): StoredResult => {
    if (!r || typeof r !== 'object') throw bad('body');
    const { id, at, twoHeaded, commander, bestOf, deck, opponent, result, wins, losses } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !isUuid(id)) throw bad('id');
    // Not before the app existed, not in the future (a day of margin for device clocks).
    if (!Number.isInteger(at) || (at as number) < Date.UTC(2024, 0) || (at as number) > now + 86400_000) throw bad('at');
    if (typeof twoHeaded !== 'boolean') throw bad('twoHeaded');
    if (typeof commander !== 'boolean') throw bad('commander');
    if (bestOf !== 1 && bestOf !== 3) throw bad('bestOf');
    if (typeof deck !== 'string' || deck.length > 100) throw bad('deck');
    if (typeof opponent !== 'string' || opponent.length > 200) throw bad('opponent');
    if (!RESULTS.includes(result as MatchResult['result'])) throw bad('result');
    if (!Number.isInteger(wins) || (wins as number) < 0 || (wins as number) > 99) throw bad('wins');
    if (!Number.isInteger(losses) || (losses as number) < 0 || (losses as number) > 99) throw bad('losses');
    return {
      id: id.toLowerCase(), at: at as number, kind: 'bot', twoHeaded, commander, bestOf, deck, opponent,
      result: result as MatchResult['result'], wins: wins as number, losses: losses as number,
    };
  });
}

export interface HistoryStore {
  /** Adds results (a result already there, same match, is left as it is). */
  add(userId: string, results: StoredResult[]): Promise<void>;
}

export function historyStore(pool: pg.Pool) {
  return {
    async add(userId: string, results: StoredResult[]) {
      if (!results.length) return;
      await pool.query(
        `INSERT INTO match_results (user_id, id, played_at, kind, two_headed, commander, best_of, deck, opponent, result, wins, losses)
         SELECT $1::uuid, * FROM unnest($2::uuid[], $3::timestamptz[], $4::text[], $5::boolean[], $6::boolean[], $7::smallint[],
                                         $8::text[], $9::text[], $10::text[], $11::smallint[], $12::smallint[])
         ON CONFLICT (user_id, id) DO NOTHING`,
        [
          userId, results.map((r) => r.id), results.map((r) => new Date(r.at)), results.map((r) => r.kind),
          results.map((r) => r.twoHeaded), results.map((r) => r.commander), results.map((r) => r.bestOf),
          results.map((r) => r.deck.slice(0, 100)), results.map((r) => r.opponent.slice(0, 200)), results.map((r) => r.result),
          results.map((r) => r.wins), results.map((r) => r.losses),
        ],
      );
    },
    async list(userId: string): Promise<StoredResult[]> {
      const { rows } = await pool.query(
        `SELECT id, played_at, kind, two_headed, commander, best_of, deck, opponent, result, wins, losses
           FROM match_results WHERE user_id = $1 ORDER BY played_at DESC LIMIT $2`,
        [userId, HISTORY_LIMITS.list],
      );
      return rows.map((r) => ({
        id: r.id, at: (r.played_at as Date).getTime(), kind: r.kind, twoHeaded: r.two_headed, commander: r.commander,
        bestOf: r.best_of, deck: r.deck, opponent: r.opponent, result: r.result, wins: r.wins, losses: r.losses,
      }));
    },
  } satisfies HistoryStore & Record<string, unknown>;
}

export interface HistoryRoutesOptions {
  store: ReturnType<typeof historyStore> | null;
  account: Pick<Accounts, 'enabled' | 'userOf' | 'sameOrigin'>;
}

/** GET /api/history: the account's results, most recent first. POST /api/history: adds results of bot matches. */
export function historyRoutes({ store, account }: HistoryRoutesOptions) {
  const writeLimit = rateLimiter(60, 60_000);

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== '/api/history') return false;
    try {
      if (!account.enabled || !store) throw new HttpError(404, 'accountsDisabled');
      const method = req.method ?? 'GET';
      if (method !== 'GET' && !account.sameOrigin(req)) throw new HttpError(403, 'badOrigin');
      const user = await account.userOf(req, res);
      if (!user) throw new HttpError(401, 'notLoggedIn');
      if (method === 'GET') {
        sendJson(res, 200, { results: await store.list(user.id) });
      } else if (method === 'POST') {
        if (!writeLimit.hit(user.id)) throw new HttpError(429, 'tooManyRequests');
        const results = parseResults(await readJson(req, 200_000));
        await store.add(user.id, results);
        sendJson(res, 200, { count: results.length });
      } else {
        throw new HttpError(405, 'methodNotAllowed');
      }
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      sendJson(res, e.status, { error: e.code, ...e.params });
    }
    return true;
  }

  return { handle };
}
