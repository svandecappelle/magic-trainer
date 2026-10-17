import type { CollectionEntry, Deck } from '../../types';
import { ApiError, type AccountApi, type DeckUpload, type SavedDeck } from './api';

/**
 * Keeps the browser's decks and collection in sync with the account (docs/accounts.md, "Sync in the browser").
 * The local store stays the source of truth: local changes are sent shortly after they happen, and other devices'
 * changes are pulled (since a cursor) at start, on focus and before each push.
 */

/** What the sync remembers between visits (localStorage), for one user. */
export interface SyncMeta {
  userId: string;
  /** Server version of each deck known to be on the server. */
  versions: Record<string, number>;
  /** Decks changed locally and not sent yet. */
  dirtyDecks: string[];
  /** Decks deleted locally, deletion not sent yet. */
  deletedDecks: string[];
  deckCursor: number | null;
  /** Collection cards changed locally and not sent yet. */
  dirtyCards: string[];
  /** null until the first merge of the collection with the account. */
  cardCursor: number | null;
}

export type SyncState = 'syncing' | 'synced' | 'offline' | 'error';
export interface SyncStatus {
  state: SyncState;
  /** Decks the server refused (unknown cards, too many…): kept in the browser only until they change. */
  rejected: string[];
  /** Error code of the last failure. */
  error?: string;
  at: number;
}

interface LocalData {
  decks: Deck[];
  collection: Record<string, CollectionEntry>;
}

export interface LocalStore {
  getState(): LocalData;
  setState(partial: Partial<LocalData>): void;
  subscribe(listener: (state: LocalData, prev: LocalData) => void): () => void;
}

export interface SyncOptions {
  api: Pick<AccountApi, 'decks' | 'putDeck' | 'deleteDeck' | 'collection' | 'patchCollection'>;
  store: LocalStore;
  loadMeta(): SyncMeta | null;
  saveMeta(meta: SyncMeta | null): void;
  /** Name of the copy kept when two devices changed the same deck. */
  copyName(name: string): string;
  newId(): string;
  onStatus(status: SyncStatus): void;
  /** The session ended (401): the sync stopped. */
  onLoggedOut(): void;
  debounceMs?: number;
  /** Delay before retrying after a network failure; doubles up to 5 minutes. */
  retryMs?: number;
}

const COLLECTION_BATCH = 5000;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Same name, format and cards (the server's copy has fresher card data, which doesn't count). */
export function sameContent(a: Deck, b: Deck): boolean {
  const key = (d: Deck) => d.entries.map((e) => `${e.card.id}/${e.board}/${e.qty}`).sort().join(',');
  return a.name === b.name && a.format === b.format && key(a) === key(b);
}

function upload(deck: Deck, baseVersion: number): DeckUpload {
  return {
    name: deck.name,
    format: deck.format,
    entries: deck.entries.map((e) => ({ cardId: e.card.id, board: e.board, qty: e.qty })),
    createdAt: Math.round(deck.createdAt),
    updatedAt: Math.round(deck.updatedAt),
    baseVersion,
  };
}

const strip = ({ version: _version, ...deck }: SavedDeck): Deck => deck;

/** Thrown when the sync was stopped (logout) while a request was on its way: its answer is dropped. */
const CANCELLED = new Error('sync stopped');

