import type { Card } from '../../types';
import { shuffle, type Rng } from '../goldfish';
import {
  cardTypes, chosenModes, chosenTypeMana, choosesCreatureType, findPayment, hasInstantSpeed, manaConditions, manaLifeCost, manaPain, manaUnits, planPayment, hasKeyword, isCreature, isInstantOrSorcery, isLandCard,
  activatedOf, auraTarget, castInfo, castSpec, entersAsCopy, faceName, modeSets, toxicOf, faceCard, isAdventure, isLandCard as isLand, playableFaces, cardColors, stateMana, entersTappedRule, entersCounters, protectionsOf, staticsOf, wardCost, wardLife, protectsSpells, namesCardToStop, drawsOneMore, handMana, choosesBasicType, tapsAnotherForMana, filterMana, reconfiguresEnchanted, preventsDamageToSelf, entersPrepared, cardFaces, blocksOnlyFlyers, legendaryMana, isLegendary, entersAsBirdCopy, namesSpellToStop, protectionFromChosenPlayer, illusionWhenLeaving, fadingOf, isPlaneswalker, isSaga, isStoried, finalChapter, equipDiscount, freeFirstEquip, doublesEquippedTriggers, beginsOnBattlefield, beginsWithLuck, discardsLandInstead, doesntUntap, isToken, startingLoyalty, parseCost, power, spellSpec, tokenCard, toughness, triggersOf,
  gameRulesOf, type GameRule, type AbilitySpec, type AdditionalCost, type Affected, type Amount, type Color, type CounterKind, type Effect, type Keyword, type ManaPick, type ManaSource, type Selector,
  type ActivatedSpec, type AltCost, type CastChoice, type Cost, type ObjectEvent, type StepEvent, type TargetFilter, type TargetSpec, type TriggerEvent,
} from './rules';

/** A player: an index in GameState.players (0–1 in a duel, 0–3 in Two-Headed Giant). */
export type PlayerId = number;

export interface CardInst {
  iid: string;
  card: Card;
  /** In exile "on an adventure": its creature can be cast from there. */
  adventure?: boolean;
  /** Warp: exiled at the end step after it was warped in, castable from exile on a later turn (that turn number). */
  warpedOnTurn?: number;
  /** A commander: it goes back to the command zone instead of other zones. */
  commander?: boolean;
  /** Snapcaster Mage: has flashback for its mana cost on that turn. */
  flashbackOnTurn?: number;
  /**
   * In exile, its owner may cast it for this cost ('' = without paying its mana cost): Aang's airbend ({2}), Aven
   * Interrupter's plot (free, as a sorcery, on a later turn than `afterTurn`).
   */
  castFor?: { cost: string; afterTurn?: number; sorcery?: boolean };
}

/** A lasting change to a permanent's power, toughness or abilities. */
export interface Boost {
  power: number;
  toughness: number;
  keywords: Keyword[];
  until: 'endOfTurn';
  /** Mother of Runes: protection from these colors. */
  protection?: Color[];
  /** Multiply by Zero: base power and toughness set (layer 7b); the latest one wins, other changes apply on top. */
  setBase?: { power: number; toughness: number };
}

export interface Permanent extends CardInst {
  controller: PlayerId;
  tapped: boolean;
  /** Summoning sick: entered this turn, can't attack or tap for mana. */
  sick: boolean;
  damage: number;
  deathtouched: boolean;
  counters: Partial<Record<CounterKind, number>>;
  boosts: Boost[];
  /** The turn it entered the battlefield (Ocelot Pride: "each token you control that entered the battlefield this turn"). */
  enteredOnTurn?: number;
  /** Indexes of "once each turn" abilities already activated this turn. */
  used?: number[];
  /** Triggered abilities (by index) that "trigger only once each turn" and already did this turn. */
  triggeredOnce?: number[];
  /** The full card when the permanent is one face of it (modal double-faced back face), or a clone's own card. */
  printed?: Card;
  /** Its owner, when someone else controls it (gain control). */
  owner?: PlayerId;
  /** Control goes back to the owner at the end of the turn (Threaten). */
  controlUntilEndOfTurn?: boolean;
  /** Aura or Equipment: the permanent it is attached to. */
  attachedTo?: string;
  /** Cavern of Souls: the creature type chosen as it entered. */
  chosenType?: string;
  /** Skyclave Apparition: the card it exiled (its mana value and owner), for its leaves trigger. */
  exiledCard?: { cmc: number; owner: PlayerId };
  /** True-Name Nemesis: the player chosen as it entered (it has protection from them). */
  chosenPlayer?: PlayerId;
  /** Pithing Needle: the card name chosen as it entered ('' when there was nothing to name). */
  chosenName?: string;
  /** Chrome Mox: the card exiled with it (imprint). */
  imprinted?: Card;
  /** A noncreature permanent that is a creature until end of turn (crewed Vehicle, Iron Man Armor): its own card. */
  unanimated?: Card;
  /** Transformed: showing its back face (Aang and La, Black Panther). */
  transformed?: boolean;
  /** Impending: not a creature while it has time counters (its card is the printed one again after the last). */
  impending?: boolean;
  /** Skycoach Conductor: a copy of its other face's spell can still be cast. */
  prepared?: boolean;
  /** Swift Reconfiguration: its card before it became a Vehicle artifact (restored when the Aura leaves). */
  reconfigured?: Card;
  /** What static abilities (anthems, Auras, Equipment) give it right now; recomputed by the engine. */
  statics?: { power: number; toughness: number; keywords: Keyword[]; cantAttack?: boolean; cantBlock?: boolean; mustAttack?: boolean; ward?: number[]; wardLife?: number[]; hexproofFromMonocolored?: boolean; doubleDamage?: boolean };
}

export interface StackItem extends CardInst {
  controller: PlayerId;
  /** Chosen targets, one list per target slot of the spell or ability. */
  targets: Target[][];
  /** Set for an ability: the rules to resolve. `card` is its source, which stays where it is. */
  ability?: AbilitySpec;
  /** The value chosen for X when cast. */
  x?: number;
  /** For an ability: the permanent it comes from ("this creature gets +1/+1"). */
  source?: string;
  /** A triggered ability (otherwise an activated one). */
  triggered?: boolean;
  /** The alternative cost paid (an index in CastInfo.alts): evoke, warp, cleave… */
  alt?: number;
  /** A copy of a spell: it ceases to exist when it leaves the stack. */
  copy?: boolean;
  /** How the spell was cast: which face, modes, kicked, and from which zone. */
  face?: number;
  modes?: number[];
  kicked?: boolean;
  from?: CastZone;
  /** A spell cast without spending mana (free spells, all convoke or delve): Vexing Bauble counters it. */
  noMana?: boolean;
  /** Cast with Cavern of Souls' mana: "that spell can't be countered". */
  uncounterable?: boolean;
  /** Malcolm: cast from the graveyard right away for free; it goes back to the graveyard (not exiled like flashback). */
  castNow?: boolean;
}

/** Where a spell is cast from: hand, graveyard (flashback) or exile (a creature back from its adventure). */
/** `prepared`: a copy of a prepared permanent's spell (Skycoach Conductor's All Aboard). */
export type CastZone = 'hand' | 'graveyard' | 'exile' | 'command' | 'prepared';

/** One way to cast a card right now. */
export interface CastOption {
  face: number;
  kicked: boolean;
  from: CastZone;
  /** An alternative cost paid instead of the mana cost (an index in CastInfo.alts). */
  alt?: number;
  /** March of Otherworldly Light: cards exiled from the hand for a cheaper cost. */
  exiled?: number;
}

/** A triggered ability waiting to be put on the stack (the next time a player would get priority). */
export interface Triggered {
  source: CardInst;
  controller: PlayerId;
  ability: AbilitySpec;
  /** Targets fixed by the rules instead of chosen (ward targets the spell that targeted it). */
  targets?: Target[][];
  /** A "one or more" trigger: its source and index, so creatures dying together trigger it once. */
  batch?: string;
}

/** One mana in a pool: its possible colors, and the permanent that made it (to untap it again). */
export interface PoolMana {
  colors: Color[];
  source?: string;
  /** Starting Town: spent as one of these colors, it costs this much life. */
  pain?: { life: number; colors: Color[] };
  /** Cavern of Souls: these colors only for a creature spell of that type. */
  forType?: { type: string; colors: Color[] };
  /** Delighted Halfling: these colors only for a legendary spell (which then can't be countered). */
  forLegendary?: Color[];
}

export interface PlayerState {
  name: string;
  /** Spells cast this turn (High Noon, Damping Sphere), noncreature ones (Esper Sentinel). */
  spellsThisTurn?: number;
  noncreatureThisTurn?: number;
  /** Cards drawn this turn (Faerie Mastermind: "their second card each turn"). */
  drawnThisTurn?: number;
  /** Teferi, Time Raveler's +1: may cast sorceries as though they had flash until their next turn. */
  sorceryFlash?: boolean;
  /** Gemstone Caverns in the opening hand: already asked. */
  luckAsked?: boolean;
  life: number;
  library: CardInst[];
  hand: CardInst[];
  graveyard: CardInst[];
  exile: CardInst[];
  landPlayed: boolean;
  /** Life gained and lost this turn ("if you gained life this turn"). */
  gainedThisTurn?: number;
  lostThisTurn?: number;
  /** Ascend: controlled ten permanents with an ascend permanent; kept for the rest of the game. */
  citysBlessing?: boolean;
  /** Mana made but not spent yet; it empties when the step or phase ends. */
  pool?: PoolMana[];
  /** Poison counters: ten or more and the player loses. */
  poison?: number;
  /** Commander: the command zone, how many times each commander was cast from it, combat damage taken per commander. */
  command?: CardInst[];
  commanderCasts?: Record<string, number>;
  commanderDamage?: Record<string, number>;
  /** Commander: the commanders' color identity (Command Tower's mana). */
  identity?: Color[];
  /** Turns this player has begun (Starting Town: "your first, second, or third turn of the game"). */
  turns?: number;
  /** Storied (Kíli): three or more artifacts, legendaries and/or Sagas were under their control once. */
  enduringStory?: boolean;
  /** Equip abilities activated this turn (Kíli: "the first equip ability you activate each turn"). */
  equipsThisTurn?: number;
  /** Emblems (Chandra's −7): cards with the emblem's ability. */
  emblems?: Card[];
}

/**
 * Untap, upkeep and draw happen automatically at the start of a turn. The game only stops in
 * the upkeep when abilities trigger there.
 */
export type Step = 'mulligan' | 'upkeep' | 'main1' | 'attack' | 'block' | 'main2';

/**
 * Why both players get a chance to cast instants. Like MTG Arena, priority is only
 * offered at these moments, and skipped for a player with nothing castable.
 */
export type WindowReason =
  | 'upkeep' // upkeep triggers are on the stack; the draw comes after
  | 'begin' // start of a turn, after the draw (full control only)
  | 'main' // a spell was cast in a main phase
  | 'combat' // beginning of combat, before attackers (full control only)
  | 'attack' // attackers declared, before blocks
  | 'block' // blockers declared, before damage
  | 'end'; // end of turn

export interface Priority {
  player: PlayerId;
  /** Consecutive passes: two means everyone passed. */
  passes: number;
  reason: WindowReason;
}

export interface MulliganState {
  /** Who is deciding now. Players decide in turn order. */
  player: PlayerId;
  count: number[];
  kept: boolean[];
}

// ---------- Choices ----------

/** Why a player is asked to choose; decides the prompt and how the bot answers. */
export type ChoicePurpose =
  | 'cleanupDiscard' // discard down to seven at end of turn
  | 'payOrCounter' // "counter target spell unless its controller pays {N}"
  | 'payLifeOrCounter' // Ward—Pay N life: pay, or the spell or ability is countered
  | 'payOrDraw' // Rhystic Study: pay {N}, or its controller draws
  | 'reorder' // Ponder: the order of the top cards of your library
  | 'mayShuffle' // Ponder: "You may shuffle."
  | 'putBack' // Brainstorm: cards from your hand on top of your library (the first chosen on top)
  | 'putFromHand' // Stoneforge Mystic: an Equipment card from your hand onto the battlefield, or none
  | 'returnLandCost' // Daze: which Island to return to its owner's hand
  | 'exileFromHandCost' // Force of Negation, evoke: which card to exile from your hand
  | 'returnCreatureCost' // web-slinging: which tapped creature to return to its owner's hand
  | 'tuckTop' // Subtlety: put your spell on top of your library (or the bottom)?
  | 'cumulativeUpkeep' // pay the cumulative upkeep, or sacrifice the permanent
  | 'discard' // "discard a card": the discarding player chooses
  | 'discardChosen' // Duress: the spell's controller chooses from a revealed hand
  | 'scry'
  | 'surveil'
  | 'search' // library search: find up to N matching cards
  | 'triggerTargets' // targets for a triggered ability going on the stack
  | 'optional' // "you may …" on resolution
  | 'legendRule' // two legendary permanents with the same name: keep one
  | 'payLife' // shock lands: pay life or enter tapped
  | 'clone' // "enter as a copy of any creature": which one
  | 'damageOrder' // an attacker blocked by several creatures: in which order its damage goes
  | 'sacrifice' // an edict: choose what to sacrifice
  | 'sacrificeCost' // "Sacrifice a creature:" when activating, or as a spell's additional cost
  | 'discardCost' // a spell's additional cost: discard a card
  | 'exileCost' // a spell's additional cost: exile cards from your graveyard
  | 'costChoice' // a spell's additional cost "A or B": yes pays the first
  | 'creatureType' // Cavern of Souls: "choose a creature type"
  | 'cardName' // Pithing Needle: "choose a card name"
  | 'spellName' // Meddling Mage: "choose a nonland card name"
  | 'basicType' // Multiversal Passage: "choose a basic land type"
  | 'color' // Mother of Runes: "protection from the color of your choice"
  | 'exploreMill' // explore: put the revealed nonland card into the graveyard?
  | 'returnFromGraveyard' // Overlord of the Balemurk: a card from the graveyard to the hand
  | 'reflexiveSacrifice' // Ruthless Lawbringer: "you may sacrifice another creature. When you do, …"
  | 'reflexiveRemoveCounter' // Leatherhead: "you may remove a counter from her. When you do, …"
  | 'chosenPlayer' // True-Name Nemesis: "choose a player"
  | 'crewCost' // Crew N: which creatures to tap
  | 'dig' // "look at the top N cards …": which to put into the hand
  | 'tradeForCard' // Chandra's +2: sacrifice an artifact or discard a card (or neither)
  | 'reflexiveCost' // "you may discard a card. When you do, …": which card, or none
  | 'reflexivePay' // "you may pay {W}{B} and 2 life. When you do, …"
  | 'gemstoneCaverns' // which card to exile to begin with Gemstone Caverns on the battlefield, or none
  | 'exileFromHand' // Chrome Mox: which card to exile (imprint), or none
  | 'discardLandInstead' // Mox Diamond: which land card to discard, or none (it goes to the graveyard)
  | 'mayPay' // Mana Vault: "you may pay {4}. If you do, …"
  | 'triggerMode'; // a modal trigger ("When … enters, choose one —"): which mode

/** Where "arrange" choices may put cards (scry: top/bottom, surveil: top/graveyard). */
export type ArrangeZone = 'top' | 'bottom' | 'graveyard';

/**
 * A decision that pauses the game until `player` answers it with a `choose` action.
 * `params` feed the prompt, e.g. the card name.
 */
export type Choice = { player: PlayerId; purpose: ChoicePurpose; params?: ErrorParams } & (
  | { kind: 'cards'; min: number; max: number; options: CardInst[] }
  /** Put each card in one of `zones`; for "top", listed first means on top. */
  | { kind: 'arrange'; cards: CardInst[]; zones: ArrangeZone[] }
  /** `disabled`: modes that can't be chosen (not simulated, or no legal target). */
  | { kind: 'mode'; min: number; max: number; modes: string[]; disabled?: number[] }
  | { kind: 'yesNo' }
  /** Targets for each slot, like casting a spell. `source` is where the ability comes from. */
  | { kind: 'targets'; slots: TargetSpec[]; source: CardInst }
);

export type Answer =
  | { kind: 'cards'; iids: string[] }
  | { kind: 'arrange'; zones: Partial<Record<ArrangeZone, string[]>> }
  | { kind: 'mode'; modes: number[] }
  | { kind: 'yesNo'; yes: boolean }
  | { kind: 'targets'; targets: Target[][] };

export interface Pending {
  choice: Choice;
  /**
   * What continues once answered: the end of turn, the spell or ability being resolved, or a
   * triggered ability waiting for targets (`trigger`).
   */
  resume: 'cleanup' | 'effect' | 'trigger' | 'activation' | 'legend' | 'payLife' | 'castCost' | 'clone' | 'discardLandInstead' | 'gemstoneCaverns' | 'damageOrder' | 'creatureType' | 'cardName' | 'basicType' | 'chosenPlayer' | 'crew' | 'triggerMode';
  /** For clone: the window the resolving spell belongs to. */
  reason?: WindowReason;
  /** For payLife: the land that entered. */
  iid?: string;
  trigger?: Triggered;
  /** An ability whose cost includes sacrificing a permanent: it goes on the stack once chosen. */
  activation?: { item: StackItem; named: LogTarget[] };
}

/** A spell or ability halfway through resolving (paused on a choice). */
export interface Resolving {
  item: StackItem;
  /** Targets still legal when resolution started, per slot. */
  legal: Target[][];
  /** Index of the effect to run next. */
  next: number;
  /** Within an effect that asks several players in turn ("each player discards"), who is next. */
  sub?: number;
  /** An optional ability ("you may") whose controller said yes. */
  accepted?: boolean;
  /** Controllers of the permanents this resolution removed (Path to Exile: "Its controller may search …"). */
  removed?: Record<string, PlayerId>;
  /** Their power as they left (Swords to Plowshares: "Its controller gains life equal to its power"). */
  removedPower?: Record<string, number>;
  /** "If you do, …" wasn't done (Chandra's +2): the remaining effects are skipped. */
  stopped?: boolean;
  /** The cards this resolution discarded (Malcolm: "the discarded card"). */
  discarded?: string[];
  reason: WindowReason;
}

// ---------- Log ----------

export type LogTarget = { card: string } | { p: PlayerId };

/** Game log entries are data, rendered in each viewer's language (src/i18n). Card names stay as printed. */
export type LogEntry =
  | { k: 'goesFirst'; p: PlayerId }
  | { k: 'turn'; n: number; p: PlayerId }
  | { k: 'mulligan'; p: PlayerId; keeping: number }
  | { k: 'keep'; p: PlayerId; n: number }
  | { k: 'playLand'; p: PlayerId; card: string }
  | { k: 'cast'; p: PlayerId; card: string; targets?: LogTarget[]; kicked?: boolean; from?: CastZone }
  | { k: 'cycle'; p: PlayerId; card: string }
  | { k: 'activate'; p: PlayerId; card: string; targets?: LogTarget[] }
  | { k: 'enters'; card: string }
  /** A triggered ability goes on the stack. */
  | { k: 'triggers'; card: string; targets?: LogTarget[] }
  /** A triggered ability has no legal target and is removed. */
  | { k: 'noTarget'; card: string }
  /** The controller chose not to use a "you may" ability. */
  | { k: 'declined'; card: string }
  | { k: 'attack'; p: PlayerId; cards: string[] }
  | { k: 'attackPlaneswalker'; card: string; pw: string }
  | { k: 'loyalty'; card: string; n: number }
  | { k: 'blocked'; card: string; by: string[] }
  | { k: 'damage'; card: string; n: number; target: string }
  | { k: 'damagePlayer'; card: string; n: number; p: PlayerId }
  | { k: 'dies'; card: string }
  | { k: 'destroyed'; card: string }
  | { k: 'exiled'; card: string }
  | { k: 'pump'; card: string; power: number; toughness: number; keywords: Keyword[] }
  | { k: 'gainsProtection'; card: string; color: Color }
  | { k: 'gainsFlashback'; card: string }
  | { k: 'citysBlessing'; p: PlayerId }
  | { k: 'mayCastFree'; p: PlayerId; card: string }
  | { k: 'becomesVehicle'; card: string }
  | { k: 'transformed'; card: string; into: string }
  | { k: 'basePT'; card: string; power: number; toughness: number }
  | { k: 'counterRemoved'; card: string; counter: string }
  | { k: 'explores'; card: string; revealed?: string; land: boolean }
  | { k: 'counters'; card: string; counter: CounterKind; n: number }
  | { k: 'countered'; card: string }
  | { k: 'paidLife'; p: PlayerId; n: number; card: string }
  | { k: 'sorceryFlash'; p: PlayerId }
  | { k: 'exiledInstead'; card: string }
  | { k: 'losesAbilities'; card: string }
  | { k: 'reordered'; p: PlayerId; n: number }
  | { k: 'shuffled'; p: PlayerId }
  | { k: 'putBack'; p: PlayerId; n: number }
  | { k: 'looksAtHand'; p: PlayerId; of: PlayerId; cards: string[] }
  | { k: 'tucked'; card: string; top: boolean }
  | { k: 'paidTax'; p: PlayerId; n: number; card: string }
  | { k: 'cantEnter'; card: string }
  | { k: 'paid'; p: PlayerId; n: number; card: string }
  | { k: 'fizzles'; card: string }
  | { k: 'notSimulated'; card: string }
  | { k: 'gainLife'; p: PlayerId; n: number }
  /** `cleanup`: discarding down to seven at end of turn. */
  | { k: 'discard'; p: PlayerId; card: string; cleanup?: boolean }
  | { k: 'loseLife'; p: PlayerId; n: number }
  | { k: 'mill'; p: PlayerId; n: number }
  | { k: 'scry'; p: PlayerId; n: number; bottom: number }
  | { k: 'surveil'; p: PlayerId; n: number; graveyard: number }
  | { k: 'tapped'; card: string; untap: boolean }
  | { k: 'bounced'; card: string }
  | { k: 'sacrificed'; card: string }
  | { k: 'attached'; card: string; to: string }
  /** Leylines: a card of the opening hand begins the game on the battlefield. */
  | { k: 'beginsOnBattlefield'; p: PlayerId; card: string }
  | { k: 'chosenType'; card: string; type: string }
  | { k: 'chosenName'; card: string; name: string }
  | { k: 'chosenPlayer'; card: string; p: PlayerId }
  | { k: 'emblem'; p: PlayerId; card: string }
  | { k: 'becomesCreature'; card: string }
  | { k: 'crewed'; card: string }
  | { k: 'dig'; p: PlayerId; n: number; took: number }
  /** Urza's Saga's chapters: the permanent gains an ability (its text). */
  | { k: 'gainsAbility'; card: string; text: string }
  | { k: 'poison'; p: PlayerId; n: number }
  | { k: 'proliferate'; p: PlayerId }
  | { k: 'control'; p: PlayerId; card: string }
  | { k: 'copied'; card: string; as: string }
  | { k: 'prevented'; card: string }
  | { k: 'extraTurn'; p: PlayerId }
  /** A commander goes back to its owner's command zone. */
  | { k: 'toCommand'; card: string }
  /** A player took 21 combat damage from one commander. */
  | { k: 'commanderDamage'; p: PlayerId; card: string }
  | { k: 'legendRule'; card: string }
  /** A shock land: `paid` life to enter untapped, or entered tapped. */
  | { k: 'shock'; card: string; paid: number }
  | { k: 'token'; p: PlayerId; card: string; n: number }
  /** A card left a graveyard: back to hand, onto the battlefield, or exiled. */
  | { k: 'returned'; card: string; dest: 'hand' | 'battlefield' }
  | { k: 'exiledCard'; card: string; from?: 'hand' }
  /** Rest in Peace: `card` exiled these players' graveyards. */
  | { k: 'exiledGraveyards'; card: string }
  /** `dest`: hand cards are not named (hidden); found cards put onto the battlefield are logged as entering. */
  | { k: 'search'; p: PlayerId; n: number; dest: 'hand' | 'battlefield' | 'top' }
  | { k: 'emptyLibrary'; p: PlayerId }
  | { k: 'concede'; p: PlayerId }
  /** An online player ran out of time: the server played the default action for them. */
  | { k: 'timedOut'; p: PlayerId }
  | { k: 'wins'; p: PlayerId }
  | { k: 'draw' };

export interface GameState {
  players: PlayerState[];
  /**
   * Teams of players. Missing: each player alone (a duel). Two-Headed Giant: [[0, 1], [2, 3]]; teammates share
   * life and poison (kept equal on each of them), turns and combat.
   */
  teams?: PlayerId[][];
  /** Two-Headed Giant, and/or Commander. */
  mode?: GameMode;
  /** In a team's main phases and declare steps, the head acting now (its teammate goes next). */
  turnHead?: PlayerId;
  /** Tishana's Tidebinder: permanents that lost all abilities while it (`by`) stays, with their card before. */
  abilityLoss?: { iid: string; by: string; card: Card }[];
  /** Heads of the active team done with the current main phase. */
  headsDone?: PlayerId[];
  /** Who declares attackers or blockers now, when a team declares head by head. */
  declaring?: PlayerId;
  /** Blocks declared so far by the defending team's heads. */
  pendingBlocks?: Record<string, string[]>;
  /** Heads that already declared attackers or blockers this step. */
  declared?: PlayerId[];
  /**
   * Two-Headed Giant: attackers declared by the heads so far. The team attacks together: they become attacking
   * (tapped, "attacks" triggers) once the last head has declared.
   */
  attackPlan?: { p: PlayerId; ids: string[]; pw: Record<string, string> }[];
  battlefield: Permanent[];
  stack: StackItem[];
  active: PlayerId;
  turn: number;
  step: Step;
  priority: Priority | null;
  mulligan: MulliganState | null;
  /** A choice someone must make before anything else happens. */
  pending: Pending | null;
  resolving: Resolving | null;
  attackers: string[];
  /** Attackers attacking a planeswalker instead of the player: attacker iid → planeswalker iid. */
  attackTargets?: Record<string, string>;
  /** attacker iid → blocker iids, in damage assignment order */
  blocks: Record<string, string[]>;
  /** Attackers whose blockers were already ordered (while asking). */
  ordered?: string[];
  winner: PlayerId | 'draw' | null;
  log: LogEntry[];
  /**
   * Per player: stop at every priority window instead of auto-passing when nothing is castable.
   * Optional so states created before this option existed still load.
   */
  fullControl?: boolean[];
  /**
   * Online games: whether a player stops in a priority window depends only on what everyone can see (cards in hand,
   * untapped mana, abilities on the battlefield), so a stop doesn't tell the opponent that an instant is in hand.
   */
  publicStops?: boolean;
  /** Fog: no combat damage this turn. */
  preventCombat?: boolean;
  /** "Prevent the next N damage" shields this turn: target ("player:0" or a permanent iid) and amount left. */
  shields?: { target: string; n: number }[];
  /** Extra turns to take, per team (indexed by the team's first player). */
  extraTurns?: number[];
  /** Lands that entered asking "pay N life or enter tapped", asked once nothing else is going on. */
  lifeChoices?: { iid: string; n: number }[];
  /** Triggered abilities not on the stack yet. Optional so older saved states still load. */
  triggered?: Triggered[];
  /** Cards exiled "until this leaves the battlefield" (Seam Rip): the source permanent, the card, its owner. */
  exiledUntil?: { source: string; iid: string; owner: PlayerId }[];
  /** Tokens to sacrifice at the beginning of the next end step (Mobilize). */
  sacrificeAtEnd?: string[];
  /** Warp: permanents exiled at the beginning of the next end step (castable from exile on a later turn). */
  warpAtEnd?: string[];
  /** Phelia: cards exiled until the next end step, then returned under their owner's control. */
  /** Malcolm: this card may be cast for free by this player now (the next action, else the chance is gone). */
  castNow?: { player: PlayerId; iid: string };
  /** Ghost Vacuum: the cards each permanent exiled from graveyards ("exiled with this artifact"), by its iid. */
  exiledWith?: Record<string, { iid: string; owner: PlayerId }[]>;
  returnAtEnd?: { iid: string; owner: PlayerId; source?: string; controller: PlayerId; counterIfYours: boolean }[];
  /** Counter for ability ids on the stack. */
  abilities?: number;
  /** Random generator state, so shuffles during the game are reproducible. Secret: redacted for clients. */
  seed: number;
}

export type Target =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'permanent'; iid: string }
  | { kind: 'spell'; iid: string }
  /** A card in a graveyard. */
  | { kind: 'card'; iid: string };

/** Actions are always taken by `actor(state)`. */
export type Action =
  | { type: 'mulligan' }
  | { type: 'keep'; bottom: string[] }
  /** `face`: play the back face of a modal double-faced card as a land. */
  | { type: 'playLand'; iid: string; face?: number }
  /** `targets` has one list per target slot; `target` is a shorthand for a single-target spell. `x`: the value of X. */
  | {
      type: 'cast'; iid: string; targets?: Target[][]; target?: Target; x?: number;
      /** Face to cast (adventure, modal double-faced, split), modes of a modal spell, kicker paid. */
      face?: number; modes?: number[]; kicked?: boolean;
      /** An alternative cost paid instead of the mana cost (an index in CastInfo.alts). */
      alt?: number;
      /** March of Otherworldly Light: how many cards to exile from the hand ({2} less each). */
      exiled?: number;
      /** The mana sources the player chose to pay with (iids from paymentFor); without it, the engine chooses. */
      pay?: string[];
    }
  /** Cycling (or landcycling) a card in hand. */
  | { type: 'cycle'; iid: string; pay?: string[] }
  /** Channel: discard a card from hand to activate its channel ability. */
  | { type: 'channel'; iid: string; targets?: Target[][]; pay?: string[] }
  /** Activate ability number `index` (in activatedOf order) of a permanent you control. */
  | { type: 'activate'; iid: string; index: number; targets?: Target[][]; x?: number; pay?: string[] }
  | { type: 'pass' }
  /** `targets`: attackers that attack a planeswalker (attacker iid → planeswalker iid) instead of the player. */
  | { type: 'declareAttackers'; attackers: string[]; targets?: Record<string, string> }
  | { type: 'declareBlockers'; blocks: Record<string, string[]> }
  | { type: 'choose'; answer: Answer }
  | { type: 'concede'; player: PlayerId }
  /** Allowed at any time, like conceding. */
  | { type: 'setFullControl'; player: PlayerId; on: boolean }
  /** Tap a mana source: its mana goes to your pool. */
  | { type: 'tapForMana'; iid: string }
  /** Undo tapForMana while its mana is still unspent. */
  | { type: 'untapForMana'; iid: string };

/** Why an action was refused. Rendered in the player's language (src/i18n). */
export type GameErrorCode =
  | 'gameOver' | 'keepFirst' | 'notMulliganTime' | 'noMoreMulligans' | 'chooseBottom' | 'notInHand'
  | 'landTiming' | 'landAlreadyPlayed' | 'notALand' | 'notASpell' | 'sorcerySpeed' | 'castTiming' | 'sorceryOnly' | 'nameStopped' | 'mustAttack' | 'noCounterToRemove' | 'nothingToExile'
  | 'noLandToReturn' | 'onlyNotYourTurn' | 'noCardToExile' | 'noTappedCreature'
  | 'needsTarget' | 'tooManyTargets' | 'targetMustBe' | 'illegalTarget' | 'notEnoughMana' | 'chosenManaShort' | 'declareBlockersFirst'
  | 'notAttackStep' | 'cannotAttack' | 'notBlockStep' | 'notAttacking' | 'menace' | 'cannotBlock'
  | 'makeChoiceFirst' | 'nothingToChoose' | 'badChoice' | 'badX'
  | 'notEnoughLoyalty' | 'cannotAttackThat' | 'manaSpent' | 'badModes' | 'nothingToDiscard' | 'activationForbidden' | 'castingForbidden' | 'notEnoughInGraveyard' | 'costNotSimulated' | 'cannotCycle'
  | 'noSuchAbility' | 'activateTiming' | 'alreadyTapped' | 'summoningSick' | 'onceEachTurn' | 'notEnoughLife' | 'nothingToSacrifice' | 'notEnoughCrew';

export type ErrorParams = Record<string, string | number>;

