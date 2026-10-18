import { useState } from 'react';
import { useT } from '../i18n';
import { loginUrl } from '../lib/account/api';
import { replayShareUrl, useReplayShares } from '../lib/account/replayShares';
import { shareUrl, useShares } from '../lib/account/shares';
import type { ReplayFile } from '../lib/replay';
import { useAccount } from '../store/useAccount';

/** "Copy": the text to the clipboard, with a moment of "Copied". */
export function CopyButton({ text, className = 'secondary', label }: { text: string; className?: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? t.share.copied : (label ?? t.share.copy)}
    </button>
  );
}

/** The deck editor's "Share": a read-only link to the deck for anyone, or how to get one. */
export function SharePanel({ deckId, deckName, onClose }: { deckId: string; deckName: string; onClose: () => void }) {
  const t = useT();
  const enabled = useAccount((s) => s.enabled);
  const { loggedIn, shares, share, unshare, error } = useShares();
  const [busy, setBusy] = useState(false);
  const shareId = shares.get(deckId);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <div className="panel share-panel">
      <h3>{t.share.title(deckName)}</h3>
      {!enabled ? (
        <p className="muted small">{t.share.noAccounts}</p>
      ) : !loggedIn ? (
        <p className="small">
          {t.share.loginFirst} <a href={loginUrl()}>{t.account.login}</a>
        </p>
      ) : shareId ? (
        <>
          <p className="small">{t.share.anyone}</p>
          <div className="share-link">
            <input readOnly value={shareUrl(shareId)} onFocus={(e) => e.target.select()} aria-label={t.share.link} />
            <CopyButton text={shareUrl(shareId)} className="" />
          </div>
          <p className="muted small">{t.share.latest}</p>
        </>
      ) : (
        <p className="small">{t.share.explain}</p>
      )}
      {error && <div className="error small">{error === 'notSaved' ? t.share.notSaved : t.share.failed}</div>}
      <div className="row">
        {loggedIn && !shareId && <button type="button" disabled={busy} onClick={() => run(() => share(deckId))}>{t.share.create}</button>}
        {loggedIn && shareId && <button type="button" className="secondary" disabled={busy} onClick={() => run(() => unshare(deckId))}>{t.share.stop}</button>}
        <span className="spacer" />
        <button type="button" className="secondary" onClick={onClose}>{t.share.close}</button>
      </div>
    </div>
  );
}

/** The replay viewer's "Share": a link anyone can watch the game with, or how to get one. */
export function ReplaySharePanel({ file, onClose }: { file: ReplayFile; onClose: () => void }) {
  const t = useT();
  const enabled = useAccount((s) => s.enabled);
  const { loggedIn, shares, share, unshare, error } = useReplayShares();
  const [busy, setBusy] = useState(false);
  const shareId = shares.get(file.id)?.shareId;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <div className="panel share-panel">
      <h3>{t.replayShare.title}</h3>
      {!enabled ? (
        <p className="muted small">{t.share.noAccounts}</p>
      ) : !loggedIn ? (
        <p className="small">
          {t.replayShare.loginFirst} <a href={loginUrl()}>{t.account.login}</a>
        </p>
      ) : shareId ? (
        <>
          <p className="small">{t.replayShare.anyone}</p>
          <div className="share-link">
            <input readOnly value={replayShareUrl(shareId)} onFocus={(e) => e.target.select()} aria-label={t.replayShare.link} />
            <CopyButton text={replayShareUrl(shareId)} className="" />
          </div>
        </>
      ) : (
        <p className="small">{t.replayShare.explain}</p>
      )}
      {loggedIn && !shareId && <p className="muted small">{t.replayShare.hidden}</p>}
      {error && <div className="error small">{error === 'tooManyReplays' ? t.replayShare.tooMany : error === 'tooLarge' ? t.replayShare.tooLarge : t.share.failed}</div>}
      <div className="row">
        {loggedIn && !shareId && <button type="button" disabled={busy} onClick={() => run(() => share(file))}>{t.share.create}</button>}
        {loggedIn && shareId && <button type="button" className="secondary" disabled={busy} onClick={() => run(() => unshare(file.id))}>{t.share.stop}</button>}
        <span className="spacer" />
        <button type="button" className="secondary" onClick={onClose}>{t.share.close}</button>
      </div>
    </div>
  );
}
