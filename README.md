# Magic Trainer

A web app for Magic: The Gathering players: deck builder, collection manager, solo "goldfish" practice, play against a bot, and a table life tracker.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests for the logic in src/lib
npm run build   # type-check + production build into dist/
```

## Structure

| Path | What |
|---|---|
| `src/types.ts` | Core data types: `Card`, `Deck`, `CollectionEntry` |
| `src/lib/scryfall.ts` | Scryfall API client (search, bulk lookup by name), request throttling |
| `src/lib/deckText.ts` | Parse / format text decklists (Arena, MTGO, plain) |
| `src/lib/stats.ts` | Mana curve, color pips, type breakdown, hypergeometric odds |
| `src/lib/goldfish.ts` | Pure game-state reducer for solo practice (zones, mulligan, turns) |
| `src/lib/engine/` | Simplified two-player rules engine (`engine.ts`), card rules parsing (`rules.ts`), heuristic bot (`bot.ts`), preset decks |
| `src/store/` | Zustand stores, persisted to `localStorage` |
| `src/pages/` | One component per screen |
| `src/components/` | Shared UI: card search, mana symbols, deck stats |

All data stays in the browser (`localStorage`). Card data and images come from [Scryfall](https://scryfall.com/docs/api).

## Roadmap

- Bot: instant-speed responses, mulligans, creature abilities/triggers, smarter combat (multi-blocks, combat tricks).
- Online multiplayer: needs a backend (e.g. Node + WebSocket) that owns the game state and syncs players.
