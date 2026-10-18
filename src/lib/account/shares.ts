import { useCallback, useEffect, useState } from 'react';
import { syncNow, useAccount } from '../../store/useAccount';
import { accountApi, ApiError } from './api';

/** The address of a shared deck's page. */
export const shareUrl = (shareId: string) => `${location.origin}/shared/${shareId}`;

/**
 * The logged-in user's shared decks (deck id → share id), and sharing or stopping. A deck must be saved in the
 * account to be shared: a new one is sent first (sync) when the server doesn't know it yet.
 */
export function useShares() {
  const loggedIn = useAccount((s) => !!s.user);
  const [shares, setShares] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return setShares(new Map());
    let live = true;
    accountApi.shares().then(
      ({ shares: list }) => live && setShares(new Map(list.map((s) => [s.deckId, s.shareId]))),
      () => live && setError('load'),
    );
    return () => {
      live = false;
    };
  }, [loggedIn]);

  const share = useCallback(async (deckId: string) => {
    setError(null);
    try {
      let shared;
      try {
        shared = await accountApi.share(deckId);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        await syncNow();
        shared = await accountApi.share(deckId);
      }
      setShares((m) => new Map(m).set(deckId, shared.shareId));
      return shared.shareId;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'notSaved' : 'failed');
      return null;
    }
  }, []);

  const unshare = useCallback(async (deckId: string) => {
    setError(null);
    try {
      await accountApi.unshare(deckId);
      setShares((m) => {
        const next = new Map(m);
        next.delete(deckId);
        return next;
      });
    } catch {
      setError('failed');
    }
  }, []);

  return { loggedIn, shares, share, unshare, error };
}