export class IllegalAction extends Error {
  constructor(
    readonly code: GameErrorCode,
    readonly params: ErrorParams = {},
  ) {
    super(code);
  }
}

/** Game options beyond a duel. */
export interface GameMode {
  /** Two-Headed Giant: two teams of two. */
  twoHeaded?: boolean;
  /** Commander rules (command zone, tax, commander damage, more life). */
  commander?: boolean;
}

// ---------- Players and teams ----------

export const playersOf = (s: GameState): PlayerId[] => s.players.map((_, i) => i);
export const teamsOf = (s: GameState): PlayerId[][] => s.teams ?? s.players.map((_, i) => [i]);
export const teamOf = (s: GameState, p: PlayerId): number => teamsOf(s).findIndex((t) => t.includes(p));
/** The players on p's team, p included. */
export const teamPlayers = (s: GameState, p: PlayerId): PlayerId[] => teamsOf(s)[teamOf(s, p)] ?? [p];
export const teammatesOf = (s: GameState, p: PlayerId): PlayerId[] => teamPlayers(s, p).filter((q) => q !== p);
export const opponentsOf = (s: GameState, p: PlayerId): PlayerId[] => playersOf(s).filter((q) => teamOf(s, q) !== teamOf(s, p));
/** The first opponent: in a duel, the opponent. */
export const firstOpponent = (s: GameState, p: PlayerId): PlayerId => opponentsOf(s, p)[0];
/** Is p on the team whose turn it is? */
export const isActivePlayer = (s: GameState, p: PlayerId) => teamOf(s, p) === teamOf(s, s.active);
/** Did p's team win? */
export const wonBy = (s: GameState, p: PlayerId) => s.winner !== null && s.winner !== 'draw' && teamOf(s, s.winner) === teamOf(s, p);
/** Players in turn order starting with the active team (APNAP). */
export function turnOrder(s: GameState): PlayerId[] {
  const teams = teamsOf(s);
  const a = teamOf(s, s.active);
  return [...teams.slice(a), ...teams.slice(0, a)].flat();
}
/** The player after p in turn order (who gets priority next). */
export function nextPlayer(s: GameState, p: PlayerId): PlayerId {
  const order = turnOrder(s);
  return order[(order.indexOf(p) + 1) % order.length];
}
/** The first player of the team after p's (whose turn comes next). */
function nextTeamLead(s: GameState, p: PlayerId): PlayerId {
  const teams = teamsOf(s);
  return teams[(teamOf(s, p) + 1) % teams.length][0];
}
/**
 * Cards p puts on the bottom when keeping: one per mulligan taken, except that the first mulligan is free in
 * multiplayer games (Two-Headed Giant) and in Commander.
 */
export function mulliganBottom(s: GameState, p: PlayerId): number {
  const taken = s.mulligan?.count[p] ?? 0;
  const free = s.teams || s.mode?.commander ? 1 : 0;
  return Math.min(Math.max(0, taken - free), s.players[p].hand.length);
}

/** Poison counters that make a player (or a team) lose. */
export const poisonLimit = (s: GameState) => (s.teams ? 15 : 10);

/** Who has to act now. */
export function actor(s: GameState): PlayerId | null {
  if (s.winner !== null) return null;
  if (s.mulligan) return s.mulligan.player;
  if (s.pending) return s.pending.choice.player;
  if (s.priority) return s.priority.player;
  if (s.step === 'block') return s.declaring ?? firstOpponent(s, s.active);
  if (s.step === 'attack') return s.declaring !== undefined && isActivePlayer(s, s.declaring) ? s.declaring : s.active;
  // The head acting in this main phase (a stale one from another team's turn is ignored).
  return s.turnHead !== undefined && isActivePlayer(s, s.turnHead) ? s.turnHead : s.active;
}

// ---------- Queries ----------

export const findPermanent = (s: GameState, iid: string) => s.battlefield.find((p) => p.iid === iid);

export const creaturesOf = (s: GameState, p: PlayerId) =>
  s.battlefield.filter((x) => x.controller === p && isCreature(x.card));

const isPermanent = (x: object): x is Permanent => 'boosts' in x;

/** Keyword printed on the card or granted until end of turn. */
export const hasKw = (x: CardInst, kw: Keyword) =>
  hasKeyword(x.card, kw) || (isPermanent(x) && (x.boosts.some((b) => b.keywords.includes(kw)) || !!x.statics?.keywords.includes(kw) || !!x.counters[kw as CounterKind]));

export const firstStrikes = (x: CardInst) => hasKw(x, 'first strike') || hasKw(x, 'double strike');

const sum = (perm: Permanent, key: 'power' | 'toughness') => perm.boosts.reduce((n, b) => n + b[key], 0);
const counterBonus = (perm: Permanent) => (perm.counters['+1/+1'] ?? 0) - (perm.counters['-1/-1'] ?? 0);

/**
 * Power and toughness in layer order: the card's (7a), then the latest "base power and toughness" (7b), then
 * modifications from effects and static abilities (7c) and counters (7d).
 */
const basePT = (perm: Permanent) => [...perm.boosts].reverse().find((b) => b.setBase)?.setBase;
export const powerOf = (perm: Permanent) => (basePT(perm)?.power ?? power(perm.card)) + sum(perm, 'power') + counterBonus(perm) + (perm.statics?.power ?? 0);
export const toughnessOf = (perm: Permanent) => (basePT(perm)?.toughness ?? toughness(perm.card)) + sum(perm, 'toughness') + counterBonus(perm) + (perm.statics?.toughness ?? 0);

/** True-Name Nemesis: protection from the chosen player (their spells, abilities, creatures and damage). */
const protectedFromPlayer = (perm: Permanent, p: PlayerId) => perm.chosenPlayer === p && protectionFromChosenPlayer(perm.card);

/** Does `perm` have protection from a source of these colors? */
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];

const protectedFrom = (perm: Permanent, source: Card) =>
  [...protectionsOf(perm.card), ...perm.boosts.flatMap((b) => b.protection ?? [])].some((c) => cardColors(source).includes(c));

/**
 * The mana one tap of `perm` makes (Command Tower: in its controller's commander's colors). Starting Town's colors
 * that cost life are left out when its controller can't pay that life.
 */
export function unitsOf(s: GameState, perm: Permanent, spell?: Card): Color[][] {
  const identity = s.players[perm.controller]?.identity;
  // Magus of the Moon: a nonbasic land only makes {R} (Yavimaya and Urborg still add their types).
  if (mooned(s, perm.card)) return landTypeMana(s, [[moonType(s, perm.card) === 'island' ? 'U' : 'R']]);
  let units = manaUnits(perm.card, identity);
  if (isLandCard(perm.card)) units = landTypeMana(s, units);
  // Springleaf Drum, Gene Pollinator: any color, with another untapped permanent to tap.
  if (tapsAnotherForMana(perm.card)) units = manaHelpers(s, perm).length ? [['W', 'U', 'B', 'R', 'G']] : [];
  // Mystic Gate: with another source to pay {W/U}, two mana of these colors (the other's mana is spent on the cost).
  const filter = filterMana(perm.card);
  if (filter && filterHelpers(s, perm).length) units = [[...filter], [...filter]];
  // Chrome Mox: the imprinted card's colors; Mox Amber: the colors of legendary creatures and planeswalkers.
  const state = stateMana(perm.card);
  if (state === 'perCreature') {
    // Gaea's Cradle: {G} for each creature you control.
    const n = s.battlefield.filter((x) => x.controller === perm.controller && isCreature(x.card)).length;
    units = Array.from({ length: n }, () => ['G'] as Color[]);
  } else if (state === 'opponentLands') {
    // Fellwar Stone: the colors an opponent's land could make (Pools and Stones aside).
    const colors = s.battlefield
      .filter((x) => teamOf(s, x.controller) !== teamOf(s, perm.controller) && isLandCard(x.card) && stateMana(x.card) !== 'reflect')
      .flatMap((x) => unitsOf(s, x).flat())
      .filter((c) => c !== 'C');
    units = colors.length ? [[...new Set(colors)]] : [];
  } else if (state === 'reflect') {
    // Reflecting Pool: the types the other lands could make (other Pools aside: they add nothing new).
    const types = s.battlefield
      .filter((x) => x.controller === perm.controller && isLandCard(x.card) && stateMana(x.card) !== 'reflect')
      .flatMap((x) => unitsOf(s, x).flat());
    units = types.length ? [[...new Set(types)]] : [];
  } else if (state === 'mining') {
    units = perm.counters.mining ? [['W', 'U', 'B', 'R', 'G']] : [];
  } else if (state === 'perArtifact') {
    const n = s.battlefield.filter((x) => x.controller === perm.controller && cardTypes(x.card).includes('artifact')).length;
    units = Array.from({ length: n }, () => ['U'] as Color[]);
  } else if (state === 'luck') {
    if (perm.counters.luck) units = [['W', 'U', 'B', 'R', 'G']];
  } else if (state) {
    const from = state === 'imprinted' ? (perm.imprinted ? [perm.imprinted] : [])
      : s.battlefield.filter((x) => x.controller === perm.controller && /\bLegendary\b/.test(x.card.typeLine.split('//')[0]) && (isCreature(x.card) || isPlaneswalker(x.card))).map((x) => x.card);
    const colors = [...new Set(from.flatMap((c) => cardColors(c)))];
    units = [...units, ...(colors.length ? [colors] : [])];
  }
  // Cavern of Souls: its colored mana for a creature spell of the chosen type.
  const typed = chosenTypeMana(perm.card);
  if (typed && spell && perm.chosenType && ofType(spell, perm.chosenType)) units = [[...new Set([...(units[0] ?? []), ...typed])]];
  // Delighted Halfling: any color for a legendary spell.
  const legend = legendaryMana(perm.card);
  if (legend && spell && isLegendary(spell)) units = [[...new Set([...(units[0] ?? []), ...legend])]];
  const pain = manaPain(perm.card, identity);
  if (pain && s.players[perm.controller].life < pain.life) units = units.map((u) => u.filter((c) => !pain.colors.includes(c)));
  // Sunbillow Verge: "{T}: Add {R}. Activate only if you control a Mountain or a Plains."
  // Damping Sphere: a land tapped for two or more mana makes {C} instead.
  if (isLandCard(perm.card) && units.length >= 2 && withRule(s, 'landsMakeOneColorless').length) units = [['C']];
  for (const cond of manaConditions(perm.card)) {
    const mine = s.battlefield.filter((x) => x.controller === perm.controller);
    const met = 'subtypes' in cond
      ? mine.some((x) => cond.subtypes.some((t) => landHasType(s, x.card, t)))
      : mine.filter((x) => /\bArtifact\b/.test(x.card.typeLine)).length >= cond.artifacts;
    if (!met) units = units.map((u) => u.filter((c) => !cond.colors.includes(c)));
  }
  return units.filter((u) => u.length);
}

/** A subtype, counting Yavimaya, Cradle of Growth: "Each land is a Forest in addition to its other land types." */
const landHasType = (s: GameState, card: Card, type: string) =>
  (mooned(s, card) ? type === moonType(s, card) : hasSubtype(card, type))
  || (type === 'forest' && isLandCard(card) && withRule(s, 'landsAreForests').length > 0)
  || (type === 'swamp' && isLandCard(card) && withRule(s, 'landsAreSwamps').length > 0);

/** Is the card a creature (spell) of this creature type? (Cavern of Souls) */
const ofType = (card: Card, type: string) => isCreature(card) && hasSubtype(card, type);

/** A card's subtypes (front face), lower case: "Land — Mountain Plains" → mountain, plains. */
const subtypesOf = (c: Card) => (c.typeLine.split('//')[0].toLowerCase().split('—')[1] ?? '').trim().split(' ');

/** Subtypes that aren't creature types, which a changeling doesn't have. */
const NONCREATURE_SUBTYPES = new Set([
  'equipment', 'aura', 'vehicle', 'saga', 'case', 'class', 'room', 'shrine', 'curse', 'background', 'role', 'cartouche', 'rune', 'shard',
  'food', 'treasure', 'clue', 'map', 'blood', 'gold', 'powerstone', 'incubator', 'attraction', 'contraption', 'fortification', 'spacecraft', 'planet',
  'plains', 'island', 'swamp', 'mountain', 'forest', 'desert', 'gate', 'cave', 'sphere', 'town', 'lair', 'locus', 'mine', 'tower', 'urza\'s',
  'adventure', 'arcane', 'lesson', 'trap', 'omen', 'chorus',
]);

/** Has the card this subtype? Changelings and Mutavault ("all creature types") have every creature type. */
function hasSubtype(c: Card, type: string): boolean {
  const t = type.toLowerCase();
  if (subtypesOf(c).includes(t)) return true;
  return isCreature(c) && !NONCREATURE_SUBTYPES.has(t) && (c.keywords ?? []).some((k) => k.toLowerCase() === 'changeling');
}

/** Starting Town: the colors its mana costs life to be spent as, while its controller can pay that life. */
function painOf(s: GameState, perm: Permanent) {
  const pain = manaPain(perm.card, s.players[perm.controller]?.identity);
  return pain && s.players[perm.controller].life >= pain.life ? pain : undefined;
}

/** Delirium: four or more card types among the cards in `p`'s graveyard. */
export function delirium(s: GameState, p: PlayerId): boolean {
  const types = new Set(s.players[p].graveyard.flatMap((c) => cardTypes(c.card)));
  return types.size >= 4;
}

/**
 * Yavimaya (Forest) and Urborg (Swamp): each land has that type too, its mana as one more choice for a land making one
 * mana per tap.
 */
function landTypeMana(s: GameState, units: Color[][]): Color[][] {
  const extra: Color[] = [...(withRule(s, 'landsAreForests').length ? ['G' as Color] : []), ...(withRule(s, 'landsAreSwamps').length ? ['B' as Color] : [])];
  return extra.length && units.length <= 1 ? [[...new Set([...(units[0] ?? []), ...extra])]] : units;
}

/** A card with a mana ability of its own (then it's never tapped to pay for Springleaf Drum's mana). */
const makesMana = (card: Card) => manaUnits(card).length > 0 || !!tapsAnotherForMana(card) || !!stateMana(card) || !!chosenTypeMana(card);

/**
 * Springleaf Drum, Gene Pollinator: the untapped permanents (creatures for the Drum) `perm` may tap along with itself:
 * ones that make no mana, so no other mana is lost; the cheapest first (noncreatures, then the smallest creatures).
 */
function manaHelpers(s: GameState, perm: Permanent): Permanent[] {
  const kind = tapsAnotherForMana(perm.card);
  if (!kind) return [];
  return s.battlefield
    .filter((x) => x.controller === perm.controller && x.iid !== perm.iid && !x.tapped && (kind === 'permanent' || isCreature(x.card)) && !makesMana(x.card))
    .sort((a, b) => Number(isCreature(a.card)) - Number(isCreature(b.card)) || powerOf(a) - powerOf(b));
}

/**
 * Mystic Gate: the untapped lands that can pay its {W/U} (one mana of a color, no life, no damage): the ones making
 * fewest colors first.
 */
function filterHelpers(s: GameState, perm: Permanent): Permanent[] {
  const filter = filterMana(perm.card);
  if (!filter) return [];
  return s.battlefield
    .filter((x) => x.controller === perm.controller && x.iid !== perm.iid && isLandCard(x.card) && !filterMana(x.card) && canTapForMana(s, x) && !painfulMana(x) && !painOf(s, x) && !stateMana(x.card))
    .map((x) => ({ x, units: unitsOf(s, x) }))
    .filter(({ units }) => units.length === 1 && units[0].some((c) => filter.includes(c)))
    .sort((a, b) => a.units[0].length - b.units[0].length)
    .map(({ x }) => x);
}

/** Can this permanent be tapped for mana now? */
export const canTapForMana = (s: GameState, perm: Permanent) =>
  !perm.tapped && !(isCreature(perm.card) && perm.sick && !hasKw(perm, 'haste')) && unitsOf(s, perm).length > 0 && !activationsForbidden(s, perm) &&
  s.players[perm.controller].life >= manaLifeCost(perm.card);

/** Tapping it for mana costs life (Mana Confluence) or deals damage (City of Brass): tapped last, and can't be undone. */
const painfulMana = (perm: Permanent) =>
  manaLifeCost(perm.card) > 0 || !!tapsAnotherForMana(perm.card) || !!filterMana(perm.card) || triggersOf(perm.card).some((t) => t.event.on === 'becomesTapped');

/** Permanents on the battlefield with a rule-changing static ability. */
const withRule = (s: GameState, rule: GameRule) => {
  // Magus of the Moon: nonbasic lands lose their abilities (Yavimaya, Urborg).
  const moon = rule !== 'nonbasicLandsAreMountains' && rule !== 'nonbasicLandsAreIslands'
    && s.battlefield.some((x) => gameRulesOf(x.card).some((g) => g === 'nonbasicLandsAreMountains' || g === 'nonbasicLandsAreIslands'));
  return s.battlefield.filter((x) => gameRulesOf(x.card).includes(rule) && !(moon && isNonbasicLand(x.card)))
    // Trinisphere only works untapped.
    .filter((x) => rule !== 'spellsCostAtLeast3' || !x.tapped);
};

const isNonbasicLand = (card: Card) => isLandCard(card) && !/\bBasic\b/.test(card.typeLine.split('//')[0]);

/** Magus of the Moon: this permanent is a nonbasic land, so a Mountain with no other ability. */
const mooned = (s: GameState, card: Card) => moonType(s, card) !== null;

/** Magus of the Moon (Mountain), Harbinger of the Seas (Island): the basic type a nonbasic land becomes. */
function moonType(s: GameState, card: Card): 'mountain' | 'island' | null {
  if (!isNonbasicLand(card)) return null;
  if (withRule(s, 'nonbasicLandsAreMountains').length) return 'mountain';
  return withRule(s, 'nonbasicLandsAreIslands').length ? 'island' : null;
}

/** Meddling Mage: spells with the name it chose can't be cast. */
export const spellNameStopped = (s: GameState, name: string) =>
  s.battlefield.some((x) => x.chosenName === name && namesSpellToStop(x.card));

/** Pithing Needle: a Needle naming `name` stops its activated abilities other than mana abilities. */
export const nameStopped = (s: GameState, name: string) =>
  s.battlefield.some((x) => x.chosenName === name && namesCardToStop(x.card));

/** Clarion Conqueror: no activated abilities (mana abilities included) for artifacts, creatures and planeswalkers. */
function activationsForbidden(s: GameState, perm: Permanent): boolean {
  // Null Rod: artifacts' activated abilities, mana abilities included.
  if (cardTypes(perm.card).includes('artifact') && withRule(s, 'noArtifactAbilities').length) return true;
  if (!withRule(s, 'noActivatedAbilities').length) return false;
  const types = cardTypes(perm.card);
  return types.includes('artifact') || types.includes('creature') || types.includes('planeswalker');
}

/** Voice of Victory: `p` can't cast spells during the turn of an opponent who controls it. */
/**
 * When `p` may cast `card`: in a priority window, an instant or flash (or a sorcery after Teferi's +1) unless an
 * opponent's Teferi limits them to sorcery speed; otherwise in their own main phase.
 */
/** When a card may be cast from where it is: Malcolm's free cast right away; a plotted card only as a sorcery. */
function castTimingFor(s: GameState, p: PlayerId, inst: CardInst, card: Card): boolean {
  if (s.castNow?.player === p && s.castNow.iid === inst.iid) return true;
  if (inst.castFor?.sorcery) return !s.priority && isMainStep(s) && isActivePlayer(s, p);
  return castTimingOk(s, p, card);
}

function castTimingOk(s: GameState, p: PlayerId, card: Card): boolean {
  if (!s.priority) return isMainStep(s) && isActivePlayer(s, p);
  if (sorceryOnly(s, p)) return false;
  return hasInstantSpeed(card) || (!!s.players[p].sorceryFlash && /\bSorcery\b/.test(card.typeLine.split('//')[0]));
}

/** Containment Priest: a nontoken creature card entering without being cast is exiled instead. */
const uncastExiled = (s: GameState, card: Card) =>
  isCreature(card) && !isToken(card) && withRule(s, 'uncastCreaturesExiled').length > 0;

/** Grafdigger's Cage: creature cards in graveyards and libraries can't enter the battlefield. */
const caged = (s: GameState, card: Card) => isCreature(card) && withRule(s, 'noCreaturesFromGraveyardsLibraries').length > 0;

/** Teferi, Time Raveler: an opponent of `p` controls it, so `p` casts spells only at sorcery speed. */
const sorceryOnly = (s: GameState, p: PlayerId) =>
  withRule(s, 'opponentsSorcerySpeed').some((x) => teamOf(s, x.controller) !== teamOf(s, p));

const castingForbidden = (s: GameState, p: PlayerId) =>
  withRule(s, 'opponentsCantCastOnYourTurn').some((x) => teamOf(s, x.controller) !== teamOf(s, p) && isActivePlayer(s, x.controller))
  // High Noon: one spell each turn.
  || ((s.players[p].spellsThisTurn ?? 0) >= 1 && withRule(s, 'oneSpellEachTurn').length > 0);

/** Rest in Peace / Leyline of the Void: cards that would go to `owner`'s graveyard are exiled instead. */
const graveyardExiled = (s: GameState, owner: PlayerId) =>
  withRule(s, 'graveyardsExiled').length > 0 ||
  withRule(s, 'opponentGraveyardsExiled').some((x) => teamOf(s, x.controller) !== teamOf(s, owner));

/** What `p` can pay with: mana in their pool ("pool:N"), then untapped mana sources. */
export function manaSources(s: GameState, p: PlayerId, spell?: Card): ManaSource[] {
  const life = s.players[p].life;
  const pool = (s.players[p].pool ?? []).map((m, i): ManaSource => {
    // Cavern of Souls' mana kept in the pool: its colors only for a creature spell of the chosen type.
    if (m.forType && !(spell && ofType(spell, m.forType.type))) return { iid: `pool:${i}`, colors: m.colors.filter((c) => !m.forType!.colors.includes(c)) };
    // Delighted Halfling's mana kept in the pool: its colors only for a legendary spell.
    if (m.forLegendary && !(spell && isLegendary(spell))) return { iid: `pool:${i}`, colors: m.colors.filter((c) => !m.forLegendary!.includes(c)) };
    // Starting Town's mana kept in the pool: its colors that cost life only while that life can be paid.
    if (m.pain && life < m.pain.life) return { iid: `pool:${i}`, colors: m.colors.filter((c) => !m.pain!.colors.includes(c)) };
    return { iid: `pool:${i}`, colors: m.colors, ...(m.pain ? { pain: m.pain } : {}) };
  });
  const perms = s.battlefield
    .filter((x) => x.controller === p && canTapForMana(s, x))
    .map((x): ManaSource => {
      const units = unitsOf(s, x, spell);
      const pain = painOf(s, x);
      return {
        iid: x.iid, colors: [...new Set(units.flat())], ...(units.length > 1 ? { units } : {}), ...(painfulMana(x) ? { last: true } : {}), ...(pain ? { pain } : {}),
      };
    });
  // Mystic Gate: its helper's mana is part of its own (the helper isn't a source by itself); alone it makes {C}.
  const filtering = new Set<string>();
  for (const src of perms) {
    const perm = s.battlefield.find((x) => x.iid === src.iid);
    if (!perm || !filterMana(perm.card)) continue;
    const helper = filterHelpers(s, perm).find((h) => !filtering.has(h.iid));
    if (helper) filtering.add(helper.iid);
    else {
      src.colors = ['C'];
      delete src.units;
    }
  }
  // Springleaf Drum, Gene Pollinator: each one needs its own permanent to tap.
  const helpersUsed = new Set<string>();
  const usable = perms.filter((src) => !filtering.has(src.iid)).filter((src) => {
    const perm = s.battlefield.find((x) => x.iid === src.iid);
    if (!perm || !tapsAnotherForMana(perm.card)) return true;
    const helper = manaHelpers(s, perm).find((h) => !helpersUsed.has(h.iid));
    if (helper) helpersUsed.add(helper.iid);
    return !!helper;
  });
  // Elvish / Simian Spirit Guide: exiled from the hand for one mana, spent last.
  const fromHand = s.players[p].hand.flatMap((c): ManaSource[] => {
    const color = handMana(c.card);
    return color ? [{ iid: `hand:${c.iid}`, colors: [color], last: true }] : [];
  });
  return [...pool, ...usable, ...fromHand];
}

/** Can the permanent's mana be taken back (all of it still unspent in the pool)? */
export function canUntapForMana(s: GameState, p: PlayerId, perm: Permanent): boolean {
  if (perm.controller !== p || !perm.tapped || painfulMana(perm)) return false;
  return (s.players[p].pool ?? []).filter((m) => m.source === perm.iid).length === unitsOf(s, perm).length;
}

/** A card's channel cost ({1} less per legendary creature `p` controls, for Otawara), or null without channel. */
export function channelCost(s: GameState, p: PlayerId, card: Card): Cost | null {
  const channel = castInfo(card).channel;
  if (!channel || nameStopped(s, card.name)) return null;
  const cost = parseCost(channel.cost);
  const legends = channel.legendaryDiscount
    ? s.battlefield.filter((x) => x.controller === p && isCreature(x.card) && /\bLegendary\b/.test(x.card.typeLine.split('//')[0])).length
    : 0;
  return { ...cost, generic: Math.max(0, cost.generic - legends) };
}

/** How many {X} the cost has (Fireball: 1, some spells: 2). */
export const xCount = (card: Card) => (card.manaCost.split('//')[0].match(/\{X\}/g) ?? []).length;

/** The cost to pay, with X set. */
export function costWithX(card: Card, x = 0) {
  const cost = parseCost(card.manaCost);
  return { ...cost, generic: cost.generic + x * xCount(card) };
}

export const canPay = (s: GameState, p: PlayerId, card: Card, x = 0) =>
  findPayment(manaSources(s, p, card), castCost(s, p, card, {}, x)) !== null;

/** The mana cost of casting `card` a given way: its face's cost (or flashback), kicker, X, minus affinity. */
/** Why `p` can't pay an additional cost of casting the card `iid` (null: they can). */
function extraCostProblem(s: GameState, p: PlayerId, extra: AdditionalCost, iid: string, card: string): IllegalAction | null {
  const me = s.players[p];
  if (extra.kind === 'life' && me.life < extra.n) return new IllegalAction('notEnoughLife');
  if (extra.kind === 'sacrifice' && !matching(s, p, extra.which).some((x) => x.controller === p)) return new IllegalAction('nothingToSacrifice', { card });
  if (extra.kind === 'discard' && me.hand.filter((c) => c.iid !== iid).length < extra.n) return new IllegalAction('nothingToDiscard', { card });
  if (extra.kind === 'exileGraveyard' && me.graveyard.filter((c) => c.iid !== iid).length < extra.n) return new IllegalAction('notEnoughInGraveyard', { card, n: extra.n });
  return null;
}

function altMana(c: Card, alt: AltCost, x: number): Cost {
  if (alt.kind === 'mana') return parseCost(alt.cost);
  if (alt.kind === 'phyrexian') {
    const cost = parseCost(c.manaCost.split('//')[0].replace(/\{[WUBRG]\/P\}/g, ''));
    return { ...cost, generic: cost.generic + x * xCount(c) };
  }
  return { generic: 0, colored: [] };
}

/** Why alternative cost `alt` can't be paid now (Daze needs an Island, Force of Negation a blue card…), or null. */
function altCostProblem(s: GameState, p: PlayerId, alt: AltCost, iid: string, from: CastZone): string | null {
  const me = s.players[p];
  if (alt.kind === 'returnLand') return s.battlefield.some((x) => x.controller === p && hasSubtype(x.card, alt.subtype)) ? null : 'noLandToReturn';
  if (alt.kind === 'exileCard') {
    if (alt.notYourTurn && isActivePlayer(s, p)) return 'onlyNotYourTurn';
    return me.hand.some((c) => c.iid !== iid && cardColors(c.card).includes(alt.color)) ? null : 'noCardToExile';
  }
  if (alt.kind === 'phyrexian') return me.life >= 2 * alt.n ? null : 'notEnoughLife';
  if (alt.name === 'warp' && from !== 'hand') return 'castTiming';
  if (alt.name === 'webSlinging' && !s.battlefield.some((x) => x.controller === p && x.tapped && isCreature(x.card))) return 'noTappedCreature';
  return null;
}

/**
 * Pays the non-mana part of an alternative cost: Phyrexian life now; the Island, the card to exile or the tapped
 * creature are chosen first (true then).
 */
function payAltCost(d: GameState, p: PlayerId, alt: AltCost, item: StackItem, named: LogTarget[]): boolean {
  const me = d.players[p];
  const card = castCard(item).name;
  const ask = (choice: Choice) => {
    d.pending = { choice, resume: 'castCost', activation: { item, named } };
    return true;
  };
  if (alt.kind === 'phyrexian') {
    changeLife(d, p, -2 * alt.n);
    return false;
  }
  if (alt.kind === 'returnLand') {
    const options = d.battlefield.filter((x) => x.controller === p && hasSubtype(x.card, alt.subtype));
    return ask({ kind: 'cards', player: p, purpose: 'returnLandCost', min: 1, max: 1, options, params: { card, n: 1 } });
  }
  if (alt.kind === 'exileCard') {
    const options = me.hand.filter((c) => cardColors(c.card).includes(alt.color));
    return ask({ kind: 'cards', player: p, purpose: 'exileFromHandCost', min: 1, max: 1, options, params: { card, n: 1 } });
  }
  if (alt.name === 'webSlinging') {
    const options = d.battlefield.filter((x) => x.controller === p && x.tapped && isCreature(x.card));
    return ask({ kind: 'cards', player: p, purpose: 'returnCreatureCost', min: 1, max: 1, options, params: { card, n: 1 } });
  }
  return false;
}

/** How a cost is shown in a "costChoice" prompt: "life:3", "discard:1"… */
const costLabel = (c: AdditionalCost) =>
  c.kind === 'life' || c.kind === 'discard' || c.kind === 'exileGraveyard' ? `${c.kind}:${c.n}` : c.kind === 'mana' ? `mana:${c.cost}` : c.kind;

/**
 * Pays an additional cost once the spell is on its way (mana is paid with the mana cost). Returns true when the
 * caster first has to choose (cards to discard, exile or sacrifice, or which cost of "A or B").
 */
function payExtraCost(d: GameState, p: PlayerId, extra: AdditionalCost, item: StackItem, named: LogTarget[]): boolean {
  const me = d.players[p];
  const card = castCard(item).name;
  const ask = (choice: Choice) => {
    d.pending = { choice, resume: 'castCost', activation: { item, named } };
    return true;
  };
  switch (extra.kind) {
    case 'life':
      changeLife(d, p, -extra.n);
      return false;
    case 'mana':
      return false;
    case 'either':
      return ask({ kind: 'yesNo', player: p, purpose: 'costChoice', params: { card, yes: costLabel(extra.options[0]), no: costLabel(extra.options[1]) } });
    case 'sacrifice':
      return ask({
        kind: 'cards', player: p, purpose: 'sacrificeCost', min: 1, max: 1,
        options: matching(d, p, extra.which).filter((x) => x.controller === p), params: { card, n: 1 },
      });
    case 'discard':
      return ask({ kind: 'cards', player: p, purpose: 'discardCost', min: extra.n, max: extra.n, options: [...me.hand], params: { card, n: extra.n } });
    case 'exileGraveyard':
      return ask({ kind: 'cards', player: p, purpose: 'exileCost', min: extra.n, max: extra.n, options: [...me.graveyard], params: { card, n: extra.n } });
  }
  return false;
}

