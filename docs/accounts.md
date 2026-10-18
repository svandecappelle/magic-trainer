# Accounts and saved decks (design)

Status: implemented (steps 1 to 5 below).

Players can log in with Discord to keep their decks and their collection on the server and find them on any
device. Accounts are optional: without one, the app works exactly as today (everything in the browser's
localStorage).

## Overview

```
Browser ──HTTPS──▶ nginx ──▶ magic-trainer (Node) ──▶ postgres (container, private network)
                                    │
                                    ├─▶ discord.com   (OAuth2: login, user identity)
                                    └─▶ api.scryfall.com (card data, already used by the card check)
```

- **Login**: Discord OAuth2, authorization code flow, run by the server (it holds the client secret). The first
  login creates the account: there is no separate sign-up form, no password and no email.
- **Session**: a random token in an `HttpOnly; Secure; SameSite=Lax` cookie. The database only keeps its SHA-256 hash.
- **Storage**: PostgreSQL in its own container in `docker-compose.yml`, reachable only by the app.
- **Sync**: the zustand store stays the source of truth in the browser. When logged in, every change is sent to
  the server (debounced), and the server's data is merged in at login and on each app start.

## Data model

```mermaid
erDiagram
    users ||--o{ identities : "logs in with"
    users ||--o{ sessions : "has"
    users ||--o{ decks : "owns"
    users ||--o{ collection_cards : "owns"
    decks ||--o{ deck_cards : "contains"
    cards ||--o{ deck_cards : "is"
    cards ||--o{ collection_cards : "is"

    users {
        uuid id PK
        text display_name
        text avatar_url
        timestamptz created_at
        timestamptz last_login_at
    }
    identities {
        uuid id PK
        uuid user_id FK
        text provider "discord"
        text provider_user_id "Discord snowflake"
        text username
        timestamptz created_at
    }
    sessions {
        bytea token_hash PK "sha256(token)"
        uuid user_id FK
        timestamptz created_at
        timestamptz expires_at
        timestamptz last_seen_at
        text user_agent
    }
    cards {
        uuid id PK "Scryfall id"
        jsonb data "Card, as in src/types.ts"
        timestamptz fetched_at
    }
    decks {
        uuid id PK "created by the client"
        uuid user_id FK
        text name
        text format
        integer version
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at "tombstone"
        timestamptz synced_at "server time of the last change"
    }
    deck_cards {
        uuid deck_id PK,FK
        uuid card_id PK,FK
        deck_board board PK
        smallint qty
    }
    collection_cards {
        uuid user_id PK,FK
        uuid card_id PK,FK
        integer qty
        integer foil_qty
        timestamptz updated_at
    }
```

### Choices

- **`identities` apart from `users`**: Discord is the only provider for now, but another one (Google, email link…)
  can be added later without changing `users`. One user may have several identities.
- **`cards` is a shared cache of Scryfall data**: a deck or collection row only stores the card id. Each card is
  stored once for all users, so a 100-card deck costs 100 small rows instead of a few hundred KB of JSON.
  The server fills this table **from Scryfall only** (`fetchCardsById`, as the online card check already does),
  never from data sent by a client, so nobody can alter a card for other players. It also replaces the in-memory
  cache of `server/cards.ts`, so online games don't ask Scryfall again after a restart.
- **`decks.id` is created by the browser** (`crypto.randomUUID()`, as today), so a deck made offline keeps its id
  when it is uploaded. The server refuses an id that already belongs to another user.
- **`deleted_at` (tombstone)**: a deck deleted on one device must not come back from another device's local copy
  during a merge. Tombstones older than 90 days are purged.
- **`version`**: incremented on each update, used to detect that two devices changed the same deck (see Sync).
- **`format`** is free text checked by the API against `FORMATS` (src/types.ts), so adding a format needs no
  migration. **`board`** is a Postgres enum, since it changes with the engine.
- Collection quantities are per printing (`card_id`), like today's `collection` record.

### Schema (first migration)

```sql
-- server/db/migrations/001_accounts.sql
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
  CHECK (qty + foil_qty > 0) -- dropped by 003_collection_sync.sql: 0 and 0 is a removed card (tombstone)
);
```

