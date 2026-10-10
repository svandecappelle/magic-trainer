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
Over the internet, deploy with `npm run build && npm start` on any Node host (Render, Fly.io, a VPS…).

The server holds the authoritative game state: it validates every action with the same engine as the bot, and
each player only receives what they may see (no libraries, no opponent hand). A reload rejoins the same seat.
Known limitation: the server trusts the card data each client sends with its deck.

## Structure

| Path | What |
|---|---|
| `src/types.ts` | Core data types: `Card`, `Deck`, `CollectionEntry` |
| `src/lib/scryfall.ts` | Scryfall API client (search, bulk lookup by name), request throttling |
| `src/lib/deckText.ts` | Parse / format text decklists (Arena, MTGO, plain) |
| `src/lib/stats.ts` | Mana curve, color pips, type breakdown, hypergeometric odds |
| `src/lib/goldfish.ts` | Pure game-state reducer for solo practice (zones, mulligan, turns) |
| `src/lib/engine/` | Simplified two-player rules engine with London mulligans, a stack and Arena-style priority windows (`engine.ts`), card rules parsing (`rules.ts`), heuristic bot (`bot.ts`), preset decks |
| `src/lib/multiplayer/` | Client/server message types, hidden-information redaction, WebSocket hook |
| `server/` | Node WebSocket game server: rooms, seats, reconnection (`rooms.ts`), HTTP/static wiring (`index.ts`) |
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
