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
- 208 of the 350 most-played Modern instants and sorceries are simulated (Oct 2026 sample).
- Triggered abilities: enters, dies, attacks, deals combat damage to a player, landfall / "another creature enters",
  upkeep and end step, "whenever you cast …", prowess. Targets are chosen when the trigger goes on the stack,
  "you may" asks on resolution. About 30% of the 350 most-played permanents with triggers are fully simulated
  (most others make tokens or Treasure, or watch draws, life gain or sacrifices).
- Keywords: flying, reach, haste, vigilance, trample, deathtouch, lifelink, defender, first strike,
  double strike, menace, flash.
- Mana: basic land types and "{T}: Add …" (any amount), a mana pool with manual tapping, rituals.
- London mulligan, stack, priority windows, full control mode.
- Activated abilities of permanents ("{T}: …", "{2}{R}: …", sacrifice and life costs), tokens (creatures, Treasure,
  Clue, Food), edicts. About a quarter of the 350 most-played cards with activated abilities have one simulated.
- Static abilities: anthems and lords, Auras, Equipment, hexproof / shroud / indestructible / ward / protection,
  legend rule, lands entering tapped.
- Anything else is cast "not simulated"; other artifacts and enchantments only have their triggers and activated abilities.

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
- [x] 21. +1/+1 counters (1909) — "enters with N (or X) +1/+1 counters", "put a counter on each creature you
  control"; "for each counter", moving and removing counters are not simulated
- [x] 22. Library search: tutors, ramp, fetchlands (680) — "search your library for … card(s), put into your hand /
  onto the battlefield (tapped), then shuffle"; split destinations (Cultivate) are not simulated
- [x] 23. Return from graveyard (828) — targets in graveyards ("target creature card from your graveyard"):
  return to hand or battlefield, exile; non-targeted returns are not simulated
- [x] 24. Planeswalkers: loyalty abilities, attacking them (278) — loyalty counters, one loyalty ability per turn at
  sorcery speed, damage removes loyalty, creatures can attack them; "−X" abilities and static abilities are not
  simulated. Cards saved before this change have no loyalty value and start at 3 (re-import the deck to fix)
- [x] 25. Mana pool and manual tapping; sources making 2+ mana — click a mana source to tap it (click again to undo
  while its mana is unspent), pools empty between steps, Sol Ring / bounce lands / "three mana of any one color",
  rituals. Simplification: "N mana of any one color" may be spent as different colors. The bot doesn't cast rituals

## Step 4 — Permanents with ongoing rules

- [x] 26. Auras (805) — "Enchant …" targets when cast, attached on resolution, "enchanted creature gets/has/can't
  attack or block", into the graveyard when what they enchant leaves. Auras with other effects (control, triggers on
  the enchanted creature) are not simulated
- [x] 27. Equipment (516) — "Equip {N}" (sorcery speed), "equipped creature gets/has", falls off when the creature leaves
- [x] 28. Anthems / static buffs (479) — "(Other) [color/type] creatures you control get +N/+N (and have …)", lords;
  conditional statics ("as long as …") and non-creature statics are not simulated
- [x] 29. Lands entering tapped (525) — always, "unless you control a Forest or a Plains", fast lands, slow lands,
  shock lands (pay 2 life or enter tapped)
- [x] 30. Hexproof, indestructible, ward (316) — and shroud; ward {N} (mana only) counters unless paid
- [x] 31. Protection (104) — protection from colors: targeting, damage, blocking, Auras/Equipment
- [x] 32. Legend rule — its controller chooses which one to keep

## Step 5 — Special card types and costs

- [x] 33. Modal spells "Choose one —" (541) — choose one / two / one or both / one or more; the modes are picked
  before targets. Modal triggered abilities ("When … enters, choose one —") are not simulated
- [x] 34. Double-faced cards: modal DFC (play either face, land backs included), split cards (cast either half).
  Transforming cards enter on their front face; transforming is not simulated yet
- [x] 35. Kicker and additional costs (406) — kicker cost, "if this spell was kicked" (extra effects, "deals N damage
  instead"); additional costs: sacrifice a …, discard N cards, pay N life. "X or Y" costs and multikicker are not
- [x] 36. Cycling (280) — cycling and basic/typed landcycling; "whenever you cycle" triggers are not simulated
- [x] 37. Convoke, delve, affinity (179) — used automatically when mana isn't enough (convoke creatures, then delve)
- [x] 38. Flashback (148) — cast from the graveyard (click it in the graveyard viewer), then exiled
- [x] 39. Adventure (119) — cast the adventure, the card goes on an adventure in exile, cast the creature from there

Cards saved before this step have no faces data: re-import decks with double-faced, adventure or split cards to
get each face's cost and image (their text is rebuilt from the joined faces meanwhile).

## Step 6 — Rare or complex rules

- [x] Copy / clone (250) — clones ("enter as a copy of any creature"), copying a spell (same targets), token copies
- [x] Gain control (156) — permanently or until end of turn (Threaten / Act of Treason: untap, haste); goes to its
  owner's graveyard or hand when it leaves
- [x] Infect, toxic, poison (122) — poison counters, 10 loses; infect damage as poison / -1/-1 counters; toxic N
- [x] Proliferate (71) — automatic choice: counters that help you on your permanents, -1/-1 on theirs, their poison
- [x] Replacement and prevention effects — Fog ("prevent all combat damage"), "prevent the next N damage";
  other "instead" replacements are not simulated
- [x] Extra turns ("take an extra turn after this one"); alternate win conditions are not simulated
- [x] Layers for power and toughness: the card's (7a), then "has base power and toughness N/N" (7b, the latest wins:
  Multiply by Zero), then effects and static abilities (7c), then counters (7d); "loses all abilities until end of
  turn" (layer 6: Day of Black Sun) and for as long as a permanent stays (Tishana's Tidebinder). Type-changing effects
  are applied to the card itself (Swift Reconfiguration, manlands, Magus of the Moon) without timestamps between them

## Game behaviour

- [x] Choose the cleanup discard
- [x] Damage assignment order with several blockers — the attacking player orders them; lethal damage in order
- [x] Best-of-3 with sideboarding — vs the bot and online (the room creator chooses); between games each player
  moves cards between deck and sideboard (checked by the server online); the loser plays first
- [x] Format legality checks (deck size, 4 copies, banned list) — in the deck editor, from Scryfall legalities;
  "Refresh card data" re-fetches older saved cards
- [x] Server-side deck validation — the server replaces card data with Scryfall's (by id) and refuses unknown
  cards; CARD_CHECK=strict|lenient|off decides what happens when Scryfall is unreachable
