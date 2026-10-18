import { createHash, randomInt, randomUUID } from 'node:crypto';
import { fallbackAction } from '../src/lib/engine/bot';
import { actor, apply, IllegalAction, newGame, STATE_VERSION, teamOf, teamsOf, type Action, type ErrorParams, type GameMode, type GameState, type LogEntry, type PlayerId } from '../src/lib/engine/engine';
import { newReplay, type Replay } from '../src/lib/replay';
import { cleanSetup, deckProblems, gameModeOf, type GameSetup } from '../src/lib/gameModes';
import type { HistoryStore } from './history';
import { packState, unpackState } from '../src/lib/packState';
import type { RoomStore } from './db/roomStore';
import {
  MAX_DECK_SIZE, MIN_DECK_SIZE, redact, type ClientMessage, type ServerErrorCode, type ServerMessage,
} from '../src/lib/multiplayer/protocol';
import { isRearrangement, matchOver, matchWinner, newMatch, nextFirst, recordGame, type MatchScore } from '../src/lib/match';
import type { Card } from '../src/types';

/** One browser connection. The transport (WebSocket) lives in index.ts. */
export interface Conn {
  send(msg: ServerMessage): void;
  /** The account logged in on this connection (Discord login), if any. */
  userId?: string;
}

interface Seat {
  name: string;
  /** The name of the deck brought (for the match history). */
  deckName?: string;
  /** The main deck and sideboard the player brought, and the main deck for the next game (after sideboarding). */
  deck: Card[];
  side: Card[];
  next: Card[];
  /** Commander games: the deck's commanders (none: it plays without one). */
  commanders: Card[];
  /** SHA-256 of the seat's secret (the browser keeps the secret); '' once the seat is given up. */
  tokenHash: string;
  /** The account of the player who took the seat: they can come back from any device logged in to it. */
  userId?: string;
  conn: Conn | null;
  wantsRematch: boolean;
}

interface Room {
  /** The room's address (/online/<id>), and the short code to type or read out. */
  id: string;
  code: string;
  seats: Seat[];
  game: GameState | null;
  expiry?: ReturnType<typeof setTimeout>;
  /** The running clock: a decision to make, or a disconnected player to come back. */
  clock?: { timer: ReturnType<typeof setTimeout>; player: PlayerId; kind: 'turn' | 'reconnect'; endsAt: number };
  /** Consecutive decisions each player let time out. */
  timeouts?: [number, number];
  match: MatchScore;
  /** The match's id (its results in the players' history), and the replays of its games so far. */
  matchId?: string;
  replays?: Replay[];
  /** 2 seats, or 4 in Two-Headed Giant (seats 0+1 against 2+3). */
  size: 2 | 4;
  /** The game mode chosen (what decks may be played), and the engine's mode for it. */
  setup?: GameSetup;
  mode: GameMode;
  /** Who played first in the current game, and whether its result is in the score. */
  first?: PlayerId;
  scored?: boolean;
  /** A save to the store is due (see persist). */
  saveTimer?: ReturnType<typeof setTimeout>;
  /** Connections watching the game (no seat; they see no hand). */
  watchers?: Set<Conn>;
  /** When it was created (ms; rooms saved before: unknown). */
  createdAt?: number;
}

/** A room as the administration page lists it (server/admin.ts). */
export interface AdminRoom {
  id: string;
  code: string;
  players: { name: string; connected: boolean }[];
  size: 2 | 4;
  mode: string;
  bestOf: 1 | 3;
  score: number[];
  /** The game in progress: its turn, and whose clock runs (a decision, or a player to come back). */
  turn: number | null;
  clock: { player: string; kind: 'turn' | 'reconnect'; endsAt: number } | null;
  watchers: number;
  createdAt: number | null;
}

/** What is saved of a room: everything but the connections and the timers. */
type SavedRoom = Omit<Room, 'expiry' | 'clock' | 'saveTimer' | 'seats' | 'watchers'> & { seats: Omit<Seat, 'conn'>[] };

/** Spectators per room. */
const MAX_WATCHERS = 20;