Migrations are plain SQL files in `server/db/migrations/`, numbered, applied in order at server start by a small
runner that records them in a `schema_migrations (name text PRIMARY KEY, applied_at timestamptz)` table, each in
its own transaction. Driver: [`pg`](https://node-postgres.com/) (node-postgres) with a connection pool.

### Mapping to the client types

| Client (`src/types.ts`)              | Database                                                    |
| ------------------------------------ | ----------------------------------------------------------- |
| `Deck.id`, `name`, `format`          | `decks.id`, `name`, `format`                                |
| `Deck.createdAt`, `updatedAt` (ms)   | `decks.created_at`, `updated_at`                            |
| `DeckEntry { card, qty, board }`     | `deck_cards (card_id, qty, board)` + `cards.data` for `card` |
| `collection[cardId] { card, qty, foilQty }` | `collection_cards (card_id, qty, foil_qty)` + `cards.data` |

## Login with Discord

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server
    participant D as Discord
    B->>S: GET /auth/discord?return=/decks
    S->>B: 302 to discord.com/oauth2/authorize (scope=identify, state)<br/>Set-Cookie oauth_state (10 min)
    B->>D: authorize
    D->>B: 302 to /auth/discord/callback?code&state
    B->>S: GET /auth/discord/callback
    S->>S: check state == oauth_state cookie
    S->>D: POST /api/oauth2/token (code, client secret)
    S->>D: GET /api/users/@me
    S->>S: upsert identity + user, create session
    S->>B: 302 to /decks, Set-Cookie session
```

- Scope `identify` only: Discord id, username, global name, avatar. No email, no guilds.
- `state` is 32 random bytes, kept in a short `HttpOnly` cookie and compared on the callback (blocks forged logins).
  The `return` path is only accepted if it starts with a single `/` (no open redirect).
- On each login, `display_name` (Discord global name, or username) and the avatar are refreshed.
- The Discord access token is used once, then revoked, and never stored: we never call Discord on the user's
  behalf afterwards. `prompt=none` skips Discord's consent page once the user has authorized the app.
- The callback always redirects to the `return` path; on failure it adds `?login=cancelled` (the user refused) or
  `?login=failed` (wrong `state`, Discord error), which the app shows.
- `/auth/discord` and its callback are limited to 30 requests per 10 minutes per address (nginx's `X-Real-IP`).
- Session: 32 random bytes, base64url, cookie `mt_session`, valid 30 days, extended when used during its last
  15 days. Expired sessions are deleted hourly.

## HTTP API

All JSON. Routes under `/api` need a session (401 otherwise), except `/api/me`, `/api/shared/:shareId` and
`/api/shared-replays/:shareId`.

| Method | Path                          | Purpose                                                        |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| GET    | `/auth/discord`               | Starts the login (`?return=` path)                             |
| GET    | `/auth/discord/callback`      | Discord redirect target                                        |
| POST   | `/auth/logout`                | Deletes the session, clears the cookie                         |
| GET    | `/api/me`                     | `{ enabled, user: { id, name, avatarUrl, createdAt } \| null }` |
| DELETE | `/api/me`                     | Deletes the account and all its data                           |
| GET    | `/api/decks?since=<cursor>`   | `{ decks, deleted: [{ id, version, deletedAt }], cursor }`: decks changed since the cursor of a previous call (all if omitted) |
| PUT    | `/api/decks/:id`              | Creates (201, `baseVersion` 0) or replaces (200) a deck; body `{ name, format, entries: [{ cardId, board, qty }], createdAt, updatedAt, baseVersion }`; returns the saved deck with its new `version` |
| DELETE | `/api/decks/:id`              | Marks the deck deleted (tombstone); returns `{ id, version, deletedAt }` |
| PUT    | `/api/decks/:id/share`        | Shares a saved deck: `{ deckId, shareId }` (the same `shareId` while it stays shared) |
| DELETE | `/api/decks/:id/share`        | Stops sharing (204): the link stops working; sharing again makes a new one |
| GET    | `/api/shares`                 | `{ shares: [{ deckId, shareId }] }`: the user's shared decks   |
| GET    | `/api/shared/:shareId`        | Public, no session: `{ name, format, updatedAt, entries, owner: { name, avatarUrl } }`; 404 once deleted or no longer shared |
| GET    | `/api/collection?since=<cursor>` | `{ cards: [{ card, qty, foilQty }], removed: [cardId], cursor }`: the collection, or what changed since the cursor (`removed`: cards now at 0 and 0) |
| PATCH  | `/api/collection`             | `[{ cardId, qty, foilQty }]`, absolute values (0 and 0 removes); returns `{ count }` |
| GET    | `/api/history`                | `{ results }`: the account's match results, most recent first (the last 1 000) |
| POST   | `/api/history`                | `[result]` of matches against the bot (up to 200); a match already there is left as it is; returns `{ count }` |
| GET    | `/api/replays`                | `{ shares: [{ replayId, shareId, title, at }] }`: the user's shared replays, most recent first |
| POST   | `/api/replays`                | `{ data }` (a replay file, `packReplay`): shares it; returns `{ replayId, shareId, title, at }` (the same `shareId` for a replay shared again) |
| DELETE | `/api/replays/:shareId`       | Stops sharing (204): the link stops working, the replay is deleted from the server |
| GET    | `/api/shared-replays/:shareId` | Public, no session: `{ data, owner: { name, avatarUrl } }`; 404 once no longer shared |

- Decks come back with full card data (`cards.data`), in the client's `Deck` shape.
- Unknown card ids are fetched from Scryfall before saving. If Scryfall is unreachable, the API answers 503 and
  the client retries later (it is just another offline case). An id Scryfall doesn't know: 422.
- `PUT` with a `baseVersion` other than the stored `version`: 409 `{ error: 'conflict', deck }` with the server copy
  (a deck, or a tombstone), see Sync. A `PUT` on a deleted deck with its current version brings it back.
- `cursor` is the server time minus one minute (`decks.synced_at` is compared to it), so a change still being
  committed during a `GET` is not missed; the same deck may come back twice, which is harmless.
- Client times (`createdAt`, `updatedAt`) later than the server's clock are clamped to it.
- Limits: 500 decks per user, 300 entries per deck, 1 MB request body, 20 000 collection rows, 5 000 changes per
  collection `PATCH`, 300 writes per minute per user. Errors are `{ error: <code>, …params }`.
- Every query filters on the session's `user_id`; another user's deck id answers 404.
- Shared decks (`decks.share_id`, migration 006): 12 random URL-safe characters. The page `/shared/<shareId>` reads
  the latest version of the deck, shows its owner's display name and avatar (nothing else about the account: the
  profile page `/profile` is private) and offers to copy it into one's own decks. Public reads are limited to 120 per
  minute per address.
- Shared replays (`replay_shares`, migration 007): replays live in the browser, so sharing one sends it to the server
  (gzipped). The page `/replay/<shareId>` plays it like the history's replay viewer, with its owner's name, and offers
  to save it in the browser or download it. The replay shows every card, hidden ones included: the share panel says
  so. The server checks it is a replay file of the current rules version and keeps only card images from
  `https://cards.scryfall.io/` (the file is written by its sender, and the page loads the images it names). Limits: 3 MB
  per replay, 50 shared replays per user, 30 shares per minute per user, 60 public reads per minute per address.

## Sync in the browser

`src/lib/account/sync.ts` (logic, tested with two simulated devices in `sync.test.ts`), wired to the `useApp` store
by `src/store/useAccount.ts`; the UI is `src/components/AccountMenu.tsx`.

- The `useApp` store (localStorage) stays the source of truth. While logged in, the sync watches its changes and
  remembers in localStorage (`magic-trainer-sync`) what is not sent yet: changed decks, deleted decks, changed
  collection cards, plus the server version of each deck and the two cursors. Nothing is lost on reload or offline.
- **A sync** = pull the decks and the collection changed since the cursors, merge, then send what is pending.
  It runs at start, 1.5 s after a local change, when the tab comes back to the front, when the network comes back,
  and from the menu ("Sync now"). Network or server failures retry after 30 s, doubling up to 5 minutes.
- **First login in a browser** (or another user than last time): every local deck is sent, the account's decks are
  added; for the collection, cards on both sides keep the larger counts.
- **Merging decks**:
  - a deck only on one side is copied to the other;
  - a deck deleted elsewhere is removed here, unless it was changed here after the deletion (it comes back);
  - both changed → the newer `updatedAt` keeps the deck's id; the other version becomes a copy named
    "Deck (other device)", so nothing is lost;
  - a deck the server refuses (unknown cards, limits) stays in the browser only, is listed in the menu, and is sent
    again once it changes.
- **Collection**: last write wins per card; cards Scryfall doesn't know stay in the browser only.
- **Logout**: pending changes are sent first; the user chooses to keep a copy of the decks and collection in the
  browser (default) or remove it. **Account deletion** keeps the browser's copies.
- UI: "Log in with Discord" in the top bar ("Log in" on phones); once logged in, the avatar with a status dot
  (green saved, orange saving, grey offline, red error) and a menu: status, sync now, log out, delete my account.
  After a refused or failed login, a notice under the top bar.

## Online rooms

Each online room has an address, `/online/<id>` (a random UUID), which is also its invitation link; the 5-letter
code still works. The server sends each player a secret for their seat; the browser keeps it in localStorage for 3
days (`mt.onlineSeats`), and the server only its SHA-256. Opening the address sends `{t:'open', room, token}`: back to
the seat, or the room's info to join it.

The server saves each room (game state packed with each card written once, seats with hashed secrets, the seat's
account if any) a second after it changes, in the `rooms` table (`004_rooms.sql`: `id`, `code`, `state_version`,
`data`, `updated_at`), and restores the rooms at startup; a restart or an update doesn't end the games. Rooms untouched
for a day, or saved by another `STATE_VERSION` of the engine, are deleted.

A seat taken while logged in remembers the account: the same account opening the room's address on another device
gets the seat back (with a new secret), and `/online` lists the account's rooms (`myRooms`, sent after `hello`). The
WebSocket's user is read from the session cookie only for connections whose `Origin` is `PUBLIC_URL`.

## Match history and replays

Finished matches go in the history (`/history`, `src/lib/history.ts`): `{ id, at, kind: 'bot'|'online', twoHeaded,
commander, bestOf, deck, opponent, result: 'win'|'loss'|'draw', wins, losses }`. The browser keeps the last 500
(`mt.history`). Logged in, they also go in the `match_results` table (`005_match_results.sql`, key `(user_id, id)`):
the server records online matches itself (for each seat taken while logged in; the deck's name comes with `create` /
`join`), the browser sends the bot matches (`POST /api/history`, then marks them sent). The id is the match's, shared
by both players of an online match, so the browser's list and the account's merge without doubles.

A replay is a game's first state and every step since (actions, and log lines the server adds); the engine is
deterministic, so playing the steps again gives every state (`src/lib/replay.ts`). The server records each game of
the match in the room and sends them (`replays`) once the match is over, not before (they show hands and libraries).
The browser keeps the last 30 replays (`mt.replay.<id>`); they can be downloaded as a file and opened again (same
`STATE_VERSION` only). A replay that plays differently with the current rules is flagged.

## Security

- Cookies `HttpOnly; Secure; SameSite=Lax; Path=/` (`Secure` off on `http://localhost` in development).
- Requests that change data must carry an `Origin` equal to `PUBLIC_URL` (CSRF), in addition to `SameSite`.
- Only the token's hash is stored, so a database leak gives no usable sessions.
- Card data in the database only comes from Scryfall.
- Rate limits per IP on `/auth/*` and per user on writes.
- Postgres is not published on the host: only the app container reaches it, on the compose network.
- Account deletion removes every row (cascades); this covers the GDPR right to erasure. A privacy note lists what
  is kept: Discord id and name, avatar, decks, collection.

## Configuration

New environment variables:

| Variable                | Example                                       | Purpose                                   |
| ----------------------- | --------------------------------------------- | ----------------------------------------- |
| `DATABASE_URL`          | `postgres://magic:secret@postgres:5432/magic` | Postgres connection                       |
| `PUBLIC_URL`            | `https://magic.example.com`                   | Redirect URI and `Origin` check           |
| `DISCORD_CLIENT_ID`     | `1234567890`                                  | Discord application                       |
| `DISCORD_CLIENT_SECRET` | from the Discord portal                       | Secret, never sent to the browser         |
| `POSTGRES_PASSWORD`     | random                                        | Used by both containers                   |
| `ADMIN_DISCORD_IDS`     | `123456789012345678,223456789012345678`       | Administrators (the `/admin` page)        |
| `APP_VERSION`           | set by `make app` (the git commit)            | Shown on the administration page         |

Without `DATABASE_URL` or the Discord variables, the server starts as today, with accounts disabled (`/api/me`
answers `{ user: null, enabled: false }` and the login button is hidden).

### Discord application

1. https://discord.com/developers/applications → New Application.
2. OAuth2 → copy the Client ID and reset/copy the Client Secret.
3. OAuth2 → Redirects: add `https://<domain>/auth/discord/callback` and, for development,
   `http://localhost:5173/auth/discord/callback`.

### docker-compose.yml

```yaml
services:
  magic-trainer:
    # … as today, plus:
    environment:
      DATABASE_URL: postgres://magic:${POSTGRES_PASSWORD}@postgres:5432/magic
      PUBLIC_URL: ${PUBLIC_URL}
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: magic
      POSTGRES_USER: magic
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env (make app creates it)}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U magic -d magic"]
      interval: 5s
      timeout: 3s
      retries: 10
    # No "ports": only reachable from the app container.

volumes:
  pgdata:
```

Secrets go in a `.env` file next to `docker-compose.yml` (git-ignored; a `.env.example` lists the names).

### Development

- `docker compose -f docker-compose.dev.yml up -d` (Postgres alone on `127.0.0.1:5432`), then
  `DATABASE_URL=postgres://magic:dev@localhost:5432/magic npm run server`.
- Vite proxies `/auth` and `/api` to `localhost:8787`, like `/ws`.
- Tests: server tests use a fake Discord (`fetch` stubbed) and a test database (`DATABASE_URL_TEST`, skipped when
  unset). Covered: login, wrong `state`, expired session, another user's deck, conflict, tombstones, merge rules.

### Backups

`make backup [KEEP=14]` (`pg_dump -Fc` to `backups/`, from a daily cron) and `make restore FILE=…` (stops the app,
empties the `public` schema, `pg_restore`, starts the app, which applies the newer migrations). See the README.

## Administration

Administrators are the accounts whose Discord user id is in `ADMIN_DISCORD_IDS` (comma or space separated; restart
the app after changing it). Nothing in the database marks them, and nothing in the app can make someone an
administrator. `/api/me` returns `admin: true` for them; their account menu links to `/admin`.

| Method | Path                                    | Purpose                                                     |
| ------ | --------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/admin/overview`                   | Users, activity, online players, matches per day, storage   |
| GET    | `/api/admin/users?q=&sort=seen\|joined` | The users (200 at most), with their decks, matches, shares  |
| POST   | `/api/admin/users/:id/signout`          | Deletes all the user's sessions                             |
| POST   | `/api/admin/users/:id/unshare`          | Stops all the user's shared decks and replays               |
| DELETE | `/api/admin/users/:id`                  | Deletes the account and its data (like "Delete my account") |
| GET    | `/api/admin/rooms`                      | The online rooms in the server's memory                     |
| DELETE | `/api/admin/rooms/:code`                | Closes a room: its players and spectators are disconnected  |
| GET    | `/api/admin/shares?kind=decks\|replays&q=` | Shared decks or replays (200 at most)                    |
| DELETE | `/api/admin/shares/deck\|replay/:shareId` | Stops sharing it                                         |
| GET    | `/api/admin/system`                     | Version, uptime, migrations, settings                       |
| POST   | `/api/admin/maintenance/sessions\|tombstones` | Purges expired sessions or old deleted decks now      |

Every route answers 401 without a session and 403 for a user who isn't an administrator; changes need our own
`Origin` and are limited to 60 a minute. An administrator can't be signed out, unshared or deleted from the page (nor
delete their own account there): that is done by removing them from `ADMIN_DISCORD_IDS` first.

## Implementation steps

1. ✓ Postgres in compose, `pg`, migration runner, `001_accounts.sql`, `cards` table backing the card check.
2. ✓ Discord login, sessions, `/api/me`, logout, account deletion.
3. ✓ Deck and collection API with limits and conflicts.
4. ✓ Client: login button and menu, `sync.ts`, merge, offline queue, i18n (en, fr).
5. ✓ README: deployment section (variables, Discord application, backups).

## Later

- Online games: use the Discord name instead of the typed name, and list "my games".
- Share a deck by link (read-only `decks.public_slug`).
- Other login providers (a new `identities.provider` value).
