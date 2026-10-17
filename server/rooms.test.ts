import { describe, expect, it, vi } from 'vitest';
import { actor, type GameState } from '../src/lib/engine/engine';
import type { ServerMessage } from '../src/lib/multiplayer/protocol';
import type { Card } from '../src/types';
import { scryfallDeckCheck } from './cards';
import { RoomManager, type Conn } from './rooms';

class FakeConn implements Conn {
  messages: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.messages.push(msg);
  }
  last<T extends ServerMessage['t']>(t: T) {
    return this.messages.filter((m) => m.t === t).at(-1) as Extract<ServerMessage, { t: T }> | undefined;
  }
  get state(): GameState {
    return this.last('state')!.state;
  }
}

const mountain: Card = {
  id: 'm', name: 'Mountain', manaCost: '', cmc: 0, typeLine: 'Basic Land — Mountain', oracleText: '',
  colors: [], colorIdentity: [], setCode: 't', setName: 'T', rarity: 'common',
};
const deck = Array(30).fill(mountain);

function startedRoom() {
  const rooms = new RoomManager({ rng: () => 0.1 }); // seat 0 goes first
  const alice = new FakeConn();
  const bob = new FakeConn();
  rooms.handle(alice, { t: 'create', name: 'Alice', deck });
  const code = alice.last('joined')!.code;
  rooms.handle(bob, { t: 'join', code, name: 'Bob', deck });
  return { rooms, alice, bob, code };
}

function keepBoth({ rooms, alice, bob }: ReturnType<typeof startedRoom>) {
  rooms.handle(alice, { t: 'action', action: { type: 'keep', bottom: [] } });
  rooms.handle(bob, { t: 'action', action: { type: 'keep', bottom: [] } });
}

describe('RoomManager', () => {
  it('starts a game when the second player joins, hiding secret information', () => {
    const { alice, bob } = startedRoom();
    expect(alice.last('joined')!.seat).toBe(0);
    expect(bob.last('joined')!.seat).toBe(1);

    const view = alice.state;
    expect(view.players[0].hand.map((c) => c.card.name)).toContain('Mountain');
    expect(view.players[1].hand).toHaveLength(7);
    expect(view.players[1].hand.every((c) => c.card.name === 'Hidden card')).toBe(true);
    expect(view.players[0].library.every((c) => c.card.name === 'Hidden card')).toBe(true);
    expect(bob.state.players[0].hand.every((c) => c.card.name === 'Hidden card')).toBe(true);
    expect(view.seed).toBe(0); // the shuffle seed would reveal future draws
  });

  it('only lets the acting player act, and broadcasts the result', () => {
    const room = startedRoom();
    const { rooms, alice, bob } = room;
    expect(actor(alice.state)).toBe(0);

    rooms.handle(bob, { t: 'action', action: { type: 'keep', bottom: [] } });
    expect(bob.last('error')!.code).toBe('notYourTurn');
    keepBoth(room);
    expect(alice.state.turn).toBe(1);

    const land = alice.state.players[0].hand[0].iid;
    rooms.handle(alice, { t: 'action', action: { type: 'playLand', iid: land } });
    expect(alice.state.battlefield).toHaveLength(1);
    expect(bob.state.battlefield).toHaveLength(1);

    rooms.handle(alice, { t: 'action', action: { type: 'playLand', iid: alice.state.players[0].hand[0].iid } });
    expect(alice.last('error')!.code).toBe('landAlreadyPlayed');
  });

  it('lets either player toggle full control at any time, for their own seat only', () => {
    const { rooms, bob } = startedRoom();
    rooms.handle(bob, { t: 'action', action: { type: 'setFullControl', player: 0, on: true } });
    expect(bob.last('error')).toBeUndefined();
    expect(bob.state.fullControl).toEqual([false, true]);
  });

  it('lets a player reconnect to their seat with the token', () => {
    const { rooms, alice, code } = startedRoom();
    const token = alice.last('joined')!.token;
    rooms.disconnect(alice);

    const again = new FakeConn();
    rooms.handle(again, { t: 'rejoin', code, token });
    expect(again.last('joined')!.seat).toBe(0);
    expect(again.state.players[0].hand).toHaveLength(7);

    const stranger = new FakeConn();
    rooms.handle(stranger, { t: 'rejoin', code, token: 'nope' });
    expect(stranger.last('error')!.lostRoom).toBe(true);
  });

  it('concedes when leaving mid-game and rematches when both agree', () => {
    const { rooms, alice, bob } = startedRoom();
    rooms.handle(alice, { t: 'action', action: { type: 'concede', player: 1 } }); // player is forced to the sender
    expect(bob.state.winner).toBe(1);

    rooms.handle(alice, { t: 'rematch' });
    expect(bob.last('lobby')!.players[0].wantsRematch).toBe(true);
    rooms.handle(bob, { t: 'rematch' });
    expect(bob.state.winner).toBeNull();

    rooms.handle(bob, { t: 'leave' });
    expect(alice.state.winner).toBe(0);
    expect(alice.last('lobby')!.players[1].connected).toBe(false);
  });

  it('rejects bad input', () => {
    const rooms = new RoomManager();
    const c = new FakeConn();
    rooms.handle(c, { t: 'create', name: 'A', deck: [mountain] });
    expect(c.last('error')).toMatchObject({ code: 'deckSize', params: { min: 20, max: 250 } });
    rooms.handle(c, { t: 'join', code: 'ZZZZZ', name: 'A', deck });
    expect(c.last('error')).toMatchObject({ code: 'noRoom', params: { code: 'ZZZZZ' } });
    rooms.handle(c, { t: 'hack' });
    expect(c.last('error')!.code).toBe('unknownMessage');
    rooms.handle(c, null);
    expect(c.last('error')!.code).toBe('unknownMessage');
  });
});