/** Changes to a room within this delay are saved together. */
const SAVE_DELAY_MS = 1000;

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
  /** Where rooms are saved after each change, so a restart of the server can restore them (see restore). */
  store?: RoomStore;
  /** Where the results of finished matches go, for the players logged in to an account. */
  history?: HistoryStore;
}

/** A card the deck check doesn't recognize, or a check that couldn't run (`card` undefined). */
export class DeckCheckError extends Error {
  constructor(readonly card?: string) {
    super(card ? `Unknown card: ${card}` : 'Card check failed');
  }
}

export class RoomManager {
  /** Rooms by code, and by id. */
  readonly rooms = new Map<string, Room>();
  private byId = new Map<string, Room>();
  private where = new Map<Conn, { room: Room; seat: PlayerId }>();
  /** The room each spectator watches. */
  private watching = new Map<Conn, Room>();
  private ttl: number;
  private rng: () => number;
  private verifyDeck?: (deck: Card[]) => Promise<Card[]>;
  private decisionMs: number;
  private reconnectMs: number;
  private store?: RoomStore;
  private history?: HistoryStore;

  constructor({ emptyRoomTtlMs = 10 * 60_000, rng = Math.random, verifyDeck, decisionMs = 0, reconnectMs = 0, store, history }: RoomManagerOptions = {}) {
    this.store = store;
    this.history = history;
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

  /** Checks the deck and sideboard (when a checker is set), then continues with the trusted cards. Returns a promise for tests. */
  private withDeck(conn: Conn, rawDeck: unknown, rawSide: unknown, rawCommanders: unknown, then: (deck: Card[], side: Card[], commanders: Card[]) => void): Promise<void> {
    const deck = cleanDeck(rawDeck);
    const side = rawSide === undefined ? [] : cleanCards(rawSide, 0, 30);
    const commanders = rawCommanders === undefined ? [] : cleanCards(rawCommanders, 0, 2);
    if (!this.verifyDeck) {
      then(deck, side, commanders);
      return Promise.resolve();
    }
    return this.verifyDeck([...deck, ...side, ...commanders]).then(
      (trusted) => this.run(conn, () => then(trusted.slice(0, deck.length), trusted.slice(deck.length, deck.length + side.length), trusted.slice(deck.length + side.length))),
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
          const bestOf = msg.bestOf === 3 ? 3 : 1;
          const setup = cleanSetup(msg.setup);
          const deckName = cleanDeckName(msg.deckName);
          return this.withDeck(conn, msg.deck, msg.sideboard, msg.commanders, (deck, side, commanders) => {
            checkLegal(setup, deck, side, commanders);
            this.create(conn, name, deckName, deck, side, commanders, bestOf, setup);
          });
        }
        case 'join': {
          const name = cleanName(msg.name);
          // By the room's address, or by its code.
          const room = typeof msg.room === 'string' ? this.byId.get(msg.room) : this.rooms.get(String(msg.code ?? '').toUpperCase().trim());
          if (!room) throw new ClientError('noRoom', { code: String(msg.code ?? '') });
          const deckName = cleanDeckName(msg.deckName);
          return this.withDeck(conn, msg.deck, msg.sideboard, msg.commanders, (deck, side, commanders) => {
            checkLegal(room.setup, deck, side, commanders);
            this.join(conn, room, name, deckName, deck, side, commanders);
          });
        }
        case 'open': return this.open(conn, String(msg.room ?? ''), typeof msg.token === 'string' ? msg.token : '');
        case 'watch': return this.watch(conn, String(msg.room ?? ''));
        case 'replays': return this.sendReplays(conn);
        case 'action': return this.act(conn, msg.action);
        case 'rematch': return this.rematch(conn, msg.deck);
        case 'leave':
          if (this.watching.has(conn)) {
            this.unwatch(conn);
            return conn.send({ t: 'left' });
          }
          return this.leave(conn);
        default: throw new ClientError('unknownMessage');
      }
    } catch (e) {
      if (e instanceof ClientError || e instanceof IllegalAction) conn.send({ t: 'error', code: e.code, params: e.params });
      else throw e;
    }
  }

  // ---------- Saving (a restart of the server keeps the games) ----------

  /** Rooms saved before a restart, as the store gave them back; returns how many were restored. */
  restore(saved: string[]): number {
    let n = 0;
    for (const packed of saved) {
      try {
        const { v, room } = unpackState<{ v: number; room: SavedRoom }>(packed);
        if (v !== STATE_VERSION || !room?.id || this.byId.has(room.id) || this.rooms.has(room.code)) continue;
        // Nobody is connected yet: the clocks start when the first player is back.
        const restored: Room = { ...room, seats: room.seats.map((s) => ({ ...s, conn: null })) };
        this.rooms.set(restored.code, restored);
        this.byId.set(restored.id, restored);
        this.expireIfEmpty(restored);
        n++;
      } catch (e) {
        console.warn('A saved room could not be restored:', (e as Error).message);
      }
    }
    return n;
  }

  /** A save of the room is due (several changes in a row are saved once). */
  private persist(room: Room) {
    if (!this.store || room.saveTimer) return;
    room.saveTimer = setTimeout(() => void this.saveNow(room), SAVE_DELAY_MS);
  }

  private async saveNow(room: Room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = undefined;
    if (!this.store || this.byId.get(room.id) !== room) return;
    const { expiry: _e, clock: _c, saveTimer: _s, watchers: _w, ...rest } = room;
    const saved: SavedRoom = { ...rest, seats: room.seats.map(({ conn: _conn, ...seat }) => seat) };
    try {
      await this.store.save(room.id, room.code, packState({ v: STATE_VERSION, room: saved }));
    } catch (e) {
      console.warn(`Room ${room.code} could not be saved:`, (e as Error).message);
    }
  }

  /** Saves the rooms with changes not saved yet (before the server stops). */
  flush(): Promise<void> {
    return Promise.all([...this.byId.values()].filter((r) => r.saveTimer).map((r) => this.saveNow(r))).then(() => {});
  }

  disconnect(conn: Conn) {
    this.unwatch(conn);
    const at = this.where.get(conn);
    if (!at) return;
    this.where.delete(conn);
    at.room.seats[at.seat].conn = null;
    this.sendLobby(at.room);
    this.armClock(at.room);
    this.expireIfEmpty(at.room);
  }

  // ---------- Handlers ----------

  private create(conn: Conn, name: string, deckName: string | undefined, deck: Card[], side: Card[], commanders: Card[], bestOf: 1 | 3, setup: GameSetup) {
    const size = setup.twoHeaded ? 4 : 2;
    const mode = gameModeOf(setup);
    this.unwatch(conn);
    this.leave(conn, true);
    let code: string;
    do code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.rooms.has(code));
    const room: Room = { id: randomUUID(), code, seats: [], game: null, match: newMatch(bestOf), matchId: randomUUID(), replays: [], size, setup, mode, createdAt: Date.now() };
    this.rooms.set(code, room);
    this.byId.set(room.id, room);
    this.seat(conn, room, name, deckName, deck, side, commanders);
  }

  private join(conn: Conn, room: Room, name: string, deckName: string | undefined, deck: Card[], side: Card[], commanders: Card[]) {
    // The room may have closed during the deck check.
    if (this.byId.get(room.id) !== room) throw new ClientError('noRoom', { code: room.code });
    if (room.seats.length >= room.size) throw new ClientError('roomFull');
    this.unwatch(conn);
    this.leave(conn, true);
    const taken = new Set(room.seats.map((x) => x.name));
    for (let i = 2; taken.has(name); i++) name = `${name.replace(/ \(\d+\)$/, '')} (${i})`;
    this.seat(conn, room, name, deckName, deck, side, commanders);
    // Everyone is seated: the game starts.
    if (room.seats.length === room.size) this.startGame(room);
  }

  /** On a new connection: the rooms where the logged-in account has a seat, to find them from any device. */
  welcome(conn: Conn) {
    if (!conn.userId) return;
    const rooms = [...this.byId.values()]
      .filter((r) => r.seats.some((s) => s.userId === conn.userId && s.tokenHash))
      .map((r) => ({ room: r.id, code: r.code, players: r.seats.map((s) => s.name), over: !!r.game && r.game.winner !== null }));
    conn.send({ t: 'myRooms', rooms });
  }

  /**
   * A browser opens /online/<id>: back to its seat when it holds the seat's secret or is logged in to the seat's
   * account (it then gets a new secret), otherwise what it needs to join (or that the room is full).
   */
  private open(conn: Conn, id: string, token: string) {
    const room = UUID.test(id) ? this.byId.get(id) : undefined;
    if (!room) {
      conn.send({ t: 'error', code: 'gameGone', lostRoom: true });
      return;
    }
    const hash = token ? hashToken(token) : '';
    let seat = hash ? room.seats.findIndex((s) => s.tokenHash === hash) : -1;
    if (seat < 0 && conn.userId) {
      seat = room.seats.findIndex((s) => s.userId === conn.userId && s.tokenHash);
      if (seat >= 0) {
        token = randomUUID();
        room.seats[seat].tokenHash = hashToken(token);
      }
    }
    if (seat < 0) {
      conn.send({
        t: 'roomInfo', room: room.id, code: room.code, size: room.size, mode: room.mode, setup: setupOf(room), bestOf: room.match.bestOf,
        players: room.seats.map((s) => s.name), started: !!room.game,
      });
      return;
    }
    this.unwatch(conn);
    // Already seated elsewhere on this connection: that seat is left as if disconnected.
    const before = this.where.get(conn);
    if (before && before.room !== room) this.disconnect(conn);
    const old = room.seats[seat].conn;
    if (old && old !== conn) this.where.delete(old);
    clearTimeout(room.expiry);
    room.seats[seat].conn = conn;
    this.where.set(conn, { room, seat: seat as PlayerId });
    conn.send({ t: 'joined', room: room.id, code: room.code, seat: seat as PlayerId, token });
    this.sendDeck(room, seat);
    this.sendLobby(room);
    if (room.game) conn.send({ t: 'state', state: redact(room.game, seat as PlayerId) });
    this.armClock(room);
  }

  /** Watching a room's game without a seat: everything public, no hand. */
  private watch(conn: Conn, id: string) {
    const room = UUID.test(id) ? this.byId.get(id) : undefined;
    if (!room) {
      conn.send({ t: 'error', code: 'gameGone', lostRoom: true });
      return;
    }
    if (this.where.has(conn)) this.disconnect(conn);
    this.unwatch(conn);
    room.watchers ??= new Set();
    if (room.watchers.size >= MAX_WATCHERS) throw new ClientError('tooManyWatchers', { max: MAX_WATCHERS });
    room.watchers.add(conn);
    this.watching.set(conn, room);
    conn.send({ t: 'watching', room: room.id, code: room.code });
    this.sendLobby(room);
    if (room.game) conn.send({ t: 'state', state: redact(room.game, null) });
    const clock = room.clock ? { player: room.clock.player, ms: room.clock.endsAt - Date.now(), kind: room.clock.kind } : null;
    conn.send({ t: 'clock', clock });
  }

  private unwatch(conn: Conn) {
    const room = this.watching.get(conn);
    if (!room) return;
    this.watching.delete(conn);
    room.watchers?.delete(conn);
    if (this.byId.get(room.id) === room) this.sendLobby(room);
  }

  private act(conn: Conn, action: unknown) {
    const { room, seat } = this.locate(conn);
    if (!room.game) throw new ClientError('notStarted');
    if (!action || typeof action !== 'object') throw new ClientError('invalidAction');
    const a = action as Parameters<typeof apply>[1];
    if (a.type === 'concede') {
      this.play(room, { type: 'concede', player: seat });
    } else if (a.type === 'setFullControl') {
      this.play(room, { type: 'setFullControl', player: seat, on: a.on === true });
    } else {
      if (actor(room.game) !== seat) throw new ClientError('notYourTurn');
      this.play(room, a);
      if (room.timeouts) room.timeouts[seat] = 0;
    }
    this.sendState(room);
  }

  /**
   * Ready for the next game. In a best of 3 still going, `deck` is the main deck after sideboarding: only
   * cards from the deck and sideboard brought. Once a match is over, a rematch starts a new match.
   */
  private rematch(conn: Conn, rawDeck?: unknown) {
    const { room, seat } = this.locate(conn);
    if (!room.game || room.game.winner === null) throw new ClientError('gameNotOver');
    if (room.seats.length < room.size) throw new ClientError('opponentLeft');
    const s = room.seats[seat];
    const going = matchWinner(room.match) === null;
    if (going && rawDeck !== undefined) {
      const deck = cleanDeck(rawDeck);
      const pool = [...s.deck, ...s.side];
      if (!isRearrangement(pool, deck)) throw new ClientError('invalidCard');
      // Play with the trusted pool cards, not the client's copies.
      const left = [...pool];
      s.next = deck.map((c) => left.splice(left.findIndex((p) => p.id === c.id), 1)[0]);
    }
    s.wantsRematch = true;
    if (!room.seats.every((x) => x.wantsRematch)) return this.sendLobby(room);
    if (going) {
      // Scores and turns are per team: the losing team's first player starts.
      const game = room.game;
      const winner = game.winner === 'draw' ? 'draw' : teamOf(game, game.winner!);
      this.startGame(room, teamsOf(game)[nextFirst(winner, teamOf(game, room.first ?? 0))][0]);
    } else {
      room.match = newMatch(room.match.bestOf);
      room.matchId = randomUUID();
      room.replays = [];
      for (const x of room.seats) x.next = x.deck;
      this.startGame(room);
    }
  }

  /** Leaving for good: concede a running game and give up the seat. */
  private leave(conn: Conn, silent = false) {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, seat } = at;
    if (room.game && room.game.winner === null) {
      this.play(room, { type: 'concede', player: seat });
      this.sendState(room);
    }
    this.where.delete(conn);
    room.seats[seat].conn = null;
    room.seats[seat].tokenHash = ''; // can't rejoin
    if (!silent) conn.send({ t: 'left' });
    if (room.seats.every((s) => !s.conn)) this.deleteRoom(room);
    else this.sendLobby(room);
  }

  // ---------- Helpers ----------

  private seat(conn: Conn, room: Room, name: string, deckName: string | undefined, deck: Card[], side: Card[], commanders: Card[]) {
    const token = randomUUID();
    room.seats.push({ name, ...(deckName ? { deckName } : {}), deck, side, next: deck, commanders, tokenHash: hashToken(token), ...(conn.userId ? { userId: conn.userId } : {}), conn, wantsRematch: false });
    const seat = (room.seats.length - 1) as PlayerId;
    this.where.set(conn, { room, seat });
    conn.send({ t: 'joined', room: room.id, code: room.code, seat, token });
    this.sendDeck(room, seat);
    this.sendLobby(room);
  }

  private startGame(room: Room, first?: PlayerId) {
    // A random team starts (its first player: seat 0 or 2 in Two-Headed Giant).
    room.first = first ?? (this.rng() < 0.5 ? 0 : room.size === 4 ? 2 : 1);
    room.scored = false;
    room.game = newGame({
      decks: room.seats.map((x) => x.next),
      names: room.seats.map((x) => x.name),
      mode: room.mode,
      ...(room.mode.commander ? { commanders: room.seats.map((x) => x.commanders) } : {}),
      first: room.first,
      rng: this.rng,
      // A rematch keeps each seat's full control setting.
      fullControl: room.game?.fullControl,
      // A stop must not tell the opponent what is in a hand.
      publicStops: true,
    });
    (room.replays ??= []).push(newReplay(room.game));
    for (const s of room.seats) s.wantsRematch = false;
    room.seats.forEach((_, i) => this.sendDeck(room, i));
    this.sendLobby(room);
    this.sendState(room);
  }

  /** A player's main deck for the current game and the rest of their cards (sideboarding between games). */
  private sendDeck(room: Room, seat: number) {
    const s = room.seats[seat];
    const side = [...s.deck, ...s.side];
    for (const c of s.next) {
      const i = side.findIndex((x) => x.id === c.id);
      if (i >= 0) side.splice(i, 1);
    }
    s.conn?.send({ t: 'deck', main: s.next, side, ...(s.deckName ? { name: s.deckName } : {}) });
  }

  /** Plays an action (throws IllegalAction), recorded in the game's replay. */
  private play(room: Room, action: Action) {
    room.game = apply(room.game!, action);
    room.replays?.at(-1)?.steps.push({ a: action });
  }

  /** A line the server adds to the game's log, also in the replay. */
  private note(room: Room, entry: LogEntry) {
    room.game = { ...room.game!, log: [...room.game!.log, entry] };
    room.replays?.at(-1)?.steps.push({ log: entry });
  }

  /** The match is over: its result goes to the history of each player logged in to an account. */
  private recordResults(room: Room) {
    const game = room.game;
    if (!this.history || !game || !room.matchId) return;
    const winner = matchWinner(room.match);
    room.seats.forEach((s, i) => {
      if (!s.userId) return;
      const team = teamOf(game, i);
      const opponents = room.seats.filter((_, j) => teamOf(game, j) !== team).map((o) => o.name);
      this.history!.add(s.userId, [{
        id: room.matchId!, at: Date.now(), kind: 'online', twoHeaded: room.size === 4, commander: !!room.mode.commander,
        bestOf: room.match.bestOf, deck: s.deckName ?? '', opponent: opponents.join(' & '),
        result: winner === null ? 'draw' : winner === team ? 'win' : 'loss',
        wins: room.match.wins[team], losses: room.match.wins[1 - team],
      }]).catch((e) => console.warn(`Results of room ${room.code} could not be saved:`, (e as Error).message));
    });
  }

  /** The replays of the match's games, once it is over (before, they would show hands and libraries). */
  private sendReplays(conn: Conn) {
    const room = this.where.get(conn)?.room ?? this.watching.get(conn);
    if (!room) throw new ClientError('notInRoom');
    if (!room.game || room.game.winner === null || !matchOver(room.match)) throw new ClientError('gameNotOver');
    conn.send({ t: 'replays', match: room.matchId ?? room.id, packed: packState(room.replays ?? []) });
  }

  private locate(conn: Conn) {
    const at = this.where.get(conn);
    if (!at) throw new ClientError('notInRoom');
    return at;
  }

  private sendState(room: Room) {
    this.persist(room);
    // A finished game counts once in the match score.
    if (room.game && room.game.winner !== null && !room.scored) {
      room.scored = true;
      const g = room.game;
      room.match = recordGame(room.match, g.winner === 'draw' ? 'draw' : teamOf(g, g.winner!), teamOf(g, room.first ?? 0));
      if (matchOver(room.match)) this.recordResults(room);
      this.sendLobby(room);
    }
    room.seats.forEach((s, i) => s.conn?.send({ t: 'state', state: redact(room.game!, i as PlayerId) }));
    if (room.watchers?.size) {
      const view = redact(room.game!, null);
      for (const w of room.watchers) w.send({ t: 'state', state: view });
    }
    this.armClock(room);
  }

  /**
   * Starts the clock that fits the room: a disconnected player must come back in time, otherwise
   * the player who must act must decide in time. Each state change restarts it. With nobody connected, the game
   * waits (until the room expires): the clocks start again when a player is back.
   */
  private armClock(room: Room) {
    if (room.clock) clearTimeout(room.clock.timer);
    room.clock = undefined;
    const game = room.game;
    if (game && game.winner === null && room.seats.length === room.size && room.seats.some((s) => s.conn)) {
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
    for (const w of room.watchers ?? []) w.send({ t: 'clock', clock });
  }

  /** Out of time for a decision: play the default action (pass, keep, no blocks…); conceding after a few in a row. */
  private decisionExpired(room: Room, player: PlayerId) {
    const game = room.game;
    if (!game || game.winner !== null || actor(game) !== player) return;
    const timeouts = (room.timeouts ??= [0, 0]);
    timeouts[player]++;
    this.play(room, timeouts[player] >= MAX_TIMEOUTS ? { type: 'concede', player } : fallbackAction(game));
    this.note(room, { k: 'timedOut', p: player });
    this.sendState(room);
  }

  /** A disconnected player didn't come back in time: they concede. */
  private reconnectExpired(room: Room, player: PlayerId) {
    if (!room.game || room.game.winner !== null || room.seats[player].conn) return;
    this.play(room, { type: 'concede', player });
    this.sendState(room);
  }

  private sendLobby(room: Room) {
    this.persist(room);
    const players = room.seats.map((s) => ({ name: s.name, connected: !!s.conn, wantsRematch: s.wantsRematch }));
    const lobby: ServerMessage = { t: 'lobby', room: room.id, code: room.code, players, match: room.match, size: room.size, mode: room.mode, setup: setupOf(room), watchers: room.watchers?.size ?? 0 };
    for (const s of room.seats) s.conn?.send(lobby);
    for (const w of room.watchers ?? []) w.send(lobby);
  }

  private expireIfEmpty(room: Room) {
    if (room.seats.some((s) => s.conn)) return;
    clearTimeout(room.expiry);
    room.expiry = setTimeout(() => this.deleteRoom(room), this.ttl);
  }

  /** The rooms for the administration page, the newest first. */
  adminRooms(): AdminRoom[] {
    return [...this.rooms.values()].map((room): AdminRoom => ({
      id: room.id, code: room.code, size: room.size, mode: setupOf(room).mode, bestOf: room.match.bestOf, score: [...room.match.wins],
      players: room.seats.map((s) => ({ name: s.name, connected: !!s.conn })),
      turn: room.game && room.game.winner === null ? room.game.turn : null,
      clock: room.clock ? { player: room.seats[room.clock.player]?.name ?? '?', kind: room.clock.kind, endsAt: room.clock.endsAt } : null,
      watchers: room.watchers?.size ?? 0, createdAt: room.createdAt ?? null,
    })).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  /** An administrator closes a room: its players and spectators are told the game is gone. False: no such room. */
  adminClose(code: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    for (const s of room.seats) {
      if (!s.conn) continue;
      this.where.delete(s.conn);
      s.conn.send({ t: 'error', code: 'gameGone', lostRoom: true });
      s.conn = null;
    }
    this.deleteRoom(room);
    return true;
  }

  private deleteRoom(room: Room) {
    clearTimeout(room.expiry);
    clearTimeout(room.saveTimer);
    if (room.clock) clearTimeout(room.clock.timer);
    // Spectators are told the game is gone.
    for (const w of room.watchers ?? []) {
      this.watching.delete(w);
      w.send({ t: 'error', code: 'gameGone', lostRoom: true });
    }
    room.watchers?.clear();
    this.rooms.delete(room.code);
    this.byId.delete(room.id);
    this.store?.remove(room.id).catch((e) => console.warn(`Room ${room.code} could not be deleted:`, (e as Error).message));
  }
}

/** A room's game mode (rooms saved before modes existed: from their engine mode, any deck). */
function setupOf(room: Room): GameSetup {
  if (room.setup) return room.setup;
  const m = room.mode;
  return cleanSetup({ mode: m.duelCommander ? 'duelCommander' : m.commander ? 'commander' : 'free', twoHeaded: !!m.twoHeaded });
}

/** A deck the room's mode doesn't allow (Constructed: not legal in the format) is refused. */
function checkLegal(setup: GameSetup | undefined, main: Card[], side: Card[], commander: Card[]) {
  if (!setup) return;
  const issue = deckProblems({ main, side, commander }, setup).blocking[0];
  if (issue) {
    const { kind, ...rest } = issue;
    throw new ClientError('deckNotLegal', { format: setup.format, issue: kind, ...rest });
  }
}

// ---------- Input validation (messages come from untrusted clients) ----------

/** A card's legality per format ("legal", "banned"…), checked by Constructed rooms. */
function cleanLegalities(v: unknown): Card['legalities'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 20)) if (typeof x === 'string') out[k.slice(0, 20)] = x.slice(0, 20);
  return out;
}

function cleanDeckName(name: unknown): string | undefined {
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : undefined;
}

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
  return cleanCards(deck, MIN_DECK_SIZE, MAX_DECK_SIZE);
}

function cleanCards(deck: unknown, min: number, max: number): Card[] {
  if (!Array.isArray(deck) || deck.length < min || deck.length > max) {
    throw new ClientError('deckSize', { min, max });
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
      legalities: cleanLegalities(c.legalities),
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
