import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT } from '../i18n';
import { accountApi, type AdminOverview, type AdminRoom, type AdminShare, type AdminSystem, type AdminUser } from '../lib/account/api';
import { shareUrl } from '../lib/account/shares';
import { replayShareUrl } from '../lib/account/replayShares';
import { useAccount } from '../store/useAccount';

const TABS = ['overview', 'users', 'games', 'shared', 'system'] as const;
type Tab = (typeof TABS)[number];

/** /admin/<tab>: the administration page, for administrators only (ADMIN_DISCORD_IDS on the server). */
export function Admin() {
  const t = useT();
  const navigate = useNavigate();
  const { tab: raw } = useParams();
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';
  const user = useAccount((s) => s.user);

  if (!user?.admin) {
    return (
      <div className="page">
        <h1>{t.admin.title}</h1>
        <div className="banner">{t.admin.forbidden} <Link to="/">{t.admin.home}</Link></div>
      </div>
    );
  }
  return (
    <div className="page admin">
      <h1>{t.admin.title} <span className="chip small">🛡 {t.admin.badge}</span></h1>
      <nav className="admin-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'active' : 'secondary'} onClick={() => navigate(x === 'overview' ? '/admin' : `/admin/${x}`)}>
            {t.admin.tabs[x]}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'games' && <Games />}
      {tab === 'shared' && <Shared />}
      {tab === 'system' && <SystemTab />}
    </div>
  );
}

