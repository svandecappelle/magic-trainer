import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../../store/useAccount';
import { packReplay, type ReplayFile } from '../replay';
import { accountApi, ApiError, type ReplayShare } from './api';

/** The address of a shared replay's page. */
export const replayShareUrl = (shareId: string) => `${location.origin}/replay/${shareId}`;

/**
 * The logged-in user's shared replays (replay id → share), and sharing or stopping. Sharing sends the replay to the
 * account: the link works from any device, and keeps working if the browser's copy is deleted.
 */
export function useReplayShares() {
  const loggedIn = useAccount((s) => !!s.user);
  const [shares, setShares] = useState<Map<string, ReplayShare>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return setShares(new Map());
    let live = true;
    accountApi.replayShares().then(
      ({ shares: list }) => live && setShares(new Map(list.map((s) => [s.replayId, s]))),
      () => live && setError('load'),
    );
    return () => {
      live = false;
    };
  }, [loggedIn]);

  const share = useCallback(async (file: ReplayFile) => {
    setError(null);
    try {
      const shared = await accountApi.shareReplay(packReplay(file));
      setShares((m) => new Map(m).set(shared.replayId, shared));
      return shared;
    } catch (e) {
      setError(e instanceof ApiError && (e.code === 'tooManyReplays' || e.code === 'tooLarge') ? e.code : 'failed');
      return null;
    }
  }, []);

  const unshare = useCallback(async (replayId: string) => {
    setError(null);
    const shareId = shares.get(replayId)?.shareId;
    if (!shareId) return;
    try {
      await accountApi.unshareReplay(shareId);
      setShares((m) => {
        const next = new Map(m);
        next.delete(replayId);
        return next;
      });
    } catch {
      setError('failed');
    }
  }, [shares]);

  return { loggedIn, shares, share, unshare, error };
}
