# Magic Trainer

A web app for Magic: The Gathering players: deck builder, collection manager, solo "goldfish" practice, play against a bot or a friend online, and a table life tracker.

```bash
npm install
npm run dev     # app on http://localhost:5173
npm run server  # game server for online play (port 8787); Vite proxies /ws to it
npm test        # unit tests
npm run build   # type-check + production build into dist/
npm start       # production: serves dist/ and the game server on one port (PORT, default 8787)
```

The server uses PostgreSQL when `DATABASE_URL` is set (without it, it keeps no data). For development:

```bash
docker compose -f docker-compose.dev.yml up -d     # Postgres on 127.0.0.1:5432 (DEV_DB_PORT to change)
DATABASE_URL=postgres://magic:dev@localhost:5432/magic npm run server
DATABASE_URL_TEST=postgres://magic:dev@localhost:5432/magic npm test   # also runs the database tests
```

Login with Discord also needs `PUBLIC_URL=http://localhost:5173`, `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`
(a Discord application with the redirect `http://localhost:5173/auth/discord/callback`, see `.env.example`); Vite
proxies `/api` and `/auth` to the server.

### Game modes

Play vs Bot and online rooms offer a duel or **Two-Headed Giant** (two teams of two sharing 30 life and their turns:
you and a bot ally against two bots, or four players online), each with or without **Commander** rules (40 life,
60 per team in Two-Headed Giant, commanders cast from the command zone with tax, 21 commander damage). Single
games or best of 3 with sideboarding.

### Playing online