export function castCost(s: GameState, p: PlayerId, card: Card, opt: { face?: number; kicked?: boolean; from?: CastZone; iid?: string; alt?: number; exiled?: number; modes?: number[] }, x = 0): Cost {
  const face = opt.face ?? 0;
  const info = castInfo(card, face);
  const c = faceCard(card, face);
  // An alternative cost: no mana (Daze, evoke…), its own mana (cleave, warp, web-slinging), or the mana cost without
  // its Phyrexian symbols (paid with life).
  const alt = opt.alt === undefined ? undefined : info.alts[opt.alt];
  // Malcolm: free; airbend: {2}; plot: free.
  const exiled = opt.from === 'exile' && opt.iid ? s.players[p].exile.find((x) => x.iid === opt.iid) : undefined;
  const fixed = opt.from === 'graveyard' && opt.iid && s.castNow?.iid === opt.iid ? '' : exiled?.castFor?.cost;
  const base = alt ? altMana(c, alt, x)
    : fixed !== undefined ? parseCost(fixed)
    : opt.from === 'graveyard' && info.flashback ? parseCost(info.flashback) : costWithX(c, x);
  const kicker = opt.kicked && info.kicker ? parseCost(info.kicker) : { generic: 0, colored: [] };
  if (info.additional?.kind === 'mana') {
    const more = parseCost(info.additional.cost);
    kicker.generic += more.generic;
    kicker.colored = [...kicker.colored, ...more.colored];
  }
  // Spree and Tiered: the costs of the modes chosen (none chosen yet: the cheapest one, to know if it can be cast).
  const costs = info.modal?.costs;
  if (costs) {
    const total = (i: number) => { const m = parseCost(costs[i]); return m.generic + m.colored.length; };
    const chosen = opt.modes ?? [costs.map((_, i) => i).reduce((a, b) => (total(b) < total(a) ? b : a))];
    for (const i of chosen) {
      const more = parseCost(costs[i] ?? '');
      kicker.generic += more.generic;
      kicker.colored = [...kicker.colored, ...more.colored];
    }
  }
  const discount = (info.affinity ? s.battlefield.filter((x) => x.controller === p && cardMatches(x.card, info.affinity!)).length : 0)
    // March of Otherworldly Light: {2} less for each card exiled from the hand.
    + (info.exileDiscount && opt.exiled ? info.exileDiscount.per * opt.exiled : 0);
  // Commander tax: {2} more for each previous cast from the command zone; Defense Grid: {3} more off its caster's turn;
  // Thalia: {1} more for a noncreature spell; Damping Sphere: {1} more for each other spell cast this turn.
  const tax = (opt.from === 'command' && opt.iid ? 2 * (s.players[p].commanderCasts?.[opt.iid] ?? 0) : 0)
    + (isActivePlayer(s, p) ? 0 : 3 * withRule(s, 'offTurnSpellsCost3').length)
    + (isCreature(c) ? 0 : withRule(s, 'noncreatureSpellsCost1').length)
    + (s.players[p].spellsThisTurn ?? 0) * withRule(s, 'spellsCostMorePerSpell').length
    // Aven Interrupter: {2} more for an opponent's spell cast from a graveyard or from exile.
    + (opt.from === 'graveyard' || opt.from === 'exile' ? 2 * withRule(s, 'opponentsGraveyardExileSpellsCost2').filter((x) => teamOf(s, x.controller) !== teamOf(s, p)).length : 0);
  const cost = { generic: Math.max(0, base.generic + kicker.generic + tax - discount), colored: [...base.colored, ...kicker.colored] };
  // Trinisphere: less than three mana costs three.
  const total = cost.generic + cost.colored.length;
  if (total < 3 && withRule(s, 'spellsCostAtLeast3').length) cost.generic += 3 - total;
  return cost;
}

/** What can pay for casting `card`: mana, plus creatures to tap (convoke) and graveyard cards to exile (delve). */
export function castSources(s: GameState, p: PlayerId, card: Card, iid: string, face = 0): ManaSource[] {
  const info = castInfo(card, face);
  // A Spirit Guide can't pay for casting itself.
  const out = manaSources(s, p, faceCard(card, face)).filter((m) => m.iid !== `hand:${iid}`);
  if (info.convoke) {
    for (const x of s.battlefield) {
      if (x.controller !== p || x.tapped || !isCreature(x.card)) continue;
      // Convoke: each creature pays {1} or one mana of one of its colors.
      out.push({ iid: `convoke:${x.iid}`, colors: [...cardColors(x.card), 'C'], last: true });
    }
  }
  if (info.delve) {
    for (const c of s.players[p].graveyard) if (c.iid !== iid) out.push({ iid: `delve:${c.iid}`, colors: [], last: true });
  }
  return out;
}

/** The largest X `p` can pay for right now (0 when the card has no X, or none can be paid). */
export function maxX(s: GameState, p: PlayerId, card: Card): number {
  if (!xCount(card)) return 0;
  let x = 0;
  while (canPay(s, p, card, x + 1)) x++;
  return x;
}

export function canAttack(perm: Permanent): boolean {
  return (
    isCreature(perm.card) && !perm.tapped && (!perm.sick || hasKw(perm, 'haste')) &&
    !hasKw(perm, 'defender') && powerOf(perm) > 0 && !perm.statics?.cantAttack
  );
}

export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
  if (!isCreature(blocker.card) || blocker.tapped || blocker.statics?.cantBlock) return false;
  if (protectedFrom(attacker, blocker.card) || protectedFromPlayer(attacker, blocker.controller)) return false;
  // Brazen Borrower: "can block only creatures with flying".
  if (blocksOnlyFlyers(blocker.card) && !hasKw(attacker, 'flying')) return false;
  if (hasKw(attacker, 'flying')) return hasKw(blocker, 'flying') || hasKw(blocker, 'reach');
  return true;
}

export const isMainStep = (s: GameState) => s.step === 'main1' || s.step === 'main2';

/** Can `p` legally cast `card` right now (timing and mana; targets aside)? */
export function canCastNow(s: GameState, p: PlayerId, card: Card): boolean {
  if (isLandCard(card) || s.mulligan || s.pending || actor(s) !== p || castingForbidden(s, p) || spellNameStopped(s, card.name)) return false;
  return castTimingOk(s, p, card) && canPay(s, p, card);
}

/** Where card `iid` is and whether `p` may cast it from there (hand; graveyard with flashback; exile after an adventure). */
export function castSource(s: GameState, p: PlayerId, iid: string): { inst: CardInst; from: CastZone } | null {
  const ps = s.players[p];
  const inHand = ps.hand.find((c) => c.iid === iid);
  if (inHand) return { inst: inHand, from: 'hand' };
  // Drannith Magistrate: an opponent's makes the hand the only place to cast from.
  if (withRule(s, 'opponentsCastFromHandOnly').some((x) => teamOf(s, x.controller) !== teamOf(s, p))) return null;
  const inGrave = ps.graveyard.find((c) => c.iid === iid);
  // Grafdigger's Cage: "Players can't cast spells from graveyards or libraries."
  const now = s.castNow?.player === p && s.castNow.iid === iid;
  if (inGrave && (castInfo(inGrave.card).flashback || inGrave.flashbackOnTurn === s.turn || now) && !withRule(s, 'noCastingFromGraveyardsLibraries').length) return { inst: inGrave, from: 'graveyard' };
  // An adventurer, or a warped card on a later turn.
  const inExile = ps.exile.find((c) => c.iid === iid && (c.adventure || (c.warpedOnTurn !== undefined && s.turn > c.warpedOnTurn)
    || (c.castFor && (c.castFor.afterTurn === undefined || s.turn > c.castFor.afterTurn))));
  if (inExile) return { inst: inExile, from: 'exile' };
  const inCommand = ps.command?.find((c) => c.iid === iid);
  if (inCommand) return { inst: inCommand, from: 'command' };
  // Skycoach Conductor: "While it's prepared, you may cast a copy of its spell."
  const prepared = s.battlefield.find((x) => x.iid === iid && x.controller === p && x.prepared);
  if (prepared) return { inst: { iid, card: faceCard(printedCard(prepared), 1) }, from: 'prepared' };
  return null;
}

/** Does at least one way to choose modes give the spell useful targets? (Non-modal: its targets.) */
function usefulTargets(s: GameState, p: PlayerId, card: Card, choice: CastChoice): boolean {
  const info = castInfo(card, choice.face ?? 0);
  const check = (c: CastChoice) => castSpec(card, c).targets.every((spec) => legalTargets(s, p, spec, undefined, faceCard(card, c.face ?? 0)).length >= spec.min);
  if (!info.modal) return check(choice);
  return modeSets(info.modal).some((modes) => castSpec(card, { ...choice, modes }).effects.length && check({ ...choice, modes }));
}

/** The ways `p` can cast card `iid` right now (timing, mana, useful targets), cheapest first. */
export function castOptions(s: GameState, p: PlayerId, iid: string): CastOption[] {
  if (s.mulligan || s.pending || actor(s) !== p || castingForbidden(s, p)) return [];
  const src = castSource(s, p, iid);
  if (!src || spellNameStopped(s, src.inst.card.name)) return [];
  const { inst, from } = src;
  const faces = from === 'hand' ? playableFaces(inst.card) : [0];
  const out: CastOption[] = [];
  for (const face of faces) {
    const c = faceCard(inst.card, face);
    if (isLand(c)) continue;
    if (!castTimingFor(s, p, inst, c)) continue;
    const info = castInfo(inst.card, face);
    // Additional costs: understood (for a permanent) and payable.
    if (info.unknownCost && !isInstantOrSorcery(c)) continue;
    const extra = info.additional;
    if (extra && (extra.kind === 'either' ? extra.options : [extra]).every((o) => extraCostProblem(s, p, o, iid, c.name))) continue;
    for (const kicked of info.kicker ? [false, true] : [false]) {
      const cost = castCost(s, p, inst.card, { face, kicked, from, iid });
      if (!findPayment(castSources(s, p, inst.card, iid, face), cost)) continue;
      if (!usefulTargets(s, p, inst.card, { face, kicked })) continue;
      out.push({ face, kicked, from });
    }
    // March of Otherworldly Light: also cast exiling 1, 2… cards of its color from the hand.
    const discount = info.exileDiscount;
    if (discount) {
      const cards = s.players[p].hand.filter((c) => c.iid !== iid && cardColors(c.card).includes(discount.color)).length;
      for (let n = 1; n <= cards; n++) {
        if (!findPayment(castSources(s, p, inst.card, iid, face), castCost(s, p, inst.card, { face, from, iid, exiled: n }))) continue;
        out.push({ face, kicked: false, from, exiled: n });
      }
    }
    // Alternative costs (not with kicker): Daze, Force of Negation, evoke, cleave, warp, web-slinging, Phyrexian mana.
    if (inst.castFor || s.castNow?.iid === iid) continue; // its cost is already set
    info.alts.forEach((alt, i) => {
      if (altCostProblem(s, p, alt, iid, from)) return;
      const cost = castCost(s, p, inst.card, { face, from, iid, alt: i });
      if (!findPayment(castSources(s, p, inst.card, iid, face), cost)) return;
      if (!usefulTargets(s, p, inst.card, { face, kicked: false, alt: i })) return;
      out.push({ face, kicked: false, from, alt: i });
    });
  }
  return out;
}

/** Can `p` play this card as a land, on which face (modal double-faced cards may have a land on the back)? */
export function landFaces(card: Card): number[] {
  return playableFaces(card).filter((f) => isLand(faceCard(card, f)));
}

// ---------- Activated abilities ----------

/** The mana part of an ability's cost, with X set. */
/**
 * What activating an ability of `perm` costs, with its reductions: The Lonely Mountain's "{1} less for each Equipment
 * you control"; for equip, Dwarven Mauler's and Dragonfire Blade's (for `target`, or the cheapest creature to equip
 * when it isn't chosen yet) and Kíli's {0} for the first equip each turn.
 */
function abilityCost(s: GameState, perm: Permanent, spec: ActivatedSpec, x = 0, target?: Permanent): Cost {
  const cost = parseCost(spec.cost.mana);
  let generic = cost.generic + x * (spec.cost.mana.match(/\{X\}/g) ?? []).length;
  const p = perm.controller;
  if (spec.discountPer) generic -= matching(s, p, spec.discountPer).filter((x) => x.controller === p).length;
  if (spec.equip) {
    if (freeEquip(s, p)) return { generic: 0, colored: [] };
    const reduction = (c: Permanent) => equipDiscount(c.card) + (spec.equip!.perColor ? cardColors(c.card).length : 0);
    const options = target ? [target] : creaturesOf(s, p);
    generic -= Math.max(0, ...options.map(reduction));
  }
  return { ...cost, generic: Math.max(0, generic) };
}

/** Can `perm`'s ability `index` be paid now, aimed at `target` (equip costs depend on the creature)? */
export const canPayAbility = (s: GameState, perm: Permanent, index: number, target?: Permanent) => {
  const spec = activatedOf(perm.card)[index];
  return !!spec && !!findPayment(sourcesFor(s, perm, spec), abilityCost(s, perm, spec, 0, target));
};

/** Kíli: with an enduring story, the first equip ability `p` activates each turn costs {0}. */
const freeEquip = (s: GameState, p: PlayerId) =>
  !!s.players[p].enduringStory && !s.players[p].equipsThisTurn && s.battlefield.some((x) => x.controller === p && freeFirstEquip(x.card));

/**
 * Mana sources that can pay for an ability of `perm`: not the permanent itself when it must tap, nor a manland
 * paying to become a creature (it would be tapped to attack or block).
 */
const sourcesFor = (s: GameState, perm: Permanent, spec: ActivatedSpec) => {
  const mana = manaSources(s, perm.controller).filter((m) => !((spec.cost.tap || spec.ability.effects.some((e) => e.kind === 'animate' && e.to === 'self')) && m.iid === perm.iid));
  if (!spec.cost.waterbend) return mana;
  // Waterbend: each untapped artifact or creature (that isn't already a mana source) can be tapped to pay {1}; not the
  // permanent itself (Aang would no longer attack after transforming).
  const helpers = s.battlefield.filter((x) => x.controller === perm.controller && x.iid !== perm.iid && !x.tapped && (isCreature(x.card) || cardTypes(x.card).includes('artifact'))
    && !mana.some((m) => m.iid === x.iid));
  return [...mana, ...helpers.map((x): ManaSource => ({ iid: `convoke:${x.iid}`, colors: ['C'], last: true }))];
};

/** Why `p` can't activate this ability now (timing, tapping, mana, life), or null if they can. */
export function activationProblem(s: GameState, p: PlayerId, perm: Permanent, index: number, x = 0): GameErrorCode | null {
  const spec = activatedOf(perm.card)[index];
  if (!spec || perm.controller !== p) return 'noSuchAbility';
  if (activationsForbidden(s, perm)) return 'activationForbidden';
  if (nameStopped(s, printedCard(perm).name)) return 'nameStopped';
  // Magus of the Moon: a nonbasic land has only its {R} mana ability.
  if (mooned(s, perm.card)) return 'activationForbidden';
  if (s.mulligan || s.pending || actor(s) !== p) return 'activateTiming';
  const sorcerySpeed = !s.priority && isMainStep(s) && isActivePlayer(s, p) && !s.stack.length;
  if (spec.sorcery ? !sorcerySpeed : !s.priority && !(isMainStep(s) && isActivePlayer(s, p))) return 'activateTiming';
  if (spec.cost.tap && perm.tapped) return 'alreadyTapped';
  if (spec.cost.tap && isCreature(perm.card) && perm.sick && !hasKw(perm, 'haste')) return 'summoningSick';
  if (spec.once && perm.used?.includes(index)) return 'onceEachTurn';
  if (spec.cost.loyalty !== undefined) {
    // One loyalty ability per planeswalker each turn.
    if (perm.used?.some((i) => activatedOf(perm.card)[i]?.cost.loyalty !== undefined)) return 'onceEachTurn';
    if ((perm.counters.loyalty ?? 0) + spec.cost.loyalty < 0) return 'notEnoughLoyalty';
  }
  if (spec.cost.life && s.players[p].life < spec.cost.life) return 'notEnoughLife';
  if (spec.cost.removeCounter && !perm.counters[spec.cost.removeCounter]) return 'noCounterToRemove';
  if (spec.cost.exileFromGraveyard && !s.players[p].graveyard.some((c) => cardMatches(c.card, spec.cost.exileFromGraveyard!))) return 'nothingToExile';
  if (spec.cost.sacrifice && !sacrificeOptions(s, perm, spec).length) return 'nothingToSacrifice';
  if (spec.cost.crew !== undefined && crewOptions(s, perm).reduce((n, x) => n + powerOf(x), 0) < spec.cost.crew) return 'notEnoughCrew';
  if (!findPayment(sourcesFor(s, perm, spec), abilityCost(s, perm, spec, x))) return 'notEnoughMana';
  return null;
}

/** The largest X `p` can pay for an ability with {X} in its cost. */
export function abilityMaxX(s: GameState, perm: Permanent, index: number): number {
  const spec = activatedOf(perm.card)[index];
  if (!spec?.cost.mana.includes('{X}')) return 0;
  let x = 0;
  while (findPayment(sourcesFor(s, perm, spec), abilityCost(s, perm, spec, x + 1))) x++;
  return x;
}

/** What may be sacrificed to pay an ability's "Sacrifice a creature" cost. */
function sacrificeOptions(s: GameState, perm: Permanent, spec: ActivatedSpec): Permanent[] {
  const cost = spec.cost.sacrifice!;
  return matching(s, perm.controller, cost.which).filter((x) => x.controller === perm.controller && !(cost.another && x.iid === perm.iid));
}

/** The spell's costs are paid: it goes on the stack, cast triggers fire, and the opponent may respond. */
function finishCast(d: GameState, item: StackItem, named: LogTarget[]) {
  const p = item.controller;
  const card = castCard(item);
  d.stack.push(item);
  log(d, {
    k: 'cast', p, card: faceName(item.card, item.face ?? 0), ...(named.length ? { targets: named } : {}), ...(item.kicked ? { kicked: true } : {}), ...(item.from ? { from: item.from } : {}),
  });
  if (!item.copy) {
    d.players[p].spellsThisTurn = (d.players[p].spellsThisTurn ?? 0) + 1;
    if (!isCreature(card)) d.players[p].noncreatureThisTurn = (d.players[p].noncreatureThisTurn ?? 0) + 1;
  }
  // Sowing Mycospawn: "When you cast this spell, …" (a copy isn't cast).
  if (!item.copy) {
    for (const t of triggersOf(card)) {
      if (t.event.on === 'castSelf' && (!t.event.kicked || item.kicked)) queueTrigger(d, { iid: item.iid, card }, p, t.ability);
    }
  }
  fireCast(d, p, card);
  if (item.noMana) fireCastWithoutMana(d, item);
  fireWard(d, item);
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = nextPlayer(d, p);
  } else {
    openWindow(d, 'main', nextPlayer(d, p), 0);
  }
}

/** The ability's costs are paid: it goes on the stack and the opponent may respond. */
function finishActivation(d: GameState, item: StackItem, named: LogTarget[]) {
  const p = item.controller;
  d.stack.push(item);
  log(d, { k: 'activate', p, card: item.card.name, ...(named.length ? { targets: named } : {}) });
  fireWard(d, item);
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = nextPlayer(d, p);
  } else {
    openWindow(d, 'main', nextPlayer(d, p), 0);
  }
}

/** Abilities `p` could activate right now with legal targets, as [permanent, index] pairs. */
export function activatable(s: GameState, p: PlayerId): { perm: Permanent; index: number; spec: ActivatedSpec }[] {
  return s.battlefield.flatMap((perm) =>
    perm.controller !== p ? [] : activatedOf(perm.card).flatMap((spec, index) =>
      spec.ability.effects.length && !activationProblem(s, p, perm, index) &&
      spec.ability.targets.every((slot) => legalTargets(s, p, slot).length >= slot.min)
        ? [{ perm, index, spec }] : []),
  );
}

// ---------- Targets ----------

const blockerIds = (s: GameState) => Object.values(s.blocks).flat();

/** Supertype and subtype conditions: "basic", "nonbasic land", "Forest or Plains". */
function fitsTypeLine(card: Card, f: TargetFilter): boolean {
  const [types] = card.typeLine.split('//')[0].toLowerCase().split('—');
  if (f.basic && !types.includes('basic')) return false;
  if (f.nonbasicLands && types.includes('land') && types.includes('basic')) return false;
  if (f.legendary && !types.includes('legendary')) return false;
  if (f.snow && !types.includes('snow')) return false;
  if (f.nonSubtypes?.some((t) => hasSubtype(card, t))) return false;
  if (f.subtypes && !f.subtypes.some((t) => hasSubtype(card, t))) return false;
  return true;
}

/** Where a card is in a graveyard, if it is. */
export function findInGraveyard(s: GameState, iid: string): { inst: CardInst; owner: PlayerId } | undefined {
  for (const owner of playersOf(s)) {
    const inst = s.players[owner].graveyard.find((c) => c.iid === iid);
    if (inst) return { inst, owner };
  }
  return undefined;
}

/** Does a card (a permanent, or a spell on the stack) pass the filter, from `caster`'s point of view? */
function matchesFilter(s: GameState, f: TargetFilter, caster: PlayerId, x: CardInst, controller: PlayerId): boolean {
  const perm = isPermanent(x) ? x : undefined;
  const types = cardTypes(x.card);
  const colors = x.card.colors;
  if (f.types && !f.types.some((t) => types.includes(t)) && !f.orSubtypes?.some((t) => hasSubtype(x.card, t))) return false;
  if (f.nonTypes?.some((t) => types.includes(t))) return false;
  // "you control": the caster; "an opponent controls": the other team (a teammate is neither).
  if (f.controller === 'you' && controller !== caster) return false;
  if (f.controller === 'opponent' && teamOf(s, controller) === teamOf(s, caster)) return false;
  if (f.colors && !f.colors.some((c) => colors.includes(c))) return false;
  if (f.nonColors?.some((c) => colors.includes(c))) return false;
  if (f.keyword && !hasKw(x, f.keyword)) return false;
  if (f.withoutKeyword && hasKw(x, f.withoutKeyword)) return false;
  if (f.maxManaValue !== undefined && x.card.cmc > f.maxManaValue) return false;
  if (f.minManaValue !== undefined && x.card.cmc < f.minManaValue) return false;
  if (!fitsTypeLine(x.card, f)) return false;
  const pow = perm ? powerOf(perm) : power(x.card);
  if (f.minPower !== undefined && pow < f.minPower) return false;
  if (f.maxPower !== undefined && pow > f.maxPower) return false;
  // Stern Scolding: "with power or toughness 2 or less".
  if (f.maxPowerOrToughness !== undefined && pow > f.maxPowerOrToughness && (perm ? toughnessOf(perm) : toughness(x.card)) > f.maxPowerOrToughness) return false;
  // Wash Away: "that wasn't cast from its owner's hand" (a spell; `from` is set for other zones).
  if (f.notCastFromHand && !(x as StackItem).from) return false;
  // Battlefield-only conditions.
  if (f.tapped !== undefined && perm?.tapped !== f.tapped) return false;
  if (f.token !== undefined && (!perm || isToken(printedCard(perm)) !== f.token)) return false;
  const attacking = !!perm && s.attackers.includes(perm.iid);
  const blocking = !!perm && blockerIds(s).includes(perm.iid);
  if (f.attacking && !attacking) return false;
  if (f.blocking && !blocking) return false;
  if (f.inCombat && !attacking && !blocking) return false;
  return true;
}

/**
 * Is `t` a legal choice for a target slot of a spell or ability controlled by `caster`? `source` is the
 * card targeting (for protection from its colors): when unknown, protection isn't checked.
 */
export function isLegalTarget(s: GameState, caster: PlayerId, spec: TargetSpec, t: Target, selfIid?: string, source?: Card): boolean {
  if (!fitsSpec(s, caster, spec, t, selfIid)) return false;
  if (t.kind !== 'permanent') return true;
  // Targeting restrictions: hexproof (against opponents), shroud, protection.
  const perm = findPermanent(s, t.iid)!;
  if (hasKw(perm, 'shroud')) return false;
  if (hasKw(perm, 'hexproof') && perm.controller !== caster) return false;
  if (protectedFromPlayer(perm, caster)) return false;
  // Dragonfire Blade: "hexproof from monocolored" (an opponent's spell or ability from a one-color source).
  if (perm.statics?.hexproofFromMonocolored && perm.controller !== caster && source && cardColors(source).length === 1) return false;
  return !(source && protectedFrom(perm, source));
}

/** Does `t` match the slot's kind and restrictions (without targeting rules: also used for "all …" effects)? */
function fitsSpec(s: GameState, caster: PlayerId, spec: TargetSpec, t: Target, selfIid?: string): boolean {
  // "other target …": `selfIid` is the source permanent, or its ability on the stack.
  if (spec.filter.other && selfIid && t.kind === 'permanent' && (t.iid === selfIid || s.stack.find((i) => i.iid === selfIid)?.source === t.iid)) return false;
  if (t.kind === 'player') {
    if (spec.kind !== 'player' && spec.kind !== 'any') return false;
    if (spec.filter.controller === 'you') return t.player === caster;
    if (spec.filter.controller === 'opponent') return teamOf(s, t.player) !== teamOf(s, caster);
    return t.player >= 0 && t.player < s.players.length;
  }
  if (t.kind === 'card') {
    const found = findInGraveyard(s, t.iid);
    return spec.kind === 'card' && !!found && matchesFilter(s, spec.filter, caster, found.inst, found.owner);
  }
  if (t.kind === 'spell') {
    const item = s.stack.find((x) => x.iid === t.iid);
    if ((spec.kind !== 'spell' && spec.kind !== 'spellOrPermanent') || !item || item.iid === selfIid) return false;
    // An ability: ward counters any; Tale's End and Tidebinder name activated and/or triggered ones.
    if (item.ability) return !!spec.filter.abilities || !!spec.filter.abilityKinds?.includes(item.triggered ? 'triggered' : 'activated');
    if (spec.filter.noSpells) return false;
    // "target spell or creature": the type words are the permanent's, any spell will do.
    const f = spec.kind === 'spellOrPermanent' ? { ...spec.filter, types: undefined, nonTypes: undefined } : spec.filter;
    return matchesFilter(s, f, caster, item, item.controller);
  }
  const perm = findPermanent(s, t.iid);
  if (!perm || spec.kind === 'card') return false;
  const types = cardTypes(perm.card);
  const kindOk =
    spec.kind === 'creature' ? types.includes('creature')
    : spec.kind === 'any' ? types.includes('creature') || types.includes('planeswalker')
    : spec.kind === 'permanent' || spec.kind === 'spellOrPermanent';
  return kindOk && matchesFilter(s, spec.filter, caster, perm, perm.controller);
}

/** Permanents an "all …"/"each …" effect controlled by `caster` touches. */
export function matching(s: GameState, caster: PlayerId, which: Selector): Permanent[] {
  const spec: TargetSpec = { kind: which.kind, min: 0, max: 0, filter: which.filter };
  return s.battlefield.filter((x) => fitsSpec(s, caster, spec, { kind: 'permanent', iid: x.iid }));
}

/** Does the card match a filter of card words ("nonland", "creature")? Used for cards in hand. */
export const cardMatches = (card: Card, f: TargetFilter) => {
  const types = cardTypes(card);
  return (!f.types || f.types.some((t) => types.includes(t)) || !!f.orSubtypes?.some((t) => hasSubtype(card, t))) && !f.nonTypes?.some((t) => types.includes(t)) &&
    (f.maxManaValue === undefined || card.cmc <= f.maxManaValue) && fitsTypeLine(card, f) &&
    (!f.manaCosts || f.manaCosts.includes(card.manaCost.split(' // ')[0]));
};

/** Every legal choice for a target slot right now. */
export function legalTargets(s: GameState, caster: PlayerId, spec: TargetSpec, selfIid?: string, source?: Card): Target[] {
  const all: Target[] = [
    ...playersOf(s).map((player): Target => ({ kind: 'player', player })),
    ...s.battlefield.map((x): Target => ({ kind: 'permanent', iid: x.iid })),
    ...s.stack.map((x): Target => ({ kind: 'spell', iid: x.iid })),
    ...(spec.kind === 'card' ? playersOf(s).flatMap((p) => s.players[p].graveyard.map((c): Target => ({ kind: 'card', iid: c.iid }))) : []),
  ];
  return all.filter((t) => isLegalTarget(s, caster, spec, t, selfIid, source));
}

/** Could the spell be cast with legal targets right now? (A counterspell needs a spell to counter.) */
export function hasUsefulTarget(s: GameState, p: PlayerId, card: Card): boolean {
  return spellSpec(card).targets.every((spec) => legalTargets(s, p, spec, undefined, card).length >= spec.min);
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.iid === (b as { iid: string }).iid);

function targetName(s: GameState, t: Target): LogTarget {
  if (t.kind === 'player') return { p: t.player };
  const x = t.kind === 'spell' ? s.stack.find((i) => i.iid === t.iid) : t.kind === 'card' ? findInGraveyard(s, t.iid)?.inst : findPermanent(s, t.iid);
  return { card: x?.card.name ?? '?' };
}

/** Checks chosen targets against the spell's slots; returns them with one list per slot. */
function checkTargets(s: GameState, caster: PlayerId, card: Card, spec: AbilitySpec, chosen: Target[][], selfIid?: string): Target[][] {
  if (chosen.length > spec.targets.length) throw new IllegalAction('tooManyTargets', { card: card.name });
  return spec.targets.map((slot, i) => {
    const ts = chosen[i] ?? [];
    if (ts.length < slot.min) throw new IllegalAction('needsTarget', { card: card.name });
    if (ts.length > slot.max) throw new IllegalAction('tooManyTargets', { card: card.name });
    ts.forEach((t, j) => {
      if (ts.slice(0, j).some((u) => sameTarget(t, u))) throw new IllegalAction('tooManyTargets', { card: card.name });
      if (!isLegalTarget(s, caster, slot, t, selfIid, card)) {
        const kindOk =
          (t.kind === 'player' && (slot.kind === 'player' || slot.kind === 'any')) ||
          (t.kind === 'spell' && slot.kind === 'spell') ||
          (t.kind === 'card' && slot.kind === 'card') ||
          (t.kind === 'permanent' && slot.kind !== 'player' && slot.kind !== 'spell' && slot.kind !== 'card');
        if (!kindOk) throw new IllegalAction('targetMustBe', { kind: slot.kind });
        throw new IllegalAction('illegalTarget', { card: card.name });
      }
    });
    return ts;
  });
}

// ---------- Choices ----------

/** Throws if `answer` doesn't answer `choice`. */
export function validateAnswer(choice: Choice, answer: Answer): void {
  const bad = () => new IllegalAction('badChoice');
  if (answer.kind !== choice.kind) throw bad();
  if (choice.kind === 'cards' && answer.kind === 'cards') {
    const ids = new Set(answer.iids);
    if (ids.size !== answer.iids.length || ids.size < choice.min || ids.size > choice.max) throw bad();
    if (answer.iids.some((iid) => !choice.options.some((c) => c.iid === iid))) throw bad();
  } else if (choice.kind === 'arrange' && answer.kind === 'arrange') {
    const placed = Object.entries(answer.zones).flatMap(([zone, iids]) => {
      if (!choice.zones.includes(zone as ArrangeZone)) throw bad();
      return iids ?? [];
    });
    const expected = choice.cards.map((c) => c.iid).sort();
    if (placed.length !== expected.length || [...placed].sort().some((iid, i) => iid !== expected[i])) throw bad();
  } else if (choice.kind === 'mode' && answer.kind === 'mode') {
    const modes = new Set(answer.modes);
    if (modes.size !== answer.modes.length || modes.size < choice.min || modes.size > choice.max) throw bad();
    if (answer.modes.some((m) => !Number.isInteger(m) || m < 0 || m >= choice.modes.length || choice.disabled?.includes(m))) throw bad();
  } else if (choice.kind === 'targets' && answer.kind === 'targets') {
    if (!Array.isArray(answer.targets) || answer.targets.length > choice.slots.length || answer.targets.some((ts) => !Array.isArray(ts))) throw bad();
  }
}

// ---------- Setup ----------

export interface NewGameOptions {
  /** One deck and name per player: 2 for a duel, 4 for Two-Headed Giant (players 0+1 against 2+3). */
  decks: Card[][];
  /** Commander games: each player's commanders (none is allowed: the deck then plays without one). */
  commanders?: Card[][];
  names: string[];
  /** The player (in 2HG: the team's first player) who starts. */
  first: PlayerId;
  mode?: GameMode;
  rng?: Rng;
  /** Start with London mulligan decisions (default true). */
  mulligans?: boolean;
  /** Players who stop at every priority window (see GameState.fullControl). */
  fullControl?: boolean[];
  /** Stops decided from public information only (see GameState.publicStops). */
  publicStops?: boolean;
}

