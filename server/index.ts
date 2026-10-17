import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { fetchCardsById } from '../src/lib/scryfall';
import { accounts, authConfig, purgeSessions } from './auth';
import { parseCardCheck, scryfallDeckCheck } from './cards';
import { deckRoutes, purgeDeletedDecks } from './decks';
import { storedLookup } from './db/cards';
import { migrate, openDb, waitForDb } from './db/index';
import { ROOM_KEEP_HOURS, roomStore } from './db/roomStore';
import { historyRoutes, historyStore } from './history';
import { sendJson } from './http';
import { RoomManager, type Conn } from './rooms';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../dist');

/** The build of the app in dist/ (see vite.config.ts), sent to browsers so an outdated one reloads. */
function readBuild(): string {
  try {
    return String(JSON.parse(readFileSync(join(DIST, 'version.json'), 'utf8')).build);
  } catch {
    return 'dev';
  }
}
const BUILD = readBuild();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

/** Serves the built app from dist/ (production). In development, Vite serves it and proxies /ws here. */
function serveStatic(res: ServerResponse, url: URL) {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // SPA routes
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No build found. Run "npm run build", or use "npm run dev" for development.');
    return;
  }
  // Hashed assets never change; the page and version.json must be fetched again after an update.
  const immutable = file.startsWith(join(DIST, 'assets') + '/');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

// PostgreSQL (DATABASE_URL): accounts and saved decks (docs/accounts.md). Without it, the server keeps no data.
const db = process.env.DATABASE_URL ? openDb(process.env.DATABASE_URL) : null;
if (db) {
  try {
    await waitForDb(db);
    const applied = await migrate(db);
    if (applied.length) console.log(`Database migrations applied: ${applied.join(', ')}`);
  } catch (e) {
    console.error('Database unavailable:', (e as Error).message);
    process.exit(1);
  }
}

// Accounts: login with Discord (PUBLIC_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET), needs the database.
const account = accounts({ pool: db, config: authConfig(process.env) });
if (db && !account.enabled) console.log('Accounts disabled: set PUBLIC_URL, DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to enable them.');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (await account.handle(req, res, url)) return;
    if (await decks.handle(req, res, url)) return;
    if (await history.handle(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'notFound' });
    serveStatic(res, url);
  } catch (e) {
    console.error(`${req.method} ${url.pathname} failed:`, e);
    if (!res.headersSent) sendJson(res, 500, { error: 'serverError' });
    else res.end();
  }
});

// Decks are checked against Scryfall (CARD_CHECK=strict|lenient|off, default lenient), through the cards table if any.
const cardCheck = parseCardCheck(process.env.CARD_CHECK);
const lookup = db ? storedLookup(db, fetchCardsById) : fetchCardsById;
const decks = deckRoutes({ pool: db, account, lookup });
// Results of finished matches, per account.
const results = db ? historyStore(db) : null;
const history = historyRoutes({ store: results, account });
// Online rooms are saved in the database (when there is one), so a restart doesn't end the games.
const store = db ? roomStore(db) : null;
if (db && store) {
  // Hourly clean-up: expired sessions, tombstones of decks deleted long ago, rooms nobody touched for a day.
  setInterval(() => void Promise.all([purgeSessions(db), purgeDeletedDecks(db), store.purge()]).catch(() => {}), 3600_000).unref();
}
// Clocks for online games: TURN_SECONDS per decision (default 120), RECONNECT_SECONDS to come back (default 180); 0 = none.
const seconds = (value: string | undefined, fallback: number) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
const rooms = new RoomManager({
  ...(cardCheck === 'off' ? {} : { verifyDeck: scryfallDeckCheck(cardCheck, lookup) }),
  decisionMs: seconds(process.env.TURN_SECONDS, 120) * 1000,
  reconnectMs: seconds(process.env.RECONNECT_SECONDS, 180) * 1000,
  // Players can come back to a room (its address) for a day.
  emptyRoomTtlMs: ROOM_KEEP_HOURS * 3600_000,
  ...(store ? { store } : {}),
  ...(results ? { history: results } : {}),
});
if (store) {
  try {
    await store.purge();
    const restored = rooms.restore(await store.load());
    if (restored) console.log(`Online rooms restored: ${restored}`);
  } catch (e) {
    console.error('Saved rooms could not be read:', (e as Error).message);
  }
}
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2_000_000 });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws, req) => {
  alive.add(ws);
  const conn: Conn = {
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  // The logged-in account, if any, before hello: browsers send nothing before it.
  void account.socketUser(req).catch(() => null).then((user) => {
    if (user) conn.userId = user.id;
    conn.send({ t: 'hello', build: BUILD });
    rooms.welcome(conn);
  });
  ws.on('pong', () => alive.add(ws));
  ws.on('message', (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      conn.send({ t: 'error', code: 'invalidMessage' });
      return;
    }
    rooms.handle(conn, msg);
  });
  ws.on('close', () => rooms.disconnect(conn));
});

// Drop connections that stopped answering pings (closed laptops, lost Wi-Fi).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000);

const features = [db && 'database connected', account.enabled && 'accounts enabled'].filter(Boolean).join(', ');
server.listen(PORT, () => console.log(`Magic Trainer server on http://localhost:${PORT} (WebSocket at /ws)${features ? `, ${features}` : ''}`));

// docker stop: close the database connections cleanly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close();
    // Rooms changed in the last second are saved first.
    void rooms.flush().then(() => db?.end()).finally(() => process.exit(0));
  });
}