export function createSync(opts: SyncOptions) {
  const { api, store } = opts;
  const debounceMs = opts.debounceMs ?? 1500;
  let meta: SyncMeta | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = opts.retryMs ?? 30_000;
  let running: Promise<void> | null = null;
  let again = false;
  /** Store updates made by the sync itself, not to be sent back. */
  let applying = false;
  /** Decks the server refused, by id: skipped until the deck changes. */
  const rejected = new Map<string, Deck>();
  /** Bumped by start and stop: answers to requests sent before are dropped. */
  let generation = 0;

  async function call<T>(request: () => Promise<T>): Promise<T> {
    const g = generation;
    const out = await request();
    if (g !== generation) throw CANCELLED;
    return out;
  }

  const save = () => meta && opts.saveMeta(meta);
  const status = (state: SyncState, error?: string) =>
    opts.onStatus({ state, error, at: Date.now(), rejected: [...rejected.values()].map((d) => d.name) });

  function apply(partial: Partial<LocalData>) {
    applying = true;
    try {
      store.setState(partial);
    } finally {
      applying = false;
    }
  }

  function onLocalChange(next: LocalData, prev: LocalData) {
    if (applying || !meta) return;
    const dirty = new Set(meta.dirtyDecks);
    const deleted = new Set(meta.deletedDecks);
    if (next.decks !== prev.decks) {
      const before = new Map(prev.decks.map((d) => [d.id, d]));
      const now = new Set(next.decks.map((d) => d.id));
      for (const d of next.decks) if (before.get(d.id) !== d) dirty.add(d.id);
      for (const d of prev.decks) {
        if (now.has(d.id)) continue;
        dirty.delete(d.id);
        rejected.delete(d.id);
        if (meta.versions[d.id] !== undefined) deleted.add(d.id);
      }
    }
    const cards = new Set(meta.dirtyCards);
    if (next.collection !== prev.collection) {
      for (const id of new Set([...Object.keys(next.collection), ...Object.keys(prev.collection)])) {
        if (next.collection[id] !== prev.collection[id] && isUuid(id)) cards.add(id);
      }
    }
    meta = { ...meta, dirtyDecks: [...dirty], deletedDecks: [...deleted], dirtyCards: [...cards] };
    save();
    schedule(debounceMs);
  }

  function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void sync();
    }, ms);
  }

  /**
   * Both devices changed the deck at `index`: the most recent version stays under the deck's id, the other one
   * becomes a copy, so nothing is lost. Returns the new deck list.
   */
  function resolveConflict(decks: Deck[], index: number, server: Deck, dirty: Set<string>): Deck[] {
    const local = decks[index];
    const out = [...decks];
    let copy: Deck;
    if (local.updatedAt >= server.updatedAt) {
      copy = { ...server, id: opts.newId(), name: opts.copyName(server.name) };
    } else {
      out[index] = server;
      dirty.delete(server.id);
      copy = { ...local, id: opts.newId(), name: opts.copyName(local.name) };
    }
    out.splice(index + 1, 0, copy);
    dirty.add(copy.id);
    return out;
  }

  async function pullDecks() {
    const res = await call(() => api.decks(meta!.deckCursor));
    // Read after the answer: local changes may have happened while waiting for it.
    const m = meta!;
    let decks = store.getState().decks;
    const dirty = new Set(m.dirtyDecks);
    const deleted = new Set(m.deletedDecks);
    const versions = { ...m.versions };
    for (const saved of res.decks) {
      const known = versions[saved.id];
      // Our own change coming back, or nothing newer than what we have.
      if (known !== undefined && saved.version <= known) continue;
      versions[saved.id] = saved.version;
      if (deleted.has(saved.id)) continue; // our deletion is sent next
      const server = strip(saved);
      const i = decks.findIndex((d) => d.id === saved.id);
      if (i < 0) decks = [...decks, server];
      else if (!dirty.has(saved.id) || sameContent(decks[i], server)) {
        decks = decks.map((d, j) => (j === i ? server : d));
        dirty.delete(saved.id);
      } else decks = resolveConflict(decks, i, server, dirty);
    }
    for (const gone of res.deleted) {
      deleted.delete(gone.id);
      const local = decks.find((d) => d.id === gone.id);
      // Changed here after it was deleted elsewhere: sending it brings it back.
      if (local && dirty.has(gone.id) && local.updatedAt > gone.deletedAt) {
        versions[gone.id] = gone.version;
        continue;
      }
      if (local) decks = decks.filter((d) => d.id !== gone.id);
      dirty.delete(gone.id);
      delete versions[gone.id];
    }
    if (decks !== store.getState().decks) apply({ decks });
    meta = { ...m, versions, dirtyDecks: [...dirty], deletedDecks: [...deleted], deckCursor: res.cursor };
    save();
  }

  async function pullCollection() {
    const first = meta!.cardCursor === null;
    const res = await call(() => api.collection(meta!.cardCursor));
    const m = meta!;
    const before = store.getState().collection;
    const collection = { ...before };
    const dirty = new Set(m.dirtyCards);
    let changed = false;
    for (const server of res.cards) {
      const id = server.card.id;
      const local = collection[id];
      if (first && local) {
        // First merge of this browser with the account: keep the larger counts, nothing is lost.
        const qty = Math.max(local.qty, server.qty);
        const foilQty = Math.max(local.foilQty, server.foilQty);
        if (qty !== local.qty || foilQty !== local.foilQty) {
          collection[id] = { ...local, qty, foilQty };
          changed = true;
        }
        if (qty !== server.qty || foilQty !== server.foilQty) dirty.add(id);
        else dirty.delete(id);
      } else if (!dirty.has(id) && (!local || local.qty !== server.qty || local.foilQty !== server.foilQty)) {
        collection[id] = server;
        changed = true;
      }
    }
    for (const id of res.removed) {
      if (!dirty.has(id) && collection[id]) {
        delete collection[id];
        changed = true;
      }
    }
    if (first) {
      const onServer = new Set(res.cards.map((c) => c.card.id));
      for (const id of Object.keys(collection)) if (!onServer.has(id) && isUuid(id)) dirty.add(id);
    }
    if (changed) apply({ collection });
    meta = { ...meta!, dirtyCards: [...dirty], cardCursor: res.cursor };
    save();
  }

  async function pushDecks() {
    for (const id of [...meta!.deletedDecks]) {
      try {
        await call(() => api.deleteDeck(id));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      const versions = { ...meta!.versions };
      delete versions[id];
      meta = { ...meta!, versions, deletedDecks: meta!.deletedDecks.filter((x) => x !== id) };
      save();
    }
    // A conflict changes the decks (a copy to send): a few rounds settle it.
    for (let round = 0; round < 3; round++) {
      let conflicts = false;
      for (const id of [...meta!.dirtyDecks]) {
        const local = store.getState().decks.find((d) => d.id === id);
        if (!local) {
          meta = { ...meta!, dirtyDecks: meta!.dirtyDecks.filter((x) => x !== id) };
          continue;
        }
        if (rejected.get(id) === local) continue;
        rejected.delete(id);
        try {
          const saved = await call(() => api.putDeck(id, upload(local, meta!.versions[id] ?? 0)));
          const stillSame = store.getState().decks.find((d) => d.id === id) === local;
          meta = {
            ...meta!,
            versions: { ...meta!.versions, [id]: saved.version },
            dirtyDecks: stillSame ? meta!.dirtyDecks.filter((x) => x !== id) : meta!.dirtyDecks,
          };
        } catch (e) {
          if (!(e instanceof ApiError) || e.transient) throw e;
          if (e.status === 409) {
            conflicts = true;
            resolvePushConflict(id, e.body.deck as SavedDeck | { id: string; version: number; deletedAt: number });
          } else if (e.status === 404 && meta!.versions[id] !== undefined) {
            // The server forgot it (tombstone purged): send it as a new deck.
            const versions = { ...meta!.versions };
            delete versions[id];
            meta = { ...meta!, versions };
            conflicts = true;
          } else if (e.status === 404) {
            // The id belongs to someone else: the deck takes a new one.
            const fresh = opts.newId();
            apply({ decks: store.getState().decks.map((d) => (d.id === id ? { ...d, id: fresh } : d)) });
            meta = { ...meta!, dirtyDecks: [...meta!.dirtyDecks.filter((x) => x !== id), fresh] };
            conflicts = true;
          } else {
            rejected.set(id, local);
          }
        }
        save();
      }
      if (!conflicts) break;
    }
  }

  function resolvePushConflict(id: string, server: SavedDeck | { id: string; version: number; deletedAt: number }) {
    const decks = store.getState().decks;
    const i = decks.findIndex((d) => d.id === id);
    const dirty = new Set(meta!.dirtyDecks);
    const versions = { ...meta!.versions, [id]: server.version };
    if ('deletedAt' in server) {
      if (decks[i].updatedAt <= server.deletedAt) {
        apply({ decks: decks.filter((d) => d.id !== id) });
        dirty.delete(id);
        delete versions[id];
      }
    } else if (sameContent(decks[i], strip(server))) {
      dirty.delete(id);
    } else {
      apply({ decks: resolveConflict(decks, i, strip(server), dirty) });
    }
    meta = { ...meta!, versions, dirtyDecks: [...dirty] };
  }

  async function pushCollection() {
    let ids = [...meta!.dirtyCards];
    while (ids.length) {
      const batch = ids.slice(0, COLLECTION_BATCH);
      const collection = store.getState().collection;
      const sent = batch.map((id) => [id, collection[id]] as const);
      try {
        await call(() => api.patchCollection(sent.map(([cardId, e]) => ({ cardId, qty: e?.qty ?? 0, foilQty: e?.foilQty ?? 0 }))));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'unknownCards' && Array.isArray(e.body.ids)) {
          // Cards Scryfall doesn't know can't be saved: they stay in this browser only.
          const unknown = new Set(e.body.ids as string[]);
          meta = { ...meta!, dirtyCards: meta!.dirtyCards.filter((id) => !unknown.has(id)) };
          ids = ids.filter((id) => !unknown.has(id));
          save();
          continue;
        }
        throw e;
      }
      const now = store.getState().collection;
      const done = new Set(sent.filter(([id, e]) => now[id] === e).map(([id]) => id));
      meta = { ...meta!, dirtyCards: meta!.dirtyCards.filter((id) => !done.has(id)) };
      save();
      ids = ids.slice(COLLECTION_BATCH);
    }
  }

  async function round() {
    status('syncing');
    await pullDecks();
    await pullCollection();
    await pushDecks();
    await pushCollection();
  }

  /** Pulls the other devices' changes and sends ours. Calls made while one runs are merged into one more run. */
  function sync(): Promise<void> {
    if (!meta) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let restart = false;
      try {
        do {
          again = false;
          await round();
        } while (again && meta);
        if (!meta) return;
        retryDelay = opts.retryMs ?? 30_000;
        status(rejected.size ? 'error' : 'synced', rejected.size ? 'rejected' : undefined);
      } catch (e) {
        // Stopped, or restarted for another user: a new run starts if needed.
        if (e === CANCELLED) restart = true;
        else if (e instanceof ApiError && e.status === 401) {
          stop();
          opts.onLoggedOut();
        } else if (e instanceof ApiError && e.transient) {
          status('offline', e.code);
          schedule(retryDelay);
          retryDelay = Math.min(retryDelay * 2, 300_000);
        } else {
          status('error', e instanceof ApiError ? e.code : String(e));
        }
      } finally {
        running = null;
      }
      if (restart && meta) await sync();
    })();
    return running;
  }

  /** Starts syncing for this user. A different user than last time starts afresh: every local deck is sent. */
  function start(userId: string): Promise<void> {
    stop();
    const saved = opts.loadMeta();
    meta =
      saved && saved.userId === userId
        ? saved
        : { userId, versions: {}, dirtyDecks: store.getState().decks.map((d) => d.id), deletedDecks: [], deckCursor: null, dirtyCards: [], cardCursor: null };
    save();
    unsubscribe = store.subscribe(onLocalChange);
    return sync();
  }

  function stop() {
    generation++;
    unsubscribe?.();
    unsubscribe = null;
    if (timer) clearTimeout(timer);
    timer = null;
    meta = null;
    rejected.clear();
  }

  /** Sends what is pending now (before logging out). */
  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    await sync();
  }

  return {
    start,
    stop,
    sync,
    flush,
    /** Changes not sent yet. */
    pending: () => (meta ? meta.dirtyDecks.length + meta.deletedDecks.length + meta.dirtyCards.length : 0),
    /** Forgets this browser's sync state (logout, account deleted). */
    forget() {
      stop();
      opts.saveMeta(null);
    },
  };
}

export type Sync = ReturnType<typeof createSync>;
