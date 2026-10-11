import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseCardCheck, scryfallDeckCheck } from './cards';
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
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
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
});

// Decks are checked against Scryfall (CARD_CHECK=strict|lenient|off, default lenient).
const cardCheck = parseCardCheck(process.env.CARD_CHECK);
// Clocks for online games: TURN_SECONDS per decision (default 120), RECONNECT_SECONDS to come back (default 180); 0 = none.
const seconds = (value: string | undefined, fallback: number) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
const rooms = new RoomManager({
  ...(cardCheck === 'off' ? {} : { verifyDeck: scryfallDeckCheck(cardCheck) }),
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

server.listen(PORT, () => console.log(`Magic Trainer server on http://localhost:${PORT} (WebSocket at /ws)`));
