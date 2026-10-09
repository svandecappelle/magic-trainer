import { describe, expect, it } from 'vitest';
import { actor, type GameState } from '../src/lib/engine/engine';
import type { ServerMessage } from '../src/lib/multiplayer/protocol';
import type { Card } from '../src/types';
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
    expect(bob.last('error')!.message).toMatch(/not your turn/);
    keepBoth(room);
    expect(alice.state.turn).toBe(1);

    const land = alice.state.players[0].hand[0].iid;
    rooms.handle(alice, { t: 'action', action: { type: 'playLand', iid: land } });
    expect(alice.state.battlefield).toHaveLength(1);
    expect(bob.state.battlefield).toHaveLength(1);

    rooms.handle(alice, { t: 'action', action: { type: 'playLand', iid: alice.state.players[0].hand[0].iid } });
    expect(alice.last('error')!.message).toMatch(/already played a land/);
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
    expect(c.last('error')!.message).toMatch(/between/);
    rooms.handle(c, { t: 'join', code: 'ZZZZZ', name: 'A', deck });
    expect(c.last('error')!.message).toMatch(/No room/);
    rooms.handle(c, { t: 'hack' });
    expect(c.last('error')!.message).toBe('Unknown message');
    rooms.handle(c, null);
    expect(c.last('error')!.message).toBe('Unknown message');
  });
});
