import { describe, expect, it } from 'vitest';
import { toCard, type ScryfallCard } from './scryfall';

const base = { set: 'm11', set_name: 'Magic 2011', rarity: 'common' };

describe('toCard', () => {
  it('keeps the English Oracle text and adds printed text for other languages', () => {
    const bolt = toCard({
      ...base, id: 'fr-bolt', name: 'Lightning Bolt', lang: 'fr', printed_name: 'Foudre', printed_type_line: 'Éphémère',
      type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}', cmc: 1,
      image_uris: { small: 'fr-small.jpg', normal: 'fr-normal.jpg' },
    } as ScryfallCard);
    expect(bolt).toMatchObject({
      name: 'Lightning Bolt', typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.',
      lang: 'fr', printedName: 'Foudre', printedTypeLine: 'Éphémère', imageSmall: 'fr-small.jpg',
    });
  });

  it('joins printed face names of split and double-faced cards; English cards get no printed fields', () => {
    const fireIce = toCard({
      ...base, id: 'fi', name: 'Fire // Ice', lang: 'fr', type_line: 'Instant // Instant',
      card_faces: [{ printed_name: 'Feu', printed_type_line: 'Éphémère' }, { printed_name: 'Glace', printed_type_line: 'Éphémère' }],
    } as ScryfallCard);
    expect(fireIce.printedName).toBe('Feu // Glace');
    expect(fireIce.printedTypeLine).toBe('Éphémère // Éphémère');

    const english = toCard({ ...base, id: 'en', name: 'Shock', lang: 'en', type_line: 'Instant' } as ScryfallCard);
    expect(english.lang).toBeUndefined();
    expect(english.printedName).toBeUndefined();
  });
});
