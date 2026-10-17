import type { Board, CollectionEntry, Deck } from '../../types';
import type { MatchResult } from '../history';

/** Client of the account API (server/auth.ts, server/decks.ts; docs/accounts.md). */

export interface AccountUser {
  id: string;
  name: string;
  avatarUrl: string | null;
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
