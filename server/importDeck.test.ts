import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDecklist } from '../src/lib/deckText';
import { importDeck, importRoutes, parseDeckUrl } from './importDeck';

/** A fake web: answers by URL. */
function fakeFetch(pages: Record<string, { body: string; type?: string; status?: number }>) {
  const asked: string[] = [];
  const fn = async (url: string) => {
    asked.push(url);
    const page = pages[url];
    if (!page) return new Response('not found', { status: 404 });
    return new Response(page.body, { status: page.status ?? 200, headers: { 'content-type': page.type ?? 'text/plain' } });
  };
  return { fn, asked };
}

describe('deck links', () => {
  it('recognizes mtgtop8, Moxfield and Archidekt deck pages only', () => {
    expect(parseDeckUrl('https://mtgtop8.com/event?e=92361&d=901562&f=EDH')).toEqual({ site: 'mtgtop8', id: '901562', event: '92361', format: 'EDH' });
    expect(parseDeckUrl('https://www.moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA')).toEqual({ site: 'moxfield', id: 'oEWXWHM5eEGMmopExLWRCA' });
    expect(parseDeckUrl('https://archidekt.com/decks/123456/my_deck')).toEqual({ site: 'archidekt', id: '123456' });
    expect(parseDeckUrl('https://evil.example.com/decks/1')).toBeNull();
    expect(parseDeckUrl('https://mtgtop8.com/event?e=1')).toBeNull();
    expect(parseDeckUrl('https://moxfield.com/decks/../../admin')).toBeNull();
    expect(parseDeckUrl('not a link')).toBeNull();
  });

  it('mtgtop8: the MTGO export, its title as the name; a commander format\'s sideboard is the commander', async () => {
    const { fn } = fakeFetch({
      'https://www.mtgtop8.com/mtgo?d=901562': { body: '1 Arbor Elf\n1 Forest\nSideboard\n1 Tifa Lockhart\n' },
      'https://www.mtgtop8.com/event?e=92361&d=901562&f=EDH': { body: '<html><title>Tifa - Francesco Gremes @ mtgtop8.com</title></html>', type: 'text/html' },
    });
    const deck = await importDeck(fn, parseDeckUrl('https://mtgtop8.com/event?e=92361&d=901562&f=EDH')!);
    expect(deck).toMatchObject({ name: 'Tifa - Francesco Gremes', format: 'commander', source: 'mtgtop8' });
    expect(parseDecklist(deck.text).lines).toEqual([
      { qty: 1, name: 'Arbor Elf', board: 'main' }, { qty: 1, name: 'Forest', board: 'main' }, { qty: 1, name: 'Tifa Lockhart', board: 'commander' },
    ]);
  });

  it('Moxfield: commanders, main deck and sideboard; its format', async () => {
    const { fn } = fakeFetch({
      'https://api2.moxfield.com/v3/decks/all/abcdef123': {
        type: 'application/json',
        body: JSON.stringify({
          name: 'Burn', format: 'modern',
          boards: { commanders: { cards: {} }, mainboard: { cards: { a: { quantity: 4, card: { name: 'Lightning Bolt' } } } }, sideboard: { cards: { b: { quantity: 2, card: { name: 'Smash to Smithereens' } } } } },
        }),
      },
    });
    const deck = await importDeck(fn, parseDeckUrl('https://moxfield.com/decks/abcdef123')!);
    expect(deck).toMatchObject({ name: 'Burn', format: 'modern' });
    expect(parseDecklist(deck.text).lines).toEqual([{ qty: 4, name: 'Lightning Bolt', board: 'main' }, { qty: 2, name: 'Smash to Smithereens', board: 'side' }]);
  });

  it('Archidekt: categories (Commander, Sideboard; the Maybeboard left out)', async () => {
    const { fn } = fakeFetch({
      'https://archidekt.com/api/decks/42/': {
        type: 'application/json',
        body: JSON.stringify({
          name: 'Thelon', deckFormat: 3,
          categories: [{ name: 'Commander', includedInDeck: true }, { name: 'Maybeboard', includedInDeck: false }, { name: 'Sideboard', includedInDeck: false }],
          cards: [
            { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Thelon of Havenwood' } } },
            { quantity: 1, categories: ['Ramp'], card: { oracleCard: { name: 'Sol Ring' } } },
            { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Mana Crypt' } } },
            { quantity: 1, categories: ['Sideboard'], card: { oracleCard: { name: 'Naturalize' } } },
          ],
        }),
      },
    });
    const deck = await importDeck(fn, parseDeckUrl('https://archidekt.com/decks/42/thelon')!);
    expect(deck).toMatchObject({ name: 'Thelon', format: 'commander' });
    expect(parseDecklist(deck.text).lines).toEqual([
      { qty: 1, name: 'Thelon of Havenwood', board: 'commander' }, { qty: 1, name: 'Sol Ring', board: 'main' }, { qty: 1, name: 'Naturalize', board: 'side' },
    ]);
  });

  describe('GET /api/import-deck', () => {
    let server: Server;
    let base: string;
    const { fn, asked } = fakeFetch({
      'https://www.mtgtop8.com/mtgo?d=7': { body: '4 Lightning Bolt\n' },
      'https://api2.moxfield.com/v3/decks/all/broken1': { body: 'not json', type: 'application/json' },
      'https://api2.moxfield.com/v3/decks/all/guarded1': { body: '<html>blocked</html>', type: 'text/html', status: 403 },
    });
    beforeAll(async () => {
      const routes = importRoutes({ fetch: fn });
      server = createServer(async (req, res) => {
        if (!(await routes.handle(req, res, new URL(req.url ?? '/', 'http://x')))) res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise((r) => server.close(r));
    });
    const call = async (link: string) => {
      const res = await fetch(`${base}/api/import-deck?url=${encodeURIComponent(link)}`);
      return { status: res.status, json: await res.json() };
    };

    it('answers the deck, or why not', async () => {
      expect(await call('https://www.mtgtop8.com/event?d=7')).toMatchObject({ status: 200, json: { name: 'mtgtop8 7', text: 'Deck\n4 Lightning Bolt\n' } });
      expect(await call('https://example.com/')).toEqual({ status: 400, json: { error: 'unsupportedLink' } });
      expect(await call('https://www.mtgtop8.com/event?d=8')).toEqual({ status: 404, json: { error: 'deckNotFound' } });
      expect(await call('https://moxfield.com/decks/broken1')).toEqual({ status: 502, json: { error: 'sourceUnreachable' } });
      // A site refusing other sites (Moxfield's protection): said so.
      expect(await call('https://moxfield.com/decks/guarded1')).toEqual({ status: 502, json: { error: 'sourceRefused' } });
      // Only the sites themselves were asked, at addresses built from the ids.
      expect(asked.every((u) => u.startsWith('https://www.mtgtop8.com/') || u.startsWith('https://api2.moxfield.com/'))).toBe(true);
    });
  });
});
