# Rules engine roadmap

What the engine (`src/lib/engine/`) does not simulate yet, in implementation order.
"Cards" is the approximate number of Modern-legal cards using the mechanic (Scryfall search, Oct 2026),
to show how much each step unlocks. Tick items as they land.

## Already supported

- Instants/sorceries, with any number of target slots and target restrictions: damage (fixed or X; any target,
  creature, player, each opponent/player), counter (with type filters, or "unless its controller pays {N}"), ±N/±N and
  keyword grants until end of turn, destroy/exile, +1/+1 and -1/-1 counters, draw (you / target player / each player),
  gain and lose life, discard (chosen, random, Duress-style), mill, scry, surveil, tap/untap, bounce, board wipes
  ("destroy all/each", "damage to each creature", "creatures you control get…", "return all…"), fight and "bite".
- About half of the 350 most-played Modern instants and sorceries are simulated (Oct 2026 sample).
- Triggered abilities: enters, dies, attacks, deals combat damage to a player, landfall / "another creature enters",
  upkeep and end step, "whenever you cast …", prowess. Targets are chosen when the trigger goes on the stack,
  "you may" asks on resolution. About 30% of the 350 most-played permanents with triggers are fully simulated
  (most others make tokens or Treasure, or watch draws, life gain or sacrifices).
- Keywords: flying, reach, haste, vigilance, trample, deathtouch, lifelink, defender, first strike,
  double strike, menace, flash.
- Mana: basic land types and "{T}: Add …" (one mana per source, X = 0).
- London mulligan, stack, priority windows, full control mode.
- Activated abilities of permanents ("{T}: …", "{2}{R}: …", sacrifice and life costs), tokens (creatures, Treasure,
  Clue, Food), edicts. About a quarter of the 350 most-played cards with activated abilities have one simulated.
- Anything else is cast "not simulated"; artifacts, enchantments and planeswalkers enter and only their triggers and
  activated abilities work.

## Step 0 — Foundations

- [x] 0.1 Effects usable from any source: `parseAbilityText` + abilities on the stack (`addAbility`) that resolve like spells
- [x] 0.2 Player choices (cards / arrange / mode / yes-no) pausing resolution, hidden from the opponent online, answered by the bot.
  Used so far by the cleanup discard and "counter unless its controller pays {N}"; arrange and mode have no card using them yet
- [x] 0.3 Richer targeting: several target slots, "up to N", restrictions (nonblack, you control, with flying, tapped,
  attacking, mana value, power, artifact/enchantment/land…), partial fizzling. Unknown restrictions → not simulated
- [x] 0.4 +1/+1 and -1/-1 counters (cancel out), until-end-of-turn boosts with granted keywords, 0 toughness dies

## Step 1 — Simple spell effects

- [x] 1. Draw, other wordings: target player draws, each player draws, draw then discard (2388 cards)
- [x] 2. Discard: random, you choose, target player chooses, Duress-style (1222)
- [x] 3. Life loss / drain (652)
- [x] 4. Mill (437)
- [x] 5. Scry / surveil (379 / 214)
- [x] 6. Tap / untap target (386) — "doesn't untap during its next untap step" is not simulated yet
- [x] 7. X spells (345) — X in the cost and in amounts; "divided as you choose" is not simulated
- [x] 8. -N/-N until end of turn (303) — came with 0.4
- [x] 9. Bounce (215+), including "return all …"
- [x] 10. Board wipes: destroy all/each, damage to each creature (and player), creatures get ±N/±N (211)
- [x] 11. Fight and "bite" (98)

## Step 2 — Triggered abilities

- [x] 12. Enters the battlefield (3450)
- [x] 13. Upkeep / end step (776) — upkeep triggers resolve before the draw
- [x] 14. Attacks (728), and "deals combat damage to a player"
- [x] 15. Dies (501), including "this creature or another creature dies"
- [x] 16. Landfall (171), and "whenever another creature you control enters"
- [x] 17. Cast triggers ("whenever you cast a noncreature spell", magecraft), prowess

Not simulated yet in triggers (recognized, logged as "not simulated"):
- Conditions and references to the triggering object: "if …", "it" / "that creature" / "that player" when the
  trigger watches another permanent, "where X is …", "for each …"
- Other events: an opponent casts or draws, you gain life, "one or more creatures", beginning of combat,
  becomes tapped / targeted, sacrifices
- Triggers from first-strike damage wait until regular damage is dealt; a player's simultaneous triggers go on
  the stack in the order they happened (no ordering choice)

## Step 3 — Activated abilities and resources

- [x] 18. Activated abilities "{T}: …", "{2}{R}: …" (2891) — costs: mana (with X), {T}, "Pay N life", sacrifice;
  "activate only as a sorcery" / "once each turn". Other restrictions and costs (discard, remove counters, tap
  another creature) are left out
- [x] 19. Sacrifice as cost or effect (2190) — "Sacrifice this/a/another …" costs, edicts, "sacrifice this creature"
- [x] 20. Tokens: creatures, Treasure, Clue, Food (2442) — "create N P/T color Type creature tokens (with keywords)";
  tokens with their own abilities in quotes, copies, investigate and Blood are not simulated yet
- [ ] 21. +1/+1 counters (1909) — spells that put counters work; still missing: "enters with counters", "for each counter"…
- [ ] 22. Library search: tutors, ramp, fetchlands (680)
- [ ] 23. Return from graveyard (828)
- [ ] 24. Planeswalkers: loyalty abilities, attacking them (278)
- [ ] 25. Mana pool and manual tapping; sources making 2+ mana

## Step 4 — Permanents with ongoing rules

- [ ] 26. Auras (805)
- [ ] 27. Equipment (516)
- [ ] 28. Anthems / static buffs (479)
- [ ] 29. Lands entering tapped (525)
- [ ] 30. Hexproof, indestructible, ward (316)
- [ ] 31. Protection (104)
- [ ] 32. Legend rule

## Step 5 — Special card types and costs

- [ ] 33. Modal spells "Choose one —" (541)
- [ ] 34. Double-faced cards: transform, modal DFC (463)
- [ ] 35. Kicker and additional costs (406)
- [ ] 36. Cycling (280)
- [ ] 37. Convoke, delve, affinity (179)
- [ ] 38. Flashback (148)
- [ ] 39. Adventure (119)

## Step 6 — Rare or complex rules

- [ ] Copy / clone (250)
- [ ] Gain control (156)
- [ ] Infect, toxic, poison (122)
- [ ] Proliferate (71)
- [ ] Replacement and prevention effects ("instead", "prevent")
- [ ] Extra turns, alternate win conditions
- [ ] Full layer system for interacting continuous effects

## Game behaviour

- [x] Choose the cleanup discard
- [ ] Damage assignment order with several blockers (today: automatic)
- [ ] Best-of-3 with sideboarding
- [ ] Format legality checks (deck size, 4 copies, banned list)
- [ ] Server-side deck validation (the server trusts client card data)
- [ ] Auto-pass leaks that you hold a castable instant (full control avoids it)
- [ ] More than 2 players, Commander
- [ ] Turn timer, reconnect timeout
- [ ] Bot: multi-blocks, mana planning, and logic for each new mechanic