- [x] Auto-pass leaks that you hold a castable instant — online games stop from public information only (cards in
  hand and open mana, abilities on the battlefield, cards castable from public zones); a spell cast without mana (Daze)
  then needs full control. Against the bot (which never reads hidden information) the stops still look at the hand
- [x] Two-Headed Giant and Commander:
  - [x] A. Engine: any number of players in teams; shared team life and poison; 1v1 unchanged
  - [x] B. 2HG rules: shared turns, priority around all players, heads act and declare attackers/blockers in turn,
    life 30, poison 15, "each opponent" per opponent, the starting team skips its first draw
  - [x] C. Commander: commander in the deck (editor + color identity), command zone, tax, back to the command zone,
    21 commander damage, life 40 (2HG: 60)
  - [x] D. Board for 4 players, game setup (mode, Commander, decks per seat)
  - [x] E. Bot: several opponents, bot teammate
  - [x] F. Online: 4-seat rooms in two teams, teammates see each other's hands
  - [x] G. Tests and browser games (online 4-player games tested by the server tests only)
  The team attacks together: each head declares its attackers in turn (the teammate sees them), then all become
  attacking at once, so the attack triggers of both boards see every attacker. Teammates' hands are shown face up.
  Simplifications: each head acts in turn in the main phases and declares its own blockers; combat damage to the defending team counts as commander damage to its first player;
  a commander always goes back to the command zone. More than two teams (free-for-all) is not supported.
- [x] Turn timer, reconnect timeout — online: TURN_SECONDS per decision (default action on timeout, conceding after
  3 in a row), RECONNECT_SECONDS to come back (concede otherwise); countdown shown to both players
- [x] Bot: mana planning — a ritual when its mana makes a spell in hand castable (second main phase); counterspell
  mana kept up during its turn when the opponent has cards (unless the play costs more than the counter); flash
  creatures held for the end of the opponent's turn. Also: multi-blocks (double blocks, menace), logic for each
  mechanic added in steps 1–6. Not planned: mana for removal held back, sequencing two spells in one turn

## Standard decks audit (mtgtop8, Oct 2026)

The 12 top decks of two recent Standard events plus a Dimir Aggro list (180 cards) were run through the parser and
the engine. Fixed:
- [x] Partly understood texts were half-simulated (Terminal Criticism only gained 1 life, Daydream exiled your
  creature for good, Three Steps Ahead did all its Spree modes for {U}, Chandra's emblem dealt 5 damage at once,
  Moseo's token ability gained life). Now any sentence not understood makes the ability "not simulated"; quoted
  abilities ("a token with \"…\"") are never read as effects
- [x] Additional costs: a permanent can't skip one (Abhorrent Oculus was a 3-mana 5/5); "exile six cards from your
  graveyard"; "discard a card or pay 3 life" (the caster chooses); "behold a Jace or pay {1}" (pays {1}); optional
  costs ("you may blight 1", "you may collect evidence") are never paid, and their bonus is left out
- [x] Moonshadow enters with six -1/-1 counters (it was a 7/7 for {B})
- [x] "Whenever you gain life" triggers; "This spell can't be countered"; "with mana value 2" (Spell Snare);
  "that's blue or red"; "It gains …" / "Untap it." after a target; Harmonize, Paradigm, Web-slinging, Gift and
  Bargain lines (the option is never used)

Approximations kept on purpose (small upsides ignored): Empower Jace, No More Lies exiling instead of the graveyard, "exile it instead if it
would die this turn".

Still missing, most played first:
- [x] "Look at the top N cards …": Stock Up, Dáin's Company, Consult the Star Charts, Sleight of Hand ("the other on the
  bottom"), Flow State (two with an instant and a sorcery in the graveyard)
- [x] Modal triggers "When … enters, choose one —" / "choose up to one —": the mode is chosen as the trigger goes on
  the stack, then its targets; modes not understood or without a legal target can't be chosen (Kutzil's Flanker,
  Gaius van Baelsar, Yuriko's surveil, Charming Scoundrel, Hullbreaker Horror's bounce). Edicts and targets read
  "token" / "nontoken" (Gaius, Pinecone Strike); "Exile target player's graveyard"
- [x] Reflexive triggers "you may discard a card / pay {…} (and N life). When you do, …": the "When you do" part
  triggers with its own targets (Inti, Icewrought Sentry, Thousand Moons Crackshot); "Whenever you attack" (Inti)
- [x] Reflexive costs "you may sacrifice another creature" (Ruthless Lawbringer) and "remove a counter" (Leatherhead's
  cost); stun counters (Snaremaster Sprite: the untap is skipped, a counter removed), finality counters (Zoraline:
  exiled instead of dying), keyword counters (hexproof, flying…), "Whenever a Bat you control attacks"
