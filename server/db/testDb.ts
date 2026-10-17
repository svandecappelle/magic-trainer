import pg from 'pg';
import { migrate } from './index';

/**
 * Database tests need PostgreSQL: DATABASE_URL_TEST=postgres://magic:dev@localhost:5432/magic (docker-compose.dev.yml).
 * They are skipped without it.
 */
export const testDbUrl = process.env.DATABASE_URL_TEST;

/** A pool working in a new schema of its own (migrated unless `migrated` is false); `drop` removes it. */
export async function testDb(migrated = true): Promise<{ pool: pg.Pool; schema: string; drop: () => Promise<void> }> {
  const schema = `test_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: testDbUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: testDbUrl, options: `-c search_path=${schema}` });
  if (migrated) await migrate(pool);
  return {
    pool,
    schema,
    drop: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}