describe('deck check', () => {
  const trusted: Card = { ...mountain, oracleText: '({T}: Add {R}.)', setName: 'Trusted' };
  const lookup = async (ids: string[]) => new Map(ids.filter((id) => id === 'm').map((id) => [id, trusted]));

  it('replaces client card data with trusted data, and refuses unknown cards', async () => {
    const rooms = new RoomManager({ verifyDeck: scryfallDeckCheck('lenient', lookup) });
    const alice = new FakeConn();
    await rooms.handle(alice, { t: 'create', name: 'Alice', deck: deck.map((c) => ({ ...c, oracleText: 'Draw seven cards.' })) });
    const code = alice.last('joined')!.code;
    expect(rooms.rooms.get(code)!.seats[0].deck[0].setName).toBe('Trusted');
    const bob = new FakeConn();
    const fake = { ...mountain, id: 'forged', name: 'Black Lotus' };
    await rooms.handle(bob, { t: 'join', code, name: 'Bob', deck: [...deck.slice(1), fake] });
    expect(bob.last('error')).toMatchObject({ code: 'invalidCard', params: { card: 'Black Lotus' } });
  });

  it('accepts decks when Scryfall is unreachable, unless strict', async () => {
    const down = async (): Promise<Map<string, Card>> => { throw new Error('offline'); };
    const lenient = new RoomManager({ verifyDeck: scryfallDeckCheck('lenient', down) });
    const a = new FakeConn();
    const warn = console.warn;
    console.warn = () => {};
    await lenient.handle(a, { t: 'create', name: 'A', deck });
    console.warn = warn;
    expect(a.last('joined')).toBeDefined();
    const strict = new RoomManager({ verifyDeck: scryfallDeckCheck('strict', down) });
    const b = new FakeConn();
    await strict.handle(b, { t: 'create', name: 'B', deck });
    expect(b.last('error')).toMatchObject({ code: 'cardCheckFailed' });
  });

  it('keeps faces and loyalty of the cards a client sends', () => {
    const rooms = new RoomManager();
    const alice = new FakeConn();
    const walker = { ...mountain, id: 'w', name: 'Walker', typeLine: 'Planeswalker', loyalty: '4', layout: 'modal_dfc', faces: [{ name: 'A', manaCost: '', typeLine: 'Land', oracleText: '' }] };
    rooms.handle(alice, { t: 'create', name: 'Alice', deck: [...deck.slice(1), walker] });
    const code = alice.last('joined')!.code;
    expect(rooms.rooms.get(code)!.seats[0].deck.at(-1)).toMatchObject({ loyalty: '4', layout: 'modal_dfc', faces: [{ name: 'A' }] });
  });
});

