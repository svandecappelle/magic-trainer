import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import { auditCard, formatAudit } from './audit';

/**
 * What the engine understands of real decks' cards. A change in the engine that changes how one of these cards is
 * read shows up as a diff of the .audit.txt file: check it, then accept it with `npx vitest run -u`.
 * Add decks with `npm run audit-cards -- <deck or mtgtop8 URL> --save src/lib/engine/fixtures/<name>.json`.
 */
const FIXTURES = ['standard-2026-10', 'standard-wlifegain-2026-10'];

describe('card audit', () => {
  for (const name of FIXTURES) {
    it(`reads the cards of ${name} as before`, async () => {
      const cards = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Card[];
      const reports = cards.filter((c) => !/^Basic Land/.test(c.typeLine)).map(auditCard);
      await expect(formatAudit(reports)).toMatchFileSnapshot(`./fixtures/${name}.audit.txt`);
    });
  }

  it('tells simulated, not simulated and silently ignored lines apart', () => {
    const card = (oracleText: string, typeLine = 'Creature — Test'): Card => ({
      id: 'x', name: 'Tester', manaCost: '{1}', cmc: 1, typeLine, oracleText, colors: [], colorIdentity: [], setCode: 't', setName: 'T',
      rarity: 'common', power: '1', toughness: '1', keywords: ['Flying', 'Bushido'],
    });
    expect(auditCard(card('Flying\nWhen this creature enters, draw a card.')).status).toBe('ok');
    expect(auditCard(card('Bushido 1')).lines[0]).toMatchObject({ status: 'notSimulated', how: 'keyword not simulated: bushido' });
    expect(auditCard(card('This creature gets +2/+0 for every seven cards in your graveyard.')).lines[0].status).toBe('unread');
    expect(auditCard(card('Destroy target creature. Its controller loses 3 life.', 'Instant')).status).toBe('none');
    expect(auditCard(card('As an additional cost to cast this spell, behold a Dragon.')).status).toBe('refused');
  });
});
