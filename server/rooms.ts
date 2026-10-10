import { randomInt, randomUUID } from 'node:crypto';
import { actor, apply, IllegalAction, newGame, type ErrorParams, type GameState, type PlayerId } from '../src/lib/engine/engine';
import {
  MAX_DECK_SIZE, MIN_DECK_SIZE, redact, type ClientMessage, type ServerErrorCode, type ServerMessage,
} from '../src/lib/multiplayer/protocol';
import type { Card } from '../src/types';

/** One browser connection. The transport (WebSocket) lives in index.ts. */
export interface Conn {
  send(msg: ServerMessage): void;
}

interface Seat {
  name: string;
  deck: Card[];
  token: string;
  conn: Conn | null;
  wantsRematch: boolean;
}

interface Room {
  code: string;
  seats: Seat[];
  game: GameState | null;
  expiry?: ReturnType<typeof setTimeout>;
}

class ClientError extends Error {
  constructor(
    readonly code: ServerErrorCode,
    readonly params: ErrorParams = {},
  ) {
    super(code);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

export interface RoomManagerOptions {
  /** How long a room with nobody connected is kept so players can reconnect. */
  emptyRoomTtlMs?: number;
  rng?: () => number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private where = new Map<Conn, { room: Room; seat: PlayerId }>();
  private ttl: number;
  private rng: () => number;

  constructor({ emptyRoomTtlMs = 10 * 60_000, rng = Math.random }: RoomManagerOptions = {}) {
    this.ttl = emptyRoomTtlMs;
    this.rng = rng;
  }

  handle(conn: Conn, raw: unknown) {
    try {
      const msg = raw as ClientMessage;
      switch (msg?.t) {
        case 'create': return this.create(conn, cleanName(msg.name), cleanDeck(msg.deck));
        case 'join': return this.join(conn, String(msg.code ?? '').toUpperCase().trim(), cleanName(msg.name), cleanDeck(msg.deck));
        case 'rejoin': return this.rejoin(conn, String(msg.code ?? ''), String(msg.token ?? ''));
        case 'action': return this.act(conn, msg.action);
        case 'rematch': return this.rematch(conn);
        case 'leave': return this.leave(conn);
        default: throw new ClientError('unknownMessage');
      }
    } catch (e) {
      if (e instanceof ClientError || e instanceof IllegalAction) conn.send({ t: 'error', code: e.code, params: e.params });
      else throw e;
    }
  }

  disconnect(conn: Conn) {
    const at = this.where.get(conn);
    if (!at) return;
    this.where.delete(conn);
    at.room.seats[at.seat].conn = null;
    this.sendLobby(at.room);
    this.expireIfEmpty(at.room);
  }

  // ---------- Handlers ----------

  private create(conn: Conn, name: string, deck: Card[]) {
    this.leave(conn, true);
    let code: string;
    do code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.rooms.has(code));
    const room: Room = { code, seats: [], game: null };
    this.rooms.set(code, room);
    this.seat(conn, room, name, deck);
  }

  private join(conn: Conn, code: string, name: string, deck: Card[]) {
    const room = this.rooms.get(code);
    if (!room) throw new ClientError('noRoom', { code });
    if (room.seats.length >= 2) throw new ClientError('roomFull');
    this.leave(conn, true);
    if (room.seats[0]?.name === name) name = `${name} (2)`;
    this.seat(conn, room, name, deck);
    this.startGame(room);
  }

  private rejoin(conn: Conn, code: string, token: string) {
    const room = this.rooms.get(code);
    const seat = room?.seats.findIndex((s) => s.token && s.token === token) ?? -1;
    if (!room || seat < 0) {
      conn.send({ t: 'error', code: 'gameGone', lostRoom: true });
      return;
    }
    const old = room.seats[seat].conn;
    if (old) this.where.delete(old);
    clearTimeout(room.expiry);
    room.seats[seat].conn = conn;
    this.where.set(conn, { room, seat: seat as PlayerId });
    conn.send({ t: 'joined', code, seat: seat as PlayerId, token });
    this.sendLobby(room);
    if (room.game) conn.send({ t: 'state', state: redact(room.game, seat as PlayerId) });
  }

  private act(conn: Conn, action: unknown) {
    const { room, seat } = this.locate(conn);
    if (!room.game) throw new ClientError('notStarted');
    if (!action || typeof action !== 'object') throw new ClientError('invalidAction');
    const a = action as Parameters<typeof apply>[1];
    if (a.type === 'concede') {
      room.game = apply(room.game, { type: 'concede', player: seat });
    } else {
      if (actor(room.game) !== seat) throw new ClientError('notYourTurn');
      room.game = apply(room.game, a);
    }
    this.sendState(room);
  }

  private rematch(conn: Conn) {
    const { room, seat } = this.locate(conn);
    if (!room.game || room.game.winner === null) throw new ClientError('gameNotOver');
    if (room.seats.length < 2) throw new ClientError('opponentLeft');
    room.seats[seat].wantsRematch = true;
    if (room.seats.every((s) => s.wantsRematch)) this.startGame(room);
    else this.sendLobby(room);
  }

  /** Leaving for good: concede a running game and give up the seat. */
  private leave(conn: Conn, silent = false) {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, seat } = at;
    if (room.game && room.game.winner === null) {
      room.game = apply(room.game, { type: 'concede', player: seat });
      this.sendState(room);
    }
    this.where.delete(conn);
    room.seats[seat].conn = null;
    room.seats[seat].token = ''; // can't rejoin
    if (!silent) conn.send({ t: 'left' });
    if (room.seats.every((s) => !s.conn)) this.deleteRoom(room);
    else this.sendLobby(room);
  }

