-- Accounts (Discord login), sessions, Scryfall card cache, decks and collections. See docs/accounts.md.
CREATE TYPE deck_board AS ENUM ('main', 'side', 'commander');

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 64),
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  provider         text        NOT NULL CHECK (provider IN ('discord')),
  provider_user_id text        NOT NULL,
  username         text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX identities_user_idx ON identities (user_id);

CREATE TABLE sessions (
  token_hash   bytea       PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE cards (
  id         uuid        PRIMARY KEY,
  data       jsonb       NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decks (
  id         uuid        PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  format     text        NOT NULL,
  version    integer     NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX decks_user_idx ON decks (user_id, updated_at);

CREATE TABLE deck_cards (
  deck_id uuid       NOT NULL REFERENCES decks ON DELETE CASCADE,
  card_id uuid       NOT NULL REFERENCES cards,
  board   deck_board NOT NULL,
  qty     smallint   NOT NULL CHECK (qty BETWEEN 1 AND 999),
  PRIMARY KEY (deck_id, card_id, board)
);

CREATE TABLE collection_cards (
  user_id    uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  card_id    uuid        NOT NULL REFERENCES cards,
  qty        integer     NOT NULL DEFAULT 0 CHECK (qty >= 0),
  foil_qty   integer     NOT NULL DEFAULT 0 CHECK (foil_qty >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id),
  CHECK (qty + foil_qty > 0)
);
