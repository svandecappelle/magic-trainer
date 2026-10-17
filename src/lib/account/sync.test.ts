import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Card, CollectionEntry, Deck } from '../../types';
import { ApiError, type DeckUpload, type SavedDeck } from './api';
import { createSync, type Sync, type SyncMeta, type SyncOptions, type SyncStatus } from './sync';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const card = (n: number, name: string): Card => ({
  id: uuid(n), name, manaCost: '', cmc: 0, typeLine: 'Instant', oracleText: '', colors: [], colorIdentity: [],
  setCode: 't', setName: 'T', rarity: 'common',
});
const BOLT = card(1, 'Lightning Bolt');
const SHOCK = card(2, 'Shock');
const MOUNTAIN = card(3, 'Mountain');
const UNKNOWN = card(4, 'Homebrew');
const CARDS = new Map([BOLT, SHOCK, MOUNTAIN].map((c) => [c.id, c]));

/** The server's rules (server/decks.ts) in memory: versions, conflicts, tombstones, cursors. */
class FakeServer {
  clock = 1000;
  down = false;
  loggedOut = false;
  puts = 0;
  decks = new Map<string, { deck: Deck; version: number; deletedAt?: number; syncedAt: number }>();
  collection = new Map<string, { entry: CollectionEntry; updatedAt: number }>();

  private check() {
    if (this.down) throw new ApiError(0, 'network');
    if (this.loggedOut) throw new ApiError(401, 'notLoggedIn');
  }
  private toApi(id: string) {
    const row = this.decks.get(id)!;
    return row.deletedAt !== undefined ? { id, version: row.version, deletedAt: row.deletedAt } : { ...row.deck, version: row.version };
  }

  api: SyncOptions['api'] = {
    decks: async (since) => {
      this.check();
      const changed = [...this.decks.keys()].filter((id) => since === null || this.decks.get(id)!.syncedAt > since).map((id) => this.toApi(id));
      return {
        decks: changed.filter((d): d is SavedDeck => !('deletedAt' in d)),
        deleted: changed.filter((d) => 'deletedAt' in d) as { id: string; version: number; deletedAt: number }[],
        cursor: this.clock,
      };
    },
    putDeck: async (id: string, body: DeckUpload) => {
      this.check();
      this.puts++;
      const row = this.decks.get(id);
      if (row && row.version !== body.baseVersion) throw new ApiError(409, 'conflict', { error: 'conflict', deck: this.toApi(id) });
      if (!row && body.baseVersion !== 0) throw new ApiError(404, 'notFound');
      const unknown = body.entries.filter((e) => !CARDS.has(e.cardId)).map((e) => e.cardId);
      if (unknown.length) throw new ApiError(422, 'unknownCards', { ids: unknown });
      const deck: Deck = {
        id, name: body.name, format: body.format, createdAt: body.createdAt, updatedAt: body.updatedAt,
        entries: body.entries.map((e) => ({ card: CARDS.get(e.cardId)!, board: e.board, qty: e.qty })),
      };
      this.decks.set(id, { deck, version: (row?.version ?? 0) + 1, syncedAt: ++this.clock });
      return { ...deck, version: (row?.version ?? 0) + 1 };
    },
    deleteDeck: async (id: string) => {
      this.check();
      const row = this.decks.get(id);
      if (!row) throw new ApiError(404, 'notFound');
      if (row.deletedAt === undefined) Object.assign(row, { deletedAt: ++this.clock, version: row.version + 1, syncedAt: this.clock });
      return { id, version: row.version, deletedAt: row.deletedAt! };
    },
    collection: async (since) => {
      this.check();
      const rows = [...this.collection.values()].filter((r) => (since === null ? r.entry.qty + r.entry.foilQty > 0 : r.updatedAt > since));
      return {
        cards: rows.filter((r) => r.entry.qty + r.entry.foilQty > 0).map((r) => r.entry),
        removed: rows.filter((r) => r.entry.qty + r.entry.foilQty === 0).map((r) => r.entry.card.id),
        cursor: this.clock,
      };
    },
    patchCollection: async (changes) => {
      this.check();
      const unknown = changes.filter((c) => c.qty + c.foilQty > 0 && !CARDS.has(c.cardId)).map((c) => c.cardId);
      if (unknown.length) throw new ApiError(422, 'unknownCards', { ids: unknown });
      for (const c of changes) {
        const row = this.collection.get(c.cardId);
        if (c.qty + c.foilQty === 0 && !row) continue;
        this.collection.set(c.cardId, { entry: { card: CARDS.get(c.cardId)!, qty: c.qty, foilQty: c.foilQty }, updatedAt: ++this.clock });
      }
      return { count: [...this.collection.values()].filter((r) => r.entry.qty + r.entry.foilQty > 0).length };
    },
  };
}

