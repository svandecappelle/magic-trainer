import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Card } from '../../src/types';
import { storedLookup } from './cards';
import { migrate } from './index';
import { testDb, testDbUrl } from './testDb';

const card = (id: string, name: string): Card => ({
  id, name, manaCost: '{R}', cmc: 1, typeLine: 'Instant', oracleText: 'Deal 3 damage to any target.',
  colors: ['R'], colorIdentity: ['R'], setCode: 'lea', setName: 'Alpha', rarity: 'common',
});
const BOLT = '11111111-1111-4111-8111-111111111111';
const SHOCK = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!testDbUrl)('database', () => {
  let pool: pg.Pool;
  let schema: string;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ pool, schema, drop } = await testDb(false));
  });

  afterAll(() => drop?.());

  it('applies the migrations once', async () => {
    expect(await migrate(pool)).toContain('001_accounts.sql');
    expect(await migrate(pool)).toEqual([]);
    const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`, [schema]);
    expect(rows.map((r) => r.table_name)).toEqual(['cards', 'collection_cards', 'deck_cards', 'decks', 'identities', 'schema_migrations', 'sessions', 'users']);
  });

  it('enforces the constraints of the data model', async () => {
    const { rows: [user] } = await pool.query(`INSERT INTO users (display_name) VALUES ('Aang') RETURNING id`);
    await pool.query(`INSERT INTO identities (user_id, provider, provider_user_id, username) VALUES ($1, 'discord', '42', 'aang')`, [user.id]);
    // One Discord account belongs to one user only.
    await expect(pool.query(`INSERT INTO identities (user_id, provider, provider_user_id, username) VALUES ($1, 'discord', '42', 'x')`, [user.id])).rejects.toThrow(/unique/);
    await pool.query(`INSERT INTO cards (id, data) VALUES ($1, $2)`, [BOLT, card(BOLT, 'Lightning Bolt')]);
    const deck = '33333333-3333-4333-8333-333333333333';
    await pool.query(`INSERT INTO decks (id, user_id, name, format, created_at, updated_at) VALUES ($1, $2, 'Burn', 'modern', now(), now())`, [deck, user.id]);
    await pool.query(`INSERT INTO deck_cards (deck_id, card_id, board, qty) VALUES ($1, $2, 'main', 4)`, [deck, BOLT]);
    await expect(pool.query(`INSERT INTO deck_cards (deck_id, card_id, board, qty) VALUES ($1, $2, 'maybe', 1)`, [deck, BOLT])).rejects.toThrow(/enum/);
    await expect(pool.query(`INSERT INTO collection_cards (user_id, card_id, qty, foil_qty) VALUES ($1, $2, 0, 0)`, [user.id, BOLT])).rejects.toThrow(/check/);
    // Deleting the account deletes everything it owns.
    await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    const counts = await pool.query(`SELECT (SELECT count(*) FROM identities)::int AS i, (SELECT count(*) FROM decks)::int AS d, (SELECT count(*) FROM deck_cards)::int AS c`);
    expect(counts.rows[0]).toEqual({ i: 0, d: 0, c: 0 });
  });

  it('keeps Scryfall cards in the cards table and asks Scryfall only for the others', async () => {
    const asked: string[][] = [];
    const scryfall = async (ids: string[]) => {
      asked.push(ids);
      return new Map(ids.filter((id) => id !== 'forged').map((id) => [id, card(id, id === SHOCK ? 'Shock' : 'Lightning Bolt')]));
    };
    await pool.query(`DELETE FROM cards`);
    const lookup = storedLookup(pool, scryfall);
    expect([...(await lookup([BOLT, SHOCK])).keys()].sort()).toEqual([BOLT, SHOCK]);
    expect((await lookup([BOLT, SHOCK, 'forged'])).get(SHOCK)?.name).toBe('Shock');
    expect(asked).toEqual([[BOLT, SHOCK], ['forged']]);
    // Old data is fetched again.
    await pool.query(`UPDATE cards SET fetched_at = now() - interval '31 days' WHERE id = $1`, [BOLT]);
    await lookup([BOLT, SHOCK]);
    expect(asked.at(-1)).toEqual([BOLT]);
  });

  it('falls back to Scryfall when the database is down', async () => {
    const down = new pg.Pool({ connectionString: 'postgres://nobody:x@127.0.0.1:1/none', connectionTimeoutMillis: 500 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const found = await storedLookup(down, async (ids) => new Map(ids.map((id) => [id, card(id, 'Bolt')])))([BOLT]);
      expect(found.get(BOLT)?.name).toBe('Bolt');
    } finally {
      console.warn = warn;
      await down.end();
    }
  });
});