/** Starting life: 20, Commander 40; a Two-Headed Giant team shares 30 (Commander 60). */
export const startingLife = (mode?: GameMode) => (mode?.twoHeaded ? 30 : 20) * (mode?.commander ? 2 : 1);

export function newGame({ decks, names, first, mode, commanders, rng = Math.random, mulligans = true, fullControl, publicStops }: NewGameOptions): GameState {
  const twoHeaded = !!mode?.twoHeaded && decks.length === 4;
  const player = (p: PlayerId): PlayerState => ({
    name: names[p],
    life: startingLife(mode),
    library: shuffle(decks[p].map((card, i) => ({ iid: `${p}-${i}`, card })), rng),
    hand: [],
    graveyard: [],
    exile: [],
    landPlayed: false,
    ...(mode?.commander ? {
      command: (commanders?.[p] ?? []).map((card, i) => ({ iid: `${p}-cmd-${i}`, card, commander: true })),
      identity: [...new Set((commanders?.[p] ?? []).flatMap((c) => c.colorIdentity))] as Color[],
    } : {}),
  });
  const d: GameState = {
    players: decks.map((_, p) => player(p)),
    ...(twoHeaded ? { teams: [[0, 1], [2, 3]] } : {}),
    ...(mode && (mode.twoHeaded || mode.commander) ? { mode } : {}),
    battlefield: [],
    stack: [],
    active: first,
    turn: 0,
    step: 'mulligan',
    priority: null,
    mulligan: null,
    pending: null,
    resolving: null,
    attackers: [],
    blocks: {},
    winner: null,
    log: [{ k: 'goesFirst', p: first }],
    seed: Math.floor(rng() * 2 ** 32),
    ...(fullControl ? { fullControl: [...fullControl] } : {}),
    ...(publicStops ? { publicStops } : {}),
  };
  for (const p of playersOf(d)) draw(d, p, 7);
  if (mulligans) d.mulligan = { player: first, count: d.players.map(() => 0), kept: d.players.map(() => false) };
  else beginTurn(d, first, true);
  return d;
}

// ---------- Mutating helpers (only ever used on a fresh clone) ----------

/** mulberry32: small, fast, good enough for shuffling. */
function random(d: GameState): number {
  d.seed = (d.seed + 0x6d2b79f5) | 0;
  let t = d.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function log(d: GameState, entry: LogEntry) {
  d.log.push(entry);
  if (d.log.length > 200) d.log.splice(0, d.log.length - 200);
}

/** `p` draws `n` cards (`drawStep`: the draw of their draw step). */
function draw(d: GameState, p: PlayerId, n: number, drawStep = false) {
  const ps = d.players[p];
  // Quantum Riddler: with one or fewer cards in hand, one more (each one applies).
  if (n > 0 && ps.hand.length <= 1) n += d.battlefield.filter((x) => x.controller === p && drawsOneMore(x.card)).length;
  for (let i = 0; i < n; i++) {
    const card = ps.library.shift();
    if (!card) {
      log(d, { k: 'emptyLibrary', p });
      teamLoses(d, p);
      return;
    }
    ps.hand.push(card);
    ps.drawnThisTurn = (ps.drawnThisTurn ?? 0) + 1;
    fireDraw(d, p, drawStep && i === 0);
  }
}

/** A card `p` drew: "whenever an opponent draws" (Orcish Bowmasters, Faerie Mastermind). */
function fireDraw(d: GameState, p: PlayerId, firstInDrawStep: boolean) {
  const nth = d.players[p].drawnThisTurn ?? 0;
  for (const x of d.battlefield) {
    for (const t of triggersOf(x.card)) {
      if (t.event.on !== 'opponentDraws') continue;
      if (!t.event.anyPlayer && teamOf(d, x.controller) === teamOf(d, p)) continue;
      if (t.event.nth !== undefined && t.event.nth !== nth) continue;
      if (t.event.notFirstInDrawStep && firstInDrawStep) continue;
      queueTrigger(d, x, x.controller, t.ability);
    }
  }
}

/** A turn begins for p's team (both heads in Two-Headed Giant): untap, upkeep, draw. */
function beginTurn(d: GameState, p: PlayerId, skipDraw: boolean) {
  d.active = p;
  d.turnHead = p;
  delete d.headsDone;
  d.turn++;
  d.step = 'main1';
  for (const q of teamPlayers(d, p)) {
    d.players[q].landPlayed = false;
    // "Until your next turn" ends.
    delete d.players[q].sorceryFlash;
    d.players[q].turns = (d.players[q].turns ?? 0) + 1;
  }
  for (const ps of d.players) {
    delete ps.drawnThisTurn;
    delete ps.spellsThisTurn;
    delete ps.noncreatureThisTurn;
    delete ps.gainedThisTurn;
    delete ps.lostThisTurn;
    delete ps.equipsThisTurn;
  }
  emptyPools(d);
  for (const perm of d.battlefield) {
    if (isActivePlayer(d, perm.controller)) {
      // Stun: "If a permanent with a stun counter would become untapped, remove one from it instead."
      if (perm.tapped && perm.counters.stun) perm.counters = { ...perm.counters, stun: perm.counters.stun - 1 };
      else if (!doesntUntap(perm.card)) perm.tapped = false;
      perm.sick = false;
    }
    delete perm.used;
    delete perm.triggeredOnce;
  }
  log(d, { k: 'turn', n: d.turn, p });
  fireStep(d, 'upkeep');
  if (d.triggered?.length) {
    // Upkeep triggers resolve before the draw (see closeWindow).
    d.step = 'upkeep';
    d.priority = { player: p, passes: 0, reason: 'upkeep' };
    return;
  }
  drawStep(d, skipDraw);
}

/** Draw for the turn (each head of the team), then the opponents may act before the first main phase. */
function drawStep(d: GameState, skipDraw: boolean) {
  d.step = 'main1';
  if (!skipDraw) for (const q of teamPlayers(d, d.active)) draw(d, q, 1, true);
  // Mana Vault: "At the beginning of your draw step, …" (put on the stack with the opponents' priority below).
  fireStep(d, 'draw');
  // After the draw step, each Saga of the active player gets a lore counter (CR 714.3b).
  for (const perm of d.battlefield.filter((x) => isActivePlayer(d, x.controller) && isSaga(x.card))) addLore(d, perm);
  if (d.winner === null) openForOpponents(d, 'begin');
}

/** The active team has passed: priority goes to the opponents (who must all pass too). */
function openForOpponents(d: GameState, reason: WindowReason) {
  openWindow(d, reason, firstOpponent(d, d.active), teamPlayers(d, d.active).length);
}

/** Cleanup step: each player of the active team discards down to seven (their choice), then the turn passes. */
function endTurn(d: GameState) {
  for (const q of teamPlayers(d, d.active)) {
    const hand = d.players[q].hand;
    const excess = hand.length - 7;
    if (excess > 0) {
      d.pending = {
        choice: { kind: 'cards', player: q, purpose: 'cleanupDiscard', min: excess, max: excess, options: [...hand], params: { n: excess } },
        resume: 'cleanup',
      };
      return;
    }
  }
  finishTurn(d);
}

function finishCleanup(d: GameState, p: PlayerId, iids: string[]) {
  const me = d.players[p];
  for (const iid of iids) {
    const inst = me.hand.find((c) => c.iid === iid)!;
    me.hand = me.hand.filter((c) => c !== inst);
    putInZone(d, p, inst, 'graveyard');
    log(d, { k: 'discard', p, card: inst.card.name, cleanup: true });
  }
  endTurn(d); // the next head, if any, then the next turn
}

function finishTurn(d: GameState) {
  // Day of Black Sun: "loses all abilities until end of turn".
  for (const loss of (d.abilityLoss ?? []).filter((x) => x.by === 'endOfTurn')) {
    const back = findPermanent(d, loss.iid);
    if (back) back.card = loss.card;
  }
  if (d.abilityLoss) d.abilityLoss = d.abilityLoss.filter((x) => x.by !== 'endOfTurn');
  for (const perm of d.battlefield) {
    // "until end of turn": a crewed Vehicle or Iron Man Armor is no longer a creature.
    if (perm.unanimated) {
      perm.card = perm.unanimated;
      delete perm.unanimated;
    }
    perm.damage = 0;
    perm.deathtouched = false;
    perm.boosts = perm.boosts.filter((b) => b.until !== 'endOfTurn');
    if (perm.controlUntilEndOfTurn) {
      perm.controller = perm.owner ?? perm.controller;
      delete perm.owner;
      delete perm.controlUntilEndOfTurn;
    }
  }
  delete d.preventCombat;
  delete d.shields;
  // An extra turn: the same team goes again.
  const extra = d.extraTurns?.[d.active] ?? 0;
  if (extra > 0) {
    d.extraTurns![d.active] = extra - 1;
    return beginTurn(d, d.active, false);
  }
  beginTurn(d, nextTeamLead(d, d.active), false);
}

const newPermanent = (inst: CardInst, controller: PlayerId, turn?: number): Permanent => ({
  iid: inst.iid, card: inst.card, controller, tapped: false, sick: true, damage: 0, deathtouched: false, counters: {}, boosts: [],
  ...(turn !== undefined ? { enteredOnTurn: turn } : {}),
  ...(inst.commander ? { commander: true } : {}),
});

/**
 * A card goes to one of its owner's zones; a commander goes to the command zone instead (the owner may
 * choose that, and the simulation always does).
 */
/** Seam Rip left the battlefield: what it exiled "until this leaves the battlefield" comes back under its owner's control. */
function returnExiledUntil(d: GameState, source: Permanent) {
  const linked = (d.exiledUntil ?? []).filter((x) => x.source === source.iid);
  if (!linked.length) return;
  d.exiledUntil = d.exiledUntil!.filter((x) => x.source !== source.iid);
  for (const l of linked) {
    const ps = d.players[l.owner];
    const inst = ps.exile.find((c) => c.iid === l.iid);
    if (!inst) continue; // a token, or the card moved on
    // Containment Priest: a creature coming back this way is exiled instead (it stays in exile).
    if (uncastExiled(d, inst.card)) {
      log(d, { k: 'exiledInstead', card: inst.card.name });
      continue;
    }
    ps.exile = ps.exile.filter((c) => c !== inst);
    log(d, { k: 'returned', card: inst.card.name, dest: 'battlefield' });
    enterBattlefield(d, inst, l.owner);
  }
}

function putInZone(d: GameState, owner: PlayerId, inst: CardInst, zone: 'graveyard' | 'exile' | 'hand') {
  const ps = d.players[owner];
  if (zone === 'graveyard' && graveyardExiled(d, owner)) zone = 'exile';
  if (inst.commander && ps.command) {
    ps.command.push({ iid: inst.iid, card: inst.card, commander: true });
    log(d, { k: 'toCommand', card: inst.card.name });
    return;
  }
  ps[zone].push(inst);
}

function removePermanent(d: GameState, perm: Permanent, zone: 'graveyard' | 'exile') {
  // Rest in Peace: exiled instead, so it doesn't die (a token too). Checked while the permanent is still there.
  // A finality counter: "If a permanent with a finality counter on it would die, exile it instead."
  if (zone === 'graveyard' && (graveyardExiled(d, perm.owner ?? perm.controller) || perm.counters.finality)) zone = 'exile';
  d.battlefield = d.battlefield.filter((x) => x.iid !== perm.iid);
  returnExiledUntil(d, perm);
  // Tishana's Tidebinder leaves: the permanents it took the abilities of get them back.
  for (const loss of (d.abilityLoss ?? []).filter((x) => x.by === perm.iid)) {
    const back = findPermanent(d, loss.iid);
    if (back) back.card = loss.card;
  }
  if (d.abilityLoss) d.abilityLoss = d.abilityLoss.filter((x) => x.by !== perm.iid && x.iid !== perm.iid);
  // Skyclave Apparition leaves: the exiled card's owner creates an X/X blue Illusion.
  if (illusionWhenLeaving(perm.card) && perm.exiledCard) {
    const { cmc, owner } = perm.exiledCard;
    const illusion = { name: 'Illusion', typeLine: 'Token Creature — Illusion', colors: ['U'] as Color[], power: cmc, toughness: cmc, keywords: [], oracleText: '' };
    queueTrigger(d, perm, owner, { targets: [], effects: [{ kind: 'token', n: 1, token: illusion }] });
  }
  // A token that leaves the battlefield ceases to exist (it still "dies").
  if (!isToken(printedCard(perm))) putInZone(d, perm.owner ?? perm.controller, { iid: perm.iid, card: printedCard(perm), ...(perm.commander ? { commander: true } : {}) }, zone);
  // A creature dies; an artifact's "When this artifact is put into a graveyard from the battlefield" too.
  if (zone === 'graveyard' && (isCreature(perm.card) || triggersOf(perm.card).some((t) => t.event.on === 'dies' && t.event.self))) fireObject(d, 'dies', perm);
  // Skullclamp: "Whenever equipped creature dies" (its Equipment is still attached).
  if (zone === 'graveyard' && isCreature(perm.card)) {
    for (const eq of d.battlefield.filter((x) => x.attachedTo === perm.iid)) {
      for (const t of triggersOf(eq.card)) if (t.event.on === 'equippedDies') queueTrigger(d, eq, eq.controller, t.ability);
    }
  }
}

/**
 * Pays with the chosen mana: spends pool mana, taps the permanents (their other mana goes to the
 * pool, e.g. Sol Ring's second mana) and sacrifices those whose mana ability says so (Treasure).
 */
function payMana(d: GameState, p: PlayerId, plan: ManaPick[]) {
  const ps = d.players[p];
  const pool = ps.pool ?? [];
  const spentPool = new Set(plan.filter((m) => m.iid.startsWith('pool:')).map((m) => Number(m.iid.slice(5))));
  const next = pool.filter((_, i) => !spentPool.has(i));
  // Mystic Gate last: the land it taps along is one the plan left out.
  const gateLast = (iid: string) => {
    const perm = findPermanent(d, iid);
    return perm && filterMana(perm.card) ? 1 : 0;
  };
  const iids = [...new Set(plan.filter((m) => !m.iid.startsWith('pool:')).map((m) => m.iid))].sort((a, b) => gateLast(a) - gateLast(b));
  for (const iid of iids) {
    if (iid.startsWith('convoke:')) {
      tapPermanent(d, findPermanent(d, iid.slice(8))!);
      continue;
    }
    if (iid.startsWith('hand:')) {
      const inst = ps.hand.find((c) => c.iid === iid.slice(5))!;
      ps.hand = ps.hand.filter((c) => c !== inst);
      ps.exile.push(inst);
      log(d, { k: 'exiledCard', card: inst.card.name, from: 'hand' });
      continue;
    }
    if (iid.startsWith('delve:')) {
      const inst = ps.graveyard.find((c) => c.iid === iid.slice(6))!;
      ps.graveyard = ps.graveyard.filter((c) => c !== inst);
      ps.exile.push(inst);
      continue;
    }
    const perm = findPermanent(d, iid)!;
    const spent = new Set(plan.filter((m) => m.iid === iid).map((m) => m.index));
    const pain = painOf(d, perm);
    unitsOf(d, perm).forEach((colors, i) => {
      if (!spent.has(i)) next.push({ colors, source: iid, ...(pain ? { pain } : {}) });
    });
    tapForManaOnly(d, perm);
  }
  // Starting Town: "{T}, Pay 1 life: Add one mana of any color." spent as a color.
  const life = plan.reduce((n, m) => n + (m.life ?? 0), 0);
  if (life) changeLife(d, p, -life);
  if (next.length) ps.pool = next;
  else delete ps.pool;
}

/** Taps an untapped permanent: City of Brass's "whenever this land becomes tapped" triggers. */
function tapPermanent(d: GameState, perm: Permanent) {
  if (perm.tapped) return;
  perm.tapped = true;
  for (const t of triggersOf(perm.card)) if (t.event.on === 'becomesTapped') queueTrigger(d, perm, perm.controller, t.ability);
}

/** Taps a mana source (sacrificing a Treasure); the caller deals with its mana. */
function tapForManaOnly(d: GameState, perm: Permanent) {
  // Springleaf Drum: "Tap an untapped creature you control" too.
  const helper = manaHelpers(d, perm)[0];
  if (helper) tapPermanent(d, helper);
  // Mystic Gate: the land paying {W/U} (when it makes two mana).
  const filtered = filterMana(perm.card) && unitsOf(d, perm).length === 2 ? filterHelpers(d, perm)[0] : undefined;
  if (filtered) tapPermanent(d, filtered);
  tapPermanent(d, perm);
  // Gemstone Mine: a mining counter removed; sacrificed when none is left.
  if (stateMana(perm.card) === 'mining') {
    perm.counters = { ...perm.counters, mining: Math.max(0, (perm.counters.mining ?? 0) - 1) };
    if (!perm.counters.mining) sacrifice(d, perm);
  }
  const life = manaLifeCost(perm.card);
  if (life) changeLife(d, perm.controller, -life);
  if (/\{T\}, Sacrifice [^:]*: Add/i.test(perm.card.oracleText)) sacrifice(d, perm);
}

/** Pays a cost from `p`'s pool and mana sources, or returns false if it can't be paid. */
function pay(d: GameState, p: PlayerId, sources: ManaSource[], cost: { generic: number; colored: Color[][] }): boolean {
  const plan = planPayment(sources, cost);
  if (!plan) return false;
  payMana(d, p, plan);
  return true;
}

/** The sources the player chose (`pay` in the action), or all of them when the engine chooses. */
const chosenSources = (sources: ManaSource[], chosen?: string[]) => (chosen ? sources.filter((m) => chosen.includes(m.iid)) : sources);

/** Not enough mana: with sources the player chose, say so (other sources might have paid). */
const unpaid = (chosen: string[] | undefined, card: string) => new IllegalAction(chosen ? 'chosenManaShort' : 'notEnoughMana', { card });

/**
 * What an action costs and what can pay for it (pool mana, permanents to tap, creatures to convoke, cards to delve…),
 * so the player can choose the sources. Null when it costs no mana or isn't a spell or ability.
 */
export function paymentFor(s: GameState, p: PlayerId, action: Action): { sources: ManaSource[]; cost: Cost } | null {
  if (action.type === 'cast') {
    const src = castSource(s, p, action.iid);
    if (!src) return null;
    const face = action.face ?? 0;
    const info = castInfo(src.inst.card, face);
    const alt = action.alt !== undefined && info.alts[action.alt] ? action.alt : undefined;
    const kicked = !!action.kicked && !!info.kicker && alt === undefined;
    const x = xCount(faceCard(src.inst.card, face)) ? (action.x ?? 0) : 0;
    const exiled = info.exileDiscount && action.exiled ? action.exiled : 0;
    return {
      sources: castSources(s, p, src.inst.card, src.inst.iid, face),
      cost: castCost(s, p, src.inst.card, { face, kicked, from: src.from, iid: src.inst.iid, alt, exiled, modes: action.modes }, x),
    };
  }
  if (action.type === 'activate') {
    const perm = findPermanent(s, action.iid);
    const spec = perm && activatedOf(perm.card)[action.index];
    if (!perm || !spec) return null;
    const x = spec.cost.mana.includes('{X}') ? (action.x ?? 0) : 0;
    const first = action.targets?.[0]?.[0];
    const equipped = spec.equip && first?.kind === 'permanent' ? findPermanent(s, first.iid) : undefined;
    return { sources: sourcesFor(s, perm, spec), cost: abilityCost(s, perm, spec, x, equipped) };
  }
  if (action.type === 'cycle' || action.type === 'channel') {
    const inst = s.players[p].hand.find((c) => c.iid === action.iid);
    const info = inst && castInfo(inst.card);
    const cost = action.type === 'cycle' ? info?.cycling && parseCost(info.cycling.cost) : inst && channelCost(s, p, inst.card);
    return cost ? { sources: manaSources(s, p), cost } : null;
  }
  return null;
}

/** Mana empties from pools when a step or phase ends. */
function emptyPools(d: GameState) {
  for (const ps of d.players) delete ps.pool;
}

/** Sacrifice a permanent (as a cost or an effect). */
function sacrifice(d: GameState, perm: Permanent) {
  removePermanent(d, perm, 'graveyard');
  log(d, { k: 'sacrificed', card: perm.card.name });
}

/** A permanent enters: put it on the battlefield and check "enters" triggers (its own, landfall…). */
/**
 * A card put onto the battlefield by an effect. Mox Diamond's replacement: its controller discards the first land card
 * of their hand (no choice asked in the middle of the effect), or it goes to the graveyard.
 */
function putOntoBattlefield(d: GameState, inst: CardInst, controller: PlayerId, opts: { tapped?: boolean } = {}) {
  // Containment Priest: a creature card put onto the battlefield (not cast) is exiled instead.
  if (uncastExiled(d, inst.card)) {
    putInZone(d, controller, inst, 'exile');
    log(d, { k: 'exiledInstead', card: inst.card.name });
    return;
  }
  if (discardsLandInstead(inst.card)) {
    const land = d.players[controller].hand.find((c) => isLand(c.card));
    if (!land) {
      putInZone(d, controller, inst, 'graveyard');
      return;
    }
    moveToGraveyard(d, controller, land, 'hand');
    log(d, { k: 'discard', p: controller, card: land.card.name });
  }
  enterBattlefield(d, inst, controller, opts);
}

function enterBattlefield(d: GameState, inst: CardInst, controller: PlayerId, opts: { x?: number; tapped?: boolean } = {}): Permanent {
  const perm = newPermanent(inst, controller, d.turn);
  if (entersPrepared(inst.card)) perm.prepared = true;
  // Magus of the Moon: a nonbasic land enters without its abilities ("enters tapped" ones included).
  const rule = mooned(d, inst.card) ? null : entersTappedRule(inst.card);
  const otherLands = d.battlefield.filter((x) => x.controller === controller && isLandCard(x.card));
  if (opts.tapped || rule?.kind === 'always') perm.tapped = true;
  else if (rule?.kind === 'unlessSubtypes') {
    // Land types, or The Lonely Mountain's Equipment: any other permanent its controller has.
    const others = d.battlefield.filter((x) => x.controller === controller);
    perm.tapped = !others.some((x) => rule.subtypes.some((t) => subtypesOf(x.card).includes(t) || landHasType(d, x.card, t)));
  } else if (rule?.kind === 'unlessEarlyTurn') {
    perm.tapped = !(isActivePlayer(d, controller) && (d.players[controller].turns ?? 0) <= rule.n);
  } else if (rule?.kind === 'unlessBasic') perm.tapped = !otherLands.some((x) => /\bBasic\b/.test(x.card.typeLine));
  else if (rule?.kind === 'unlessOtherLands') {
    perm.tapped = (rule.max !== undefined && otherLands.length > rule.max) || (rule.min !== undefined && otherLands.length < rule.min);
  } else if (rule?.kind === 'payLife') {
    // Asked once nothing else is going on (see settle); tapped until then.
    perm.tapped = true;
    (d.lifeChoices ??= []).push({ iid: perm.iid, n: rule.n });
  }
  // Fading N: enters with N fade counters.
  const fading = fadingOf(inst.card);
  if (fading) perm.counters = { ...perm.counters, fade: fading };
  const counters = entersCounters(inst.card);
  if (counters) {
    const n = typeof counters.n === 'number' ? counters.n : (opts.x ?? 0);
    if (n > 0) perm.counters = { [counters.counter]: n };
  }
  if (isPlaneswalker(inst.card)) perm.counters = { ...perm.counters, loyalty: startingLoyalty(inst.card) };
  d.battlefield.push(perm);
  fireObject(d, 'enters', perm);
  // A Saga enters with a lore counter (CR 714.3a).
  if (isSaga(perm.card)) addLore(d, perm);
  return perm;
}

/**
 * Leylines: "If this card is in your opening hand, you may begin the game with it on the battlefield." Always done
 * (it costs nothing), before the first turn.
 */
function openingHandPermanents(d: GameState) {
  for (const p of turnOrder(d)) {
    const ps = d.players[p];
    for (const inst of ps.hand.filter((c) => beginsOnBattlefield(c.card))) {
      ps.hand = ps.hand.filter((c) => c !== inst);
      log(d, { k: 'beginsOnBattlefield', p, card: inst.card.name });
      enterBattlefield(d, inst, p);
    }
  }
  askGemstoneCaverns(d);
}

/**
 * Gemstone Caverns: each player not on the starting team, in turn order, may exile a card from their opening hand to
 * begin with it on the battlefield with a luck counter. Then the first turn begins.
 */
function askGemstoneCaverns(d: GameState) {
  const starting = teamPlayers(d, d.active);
  for (const p of turnOrder(d)) {
    const ps = d.players[p];
    const caverns = ps.hand.find((c) => beginsWithLuck(c.card));
    if (starting.includes(p) || !caverns || ps.luckAsked) continue;
    ps.luckAsked = true;
    const others = ps.hand.filter((c) => c !== caverns);
    if (!others.length) continue;
    d.pending = {
      choice: { kind: 'cards', player: p, purpose: 'gemstoneCaverns', min: 0, max: 1, options: others, params: { card: caverns.card.name } },
      resume: 'gemstoneCaverns', iid: caverns.iid,
    };
    return;
  }
  beginTurn(d, d.active, true);
}

/**
 * A noncreature permanent becomes a creature until end of turn (Iron Man Armor, crewed Vehicles, Chandra): its own
 * card is kept to come back at the end of the turn. Already a creature, it only gains the keywords.
 */
function animate(d: GameState, perm: Permanent, e: Extract<Effect, { kind: 'animate' }>) {
  if (e.keywords.length) perm.boosts.push({ power: 0, toughness: 0, keywords: e.keywords, until: 'endOfTurn' });
  if (isCreature(perm.card)) return;
  const own = perm.card;
  const [printed, subtypes = ''] = own.typeLine.split(' // ')[0].split(' — ');
  // Mishra's Factory: "becomes a 2/2 Assembly-Worker artifact creature".
  const types = (e.artifact && !/\bArtifact\b/.test(printed) ? `Artifact ${printed}` : printed).replace(/\bArtifact\b/, 'Artifact Creature');
  const typeLine = `${types}${/\bCreature\b/.test(types) ? '' : ' Creature'} — ${[subtypes, ...e.subtypes].filter(Boolean).join(' ')}`;
  perm.unanimated ??= own;
  perm.card = {
    ...own, typeLine,
    power: String(e.power ?? own.power ?? 0), toughness: String(e.toughness ?? own.toughness ?? 0),
    ...(e.text ? { oracleText: `${own.oracleText}\n${e.text}` } : {}),
    // Manlands: "a 4/4 blue and black Shark creature".
    ...(e.colors ? { colors: e.colors } : {}),
    // Mutavault: "with all creature types".
    ...(e.allTypes ? { keywords: [...(own.keywords ?? []), 'Changeling'] } : {}),
  };
  log(d, { k: 'becomesCreature', card: own.name });
}

/** The card a permanent leaves the battlefield as: its printed card, not a face, an animation or gained abilities. */
const printedCard = (perm: Permanent) => perm.printed ?? perm.reconfigured ?? perm.unanimated ?? perm.card;

/** Cavern of Souls: creature types of `p`'s cards, the most frequent first. */
function creatureTypeOptions(d: GameState, p: PlayerId): string[] {
  const ps = d.players[p];
  const count = new Map<string, number>();
  const cards = [...ps.library, ...ps.hand, ...ps.graveyard, ...d.battlefield.filter((x) => x.controller === p)].map((c) => c.card);
  for (const c of cards) {
    if (!isCreature(c)) continue;
    for (const t of (c.typeLine.split(' // ')[0].split(' — ')[1] ?? '').split(' ').filter(Boolean)) count.set(t, (count.get(t) ?? 0) + 1);
  }
  const types = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12);
  return types.length ? types : ['Human'];
}

/**
 * Pithing Needle: the names it may choose, the opponents' first: cards seen in the game (battlefield, graveyards,
 * exile, the chooser's hand) with activated abilities other than mana abilities.
 */
function stoppableNames(d: GameState, p: PlayerId): string[] {
  const seen = [
    ...d.battlefield.filter((x) => teamOf(d, x.controller) !== teamOf(d, p)).map((x) => printedCard(x)),
    ...d.players.flatMap((ps, q) => (teamOf(d, q) !== teamOf(d, p) ? [...ps.graveyard, ...ps.exile] : [])).map((c) => c.card),
    ...d.battlefield.filter((x) => teamOf(d, x.controller) === teamOf(d, p)).map((x) => printedCard(x)),
    ...d.players[p].hand.map((c) => c.card),
    ...d.players.flatMap((ps, q) => (teamOf(d, q) === teamOf(d, p) ? [...ps.graveyard, ...ps.exile] : [])).map((c) => c.card),
  ];
  const names: string[] = [];
  for (const c of seen) {
    if (names.includes(c.name) || namesCardToStop(c)) continue;
    if (activatedOf(c).length || castInfo(c).channel) names.push(c.name);
  }
  return names.slice(0, 16);
}

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

/**
 * Multiversal Passage: "As this land enters, choose a basic land type." It becomes that type (its mana, and "if you
 * control a Mountain"), for as long as it stays.
 */
function askBasicType(d: GameState): boolean {
  const perm = d.battlefield.find((x) => choosesBasicType(x.card) && !x.chosenType);
  if (!perm) return false;
  d.pending = {
    choice: { kind: 'mode', player: perm.controller, purpose: 'basicType', min: 1, max: 1, modes: BASIC_LAND_TYPES, params: { card: perm.card.name } },
    resume: 'basicType', iid: perm.iid,
  };
  return true;
}

/** Meddling Mage: nonland card names seen in the game, the opponents' first (battlefield, graveyards, exile, stack). */
function spellNames(d: GameState, p: PlayerId): string[] {
  const theirs = (q: PlayerId) => teamOf(d, q) !== teamOf(d, p);
  const seen = [
    ...d.stack.filter((x) => !x.ability && theirs(x.controller)).map((x) => x.card),
    ...d.battlefield.filter((x) => theirs(x.controller)).map((x) => printedCard(x)),
    ...d.players.flatMap((ps, q) => (theirs(q) ? [...ps.graveyard, ...ps.exile] : [])).map((c) => c.card),
  ];
  const names: string[] = [];
  for (const c of seen) if (!names.includes(c.name) && !isLandCard(c)) names.push(c.name);
  return names.slice(0, 16);
}

/** Pithing Needle: "As this artifact enters, choose a card name." (asked once nothing else is going on). */
function askCardName(d: GameState): boolean {
  const perm = d.battlefield.find((x) => (namesCardToStop(x.card) || namesSpellToStop(x.card)) && x.chosenName === undefined);
  if (!perm) return false;
  const names = namesSpellToStop(perm.card) ? spellNames(d, perm.controller) : stoppableNames(d, perm.controller);
  if (!names.length) {
    perm.chosenName = '';
    log(d, { k: 'chosenName', card: perm.card.name, name: '' });
    return false;
  }
  d.pending = {
    choice: { kind: 'mode', player: perm.controller, purpose: namesSpellToStop(perm.card) ? 'spellName' : 'cardName', min: 1, max: 1, modes: names, params: { card: perm.card.name } },
    resume: 'cardName', iid: perm.iid,
  };
  return true;
}

/** True-Name Nemesis: "As this creature enters, choose a player." (the only opponent is chosen without asking). */
function askChosenPlayer(d: GameState): boolean {
  const perm = d.battlefield.find((x) => protectionFromChosenPlayer(x.card) && x.chosenPlayer === undefined);
  if (!perm) return false;
  const options = opponentsOf(d, perm.controller);
  if (options.length === 1) {
    perm.chosenPlayer = options[0];
    log(d, { k: 'chosenPlayer', card: perm.card.name, p: options[0] });
    return false;
  }
  d.pending = {
    choice: { kind: 'mode', player: perm.controller, purpose: 'chosenPlayer', min: 1, max: 1, modes: options.map((q) => d.players[q].name || String(q)), params: { card: perm.card.name, players: options.join(',') } },
    resume: 'chosenPlayer', iid: perm.iid,
  };
  return true;
}