let nextId = 100;
const syncs: Sync[] = [];
afterEach(() => {
  for (const s of syncs.splice(0)) s.stop();
});

/** A browser: its own store, sync state and status. */
function device(server: FakeServer, decks: Deck[] = [], collection: Record<string, CollectionEntry> = {}) {
  const store = createStore<{ decks: Deck[]; collection: Record<string, CollectionEntry> }>()(() => ({ decks, collection }));
  let meta: SyncMeta | null = null;
  const statuses: SyncStatus[] = [];
  let loggedOut = false;
  const sync = createSync({
    api: server.api,
    store,
    loadMeta: () => meta,
    saveMeta: (m) => (meta = m),
    copyName: (name) => `${name} (other device)`,
    newId: () => uuid(nextId++),
    onStatus: (s) => statuses.push(s),
    onLoggedOut: () => (loggedOut = true),
    debounceMs: 1_000_000,
  });
  syncs.push(sync);
  const names = () => store.getState().decks.map((d) => d.name).sort();
  const edit = (id: string, patch: Partial<Deck>, at: number) =>
    store.setState((s) => ({ decks: s.decks.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: at } : d)) }));
  return { store, sync, statuses, names, edit, meta: () => meta, loggedOut: () => loggedOut, status: () => statuses.at(-1)?.state };
}

const deck = (n: number, name: string, at = 1): Deck => ({
  id: uuid(n), name, format: 'modern', createdAt: at, updatedAt: at,
  entries: [{ card: BOLT, qty: 4, board: 'main' }, { card: MOUNTAIN, qty: 20, board: 'main' }],
});

describe('deck sync', () => {
  it('uploads the local decks at the first login and brings them to another device', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn'), deck(2, 'Red')]);
    await a.sync.start('u1');
    expect(a.status()).toBe('synced');
    expect([...server.decks.values()].map((r) => r.deck.name).sort()).toEqual(['Burn', 'Red']);

    const b = device(server, [deck(3, 'Mine')]);
    await b.sync.start('u1');
    expect(b.names()).toEqual(['Burn', 'Mine', 'Red']);
    await a.sync.sync();
    expect(a.names()).toEqual(['Burn', 'Mine', 'Red']);
  });

  it('sends edits and deletions, and does not send back what it received', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn'), deck(2, 'Red')]);
    const b = device(server);
    await a.sync.start('u1');
    await b.sync.start('u1');
    const puts = server.puts;

    a.edit(uuid(1), { name: 'Burn v2' }, 10);
    a.store.setState((s) => ({ decks: s.decks.filter((d) => d.id !== uuid(2)) }));
    expect(a.sync.pending()).toBe(2);
    await a.sync.sync();
    expect(a.sync.pending()).toBe(0);
    expect(server.decks.get(uuid(2))!.deletedAt).toBeDefined();

    await b.sync.sync();
    expect(b.names()).toEqual(['Burn v2']);
    expect(b.sync.pending()).toBe(0);
    await b.sync.sync();
    expect(server.puts).toBe(puts + 1);
  });

  it('keeps both versions when two devices changed the same deck', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn')]);
    const b = device(server);
    await a.sync.start('u1');
    await b.sync.start('u1');

    a.edit(uuid(1), { name: 'Burn (A)' }, 10);
    b.edit(uuid(1), { name: 'Burn (B)' }, 20); // later
    await a.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    // B's edit is newer: it keeps the deck's id; A's version survives as a copy.
    for (const d of [a, b]) expect(d.names()).toEqual(['Burn (A) (other device)', 'Burn (B)']);
    expect(a.store.getState().decks.find((d) => d.id === uuid(1))!.name).toBe('Burn (B)');
    expect(a.sync.pending() + b.sync.pending()).toBe(0);
  });

  it('applies a deletion from another device, unless the deck changed here afterwards', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn'), deck(2, 'Red')]);
    const b = device(server);
    await a.sync.start('u1');
    await b.sync.start('u1');
    b.store.setState((s) => ({ decks: s.decks.filter((d) => d.id !== uuid(1) && d.id !== uuid(2)) }));
    await b.sync.sync();
    a.edit(uuid(2), { name: 'Red v2' }, Date.now() + 1000); // edited after the deletion
    await a.sync.sync();
    expect(a.names()).toEqual(['Red v2']);
    await b.sync.sync();
    expect(b.names()).toEqual(['Red v2']);
  });

  it('does not lose a local change made while a pull is on its way', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn')]);
    await a.sync.start('u1');
    const decks = server.api.decks;
    server.api.decks = async (since) => {
      const out = await decks(since);
      a.edit(uuid(1), { name: 'Burn v2' }, 10); // the user types while the request is in flight
      return out;
    };
    await a.sync.sync();
    server.api.decks = decks;
    expect(server.decks.get(uuid(1))!.deck.name).toBe('Burn v2');
    expect(a.sync.pending()).toBe(0);
  });

  it('keeps changes while offline and sends them when the server is back', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn')]);
    await a.sync.start('u1');
    server.down = true;
    a.edit(uuid(1), { name: 'Burn v2' }, 10);
    await a.sync.sync();
    expect(a.status()).toBe('offline');
    expect(a.sync.pending()).toBe(1);
    server.down = false;
    await a.sync.sync();
    expect(a.status()).toBe('synced');
    expect(server.decks.get(uuid(1))!.deck.name).toBe('Burn v2');
  });

  it('keeps a deck the server refuses in the browser and reports it', async () => {
    const server = new FakeServer();
    const homebrew: Deck = { ...deck(2, 'Homebrew'), entries: [{ card: UNKNOWN, qty: 1, board: 'main' }] };
    const a = device(server, [deck(1, 'Burn'), homebrew]);
    await a.sync.start('u1');
    expect(a.statuses.at(-1)).toMatchObject({ state: 'error', rejected: ['Homebrew'] });
    expect(server.decks.has(uuid(1))).toBe(true);
    expect(a.names()).toEqual(['Burn', 'Homebrew']);
    // Not sent again until it changes.
    const puts = server.puts;
    await a.sync.sync();
    expect(server.puts).toBe(puts);
    a.edit(uuid(2), { entries: [{ card: SHOCK, qty: 1, board: 'main' }] }, 10);
    await a.sync.sync();
    expect(a.status()).toBe('synced');
  });

  it('stops when the session ended, and ignores answers after a stop', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn')]);
    await a.sync.start('u1');
    server.loggedOut = true;
    a.edit(uuid(1), { name: 'Burn v2' }, 10);
    await a.sync.sync();
    expect(a.loggedOut()).toBe(true);

    server.loggedOut = false;
    const b = device(server);
    const running = b.sync.start('u1');
    b.sync.stop();
    await running;
    expect(b.names()).toEqual([]);
  });

  it('starts afresh for another user', async () => {
    const server = new FakeServer();
    const a = device(server, [deck(1, 'Burn')]);
    await a.sync.start('u1');
    a.sync.stop();
    const other = new FakeServer();
    const b = device(other, a.store.getState().decks);
    await b.sync.start('u1');
    expect(other.decks.size).toBe(1);
  });
});

