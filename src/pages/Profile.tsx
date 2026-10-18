import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { syncStatusText } from '../components/AccountMenu';
import { deckSummary, Pips } from '../components/DeckBits';
import { CopyButton } from '../components/SharePanel';
import { useT } from '../i18n';
import { loginUrl } from '../lib/account/api';
import { shareUrl, useShares } from '../lib/account/shares';
import { listResults, summarize, syncResults, winRate, type MatchResult } from '../lib/history';
import { deleteAccount, logout, syncNow, useAccount } from '../store/useAccount';
import { useApp } from '../store/useApp';

/** /profile: the account, its statistics, its decks (shared or not) and the account settings. Private. */
export function Profile() {
  const t = useT();
  const { enabled, user, status } = useAccount();
  const decks = useApp((s) => s.decks);
  const { shares, share, unshare, error } = useShares();
  const [results, setResults] = useState<MatchResult[]>(listResults);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    syncResults().then((all) => live && setResults(all), () => {});
    return () => {
      live = false;
    };
  }, [user]);

  const stats = useMemo(() => summarize(results), [results]);
  const bot = results.filter((r) => r.kind === 'bot').length;
  // The best deck: the highest win rate over 3 matches or more, else the most played.
  const best = [...stats.decks.filter((d) => d.matches >= 3)].sort((a, b) => (winRate(b) ?? 0) - (winRate(a) ?? 0))[0] ?? stats.decks[0];
  const sorted = [...decks].sort((a, b) => b.updatedAt - a.updatedAt);
  const state = status?.state ?? 'syncing';

  const run = async (deckId: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(deckId);
    await fn(deckId);
    setBusy(null);
  };

  return (
    <div className="page profile">
      {user ? (
        <header className="profile-head">
          {user.avatarUrl ? <img className="profile-avatar" src={user.avatarUrl} alt="" width={72} height={72} /> : <span className="profile-avatar avatar-letter">{user.name.slice(0, 1)}</span>}
          <div>
            <h1>{user.name}</h1>
            <div className="muted small">
              {t.profile.discord}
              {user.createdAt ? ` · ${t.profile.since(new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}` : ''}
            </div>
            <div className={`account-status ${state} small`}>
              <span className={`sync-dot inline ${state}`} /> {syncStatusText(t, status)}
              <button type="button" className="secondary small" onClick={() => void syncNow()} disabled={state === 'syncing'}>{t.account.syncNow}</button>
            </div>
          </div>
        </header>
      ) : (
        <>
          <h1>{t.profile.title}</h1>
          {enabled && (
            <div className="banner">
              {t.profile.loggedOut}
              <a className="button discord-login" href={loginUrl()}>{t.account.login}</a>
            </div>
          )}
        </>
      )}

      <section>
        <h2>{t.profile.stats}</h2>
        {results.length === 0 ? (
          <p className="muted small">{t.history.empty}</p>
        ) : (
          <>
            <div className="profile-stats">
              <div className="panel tally-card"><strong className="tally-rate">{stats.total.matches}</strong><span className="muted small">{t.profile.matches}</span></div>
              <div className="panel tally-card"><strong className="tally-rate">{winRate(stats.total)} %</strong><span className="muted small">{t.profile.winRate}</span></div>
              <div className="panel tally-card"><strong className="tally-rate">{bot} · {results.length - bot}</strong><span className="muted small">{t.profile.botOnline}</span></div>
              {best && (
                <div className="panel tally-card">
                  <strong className="tally-rate profile-best">{best.name || '?'}</strong>
                  <span className="muted small">{t.profile.bestDeck(winRate(best) ?? 0)}</span>
                </div>
              )}
            </div>
            <p className="small profile-last">
              {t.profile.last}
              {results.slice(0, 5).map((r) => <span key={r.id} className={`result-badge ${r.result}`}>{t.history.results[r.result]}</span>)}
              <Link to="/history">{t.profile.fullHistory}</Link>
            </p>
          </>
        )}
      </section>

      <section>
        <h2>{t.profile.decks(decks.length)}</h2>
        {error && <div className="error small">{error === 'notSaved' ? t.share.notSaved : error === 'load' ? t.share.loadFailed : t.share.failed}</div>}
        {sorted.length === 0 ? (
          <p className="muted small">{t.profile.noDecks} <Link to="/decks">{t.nav.decks}</Link></p>
        ) : (
          <ul className="plain-list profile-decks">
            {sorted.map((d) => {
              const shareId = shares.get(d.id);
              return (
                <li key={d.id}>
                  <Link to={`/decks/${d.id}`} className="profile-deck-name">{d.name}</Link>
                  <Pips colors={deckSummary(d).colors} />
                  <span className="small muted">{t.formats[d.format] ?? d.format} · {deckSummary(d).total}</span>
                  <span className="spacer" />
                  {user && (shareId ? (
                    <>
                      <span className="chip ok small">🔗 {t.share.shared}</span>
                      <CopyButton text={shareUrl(shareId)} className="secondary small" label={t.share.copyLink} />
                      <button type="button" className="secondary small" disabled={busy === d.id} onClick={() => run(d.id, unshare)}>{t.share.stop}</button>
                    </>
                  ) : (
                    <button type="button" className="secondary small" disabled={busy === d.id} onClick={() => run(d.id, share)}>{t.share.button}</button>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {user && (
        <section>
          <h2>{t.profile.account}</h2>
          <div className="row">
            <button type="button" className="secondary" onClick={() => void logout(confirm(t.account.confirmRemoveLocal))}>{t.account.logout}</button>
            <span className="spacer" />
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (!confirm(t.account.confirmDelete)) return;
                deleteAccount().catch(() => alert(t.account.deleteFailed));
              }}
            >
              {t.account.deleteAccount}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
