import type { Board, CollectionEntry, Deck, DeckEntry } from '../../types';
import type { MatchResult } from '../history';

/** Client of the account API (server/auth.ts, server/decks.ts; docs/accounts.md). */

export interface AccountUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** When the account was created (ms). */
  createdAt?: number;
  /** An administrator (ADMIN_DISCORD_IDS): the /admin page. */
  admin?: boolean;
}

/** The administration page's data (server/admin.ts). */
export interface AdminOverview {
  users: number;
  newThisWeek: number;
  activeToday: number;
  active7d: number;
  sessions: number;
  online: { players: number; rooms: number };
  matches7d: number;
  botShare: number | null;
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
export interface AdminRoom {
  id: string;
  code: string;
  players: { name: string; connected: boolean }[];
  size: 2 | 4;
  mode: string;
  bestOf: 1 | 3;
  score: number[];
  turn: number | null;
  clock: { player: string; kind: 'turn' | 'reconnect'; endsAt: number } | null;
  watchers: number;
  createdAt: number | null;
}
export interface AdminShare {
  kind: 'deck' | 'replay';
  shareId: string;
  title: string;
  owner: string;
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

/** A deck shared by its owner: anyone with /shared/<shareId> can read it. */
export interface DeckShare {
  deckId: string;
  shareId: string;
}

/** A shared deck as anyone reads it (server/decks.ts). */
export interface SharedDeck {
  name: string;
  format: string;
  updatedAt: number;
  entries: DeckEntry[];
  owner: { name: string; avatarUrl: string | null };
}

/** A replay shared by its owner: anyone with /replay/<shareId> can watch it (server/replays.ts). */
export interface ReplayShare {
  replayId: string;
  shareId: string;
  title: string;
  at: number;
}

/** A shared replay as anyone reads it: the replay file (lib/replay.ts packReplay) and its owner. */
export interface SharedReplay {
  data: string;
  owner: { name: string; avatarUrl: string | null };
}

export type SavedDeck = Deck & { version: number };
export interface DeletedDeck {
  id: string;
  version: number;
  deletedAt: number;
}

export interface DeckChanges {
  decks: SavedDeck[];
  deleted: DeletedDeck[];
  cursor: number;
}

export interface CollectionChanges {
  cards: CollectionEntry[];
  removed: string[];
  cursor: number;
}

export interface DeckUpload {
  name: string;
  format: string;
  entries: { cardId: string; board: Board; qty: number }[];
  createdAt: number;
  updatedAt: number;
  baseVersion: number;
}

/** An answer other than 2xx: `status` 0 when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }

  /** Worth retrying later: no network, server or Scryfall unavailable, rate limited. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'network', { message: (e as Error).message });
  }
  const json = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError(res.status, typeof json.error === 'string' ? json.error : `http${res.status}`, json);
  return json as T;
}

export const accountApi = {
  me: () => request<{ enabled: boolean; user: AccountUser | null }>('GET', '/api/me'),
  logout: () => request<void>('POST', '/auth/logout'),
  deleteAccount: () => request<void>('DELETE', '/api/me'),
  decks: (since: number | null) => request<DeckChanges>('GET', `/api/decks${since === null ? '' : `?since=${since}`}`),
  putDeck: (id: string, deck: DeckUpload) => request<SavedDeck>('PUT', `/api/decks/${id}`, deck),
  deleteDeck: (id: string) => request<DeletedDeck>('DELETE', `/api/decks/${id}`),
  shares: () => request<{ shares: DeckShare[] }>('GET', '/api/shares'),
  share: (id: string) => request<DeckShare>('PUT', `/api/decks/${id}/share`),
  unshare: (id: string) => request<void>('DELETE', `/api/decks/${id}/share`),
  shared: (shareId: string) => request<SharedDeck>('GET', `/api/shared/${encodeURIComponent(shareId)}`),
  /** A deck from an mtgtop8, Moxfield or Archidekt link (server/importDeck.ts): its name, format and decklist text. */
  importDeck: (url: string) => request<{ name: string; format?: string; text: string; source: string }>('GET', `/api/import-deck?url=${encodeURIComponent(url)}`),
  admin: {
    overview: () => request<AdminOverview>('GET', '/api/admin/overview'),
    users: (q: string, sort: 'seen' | 'joined') => request<{ users: AdminUser[]; total: number }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}&sort=${sort}`),
    signOut: (id: string) => request<{ count: number }>('POST', `/api/admin/users/${id}/signout`),
    unshare: (id: string) => request<{ count: number }>('POST', `/api/admin/users/${id}/unshare`),
    deleteUser: (id: string) => request<void>('DELETE', `/api/admin/users/${id}`),
    rooms: () => request<{ rooms: AdminRoom[] }>('GET', '/api/admin/rooms'),
    closeRoom: (code: string) => request<void>('DELETE', `/api/admin/rooms/${encodeURIComponent(code)}`),
    shares: (kind: 'decks' | 'replays', q: string) => request<{ shares: AdminShare[] }>('GET', `/api/admin/shares?kind=${kind}&q=${encodeURIComponent(q)}`),
    stopShare: (kind: 'deck' | 'replay', shareId: string) => request<void>('DELETE', `/api/admin/shares/${kind}/${encodeURIComponent(shareId)}`),
    system: () => request<AdminSystem>('GET', '/api/admin/system'),
    maintenance: (task: 'sessions' | 'tombstones') => request<{ count: number }>('POST', `/api/admin/maintenance/${task}`),
  },
  replayShares: () => request<{ shares: ReplayShare[] }>('GET', '/api/replays'),
  shareReplay: (data: string) => request<ReplayShare>('POST', '/api/replays', { data }),
  unshareReplay: (shareId: string) => request<void>('DELETE', `/api/replays/${encodeURIComponent(shareId)}`),
  sharedReplay: (shareId: string) => request<SharedReplay>('GET', `/api/shared-replays/${encodeURIComponent(shareId)}`),
  collection: (since: number | null) => request<CollectionChanges>('GET', `/api/collection${since === null ? '' : `?since=${since}`}`),
  patchCollection: (changes: { cardId: string; qty: number; foilQty: number }[]) => request<{ count: number }>('PATCH', '/api/collection', changes),
  history: () => request<{ results: MatchResult[] }>('GET', '/api/history'),
  postHistory: (results: MatchResult[]) => request<{ count: number }>('POST', '/api/history', results),
};

export type AccountApi = typeof accountApi;

/** Where the login button goes: back to the current page afterwards. */
export function loginUrl(): string {
  return `/auth/discord?return=${encodeURIComponent(location.pathname + location.search)}`;
}
