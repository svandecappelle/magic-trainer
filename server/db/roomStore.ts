import type pg from 'pg';
import { STATE_VERSION } from '../../src/lib/engine/engine';

/** How long a room nobody touched is kept (in the database and in memory). */
export const ROOM_KEEP_HOURS = 24;

/** The online rooms in the rooms table (see 004_rooms.sql): written by RoomManager, read back at startup. */
export interface RoomStore {
  save(id: string, code: string, data: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function roomStore(pool: pg.Pool) {
  return {
    async save(id: string, code: string, data: string) {
      await pool.query(
        `INSERT INTO rooms (id, code, state_version, data, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, state_version = EXCLUDED.state_version, data = EXCLUDED.data, updated_at = now()`,
        [id, code, STATE_VERSION, data],
      );
    },
    async remove(id: string) {
      await pool.query(`DELETE FROM rooms WHERE id = $1`, [id]);
    },
    /** The rooms to restore: recent ones, saved by this version of the engine. */
    async load(): Promise<string[]> {
      const { rows } = await pool.query<{ data: string }>(
        `SELECT data FROM rooms WHERE state_version = $1 AND updated_at > now() - make_interval(hours => $2)`,
        [STATE_VERSION, ROOM_KEEP_HOURS],
      );
      return rows.map((r) => r.data);
    },
    /** Deletes old rooms and rooms of another engine version; returns how many. */
    async purge(): Promise<number> {
      const { rowCount } = await pool.query(
        `DELETE FROM rooms WHERE state_version <> $1 OR updated_at <= now() - make_interval(hours => $2)`,
        [STATE_VERSION, ROOM_KEEP_HOURS],
      );
      return rowCount ?? 0;
    },
  } satisfies RoomStore & Record<string, unknown>;
}
