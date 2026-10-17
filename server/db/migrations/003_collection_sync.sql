-- A card removed from a collection stays as a row with 0 and 0 (a tombstone) so that GET /api/collection?since=…
-- tells the other devices; tombstones are purged after 90 days. updated_at is the server time of the change.
ALTER TABLE collection_cards DROP CONSTRAINT collection_cards_check;
CREATE INDEX collection_cards_sync_idx ON collection_cards (user_id, updated_at);
