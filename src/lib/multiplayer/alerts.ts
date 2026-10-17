import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Telling a player who is looking at another tab that the game needs them: the tab's title changes, and a system
 * notification is shown when they turned notifications on (saved in this browser).
 */

const PREF_KEY = 'mt.notify';
const supported = () => typeof window !== 'undefined' && 'Notification' in window;

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1' && supported() && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** Notifications on or off; turning them on asks the browser's permission. `available`: the browser has them. */
export function useNotifyPref() {
  const [on, setOn] = useState(readPref);
  const toggle = useCallback(async () => {
    let next = !on;
    if (next && supported() && Notification.permission !== 'granted') next = (await Notification.requestPermission()) === 'granted';
    try {
      localStorage.setItem(PREF_KEY, next ? '1' : '0');
    } catch {
      // not essential
    }
    setOn(next);
  }, [on]);
  return { on, toggle, available: supported() };
}

/** The page's own title, to put back once the player is back on the tab. */
let baseTitle: string | null = null;

function restoreTitle() {
  if (baseTitle !== null) document.title = baseTitle;
  baseTitle = null;
}

/** Calls the player back: title of the tab, and a notification when they are on. Nothing when the tab is visible. */
export function callBack(text: string, notify: boolean) {
  if (typeof document === 'undefined' || !document.hidden) return;
  baseTitle ??= document.title;
  document.title = `● ${text} · ${baseTitle}`;
  if (notify && supported() && Notification.permission === 'granted') {
    try {
      const n = new Notification(text, { tag: 'magic-trainer' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some browsers only allow notifications from a service worker: the title is enough.
    }
  }
}

/**
 * Calls the player back when `alert` changes to a new text (e.g. "Your turn"), not again while it stays the same.
 * The title comes back when the tab is shown again.
 */
export function useCallBack(alert: string | null, notify: boolean) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (alert && alert !== last.current) callBack(alert, notify);
    last.current = alert;
  }, [alert, notify]);
  useEffect(() => {
    const onShow = () => {
      if (!document.hidden) restoreTitle();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      restoreTitle();
    };
  }, []);
}
