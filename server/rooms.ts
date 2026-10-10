import { randomInt, randomUUID } from 'node:crypto';
import { fallbackAction } from '../src/lib/engine/bot';
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
  /** The running clock: a decision to make, or a disconnected player to come back. */
  clock?: { timer: ReturnType<typeof setTimeout>; player: PlayerId; kind: 'turn' | 'reconnect'; endsAt: number };
  /** Consecutive decisions each player let time out. */
  timeouts?: [number, number];
}

/** Timeouts in a row after which a player concedes. */
const MAX_TIMEOUTS = 3;

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
  /**
   * Checks a deck's cards against a trusted source and returns the trusted card data. Throws
   * DeckCheckError for a card it doesn't know. Without it, the client's card data is used.
   */
  verifyDeck?: (deck: Card[]) => Promise<Card[]>;
  /** Time to make each decision; the server then plays a default action. 0: no limit. */
  decisionMs?: number;
  /** Time a disconnected player has to come back before conceding. 0: no limit. */
  reconnectMs?: number;
}

/** A card the deck check doesn't recognize, or a check that couldn't run (`card` undefined). */
export class DeckCheckError extends Error {
  constructor(readonly card?: string) {
    super(card ? `Unknown card: ${card}` : 'Card check failed');
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private where = new Map<Conn, { room: Room; seat: PlayerId }>();
  private ttl: number;
  private rng: () => number;
  private verifyDeck?: (deck: Card[]) => Promise<Card[]>;
  private decisionMs: number;
  private reconnectMs: number;

  constructor({ emptyRoomTtlMs = 10 * 60_000, rng = Math.random, verifyDeck, decisionMs = 0, reconnectMs = 0 }: RoomManagerOptions = {}) {
    this.ttl = emptyRoomTtlMs;
    this.rng = rng;
    this.verifyDeck = verifyDeck;
    this.decisionMs = decisionMs;
    this.reconnectMs = reconnectMs;
  }

  /** Runs a handler, sending rule and request errors back to the client. */
  private run(conn: Conn, fn: () => void) {
    try {
      fn();
    } catch (e) {
      if (e instanceof ClientError || e instanceof IllegalAction) conn.send({ t: 'error', code: e.code, params: e.params });
      else throw e;
    }
  }

  /** Checks the deck (when a checker is set), then continues with the trusted cards. Returns a promise for tests. */
  private withDeck(conn: Conn, rawDeck: unknown, then: (deck: Card[]) => void): Promise<void> {
    const deck = cleanDeck(rawDeck);
    if (!this.verifyDeck) {
      then(deck);
      return Promise.resolve();
    }
    return this.verifyDeck(deck).then(
      (trusted) => this.run(conn, () => then(trusted)),
      (e) => {
        if (e instanceof DeckCheckError && e.card) conn.send({ t: 'error', code: 'invalidCard', params: { card: e.card } });
        else conn.send({ t: 'error', code: 'cardCheckFailed' });
      },
    );
  }

  /** Handles one client message. Returns a promise when the work continues asynchronously (deck checks). */
  handle(conn: Conn, raw: unknown): Promise<void> | void {
    try {
      const msg = raw as ClientMessage;
      switch (msg?.t) {
        case 'create': {
          const name = cleanName(msg.name);
          return this.withDeck(conn, msg.deck, (deck) => this.create(conn, name, deck));
        }
        case 'join': {
          const name = cleanName(msg.name);
          return this.withDeck(conn, msg.deck, (deck) => this.join(conn, String(msg.code ?? '').toUpperCase().trim(), name, deck));
        }
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
    this.armClock(at.room);
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
    this.armClock(room);
  }

  private act(conn: Conn, action: unknown) {
    const { room, seat } = this.locate(conn);
    if (!room.game) throw new ClientError('notStarted');
    if (!action || typeof action !== 'object') throw new ClientError('invalidAction');
    const a = action as Parameters<typeof apply>[1];
    if (a.type === 'concede') {
      room.game = apply(room.game, { type: 'concede', player: seat });
    } else if (a.type === 'setFullControl') {
      room.game = apply(room.game, { type: 'setFullControl', player: seat, on: a.on === true });
    } else {
      if (actor(room.game) !== seat) throw new ClientError('notYourTurn');
      room.game = apply(room.game, a);
      if (room.timeouts) room.timeouts[seat] = 0;
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
      // A rematch keeps each seat's full control setting.
      fullControl: room.game?.fullControl,
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
    this.armClock(room);
  }

  /**
   * Starts the clock that fits the room: a disconnected player must come back in time, otherwise
   * the player who must act must decide in time. Each state change restarts it.
   */
  private armClock(room: Room) {
    if (room.clock) clearTimeout(room.clock.timer);
    room.clock = undefined;
    const game = room.game;
    if (game && game.winner === null && room.seats.length === 2) {
      const away = room.seats.findIndex((s) => !s.conn);
      const who = away >= 0 ? (away as PlayerId) : actor(game);
      const kind = away >= 0 ? 'reconnect' : 'turn';
      const ms = kind === 'reconnect' ? this.reconnectMs : this.decisionMs;
      if (who !== null && ms > 0) {
        const timer = setTimeout(() => (kind === 'reconnect' ? this.reconnectExpired(room, who) : this.decisionExpired(room, who)), ms);
        room.clock = { timer, player: who, kind, endsAt: Date.now() + ms };
      }
    }
    const clock = room.clock ? { player: room.clock.player, ms: room.clock.endsAt - Date.now(), kind: room.clock.kind } : null;
    for (const s of room.seats) s.conn?.send({ t: 'clock', clock });
  }

  /** Out of time for a decision: play the default action (pass, keep, no blocks…); conceding after a few in a row. */
  private decisionExpired(room: Room, player: PlayerId) {
    const game = room.game;
    if (!game || game.winner !== null || actor(game) !== player) return;
    const timeouts = (room.timeouts ??= [0, 0]);
    timeouts[player]++;
    let next = apply(game, timeouts[player] >= MAX_TIMEOUTS ? { type: 'concede', player } : fallbackAction(game));
    next = { ...next, log: [...next.log, { k: 'timedOut', p: player }] };
    room.game = next;
    this.sendState(room);
  }

  /** A disconnected player didn't come back in time: they concede. */
  private reconnectExpired(room: Room, player: PlayerId) {
    if (!room.game || room.game.winner !== null || room.seats[player].conn) return;
    room.game = apply(room.game, { type: 'concede', player });
    this.sendState(room);
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
    if (room.clock) clearTimeout(room.clock.timer);
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
      loyalty: optStr(c.loyalty)?.slice(0, 4),
      layout: optStr(c.layout)?.slice(0, 30),
      faces: Array.isArray(c.faces) ? c.faces.slice(0, 4).map((f: Record<string, unknown>) => ({
        name: str(f?.name, 200), manaCost: str(f?.manaCost, 100), typeLine: str(f?.typeLine, 200), oracleText: str(f?.oracleText),
        colors: Array.isArray(f?.colors) ? f.colors.map(String).slice(0, 5) : undefined,
        power: optStr(f?.power), toughness: optStr(f?.toughness), loyalty: optStr(f?.loyalty),
        imageSmall: optStr(f?.imageSmall), imageNormal: optStr(f?.imageNormal),
      })) : undefined,
    };
  });
}
