-- Shared game replays (server/replays.ts): a replay its owner sent, readable by anyone at /replay/<share_id>. The data
-- is the replay file (src/lib/replay.ts packReplay), gzipped. One share per replay (replay_id is the file's id).
CREATE TABLE replay_shares (
  share_id   text        PRIMARY KEY CHECK (share_id ~ '^[A-Za-z0-9_-]{8,32}$'),
  user_id    uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  replay_id  text        NOT NULL CHECK (length(replay_id) <= 100),
  title      text        NOT NULL CHECK (length(title) <= 200),
  played_at  timestamptz NOT NULL,
  data       bytea       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, replay_id)
);
CREATE INDEX replay_shares_user_idx ON replay_shares (user_id, created_at DESC);
