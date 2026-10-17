/** One face of a multi-face card (double-faced, adventure, split). */
export interface CardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  imageSmall?: string;
  imageNormal?: string;
}

/** A card as stored by the app: a slim snapshot of the Scryfall card object. */
export interface Card {
  id: string;
  name: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  oracleText: string;
  colors: string[];
  colorIdentity: string[];
  imageSmall?: string;
  imageNormal?: string;
  priceUsd?: number;
  setCode: string;
  setName: string;
  rarity: string;
  power?: string;
  toughness?: string;
  /** Starting loyalty of a planeswalker. Missing on cards saved before planeswalkers were simulated. */
  loyalty?: string;
  /** Scryfall layout: "normal", "transform", "modal_dfc", "adventure", "split"… Missing on older saved cards. */
  layout?: string;
  /** Faces of a multi-face card, front first. Missing on older saved cards (rebuilt from the joined fields). */
  faces?: CardFace[];
  /** Legality per format ("legal", "banned", "restricted", "not_legal"). Missing on older saved cards. */
  legalities?: Partial<Record<string, string>>;
  /** Keyword abilities, e.g. ["Flying", "Lifelink"]. Missing on cards saved before v0.2. */
  keywords?: string[];
  /**
   * Language of this printing (and of its images), e.g. "fr". Missing means English.
   * name/typeLine/oracleText are always the English (Oracle) text; printed* hold the localized text.
   */
  lang?: string;
  printedName?: string;
  printedTypeLine?: string;
}

/** Where a card is in a deck: main deck, sideboard, or command zone (Commander). */
export type Board = 'main' | 'side' | 'commander';

export interface DeckEntry {
  card: Card;
  qty: number;
  board: Board;
}

export interface Deck {
  id: string;
  name: string;
  format: string;
  entries: DeckEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface CollectionEntry {
  card: Card;
  qty: number;
  foilQty: number;
}

export const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'casual'] as const;
/** The legalities kept from Scryfall: the formats, and Duel Commander's own ban list ("duel"). */
export const LEGALITIES = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'duel'] as const;