describe('clocks', () => {
  function timedRoom() {
    const rooms = new RoomManager({ rng: () => 0.1, decisionMs: 1000, reconnectMs: 5000 });
    const alice = new FakeConn();
    const bob = new FakeConn();
    rooms.handle(alice, { t: 'create', name: 'Alice', deck });
    const code = alice.last('joined')!.code;
    rooms.handle(bob, { t: 'join', code, name: 'Bob', deck });
    return { rooms, alice, bob, code };
  }

  it('plays the default action when time runs out, and concedes after three in a row', () => {
    vi.useFakeTimers();
    try {
      const { alice, bob } = timedRoom();
      expect(alice.last('clock')!.clock).toMatchObject({ player: 0, kind: 'turn' });
      vi.advanceTimersByTime(1000); // Alice doesn't decide on her opening hand: she keeps it
      expect(alice.state.log.at(-1)).toEqual({ k: 'timedOut', p: 0 });
      expect(alice.state.mulligan?.player).toBe(1);
      vi.advanceTimersByTime(1000); // Bob keeps too
      // Alice now idles through her turn: two more timeouts then she concedes on the third.
      for (let i = 0; i < 10 && alice.state.winner === null; i++) vi.advanceTimersByTime(1000);
      expect(bob.state.winner).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a disconnected player time to come back, then concedes for them', () => {
    vi.useFakeTimers();
    try {
      const { rooms, alice, bob, code } = timedRoom();
      const token = bob.messages.find((m) => m.t === 'joined')!.token;
      rooms.disconnect(bob);
      expect(alice.last('clock')!.clock).toMatchObject({ player: 1, kind: 'reconnect' });
      vi.advanceTimersByTime(4000);
      const back = new FakeConn();
      rooms.handle(back, { t: 'rejoin', code, token });
      expect(back.last('clock')!.clock).toMatchObject({ kind: 'turn' });
      rooms.disconnect(back);
      vi.advanceTimersByTime(5000);
      expect(alice.state.winner).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('best of 3', () => {
  const island: Card = { ...mountain, id: 'i', name: 'Island', typeLine: 'Basic Land — Island' };

  it('keeps the score, lets players sideboard, and the loser plays first', () => {
    const rooms = new RoomManager({ rng: () => 0.1 });
    const alice = new FakeConn();
    const bob = new FakeConn();
    rooms.handle(alice, { t: 'create', name: 'Alice', deck, bestOf: 3 });
    const code = alice.last('joined')!.code;
    rooms.handle(bob, { t: 'join', code, name: 'Bob', deck, sideboard: [island, island] });
    rooms.handle(bob, { t: 'action', action: { type: 'concede', player: 1 } });
    expect(alice.last('lobby')!.match).toMatchObject({ bestOf: 3, wins: [1, 0], games: 1 });

    // Bob swaps two Mountains for his two Islands; a card from outside his 75 is refused.
    const forged = { ...island, id: 'x', name: 'Forged' };
    rooms.handle(bob, { t: 'rematch', deck: [...deck.slice(1), forged] });
    expect(bob.last('error')).toMatchObject({ code: 'invalidCard' });
    rooms.handle(bob, { t: 'rematch', deck: [...deck.slice(2), island, island] });
    rooms.handle(alice, { t: 'rematch' });
    const game2 = bob.state;
    expect(game2.winner).toBeNull();
    expect(game2.active).toBe(1); // Bob lost: he plays first
    const bobCards = [...game2.players[1].hand, ...rooms.rooms.get(code)!.game!.players[1].library].map((c) => c.card.name);
    expect(bobCards.filter((n) => n === 'Island')).toHaveLength(2);

    rooms.handle(bob, { t: 'action', action: { type: 'concede', player: 1 } });
    expect(alice.last('lobby')!.match).toMatchObject({ wins: [2, 0], games: 2 });
    // The match is over: a rematch starts a new match with the original decks.
    rooms.handle(alice, { t: 'rematch' });
    rooms.handle(bob, { t: 'rematch' });
    expect(alice.last('lobby')!.match).toMatchObject({ wins: [0, 0], games: 0 });
    const fresh = rooms.rooms.get(code)!.game!.players[1];
    expect([...fresh.hand, ...fresh.library].some((c) => c.card.name === 'Island')).toBe(false);
  });
});

describe('Two-Headed Giant rooms', () => {
  it('seats four players in two teams, starts when full, and shows teammates their hands', () => {
    const rooms = new RoomManager({ rng: () => 0.1 });
    const conns = [0, 1, 2, 3].map(() => new FakeConn());
    rooms.handle(conns[0], { t: 'create', name: 'A', deck, size: 4, commander: true });
    const code = conns[0].last('joined')!.code;
    rooms.handle(conns[1], { t: 'join', code, name: 'A', deck });
    rooms.handle(conns[2], { t: 'join', code, name: 'C', deck });
    expect(conns[0].last('state')).toBeUndefined(); // waiting for the fourth player
    rooms.handle(conns[3], { t: 'join', code, name: 'D', deck });
    expect(conns[1].last('lobby')).toMatchObject({ size: 4, mode: { twoHeaded: true, commander: true } });
    expect(conns[1].last('lobby')!.players.map((p) => p.name)).toEqual(['A', 'A (2)', 'C', 'D']);
    const view = conns[0].state;
    expect(view.teams).toEqual([[0, 1], [2, 3]]);
    expect(view.players.map((p) => p.life)).toEqual([60, 60, 60, 60]);
    expect(view.players[1].hand[0].card.name).toBe('Mountain'); // the teammate's hand
    expect(view.players[2].hand[0].card.name).toBe('Hidden card');
    // Only the player to act may act; conceding loses for the whole team.
    rooms.handle(conns[2], { t: 'action', action: { type: 'keep', bottom: [] } });
    expect(conns[2].last('error')).toMatchObject({ code: 'notYourTurn' });
    rooms.handle(conns[3], { t: 'action', action: { type: 'concede', player: 3 } });
    expect(conns[0].state.winner).toBe(0);
    expect(conns[0].last('lobby')!.match).toMatchObject({ wins: [1, 0] });
  });
});

describe('Commander rooms', () => {
  it('starts a Duel Commander room at 20 life, with each command zone shown to the opponent', () => {
    const rooms = new RoomManager({ rng: () => 0.1 });
    const [alice, bob] = [new FakeConn(), new FakeConn()];
    rooms.handle(alice, { t: 'create', name: 'A', deck, commanders: [deck[0]], commander: true, duelCommander: true });
    rooms.handle(bob, { t: 'join', code: alice.last('joined')!.code, name: 'B', deck });
    expect(bob.last('lobby')).toMatchObject({ mode: { commander: true, duelCommander: true } });
    expect(bob.state.players.map((p) => p.life)).toEqual([20, 20]);
    expect(bob.state.players[0].command!.map((c) => c.card.name)).toEqual([deck[0].name]);
  });

  it('ignores Duel Commander without Commander rules or with four players', () => {
    const rooms = new RoomManager({ rng: () => 0.1 });
    const a = new FakeConn();
    rooms.handle(a, { t: 'create', name: 'A', deck, duelCommander: true });
    const b = new FakeConn();
    rooms.handle(b, { t: 'join', code: a.last('joined')!.code, name: 'B', deck });
    expect(b.last('lobby')!.mode).toEqual({});
    expect(b.state.players.map((p) => p.life)).toEqual([20, 20]);
    const c = new FakeConn();
    rooms.handle(c, { t: 'create', name: 'C', deck, size: 4, commander: true, duelCommander: true });
    expect(c.last('lobby')!.mode).toEqual({ twoHeaded: true, commander: true });
  });
});
