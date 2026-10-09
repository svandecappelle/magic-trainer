import { describe, expect, it } from 'vitest';
import { formatDeckText, parseDecklist, parseDeckText } from './deckText';
import { createReducer, initialState } from './goldfish';
import { colorPips, manaCurve, primaryType, probAtLeast } from './stats';
import type { Card, Deck, DeckEntry } from '../types';

const card = (name: string, typeLine: string, cmc = 0, manaCost = ''): Card => ({
  id: name, name, typeLine, cmc, manaCost, oracleText: '', colors: [], colorIdentity: [],
  setCode: 'tst', setName: 'Test', rarity: 'common',
});

describe('parseDeckText', () => {
  it('handles Arena format, SB: prefix, sideboard header, and duplicates', () => {
    const lines = parseDeckText(`Deck
4 Lightning Bolt (M11) 149
2x Goblin Guide
Mountain
2 Lightning Bolt
SB: 1 Duress

Sideboard
3 Smash to Smithereens`);
    expect(lines).toEqual([
      { qty: 6, name: 'Lightning Bolt', board: 'main' },
      { qty: 2, name: 'Goblin Guide', board: 'main' },
      { qty: 1, name: 'Mountain', board: 'main' },
      { qty: 1, name: 'Duress', board: 'side' },
      { qty: 3, name: 'Smash to Smithereens', board: 'side' },
    ]);
  });

  it('round-trips through formatDeckText', () => {
    const deck: Deck = {
      id: 'd', name: 'D', format: 'modern', createdAt: 0, updatedAt: 0,
      entries: [
        { card: card('Bolt', 'Instant'), qty: 4, board: 'main' },
        { card: card('Duress', 'Sorcery'), qty: 2, board: 'side' },
      ],
    };
    expect(parseDeckText(formatDeckText(deck))).toEqual([
      { qty: 4, name: 'Bolt', board: 'main' },
      { qty: 2, name: 'Duress', board: 'side' },
    ]);
  });
});

describe('stats', () => {
  it('classifies types using the front face', () => {
    expect(primaryType(card('a', 'Artifact Creature — Golem'))).toBe('Creature');
    expect(primaryType(card('b', 'Basic Land — Forest'))).toBe('Land');
    expect(primaryType(card('c', 'Creature — Elf // Land'))).toBe('Creature');
  });

  it('builds a curve and pip counts from the main deck only', () => {
    const entries: DeckEntry[] = [
      { card: card('x', 'Creature', 2, '{1}{R}'), qty: 4, board: 'main' },
      { card: card('y', 'Instant', 9, '{7}{U}{U}'), qty: 1, board: 'main' },
      { card: card('z', 'Instant', 1, '{W/U}'), qty: 3, board: 'side' },
      { card: card('m', 'Basic Land — Mountain'), qty: 20, board: 'main' },
    ];
    expect(manaCurve(entries)).toEqual([0, 0, 4, 0, 0, 0, 0, 1]);
    expect(colorPips(entries)).toEqual({ W: 0, U: 2, B: 0, R: 4, G: 0 });
  });

  it('computes hypergeometric probabilities', () => {
    expect(probAtLeast(60, 24, 7, 0)).toBeCloseTo(1);
    // Known value: P(>=2 lands in 7 from 24/60) ≈ 0.8573 (checked with Python math.comb)
    expect(probAtLeast(60, 24, 7, 2)).toBeCloseTo(0.8573, 3);
  });
});

describe('goldfish reducer', () => {
  const reducer = createReducer(() => 0.5);
  const cards = Array.from({ length: 40 }, (_, i) => card(`c${i}`, i < 17 ? 'Basic Land' : 'Creature'));

  it('deals 7, handles a London mulligan and bottoming', () => {
    let s = reducer(initialState, { type: 'new', cards, onThePlay: true });
    expect(s.zones.hand).toHaveLength(7);
    expect(s.zones.library).toHaveLength(33);

    s = reducer(s, { type: 'mulligan' });
    expect(s.zones.hand).toHaveLength(7);
    s = reducer(s, { type: 'keep' });
    expect(s.phase).toBe('bottoming');

    const bottomed = s.zones.hand[0].iid;
    s = reducer(s, { type: 'bottom', iid: bottomed });
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe(1);
    expect(s.zones.hand).toHaveLength(6);
    expect(s.zones.library.at(-1)!.iid).toBe(bottomed);
  });

  it('draws on turn 1 when on the draw, untaps and draws on next turn', () => {
    let s = reducer(initialState, { type: 'new', cards, onThePlay: false });
    s = reducer(s, { type: 'keep' });
    expect(s.zones.hand).toHaveLength(8);

    const land = s.zones.hand[0].iid;
    s = reducer(s, { type: 'move', iid: land, to: 'battlefield' });
    s = reducer(s, { type: 'tap', iid: land });
    expect(s.zones.battlefield[0].tapped).toBe(true);

    s = reducer(s, { type: 'nextTurn' });
    expect(s.turn).toBe(2);
    expect(s.zones.battlefield[0].tapped).toBe(false);
    expect(s.zones.hand).toHaveLength(8);
  });
});

describe('parseDecklist', () => {
  it('reads the Arena deck name and strips Moxfield/bracket set markers', () => {
    const parsed = parseDecklist(`About
Name Mono Red

Deck
4 Lightning Bolt (2X2) 117 *F*
2 Counterspell [MH2]
SIDEBOARD:
1 Duress`);
    expect(parsed.name).toBe('Mono Red');
    expect(parsed.lines).toEqual([
      { qty: 4, name: 'Lightning Bolt', board: 'main' },
      { qty: 2, name: 'Counterspell', board: 'main' },
      { qty: 1, name: 'Duress', board: 'side' },
    ]);
  });
});
