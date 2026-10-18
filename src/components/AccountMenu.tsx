import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import type { Messages } from '../i18n/en';
import type { SyncStatus } from '../lib/account/sync';
import { loginUrl } from '../lib/account/api';
import { deleteAccount, logout, syncNow, useAccount } from '../store/useAccount';

/** The account in the top bar: "Log in with Discord", or the avatar with a menu (sync status, log out, delete). */
export function AccountMenu() {
  const t = useT();
  const { enabled, user, status } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!enabled) return null;
  if (!user) {
    return (
      <a className="button discord-login" href={loginUrl()} title={t.account.loginHint}>
        <span className="long">{t.account.login}</span>
        <span className="short">{t.account.loginShort}</span>
      </a>
    );
  }

  const state = status?.state ?? 'syncing';
  const statusText = syncStatusText(t, status);

  return (
    <div className="account" ref={ref}>
      <button type="button" className="account-button" aria-haspopup="menu" aria-expanded={open} aria-label={t.account.menu} onClick={() => setOpen(!open)}>
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" width={28} height={28} /> : <span className="avatar-letter">{user.name.slice(0, 1)}</span>}
        <span className={`sync-dot ${state}`} title={statusText} />
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-name">{user.name}</div>
          <div className={`account-status ${state}`}>{statusText}</div>
          <Link to="/profile" role="menuitem" className="account-link" onClick={() => setOpen(false)}>{t.profile.title}</Link>
          <button type="button" role="menuitem" onClick={() => void syncNow()} disabled={state === 'syncing'}>{t.account.syncNow}</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); void logout(confirm(t.account.confirmRemoveLocal)); }}>{t.account.logout}</button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              if (!confirm(t.account.confirmDelete)) return;
              setOpen(false);
              deleteAccount().catch(() => alert(t.account.deleteFailed));
            }}
          >
            {t.account.deleteAccount}
          </button>
        </div>
      )}
    </div>
  );
}

/** The sync state in words (the account menu, the profile page). */
export function syncStatusText(t: Messages, status: SyncStatus | null): string {
  const state = status?.state ?? 'syncing';
  return state === 'syncing' ? t.account.status.syncing
    : state === 'synced' ? t.account.status.synced
    : state === 'offline' ? t.account.status.offline
    : status?.rejected.length ? t.account.status.rejected(status.rejected)
    : t.account.status.error(status?.error ?? '?');
}

/** After Discord sends the user back without logging in. */
export function LoginNotice() {
  const t = useT();
  const result = useAccount((s) => s.loginResult);
  if (!result) return null;
  return (
    <div className="login-notice" role="status">
      {result === 'cancelled' ? t.account.loginCancelled : t.account.loginFailed}
      <button type="button" className="icon" onClick={() => useAccount.setState({ loginResult: null })} aria-label={t.account.dismiss}>✕</button>
    </div>
  );
}
