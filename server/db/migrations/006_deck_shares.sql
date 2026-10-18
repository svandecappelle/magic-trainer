-- Shared decks (server/decks.ts): a deck with a share_id can be read by anyone at /shared/<share_id>, read-only. The
-- owner turns sharing on and off; a deleted deck's link stops working.
ALTER TABLE decks ADD COLUMN share_id text UNIQUE CHECK (share_id ~ '^[A-Za-z0-9_-]{8,32}$');