/** Cavern of Souls: "As this land enters, choose a creature type." (asked once nothing else is going on). */
function askCreatureType(d: GameState): boolean {
  const perm = d.battlefield.find((x) => choosesCreatureType(x.card) && !x.chosenType);
  if (!perm) return false;
  d.pending = {
    choice: { kind: 'mode', player: perm.controller, purpose: 'creatureType', min: 1, max: 1, modes: creatureTypeOptions(d, perm.controller), params: { card: perm.card.name } },
    resume: 'creatureType', iid: perm.iid,
  };
  return true;
}

/** Untapped creatures that can crew `perm` (not itself). */
export const crewOptions = (s: GameState, perm: Permanent) =>
  s.battlefield.filter((x) => x.controller === perm.controller && x.iid !== perm.iid && !x.tapped && isCreature(x.card));

/** A lore counter on a Saga: each chapter it reaches triggers (CR 714.2b). */
function addLore(d: GameState, perm: Permanent) {
  const before = perm.counters.lore ?? 0;
  perm.counters = { ...perm.counters, lore: before + 1 };
  log(d, { k: 'counters', card: perm.card.name, counter: 'lore', n: 1 });
  for (const t of triggersOf(perm.card)) {
    if (t.event.on === 'chapter' && t.event.n === before + 1) queueTrigger(d, perm, perm.controller, t.ability);
  }
}

/**
 * A Saga with as many lore counters as its last chapter is sacrificed (CR 714.4), once none of its chapter abilities
 * is waiting to go on the stack or on it.
 */
function sagaDone(d: GameState, perm: Permanent): boolean {
  if (!isSaga(perm.card) || (perm.counters.lore ?? 0) < finalChapter(perm.card) || !finalChapter(perm.card)) return false;
  const chapterOf = (iid: string | undefined, ability: AbilitySpec | undefined) => iid === perm.iid && !!ability?.chapter;
  return !(d.triggered ?? []).some((t) => chapterOf(t.source.iid, t.ability)) &&
    !d.stack.some((x) => chapterOf(x.source, x.ability)) &&
    !(d.pending?.trigger && chapterOf(d.pending.trigger.source.iid, d.pending.trigger.ability)) &&
    !(d.resolving && chapterOf(d.resolving.item.source, d.resolving.item.ability));
}

// ---------- Triggers ----------

/** "if you gained life this turn", "if this artifact is tapped": checked when the ability triggers and again when it resolves. */
function conditionMet(d: GameState, p: PlayerId, cond: AbilitySpec['condition'], source?: string): boolean {
  if (!cond) return true;
  const ps = d.players[p];
  if (cond.tapped && !(source && findPermanent(d, source)?.tapped)) return false;
  return (ps.gainedThisTurn ?? 0) >= (cond.gained ?? 0) && (!cond.lost || (ps.lostThisTurn ?? 0) > 0);
}

function queueTrigger(d: GameState, source: CardInst, controller: PlayerId, ability: AbilitySpec, batch?: string) {
  // Magus of the Moon: a nonbasic land has no triggered ability.
  if (mooned(d, source.card) && d.battlefield.some((x) => x.iid === source.iid)) return;
  if (!ability.effects.length) {
    log(d, { k: 'notSimulated', card: source.card.name });
    return;
  }
  if (!conditionMet(d, controller, ability.condition, source.iid)) return;
  const n = triggersTwice(d, source.iid) ? 2 : 1;
  for (let i = 0; i < n; i++) (d.triggered ??= []).push({ source: { iid: source.iid, card: source.card }, controller, ability, ...(batch ? { batch } : {}) });
}

/**
 * Cloud: "As long as Cloud is equipped, if a triggered ability of Cloud or an Equipment attached to it triggers, that
 * ability triggers an additional time."
 */
function triggersTwice(d: GameState, iid: string): boolean {
  const perm = findPermanent(d, iid);
  if (!perm) return false;
  const host = doublesEquippedTriggers(perm.card) ? perm
    : perm.attachedTo && /\bEquipment\b/.test(perm.card.typeLine) ? findPermanent(d, perm.attachedTo) : undefined;
  return !!host && doublesEquippedTriggers(host.card) &&
    d.battlefield.some((x) => x.attachedTo === host.iid && /\bEquipment\b/.test(x.card.typeLine));
}

/** Does `perm` match what a trigger watches, seen from the trigger controller's side? Works for permanents that just left too. */
function fits(d: GameState, viewer: PlayerId, which: Selector, perm: Permanent): boolean {
  if (which.kind === 'creature' && !isCreature(perm.card)) return false;
  return matchesFilter(d, which.filter, viewer, perm, perm.controller);
}

/**
 * `perm` entered, died or attacked: trigger its own abilities and those of permanents watching
 * for it. A creature that died still sees its own death ("When this creature dies").
 */
function fireObject(d: GameState, on: ObjectEvent, perm: Permanent) {
  // Doorkeeper Thrull: artifacts and creatures entering trigger nothing.
  if (on === 'enters' && withRule(d, 'noEntersTriggers').length && (isCreature(perm.card) || cardTypes(perm.card).includes('artifact'))) return;
  const watchers = [...(d.battlefield.some((x) => x.iid === perm.iid) ? d.battlefield : [...d.battlefield, perm]), ...emblemSources(d)];
  for (const x of watchers) {
    triggersOf(x.card).forEach((t, i) => {
      const e: TriggerEvent = t.event;
      if (e.on !== on) return;
      const hit = e.self ? x.iid === perm.iid : !(e.another && x.iid === perm.iid) && fits(d, x.controller, e.which, perm);
      if (!hit) return;
      // "This ability triggers only once each turn."
      if (t.oncePerTurn) {
        if (x.triggeredOnce?.includes(i)) return;
        x.triggeredOnce = [...(x.triggeredOnce ?? []), i];
      }
      // "Whenever one or more creatures die": once for those dying together (still waiting to go on the stack).
      const batch = t.batch ? `${x.iid}:${i}` : undefined;
      if (batch && d.triggered?.some((w) => w.batch === batch)) return;
      queueTrigger(d, x, x.controller, t.ability, batch);
    });
  }
}

/** Emblems as trigger sources (Chandra's: "Whenever an artifact you control enters, this emblem deals 3 damage …"). */
function emblemSources(d: GameState): Permanent[] {
  return playersOf(d).flatMap((p) => (d.players[p].emblems ?? []).map((card, i): Permanent => ({
    iid: `emblem-${p}-${i}`, card, controller: p, tapped: false, sick: false, damage: 0, deathtouched: false, counters: {}, boosts: [],
  })));
}

/** The beginning of the active player's upkeep or end step. */
function fireStep(d: GameState, on: StepEvent) {
  // Mobilize tokens: "Sacrifice them at the beginning of the next end step."
  // Warp: "exile it at the beginning of the next end step"; it can be cast from exile on a later turn.
  if (on === 'endStep' && d.warpAtEnd?.length) {
    for (const iid of d.warpAtEnd) {
      const perm = findPermanent(d, iid);
      if (!perm) continue;
      removePermanent(d, perm, 'exile');
      const inst = d.players[perm.owner ?? perm.controller].exile.find((c) => c.iid === iid);
      if (inst) inst.warpedOnTurn = d.turn;
      log(d, { k: 'exiled', card: perm.card.name });
    }
    delete d.warpAtEnd;
  }
  // Impending: "At the beginning of your end step, remove a time counter from it." The last one: it is a creature.
  if (on === 'endStep') {
    for (const perm of d.battlefield.filter((x) => x.impending && isActivePlayer(d, x.controller))) {
      const left = Math.max(0, (perm.counters.time ?? 0) - 1);
      perm.counters = { ...perm.counters, time: left };
      log(d, { k: 'counterRemoved', card: perm.card.name, counter: 'time' });
      if (!left) {
        perm.card = perm.printed ?? perm.card;
        delete perm.impending;
        log(d, { k: 'becomesCreature', card: perm.card.name });
      }
    }
  }
  // Phelia: "At the beginning of the next end step, return that card to the battlefield under its owner's control."
  if (on === 'endStep' && d.returnAtEnd?.length) {
    for (const x of d.returnAtEnd) {
      const ps = d.players[x.owner];
      const inst = ps.exile.find((c) => c.iid === x.iid);
      if (!inst) continue; // a token, or the card moved on
      ps.exile = ps.exile.filter((c) => c !== inst);
      log(d, { k: 'returned', card: inst.card.name, dest: 'battlefield' });
      putOntoBattlefield(d, inst, x.owner);
      // "If it entered under your control, put a +1/+1 counter on Phelia."
      const source = x.source ? findPermanent(d, x.source) : undefined;
      if (x.counterIfYours && x.owner === x.controller && source && findPermanent(d, x.iid)) {
        source.counters = { ...source.counters, '+1/+1': (source.counters['+1/+1'] ?? 0) + 1 };
        log(d, { k: 'counters', card: source.card.name, counter: '+1/+1', n: 1 });
      }
    }
    delete d.returnAtEnd;
  }
  if (on === 'endStep' && d.sacrificeAtEnd?.length) {
    for (const iid of d.sacrificeAtEnd) {
      const token = findPermanent(d, iid);
      if (token) sacrifice(d, token);
    }
    delete d.sacrificeAtEnd;
  }
  for (const x of [...d.battlefield, ...emblemSources(d)]) {
    for (const t of triggersOf(x.card)) {
      if (t.event.on !== on) continue;
      const mine = isActivePlayer(d, x.controller);
      if (t.event.whose === 'each' || (t.event.whose === 'you') === mine) queueTrigger(d, x, x.controller, t.ability);
    }
  }
}

/** `p` cast `card`: "whenever you cast …" and prowess. */
function fireCast(d: GameState, p: PlayerId, card: Card) {
  // Rhystic Study: "Whenever an opponent casts a spell, …" (aimed at that player).
  for (const x of d.battlefield) {
    if (teamOf(d, x.controller) === teamOf(d, p)) continue;
    for (const t of triggersOf(x.card)) {
      if (t.event.on === 'opponentCasts' && cardMatches(card, t.event.filter) && (!t.event.firstNoncreature || d.players[p].noncreatureThisTurn === 1)) {
        // Its slot 0 (if any) is the player who cast it ("unless that player pays").
        (d.triggered ??= []).push({ source: { iid: x.iid, card: x.card }, controller: x.controller, ability: t.ability, targets: t.ability.targets.length ? [[{ kind: 'player', player: p }]] : [] });
      }
    }
  }
  for (const x of [...d.battlefield, ...emblemSources(d)]) {
    if (x.controller !== p) continue;
    for (const t of triggersOf(x.card)) {
      if (t.event.on === 'cast' && cardMatches(card, t.event.filter)) queueTrigger(d, x, p, t.ability);
    }
  }
}

/** A spell was cast without spending mana: Vexing Bauble's trigger, aimed at that spell. */
function fireCastWithoutMana(d: GameState, item: StackItem) {
  for (const x of d.battlefield) {
    for (const t of triggersOf(x.card)) {
      if (t.event.on === 'castWithoutMana') {
        (d.triggered ??= []).push({ source: { iid: x.iid, card: x.card }, controller: x.controller, ability: t.ability, targets: [[{ kind: 'spell', iid: item.iid }]] });
      }
    }
  }
}

/**
 * Ward: a permanent targeted by an opponent's spell or ability triggers "counter it unless its controller
 * pays {N}" (or "pays N life": Hexing Squelcher).
 */
function fireWard(d: GameState, item: StackItem) {
  const seen = new Set<string>();
  for (const t of item.targets.flat()) {
    if (t.kind !== 'permanent' || seen.has(t.iid)) continue;
    seen.add(t.iid);
    const perm = findPermanent(d, t.iid);
    if (!perm || perm.controller === item.controller) continue;
    // Its own ward, and each one granted (Lavaspur Boots, Hexing Squelcher): each triggers.
    const wards = [
      ...[wardCost(perm.card), ...(perm.statics?.ward ?? [])].filter((x) => x > 0).map((n) => ({ unlessPays: n })),
      ...[wardLife(perm.card), ...(perm.statics?.wardLife ?? [])].filter((x) => x > 0).map((n) => ({ unlessPaysLife: n })),
    ];
    for (const ward of wards) {
      (d.triggered ??= []).push({
        source: { iid: perm.iid, card: perm.card }, controller: perm.controller,
        ability: { targets: [{ kind: 'spell', min: 1, max: 1, filter: { abilities: true } }], effects: [{ kind: 'counter', to: { slot: 0 }, ...ward }] },
        targets: [[{ kind: 'spell', iid: item.iid }]],
      });
    }
  }
}

function pushAbility(d: GameState, t: Triggered, targets: Target[][]) {
  d.abilities = (d.abilities ?? 0) + 1;
  d.stack.push({
    iid: `${t.source.iid}-ability-${d.abilities}`, card: t.source.card, controller: t.controller, targets, ability: t.ability, source: t.source.iid, triggered: true,
  });
  const named = targets.flat().map((tg) => targetName(d, tg));
  log(d, { k: 'triggers', card: t.source.card.name, ...(named.length ? { targets: named } : {}) });
  fireWard(d, d.stack.at(-1)!);
  // Both players get priority again, starting with the active player.
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = d.active;
  } else {
    d.priority = { player: d.active, passes: 0, reason: 'main' };
  }
}

/**
 * Puts the next waiting trigger on the stack (the active player's first, so they resolve last).
 * Returns false when its controller must choose targets first.
 */
function flushTrigger(d: GameState): boolean {
  const queue = d.triggered!;
  const i = Math.max(0, queue.findIndex((t) => t.controller === d.active));
  const [t] = queue.splice(i, 1);
  if (!queue.length) delete d.triggered;
  const modal = t.ability.modal;
  if (modal) {
    // "choose one —": modes that aren't understood, or have no legal target, can't be chosen.
    const disabled = modal.specs.flatMap((sp, k) =>
      !sp.effects.length || sp.targets.some((slot) => legalTargets(d, t.controller, slot, t.source.iid, t.source.card).length < slot.min) ? [k] : []);
    if (modal.min > modal.specs.length - disabled.length) {
      log(d, { k: 'noTarget', card: t.source.card.name });
      return true;
    }
    d.pending = {
      choice: { kind: 'mode', player: t.controller, purpose: 'triggerMode', min: modal.min, max: modal.max, modes: modal.texts, disabled, params: { card: t.source.card.name } },
      resume: 'triggerMode',
      trigger: t,
    };
    return false;
  }
  return stackTrigger(d, t);
}

/** Puts a trigger on the stack, or asks its controller for its targets first (false then). */
function stackTrigger(d: GameState, t: Triggered): boolean {
  const slots = t.ability.targets;
  if (!slots.length) {
    pushAbility(d, t, []);
    return true;
  }
  if (t.targets) {
    pushAbility(d, t, t.targets);
    return true;
  }
  if (slots.some((slot) => legalTargets(d, t.controller, slot, t.source.iid, t.source.card).length < slot.min)) {
    log(d, { k: 'noTarget', card: t.source.card.name });
    return true;
  }
  d.pending = {
    choice: { kind: 'targets', player: t.controller, purpose: 'triggerTargets', slots, source: t.source, params: { card: t.source.card.name } },
    resume: 'trigger',
    trigger: t,
  };
  return false;
}

/** State-based actions: +1/+1 and -1/-1 counters cancel out, 0 toughness, lethal damage, 0 life. */
function checkStateBased(d: GameState) {
  refreshStatics(d);
  // Ascend: "If you control ten or more permanents, you get the city's blessing for the rest of the game."
  for (const p of playersOf(d)) {
    const mine = d.battlefield.filter((x) => x.controller === p);
    if (!d.players[p].citysBlessing && mine.length >= 10 && mine.some((x) => x.card.keywords?.includes('Ascend'))) {
      d.players[p].citysBlessing = true;
      log(d, { k: 'citysBlessing', p });
    }
  }
  for (const perm of [...d.battlefield]) {
    const plus = perm.counters['+1/+1'] ?? 0;
    const minus = perm.counters['-1/-1'] ?? 0;
    if (plus && minus) {
      const both = Math.min(plus, minus);
      perm.counters = { ...perm.counters, '+1/+1': plus - both, '-1/-1': minus - both };
    }
    const lethal = (perm.deathtouched || perm.damage >= toughnessOf(perm)) && !hasKw(perm, 'indestructible');
    if (isCreature(perm.card) && (toughnessOf(perm) <= 0 || lethal)) {
      removePermanent(d, perm, 'graveyard');
      log(d, { k: 'dies', card: perm.card.name });
    } else if (isPlaneswalker(perm.card) && !isCreature(perm.card) && (perm.counters.loyalty ?? 0) <= 0) {
      removePermanent(d, perm, 'graveyard');
      log(d, { k: 'destroyed', card: perm.card.name });
    } else if (sagaDone(d, perm)) {
      sacrifice(d, perm);
    }
  }
  // Storied: "If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the
  // rest of the game."
  for (const perm of d.battlefield) {
    if (!isStoried(perm.card) || d.players[perm.controller].enduringStory) continue;
    const story = d.battlefield.filter((x) => x.controller === perm.controller && (cardTypes(x.card).includes('artifact') || /\bLegendary\b/.test(x.card.typeLine.split('//')[0]) || isSaga(x.card)));
    if (story.length >= 3) d.players[perm.controller].enduringStory = true;
  }
  // Auras on something they can't enchant any more go to the graveyard; Equipment just falls off.
  for (const perm of [...d.battlefield]) {
    if (!perm.attachedTo && !auraTarget(perm.card)) continue;
    const host = perm.attachedTo ? findPermanent(d, perm.attachedTo) : undefined;
    const aura = auraTarget(perm.card);
    if (aura) {
      if (!host || !fitsSpec(d, perm.controller, aura, { kind: 'permanent', iid: host.iid }) || protectedFrom(host, perm.card)) {
        removePermanent(d, perm, 'graveyard');
        log(d, { k: 'destroyed', card: perm.card.name });
      }
    } else if (!host || !isCreature(host.card) || isCreature(perm.card) || host.controller !== perm.controller || protectedFrom(host, perm.card)) {
      delete perm.attachedTo;
    }
  }
  refreshStatics(d);
  if (d.winner !== null) return;
  // A team loses at 0 life or too much poison (one player of the team is enough: their totals are shared).
  // 21 combat damage from one commander makes that player (and so the team) lose.
  const commanderKill = (p: PlayerId) => Object.entries(d.players[p].commanderDamage ?? {}).find(([, n]) => n >= 21);
  for (const p of playersOf(d)) {
    const kill = commanderKill(p);
    if (kill && d.winner === null) log(d, { k: 'commanderDamage', p, card: findPermanent(d, kill[0])?.card.name ?? d.players.flatMap((x) => [...x.command ?? [], ...x.graveyard]).find((c) => c.iid === kill[0])?.card.name ?? '?' });
  }
  const lost = teamsOf(d).filter((team) => team.some((p) => d.players[p].life <= 0 || (d.players[p].poison ?? 0) >= poisonLimit(d) || !!commanderKill(p)));
  if (lost.length >= 2) d.winner = 'draw';
  else if (lost.length === 1) d.winner = firstOpponent(d, lost[0][0]);
  if (d.winner !== null) log(d, d.winner === 'draw' ? { k: 'draw' } : { k: 'wins', p: d.winner });
}

/** Recomputes what static abilities give each creature (anthems, Auras, Equipment). */
/**
 * Swift Reconfiguration: the enchanted permanent is a noncreature Vehicle artifact with crew 5 (crewed, a creature
 * with its own power and toughness); it is itself again once the Aura is gone.
 */
function refreshReconfigured(d: GameState) {
  for (const perm of d.battlefield) {
    const aura = d.battlefield.find((x) => x.attachedTo === perm.iid && reconfiguresEnchanted(x.card) !== null);
    if (aura && !perm.reconfigured) {
      const own = perm.unanimated ?? perm.card;
      const legendary = /\bLegendary\b/.test(own.typeLine.split(' // ')[0]);
      perm.reconfigured = own;
      delete perm.unanimated;
      perm.card = { ...own, typeLine: `${legendary ? 'Legendary ' : ''}Artifact — Vehicle`, oracleText: `${own.oracleText}\nCrew ${reconfiguresEnchanted(aura.card)}` };
      log(d, { k: 'becomesVehicle', card: own.name });
    } else if (!aura && perm.reconfigured) {
      perm.card = perm.reconfigured;
      delete perm.reconfigured;
      delete perm.unanimated;
    }
  }
}

function refreshStatics(d: GameState) {
  refreshReconfigured(d);
  for (const perm of d.battlefield) delete perm.statics;
  for (const src of d.battlefield) {
    for (const st of staticsOf(src.card)) {
      const hosts = st.who === 'self' ? [src]
        : typeof st.who === 'string'
          ? (src.attachedTo ? [findPermanent(d, src.attachedTo)].filter((x) => x !== undefined) : [])
          : matching(d, src.controller, st.who.which).filter((x) => !(typeof st.who !== 'string' && st.who.other && x.iid === src.iid));
      // Dáin's Company: "as long as you control another Dwarf".
      // Delirium: four or more card types among cards in its controller's graveyard.
      if (st.delirium && !delirium(d, src.controller)) continue;
      if (st.ifAnother && !d.battlefield.some((x) => x.iid !== src.iid && x.controller === src.controller && isCreature(x.card) && hasSubtype(x.card, st.ifAnother!))) continue;
      // "for each artifact you control", Kellan's "for each Aura and Equipment attached to Kellan", Chainsaw's rev counters.
      const times = st.perEach ? matching(d, src.controller, st.perEach).filter((x) => x.controller === src.controller).length
        : st.perAttached ? d.battlefield.filter((x) => x.attachedTo === src.iid && /\b(?:Aura|Equipment)\b/.test(x.card.typeLine.split('//')[0])).length
        : st.perCounter ? (src.counters[st.perCounter] ?? 0)
        : 1;
      for (const h of hosts) {
        if (!isCreature(h.card)) continue;
        const b = (h.statics ??= { power: 0, toughness: 0, keywords: [] });
        b.power += st.power * times;
        b.toughness += st.toughness * times;
        if (st.ward) b.ward = [...(b.ward ?? []), st.ward];
        if (st.wardLife) b.wardLife = [...(b.wardLife ?? []), st.wardLife];
        if (st.hexproofFromMonocolored) b.hexproofFromMonocolored = true;
        if (st.doubleDamage) b.doubleDamage = true;
        for (const k of st.keywords) if (!b.keywords.includes(k)) b.keywords.push(k);
        if (st.cantAttack) b.cantAttack = true;
        if (st.cantBlock) b.cantBlock = true;
        if (st.mustAttack) b.mustAttack = true;
      }
    }
  }
}

function dealDamage(d: GameState, source: CardInst, controller: PlayerId, target: Permanent | PlayerId, amount: number, combat = false) {
  if (amount <= 0) return;
  // Mjölnir: "Double all damage equipped creature would deal." (the creature, or its own ability.)
  const dealer = findPermanent(d, source.iid) ?? ((source as StackItem).source ? findPermanent(d, (source as StackItem).source!) : undefined);
  if (dealer?.statics?.doubleDamage) amount *= 2;
  if (typeof target !== 'number' && (protectedFrom(target, source.card) || protectedFromPlayer(target, controller))) return; // protection prevents it
  // Black Panther: "Prevent all damage that would be dealt to Black Panther."
  if (typeof target !== 'number' && preventsDamageToSelf(target.card)) return;
  // "Prevent the next N damage" shields.
  const key = typeof target === 'number' ? `player:${target}` : target.iid;
  for (const sh of d.shields ?? []) {
    if (sh.target !== key || !sh.n || !amount) continue;
    const stop = Math.min(sh.n, amount);
    sh.n -= stop;
    amount -= stop;
    log(d, { k: 'prevented', card: source.card.name });
  }
  if (amount <= 0) return;
  const infect = hasKw(source, 'infect');
  if (typeof target === 'number' && infect) {
    // Infect: damage to players as poison counters, to creatures as -1/-1 counters.
    addPoison(d, target, amount);
    log(d, { k: 'damagePlayer', card: source.card.name, n: amount, p: target });
  } else if (typeof target === 'number') {
    changeLife(d, target, -amount);
    log(d, { k: 'damagePlayer', card: source.card.name, n: amount, p: target });
    // Commander damage: combat damage from a commander, counted per commander and per player.
    if (combat && source.commander) {
      const taken = (d.players[target].commanderDamage ??= {});
      taken[source.iid] = (taken[source.iid] ?? 0) + amount;
    }
  } else if (infect && isCreature(target.card)) {
    target.counters = { ...target.counters, '-1/-1': (target.counters['-1/-1'] ?? 0) + amount };
    log(d, { k: 'damage', card: source.card.name, n: amount, target: target.card.name });
  } else if (isPlaneswalker(target.card) && !isCreature(target.card)) {
    // Damage to a planeswalker removes that many loyalty counters.
    target.counters = { ...target.counters, loyalty: (target.counters.loyalty ?? 0) - amount };
    log(d, { k: 'damage', card: source.card.name, n: amount, target: target.card.name });
  } else {
    target.damage += amount;
    if (hasKw(source, 'deathtouch')) target.deathtouched = true;
    log(d, { k: 'damage', card: source.card.name, n: amount, target: target.card.name });
  }
  if (hasKw(source, 'lifelink')) changeLife(d, controller, amount);
}

function addPoison(d: GameState, p: PlayerId, n: number) {
  // Teammates share poison counters.
  for (const q of teamPlayers(d, p)) d.players[q].poison = (d.players[q].poison ?? 0) + n;
  log(d, { k: 'poison', p, n });
}

/** Life changes; teammates share their life total. */
function changeLife(d: GameState, p: PlayerId, delta: number) {
  for (const q of teamPlayers(d, p)) d.players[q].life += delta;
  const ps = d.players[p];
  if (delta > 0) ps.gainedThisTurn = (ps.gainedThisTurn ?? 0) + delta;
  if (delta < 0) ps.lostThisTurn = (ps.lostThisTurn ?? 0) - delta;
  // "Whenever you gain life" (each life gain is one event).
  if (delta > 0) {
    for (const x of d.battlefield) {
      if (x.controller !== p) continue;
      for (const t of triggersOf(x.card)) if (t.event.on === 'gainLife') queueTrigger(d, x, p, t.ability);
    }
  }
}

/** p's team loses (for drawing from an empty library, conceding…): the other team wins. */
function teamLoses(d: GameState, p: PlayerId) {
  if (d.winner !== null) {
    if (d.winner !== 'draw' && teamOf(d, d.winner) === teamOf(d, p)) d.winner = 'draw';
    return;
  }
  d.winner = firstOpponent(d, p);
}

function resolveCombat(d: GameState) {
  refreshStatics(d);
  if (d.preventCombat) return; // Fog
  // Combat damage to "the player" goes to the defending team (one shared life total).
  const def = firstOpponent(d, d.active);
  const get = (iid: string) => findPermanent(d, iid);
  const involved = [...d.attackers, ...blockerIds(d)].map(get).filter((x) => x !== undefined);
  const strikeSteps = involved.some(firstStrikes) ? [true, false] : [false];

  for (const firstStrikeStep of strikeSteps) {
    const dealsNow = (x: Permanent) =>
      firstStrikeStep ? firstStrikes(x) : !hasKw(x, 'first strike') || hasKw(x, 'double strike');

    // Collect all damage first: combat damage is dealt simultaneously.
    const hits: { source: Permanent; target: Permanent | PlayerId; amount: number }[] = [];

    for (const aid of d.attackers) {
      const a = get(aid);
      if (!a || !dealsNow(a)) continue;
      // What it attacks: the player, or a planeswalker (no damage if that planeswalker is gone).
      const pwIid = d.attackTargets?.[aid];
      const attacked: Permanent | PlayerId | undefined = pwIid ? get(pwIid) : def;
      let remaining = powerOf(a);
      const declared = d.blocks[aid] ?? [];
      if (declared.length === 0) {
        if (attacked !== undefined) hits.push({ source: a, target: attacked, amount: remaining });
        continue;
      }
      const blockers = declared.map(get).filter((x) => x !== undefined);
      const trample = hasKw(a, 'trample');
      blockers.forEach((b, i) => {
        const lethal = hasKw(a, 'deathtouch') ? 1 : Math.max(0, toughnessOf(b) - b.damage);
        const isLast = i === blockers.length - 1;
        const amount = isLast && !trample ? remaining : Math.min(remaining, lethal);
        hits.push({ source: a, target: b, amount });
        remaining -= amount;
      });
      // A blocked creature only hits the player if it tramples (even if its blockers are gone).
      if (trample && remaining > 0 && attacked !== undefined) hits.push({ source: a, target: attacked, amount: remaining });
    }

    for (const [aid, bids] of Object.entries(d.blocks)) {
      const a = get(aid);
      if (!a) continue;
      for (const bid of bids) {
        const b = get(bid);
        if (b && dealsNow(b)) hits.push({ source: b, target: a, amount: powerOf(b) });
      }
    }

    for (const h of hits) {
      dealDamage(d, h.source, h.source.controller, h.target, h.amount, true);
      if (typeof h.target === 'number' && h.amount > 0) {
        // Toxic: combat damage to a player also gives poison counters.
        const toxic = toxicOf(h.source.card);
        if (toxic) addPoison(d, h.target, toxic);
        fireObject(d, 'combatDamage', h.source);
      }
    }
    checkStateBased(d);
    if (d.winner !== null) return;
  }
}

// ---------- Resolving spells and abilities ----------

const specOf = (item: StackItem): AbilitySpec =>
  item.ability ?? castSpec(item.card, { face: item.face, modes: item.modes, kicked: item.kicked, alt: item.alt, x: item.x });

/** The card a spell on the stack is (its cast face). */
const castCard = (item: StackItem) => faceCard(item.card, item.face ?? 0);

/**
 * Where a spell goes once it has resolved, fizzled or been countered: exile when cast with flashback,
 * exile "on an adventure" after its adventure resolved, else its owner's graveyard.
 */
function putAwaySpell(d: GameState, item: StackItem, resolved: boolean) {
  if (item.copy) return; // a copy ceases to exist
  const ps = d.players[item.controller];
  const inst: CardInst = { iid: item.iid, card: item.card, ...(item.commander ? { commander: true } : {}) };
  if (item.from === 'graveyard' && !item.castNow) putInZone(d, item.controller, inst, 'exile');
  else if (resolved && item.face && isAdventure(item.card)) ps.exile.push({ ...inst, adventure: true });
  else putInZone(d, item.controller, inst, 'graveyard');
}

/** What an effect applies to, looked up again now: earlier effects may have changed the game. */
/** A card in a graveyard that an effect applies to. */
interface GraveCard {
  grave: CardInst;
  owner: PlayerId;
}
type Affectable = Permanent | PlayerId | StackItem | GraveCard;

function affected(d: GameState, r: Resolving, to: Affected): Affectable[] {
  if (to === 'you') return [r.item.controller];
  if (to === 'self') {
    const src = r.item.source ? findPermanent(d, r.item.source) : undefined;
    return src ? [src] : [];
  }
  if (to === 'each-opponent') return opponentsOf(d, r.item.controller);
  // "defending player": combat is against the first opponent (their team in team games).
  if (to === 'defending') return [firstOpponent(d, r.item.controller)];
  // Each player, starting with the active player.
  if (to === 'each-player') return turnOrder(d);
  return (r.legal[to.slot] ?? []).flatMap((t): Affectable[] => {
    if (t.kind === 'player') return [t.player];
    if (t.kind === 'card') {
      const found = findInGraveyard(d, t.iid);
      return found ? [{ grave: found.inst, owner: found.owner }] : [];
    }
    const x = t.kind === 'spell' ? d.stack.find((i) => i.iid === t.iid) : findPermanent(d, t.iid);
    return x ? [x] : [];
  });
}

const amount = (d: GameState, r: Resolving, a: Amount) =>
  a === 'X' ? (r.item.x ?? 0) : a === 'lifeGained' ? (d.players[r.item.controller].gainedThisTurn ?? 0) : a;

