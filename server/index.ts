import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { fetchCardsById } from '../src/lib/scryfall';
import { accounts, authConfig, purgeSessions } from './auth';
import { parseCardCheck, scryfallDeckCheck } from './cards';
import { storedLookup } from './db/cards';
import { migrate, openDb, waitForDb } from './db/index';
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
if (db) setInterval(() => void purgeSessions(db).catch(() => {}), 3600_000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (await account.handle(req, res, url)) return;
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
// Clocks for online games: TURN_SECONDS per decision (default 120), RECONNECT_SECONDS to come back (default 180); 0 = none.
const seconds = (value: string | undefined, fallback: number) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
const rooms = new RoomManager({
  ...(cardCheck === 'off' ? {} : { verifyDeck: scryfallDeckCheck(cardCheck, lookup) }),
  decisionMs: seconds(process.env.TURN_SECONDS, 120) * 1000,
  reconnectMs: seconds(process.env.RECONNECT_SECONDS, 180) * 1000,
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2_000_000 });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws) => {
  alive.add(ws);
  const conn: Conn = {
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  conn.send({ t: 'hello', build: BUILD });
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
    void (db?.end() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}
