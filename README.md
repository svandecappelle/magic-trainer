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

### Playing online

Run both `npm run dev` and `npm run server`, open **Play Online**, create a room and send the 5-letter code to your opponent.
To play another machine on your network, start Vite with `npx vite --host` and share your LAN address.
Over the internet, deploy with Docker (see [Deploying on a server](#deploying-on-a-server-docker--nginx)), or with
`npm run build && npm start` on any Node host.

The server holds the authoritative game state: it validates every action with the same engine as the bot, and
each player only receives what they may see (no libraries, no opponent hand). A reload rejoins the same seat.
Known limitation: the server trusts the card data each client sends with its deck.

## Deploying on a server (Docker + nginx)

The image builds the app (after running the tests) and starts one Node process that serves it and the
multiplayer WebSocket (`/ws`) on port 8787. Requirements: Docker with the compose plugin.

```bash
git clone git@github.com:svandecappelle/magic-trainer.git && cd magic-trainer
docker compose up -d --build     # build the image and start it in the background
docker compose ps                # "healthy" once it answers
docker compose logs -f           # follow the logs
curl -I http://127.0.0.1:8787/   # 200 from the server itself
```

To update: `git pull && docker compose up -d --build`. Games in progress live in the server's memory, so a
restart or an update ends them (players keep their decks and collection: those stay in their browser).

`docker-compose.yml` publishes the port on `127.0.0.1` only, so the service is reachable from the server itself and
nginx faces the internet. To try it without nginx, change the port line to `"8787:8787"` and open
`http://<server>:8787`. To use another port, change both `PORT` and the port mapping.

### nginx in front

[`deploy/nginx.conf`](deploy/nginx.conf) is a ready-to-use site configuration. On a Debian/Ubuntu server:

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/magic-trainer
sudo sed -i 's/magic.example.com/your.domain.com/' /etc/nginx/sites-available/magic-trainer
sudo ln -s /etc/nginx/sites-available/magic-trainer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain.com    # HTTPS certificate; certbot adds the 443 server and the redirect
```

Point the domain's DNS (A/AAAA record) at the server and open ports 80 and 443 in its firewall first.

What the configuration does, if you write your own (or use Caddy, Traefik…):

- **Proxy everything to `127.0.0.1:8787`.** The Node server serves the static files and falls back to `index.html`
  for client-side routes such as `/play`, so no `try_files` or root directory is needed.
- **Upgrade WebSocket requests on `/ws`:** `proxy_http_version 1.1`, `Upgrade $http_upgrade` and
  `Connection "upgrade"` headers. Without them, Play Online can't connect.
- **Long read timeout on `/ws`** (`proxy_read_timeout 1h`): nginx closes connections idle for 60 s by default;
  the server pings every 30 s, but a long timeout avoids cutting games during slow turns.
- **HTTPS:** behind HTTPS the app connects with `wss://` automatically (same host, `/ws`), so the WebSocket
  needs no separate configuration.
- **Caching:** files under `/assets/` have content hashes in their names and can be cached for a year;
  `index.html` must not be cached that long (it isn't, by default).

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
| `server/` | Node WebSocket game server: rooms, seats, reconnection (`rooms.ts`), HTTP/static wiring (`index.ts`) |
| `Dockerfile`, `docker-compose.yml`, `deploy/` | Container image, compose service, example nginx configuration |
| `src/i18n/` | Translations (`en.ts`, `fr.ts`), language store, log/error rendering |
| `src/store/` | Zustand stores, persisted to `localStorage` |
| `src/pages/` | One component per screen |
| `src/components/` | Shared UI: card search, mana symbols, deck stats |

All data stays in the browser (`localStorage`). Card data and images come from [Scryfall](https://scryfall.com/docs/api).

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
