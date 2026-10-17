import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReplayViewer } from '../components/ReplayViewer';
import { listResults, summarize, syncResults, winRate, type MatchResult, type Tally } from '../lib/history';
import { deleteReplay, downloadReplay, listReplays, loadReplay, ReplayFileError, saveReplay, unpackReplay } from '../lib/replay';
import { useT } from '../i18n';
import { useAccount } from '../store/useAccount';

/** /history: results of finished matches, with their replays; /history/replay/<id>: a replay. */
export function History() {
  const { replayId } = useParams();
  return replayId ? <Replay id={replayId} /> : <Results />;
}

function Replay({ id }: { id: string }) {
  const t = useT();
  const file = useMemo(() => loadReplay(id), [id]);
  if (!file) {
    return (
      <div className="page">
        <h1>{t.history.title}</h1>
        <div className="banner">
          {t.history.replayMissing}
          <Link to="/history">{t.history.back}</Link>
        </div>
      </div>
    );
  }
  return <ReplayViewer key={id} file={file} />;
}

function Results() {
  const t = useT();
  const navigate = useNavigate();
  const loggedIn = useAccount((s) => !!s.user);
  const [results, setResults] = useState<MatchResult[]>(listResults);
  const [syncError, setSyncError] = useState(false);
  const [replays, setReplays] = useState(listReplays);
  const [importError, setImportError] = useState<string | null>(null);

  // Logged in: the account's results too (other devices, online matches), after sending this browser's.
  useEffect(() => {
    if (!loggedIn) return;
    let live = true;
    syncResults().then(
      (all) => live && (setResults(all), setSyncError(false)),
      () => live && setSyncError(true),
    );
    return () => {
      live = false;
    };
  }, [loggedIn]);

  const stats = useMemo(() => summarize(results), [results]);
  const saved = new Set(replays.map((r) => r.id));

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImportError(null);
    try {
      const file = unpackReplay(await f.text());
      if (!saveReplay(file)) return setImportError(t.history.storageFull);
      setReplays(listReplays());
      navigate(`/history/replay/${file.id}`);
    } catch (err) {
      setImportError(err instanceof ReplayFileError && err.code === 'otherVersion' ? t.history.otherVersion : t.history.notReplay);
    }
  }

  return (
    <div className="page history">
      <h1>{t.history.title}</h1>
      <p className="muted small">{loggedIn ? t.history.hintAccount : t.history.hintLocal}</p>
      {syncError && <div className="error small">{t.history.syncFailed}</div>}

      {results.length === 0 ? (
        <p className="muted">{t.history.empty}</p>
      ) : (
        <>
          <section className="history-totals">
            <TallyCard label={t.history.total} tally={stats.total} />
          </section>
          <div className="history-tables">
            <TallyTable title={t.history.byDeck} rows={stats.decks} />
            <TallyTable title={t.history.byOpponent} rows={stats.opponents} />
          </div>

          <section>
            <h2>{t.history.matches}</h2>
            <ul className="plain-list history-list">
              {results.slice(0, 200).map((r) => (
                <li key={r.id}>
                  <span className={`result-badge ${r.result}`}>{t.history.results[r.result]}</span>
                  <span className="history-what">
                    <span title={t.history.kinds[r.kind]}>{r.kind === 'bot' ? '🤖' : '🌐'}</span>{' '}
                    <strong>{r.deck || '?'}</strong> {t.history.versus} {r.opponent || '?'}
                    {[t.history.mode(r.twoHeaded, r.commander), r.bestOf === 3 ? `${r.wins}–${r.losses}` : ''].filter(Boolean).map((x) => (
                      <span key={x} className="small muted"> · {x}</span>
                    ))}
                  </span>
                  <span className="history-replays">
                    {(r.replays ?? []).filter((id) => saved.has(id)).map((id, i, all) => (
                      <Link key={id} to={`/history/replay/${id}`} className="small">
                        ▶ {all.length > 1 ? t.history.gameN(i + 1) : t.history.replay}
                      </Link>
                    ))}
                  </span>
                  <span className="small muted history-date">{new Date(r.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section>
        <h2>{t.history.replays}</h2>
        <p className="muted small">{t.history.replaysHint}</p>
        <label className="button secondary file-button">
          {t.history.open}
          <input type="file" accept=".json,application/json" onChange={importFile} hidden />
        </label>
        {importError && <div className="error small">{importError}</div>}
        {replays.length > 0 && (
          <ul className="plain-list saved-games">
            {replays.map((r) => (
              <li key={r.id}>
                <Link to={`/history/replay/${r.id}`}>{r.title}</Link>
                <span className="small muted">{new Date(r.at).toLocaleString()}</span>
                <button type="button" className="icon" title={t.history.download} aria-label={t.history.download}
                  onClick={() => { const f = loadReplay(r.id); if (f) downloadReplay(f); }}>⤓</button>
                <button type="button" className="icon" title={t.history.deleteReplay} aria-label={t.history.deleteReplay}
                  onClick={() => { deleteReplay(r.id); setReplays(listReplays()); }}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TallyCard({ label, tally }: { label: string; tally: Tally }) {
  const t = useT();
  const rate = winRate(tally);
  return (
    <div className="panel tally-card">
      <span className="muted small">{label}</span>
      <strong className="tally-rate">{rate === null ? '–' : `${rate} %`}</strong>
      <span className="small">{t.history.record(tally.win, tally.loss, tally.draw)}</span>
    </div>
  );
}

function TallyTable({ title, rows }: { title: string; rows: ({ name: string } & Tally)[] }) {
  const t = useT();
  return (
    <section className="panel">
      <h3>{title}</h3>
      <table className="tally-table">
        <thead>
          <tr>
            <th />
            <th>{t.history.played}</th>
            <th>{t.history.wld}</th>
            <th>{t.history.rate}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 15).map((r) => (
            <tr key={r.name}>
              <td>{r.name || '?'}</td>
              <td>{r.matches}</td>
              <td>{`${r.win}–${r.loss}${r.draw ? `–${r.draw}` : ''}`}</td>
              <td>{winRate(r)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
