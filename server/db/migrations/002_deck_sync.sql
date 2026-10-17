-- Server time of the last change of each deck (edit or deletion), for GET /api/decks?since=…: the client's
-- updated_at can't be used for that, device clocks differ.
ALTER TABLE decks ADD COLUMN synced_at timestamptz NOT NULL DEFAULT now();
DROP INDEX decks_user_idx;
CREATE INDEX decks_user_sync_idx ON decks (user_id, synced_at);