- [ ] Still missing: energy (Guide of Souls), Leatherhead's "target artifact or enchantment that player controls" (the
  damaged player), "When you discard one or more nonland cards this way" (Seasoned Cryomancer), Ty Lee ("doesn't untap
  for as long as you control Ty Lee"), Inti's "Whenever you discard one or more cards" (impulse draw)
- [x] Mill, then "you may return a … card from your graveyard to your hand" (Overlord of the Balemurk); impending (time
  counters, not a creature until the last is removed; the counter is removed at once, not by a trigger on the stack)
- [x] Spree and Tiered: each mode's cost added to the mana cost (Three Steps Ahead, Fire Magic); the bot only picks
  modes it can pay. Modes still not simulated (can't be chosen): Requisition Raid's "+1/+1 counter on each creature
  target player controls", Return the Favor (copying abilities, changing targets)
- [ ] Blink "with a +1/+1 counter on it" (Daydream); "exile … until this leaves the battlefield" for Deep-Cavern Bat
  and Pinnacle Starcage (plain blink: All Aboard; Seam Rip done)
- [ ] Emblems with static abilities (Ajani; triggered emblems work); loyalty counters from triggers (Ajani Resolute)
- [ ] "Any number of target players each …" (Ral Zarek's −1, Riverchurn Monument)
- [ ] Theorist's Sanctum entering tapped (Multiversal Passage done)
- [x] Manlands: "this land becomes a 4/4 blue and black Shark creature … until end of turn" with its colors,
  keywords, quoted static or trigger (Raging Ravine), "artifact creature" (Mishra's Factory, Inkmoth Nexus) and "all
  creature types" (Mutavault: changelings count for every creature type); never paid by tapping itself; the bot
  animates one before combat when no blocker could kill it (not to block). Lands that are creatures now count as
  creatures everywhere (Dryad Arbor). Still not simulated: X/X (Lair of the Hydra), {S} costs (Faceless Haven), ward {N}
  (Hall of Storm Giants), "It can't be blocked this turn" (Creeping Tar Pit), quoted abilities the engine can't do
  (Den of the Bugbear, Hive of the Eye Tyrant, Lavaclaw Reaches, Restless Spire), Restless Anchorage's Map token,
  Restless Ridgeline's "another target attacking creature … Untap that creature", Restless Vents' discard then draw,
  Restless Vinestalk's base power and toughness
- [ ] "Its controller loses 3 life" after removal (Inevitable Defeat: was read as exile + gain 3 life, now not
  simulated)
- [ ] Static power from conditions (Dark Matter Manipulator, Ghitu Lavarunner), "can't block" (Starscape Cleric),
  Moonshadow losing its counters
- [ ] Manifest dread (Abhorrent Oculus), "becomes a copy of a card in your graveyard" (Likeness Looter)
- [ ] Strategic Betrayal (Day of Black Sun, Shoot the Sheriff and Multiply by Zero done)
- [ ] Cost reductions (Eddymurk Crab, Hearth Elemental, Sunderflock), Offspring, Opus (Warp and Plot done)
- [ ] Mana spent conditions ("if {U}{U} was spent", Evoke Incarnations: Deceit, Emptiness)

W lifegain (mtgtop8 deck 895437, card-audit skill). Fixed: Voice of Victory (opponents can't cast spells during
your turn), Clarion Conqueror (no activated abilities of artifacts, creatures, planeswalkers, mana included), Rest in
Peace and Leyline of the Void (cards go to exile instead; "exile all graveyards", "exile each opponent's
graveyard"), Abandoned Air Temple (enters tapped unless you control a basic land). Still missing:
- [x] "If you gained life this turn" / "if you've gained 3 or more life" / "if you gained and lost life" on triggers
  (Haliya, Lunar Convocation), loyalty counters from triggers (Ajani Resolute, Ral; legends named by first name)
- [x] "Exile … until this enchantment leaves the battlefield" (Seam Rip)
- [x] "Whenever one or more … enter … This ability triggers only once each turn" (Enduring Innocence)
- [x] Enlightened Confidant: surveil, then "put that card into your hand" if its mana value ≤ life gained this turn
- [ ] Case of the Uneaten Feast (solving)
- [ ] "Another target …" for activated abilities, and discard as an activation cost (Liliana the Faultless)
- [ ] "Whenever one or more …" batches without the once-each-turn limit
- [x] Named tokens and "where X is the amount of life you gained this turn" (Germinate Recruits)
- [x] Mobilize (Voice of Victory): tapped and attacking Warriors, sacrificed at the next end step (done at once, not as a
  delayed trigger on the stack)
- [ ] Tokens with their own abilities (Ajani's Pridemate), Warp, Sneak, Cases

## Metagame audit 2026-10-15

Top 8 decks of each mtgtop8 format (`npm run audit-meta`, cards playing wrongly first, then the most played).
Fixed: Command Tower and Arcane Signet (mana in the commander's color identity), Vexing Bauble (counters spells cast
without mana), City of Brass ("whenever this land becomes tapped", "deals 1 damage to you") and Mana Confluence
("{T}, Pay 1 life: Add …"), Channel from the hand (Otawara, Eiganjo; {1} less per legendary creature).

Then: Sagas (lore counters as they enter and after the draw step, chapter abilities, sacrificed after the last
chapter; Urza's Saga's "This Saga gains …", its Construct tokens "+1/+1 for each artifact you control" and the
"mana cost {0} or {1}" search), Boseiju and Path to Exile / Erode (the removed permanent's controller may search for a
land), Starting Town ({C} free, a color for 1 life; untapped on its controller's first three turns), the bot channels
to remove something.

Mana rocks: Grim Monolith, Basalt Monolith and Mana Vault ("doesn't untap during your untap step", "{4}: Untap this
artifact", "you may pay {4}. If you do, untap", draw step triggers "if this artifact is tapped"), Mox Diamond (discard
a land card as it enters, or it goes to the graveyard), Chrome Mox (imprint, the exiled card's colors), Mox Amber
(colors of legendary creatures and planeswalkers), Mox Opal (metalcraft), Gemstone Caverns (asked before the first
turn to the player not starting; luck counter, any color). The bot casts Mox Diamond with a spare land, Chrome Mox
with a colored card to exile, and never pays Mana Vault's upkeep untap.

Then: Hexing Squelcher ("Ward—Pay N life", granted to other creatures; "Spells you control can't be countered"),
Teferi, Time Raveler (opponents cast spells only at sorcery speed; +1: sorceries as though they had flash until your
next turn), Pithing Needle (names a card as it enters; its activated abilities other than mana abilities, channel
included, can't be activated).

Then: Orcish Bowmasters and Faerie Mastermind ("whenever an opponent draws": each card but the first of their draw
step, or their second card each turn; amass), Quantum Riddler (one more card with one or fewer in hand), Containment
Priest (a creature entering without being cast is exiled instead), Grafdigger's Cage (creature cards in graveyards and
libraries can't enter; no casting from graveyards).

Then: City of Traitors (sacrificed when you play another land), Defense Grid (spells cost {3} more off their
controller's turn), Elvish / Simian Spirit Guide (exiled from the hand for one mana, spent last), Multiversal Passage
(a basic land type chosen as it enters: it is that type and makes its mana; 2 life or tapped).

Left "not simulated" or found on the way:
- [ ] Pithing Needle can only name a card seen in the game (battlefield, graveyards, exile, the chooser's hand), not
  any card name; the bot names the first opposing card with activated abilities
- [ ] Mox Diamond put onto the battlefield by an effect (Urza's Saga's search) discards the first land card in the
  hand without asking which
- [ ] Saga chapters still not simulated: transforming ("Exile this Saga, then return it … transformed": Fable of the
  Mirror-Breaker, Kumano Faces Kakkazan, The Legend of Roku), tokens with a triggered ability (Fable's Goblin
  Shaman), reflexive "When you do" (Awaken the Honored Dead III, The Last Ronin II), The Misty Mountains Cold's
  "Then if you control four or more Treasures"; read ahead
- [ ] Mana with a spending restriction ("Spend this mana only to cast …": Great Hall of the Biblioplex,
  Tablet of Discovery) is left out: those lands make only their other mana (Cavern of Souls done)
- [ ] Pain lands' "This land deals 1 damage to you." (Karplusan Forest) is still ignored

Still open, most played first:
- [x] Quantum Riddler (6): Warp (cast for its warp cost, exiled at the end step, cast again later from exile)
- [ ] Talon Gates of Madara (6): "up to one target creature phases out", "{4}: Put this card from your hand onto the
  battlefield" (its mana done, 2026-10-17 fourth batch)

## Metagame audit 2026-10-16

`npm run audit-meta` again (896 cards to fix, 385 playing wrongly). Fixed, most played first: Gene Pollinator and
Springleaf Drum (mana by tapping another untapped permanent or creature: one that makes no mana, chosen
automatically), Brazen Borrower (blocks only creatures with flying), Dragon's Rage Channeler (delirium: +2/+2, flying,
attacks each combat if able, a rule now checked when attackers are declared), Tolarian Academy ({U} for each artifact),
Gemstone Mine (mining counters), Nihil Spellbomb ("put into a graveyard from the battlefield" triggers of noncreature
permanents), Rhystic Study ("unless that player pays {1}").

Approximations: Rhystic Study's "you may draw" always draws.

Still open, playing wrongly, most played first (see `audit-reports/2026-10-16/report.md`):
- [ ] Seasoned Cryomancer (5): its graveyard ability (enters trigger done, 2026-10-17 fifth batch)
- [x] Parallax Wave (5): fading, exile until it leaves
- [ ] Bilbo, Thief in the Night (4): cost reduction for spells cast from anywhere but the hand; casting from the
  graveyard when it attacks
- [ ] Anointed Peacekeeper (4): look at a hand, any card name, costs {2} more
- [ ] Badgermole Cub (4): earthbend (its extra {G} done, 2026-10-17 fourth batch)

Second batch: Delighted Halfling (any color only for a legendary spell, which can't be countered), Mystic Remora
(cumulative upkeep: age counters, pay or sacrifice; "unless that player pays {4}"), Yavimaya, Cradle of Growth (each
land is also a Forest: {G} and Forest checks), Reflecting Pool (the mana types of your other lands), Doorkeeper Thrull
(artifacts and creatures entering trigger nothing), High Noon (one spell each turn), Sowing Mycospawn ("When you cast
this spell" triggers, kicked or not), Mockingbird (a copy with mana value up to the mana spent, a Bird with flying).

Third batch, rule-changing permanents: Thalia ({1} more for noncreature spells), Trinisphere (at least three mana
while untapped), Damping Sphere (a land tapped for two or more mana makes {C}; {1} more for each other spell cast this
turn), Null Rod (no activated abilities of artifacts, mana ones included), Drannith Magistrate (opponents cast only
from their hands), Magus of the Moon (nonbasic lands are Mountains: only {R}, no other ability, no "enters tapped"),
Urborg (each land is also a Swamp), Gaea's Cradle ({G} per creature), Fellwar Stone (the colors of the opponents'
lands), Meddling Mage (names a nonland card seen in the game: it can't be cast), Esper Sentinel (the opponent's first
noncreature spell each turn: pay X or it draws).

Approximations: Meddling Mage, like Pithing Needle, can only name a card seen in the game; Magus of the Moon and
Yavimaya/Urborg don't follow timestamps (the added types always apply);
Delighted Halfling makes the legendary spell uncounterable whichever of its two abilities paid;
Yavimaya's {G} replaces nothing for a land with several mana per tap (City of Traitors); Mockingbird counts the mana
spent as its mana cost with X.

## Metagame audit 2026-10-17

`npm run audit-meta` again (781 cards to fix, 325 playing wrongly). Fixed, most played first: "Discard a card" and
"Exile three cards from your graveyard" as activation costs (Psychic Frog, Iron-Shield Elf, Fleeting Spirit),
combat damage "to a player or planeswalker" triggers, spells costing {1} less per instant and sorcery card (Eddymurk
Crab) or per card type (Emrakul, the Promised End) in the graveyard, more "enters tapped" conditions (Eddymurk Crab
off its controller's turn, Lair of the Hydra, Rejuvenating Springs), Sunspine Lynx ("Players can't gain life",
"Damage can't be prevented": protection, shields and Fog), Exalted Angel's life gain, Cryptolith Rite and Enduring
Vitality (creatures you control tap for any color).

Second batch, rules of the game: Bilbo (spells cast from anywhere but the hand cost {1} less), Valley Floodcaller
(noncreature spells with flash), Karn, the Great Creator and Cursed Totem (no activated abilities of the opponents'
artifacts / of creatures), Ashiok, Dream Render (no searching with one's own spells), Archon of Emeria, Manglehorn and
Root Maze (permanents entering tapped), Frenzied Baloth (creature spells can't be countered, combat damage can't be
prevented), Exploration (a second land each turn), the Lhurgoyfs' power (Barrowgoyf, Nethergoyf, Pyrogoyf), tribal
keyword lords ("Demons you control have …": Ardyn), "<name> can't block" (Skrelv), Survival of the Fittest ("Discard a
creature card" as a cost), Seasoned Hallowblade, Priest of Titania ({G} per Elf), Disruptor Flute and Anointed
Peacekeeper (the chosen name costs more; the Peacekeeper offers the opponent's hand first).

Mana, fourth batch: mana abilities costing mana ("{1}, {T}: Add one mana of any color": Talon Gates of Madara, The
Mycosynth Gardens, Conduit Pylons, Giant's Boulder; the payment planner spends one more mana for each such color) and
Skycloud Expanse ("{1}, {T}: Add {W}{U}", like Mystic Gate); extra mana when a permanent is tapped for mana (Wild
Growth and other Auras, Badgermole Cub, Kinnan, Mana Flare, Zendikar Resurgent) and Nyxbloom Ancient / Mana Reflection
(three / two times as much).

Fifth batch: Hypnotic Specter (damage to an opponent: a random discard), Seasoned Cryomancer's enters trigger (taps
and stuns one creature per nonland card discarded), Wall of Roots ({G} for a -0/-1 counter, once each turn, without
tapping), Utopia Sprawl ("Enchant Forest", a color chosen as it enters), Lion's Eye Diamond (activated by hand like
tapping for mana: a color, the hand discarded, three mana). Abilities activated from the graveyard (Seasoned
Cryomancer, renew) and Arena of Glory's exert mana ability now show as not simulated.

Approximations: Exalted Angel's "Whenever this creature deals damage, you gain that much life" is played as lifelink
(no trigger on the stack); a creature making several mana keeps its own ability under Cryptolith Rite; the bot never
activates abilities with a discard cost (Psychic Frog, Survival of the Fittest). Talon Gates tapped by hand (not while
paying) makes {C}: its any-color mana is only chosen when paying. Kinnan's and Mana Flare's "one mana of any type that
permanent produced" may be any of the colors it could make (Birds of Paradise tapped for {G}: Kinnan's mana may be
blue). These extra mana abilities are not triggers on the log. Lion's Eye Diamond is never used to pay automatically
(the bot never activates it). Hypnotic Specter's trigger only counts damage the creature itself deals.

Still open, playing wrongly, most played first (see `audit-reports/2026-10-17/report.md`):
- [ ] Talon Gates of Madara (6): its phasing and "{4}: Put this card from your hand onto the battlefield" (its mana done,
  fourth batch); The Mycosynth Gardens becoming a copy of an artifact
- [ ] Seasoned Cryomancer (5): "{3}{U}{U}, Exile this card from your graveyard: Draw two cards." (abilities activated
  from a graveyard; its enters trigger done, fifth batch)
- [ ] Badgermole Cub (4): earthbend (its extra {G} done, 2026-10-17 fourth batch)
- [ ] Arena of Glory (4): exert, and haste for a creature spell its mana paid for
- [ ] Clones with more than added types: Phantasmal Image (sacrificed when targeted), Flesh Duplicate (vanishing),
  Gigantoplasm, Superior Spider-Man (a creature card in a graveyard) — Glasspool Mimic, Clever Impersonator and Copy
  Enchantment done (third batch)

## Metagame audit 2026-10-18

`npm run audit-meta` after the fifth batch: 743 cards to fix (781 the day before), 263 playing wrongly (325). Fully
simulated main deck copies: Standard 60%, Pioneer 51%, Modern 62%, Legacy 63%, Vintage 62%, Pauper 55%, Premodern 66%,
Duel Commander 67%, cEDH 57%.

Fixed: mana that can only be spent on some spells or abilities (Mishra's Workshop, Eldrazi Temple, Herd Heirloom,
Plaza of Heroes, Rockface Village, Shang-Chi; the payment planner offers it only for those), "Whenever you cast your
second spell each turn" (Cori-Steel Cutter's flurry, with its Equipment moved to the Monk, asked when it already equips
a creature; Kraum and Lotho for an opponent's or any player's).

Approximations: restricted mana is only used while paying (tapped by hand, Mishra's Workshop makes nothing and Eldrazi
Temple {C}); what a payment leaves of it is lost (Mishra's Workshop paying for a two-mana artifact), or left
unrestricted (Eldrazi Temple's second {C}). Shang-Chi's "two mana of any one color" may be two colors. The bot keeps
Cori-Steel Cutter on the creature it equips.

Small triggers: Sewer-veillance Cam ("enters or leaves the battlefield": a new trigger; "tap or untap target creature"),
Monument to Endurance ("Whenever you discard a card", modes not chosen this turn), Biotech Specialist (a Lander token;
"Whenever you sacrifice an artifact"), The Sackville-Bagginses ("you may sacrifice … If you do", "Whenever you sacrifice
a token"), Obsessive Pursuit ("enters and at the beginning of your upkeep"; counters for each permanent sacrificed this
turn), Wishclaw Talisman (wish counters, "Activate only during your turn", given to an opponent), "Search your library
for a card" (Demonic Tutor, Diabolic Intent).

Approximations: Sewer-veillance Cam taps an untapped creature and untaps a tapped one (no choice); Wishclaw Talisman goes
to the first opponent, and the bot never activates it. Thought-Knot Seer's "leaves the battlefield" draw stays not
simulated while its enters trigger is.

Cost reductions and Eldrazi: Hearth Elemental ({X} less for instants, sorceries and Adventure cards in the graveyard),
Sunderflock ({X} less for the greatest Elemental; "if you cast it", a new trigger condition), Eldrazi Spawn tokens
("Sacrifice this token: Add {C}.", a mana source usable the turn it's made, spent last), adapt, "Whenever one or more
+1/+1 counters are put on this creature" (Basking Broodscale), colorless spells and creatures (Glaring Fleshraker),
Unfathomable Truths, Kozilek's Command's Spawn mode.

Approximations: Eldrazi Spawn are sacrificed automatically when a payment needs them (after every other source); only
counters put by an effect or adapt trigger Basking Broodscale (not ones it enters with).

Clones and enlist: Phantasmal Image (an Illusion with "When this creature becomes the target of a spell or ability,
sacrifice it.", a new trigger), Flesh Duplicate (vanishing 3 unless the creature has vanishing; vanishing itself),
Superior Spider-Man (a 4/4 copy of a creature card in any graveyard, named Superior Spider-Man, that card exiled),
Guardian of New Benalia (enlist, asked for each attacker with it once attackers are declared; "Whenever this creature
enlists a creature").

Approximations: Superior Spider-Man exiles the card at once (not a reflexive trigger); enlist adds the power the creature
has when it is tapped; vanishing sacrifices in the same ability that removes the last counter. The bot enlists its
strongest creature without a tap ability, and doesn't plan attacks around enlist.

Eldrazi and single cards: Warping Wail's Scion ("It has \"…\"" read as "with \"…\""), Malevolent Rumble (the rest into
the graveyard), Glimpse the Impossible (cards playable from exile this turn, lands too; the rest to the graveyard at the
next end step, a Spawn each), Incubation Druid (three mana with a +1/+1 counter), Phyrexian Devourer ("Exile the top
card of your library" as a cost, X its mana value; "When this creature's power is 7 or greater", a state trigger),
Sneaky Snacker (a trigger from the graveyard on your third card drawn in a turn), Void Mirror (no colored mana spent).

Approximations: Incubation Druid's three mana may be of different types; a mana that could have been colored counts as
colored for Void Mirror (the caster picks); the end step move of Glimpse the Impossible isn't a trigger on the stack.
The bot never activates Phyrexian Devourer (free abilities aren't planned).

cEDH: Birgi (its {R} lasts until end of turn, not emptied as steps and phases end; boast isn't simulated, so "boast
twice" does nothing), Samut (split second for your instants and sorceries, and the keyword itself: no spell and no
ability but mana abilities while it's on the stack), Biomancer's Familiar (creature abilities {2} cheaper, never below
one mana; the next adapt as though it had no counters).

Approximations: Biomancer's Familiar doesn't reduce mana abilities that cost mana.

Still open, playing wrongly, most played first (see `audit-reports/2026-10-18/report.md`):
- [ ] cEDH: Underworld Breach (escape for every card), Lurrus (a permanent with mana value 2 or less from the graveyard
  each turn; companion)

## Metagame audit 2026-10-18, evening

`npm run audit-meta` again after the day's batches (the top 8s changed meanwhile): 732 cards to fix (743 in the
morning), 255 playing wrongly (263). Fully simulated main deck copies: Standard 72%, Pioneer 56%, Modern 60%, Legacy 67%,
Vintage 68%, Pauper 61%, Premodern 68%, Duel Commander 69%, cEDH 60%.

Still open, playing wrongly, most played first (see `audit-reports/2026-10-18/report.md`):
- [ ] Shifting Woodland (7 decks: delirium, becomes a copy of a permanent card in your graveyard), Chalice of the Void
  (5: X charge counters, counters spells with that mana value), Nethergoyf (escape with four card types exiled),
  Moonshadow (12 copies: its -1/-1 counters never go), Detective's Phoenix (bestow, collect evidence, from the
  graveyard)
- [ ] Dark Matter Manipulator (+2/+0 for every seven cards in your graveyard), Fear of Missing Out (delirium: first
  attack each turn, an additional combat), Devoted Druid ("Put a -1/-1 counter on this creature" as a cost), Obsidian
  Charmaw (cost reduction per opponent's land making {C}), Screaming Nemesis, Tamiyo (third card drawn: transforms)
- [ ] cEDH: Lurrus and Underworld Breach (casting from the graveyard), Tinder Wall ("Sacrifice this creature: Add
  {R}{R}"), Grand Abolisher, Necropotence (skip your draw step), The Cabbage Merchant, Shang-Chi (haste for abilities)

## Tezzeret artifacts (a user's deck, `deck-2.txt`)

Audited (fixture `tezzeret-artifacts-2026-10`): 6 of 16 cards fully simulated before, 13 after. Fixed: Phyrexian
Metamorph (a copy of an artifact or creature, also an artifact), Wall of Essence (life equal to the combat damage it is
dealt, no trigger on the stack), Tezzeret, Betrayer of Flesh (the first artifact ability each turn costs {2} less; +1
discards one artifact card or two cards), Tezzeret the Seeker's −X (an artifact with mana value X or less onto the
battlefield), Dispatch (metalcraft: exile), Turn Aside ("spell that targets a permanent you control"), Crown, Scepter
and Throne of Empires (more with the other two: the creature stolen, 3 damage, five Soldiers).

Approximations: Tezzeret's discount isn't used up by a mana ability (tapping an artifact for mana first); the bot
never activates Tezzeret the Seeker's −X.

Second batch: the whole deck is simulated. Vedalken Shackles (control while it stays tapped, power up to the number of
Islands; it stays tapped in the untap step while it holds a creature), Tezzeret, Betrayer of Flesh's −2 (a 4/4 artifact
creature for good) and −6 (an emblem: draw when an artifact you control becomes tapped), Tezzeret the Seeker's −5
(artifacts become 5/5 artifact creatures until end of turn).

Approximations: Vedalken Shackles never untaps while it holds a creature (its controller isn't asked).

## Commander: Aang, Swift Savior (a user's deck, `deck.txt`)

Fixtures: `commander-aang-2026-10`. Fixed (they played wrongly): Harbinger of the Seas (nonbasic lands are Islands),
True-Name Nemesis (protection from a chosen player: no targets, no blocks, no damage from them), Skullclamp
("Whenever equipped creature dies"), Skyclave Apparition (the exiled card's owner gets an X/X Illusion when it leaves),
Aven Interrupter's tax on spells from graveyards and exile, King T'Challa (any player's second card), The Queen of Dale
(recruit), On Thin Ice ("Enchant snow land you control"), Parallax Wave (fading, "Remove a fade counter" as a cost,
exiled until it leaves), Moorland Haunt ("Exile a creature card from your graveyard" as a cost), investigate (Thraben
and Novice Inspector). Decklist import: names of other printings ("Ademi of the Silkchutes" is Spectacular
Spider-Man) and flavor names ("Mayor Tong of Chin Village" is Drannith Magistrate) are found.

Second pass (every mechanism of the deck, tested with the Oracle texts):
- Counterspells: Memory Lapse and Remand (the spell goes back), Reprieve, Sink into Stupor, Tale's End and Tishana's
  Tidebinder (abilities on the stack; Tidebinder takes the abilities away), Stern Scolding, Subtlety (the owner puts
  it on top or bottom), Cryptic Command's tap mode, Swords to Plowshares and Solitude (life equal to the power).
- Alternative and additional costs: Daze, Force of Negation, Reverent Mantra, evoke (Solitude, Subtlety), cleave (Wash
  Away), warp (Quantum Riddler), web-slinging (Spider-Sense), Phyrexian mana (Gitaxian Probe), March of Otherworldly
  Light's exiled white cards.
- Library: Brainstorm, Ponder, Preordain, Consult the Star Charts (X = lands, two when kicked), Enlightened Tutor (on
  top), Stoneforge Mystic (an Equipment from the hand), typecycling (Step Through's Wizardcycling).
- Permanents: Mother of Runes and Reverent Mantra (protection from a chosen color until end of turn), Snapcaster Mage
  (flashback for the mana cost this turn), Phelia (exiled until the next end step, a counter if it came back under
  your control), Ocelot Pride (ascend, city's blessing, copies of this turn's tokens), Pre-War Formalwear (returns a
  creature and is attached to it), Ghost Vacuum ("exiled with this artifact", 1/1 Spirits with a flying counter),
  Malcolm (chorus counters, the discarded card cast for free), Mystic Gate (filter mana: it and a W/U land make two),
  Swift Reconfiguration (a noncreature Vehicle with crew 5; "creature or Vehicle" targets), Aang's airbend (castable
  from exile for {2}), Aven Interrupter's plot (free as a sorcery on a later turn).

- Transform: Aang's waterbend {8} (artifacts and creatures tapped pay {1} each) into Aang and La (counters on tapped
  creatures when they attack), King T'Challa into Black Panther (damage to it prevented). Skycoach Conductor enters
  prepared (a copy of All Aboard: exile a non-Pilot creature and return it). Get Lost's Map tokens (explore).

All 91 cards are simulated. 64 bot-vs-bot Commander games with the deck (mirror) run to the end without errors; they
found two bot gaps, fixed: it never cast its commander from the command zone, and it gave one target to "two target
creatures" (Step Through).

Approximations: Malcolm's free spell is cast right after its trigger resolves (the next action), not during it;
Mystic Gate always pays its {W/U} with the land making fewest colors; waterbend never taps the permanent itself.

## Standard: Boros Dwarves (mtgtop8 deck 899948)

Fixed: granted ward and "hexproof from monocolored" (Lavaspur Boots, Sheltered by Ghosts, Dragonfire Blade), equip
cost reductions (Dragonfire Blade per color, Dwarven Mauler, Kíli's Storied and free first equip), The Lonely
Mountain (enters tapped unless you control an Equipment; Dwarf tokens {1} cheaper per Equipment), Dáin's Company's
lifelink with another Dwarf, Kellan's "+1/+0 for each Aura and Equipment attached", Chainsaw's rev counters ("one or
more creatures die" once per batch), Cloud's Equipment search and doubled triggers, Iron Man Armor attaching itself,
Sunbillow Verge's conditional {R}, Leylines in the opening hand (always put onto the battlefield). Fixture:
`standard-dwarves-2026-10`.

Second pass: Thorin (attach Equipment, reflexive damage), Dáin's Company and Stock Up (look at the top cards), Iron
Man Armor and Vehicles becoming creatures until end of turn (crew), Mjölnir (double damage, equip worthy, discard
ability from the hand), Cavern of Souls (chosen creature type, mana only for it, can't be countered), Chandra, Spark
Hunter (beginning of combat triggers, Vehicle tokens, emblems, "sacrifice or discard: draw"). All 24 cards read.

Approximations: "the rest on the bottom in any order" is put in a random order; Leylines are always put onto the
battlefield.

## Duel Commander: mono-green landfall (mtgtop8 deck 901562)

Fixture `duel-commander-landfall-2026-10`: 49 of 88 cards fully simulated before, 77 after. Fixed (they played wrongly):
Hickory Woodlot (entered untapped; enters tapped with two depletion counters, {G}{G} for each, sacrificed after the
last), Elvish Reclaimer (+2/+2 with three or more land cards in the graveyard), Surrak (a card when an opponent targets
your creature or creature spell), Centaur Garden (threshold: activate only with seven or more cards in the graveyard).
Also: pump spells (Groundswell's landfall, Might of Old Krosa in a main phase, Tyvar's Stand's +X/+X, Vines of Vastwood
kicked, Grow Extra Arms, Invigorate's "an opponent gains 3 life" instead of its cost, Hapatra's Mark removing -1/-1
counters, Tamiyo's Safekeeping and Defend the Rider on any permanent), Bridgeworks Battle ("It fights up to one target
creature"), Green Sun's Zenith (a green creature, then shuffled into the library), landfall permanents (Adventuring
Gear and Skyclave Pick-Axe on the equipped creature, Tifa doubling her power, Mossborn Hydra and Bristly Bill doubling
counters, Scythecat Cub's second resolution each turn), Arbor Elf ("target Forest"), Okina ("target legendary
creature"), Escape Tunnel ("can't be blocked this turn"), Command Beacon, Fabled and Elven Passage (untap the land
found), Brokers Hideout and Cabaretti Courtyard ("sacrifice it. When you do, search …"). Library searches now check
colors ("a green creature card").

Approximations: Grow Extra Arms never costs {1} less (a Spider target); Invigorate's life goes to the first opponent;
Elven Passage always beholds an Elf when it can; Brokers Hideout's search happens even if it couldn't be sacrificed.

Second pass: the whole deck is simulated. Berserk (cast only before combat damage; double power and trample; destroyed
at the next end step if it attacked), Embiggen (+1/+1 per supertype, card type and subtype), Bounty of the Hunt
(counters distributed among one to three creatures, the caster choosing which of two gets two; removed at the next
cleanup), Scale Up (a green Wurm with base 6/4; overload: each creature you control), Wild Shape (base power and
toughness, creature type and keyword until end of turn), Royal Treatment (Role tokens: Royal and Monster; a new Role of
the same player replaces the old one), Legolas's Quick Reflexes (a granted "becomes tapped" trigger), Hope of Ghirapur
(players it dealt combat damage this turn; no noncreature spells until your next turn), Talon Gates of Madara (phasing:
the permanent and what's attached to it leave until their controller's next untap step; "{4}: Put this card from your
hand onto the battlefield", like channel, not a land play), Defend the Rider's Pilot (crews as though its power were 2
greater), Jeweled Amulet (the type of mana spent noted, one mana of it later). 24 bot-vs-bot games with the deck run to
the end without errors.

Approximations: Berserk can't be cast in any second main phase (combat damage is then over); Jeweled Amulet notes the
first mana spent (a mana that could be several colors: its first one); phased-out permanents are simply set aside
(effects that count "until your next turn" from them aren't adjusted); saddle isn't simulated (the Pilot only crews).
The bot never activates Hope of Ghirapur or Talon Gates' {4} ability.

## Comprehensive Rules audit (CR 2026-09-25)

Rules from the Comprehensive Rules (https://magic.wizards.com/en/rules, effective 2026-09-25) that the engine does not
simulate or simplifies, by CR number. Highest priority first in each group: rules that change many Modern games
come before rare ones.

### Turn structure and priority (500–514, 117)

- [ ] 502–504 Untap, upkeep, draw: priority in the upkeep and draw steps (today only an opponents' window before
  the first main phase); "at the beginning of your draw step" triggers
- [ ] 507 Beginning of combat step as its own step for both players (today a window in full control only), with
  "at the beginning of combat" triggers
- [ ] 508.1d/509.1c Attack and block requirements ("attacks each combat if able", "must be blocked"); attack costs
  (Ghostly Prison, 508.1g)
- [ ] 511 End of combat step and "at end of combat" triggers (Ball Lightning–style "sacrifice at end of combat")
- [ ] 513 End step: priority for the active player too, and "at the beginning of the next end step" delayed triggers
- [ ] 514.3a Cleanup: when something happens in cleanup (a trigger, damage removal), players get priority and a
  new cleanup step follows
- [ ] 500.8 Additional combat phases and main phases (Relentless Assault); 500.11 skipped steps or turns
- [ ] 117.3c/117.5 Holding priority after casting (today the caster passes automatically except in full control)

### Spells, abilities and effects (601–616)

- [ ] 613 Layer system: copy, control, text, type, color, ability, P/T sublayers 7a–7d with timestamps and
  dependencies (today boosts, counters and statics simply add up; "becomes a 0/1", "base power is" are wrong)
- [ ] 614 Replacement effects in general: "instead", "enters with counters", "if it would die, exile it instead"
  (Rest in Peace, Leyline of the Void), "as it enters, choose…", 614.5 a replacement applies only once
- [ ] 615 Prevention: protection prevents damage (done), Fog (done); "prevent all damage that would be dealt by
  [source]", damage redirection
- [ ] 603.7 Delayed triggers in general ("at the beginning of the next end step, return it")
- [ ] 603.8 State triggers ("when you control no …")
- [ ] 603.4 Intervening "if" clauses checked on resolution
- [ ] 603.6c/603.10 Leaves-the-battlefield triggers "look back in time" (board wipes with dies triggers)
- [ ] 605.3 Mana abilities with a target or trigger (Overgrowth, Mana Reflection)
- [ ] 606 Loyalty abilities: done; 606.3 one per turn per planeswalker — check "activate an additional time" effects
- [ ] 608.2b A spell with only illegal targets fizzles (done); partial fizzle of a multi-target spell keeps its
  other parts (check every effect type)
- [ ] 101.2 "Can't" beats "can" ("can't gain life", "can't be countered", "can't cast spells")
- [ ] 611.2c Continuous effects from resolved spells lock their affected set (Glorious Anthem vs "creatures you
  control get +1/+1 until end of turn" for creatures entering later)
- [ ] 616 Ordering several replacement effects (affected player or controller chooses)
- [ ] 702.61 Split second, 609.4 "as though" exceptions ("as though it had flash")

### State-based actions (704)

Done: 704.5a–j, m, n, q and 704.6a–d.
- [ ] 704.5s Sagas: lore counters, chapter abilities, sacrifice after the last chapter (Saga cards are not simulated)
- [ ] 704.5p Equipment or Fortification attached illegally, a creature or battle attached to something: unattach
- [ ] 704.5r +1/+1 and -1/-1 counter maximums ("can't have more than N counters")
- [ ] 704.5v–y Battles: protector, defense counters, Siege
- [ ] 704.5z Roles: one Role per controller on a permanent
- [ ] 704.5k World rule; 704.5t dungeons (venture, initiative); 704.5u Space Sculptor; 704.5aa speed

### Card types and special objects (300–315)

- [ ] 301.7 Vehicles and crew (702.122); 301.5 Fortifications
- [ ] 310 Battles (attack a battle, defense counters, defeated → cast the back face)
- [ ] 714 Sagas and 716 Classes (level up)
- [ ] 712 Double-faced cards that transform (701.27): daybound/nightbound (702.145, day/night 731), "transform
  it", meld (701.42); only modal double-faced cards are supported
- [ ] 114 Emblems (planeswalker ultimates)
- [ ] 111.10 Predefined tokens: Blood, Map, Powerstone, Incubator, Gold, Shard; Clue, Food, Treasure done
- [ ] 725–726 The monarch and the initiative (Undercity dungeon)
- [ ] 702.26 Phasing
- [ ] 708 Face-down spells and permanents: morph, megamorph, disguise, manifest, manifest dread, cloak
- [ ] 713 Substitute cards; 715 adventurer cards done; 718 prototype; 719 case; 720 omen; 721 station

### Keyword abilities (702) not simulated

Evasion and combat (most common first):
- [ ] Intimidate, fear, shadow, skulk, horsemanship, landwalk (islandwalk…)
- [ ] Wither, afflict, flanking, rampage, bushido, exalted, annihilator, battle cry, myriad, melee, training,
  mentor, dethrone, provoke, frenzy
- [ ] Undying, persist (needs "return with a counter" replacements)
- [ ] Protection from creatures / artifacts / a card type / "everything" (colors done); hexproof from [quality]
Casting and costs:
- [ ] Cascade, storm, discover (701.57), replicate, ripple
- [ ] Suspend (time counters), foretell, plot, madness, miracle, evoke, dash, blitz, escape, unearth, embalm,
  eternalize, encore, disturb, retrace, jump-start, aftermath, rebound, buyback
- [ ] Overload, entwine, spree, escalate, splice, bargain, casualty, emerge, offering, spectacle, surge, prowl,
  improvise, assist, squad, offspring, gift
- [ ] Ninjutsu, bestow, mutate, reconfigure, living weapon, for mirrodin!, crew
- [ ] Cumulative upkeep, echo, fading, vanishing, level up, outlast, scavenge, reinforce, transfigure
- [ ] Partner, partner with, companion (702.139: sideboard companion, 3 mana to put it in hand), backgrounds
Others:
- [ ] Changeling, devoid, extort, fabricate, evolve, graft, modular, sunburst, amplify, bloodthirst, tribute,
  riot, afterlife, exploit, champion, soulbond, hideaway, decayed, ravenous, saddle, ward with a non-mana cost

### Keyword actions (701) not simulated

- [ ] Regenerate (701.19), goad (701.15), investigate (701.16, Clue tokens exist), explore (701.44), amass (701.47),
  adapt (701.46), monstrosity (701.37), bolster (701.39), support, populate (701.36), connive (701.50),
  incubate (701.53), venture into the dungeon (701.49), the Ring tempts you (701.54), double (701.10),
  exchange (701.12), vote (701.38), clash, planeswalk, manifest dread, collect evidence (701.59), suspect (701.60),
  forage, endure, harness, airbend…
- [ ] Reveal and "look at" (701.20) as player choices (today revealed cards are only logged)

### Starting and ending the game (103–104)

- [ ] 103.5 Mulligan options in multiplayer: one free mulligan done for Commander and 2HG; "Vancouver" not needed
- [ ] 103.6 Opening-hand actions: Gemstone Caverns, Chancellor reveals (Leylines done: always put onto the battlefield,
  never asked)
- [ ] 104.2b/104.3e Alternate win and loss conditions on cards ("you win the game", Laboratory Maniac, Thassa's
  Oracle, Platinum Angel "can't lose")
- [ ] 104.4b Draw by repeated loop (no mandatory-loop detection; the bot could loop forever)
- [ ] 104.3c Drawing from an empty library loses (done); 104.3a conceding (done)

### Multiplayer (800–810, 903)

- [ ] 805.10 Two-Headed Giant: the team declares attackers and blockers together (today each head in turn)
- [ ] 810.9c–h Shared-life corner cases: set a player's life total, exchange life with a teammate, "can't gain life"
  for the whole team
- [ ] 903.9a Commander: the owner chooses to move the commander to the command zone (today always)
- [ ] 903.10a Commander damage is tracked per commander and per player hit (today the defending team's first player)
- [ ] 702.124 Partner / Background / Friends forever (two commanders)
- [ ] 903.5c–d Color identity checks done in the editor; 903.5b singleton checked by the legality check
- [ ] 806–809 Free-for-all, range of influence, attack multiple players, Emperor: not supported
- [ ] 901–902 Planechase, Vanguard, Archenemy (904), Conspiracy drafting (905): out of scope
