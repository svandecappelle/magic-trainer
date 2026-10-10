import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { botAction, fallbackAction } from '../lib/engine/bot';
import { actor, apply, IllegalAction, newGame, type LogEntry, type PlayerId } from '../lib/engine/engine';
import { errorText, LANGS, logText, messagesFor } from './index';

let n = 0;
const card = (p: Partial<Card> & { name: string }): Card => ({
  id: `i${n++}`, manaCost: '', cmc: 0, typeLine: 'Creature', oracleText: '', colors: [], colorIdentity: [],
  setCode: 't', setName: 'T', rarity: 'c', keywords: [], ...p,
});
const mountain = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
const goblin = card({ name: 'Goblin', manaCost: '{R}', cmc: 1, power: '2', toughness: '1', keywords: ['Haste'] });
const bolt = card({ name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracleText: 'Bolt deals 3 damage to any target.' });

/** Log entries from a few complete bot-vs-bot games. */
function sampleLog(): LogEntry[] {
  const deck = [...Array(16).fill(mountain), ...Array(16).fill(goblin), ...Array(8).fill(bolt)];
  const entries: LogEntry[] = [];
  for (let seed = 1; seed <= 3; seed++) {
    let x = seed;
    const rng = () => (x = (x * 16807) % 2147483647) / 2147483647;
    let s = newGame({ decks: [deck, deck], names: ['Alice', 'Bob'], first: 0, rng });
    while (actor(s) !== null) {
      try {
        s = apply(s, botAction(s));
      } catch (e) {
        if (!(e instanceof IllegalAction)) throw e;
        s = apply(s, fallbackAction(s));
      }
    }
    entries.push(...s.log);
  }
  return entries;
}

describe('i18n', () => {
  const log = sampleLog();

  it.each(LANGS)('renders every game log entry in %s from both seats', (lang) => {
    const t = messagesFor(lang);
    expect(new Set(log.map((e) => e.k)).size).toBeGreaterThan(8);
    for (const me of [0, 1] as PlayerId[]) {
      for (const entry of log) {
        const text = logText(t, entry, ['Alice', 'Bob'], me);
        expect(text, JSON.stringify(entry)).toBeTruthy();
        expect(text).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });

  it.each(LANGS)('renders every error code in %s', (lang) => {
    const t = messagesFor(lang);
    const params = { n: 2, card: 'Bolt', kind: 'creature', filter: 'noncreature', blocker: 'A', attacker: 'B', min: 20, max: 250, code: 'ABCDE', message: 'x' };
    for (const code of Object.keys(t.errors) as (keyof typeof t.errors)[]) {
      const text = errorText(t, { code, params });
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/undefined|NaN/);
    }
  });

  it('speaks to the viewer in the second person', () => {
    const en = messagesFor('en');
    const fr = messagesFor('fr');
    const attack: LogEntry = { k: 'attack', p: 0, cards: ['Goblin', 'Ogre'] };
    expect(logText(en, attack, ['Alice', 'Bob'], 0)).toBe('You attack with Goblin and Ogre');
    expect(logText(en, attack, ['Alice', 'Bob'], 1)).toBe('Alice attacks with Goblin and Ogre');
    expect(logText(fr, attack, ['Alice', 'Bob'], 0)).toBe('Vous attaquez avec Goblin et Ogre');
    expect(logText(fr, { k: 'cast', p: 1, card: 'Shock', targetPlayer: 0 }, ['Alice', 'Bob'], 0)).toBe('Bob lance Shock en vous ciblant');
    expect(fr.home.summary(1, 0)).toBe('1 deck · 0 carte unique dans votre collection');
    expect(en.home.summary(1, 0)).toBe('1 deck · 0 unique cards in your collection');
  });
});
