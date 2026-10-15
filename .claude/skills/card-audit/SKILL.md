---
name: card-audit
description: Check how the Magic Trainer rules engine handles real cards or decks (a decklist, an mtgtop8 URL, card names), find cards it simulates wrongly or ignores, fix the engine, and record the rest in TODO.md. Use when the user asks whether cards/decks "work", reports a card or trigger that misbehaves in a game, or wants to test a metagame.
---

# Card audit

Goal: every card is either **simulated correctly** or **clearly "not simulated"**. A card simulated *wrongly*
(half its text applied, a cost skipped, an ability silently ignored) is the worst case and is fixed first.

## 1. Get the cards and the report

```bash
npm run audit-cards -- deck.txt                 # Arena/MTGO/plain decklist
npm run audit-cards -- "https://www.mtgtop8.com/event?e=…&d=…&f=ST"   # one deck (d=…) or an event's top 8
npm run audit-cards -- "Card Name" "Other Card"
npm run audit-cards -- … --problems             # hide fully simulated cards
npm run audit-cards -- … --save file.json       # keep the cards (offline re-runs: --cards file.json)
```

For the whole metagame (the top 8 decks of each mtgtop8 format), `npm run audit-meta` writes a ranked report to
`audit-reports/<date>/` (git-ignored): `report.md`, `report.json` (its `problems` list, cards playing wrongly first),
and `cards.json` (reuse it with `--cards`). `npm run fix-meta` runs that audit and then this skill headless on a new
branch, with a cap on fixes and spending (`--dry-run` shows the instructions without changing anything).

Put pasted decklists and downloads in the session scratchpad, not in the repo. Respect the sites: the script
already waits between requests; don't loop over hundreds of decks.

Report legend, per line of each card: `✓` simulated, `✗` recognized but not simulated (the game logs "not
simulated"), `?` **silently ignored** — the engine plays the card as if the line didn't exist. Card status:
`refused` (can't be cast), `none`, `partial`, `ok`.

## 2. Find what is wrong, not just missing

The report says what the parser reads, not whether it is right. For each card, compare the Oracle text with the
reading, in this order:

1. `?` lines on permanents: statics, "enters with…", costs, mana abilities. These change the card silently
   (Moonshadow was a 7/7 for {B} because "enters with six -1/-1 counters" was unread).
2. `✓` lines whose reading is too small for the text: e.g. "spell → gainLife" for a removal spell, a trigger read as
   `mill` when the text also returns a card. The parser rejects partly understood text (coverage check in
   `parseAbilityText`), so this should be rare; when it happens it is a parser bug.
3. Lands: compare the mana line with the colors the card really makes.
4. Cards the user reported: also play them (step 3) even if the report looks fine — the bug may be in the engine.

## 3. Play the suspicious cards

Write a throwaway test next to the engine (`src/lib/engine/zz-scenario.test.ts`, delete it afterwards) using the
helpers of `src/lib/engine/meta.test.ts` (`board`, `settle`, `perm`, `errorOf`): cast the card, answer
`s.pending` choices, pass for the opponent, then check the battlefield, life, zones and `s.log`. Load real cards
with `JSON.parse(readFileSync(file))` from a `--save` file. Output written with `console.log` is hidden by vitest:
write it to a file in the scratchpad instead.

## 4. Fix

Rules of the codebase:
- Never half-simulate. If only part of an ability can be done, leave it "not simulated" (empty effects).
  A sentence that changes nothing the engine simulates may go in `IGNORED` (rules.ts) only if it is harmless;
  small upsides deliberately ignored are listed under "Approximations" in TODO.md.
- Parser changes go in `src/lib/engine/rules.ts` (`parseAbilityText`, `parseTargetPhrase`, `triggersOf`,
  `activatedOf`, `castInfo`); game behaviour in `engine.ts`; the bot's answers to new choices in `bot.ts`; new
  prompts or errors in `src/components/ChoicePanel.tsx` and both `src/i18n/en.ts` and `src/i18n/fr.ts`.
- Each fix gets a test with the card's real Oracle text in `src/lib/engine/meta.test.ts`.
- Match the surrounding style: short comments that quote the card wording handled.

## 5. Record and check

- Add what is still missing to TODO.md ("Standard decks audit" section, or a new one per format), most played first,
  naming example cards.
- To keep a deck as a regression fixture: `--save src/lib/engine/fixtures/<name>.json` and add the name to
  `FIXTURES` in `audit.test.ts`.
- Run `npx tsc -b`, `npx vitest run` (an engine change that alters how a fixture card is read fails
  `audit.test.ts`: read the diff of `fixtures/*.audit.txt`, then accept it with `npx vitest run -u`), and
  `npm run build`.
- Commit when done; ask before pushing.