function moveToGraveyard(d: GameState, p: PlayerId, inst: CardInst, from: 'hand' | 'library') {
  const ps = d.players[p];
  ps[from] = ps[from].filter((c) => c.iid !== inst.iid);
  putInZone(d, p, inst, 'graveyard');
}

/** Runs one effect. Returns a choice to pause on; it is run again with the answer. */
function runEffect(d: GameState, r: Resolving, e: Effect, answer?: Answer): Choice | undefined {
  const { item } = r;
  const caster = item.controller;
  const things = 'to' in e ? affected(d, r, e.to) : [];
  const players = things.filter((x): x is PlayerId => typeof x === 'number');
  const perms = things.filter((x): x is Permanent => typeof x !== 'number' && isPermanent(x));
  const spells = things.filter((x): x is StackItem => typeof x !== 'number' && 'targets' in x);
  const graveCards = things.filter((x): x is GraveCard => typeof x !== 'number' && 'grave' in x);
  /** Takes a card out of its graveyard. */
  const unbury = (g: GraveCard) => {
    d.players[g.owner].graveyard = d.players[g.owner].graveyard.filter((c) => c.iid !== g.grave.iid);
  };

  switch (e.kind) {
    case 'damage':
      for (const t of [...players, ...perms]) dealDamage(d, item, caster, t, amount(d, r, e.amount));
      break;
    case 'counter':
      for (const target of spells) {
        if (!target.ability && /\bThis spell can't be countered\./.test(castCard(target).oracleText)) continue;
        if (target.uncounterable) continue;
        // Hexing Squelcher: "Spells you control can't be countered."
        if (!target.ability && d.battlefield.some((x) => x.controller === target.controller && protectsSpells(x.card))) continue;
        if (e.unlessPaysLife) {
          // Ward—Pay N life: a player can pay life only if their life total is at least N.
          const payer = target.controller;
          const can = d.players[payer].life >= e.unlessPaysLife;
          if (can && !answer) {
            return { kind: 'yesNo', player: payer, purpose: 'payLifeOrCounter', params: { card: target.card.name, n: e.unlessPaysLife } };
          }
          if (can && answer?.kind === 'yesNo' && answer.yes) {
            changeLife(d, payer, -e.unlessPaysLife);
            log(d, { k: 'paidLife', p: payer, n: e.unlessPaysLife, card: target.card.name });
            continue;
          }
        }
        if (e.unlessPays) {
          const payer = target.controller;
          const cost = { generic: e.unlessPays, colored: [] };
          const payment = findPayment(manaSources(d, payer), cost);
          if (payment && !answer) {
            return { kind: 'yesNo', player: payer, purpose: 'payOrCounter', params: { card: target.card.name, n: e.unlessPays } };
          }
          if (payment && answer?.kind === 'yesNo' && answer.yes) {
            pay(d, payer, manaSources(d, payer), cost);
            log(d, { k: 'paid', p: payer, n: e.unlessPays, card: target.card.name });
            continue;
          }
        }
        d.stack = d.stack.filter((x) => x !== target);
        // A countered ability just leaves the stack; a spell goes to the graveyard (Memory Lapse: on top of its
        // owner's library; Remand: into their hand; Force of Negation: exiled).
        if (!target.ability && e.dest && !target.copy) {
          const inst: CardInst = { iid: target.iid, card: target.card, ...(target.commander ? { commander: true } : {}) };
          const ps = d.players[target.controller];
          if (e.dest === 'top') ps.library.unshift(inst);
          else putInZone(d, target.controller, inst, e.dest === 'hand' ? 'hand' : 'exile');
        } else if (!target.ability) putAwaySpell(d, target, false);
        log(d, { k: 'countered', card: target.card.name });
        // Tishana's Tidebinder: an ability of an artifact, creature or planeswalker: that permanent loses all abilities.
        const from = target.ability && target.source ? findPermanent(d, target.source) : undefined;
        if (e.stripsSource && from && item.source && cardTypes(from.card).some((t) => t === 'artifact' || t === 'creature' || t === 'planeswalker')) {
          (d.abilityLoss ??= []).push({ iid: from.iid, by: item.source, card: from.card });
          from.printed ??= from.card;
          from.card = { ...from.card, oracleText: '', keywords: [] };
          log(d, { k: 'losesAbilities', card: from.card.name });
        }
      }
      break;
    case 'setBasePT':
      for (const perm of perms) {
        perm.boosts.push({ power: 0, toughness: 0, keywords: [], until: 'endOfTurn', setBase: { power: e.power, toughness: e.toughness } });
        log(d, { k: 'basePT', card: perm.card.name, power: e.power, toughness: e.toughness });
      }
      break;
    case 'loseAbilitiesDestroy': {
      const max = amount(d, r, e.maxManaValue);
      const those = d.battlefield.filter((x) => isCreature(x.card) && printedCard(x).cmc <= max);
      for (const perm of those) {
        // Until end of turn: its abilities come back then (if it is still there: indestructible ones only lose it).
        (d.abilityLoss ??= []).push({ iid: perm.iid, by: 'endOfTurn', card: perm.card });
        perm.printed ??= perm.card;
        perm.card = { ...perm.card, oracleText: '', keywords: [] };
        log(d, { k: 'losesAbilities', card: perm.card.name });
      }
      refreshStatics(d);
      for (const perm of those) {
        if (!findPermanent(d, perm.iid) || hasKw(perm, 'indestructible')) continue;
        removePermanent(d, perm, 'graveyard');
        (r.removed ??= {})[perm.iid] = perm.controller;
        log(d, { k: 'destroyed', card: perm.card.name });
      }
      break;
    }
    case 'pump':
      for (const perm of perms) {
        perm.boosts.push({ power: e.power, toughness: e.toughness, keywords: e.keywords, until: 'endOfTurn' });
        log(d, { k: 'pump', card: perm.card.name, power: e.power, toughness: e.toughness, keywords: e.keywords });
      }
      break;
    case 'gainProtection':
    case 'gainProtectionAll': {
      if (answer?.kind !== 'mode') return { kind: 'mode', player: caster, purpose: 'color', min: 1, max: 1, modes: [...COLORS], params: { card: item.card.name } };
      const color = COLORS[answer.modes[0]];
      for (const perm of e.kind === 'gainProtectionAll' ? matching(d, caster, e.which) : perms) {
        perm.boosts.push({ power: 0, toughness: 0, keywords: [], until: 'endOfTurn', protection: [color] });
        log(d, { k: 'gainsProtection', card: perm.card.name, color });
      }
      break;
    }
    case 'pumpAll':
      for (const perm of matching(d, caster, e.which)) {
        perm.boosts.push({ power: e.power, toughness: e.toughness, keywords: e.keywords, until: 'endOfTurn' });
        log(d, { k: 'pump', card: perm.card.name, power: e.power, toughness: e.toughness, keywords: e.keywords });
      }
      break;
    case 'destroy':
      // "until this enchantment leaves the battlefield": nothing is exiled if it already left.
      if (e.untilLeaves && !(item.source && findPermanent(d, item.source))) break;
      for (const perm of perms) {
        if (!e.exile && hasKw(perm, 'indestructible')) continue;
        removePermanent(d, perm, e.exile ? 'exile' : 'graveyard');
        (r.removed ??= {})[perm.iid] = perm.controller;
        (r.removedPower ??= {})[perm.iid] = powerOf(perm);
        log(d, { k: e.exile ? 'exiled' : 'destroyed', card: perm.card.name });
        if (e.untilLeaves) (d.exiledUntil ??= []).push({ source: item.source!, iid: perm.iid, owner: perm.owner ?? perm.controller });
        // Skyclave Apparition: remembers the card it exiled (a token is no card: nothing to remember).
        const exiler = item.source ? findPermanent(d, item.source) : undefined;
        if (e.exile && exiler && illusionWhenLeaving(exiler.card) && !isToken(printedCard(perm))) exiler.exiledCard = { cmc: printedCard(perm).cmc, owner: perm.owner ?? perm.controller };
      }
      for (const g of graveCards) {
        unbury(g);
        d.players[g.owner].exile.push(g.grave);
        log(d, { k: 'exiledCard', card: g.grave.card.name });
        if (item.source) ((d.exiledWith ??= {})[item.source] ??= []).push({ iid: g.grave.iid, owner: g.owner });
      }
      break;
    case 'returnCard':
      for (const g of graveCards) {
        // Grafdigger's Cage: a creature card stays in the graveyard.
        if (e.dest === 'battlefield' && caged(d, g.grave.card)) {
          log(d, { k: 'cantEnter', card: g.grave.card.name });
          continue;
        }
        unbury(g);
        log(d, { k: 'returned', card: g.grave.card.name, dest: e.dest });
        if (e.dest === 'hand') d.players[g.owner].hand.push(g.grave);
        else putOntoBattlefield(d, g.grave, caster);
        const back = e.finality ? findPermanent(d, g.grave.iid) : undefined;
        if (back) back.counters = { ...back.counters, finality: 1 };
        // Pre-War Formalwear: "and attach this Equipment to it".
        const src = e.attachSource && item.source ? findPermanent(d, item.source) : undefined;
        const host = findPermanent(d, g.grave.iid);
        if (src && host && host.controller === src.controller) {
          src.attachedTo = host.iid;
          log(d, { k: 'attached', card: src.card.name, to: host.card.name });
        }
      }
      break;
    case 'flickerAtEnd':
      for (const perm of perms) {
        const owner = perm.owner ?? perm.controller;
        removePermanent(d, perm, 'exile');
        log(d, { k: 'exiled', card: perm.card.name });
        (d.returnAtEnd ??= []).push({ iid: perm.iid, owner, ...(item.source ? { source: item.source } : {}), controller: caster, counterIfYours: e.counterIfYours });
      }
      break;
    case 'grantFlashback':
      for (const g of graveCards) {
        g.grave.flashbackOnTurn = d.turn;
        log(d, { k: 'gainsFlashback', card: g.grave.card.name });
      }
      break;
    case 'addCountersAll': {
      const n = amount(d, r, e.n);
      for (const perm of matching(d, caster, e.which)) {
        if (e.other && perm.iid === item.source) continue;
        perm.counters = { ...perm.counters, [e.counter]: (perm.counters[e.counter] ?? 0) + n };
        log(d, { k: 'counters', card: perm.card.name, counter: e.counter, n });
      }
      break;
    }
    case 'search': {
      // Path to Exile, Boseiju: the controller of the permanent targeted (and removed) searches; nothing if it was an
      // illegal target.
      let searcher = caster;
      if (e.searcher) {
        const t = r.legal[e.searcher.slot]?.[0];
        const iid = t && t.kind === 'permanent' ? t.iid : undefined;
        const who = iid === undefined ? undefined : (r.removed?.[iid] ?? findPermanent(d, iid)?.controller);
        if (who === undefined) break;
        searcher = who;
      }
      const ps = d.players[searcher];
      const found = ps.library.filter((c) => cardMatches(c.card, e.filter));
      if (found.length && (!answer || answer.kind !== 'cards')) {
        return { kind: 'cards', player: searcher, purpose: 'search', min: 0, max: Math.min(e.n, found.length), options: found, params: { n: e.n } };
      }
      const picked = answer?.kind === 'cards' ? answer.iids.map((iid) => found.find((c) => c.iid === iid)!) : [];
      // Grafdigger's Cage: a creature card found to be put onto the battlefield stays in the library.
      const stuck = e.dest === 'hand' ? [] : picked.filter((c) => caged(d, c.card));
      for (const c of stuck) log(d, { k: 'cantEnter', card: c.card.name });
      const chosen = picked.filter((c) => !stuck.includes(c));
      ps.library = ps.library.filter((c) => !chosen.includes(c));
      log(d, { k: 'search', p: searcher, n: chosen.length, dest: e.dest });
      for (const inst of chosen) {
        if (e.dest === 'top') continue;
        if (e.dest === 'hand') ps.hand.push(inst);
        else putOntoBattlefield(d, inst, searcher, { tapped: e.tapped });
      }
      ps.library = shuffle(ps.library, () => random(d));
      // Enlightened Tutor: "then shuffle and put that card on top".
      if (e.dest === 'top') ps.library.unshift(...chosen);
      break;
    }
    case 'destroyAll':
      for (const perm of matching(d, caster, e.which)) {
        if (!e.exile && hasKw(perm, 'indestructible')) continue;
        removePermanent(d, perm, e.exile ? 'exile' : 'graveyard');
        log(d, { k: e.exile ? 'exiled' : 'destroyed', card: perm.card.name });
      }
      break;
    case 'damageAll': {
      const n = amount(d, r, e.amount);
      for (const perm of matching(d, caster, e.which)) if (isCreature(perm.card)) dealDamage(d, item, caster, perm, n);
      if (e.players) for (const p of affected(d, r, e.players) as PlayerId[]) dealDamage(d, item, caster, p, n);
      break;
    }
    case 'addCounters':
      for (const perm of perms) {
        const n = amount(d, r, e.n);
        perm.counters = { ...perm.counters, [e.counter]: (perm.counters[e.counter] ?? 0) + n };
        log(d, { k: 'counters', card: perm.card.name, counter: e.counter, n });
      }
      break;
    case 'draw':
      for (const p of players) draw(d, p, amount(d, r, e.n));
      break;
    case 'gainLife':
      for (const p of players) {
        changeLife(d, p, amount(d, r, e.n));
        log(d, { k: 'gainLife', p, n: amount(d, r, e.n) });
      }
      break;
    case 'loseLife':
      for (const p of players) {
        changeLife(d, p, -amount(d, r, e.n));
        log(d, { k: 'loseLife', p, n: amount(d, r, e.n) });
      }
      break;
    case 'mill':
      for (const p of players) {
        const milled = d.players[p].library.slice(0, amount(d, r, e.n));
        for (const inst of milled) moveToGraveyard(d, p, inst, 'library');
        log(d, { k: 'mill', p, n: milled.length });
      }
      break;
    case 'discard':
      // Players are asked one after the other; `r.sub` remembers who is next.
      for (let i = r.sub ?? 0; i < players.length; i++) {
        const p = players[i];
        const hand = d.players[p].hand;
        if (e.mode === 'random') {
          for (let k = 0; k < amount(d, r, e.n) && hand.length; k++) {
            const inst = d.players[p].hand[Math.floor(random(d) * d.players[p].hand.length)];
            moveToGraveyard(d, p, inst, 'hand');
            log(d, { k: 'discard', p, card: inst.card.name });
          }
          continue;
        }
        const options = e.mode === 'casterChooses' && e.filter ? hand.filter((c) => cardMatches(c.card, e.filter!)) : hand;
        const n = Math.min(amount(d, r, e.n), options.length);
        if (!n) continue;
        if (!answer || answer.kind !== 'cards') {
          r.sub = i;
          const chooser = e.mode === 'casterChooses' ? caster : p;
          const purpose = e.mode === 'casterChooses' ? 'discardChosen' : 'discard';
          return { kind: 'cards', player: chooser, purpose, min: n, max: n, options: [...options], params: { n, p } };
        }
        for (const iid of answer.iids) {
          const inst = hand.find((c) => c.iid === iid)!;
          moveToGraveyard(d, p, inst, 'hand');
          log(d, { k: 'discard', p, card: inst.card.name });
          (r.discarded ??= []).push(inst.iid);
        }
        answer = undefined;
      }
      r.sub = 0;
      break;
    case 'scry':
    case 'surveil': {
      const top = d.players[caster].library.slice(0, amount(d, r, e.n));
      if (!top.length) break;
      if (!answer || answer.kind !== 'arrange') {
        const zones: ArrangeZone[] = e.kind === 'scry' ? ['top', 'bottom'] : ['top', 'graveyard'];
        const params: ErrorParams = { n: top.length };
        if (e.kind === 'surveil' && e.toHand) params.toHandMax = d.players[caster].gainedThisTurn ?? 0;
        return { kind: 'arrange', player: caster, purpose: e.kind, cards: top, zones, params };
      }
      const ps = d.players[caster];
      const byIid = (iid: string) => top.find((c) => c.iid === iid)!;
      const rest = ps.library.slice(top.length);
      const onTop = (answer.zones.top ?? []).map(byIid);
      const away = (answer.zones[e.kind === 'scry' ? 'bottom' : 'graveyard'] ?? []).map(byIid);
      if (e.kind === 'scry') {
        ps.library = [...onTop, ...rest, ...away];
        log(d, { k: 'scry', p: caster, n: top.length, bottom: away.length });
      } else {
        ps.library = [...onTop, ...rest];
        for (const c of away) putInZone(d, caster, c, 'graveyard');
        log(d, { k: 'surveil', p: caster, n: top.length, graveyard: away.length });
        // Enlightened Confidant: a card put into the graveyard this way with mana value ≤ life gained goes to the hand.
        if (e.toHand) {
          for (const c of away) {
            if (c.card.cmc > (ps.gainedThisTurn ?? 0) || !ps.graveyard.includes(c)) continue;
            ps.graveyard = ps.graveyard.filter((x) => x !== c);
            ps.hand.push(c);
            log(d, { k: 'returned', card: c.card.name, dest: 'hand' });
          }
        }
      }
      break;
    }
    case 'tap':
      for (const perm of perms) {
        if (e.untap && perm.tapped && perm.counters.stun) perm.counters = { ...perm.counters, stun: perm.counters.stun - 1 };
        else if (e.untap) perm.tapped = false;
        else tapPermanent(d, perm);
        log(d, { k: 'tapped', card: perm.card.name, untap: e.untap });
      }
      break;
    case 'controllerGainsPower': {
      // Swords to Plowshares: the creature's controller, its power as it left (nothing if it wasn't removed).
      const t = r.legal[e.of.slot]?.[0];
      const iid = t && t.kind === 'permanent' ? t.iid : undefined;
      const who = iid === undefined ? undefined : r.removed?.[iid];
      const n = iid === undefined ? 0 : (r.removedPower?.[iid] ?? 0);
      if (who === undefined || n <= 0) break;
      changeLife(d, who, n);
      log(d, { k: 'gainLife', p: who, n });
      break;
    }
    case 'reorderTop': {
      // Ponder: the top cards back in the order chosen (first on top).
      const ps = d.players[caster];
      const top = ps.library.slice(0, e.n);
      if (top.length < 2) break;
      if (answer?.kind !== 'arrange') return { kind: 'arrange', player: caster, purpose: 'reorder', cards: top, zones: ['top'], params: { n: top.length } };
      const order = (answer.zones.top ?? []).map((iid) => top.find((c) => c.iid === iid)!).filter(Boolean);
      ps.library = [...order, ...top.filter((c) => !order.includes(c)), ...ps.library.slice(top.length)];
      log(d, { k: 'reordered', p: caster, n: top.length });
      break;
    }
    case 'mayShuffle':
      if (answer?.kind !== 'yesNo') return { kind: 'yesNo', player: caster, purpose: 'mayShuffle', params: { card: item.card.name } };
      if (answer.yes) {
        d.players[caster].library = shuffle(d.players[caster].library, () => random(d));
        log(d, { k: 'shuffled', p: caster });
      }
      break;
    case 'putBack': {
      // Brainstorm: cards from the hand on top of the library, the first chosen on top.
      const ps = d.players[caster];
      const n = Math.min(e.n, ps.hand.length);
      if (!n) break;
      if (answer?.kind !== 'cards') return { kind: 'cards', player: caster, purpose: 'putBack', min: n, max: n, options: [...ps.hand], params: { n } };
      const back = answer.iids.map((iid) => ps.hand.find((c) => c.iid === iid)!).filter(Boolean);
      ps.hand = ps.hand.filter((c) => !back.includes(c));
      ps.library = [...back, ...ps.library];
      log(d, { k: 'putBack', p: caster, n: back.length });
      break;
    }
    case 'putFromHand': {
      // Stoneforge Mystic: an Equipment card from the hand onto the battlefield, or none.
      const ps = d.players[caster];
      const options = ps.hand.filter((c) => cardMatches(c.card, e.filter));
      if (!options.length) break;
      if (answer?.kind !== 'cards') return { kind: 'cards', player: caster, purpose: 'putFromHand', min: 0, max: 1, options, params: { card: item.card.name } };
      const picked = answer.iids[0];
      const inst = options.find((c) => c.iid === picked);
      if (!inst) break;
      ps.hand = ps.hand.filter((c) => c !== inst);
      log(d, { k: 'enters', card: inst.card.name });
      putOntoBattlefield(d, inst, caster);
      break;
    }
    case 'lookAtHand':
      for (const q of players) log(d, { k: 'looksAtHand', p: caster, of: q, cards: d.players[q].hand.map((c) => c.card.name) });
      break;
    case 'tapAll':
      for (const perm of matching(d, caster, e.which)) {
        tapPermanent(d, perm);
        log(d, { k: 'tapped', card: perm.card.name, untap: false });
      }
      break;
    case 'tuckSpell':
      // Subtlety: the spell's owner puts it on the top or the bottom of their library (it isn't countered).
      for (const target of spells) {
        if (target.ability || !d.stack.includes(target)) continue;
        if (answer?.kind !== 'yesNo') return { kind: 'yesNo', player: target.controller, purpose: 'tuckTop', params: { card: target.card.name } };
        d.stack = d.stack.filter((x) => x !== target);
        if (!target.copy) {
          const inst: CardInst = { iid: target.iid, card: target.card };
          if (answer.yes) d.players[target.controller].library.unshift(inst);
          else d.players[target.controller].library.push(inst);
        }
        log(d, { k: 'tucked', card: target.card.name, top: answer.yes });
      }
      break;
    case 'bounce':
    case 'bounceAll':
      // Reprieve, Sink into Stupor: a spell goes back to its owner's hand (it isn't countered).
      if (e.kind === 'bounce') {
        for (const target of spells) {
          if (target.ability || !d.stack.includes(target)) continue;
          d.stack = d.stack.filter((x) => x !== target);
          if (!target.copy) putInZone(d, target.controller, { iid: target.iid, card: target.card, ...(target.commander ? { commander: true } : {}) }, 'hand');
          log(d, { k: 'bounced', card: target.card.name });
        }
      }
      for (const perm of e.kind === 'bounceAll' ? matching(d, caster, e.which) : perms) {
        d.battlefield = d.battlefield.filter((x) => x.iid !== perm.iid);
        returnExiledUntil(d, perm);
        if (!isToken(printedCard(perm))) putInZone(d, perm.owner ?? perm.controller, { iid: perm.iid, card: printedCard(perm), ...(perm.commander ? { commander: true } : {}) }, 'hand');
        log(d, { k: 'bounced', card: perm.card.name });
      }
      break;
    case 'fight': {
      const [a] = 'iid' in e.a ? [findPermanent(d, e.a.iid)].filter((x) => x !== undefined) : affected(d, r, e.a) as Permanent[];
      const [b] = affected(d, r, e.b);
      if (!a || b === undefined) break;
      if (typeof b === 'number') {
        dealDamage(d, a, a.controller, b, powerOf(a));
      } else if (isPermanent(b)) {
        dealDamage(d, a, a.controller, b, powerOf(a));
        if (!e.oneSided) dealDamage(d, b, b.controller, a, powerOf(b));
      }
      break;
    }
    case 'sacrifice':
      // Players choose one after the other, like discarding.
      for (let i = r.sub ?? 0; i < players.length; i++) {
        const p = players[i];
        const options = matching(d, p, e.which).filter((x) => x.controller === p);
        const n = Math.min(amount(d, r, e.n), options.length);
        if (!n) continue;
        if (n === options.length) {
          for (const perm of options) sacrifice(d, perm);
          continue;
        }
        if (!answer || answer.kind !== 'cards') {
          r.sub = i;
          return { kind: 'cards', player: p, purpose: 'sacrifice', min: n, max: n, options, params: { n } };
        }
        for (const iid of answer.iids) sacrifice(d, findPermanent(d, iid)!);
        answer = undefined;
      }
      r.sub = 0;
      break;
    case 'dig': {
      // "Look at the top N cards …": the chosen ones into the hand, the rest on the bottom in a random order.
      const ps = d.players[caster];
      // Consult the Star Charts: X is the number of lands you control.
      const n = e.n === 'lands' ? d.battlefield.filter((x) => x.controller === caster && isLandCard(x.card)).length : e.n;
      const top = ps.library.slice(0, n);
      const options = e.filter ? top.filter((c) => cardMatches(c.card, e.filter!)) : top;
      const spells = e.spellsTake !== undefined && (['instant', 'sorcery'] as const).every((t) => ps.graveyard.some((c) => cardTypes(c.card).includes(t)));
      const max = Math.min(spells ? e.spellsTake! : e.take, options.length);
      if (max && answer?.kind !== 'cards') {
        return { kind: 'cards', player: caster, purpose: 'dig', min: e.optional ? 0 : max, max, options, params: { n: top.length } };
      }
      const picked = answer?.kind === 'cards' ? answer.iids : [];
      const chosen = options.filter((c) => picked.includes(c.iid));
      ps.library = ps.library.slice(top.length);
      ps.hand.push(...chosen);
      ps.library.push(...shuffle(top.filter((c) => !chosen.includes(c)), () => random(d)));
      log(d, { k: 'dig', p: caster, n: top.length, took: chosen.length });
      break;
    }
    case 'attachEquipment': {
      // Thorin: the Equipment still there go on the creature; if any did, the reflexive trigger.
      const [host] = affected(d, r, e.to).filter((x): x is Permanent => typeof x !== 'number' && isPermanent(x));
      if (!host) break;
      let n = 0;
      for (const eq of affected(d, r, e.what)) {
        if (typeof eq === 'number' || !isPermanent(eq) || eq.controller !== host.controller || isCreature(eq.card)) continue;
        eq.attachedTo = host.iid;
        log(d, { k: 'attached', card: eq.card.name, to: host.card.name });
        n++;
      }
      if (n && e.thenDamage) {
        (d.triggered ??= []).push({
          source: { iid: item.source ?? item.iid, card: item.card }, controller: caster,
          ability: { targets: [e.thenDamage], effects: [{ kind: 'fight', a: { iid: host.iid }, b: { slot: 0 }, oneSided: true }] },
        });
      }
      break;
    }
    case 'animate':
      for (const perm of perms) animate(d, perm, e);
      break;
    case 'emblem': {
      const emblem: Card = {
        id: `emblem:${item.card.name}`, name: `${item.card.name.split(' // ')[0]} emblem`, manaCost: '', cmc: 0, typeLine: 'Emblem', oracleText: e.text,
        colors: [], colorIdentity: [], setCode: '', setName: '', rarity: '', keywords: [],
      };
      (d.players[caster].emblems ??= []).push(emblem);
      log(d, { k: 'emblem', p: caster, card: item.card.name });
      break;
    }
    case 'tradeForCard': {
      // "You may sacrifice an artifact or discard a card. If you do, draw a card."
      const ps = d.players[caster];
      const options: CardInst[] = [...matching(d, caster, e.sacrifice).filter((x) => x.controller === caster), ...ps.hand];
      if (options.length && answer?.kind !== 'cards') {
        return { kind: 'cards', player: caster, purpose: 'tradeForCard', min: 0, max: 1, options, params: { card: item.card.name } };
      }
      const iid = answer?.kind === 'cards' ? answer.iids[0] : undefined;
      const perm = iid ? findPermanent(d, iid) : undefined;
      const inHand = iid ? ps.hand.find((c) => c.iid === iid) : undefined;
      if (perm) sacrifice(d, perm);
      else if (inHand) {
        moveToGraveyard(d, caster, inHand, 'hand');
        log(d, { k: 'discard', p: caster, card: inHand.card.name });
      } else r.stopped = true;
      break;
    }
    case 'reflexive': {
      // "you may discard a card. When you do, …" / "you may pay {W}{B} and 2 life. When you do, …"
      const ps = d.players[caster];
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (e.cost.sacrifice) {
        // Ruthless Lawbringer: "you may sacrifice another creature".
        const sac = e.cost.sacrifice;
        const options = matching(d, caster, sac.which).filter((x) => x.controller === caster && !(sac.another && x.iid === item.source));
        if (!options.length) break;
        if (answer?.kind !== 'cards') return { kind: 'cards', player: caster, purpose: 'reflexiveSacrifice', min: 0, max: 1, options, params: { card: item.card.name } };
        const picked = answer.iids[0];
        const victim = options.find((x) => x.iid === picked);
        if (!victim) break;
        sacrifice(d, victim);
      } else if (e.cost.removeCounter) {
        // Leatherhead: "you may remove a counter from her" (a keyword counter first: its +1/+1 counters are worth more).
        const kinds = Object.entries(src?.counters ?? {}).filter(([, n]) => n).map(([k]) => k as CounterKind);
        if (!src || !kinds.length) break;
        if (answer?.kind !== 'yesNo') return { kind: 'yesNo', player: caster, purpose: 'reflexiveRemoveCounter', params: { card: item.card.name } };
        if (!answer.yes) break;
        const kind = kinds.find((k) => k !== '+1/+1' && k !== 'loyalty') ?? kinds[0];
        src.counters = { ...src.counters, [kind]: (src.counters[kind] ?? 0) - 1 };
        log(d, { k: 'counterRemoved', card: src.card.name, counter: kind });
      } else if (e.cost.discard) {
        if (!ps.hand.length) break;
        if (answer?.kind !== 'cards') return { kind: 'cards', player: caster, purpose: 'reflexiveCost', min: 0, max: 1, options: ps.hand, params: { card: item.card.name } };
        const picked = answer.iids[0];
        const inst = ps.hand.find((c) => c.iid === picked);
        if (!inst) break;
        moveToGraveyard(d, caster, inst, 'hand');
        log(d, { k: 'discard', p: caster, card: inst.card.name });
      } else {
        const cost = parseCost(e.cost.mana ?? '');
        const life = e.cost.life ?? 0;
        const sources = manaSources(d, caster);
        if (!findPayment(sources, cost) || ps.life < life) break;
        if (answer?.kind !== 'yesNo') {
          return { kind: 'yesNo', player: caster, purpose: 'reflexivePay', params: { card: item.card.name, cost: e.cost.mana ?? '', life } };
        }
        if (!answer.yes) break;
        pay(d, caster, sources, cost);
        if (life) changeLife(d, caster, -life);
      }
      // "When you do": a new trigger, its targets chosen now.
      (d.triggered ??= []).push({ source: { iid: item.source ?? item.iid, card: item.card }, controller: caster, ability: e.then });
      break;
    }
    case 'gainAbility': {
      // The Saga keeps the ability while it stays; what leaves the battlefield is the printed card.
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (src) {
        src.printed ??= src.card;
        src.card = { ...src.card, oracleText: `${src.card.oracleText}\n${e.text}` };
        log(d, { k: 'gainsAbility', card: src.card.name, text: e.text });
      }
      break;
    }
    case 'amass': {
      // Amass: an Army (a new 0/0 one if none), then +1/+1 counters on it.
      let army = d.battlefield.find((x) => x.controller === caster && isCreature(x.card) && hasSubtype(x.card, 'army'));
      if (!army) {
        d.abilities = (d.abilities ?? 0) + 1;
        const token = { name: `${e.subtype} Army`, typeLine: `Token Creature — ${e.subtype} Army`, colors: ['B'] as Color[], power: 0, toughness: 0, keywords: [], oracleText: '' };
        army = enterBattlefield(d, { iid: `token-${d.abilities}`, card: tokenCard(token) }, caster);
        log(d, { k: 'token', p: caster, card: token.name, n: 1 });
      }
      army.counters = { ...army.counters, '+1/+1': (army.counters['+1/+1'] ?? 0) + e.n };
      log(d, { k: 'counters', card: army.card.name, counter: '+1/+1', n: e.n });
      break;
    }
    case 'fade': {
      // Fading: a fade counter removed, or sacrificed when there's none left.
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (!src) break;
      if (src.counters.fade) src.counters = { ...src.counters, fade: src.counters.fade - 1 };
      else sacrifice(d, src);
      break;
    }
    case 'recruit': {
      // Draw, then discard a card: a nonland one makes a 1/1 white Human Soldier.
      const ps = d.players[caster];
      if (answer?.kind !== 'cards') {
        draw(d, caster, 1);
        if (!ps.hand.length) break;
        return { kind: 'cards', player: caster, purpose: 'discard', min: 1, max: 1, options: [...ps.hand], params: { n: 1 } };
      }
      const picked = answer.iids[0];
      const inst = ps.hand.find((c) => c.iid === picked);
      if (!inst) break;
      moveToGraveyard(d, caster, inst, 'hand');
      log(d, { k: 'discard', p: caster, card: inst.card.name });
      if (!isLandCard(inst.card)) {
        const soldier = { name: 'Human Soldier', typeLine: 'Token Creature — Human Soldier', colors: ['W'] as Color[], power: 1, toughness: 1, keywords: [], oracleText: '' };
        d.abilities = (d.abilities ?? 0) + 1;
        enterBattlefield(d, { iid: `token-${d.abilities}`, card: tokenCard(soldier) }, caster);
        log(d, { k: 'token', p: caster, card: soldier.name, n: 1 });
      }
      break;
    }
    case 'cumulativeUpkeep': {
      // An age counter, then pay the cost for each one, or sacrifice it.
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (!src) break;
      if (answer === undefined) src.counters = { ...src.counters, age: (src.counters.age ?? 0) + 1 };
      const age = src.counters.age ?? 1;
      const once = parseCost(e.mana);
      const cost = { generic: once.generic * age, colored: Array.from({ length: age }, () => once.colored).flat() };
      const costText = `{${cost.generic}}${cost.colored.map((c) => `{${c.join('/')}}`).join('')}`.replace(/^\{0\}(?=\{)/, '');
      if (findPayment(manaSources(d, caster), cost)) {
        if (answer?.kind !== 'yesNo') return { kind: 'yesNo', player: caster, purpose: 'cumulativeUpkeep', params: { card: src.card.name, cost: costText, n: age } };
        if (answer.yes) {
          pay(d, caster, manaSources(d, caster), cost);
          break;
        }
      }
      sacrifice(d, src);
      break;
    }
    case 'drawUnlessPays': {
      // Rhystic Study: the player who cast the spell may pay; if they don't, its controller draws.
      const t = r.legal[0]?.[0];
      const payer = t?.kind === 'player' ? t.player : undefined;
      // Esper Sentinel: X is its power (as it resolves; its last known power if it left).
      const src = item.source ? findPermanent(d, item.source) : undefined;
      const n = e.mana === 'power' ? (src ? powerOf(src) : power(item.card)) : e.mana;
      const cost = { generic: n, colored: [] };
      if (payer !== undefined && findPayment(manaSources(d, payer), cost)) {
        if (answer?.kind !== 'yesNo') return { kind: 'yesNo', player: payer, purpose: 'payOrDraw', params: { card: item.card.name, n } };
        if (answer.yes) {
          pay(d, payer, manaSources(d, payer), cost);
          log(d, { k: 'paidTax', p: payer, n, card: item.card.name });
          break;
        }
      }
      draw(d, caster, e.n);
      break;
    }
    case 'sorceryFlash':
      d.players[caster].sorceryFlash = true;
      log(d, { k: 'sorceryFlash', p: caster });
      break;
    case 'exileFromHand': {
      // Chrome Mox: which card (or none, "you may"); the source remembers it.
      const ps = d.players[caster];
      const options = ps.hand.filter((c) => cardMatches(c.card, e.filter));
      if (!options.length) break;
      if (answer?.kind !== 'cards') return { kind: 'cards', player: caster, purpose: 'exileFromHand', min: 0, max: 1, options, params: { card: item.card.name } };
      const picked = answer.iids[0];
      const inst = options.find((c) => c.iid === picked);
      if (!inst) break;
      ps.hand = ps.hand.filter((c) => c !== inst);
      ps.exile.push(inst);
      log(d, { k: 'exiledCard', card: inst.card.name, from: 'hand' });
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (src) src.imprinted = inst.card;
      break;
    }
    case 'attach': {
      const src = item.source ? findPermanent(d, item.source) : undefined;
      const host = perms[0];
      if (src && host && host.controller === src.controller) {
        src.attachedTo = host.iid;
        log(d, { k: 'attached', card: src.card.name, to: host.card.name });
      }
      break;
    }
    case 'poison':
      for (const p of players) addPoison(d, p, amount(d, r, e.n));
      break;
    case 'exileGraveyards':
      for (const q of players) {
        const ps = d.players[q];
        ps.exile.push(...ps.graveyard);
        ps.graveyard = [];
      }
      log(d, { k: 'exiledGraveyards', card: item.card.name });
      break;
    case 'proliferate': {
      // Each permanent and player with counters gets one more of each kind: ours that help, theirs that hurt.
      for (const perm of d.battlefield) {
        const mine = perm.controller === caster;
        const kinds = (Object.keys(perm.counters) as CounterKind[]).filter((k) => perm.counters[k] && (mine ? k !== '-1/-1' : k === '-1/-1'));
        if (kinds.length) perm.counters = { ...perm.counters, ...Object.fromEntries(kinds.map((k) => [k, (perm.counters[k] ?? 0) + 1])) };
      }
      // Each opposing team's poison (shared by its players) once.
      for (const team of teamsOf(d)) {
        if (team.includes(caster) || !d.players[team[0]].poison) continue;
        addPoison(d, team[0], 1);
      }
      log(d, { k: 'proliferate', p: caster });
      break;
    }
    case 'gainControl':
      for (const perm of perms) {
        if (perm.controller === caster) continue;
        perm.owner ??= perm.controller;
        perm.controller = caster;
        perm.sick = true;
        if (e.untilEndOfTurn) perm.controlUntilEndOfTurn = true;
        if (e.untapHaste) {
          perm.tapped = false;
          perm.boosts.push({ power: 0, toughness: 0, keywords: ['haste'], until: 'endOfTurn' });
        }
        delete perm.attachedTo; // Equipment stays with its controller
        log(d, { k: 'control', p: caster, card: perm.card.name });
      }
      break;
    case 'copySpell':
      for (const target of spells) {
        d.abilities = (d.abilities ?? 0) + 1;
        d.stack.push({ ...structuredClone(target), iid: `${target.iid}-copy-${d.abilities}`, controller: caster, copy: true });
        log(d, { k: 'copied', card: target.card.name, as: target.card.name });
      }
      break;
    case 'tokenCopy':
      for (const perm of perms) {
        d.abilities = (d.abilities ?? 0) + 1;
        const model = printedCard(perm);
        enterBattlefield(d, { iid: `token-${d.abilities}`, card: { ...model, id: `token:copy:${model.id}` } }, caster);
        log(d, { k: 'token', p: caster, card: model.name, n: 1 });
      }
      break;
    case 'returnFromGraveyard': {
      // Overlord of the Balemurk: chosen as it resolves, after the mill.
      const ps = d.players[caster];
      const options = ps.graveyard.filter((c) => e.filters.some((f) => cardMatches(c.card, f)));
      if (!options.length) break;
      if (answer?.kind !== 'cards') return { kind: 'cards', player: caster, purpose: 'returnFromGraveyard', min: e.optional ? 0 : 1, max: 1, options, params: { card: item.card.name } };
      const picked = answer.iids[0];
      const inst = options.find((c) => c.iid === picked);
      if (!inst) break;
      ps.graveyard = ps.graveyard.filter((c) => c !== inst);
      ps.hand.push(inst);
      log(d, { k: 'returned', card: inst.card.name, dest: 'hand' });
      break;
    }
    case 'transform': {
      // The permanent turns to its other face (counters, damage and attachments stay).
      const perm = item.source ? findPermanent(d, item.source) : undefined;
      if (!perm) break;
      const full = printedCard(perm);
      if (cardFaces(full).length < 2) break;
      perm.printed = full;
      perm.transformed = !perm.transformed;
      perm.card = faceCard(full, perm.transformed ? 1 : 0);
      log(d, { k: 'transformed', card: full.name.split(' // ')[0], into: perm.card.name.split(' // ')[0] });
      break;
    }
    case 'flicker':
      // All Aboard: exiled, then back at once under its owner's control (a new object: no counters, untapped).
      for (const perm of perms) {
        const owner = perm.owner ?? perm.controller;
        const token = isToken(printedCard(perm));
        removePermanent(d, perm, 'exile');
        log(d, { k: 'exiled', card: perm.card.name });
        const inst = token ? undefined : d.players[owner].exile.find((c) => c.iid === perm.iid);
        if (!inst) continue;
        d.players[owner].exile = d.players[owner].exile.filter((c) => c !== inst);
        log(d, { k: 'returned', card: inst.card.name, dest: 'battlefield' });
        putOntoBattlefield(d, inst, owner);
      }
      break;
    case 'airbend':
    case 'plot': {
      // Aang: "Exile it. While it's exiled, its owner may cast it for {2} rather than its mana cost."
      // Aven Interrupter: "Its owner may cast it as a sorcery on a later turn without paying its mana cost."
      const castFor: CardInst['castFor'] = e.kind === 'airbend' ? { cost: '{2}' } : { cost: '', afterTurn: d.turn, sorcery: true };
      for (const perm of perms) {
        const owner = perm.owner ?? perm.controller;
        const token = isToken(printedCard(perm));
        removePermanent(d, perm, 'exile');
        log(d, { k: 'exiled', card: perm.card.name });
        const inst = token ? undefined : d.players[owner].exile.find((c) => c.iid === perm.iid);
        if (inst) inst.castFor = castFor;
      }
      for (const target of spells) {
        if (target.ability || !d.stack.includes(target)) continue;
        d.stack = d.stack.filter((x) => x !== target);
        log(d, { k: 'exiled', card: target.card.name });
        if (target.copy) continue;
        putInZone(d, target.controller, { iid: target.iid, card: target.card, ...(target.commander ? { commander: true } : {}) }, 'exile');
        const inst = d.players[target.controller].exile.find((c) => c.iid === target.iid);
        if (inst) inst.castFor = castFor;
      }
      break;
    }
    case 'castDiscarded': {
      // Malcolm: with enough chorus counters, the card just discarded may be cast right away for free.
      const src = item.source ? findPermanent(d, item.source) : undefined;
      const iid = r.discarded?.at(-1);
      if (!src || (src.counters[e.counter] ?? 0) < e.minCounters || !iid) break;
      const discarded = d.players[caster].graveyard.find((c) => c.iid === iid);
      if (!discarded || isLand(discarded.card)) break; // a land can't be cast
      d.castNow = { player: caster, iid };
      log(d, { k: 'mayCastFree', p: caster, card: d.players[caster].graveyard.find((c) => c.iid === iid)!.card.name });
      break;
    }
    case 'returnExiledSpirits': {
      // The source was sacrificed to pay the cost: what it exiled is remembered by its iid.
      for (const x of (item.source && d.exiledWith?.[item.source]) || []) {
        const ps = d.players[x.owner];
        const inst = ps.exile.find((c) => c.iid === x.iid);
        if (!inst || !isCreature(inst.card) || uncastExiled(d, inst.card)) continue;
        ps.exile = ps.exile.filter((c) => c !== inst);
        const [types, subtypes] = inst.card.typeLine.split(' // ')[0].split(' — ');
        const spirit: Card = { ...inst.card, power: '1', toughness: '1', typeLine: `${types} — ${subtypes ? `${subtypes} ` : ''}Spirit` };
        const perm = enterBattlefield(d, { ...inst, card: spirit }, caster);
        perm.printed = inst.card;
        if (x.owner !== caster) perm.owner = x.owner;
        perm.counters = { ...perm.counters, flying: 1 };
        log(d, { k: 'returned', card: inst.card.name, dest: 'battlefield' });
      }
      if (item.source) delete d.exiledWith?.[item.source];
      break;
    }
    case 'copyNewTokens': {
      if (!d.players[caster].citysBlessing) break;
      const fresh = d.battlefield.filter((x) => x.controller === caster && x.enteredOnTurn === d.turn && isToken(printedCard(x)));
      for (const perm of fresh) {
        d.abilities = (d.abilities ?? 0) + 1;
        const model = printedCard(perm);
        enterBattlefield(d, { iid: `token-${d.abilities}`, card: { ...model, id: `token:copy:${model.id}` } }, caster);
        log(d, { k: 'token', p: caster, card: model.name, n: 1 });
      }
      break;
    }
    case 'preventCombat':
      d.preventCombat = true;
      break;
    case 'preventDamage': {
      const n = amount(d, r, e.n);
      for (const t of [...players.map((p) => `player:${p}`), ...perms.map((x) => x.iid)]) (d.shields ??= []).push({ target: t, n });
      break;
    }
    case 'extraTurn':
      for (const p of players) {
        // An extra turn is taken by the player's whole team.
        const lead = teamPlayers(d, p)[0];
        d.extraTurns = [...(d.extraTurns ?? d.players.map(() => 0))];
        d.extraTurns[lead] = (d.extraTurns[lead] ?? 0) + 1;
        log(d, { k: 'extraTurn', p });
      }
      break;
    case 'addMana': {
      const ps = d.players[caster];
      ps.pool = [...(ps.pool ?? []), ...e.units.map((colors) => ({ colors }))];
      break;
    }
    case 'sacrificeSelf': {
      const src = item.source ? findPermanent(d, item.source) : undefined;
      if (src) sacrifice(d, src);
      break;
    }
    case 'token': {
      const n = amount(d, r, e.n);
      // Get Lost: the controller of the permanent it targeted (destroyed or not).
      const t = e.forTargetController ? r.legal[e.forTargetController.slot]?.[0] : undefined;
      const owner = !e.forTargetController ? caster
        : t?.kind === 'permanent' ? r.removed?.[t.iid] ?? findPermanent(d, t.iid)?.controller : undefined;
      if (owner === undefined) break;
      for (let i = 0; i < n; i++) {
        d.abilities = (d.abilities ?? 0) + 1;
        const token = enterBattlefield(d, { iid: `token-${d.abilities}`, card: tokenCard(e.token) }, owner, { tapped: e.attacking });
        // "tapped and attacking": attacking (the defending player) without having been declared, so no attack trigger.
        if (e.attacking && d.attackers.length) d.attackers = [...d.attackers, token.iid];
        if (e.sacrificeAtEnd) (d.sacrificeAtEnd ??= []).push(token.iid);
      }
      if (n > 0) log(d, { k: 'token', p: owner, card: e.token.name, n });
      break;
    }
    case 'explore':
      for (const perm of perms) {
        const ps = d.players[perm.controller];
        const top = ps.library[0];
        // A land: into the hand. Anything else (or nothing): a +1/+1 counter, and the card may go to the graveyard.
        if (top && isLand(top.card)) {
          ps.library.shift();
          ps.hand.push(top);
          log(d, { k: 'explores', card: perm.card.name, revealed: top.card.name, land: true });
          continue;
        }
        if (answer?.kind !== 'yesNo') {
          perm.counters = { ...perm.counters, '+1/+1': (perm.counters['+1/+1'] ?? 0) + 1 };
          log(d, { k: 'explores', card: perm.card.name, ...(top ? { revealed: top.card.name } : {}), land: false });
          if (!top) continue;
          return { kind: 'yesNo', player: perm.controller, purpose: 'exploreMill', params: { card: top.card.name } };
        }
        if (answer.yes) moveToGraveyard(d, perm.controller, ps.library.shift()!, 'library');
        answer = undefined;
      }
      break;
  }
  return undefined;
}

function startResolving(d: GameState, reason: WindowReason) {
  const item = d.stack.pop()!;

  if (!item.ability && !isInstantOrSorcery(castCard(item))) {
    resolvePermanentSpell(d, item, reason);
    return;
  }

  // Targets are checked again on resolution. If none is still legal, the spell does nothing.
  const spec = specOf(item);
  const legal = item.targets.map((ts, slot) => ts.filter((t) => spec.targets[slot] && isLegalTarget(d, item.controller, spec.targets[slot], t, item.iid, castCard(item))));
  if (item.targets.some((ts) => ts.length) && legal.every((ts) => !ts.length)) {
    log(d, { k: 'fizzles', card: castCard(item).name });
    if (!item.ability) putAwaySpell(d, item, false);
    afterResolving(d, reason);
    return;
  }
  if (!spec.effects.length) log(d, { k: 'notSimulated', card: castCard(item).name });
  if (!conditionMet(d, item.controller, spec.condition, item.source)) {
    afterResolving(d, reason);
    return;
  }
  d.resolving = { item, legal, next: 0, reason };
  continueResolving(d);
}

/** A permanent spell resolves: it enters (`landDiscarded`: Mox Diamond's replacement was already applied). */
function resolvePermanentSpell(d: GameState, item: StackItem, reason: WindowReason, landDiscarded = false) {
  const card = castCard(item);
  // Mox Diamond: "If this artifact would enter, you may discard a land card instead. If you do, put this artifact
  // onto the battlefield. If you don't, put it into its owner's graveyard."
  if (!landDiscarded && discardsLandInstead(card)) {
    const lands = d.players[item.controller].hand.filter((c) => isLand(c.card));
    if (lands.length) {
      d.pending = {
        choice: { kind: 'cards', player: item.controller, purpose: 'discardLandInstead', min: 0, max: 1, options: lands, params: { card: card.name } },
        resume: 'discardLandInstead', activation: { item, named: [] }, reason,
      };
      return;
    }
    putAwaySpell(d, item, false);
    log(d, { k: 'declined', card: card.name });
    afterResolving(d, reason);
    return;
  }
  // A clone asks what to copy before it enters.
  // Mockingbird: a creature with mana value at most the mana spent.
  const bird = entersAsBirdCopy(card);
  const spent = (() => { const c = costWithX(card, item.x ?? 0); return c.generic + c.colored.length; })();
  const others = d.battlefield.filter((x) => isCreature(x.card) && (!bird || printedCard(x).cmc <= spent));
  if ((entersAsCopy(card) || bird) && others.length) {
    d.pending = {
      choice: { kind: 'cards', player: item.controller, purpose: 'clone', min: 0, max: 1, options: others, params: { card: card.name } },
      resume: 'clone', activation: { item, named: [] }, reason,
    };
    return;
  }
  // An Aura needs its target to still be legal; it enters attached to it.
  const aura = auraTarget(card);
  const host = item.targets[0]?.[0];
  if (aura && (!host || !isLegalTarget(d, item.controller, aura, host, item.iid, card))) {
    log(d, { k: 'fizzles', card: card.name });
    putAwaySpell(d, item, false);
    afterResolving(d, reason);
    return;
  }
  log(d, { k: 'enters', card: faceName(item.card, item.face ?? 0) });
  const perm = enterBattlefield(d, { iid: item.iid, card, ...(item.commander ? { commander: true } : {}) }, item.controller, { x: item.x });
  if (card !== item.card) perm.printed = item.card;
  // Evoke: "When it enters, if its evoke cost was paid, its controller sacrifices it." Warp: exiled at the next end step.
  const paid = item.alt === undefined ? undefined : castInfo(item.card, item.face ?? 0).alts[item.alt];
  if (paid?.kind === 'exileCard' && paid.evoke) queueTrigger(d, perm, perm.controller, { targets: [], effects: [{ kind: 'sacrificeSelf' }] });
  if (paid?.kind === 'mana' && paid.name === 'warp') (d.warpAtEnd ??= []).push(perm.iid);
  // Impending: time counters, and not a creature until the last one is removed.
  if (paid?.kind === 'mana' && paid.name === 'impending' && paid.counters) {
    perm.counters = { ...perm.counters, time: paid.counters };
    perm.printed ??= perm.card;
    perm.impending = true;
    perm.card = { ...perm.card, typeLine: perm.card.typeLine.replace(/\s*\bCreature\b/, '') };
  }
  if (aura && host?.kind === 'permanent') {
    perm.attachedTo = host.iid;
    log(d, { k: 'attached', card: perm.card.name, to: findPermanent(d, host.iid)!.card.name });
  }
  afterResolving(d, reason);
}

function continueResolving(d: GameState, answer?: Answer) {
  const r = d.resolving!;
  const spec = specOf(r.item);
  const effects = spec.effects;
  if (spec.optional && !r.accepted) {
    // Mana Vault: "you may pay {4}. If you do, …": not offered when it can't be paid.
    const cost = spec.mayPay ? parseCost(spec.mayPay) : undefined;
    const payable = !cost || findPayment(manaSources(d, r.item.controller), cost);
    if (payable && answer?.kind !== 'yesNo') {
      const choice: Choice = spec.mayPay
        ? { kind: 'yesNo', player: r.item.controller, purpose: 'mayPay', params: { card: r.item.card.name, cost: spec.mayPay } }
        : { kind: 'yesNo', player: r.item.controller, purpose: 'optional', params: { card: r.item.card.name } };
      d.pending = { choice, resume: 'effect' };
      return;
    }
    if (payable && answer?.kind === 'yesNo' && answer.yes && cost) pay(d, r.item.controller, manaSources(d, r.item.controller), cost);
    if (!payable || answer?.kind !== 'yesNo' || !answer.yes) {
      log(d, { k: 'declined', card: r.item.card.name });
      r.next = effects.length;
    }
    r.accepted = true;
    answer = undefined;
  }
  while (r.next < effects.length) {
    const choice = runEffect(d, r, effects[r.next], answer);
    answer = undefined;
    if (choice) {
      d.pending = { choice, resume: 'effect' };
      return;
    }
    r.next++;
    if (r.stopped) r.next = effects.length;
  }
  d.resolving = null;
  if (!r.item.ability) putAwaySpell(d, r.item, true);
  afterResolving(d, r.reason);
}

/** After something resolves, the active player gets priority again (except for a main phase spell). */
function afterResolving(d: GameState, reason: WindowReason) {
  checkStateBased(d);
  d.priority = d.winner !== null || (!d.stack.length && reason === 'main') ? null : { player: d.active, passes: 0, reason };
}

// ---------- Priority ----------

/** Whether `p` should be asked to act in a priority window (Arena-style auto-pass otherwise). */
function wantsPriority(d: GameState, p: PlayerId): boolean {
  if (d.fullControl?.[p]) return true;
  const reason = d.priority!.reason;
  if (!d.stack.length) {
    // Like Arena, these stops are only made in full control.
    if (reason === 'begin' || reason === 'combat' || reason === 'upkeep') return false;
    if (reason === 'attack' && isActivePlayer(d, p)) return false; // the attacker just acted
  }
  if (d.stack.at(-1)?.controller === p) return false; // don't respond to your own spell
  const ps = d.players[p];
  // Abilities of permanents and cards in public zones (flashback, adventures, the commander) are seen by everyone.
  if (activatable(d, p).length > 0 || [...ps.graveyard, ...ps.exile, ...(ps.command ?? [])].some((c) => castOptions(d, p, c.iid).length > 0)) return true;
  // Online: cards in hand and mana to cast one, whatever they are (a spell without mana, like Daze, needs full control).
  if (d.publicStops) return ps.hand.length > 0 && (!!ps.pool?.length || manaSources(d, p).some((m) => !m.iid.startsWith('hand:')));
  return ps.hand.some((c) => castOptions(d, p, c.iid).length > 0);
}

function openWindow(d: GameState, reason: WindowReason, player: PlayerId, passes: number) {
  d.priority = { player, passes, reason };
  settle(d);
}

/**
 * Runs the game forward until someone has to decide something: state-based actions, then
 * waiting triggers go on the stack, then players who wouldn't do anything pass automatically.
 */
function settle(d: GameState) {
  for (;;) {
    checkStateBased(d);
    if (d.winner !== null || d.pending || d.mulligan) return;
    if (askLegendRule(d) || askBasicType(d) || askLifeChoice(d) || askCreatureType(d) || askCardName(d) || askChosenPlayer(d)) return;
    if (d.triggered?.length) {
      if (!flushTrigger(d)) return;
      continue;
    }
    if (!d.priority || wantsPriority(d, d.priority.player)) return;
    passOnce(d);
  }
}

/** Legend rule: a player controlling two legendary permanents with the same name keeps one. */
function askLegendRule(d: GameState): boolean {
  for (const perm of d.battlefield) {
    if (!/\bLegendary\b/.test(perm.card.typeLine.split('//')[0])) continue;
    const same = d.battlefield.filter((x) => x.controller === perm.controller && x.card.name === perm.card.name);
    if (same.length < 2) continue;
    d.pending = {
      choice: { kind: 'cards', player: perm.controller, purpose: 'legendRule', min: 1, max: 1, options: same, params: { card: perm.card.name } },
      resume: 'legend',
    };
    return true;
  }
  return false;
}

/** Shock lands: "pay 2 life, or it enters tapped". */
function askLifeChoice(d: GameState): boolean {
  const next = d.lifeChoices?.shift();
  if (!d.lifeChoices?.length) delete d.lifeChoices;
  if (!next) return false;
  const perm = findPermanent(d, next.iid);
  if (!perm) return askLifeChoice(d);
  d.pending = { choice: { kind: 'yesNo', player: perm.controller, purpose: 'payLife', params: { card: perm.card.name, n: next.n } }, resume: 'payLife', iid: perm.iid };
  return true;
}

function passOnce(d: GameState) {
  const pr = d.priority!;
  pr.passes++;
  if (pr.passes < d.players.length) {
    pr.player = nextPlayer(d, pr.player);
    return;
  }
  d.priority = null;
  if (d.stack.length) startResolving(d, pr.reason);
  else closeWindow(d, pr.reason);
}

/** Everyone passed with an empty stack: the game moves on. */
function closeWindow(d: GameState, reason: WindowReason) {
  // A window closing ends its step (the main phase goes on after a main-phase spell).
  if (reason !== 'main') emptyPools(d);
  if (reason === 'upkeep') {
    drawStep(d, d.turn === 1);
  } else if (reason === 'combat') {
    // Attackers may have been removed during the window. Each head with creatures able to attack declares in turn.
    d.attackers = [];
    delete d.attackTargets;
    delete d.attackPlan;
    const heads = teamPlayers(d, d.active).filter((q) => creaturesOf(d, q).some(canAttack));
    if (heads.length) {
      d.step = 'attack';
      d.declaring = heads[0];
    } else d.step = 'main2';
  } else if (reason === 'attack') {
    d.attackers = d.attackers.filter((iid) => findPermanent(d, iid));
    if (!d.attackers.length) {
      d.step = 'main2';
      return;
    }
    d.step = 'block';
    d.pendingBlocks = {};
    // Each defending head that could block declares in turn; none: no blockers prompt.
    const next = nextBlocker(d, []);
    if (next === undefined) setBlocks(d, {});
    else d.declaring = next;
  } else if (reason === 'block') {
    resolveCombat(d);
    d.attackers = [];
    delete d.attackTargets;
    d.blocks = {};
    d.step = 'main2';
  } else if (reason === 'end') {
    endTurn(d);
  }
}

/** Will `q` still declare blockers after `p` (teammates declaring in turn)? */
function nextBlockerIs(d: GameState, q: PlayerId, p: PlayerId): boolean {
  const order = opponentsOf(d, d.active);
  return order.indexOf(q) > order.indexOf(p) && !(d.declared ?? []).includes(q);
}

/** The teammate of `p` who acts next in this main phase, if any. */
function nextHead(d: GameState, p: PlayerId): PlayerId | undefined {
  const done = [...(d.headsDone ?? []), p];
  return teamPlayers(d, d.active).find((q) => !done.includes(q));
}

/**
 * One head of the attacking team declares its attackers (none: an empty list). The next head with creatures able to
 * attack declares next; after the last, the whole team attacks at once (the attacking team declares attackers as a
 * team), so the attack triggers of both boards see every attacker, and the attack window opens.
 */
function declareAttacks(d: GameState, p: PlayerId, ids: string[], pw: Record<string, string>) {
  // "attacks each combat if able" (Dragon's Rage Channeler with delirium).
  const must = creaturesOf(d, p).find((x) => x.statics?.mustAttack && canAttack(x) && !ids.includes(x.iid));
  if (must) throw new IllegalAction('mustAttack', { card: must.card.name });
  const attackers = [...new Set(ids)].map((iid) => {
    const perm = findPermanent(d, iid);
    if (!perm || perm.controller !== p || !canAttack(perm)) throw new IllegalAction('cannotAttack');
    return perm;
  });
  for (const [aid, pwIid] of Object.entries(pw)) {
    const walker = findPermanent(d, pwIid);
    if (!attackers.some((a) => a.iid === aid) || !walker || teamOf(d, walker.controller) === teamOf(d, p) || !isPlaneswalker(walker.card)) {
      throw new IllegalAction('cannotAttackThat');
    }
  }
  const plan = [...(d.attackPlan ?? []), { p, ids: attackers.map((a) => a.iid), pw }];
  // The next head of the team with creatures able to attack.
  const declared = [...(d.declared ?? []), p];
  const next = teamPlayers(d, d.active).find((q) => !declared.includes(q) && creaturesOf(d, q).some(canAttack));
  if (next !== undefined) {
    d.attackPlan = plan;
    d.declared = declared;
    d.declaring = next;
    return;
  }
  delete d.attackPlan;
  delete d.declared;
  delete d.declaring;
  // Everything declared becomes attacking at once.
  const all: { p: PlayerId; attackers: Permanent[] }[] = [];
  for (const head of plan) {
    const mine = head.ids.map((iid) => findPermanent(d, iid)).filter((a): a is Permanent => !!a && a.controller === head.p && canAttack(a));
    for (const a of mine) if (!hasKw(a, 'vigilance')) tapPermanent(d, a);
    d.attackers = [...d.attackers, ...mine.map((a) => a.iid)];
    const targets = { ...(d.attackTargets ?? {}) };
    for (const [aid, pwIid] of Object.entries(head.pw)) if (mine.some((a) => a.iid === aid) && findPermanent(d, pwIid)) targets[aid] = pwIid;
    if (Object.keys(targets).length) d.attackTargets = targets;
    if (mine.length) log(d, { k: 'attack', p: head.p, cards: mine.map((a) => a.card.name) });
    for (const [aid, pwIid] of Object.entries(head.pw)) {
      const a = findPermanent(d, aid);
      const walker = findPermanent(d, pwIid);
      if (a && walker && mine.includes(a)) log(d, { k: 'attackPlaneswalker', card: a.card.name, pw: walker.card.name });
    }
    all.push({ p: head.p, attackers: mine });
  }
  d.blocks = {};
  for (const { attackers } of all) for (const a of attackers) fireObject(d, 'attacks', a);
  // "Whenever you attack": each player who attacked with at least one creature.
  for (const { p: q, attackers } of all) {
    if (!attackers.length) continue;
    for (const x of d.battlefield) {
      if (x.controller === q) for (const t of triggersOf(x.card)) if (t.event.on === 'youAttack') queueTrigger(d, x, q, t.ability);
    }
  }
  if (!d.attackers.length) {
    d.step = 'main2';
    return;
  }
  // The attacking team gets priority first.
  openWindow(d, 'attack', d.active, 0);
}

function setBlocks(d: GameState, blocks: Record<string, string[]>) {
  delete d.declaring;
  delete d.pendingBlocks;
  d.blocks = blocks;
  askDamageOrder(d);
}

/** The next defending head (not in `done`) with a creature that could block an attacker. */
function nextBlocker(d: GameState, done: PlayerId[]): PlayerId | undefined {
  const attackers = d.attackers.map((iid) => findPermanent(d, iid)!).filter(Boolean);
  const used = new Set(Object.values(d.pendingBlocks ?? {}).flat());
  return opponentsOf(d, d.active).find((q) => !done.includes(q) && creaturesOf(d, q).some((b) => !used.has(b.iid) && attackers.some((a) => canBlock(b, a))));
}

/**
 * Each attacker blocked by several creatures: its controller orders the blockers (damage goes to
 * each in turn, lethal damage first). Then the block window opens.
 */
function askDamageOrder(d: GameState) {
  const aid = Object.keys(d.blocks).find((a) => d.blocks[a].length > 1 && !d.ordered?.includes(a));
  if (!aid) {
    delete d.ordered;
    return openWindow(d, 'block', d.active, 0);
  }
  d.ordered = [...(d.ordered ?? []), aid];
  const attacker = findPermanent(d, aid)!;
  d.pending = {
    choice: {
      kind: 'arrange', player: attacker.controller, purpose: 'damageOrder', zones: ['top'],
      cards: d.blocks[aid].map((iid) => findPermanent(d, iid)!), params: { card: attacker.card.name },
    },
    resume: 'damageOrder',
    iid: aid,
  };
}

/**
 * Puts an ability on the stack (for triggered and activated abilities). Its source stays where
 * it is; the ability resolves like a spell, with the same effects. Both players then get priority.
 */
export function addAbility(state: GameState, source: CardInst, controller: PlayerId, spec: AbilitySpec, targets: Target[][] = []): GameState {
  const d = structuredClone(state);
  const n = d.stack.length + d.log.length;
  d.stack.push({ iid: `${source.iid}-ability-${n}`, card: source.card, controller, targets, ability: spec, source: source.iid });
  if (d.priority) {
    d.priority.passes = 0;
    d.priority.player = d.active;
    settle(d);
  } else {
    openWindow(d, 'main', d.active, 0);
  }
  return d;
}

// ---------- Actions ----------

export function apply(state: GameState, action: Action): GameState {
  if (state.winner !== null) throw new IllegalAction('gameOver');
  const d = structuredClone(state);
  // Malcolm: the free cast is now or never.
  if (d.castNow && !(action.type === 'cast' && action.iid === d.castNow.iid)) delete d.castNow;

  if (action.type === 'concede') {
    // A player conceding makes their whole team lose.
    teamLoses(d, action.player);
    log(d, { k: 'concede', p: action.player });
    return d;
  }
  if (action.type === 'setFullControl') {
    d.fullControl = [...(d.fullControl ?? d.players.map(() => false))];
    d.fullControl[action.player] = action.on;
    return d;
  }

  const p = actor(d)!;
  const me = d.players[p];

  if (d.mulligan && action.type !== 'mulligan' && action.type !== 'keep') {
    throw new IllegalAction('keepFirst');
  }
  if (d.pending && action.type !== 'choose') throw new IllegalAction('makeChoiceFirst');

  switch (action.type) {
    case 'mulligan': {
      const m = d.mulligan;
      if (!m) throw new IllegalAction('notMulliganTime');
      if (m.count[p] >= 7) throw new IllegalAction('noMoreMulligans');
      m.count[p]++;
      me.library = shuffle([...me.library, ...me.hand], () => random(d));
      me.hand = [];
      draw(d, p, 7);
      log(d, { k: 'mulligan', p, keeping: 7 - mulliganBottom(d, p) });
      break;
    }

    case 'keep': {
      const m = d.mulligan;
      if (!m) throw new IllegalAction('notMulliganTime');
      const need = mulliganBottom(d, p);
      const bottom = [...new Set(action.bottom ?? [])];
      if (bottom.length !== need) throw new IllegalAction('chooseBottom', { n: need });
      for (const iid of bottom) {
        const inst = me.hand.find((c) => c.iid === iid);
        if (!inst) throw new IllegalAction('notInHand');
        me.hand = me.hand.filter((c) => c !== inst);
        me.library.push(inst);
      }
      m.kept[p] = true;
      log(d, { k: 'keep', p, n: me.hand.length });
      // Players decide one after the other, in turn order.
      const next = turnOrder(d).find((q) => !m.kept[q]);
      if (next !== undefined) {
        m.player = next;
      } else {
        d.mulligan = null;
        openingHandPermanents(d);
      }
      break;
    }

    case 'choose': {
      const pending = d.pending;
      if (!pending) throw new IllegalAction('nothingToChoose');
      validateAnswer(pending.choice, action.answer);
      d.pending = null;
      if (pending.resume === 'cleanup' && action.answer.kind === 'cards') finishCleanup(d, pending.choice.player, action.answer.iids);
      else if (pending.resume === 'triggerMode' && action.answer.kind === 'mode') {
        const t = pending.trigger!;
        stackTrigger(d, { ...t, ability: chosenModes(t.ability, action.answer.modes) });
      } else if (pending.resume === 'trigger' && action.answer.kind === 'targets') {
        const t = pending.trigger!;
        pushAbility(d, t, checkTargets(d, t.controller, t.source.card, t.ability, action.answer.targets, t.source.iid));
      } else if (pending.resume === 'legend' && action.answer.kind === 'cards') {
        const keep = action.answer.iids[0];
        for (const opt of (pending.choice as { options: CardInst[] }).options) {
          const perm = findPermanent(d, opt.iid);
          if (perm && perm.iid !== keep) {
            removePermanent(d, perm, 'graveyard');
            log(d, { k: 'legendRule', card: perm.card.name });
          }
        }
      } else if (pending.resume === 'chosenPlayer' && action.answer.kind === 'mode') {
        const perm = findPermanent(d, pending.iid!);
        const chosen = String(pending.choice.params?.players ?? '').split(',').map(Number)[action.answer.modes[0]];
        if (perm && chosen !== undefined) {
          perm.chosenPlayer = chosen as PlayerId;
          log(d, { k: 'chosenPlayer', card: perm.card.name, p: chosen as PlayerId });
        }
      } else if (pending.resume === 'basicType' && action.answer.kind === 'mode') {
        const perm = findPermanent(d, pending.iid!);
        const type = BASIC_LAND_TYPES[action.answer.modes[0]];
        if (perm && type) {
          perm.chosenType = type;
          perm.printed ??= perm.card;
          perm.card = { ...perm.card, typeLine: `${perm.card.typeLine.split(' — ')[0]} — ${type}` };
          log(d, { k: 'chosenType', card: perm.card.name, type });
        }
      } else if (pending.resume === 'cardName' && action.answer.kind === 'mode') {
        const perm = findPermanent(d, pending.iid!);
        const name = (pending.choice as { modes: string[] }).modes[action.answer.modes[0]];
        if (perm && name) {
          perm.chosenName = name;
          log(d, { k: 'chosenName', card: perm.card.name, name });
        }
      } else if (pending.resume === 'creatureType' && action.answer.kind === 'mode') {
        const perm = findPermanent(d, pending.iid!);
        const type = (pending.choice as { modes: string[] }).modes[action.answer.modes[0]];
        if (perm && type) {
          perm.chosenType = type;
          log(d, { k: 'chosenType', card: perm.card.name, type });
        }
      } else if (pending.resume === 'crew' && action.answer.kind === 'cards') {
        const crew = action.answer.iids.map((iid) => findPermanent(d, iid)!);
        const n = Number(pending.choice.params?.n ?? 0);
        const item = pending.activation!.item;
        if (crew.reduce((sum, x) => sum + powerOf(x), 0) < n) throw new IllegalAction('notEnoughCrew', { card: item.card.name, n });
        for (const x of crew) tapPermanent(d, x);
        log(d, { k: 'crewed', card: item.card.name });
        finishActivation(d, item, pending.activation!.named);
      } else if (pending.resume === 'payLife' && action.answer.kind === 'yesNo') {
        const perm = findPermanent(d, pending.iid!);
        const n = Number(pending.choice.params?.n ?? 0);
        if (perm && action.answer.yes) {
          perm.tapped = false;
          changeLife(d, perm.controller, -n);
        }
        if (perm) log(d, { k: 'shock', card: perm.card.name, paid: action.answer.yes ? n : 0 });
      } else if (pending.resume === 'damageOrder' && action.answer.kind === 'arrange') {
        d.blocks[pending.iid!] = action.answer.zones.top ?? d.blocks[pending.iid!];
        askDamageOrder(d);
      } else if (pending.resume === 'gemstoneCaverns' && action.answer.kind === 'cards') {
        const ps = d.players[p];
        const picked = action.answer.iids[0];
        const exiled = ps.hand.find((c) => c.iid === picked && c.iid !== pending.iid);
        const caverns = ps.hand.find((c) => c.iid === pending.iid);
        if (exiled && caverns) {
          ps.hand = ps.hand.filter((c) => c !== exiled && c !== caverns);
          ps.exile.push(exiled);
          log(d, { k: 'beginsOnBattlefield', p, card: caverns.card.name });
          log(d, { k: 'exiledCard', card: exiled.card.name, from: 'hand' });
          enterBattlefield(d, caverns, p).counters.luck = 1;
        }
        askGemstoneCaverns(d);
      } else if (pending.resume === 'discardLandInstead' && action.answer.kind === 'cards') {
        const item = pending.activation!.item;
        const picked = action.answer.iids[0];
        const land = d.players[p].hand.find((c) => c.iid === picked && isLand(c.card));
        if (land) {
          moveToGraveyard(d, p, land, 'hand');
          log(d, { k: 'discard', p, card: land.card.name });
          resolvePermanentSpell(d, item, pending.reason ?? 'main', true);
        } else {
          putAwaySpell(d, item, false);
          log(d, { k: 'declined', card: item.card.name });
          afterResolving(d, pending.reason ?? 'main');
        }
      } else if (pending.resume === 'clone' && action.answer.kind === 'cards') {
        const item = pending.activation!.item;
        const model = action.answer.iids[0] ? findPermanent(d, action.answer.iids[0]) : undefined;
        const own = castCard(item);
        let copy = model ? { ...(printedCard(model)), id: model.card.id } : own;
        // Mockingbird: "except it's a Bird in addition to its other types and it has flying".
        if (model && entersAsBirdCopy(own)) {
          const [types, subtypes] = copy.typeLine.split(' // ')[0].split(' — ');
          copy = {
            ...copy, typeLine: `${types} — ${[subtypes, 'Bird'].filter(Boolean).join(' ')}`,
            keywords: [...new Set([...(copy.keywords ?? []), 'Flying'])], oracleText: `Flying\n${copy.oracleText}`,
          };
        }
        log(d, { k: 'enters', card: own.name });
        if (model) log(d, { k: 'copied', card: own.name, as: model.card.name });
        const perm = enterBattlefield(d, { iid: item.iid, card: copy, ...(item.commander ? { commander: true } : {}) }, item.controller, { x: item.x });
        if (model) perm.printed = item.card;
        afterResolving(d, pending.reason ?? 'main');
      } else if (pending.resume === 'castCost' && action.answer.kind === 'yesNo') {
        // "A or B": the caster chose which one to pay.
        const { item, named } = pending.activation!;
        const extra = castInfo(item.card, item.face ?? 0).additional;
        const chosen = extra?.kind === 'either' ? extra.options[action.answer.yes ? 0 : 1] : undefined;
        if (!chosen || !payExtraCost(d, p, chosen, item, named)) finishCast(d, item, named);
      } else if (pending.resume === 'castCost' && action.answer.kind === 'cards' && ['returnLandCost', 'exileFromHandCost', 'returnCreatureCost'].includes(pending.choice.purpose)) {
        // An alternative cost: an Island (or a tapped creature) back to its owner's hand, or a card exiled from the hand.
        const picked = action.answer.iids[0];
        if (pending.choice.purpose === 'exileFromHandCost') {
          for (const iid of action.answer.iids) {
            const inst = d.players[p].hand.find((c) => c.iid === iid)!;
            d.players[p].hand = d.players[p].hand.filter((c) => c !== inst);
            d.players[p].exile.push(inst);
            log(d, { k: 'exiledCard', card: inst.card.name, from: 'hand' });
          }
        } else {
          const perm = findPermanent(d, picked)!;
          d.battlefield = d.battlefield.filter((x) => x !== perm);
          returnExiledUntil(d, perm);
          if (!isToken(printedCard(perm))) putInZone(d, perm.owner ?? perm.controller, { iid: perm.iid, card: printedCard(perm) }, 'hand');
          log(d, { k: 'bounced', card: perm.card.name });
        }
        const { item, named } = pending.activation!;
        const extra = castInfo(item.card, item.face ?? 0).additional;
        if (!extra || !payExtraCost(d, p, extra, item, named)) finishCast(d, item, named);
      } else if (pending.resume === 'castCost' && action.answer.kind === 'cards') {
        if (pending.choice.purpose === 'exileCost') {
          for (const iid of action.answer.iids) {
            const inst = d.players[p].graveyard.find((c) => c.iid === iid)!;
            d.players[p].graveyard = d.players[p].graveyard.filter((c) => c !== inst);
            d.players[p].exile.push(inst);
            log(d, { k: 'exiledCard', card: inst.card.name });
          }
        } else if (pending.choice.purpose === 'discardCost') {
          for (const iid of action.answer.iids) {
            const inst = d.players[p].hand.find((c) => c.iid === iid)!;
            moveToGraveyard(d, p, inst, 'hand');
            log(d, { k: 'discard', p, card: inst.card.name });
          }
        } else sacrifice(d, findPermanent(d, action.answer.iids[0])!);
        finishCast(d, pending.activation!.item, pending.activation!.named);
      } else if (pending.resume === 'activation' && action.answer.kind === 'cards' && pending.choice.purpose === 'exileCost') {
        // Moorland Haunt: the card exiled from the graveyard as a cost.
        const picked = action.answer.iids[0];
        const inst = me.graveyard.find((c) => c.iid === picked)!;
        me.graveyard = me.graveyard.filter((c) => c !== inst);
        me.exile.push(inst);
        log(d, { k: 'exiledCard', card: inst.card.name });
        finishActivation(d, pending.activation!.item, pending.activation!.named);
      } else if (pending.resume === 'activation' && action.answer.kind === 'cards') {
        sacrifice(d, findPermanent(d, action.answer.iids[0])!);
        finishActivation(d, pending.activation!.item, pending.activation!.named);
      } else continueResolving(d, action.answer);
      break;
    }

    case 'playLand': {
      if (d.priority || !isMainStep(d) || !isActivePlayer(d, p)) throw new IllegalAction('landTiming');
      if (me.landPlayed) throw new IllegalAction('landAlreadyPlayed');
      const inst = me.hand.find((c) => c.iid === action.iid);
      const face = action.face ?? 0;
      if (!inst || !landFaces(inst.card).includes(face)) throw new IllegalAction('notALand');
      const land = faceCard(inst.card, face);
      me.hand = me.hand.filter((c) => c !== inst);
      me.landPlayed = true;
      log(d, { k: 'playLand', p, card: land.name });
      const perm = enterBattlefield(d, { iid: inst.iid, card: land }, p);
      if (land !== inst.card) perm.printed = inst.card;
      // City of Traitors: "When you play another land, …"
      for (const x of d.battlefield) {
        if (x.controller !== p || x.iid === perm.iid) continue;
        for (const t of triggersOf(x.card)) if (t.event.on === 'youPlayLand') queueTrigger(d, x, p, t.ability);
      }
      break;
    }

    case 'cast': {
      const src = castSource(d, p, action.iid);
      const face = action.face ?? 0;
      if (!src || (src.from !== 'hand' && face) || !(src.from === 'hand' ? playableFaces(src.inst.card) : [0]).includes(face)) {
        throw new IllegalAction('notASpell');
      }
      const { inst, from } = src;
      const card = faceCard(inst.card, face);
      if (isLandCard(card)) throw new IllegalAction('notASpell');
      if (castingForbidden(d, p)) throw new IllegalAction('castingForbidden');
      if (spellNameStopped(d, inst.card.name)) throw new IllegalAction('nameStopped');
      // Malcolm: cast right away, whatever the timing.
      const castNow = d.castNow?.player === p && d.castNow.iid === inst.iid;
      if (castNow) {
        // no timing restriction
      } else if (inst.castFor?.sorcery && !castTimingFor(d, p, inst, card)) {
        throw new IllegalAction('castTiming');
      } else if (d.priority) {
        if (sorceryOnly(d, p)) throw new IllegalAction('sorceryOnly');
        if (!castTimingOk(d, p, card)) throw new IllegalAction('sorcerySpeed', { card: card.name });
      } else if (!isMainStep(d) || !isActivePlayer(d, p)) {
        throw new IllegalAction('castTiming');
      }
      const info = castInfo(inst.card, face);
      const altIndex = action.alt !== undefined && info.alts[action.alt] ? action.alt : undefined;
      const alt = altIndex === undefined ? undefined : info.alts[altIndex];
      if (alt) {
        const problem = altCostProblem(d, p, alt, inst.iid, from);
        if (problem) throw new IllegalAction(problem as GameErrorCode, { card: card.name });
      }
      const kicked = !!action.kicked && !!info.kicker && !alt;
      const modes = info.modal ? [...new Set(action.modes ?? [])] : undefined;
      if (modes && (modes.length < Math.max(1, info.modal!.min) || modes.length > info.modal!.max || modes.some((m) => !Number.isInteger(m) || m < 0 || m >= info.modal!.modes.length))) {
        throw new IllegalAction('badModes', { card: card.name });
      }

      const x = xCount(card) ? (action.x ?? 0) : 0;
      if (!Number.isInteger(x) || x < 0) throw new IllegalAction('badX');
      const spec = castSpec(inst.card, { face, modes, kicked, alt: altIndex, x });
      const chosen = action.targets ?? (action.target ? [[action.target]] : []);
      const targets = checkTargets(d, p, card, spec, chosen);
      // A permanent can't skip a cost the engine doesn't understand (an instant or sorcery is cast "not simulated").
      if (info.unknownCost && !isInstantOrSorcery(card)) throw new IllegalAction('costNotSimulated', { card: card.name });
      // Additional costs that need something to pay with. "A or B": the ones that can be paid.
      let extra = info.additional;
      if (extra?.kind === 'either') {
        const payable = extra.options.filter((o) => !extraCostProblem(d, p, o, inst.iid, card.name));
        if (!payable.length) throw extraCostProblem(d, p, extra.options[0], inst.iid, card.name)!;
        if (payable.length === 1) extra = payable[0];
      } else if (extra) {
        const problem = extraCostProblem(d, p, extra, inst.iid, card.name);
        if (problem) throw problem;
      }

      // March of Otherworldly Light: cards of its color exiled from the hand, {2} less each.
      const discountColor = info.exileDiscount?.color;
      const exiled = discountColor && action.exiled ? action.exiled : 0;
      if (exiled && me.hand.filter((c) => c.iid !== inst.iid && cardColors(c.card).includes(discountColor!)).length < exiled) throw new IllegalAction('noCardToExile', { card: card.name });
      const plan = planPayment(chosenSources(castSources(d, p, inst.card, inst.iid, face), action.pay), castCost(d, p, inst.card, { face, kicked, from, iid: inst.iid, alt: altIndex, exiled, ...(modes ? { modes } : {}) }, x));
      if (!plan) throw unpaid(action.pay, card.name);
      // Cavern of Souls' mana spent on a creature spell of the chosen type: it can't be countered.
      // Delighted Halfling's mana spent on a legendary spell: the same (counted for any of its mana).
      const uncounterable = plan.some((m) => {
        if (m.iid.startsWith('pool:')) {
          const entry = me.pool?.[Number(m.iid.slice(5))];
          return (!!entry?.forType && ofType(card, entry.forType.type)) || (!!entry?.forLegendary && isLegendary(card));
        }
        const src = findPermanent(d, m.iid);
        if (src && legendaryMana(src.card) && isLegendary(card)) return true;
        return !!src?.chosenType && !!chosenTypeMana(src.card) && ofType(card, src.chosenType);
      });
      payMana(d, p, plan);
      // Creatures tapped for convoke and cards exiled for delve aren't mana.
      const noMana = plan.every((m) => /^(?:convoke|delve):/.test(m.iid));
      if (from === 'hand') me.hand = me.hand.filter((c) => c.iid !== inst.iid);
      else if (from === 'graveyard') me.graveyard = me.graveyard.filter((c) => c.iid !== inst.iid);
      else if (from === 'command') {
        me.command = me.command!.filter((c) => c.iid !== inst.iid);
        me.commanderCasts = { ...me.commanderCasts, [inst.iid]: (me.commanderCasts?.[inst.iid] ?? 0) + 1 };
      } else if (from === 'prepared') {
        // "Doing so unprepares it": the copy is a new object on the stack.
        findPermanent(d, inst.iid)!.prepared = false;
        d.abilities = (d.abilities ?? 0) + 1;
      } else me.exile = me.exile.filter((c) => c.iid !== inst.iid);
      const named = targets.flat().map((t) => targetName(d, t));
      const item: StackItem = {
        iid: from === 'prepared' ? `${inst.iid}-prepared-${d.abilities}` : inst.iid, card: inst.card, ...(from === 'prepared' ? { copy: true } : {}), controller: p, targets, ...(xCount(card) ? { x } : {}),
        ...(face ? { face } : {}), ...(modes ? { modes } : {}), ...(kicked ? { kicked } : {}), ...(from !== 'hand' ? { from } : {}),
        ...(inst.commander ? { commander: true } : {}), ...(noMana ? { noMana } : {}), ...(uncounterable ? { uncounterable } : {}),
        ...(altIndex !== undefined ? { alt: altIndex } : {}), ...(castNow ? { castNow } : {}),
      };
      delete d.castNow;
      if (alt && payAltCost(d, p, alt, item, named)) break;
      if (exiled) {
        const options = me.hand.filter((c) => cardColors(c.card).includes(discountColor!));
        d.pending = { choice: { kind: 'cards', player: p, purpose: 'exileFromHandCost', min: exiled, max: exiled, options, params: { card: card.name, n: exiled } }, resume: 'castCost', activation: { item, named } };
        break;
      }
      if (extra && payExtraCost(d, p, extra, item, named)) break;
      finishCast(d, item, named);
      break;
    }

    case 'cycle': {
      const inst = me.hand.find((c) => c.iid === action.iid);
      const cycling = inst && castInfo(inst.card).cycling;
      if (!inst || !cycling) throw new IllegalAction('cannotCycle');
      if (!d.priority && !(isMainStep(d) && isActivePlayer(d, p))) throw new IllegalAction('activateTiming');
      if (!pay(d, p, chosenSources(manaSources(d, p), action.pay), parseCost(cycling.cost))) throw unpaid(action.pay, inst.card.name);
      me.hand = me.hand.filter((c) => c !== inst);
      putInZone(d, p, inst, 'graveyard');
      log(d, { k: 'cycle', p, card: inst.card.name });
      const ability: AbilitySpec = cycling.search
        ? { targets: [], effects: [{ kind: 'search', n: 1, filter: cycling.search, dest: 'hand', tapped: false }] }
        : { targets: [], effects: [{ kind: 'draw', n: 1, to: 'you' }] };
      d.abilities = (d.abilities ?? 0) + 1;
      d.stack.push({ iid: `${inst.iid}-cycle-${d.abilities}`, card: inst.card, controller: p, targets: [], ability });
      if (d.priority) {
        d.priority.passes = 0;
        d.priority.player = nextPlayer(d, p);
      } else {
        openWindow(d, 'main', nextPlayer(d, p), 0);
      }
      break;
    }

    case 'channel': {
      const inst = me.hand.find((c) => c.iid === action.iid);
      const channel = inst && castInfo(inst.card).channel;
      if (!inst || !channel) throw new IllegalAction('noSuchAbility');
      if (nameStopped(d, inst.card.name)) throw new IllegalAction('nameStopped');
      if (!d.priority && !(isMainStep(d) && isActivePlayer(d, p))) throw new IllegalAction('activateTiming');
      const targets = checkTargets(d, p, inst.card, channel.ability, action.targets ?? []);
      if (!pay(d, p, chosenSources(manaSources(d, p), action.pay), channelCost(d, p, inst.card)!)) throw unpaid(action.pay, inst.card.name);
      me.hand = me.hand.filter((c) => c !== inst);
      putInZone(d, p, inst, 'graveyard');
      d.abilities = (d.abilities ?? 0) + 1;
      // An ability with no effects (Boseiju) still goes on the stack, and resolves "not simulated".
      finishActivation(d, { iid: `${inst.iid}-channel-${d.abilities}`, card: inst.card, controller: p, targets, ability: channel.ability }, targets.flat().map((t) => targetName(d, t)));
      break;
    }

    case 'activate': {
      const perm = findPermanent(d, action.iid);
      if (!perm) throw new IllegalAction('noSuchAbility');
      const spec = activatedOf(perm.card)[action.index];
      const x = spec?.cost.mana.includes('{X}') ? (action.x ?? 0) : 0;
      if (!Number.isInteger(x) || x < 0) throw new IllegalAction('badX');
      const problem = activationProblem(d, p, perm, action.index, x);
      if (problem) throw new IllegalAction(problem, { card: perm.card.name });
      const targets = checkTargets(d, p, perm.card, spec.ability, action.targets ?? []);

      const first = targets[0]?.[0];
      const equipped = spec.equip && first?.kind === 'permanent' ? findPermanent(d, first.iid) : undefined;
      if (!pay(d, p, chosenSources(sourcesFor(d, perm, spec), action.pay), abilityCost(d, perm, spec, x, equipped))) throw unpaid(action.pay, perm.card.name);
      if (spec.equip) me.equipsThisTurn = (me.equipsThisTurn ?? 0) + 1;
      if (spec.cost.tap) tapPermanent(d, perm);
      if (spec.cost.life) changeLife(d, p, -spec.cost.life);
      if (spec.once || spec.cost.loyalty !== undefined) perm.used = [...(perm.used ?? []), action.index];
      if (spec.cost.loyalty !== undefined) {
        perm.counters = { ...perm.counters, loyalty: (perm.counters.loyalty ?? 0) + spec.cost.loyalty };
        log(d, { k: 'loyalty', card: perm.card.name, n: spec.cost.loyalty });
      }
      const named = targets.flat().map((t) => targetName(d, t));
      d.abilities = (d.abilities ?? 0) + 1;
      const item: StackItem = {
        iid: `${perm.iid}-ability-${d.abilities}`, card: perm.card, controller: p, targets, ability: spec.ability, source: perm.iid,
        ...(spec.cost.mana.includes('{X}') ? { x } : {}),
      };
      if (spec.cost.crew !== undefined) {
        // Crew N: the player picks the creatures to tap.
        const options = crewOptions(d, perm);
        d.pending = {
          choice: { kind: 'cards', player: p, purpose: 'crewCost', min: 1, max: options.length, options, params: { card: perm.card.name, n: spec.cost.crew } },
          resume: 'crew',
          activation: { item, named },
        };
        break;
      }
      // Parallax Wave: "Remove a fade counter from this enchantment".
      const removed = spec.cost.removeCounter;
      if (removed) perm.counters = { ...perm.counters, [removed]: (perm.counters[removed] ?? 1) - 1 };
      if (spec.cost.exileFromGraveyard) {
        // Moorland Haunt: the rest of the cost is paid; the player now picks the card to exile.
        const options = me.graveyard.filter((c) => cardMatches(c.card, spec.cost.exileFromGraveyard!));
        d.pending = {
          choice: { kind: 'cards', player: p, purpose: 'exileCost', min: 1, max: 1, options, params: { card: perm.card.name, n: 1 } },
          resume: 'activation',
          activation: { item, named },
        };
        break;
      }
      if (spec.cost.sacrifice) {
        // The rest of the cost is paid; the player now picks what to sacrifice.
        d.pending = {
          choice: { kind: 'cards', player: p, purpose: 'sacrificeCost', min: 1, max: 1, options: sacrificeOptions(d, perm, spec), params: { card: perm.card.name } },
          resume: 'activation',
          activation: { item, named },
        };
        if (spec.cost.sacrificeSelf) sacrifice(d, perm);
        break;
      }
      if (spec.cost.sacrificeSelf) sacrifice(d, perm);
      finishActivation(d, item, named);
      break;
    }

    case 'tapForMana': {
      const perm = findPermanent(d, action.iid);
      if (!perm || perm.controller !== p) throw new IllegalAction('noSuchAbility');
      if (!canTapForMana(d, perm)) throw new IllegalAction(perm.tapped ? 'alreadyTapped' : 'summoningSick', { card: perm.card.name });
      const typed = perm.chosenType ? chosenTypeMana(perm.card) : null;
      const legend = legendaryMana(perm.card);
      // Cavern of Souls, Delighted Halfling: the mana keeps both choices until spent ({C}, or a color for the right spell).
      const units = typed || legend ? [[...new Set([...(unitsOf(d, perm)[0] ?? []), ...(typed ?? legend!)])]] : unitsOf(d, perm);
      const pain = painOf(d, perm);
      const forType = typed ? { type: perm.chosenType!, colors: typed } : undefined;
      d.players[p].pool = [...(d.players[p].pool ?? []), ...units.map((colors) => ({ colors, source: perm.iid, ...(pain ? { pain } : {}), ...(forType ? { forType } : {}), ...(legend ? { forLegendary: legend } : {}) }))];
      tapForManaOnly(d, perm);
      break;
    }

    case 'untapForMana': {
      const perm = findPermanent(d, action.iid);
      if (!perm || !canUntapForMana(d, p, perm)) throw new IllegalAction('manaSpent');
      perm.tapped = false;
      const rest = (d.players[p].pool ?? []).filter((m) => m.source !== perm.iid);
      if (rest.length) d.players[p].pool = rest;
      else delete d.players[p].pool;
      break;
    }

    case 'pass': {
      if (d.priority) {
        passOnce(d);
      } else if ((d.step === 'main1' || d.step === 'main2') && nextHead(d, p) !== undefined) {
        // Two-Headed Giant: the teammate now acts in this main phase.
        d.headsDone = [...(d.headsDone ?? []), p];
        d.turnHead = nextHead(d, p);
      } else if (d.step === 'main1') {
        d.turnHead = d.active;
        delete d.headsDone;
        emptyPools(d);
        // "At the beginning of combat on your turn" (Chandra): the active player gets priority with them on the stack.
        fireStep(d, 'beginCombat');
        if (d.triggered?.length) d.priority = { player: d.active, passes: 0, reason: 'combat' };
        // Skip combat entirely when nothing can attack.
        else if (teamPlayers(d, d.active).some((q) => creaturesOf(d, q).some(canAttack))) openForOpponents(d, 'combat');
        else d.step = 'main2';
      } else if (d.step === 'attack') {
        declareAttacks(d, p, [], {});
      } else if (d.step === 'main2') {
        d.turnHead = d.active;
        delete d.headsDone;
        emptyPools(d);
        // The active team is done; the opponents get an end-of-turn window.
        fireStep(d, 'endStep');
        openForOpponents(d, 'end');
      } else {
        throw new IllegalAction('declareBlockersFirst');
      }
      break;
    }

    case 'declareAttackers': {
      if (d.step !== 'attack' || d.priority) throw new IllegalAction('notAttackStep');
      declareAttacks(d, p, action.attackers, action.targets ?? {});
      break;
    }

    case 'declareBlockers': {
      if (d.step !== 'block' || d.priority) throw new IllegalAction('notBlockStep');
      const used = new Set(Object.values(d.pendingBlocks ?? {}).flat());
      const blocks: Record<string, string[]> = { ...(d.pendingBlocks ?? {}) };
      for (const [aid, bids] of Object.entries(action.blocks)) {
        const a = findPermanent(d, aid);
        if (!a || !d.attackers.includes(aid)) throw new IllegalAction('notAttacking');
        if (!bids.length) continue;
        for (const bid of bids) {
          const b = findPermanent(d, bid);
          if (!b || b.controller !== p || used.has(bid) || !canBlock(b, a)) {
            throw new IllegalAction('cannotBlock', { blocker: b?.card.name ?? '?', attacker: a.card.name });
          }
          used.add(bid);
        }
        blocks[aid] = [...(blocks[aid] ?? []), ...bids];
        // A single defender must block a menace creature with two; teammates may share it.
        if (hasKw(a, 'menace') && blocks[aid].length < 2 && !teammatesOf(d, p).some((q) => nextBlockerIs(d, q, p))) {
          throw new IllegalAction('menace', { card: a.card.name });
        }
      }
      d.pendingBlocks = blocks;
      const next = nextBlocker(d, [...(d.declared ?? []), p]);
      if (next !== undefined) {
        d.declared = [...(d.declared ?? []), p];
        d.declaring = next;
        break;
      }
      delete d.declared;
      // All defenders declared: a menace creature left with one blocker isn't blocked by it.
      for (const [aid, bids] of Object.entries(blocks)) {
        const a = findPermanent(d, aid)!;
        if (hasKw(a, 'menace') && bids.length < 2) delete blocks[aid];
        else log(d, { k: 'blocked', card: a.card.name, by: bids.map((b) => findPermanent(d, b)!.card.name) });
      }
      setBlocks(d, blocks);
      break;
    }
  }

  settle(d);
  return d;
}