describe('collection sync', () => {
  const entry = (c: Card, qty: number, foilQty = 0): CollectionEntry => ({ card: c, qty, foilQty });

  it('merges the first time with the larger counts, then follows changes and removals', async () => {
    const server = new FakeServer();
    const a = device(server, [], { [BOLT.id]: entry(BOLT, 4), [SHOCK.id]: entry(SHOCK, 1) });
    await a.sync.start('u1');
    const b = device(server, [], { [BOLT.id]: entry(BOLT, 2, 1), [MOUNTAIN.id]: entry(MOUNTAIN, 20) });
    await b.sync.start('u1');
    const counts = (d: ReturnType<typeof device>) =>
      Object.fromEntries(Object.values(d.store.getState().collection).map((e) => [e.card.name, [e.qty, e.foilQty]]));
    expect(counts(b)).toEqual({ 'Lightning Bolt': [4, 1], Shock: [1, 0], Mountain: [20, 0] });

    await a.sync.sync();
    expect(counts(a)).toEqual(counts(b));

    a.store.setState((s) => {
      const collection = { ...s.collection };
      delete collection[SHOCK.id];
      collection[BOLT.id] = entry(BOLT, 3, 1);
      return { collection };
    });
    await a.sync.sync();
    await b.sync.sync();
    expect(counts(b)).toEqual({ 'Lightning Bolt': [3, 1], Mountain: [20, 0] });
  });

  it('keeps cards the server does not know in the browser only', async () => {
    const server = new FakeServer();
    const a = device(server, [], { [BOLT.id]: entry(BOLT, 4), [UNKNOWN.id]: entry(UNKNOWN, 1) });
    await a.sync.start('u1');
    expect(a.status()).toBe('synced');
    expect(server.collection.has(BOLT.id)).toBe(true);
    expect(Object.keys(a.store.getState().collection)).toHaveLength(2);
    expect(a.sync.pending()).toBe(0);
  });
});