/** Loads something for a tab, with an error state and a way to load again. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(() => load().then((d) => (setData(d), setError(false)), () => setError(true)), deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

const ago = (t: ReturnType<typeof useT>, ms: number | null) => {
  if (ms === null) return '–';
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 2) return t.admin.now;
  if (min < 60) return t.admin.minutesAgo(min);
  if (min < 48 * 60) return t.admin.hoursAgo(Math.round(min / 60));
  return new Date(ms).toLocaleDateString();
};

function Overview() {
  const t = useT();
  const { data, error } = useLoad(() => accountApi.admin.overview(), []);
  if (error) return <p className="error small">{t.admin.failed}</p>;
  if (!data) return <p className="muted">{t.admin.loading}</p>;
  const o: AdminOverview = data;
  const max = Math.max(1, ...o.perDay.map((d) => d.bot + d.online));
  return (
    <>
      <div className="profile-stats">
        <Stat value={o.users} label={t.admin.users} sub={t.admin.newThisWeek(o.newThisWeek)} />
        <Stat value={o.activeToday} label={t.admin.activeToday} sub={t.admin.active7d(o.active7d)} />
        <Stat value={o.online.players} label={t.admin.onlineNow} sub={t.admin.rooms(o.online.rooms)} />
        <Stat value={o.matches7d} label={t.admin.matches7d} sub={o.botShare === null ? '' : t.admin.botShare(o.botShare)} />
      </div>
      <div className="admin-columns">
        <section className="panel">
          <h3>{t.admin.perDay}</h3>
          <div className="admin-chart" role="img" aria-label={t.admin.perDay}>
            {o.perDay.map((d) => (
              <div key={d.day} className="admin-bar" title={`${d.day}: ${d.bot} ${t.admin.bot} · ${d.online} ${t.admin.online}`}>
                <span className="online" style={{ height: `${(100 * d.online) / max}%` }} />
                <span className="bot" style={{ height: `${(100 * d.bot) / max}%` }} />
              </div>
            ))}
          </div>
          <p className="small muted"><span className="admin-key bot" /> {t.admin.bot} <span className="admin-key online" /> {t.admin.online}</p>
        </section>
        <section className="panel">
          <h3>{t.admin.storage}</h3>
          <dl className="admin-facts">
            <dt>{t.admin.decks}</dt><dd>{o.storage.decks} ({t.admin.shared(o.storage.sharedDecks)})</dd>
            <dt>{t.admin.sharedReplays}</dt><dd>{o.storage.sharedReplays}</dd>
            <dt>{t.admin.cardCache}</dt><dd>{o.storage.cards}</dd>
            <dt>{t.admin.sessions}</dt><dd>{o.sessions}</dd>
          </dl>
          <h3>{t.admin.recentSignups}</h3>
          <ul className="plain-list admin-list">
            {o.recentSignups.map((u) => <li key={`${u.name}${u.createdAt}`}><Avatar name={u.name} url={u.avatarUrl} /> {u.name} <span className="muted small">{ago(t, u.createdAt)}</span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}

function Stat({ value, label, sub }: { value: number; label: string; sub: string }) {
  return (
    <div className="panel tally-card">
      <span className="muted small">{label}</span>
      <strong className="tally-rate">{value}</strong>
      <span className="small muted">{sub}</span>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  return url ? <img className="admin-avatar" src={url} alt="" width={24} height={24} /> : <span className="admin-avatar avatar-letter">{name.slice(0, 1)}</span>;
}

function Users() {
  const t = useT();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'seen' | 'joined'>('seen');
  const { data, error, reload } = useLoad(() => accountApi.admin.users(q, sort), [q, sort]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (u: AdminUser, what: 'signout' | 'unshare' | 'delete') => {
    if (what === 'delete' && !confirm(t.admin.confirmDelete(u.name))) return;
    setBusy(u.id);
    setNotice(null);
    try {
      if (what === 'signout') setNotice(t.admin.signedOut(u.name, (await accountApi.admin.signOut(u.id)).count));
      else if (what === 'unshare') setNotice(t.admin.unshared(u.name, (await accountApi.admin.unshare(u.id)).count));
      else {
        await accountApi.admin.deleteUser(u.id);
        setNotice(t.admin.deleted(u.name));
      }
      await reload();
    } catch {
      setNotice(t.admin.failed);
    }
    setBusy(null);
  };

  return (
    <section>
      <div className="row admin-toolbar">
        <input type="search" placeholder={t.admin.searchUsers} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.admin.searchUsers} />
        <label className="small">{t.admin.sort}{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as 'seen' | 'joined')}>
            <option value="seen">{t.admin.sortSeen}</option>
            <option value="joined">{t.admin.sortJoined}</option>
          </select>
        </label>
        <span className="spacer" />
        {data && <span className="muted small">{t.admin.userCount(data.total)}</span>}
      </div>
      {notice && <p className="small">{notice}</p>}
      {error && <p className="error small">{t.admin.failed}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>{t.admin.user}</th><th>Discord</th><th>{t.admin.joined}</th><th>{t.admin.lastSeen}</th><th>{t.admin.decks}</th><th>{t.admin.matches}</th><th /></tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.id}>
                <td><Avatar name={u.name} url={u.avatarUrl} /> {u.name} {u.admin && <span title={t.admin.badge}>🛡</span>}</td>
                <td className="muted" data-label="Discord">{u.discord ?? '–'}</td>
                <td data-label={t.admin.joined}>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td data-label={t.admin.lastSeen}>{ago(t, u.lastSeen)}</td>
                <td data-label={t.admin.decks}>{u.decks}</td>
                <td data-label={t.admin.matches}>{u.matches}</td>
                <td>
                  {!u.admin && (
                    <div className="admin-actions">
                      <button type="button" className="secondary small" disabled={busy === u.id || !u.sessions} onClick={() => void act(u, 'signout')}>{t.admin.signOut}</button>
                      <button type="button" className="secondary small" disabled={busy === u.id || !u.shares} onClick={() => void act(u, 'unshare')}>{t.admin.stopShares}</button>
                      <button type="button" className="danger small" disabled={busy === u.id} onClick={() => void act(u, 'delete')}>{t.admin.delete}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Games() {
  const t = useT();
  const { data, error, reload } = useLoad(() => accountApi.admin.rooms(), []);
  // The clocks and the list stay fresh while the tab is open.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]);
  const close = async (r: AdminRoom) => {
    if (!confirm(t.admin.confirmClose(r.code))) return;
    await accountApi.admin.closeRoom(r.code).catch(() => {});
    await reload();
  };
  if (error) return <p className="error small">{t.admin.failed}</p>;
  if (!data) return <p className="muted">{t.admin.loading}</p>;
  if (!data.rooms.length) return <p className="muted">{t.admin.noGames}</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>{t.admin.room}</th><th>{t.admin.players}</th><th>{t.admin.mode}</th><th>{t.admin.turn}</th><th>{t.admin.clock}</th><th>{t.admin.started}</th><th /></tr>
        </thead>
        <tbody>
          {data.rooms.map((r) => (
            <tr key={r.id}>
              <td><code>{r.code}</code></td>
              <td>{r.players.map((p, i) => <span key={i} className={p.connected ? '' : 'muted'}>{i ? ' · ' : ''}{p.name}{p.connected ? '' : ' ⏸'}</span>)}{r.players.length < r.size && <span className="muted"> · {t.admin.waiting}</span>}</td>
              <td data-label={t.admin.mode}>{t.admin.modeOf(r.mode, r.size === 4, r.bestOf)}{r.bestOf === 3 && ` (${r.score.join('–')})`}</td>
              <td data-label={t.admin.turn}>{r.turn ?? '–'}</td>
              <td data-label={t.admin.clock}>{r.clock ? `${Math.max(0, Math.round((r.clock.endsAt - Date.now()) / 1000))} s · ${r.clock.player}${r.clock.kind === 'reconnect' ? ` ${t.admin.reconnecting}` : ''}` : '–'}</td>
              <td data-label={t.admin.started}>{ago(t, r.createdAt)}</td>
              <td>
                <div className="admin-actions">
                  <Link className="button secondary small" to={`/online/${r.id}`}>{t.admin.watch}{r.watchers ? ` (${r.watchers})` : ''}</Link>
                  <button type="button" className="danger small" onClick={() => void close(r)}>{t.admin.close}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Shared() {
  const t = useT();
  const [kind, setKind] = useState<'decks' | 'replays'>('decks');
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad(() => accountApi.admin.shares(kind, q), [kind, q]);
  const stop = async (s: AdminShare) => {
    if (!confirm(t.admin.confirmStop(s.title))) return;
    await accountApi.admin.stopShare(s.kind, s.shareId).catch(() => {});
    await reload();
  };
  return (
    <section>
      <div className="row admin-toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value as 'decks' | 'replays')} aria-label={t.admin.kind}>
          <option value="decks">{t.admin.sharedDecks}</option>
          <option value="replays">{t.admin.sharedReplays}</option>
        </select>
        <input type="search" placeholder={t.admin.searchShares} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.admin.searchShares} />
      </div>
      {error && <p className="error small">{t.admin.failed}</p>}
      {data && !data.shares.length && <p className="muted">{t.admin.noShares}</p>}
      <ul className="plain-list profile-decks">
        {(data?.shares ?? []).map((s) => (
          <li key={s.shareId}>
            <span className="profile-deck-name">{s.title}</span>
            <span className="small muted">{s.owner} · {new Date(s.at).toLocaleDateString()}</span>
            <span className="spacer" />
            <a className="button secondary small" href={s.kind === 'deck' ? shareUrl(s.shareId) : replayShareUrl(s.shareId)} target="_blank" rel="noreferrer">{t.admin.open}</a>
            <button type="button" className="danger small" onClick={() => void stop(s)}>{t.admin.stopSharing}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SystemTab() {
  const t = useT();
  const { data, error } = useLoad(() => accountApi.admin.system(), []);
  const [done, setDone] = useState<string | null>(null);
  const run = async (task: 'sessions' | 'tombstones') => {
    setDone(null);
    try {
      const { count } = await accountApi.admin.maintenance(task);
      setDone(t.admin.purged(count));
    } catch {
      setDone(t.admin.failed);
    }
  };
  if (error) return <p className="error small">{t.admin.failed}</p>;
  if (!data) return <p className="muted">{t.admin.loading}</p>;
  const s: AdminSystem = data;
  const hours = Math.floor((Date.now() - s.startedAt) / 3_600_000);
  return (
    <>
      <section className="panel">
        <dl className="admin-facts">
          <dt>{t.admin.version}</dt><dd><code>{s.version}</code></dd>
          <dt>{t.admin.uptime}</dt><dd>{t.admin.uptimeOf(Math.floor(hours / 24), hours % 24)}</dd>
          <dt>{t.admin.database}</dt><dd>✓ {t.admin.migrationsOf(s.migrations.length, s.migrations.at(-1) ?? '–')}</dd>
          <dt>{t.admin.accounts}</dt><dd>{s.accounts ? `✓ Discord · ${t.admin.adminCount(s.admins)}` : '✗'}</dd>
          <dt>{t.admin.cardCheck}</dt><dd>{s.cardCheck}</dd>
          <dt>{t.admin.clocks}</dt><dd>{t.admin.clocksOf(s.turnSeconds, s.reconnectSeconds)}</dd>
        </dl>
      </section>
      <section className="panel">
        <h3>{t.admin.maintenance}</h3>
        <p className="small muted">{t.admin.maintenanceHint}</p>
        <div className="row">
          <button type="button" className="secondary" onClick={() => void run('sessions')}>{t.admin.purgeSessions}</button>
          <button type="button" className="secondary" onClick={() => void run('tombstones')}>{t.admin.purgeTombstones}</button>
        </div>
        {done && <p className="small">{done}</p>}
      </section>
    </>
  );
}
