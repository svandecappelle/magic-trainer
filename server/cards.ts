import { fetchCardsById } from '../src/lib/scryfall';
import type { Card } from '../src/types';
import { DeckCheckError } from './rooms';

/**
 * How decks are checked: "strict" refuses decks when Scryfall can't be reached, "lenient" (default)
 * accepts the client's card data then, "off" never checks.
 */
export type CardCheck = 'strict' | 'lenient' | 'off';

const MAX_CACHE = 20_000;

/**
 * A deck checker backed by Scryfall: every card is looked up by id and replaced by Scryfall's data, so a
 * modified client can't play altered cards. Cards are cached in memory.
 */
export function scryfallDeckCheck(mode: CardCheck, lookup: (ids: string[]) => Promise<Map<string, Card>> = fetchCardsById) {
  const cache = new Map<string, Card>();
  return async (deck: Card[]): Promise<Card[]> => {
    const missing = [...new Set(deck.map((c) => c.id))].filter((id) => !cache.has(id));
    if (missing.length) {
      let found: Map<string, Card>;
      try {
        found = await lookup(missing);
      } catch (e) {
        if (mode === 'strict') throw new DeckCheckError();
        console.warn('Card check skipped, Scryfall unreachable:', (e as Error).message);
        return deck;
      }
      for (const [id, card] of found) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
        cache.set(id, card);
      }
    }
    return deck.map((c) => {
      const trusted = cache.get(c.id);
      if (!trusted) throw new DeckCheckError(c.name);
      return trusted;
    });
  };
}

export function parseCardCheck(value: string | undefined): CardCheck {
  return value === 'strict' || value === 'off' ? value : 'lenient';
}
