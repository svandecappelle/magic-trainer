import { create } from 'zustand';
import { messagesFor, useLang } from '../i18n';
import { accountApi, type AccountUser } from '../lib/account/api';
import { createSync, type SyncMeta, type SyncStatus } from '../lib/account/sync';
import { useApp } from './useApp';

/** The account (login with Discord) and the sync of decks and collection with it. See docs/accounts.md. */

interface AccountState {
  /** The server has accounts (database and Discord configured). */
  enabled: boolean;
  user: AccountUser | null;
  status: SyncStatus | null;
  /** Result of a login that didn't succeed, read from ?login= after Discord sends the user back. */
  loginResult: 'cancelled' | 'failed' | null;
}

export const useAccount = create<AccountState>()(() => ({ enabled: false, user: null, status: null, loginResult: null }));

const META_KEY = 'magic-trainer-sync';

const sync = createSync({
  api: accountApi,
  store: useApp,
  loadMeta: () => {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as SyncMeta | null;
    } catch {
      return null;
    }
  },
  saveMeta: (meta) => {
    try {
      if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
      else localStorage.removeItem(META_KEY);
    } catch {
      // Storage full or blocked: the next start sends everything again, which is harmless.
    }
  },
  copyName: (name) => messagesFor(useLang.getState().lang).account.copyName(name),
  newId: () => crypto.randomUUID(),
  onStatus: (status) => useAccount.setState({ status }),
  onLoggedOut: () => useAccount.setState({ user: null, status: null }),
});

let started = false;

/** Once at startup: who is logged in, then sync. */
export async function initAccount(): Promise<void> {
  if (started) return;
  started = true;
  const params = new URLSearchParams(location.search);
  const login = params.get('login');
  if (login === 'cancelled' || login === 'failed') {
    useAccount.setState({ loginResult: login });
    params.delete('login');
    const query = params.toString();
    history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  }
  try {
    const { enabled, user } = await accountApi.me();
    useAccount.setState({ enabled, user });
    if (user) void sync.start(user.id);
  } catch {
    // No server (static hosting, offline): no accounts.
    return;
  }
  // Other devices' changes when coming back to the tab; pending changes when the network is back.
  window.addEventListener('online', () => void sync.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync.sync();
  });
}

export function syncNow(): Promise<void> {
  return sync.sync();
}

/** Logs out; `removeLocal` also clears the decks and collection from this browser (they stay in the account). */
export async function logout(removeLocal: boolean): Promise<void> {
  await sync.flush().catch(() => {});
  await accountApi.logout().catch(() => {});
  sync.forget();
  if (removeLocal) useApp.setState({ decks: [], collection: {} });
  useAccount.setState({ user: null, status: null });
}

/** Deletes the account and everything saved in it; this browser's copies stay. */
export async function deleteAccount(): Promise<void> {
  await accountApi.deleteAccount();
  sync.forget();
  useAccount.setState({ user: null, status: null });
}
