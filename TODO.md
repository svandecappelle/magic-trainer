# Rules engine roadmap

What the engine (`src/lib/engine/`) does not simulate yet, in implementation order.
"Cards" is the approximate number of Modern-legal cards using the mechanic (Scryfall search, Oct 2026),
to show how much each step unlocks. Tick items as they land.

## Already supported

- Instants/sorceries, with any number of target slots and target restrictions: fixed damage (any target, creature,
  player, each opponent), counter (with type filters, or "unless its controller pays {N}"), ±N/±N and keyword grants
  until end of turn, destroy/exile target creature or permanent, +1/+1 and -1/-1 counters, draw N, gain N life.
- Keywords: flying, reach, haste, vigilance, trample, deathtouch, lifelink, defender, first strike,
  double strike, menace, flash.
- Mana: basic land types and "{T}: Add …" (one mana per source, X = 0).
- London mulligan, stack, priority windows, full control mode.
- Anything else is cast "not simulated"; artifacts, enchantments and planeswalkers enter and do nothing.

## Step 0 — Foundations

- [x] 0.1 Effects usable from any source: `parseAbilityText` + abilities on the stack (`addAbility`) that resolve like spells
- [x] 0.2 Player choices (cards / arrange / mode / yes-no) pausing resolution, hidden from the opponent online, answered by the bot.
  Used so far by the cleanup discard and "counter unless its controller pays {N}"; arrange and mode have no card using them yet
- [x] 0.3 Richer targeting: several target slots, "up to N", restrictions (nonblack, you control, with flying, tapped,
  attacking, mana value, power, artifact/enchantment/land…), partial fizzling. Unknown restrictions → not simulated
- [x] 0.4 +1/+1 and -1/-1 counters (cancel out), until-end-of-turn boosts with granted keywords, 0 toughness dies

## Step 1 — Simple spell effects

- [ ] 1. Draw, other wordings: target player draws, draw then discard (2388 cards)
- [ ] 2. Discard: random, you choose, target player chooses (1222)
- [ ] 3. Life loss / drain (652)
- [ ] 4. Mill (437)
- [ ] 5. Scry / surveil (379 / 214)
- [ ] 6. Tap / untap target (386)
- [ ] 7. X spells (345)
- [x] 8. -N/-N until end of turn (303) — came with 0.4
- [ ] 9. Bounce (215+)
- [ ] 10. Board wipes: destroy all, damage to each creature (211)
- [ ] 11. Fight (98)

## Step 2 — Triggered abilities

- [ ] 12. Enters the battlefield (3450)
- [ ] 13. Upkeep / end step (776)
- [ ] 14. Attacks (728)
- [ ] 15. Dies (501)
- [ ] 16. Landfall (171)
- [ ] 17. Cast triggers, prowess

## Step 3 — Activated abilities and resources

- [ ] 18. Activated abilities "{T}: …", "{2}{R}: …" (2891)
- [ ] 19. Sacrifice as cost or effect (2190)
- [ ] 20. Tokens: creatures, Treasure, Clue, Food (2442)
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