Run both `npm run dev` and `npm run server`, open **Play Online**, create a room and send the 5-letter code to your opponent.
To play another machine on your network, start Vite with `npx vite --host` and share your LAN address.
Over the internet, deploy with Docker (see [Deploying on a server](#deploying-on-a-server-docker--nginx)), or with
`npm run build && npm start` on any Node host.

The server holds the authoritative game state: it validates every action with the same engine as the bot, and
each player only receives what they may see (no libraries, no opponent hand). A reload rejoins the same seat.
The server checks every deck's cards against Scryfall (by card id) and uses Scryfall's data, so a modified client
can't play altered cards. `CARD_CHECK=strict` refuses decks when Scryfall is unreachable (default `lenient`: the
client's data is used then), `CARD_CHECK=off` disables the check.
Game modes (Play vs Bot and Play Online): **Constructed** in a format (Standard, Pioneer, Modern, Legacy, Vintage,
Pauper; a deck not legal in it, ban list included, can't be played, checked by the server too online), **Free Play**
(no restriction on the deck), **Commander** (100-card singleton, 40 life) and **Duel Commander** (20 life, 1 vs 1, its own ban list);
Commander decks that break the rules play with a warning. Two-Headed Giant is an option of every mode but Duel
Commander.

Online games have clocks: `TURN_SECONDS` (default 120) per decision, after which the server plays the default action
(pass, keep, no blocks…) and concedes after three timeouts in a row; `RECONNECT_SECONDS` (default 180) for a
disconnected player to come back before conceding. 0 disables either. With nobody connected the game waits (up to
the 24 hours a room is kept); the clocks start again when a player is back.

## Deploying on a server (Docker + nginx)

One Node process serves the app and the multiplayer WebSocket (`/ws`); it runs in a Docker container listening on
`127.0.0.1:8787`, with nginx in front, and a PostgreSQL container next to it (for accounts and saved decks, being
built: see [docs/accounts.md](docs/accounts.md); for now it caches the Scryfall data of the online card check).
Requirements: Docker with the compose plugin, nginx, and make.

```bash
git clone git@github.com:svandecappelle/magic-trainer.git && cd magic-trainer
sudo make install DOMAIN=magic.example.com                 # container + nginx site
sudo make install DOMAIN=magic.example.com HTTPS=1 EMAIL=you@example.com   # … with a Let's Encrypt certificate
```

Point the domain's DNS (A/AAAA record) at the server and open ports 80 and 443 first. `make help` lists the
other targets: `make update` (git pull, rebuild, restart), `make status`, `make logs`, `sudo make https DOMAIN=…`,
`sudo make uninstall`. Options: `PORT=` (host port, default 8787), `FORCE=1` (see below).

Each online game has its own address (`/online/<id>`, the invitation link). The server saves the rooms in
PostgreSQL after each change and restores them when it starts, so a restart or a `make update` doesn't end the games:
players reconnect by themselves (their browser keeps their seat's secret for 3 days; the server keeps only its hash).
Rooms nobody touched for a day are deleted. Logged in with Discord, a player gets their seat back from any device
(`/online` lists their games). Anyone else with the address can watch the game (up to 20 spectators, no hand
shown). Players can turn on browser notifications for their turn, and the tab's title changes when the game needs
them. Without a database, rooms live in memory and a restart ends them. Finished matches go in the history
(`/history`: results per deck and opponent, replays of each game, downloadable as a file); logged in, the results are
kept in the account too. Against the bot, your last actions can be taken back (Undo, Ctrl+Z). Games
against the bot are saved in the browser (`/play/<id>`, the last 10).

The database password is in `.env` next to `docker-compose.yml`: `make app` creates it with a random value the first
time (see `.env.example`). Keep that file. To enable accounts (login with Discord), add `PUBLIC_URL`,
`DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` to it (`.env.example` explains how), then `make app`. The data is in the Docker volume `pgdata`, kept by `make uninstall`.
The server applies the SQL files of `server/db/migrations/` that are new when it starts.

### Backups

```bash
make backup                      # backups/magic-<date>.dump (accounts, decks, collections)
make backup KEEP=14              # … and delete the dumps of backups/ older than 14 days
make restore FILE=backups/magic-2026-10-17-031500.dump   # asks, then replaces ALL the data
```

`make backup` runs `pg_dump -Fc` in the Postgres container (`BACKUP_DIR=…` for another folder). Copy the dumps off the
server, with `.env`. For a daily backup at 3:30, add with `crontab -e`:

```cron
30 3 * * * cd /path/to/magic-trainer && make backup KEEP=14 >/dev/null
```

`make restore` stops the app, empties the database, loads the dump and starts the app again, which then applies the
migrations newer than the dump; `YES=1` skips the question. To move to another server: `make install` there, then
`make restore` with a dump of the old one (the new `.env` password is fine: it is not in the dump).

### What the installer does to nginx

It installs **one dedicated file**, `magic-trainer.host.conf`, from the template
[`deploy/magic-trainer.host.conf`](deploy/magic-trainer.host.conf): in `/etc/nginx/sites-available/` with a link in
`sites-enabled/` (Debian/Ubuntu), or in `/etc/nginx/conf.d/` otherwise. Other sites are never modified:

- it stops, changing nothing, if another configuration already declares `server_name DOMAIN` (`FORCE=1` to go on);
- the `map` variable and `upstream` in the template have names prefixed with `magic_trainer` so they can't collide
  with other configurations;
- a previous version of its own file is kept as `magic-trainer.host.conf.bak-<date>` (not loaded by nginx);
- it runs `nginx -t` before reloading; if nginx rejects the configuration, the previous state is restored;
- `make uninstall` removes only that file and its link (the certificate and the backups stay).

`HTTPS=1` (or `sudo make https DOMAIN=…` later) gets a Let's Encrypt certificate with
`certbot certonly --webroot`: the site answers the challenge from its own folder (`/var/www/magic-trainer-acme`),
so certbot's nginx plugin isn't needed and other sites are never edited. The site then switches to its HTTPS
template ([`deploy/magic-trainer.host.https.conf`](deploy/magic-trainer.host.https.conf)): port 80 redirects to 443,
which serves the app with that certificate. Re-running `make install` keeps HTTPS as long as the certificate exists;
renewals reload nginx through certbot's deploy hook.

Without its own 443 server, an `https://` request for the domain is answered by nginx's default HTTPS server,
i.e. another site on the machine: set up HTTPS whenever other sites on the server use it.

The installer also checks, with `nginx -T`, that nginx really loads the file: it picks `sites-enabled/` only when
`nginx.conf` includes it, `conf.d/` otherwise.

### Configuring nginx by hand

To write your own configuration (or use Caddy, Traefik…), the essentials are in the template:

- **Proxy everything to `127.0.0.1:8787`.** The Node server serves the static files and falls back to `index.html`
  for client-side routes such as `/play`, so no `root` or `try_files` is needed.
- **Upgrade WebSocket requests on `/ws`:** `proxy_http_version 1.1` and the `Upgrade` / `Connection: upgrade`
  headers. Without them, Play Online can't connect.
- **Long read timeout on `/ws`** (`proxy_read_timeout 1h`): nginx closes connections idle for 60 s by default;
  the server pings every 30 s, but a long timeout avoids cutting games during slow turns.
- **HTTPS:** behind HTTPS the app connects with `wss://` automatically (same host, `/ws`).
- **Caching:** files under `/assets/` have content hashes in their names and can be cached for a year.

Without nginx (for a quick test), change the port line of `docker-compose.yml` to `"8787:8787"`, run `make app`
and open `http://<server>:8787`.

## Structure

| Path | What |
|---|---|
| `src/types.ts` | Core data types: `Card`, `Deck`, `CollectionEntry` |
| `src/lib/scryfall.ts` | Scryfall API client (search, bulk lookup by name), request throttling |
| `src/lib/deckText.ts` | Parse / format text decklists (Arena, MTGO, plain) |
| `src/lib/stats.ts` | Mana curve, color pips, type breakdown, hypergeometric odds |
| `src/lib/goldfish.ts` | Pure game-state reducer for solo practice (zones, mulligan, turns) |
| `src/lib/engine/` | Simplified two-player rules engine with London mulligans, a stack and Arena-style priority windows with an optional per-player full control mode (`engine.ts`), card rules parsing (`rules.ts`), heuristic bot (`bot.ts`), preset decks |
| `src/lib/multiplayer/` | Client/server message types, hidden-information redaction, WebSocket hook |
| `src/lib/replay.ts`, `src/lib/history.ts` | Game replays (first state + steps), match results and their stats; `server/history.ts` keeps them per account |
| `server/` | Node WebSocket game server: rooms, seats, reconnection (`rooms.ts`), HTTP/static wiring (`index.ts`) |
| `server/auth.ts`, `server/http.ts` | Login with Discord, sessions, `/api/me`; cookie, JSON body and rate-limit helpers |
| `server/decks.ts` | Saved decks and collection API (`/api/decks`, `/api/collection`): versions, conflicts, tombstones, limits |
| `server/db/` | PostgreSQL: connection and migration runner (`index.ts`), SQL migrations, Scryfall card cache (`cards.ts`) |
| `Makefile`, `Dockerfile`, `docker-compose.yml`, `deploy/` | Server installer, container image, compose services (app, PostgreSQL), nginx site template |
| `docker-compose.dev.yml` | PostgreSQL alone for development |
| `src/i18n/` | Translations (`en.ts`, `fr.ts`), language store, log/error rendering |
| `src/store/` | Zustand stores, persisted to `localStorage`; `useAccount.ts`: login and sync with the account |
| `src/lib/account/` | Account API client and the sync of decks and collection (`sync.ts`) |
| `src/pages/` | One component per screen |
| `src/components/` | Shared UI: card search, mana symbols, deck stats |

Data stays in the browser (`localStorage`); logged-in players (Discord) also have their decks and collection saved in their account and synced between devices ([docs/accounts.md](docs/accounts.md)). Card data and images come from [Scryfall](https://scryfall.com/docs/api).

### Languages

The interface is available in English and French (detected from the browser, switchable in the menu).
Cards are shown in the chosen language too: printed name, type line and card image of a printing in that
language, fetched from Scryfall in batches and cached (`src/lib/cardLocale.ts`). Cards never printed in that
language fall back to English. The rules engine always works on the English Oracle text.
Decklists and searches accept card names in any language Scryfall knows ("4 Foudre").

To add a language: copy `src/i18n/en.ts`, translate it (TypeScript checks that every entry exists), and
register it in `src/i18n/index.ts`. Game logs and errors are structured data, rendered by each player's browser.

## Roadmap

- Rules: creature abilities and triggers, activated abilities, more spell effects, choosing cards to discard.
- Bot: multi-blocks, holding back blockers, planning its mana around instants it holds.
- Online: verify decks server-side against Scryfall, spectators, chat.
