import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const MIGRATIONS = resolve(import.meta.dirname, 'migrations');

/** A connection pool to DATABASE_URL. */
export function openDb(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // An idle client losing its connection (database restart) must not crash the server.
  pool.on('error', (e) => console.error('Database connection lost:', e.message));
  return pool;
}

/** Waits until the database answers (it may still be starting next to the app). */
export async function waitForDb(pool: pg.Pool, tries = 30, delayMs = 1000): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Applies the SQL files of server/db/migrations not applied yet, in name order, each in its own transaction, and
 * records them in schema_migrations. A lock keeps two servers starting together from applying the same file twice.
 * Returns the names applied.
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(7262001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(7262001)').catch(() => {});
    client.release();
  }
  return applied;
}
