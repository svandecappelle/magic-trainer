import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { STATE_VERSION } from '../../src/lib/engine/engine';
import { roomStore } from './roomStore';
import { testDb, testDbUrl } from './testDb';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!testDbUrl)('room store', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await testDb());
  });
  afterAll(() => drop?.());

  it('saves, updates, loads and deletes rooms; drops old ones and other engine versions', async () => {
    const store = roomStore(pool);
    await store.save(A, 'AAAAA', 'first');
    await store.save(A, 'AAAAA', 'second');
    await store.save(B, 'BBBBB', 'other');
    expect((await store.load()).sort()).toEqual(['other', 'second']);
    await store.remove(B);
    expect(await store.load()).toEqual(['second']);
    // A day old, or saved by another engine: not loaded, and purged.
    await pool.query(`UPDATE rooms SET updated_at = now() - interval '25 hours' WHERE id = $1`, [A]);
    await store.save(B, 'BBBBB', 'old engine');
    await pool.query(`UPDATE rooms SET state_version = $2 WHERE id = $1`, [B, STATE_VERSION + 1]);
    expect(await store.load()).toEqual([]);
    expect(await store.purge()).toBe(2);
  });
});
