import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomManager, type Conn } from './rooms';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../dist');

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
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const rooms = new RoomManager();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2_000_000 });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws) => {
  alive.add(ws);
  const conn: Conn = {
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
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
