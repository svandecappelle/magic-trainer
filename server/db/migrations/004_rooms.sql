-- Online rooms, saved after each change so a restart of the server (an update) doesn't end the games: the room
-- packed as JSON (server/rooms.ts, src/lib/packState.ts) with the seats' secrets hashed. state_version is the
-- engine's STATE_VERSION: rooms of another version are dropped. Rooms untouched for a day are deleted.
CREATE TABLE rooms (
  id            uuid PRIMARY KEY,
  code          text NOT NULL,
  state_version integer NOT NULL,
  data          text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_updated_idx ON rooms (updated_at);