  // ---------- Helpers ----------

  private seat(conn: Conn, room: Room, name: string, deck: Card[]) {
    const token = randomUUID();
    room.seats.push({ name, deck, token, conn, wantsRematch: false });
    const seat = (room.seats.length - 1) as PlayerId;
    this.where.set(conn, { room, seat });
    conn.send({ t: 'joined', code: room.code, seat, token });
    this.sendLobby(room);
  }

  private startGame(room: Room) {
    const [a, b] = room.seats;
    room.game = newGame({
      decks: [a.deck, b.deck],
      names: [a.name, b.name],
      first: this.rng() < 0.5 ? 0 : 1,
      rng: this.rng,
    });
    for (const s of room.seats) s.wantsRematch = false;
    this.sendLobby(room);
    this.sendState(room);
  }

  private locate(conn: Conn) {
    const at = this.where.get(conn);
    if (!at) throw new ClientError('notInRoom');
    return at;
  }

  private sendState(room: Room) {
    room.seats.forEach((s, i) => s.conn?.send({ t: 'state', state: redact(room.game!, i as PlayerId) }));
  }

  private sendLobby(room: Room) {
    const players = room.seats.map((s) => ({ name: s.name, connected: !!s.conn, wantsRematch: s.wantsRematch }));
    for (const s of room.seats) s.conn?.send({ t: 'lobby', code: room.code, players });
  }

  private expireIfEmpty(room: Room) {
    if (room.seats.some((s) => s.conn)) return;
    clearTimeout(room.expiry);
    room.expiry = setTimeout(() => this.deleteRoom(room), this.ttl);
  }

  private deleteRoom(room: Room) {
    clearTimeout(room.expiry);
    this.rooms.delete(room.code);
  }
}

// ---------- Input validation (messages come from untrusted clients) ----------

function cleanName(name: unknown): string {
  const s = String(name ?? '').trim().slice(0, 24);
  if (!s) throw new ClientError('enterName');
  return s;
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : undefined);

/**
 * Keep only the Card fields the engine uses. Note: the server trusts the card data
 * itself, so a modified client could send altered cards.
 */
function cleanDeck(deck: unknown): Card[] {
  if (!Array.isArray(deck) || deck.length < MIN_DECK_SIZE || deck.length > MAX_DECK_SIZE) {
    throw new ClientError('deckSize', { min: MIN_DECK_SIZE, max: MAX_DECK_SIZE });
  }
  return deck.map((c): Card => {
    if (!c || typeof c !== 'object' || typeof c.name !== 'string') throw new ClientError('invalidCard');
    return {
      id: str(c.id, 64), name: str(c.name, 200), manaCost: str(c.manaCost, 100), cmc: Number(c.cmc) || 0,
      typeLine: str(c.typeLine, 200), oracleText: str(c.oracleText),
      colors: Array.isArray(c.colors) ? c.colors.map(String).slice(0, 5) : [],
      colorIdentity: Array.isArray(c.colorIdentity) ? c.colorIdentity.map(String).slice(0, 5) : [],
      imageSmall: optStr(c.imageSmall), imageNormal: optStr(c.imageNormal),
      setCode: str(c.setCode, 10), setName: str(c.setName, 100), rarity: str(c.rarity, 20),
      power: optStr(c.power), toughness: optStr(c.toughness),
      keywords: Array.isArray(c.keywords) ? c.keywords.map(String).slice(0, 30) : undefined,
      lang: optStr(c.lang)?.slice(0, 8),
      printedName: optStr(c.printedName),
      printedTypeLine: optStr(c.printedTypeLine),
    };
  });
}
