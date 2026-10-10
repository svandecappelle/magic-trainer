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

export type Board = 'main' | 'side';

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
