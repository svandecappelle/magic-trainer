import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReplayViewer } from '../components/ReplayViewer';
import { useT } from '../i18n';
import { accountApi, type SharedReplay as Shared } from '../lib/account/api';
import { ReplayFileError, unpackReplay, type ReplayFile } from '../lib/replay';

type Loaded = { file: ReplayFile; owner: Shared['owner'] } | 'missing' | 'otherVersion' | 'error' | null;

/** /replay/<shareId>: a game someone shared, to watch (and save or download). */
export function SharedReplay() {
  const t = useT();
  const { shareId = '' } = useParams();
  const [shared, setShared] = useState<Loaded>(null);

  useEffect(() => {
    let live = true;
    setShared(null);
    accountApi.sharedReplay(shareId).then(
      ({ data, owner }) => {
        if (!live) return;
        try {
          setShared({ file: unpackReplay(data), owner });
        } catch (e) {
          setShared(e instanceof ReplayFileError && e.code === 'otherVersion' ? 'otherVersion' : 'error');
        }
      },
      (e) => live && setShared(e?.status === 404 ? 'missing' : 'error'),
    );
    return () => {
      live = false;
    };
  }, [shareId]);

  if (shared === null) return <div className="page"><p className="muted">{t.replayShare.loading}</p></div>;
  if (typeof shared === 'string') {
    return (
      <div className="page">
        <h1>{t.replayShare.sharedReplay}</h1>
        <div className="banner">
          {shared === 'missing' ? t.replayShare.missing : shared === 'otherVersion' ? t.history.otherVersion : t.replayShare.loadFailed}
          <Link to="/">{t.replayShare.home}</Link>
        </div>
      </div>
    );
  }
  return <ReplayViewer key={shareId} file={shared.file} owner={shared.owner} />;
}
