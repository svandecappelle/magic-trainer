import type { IncomingMessage, ServerResponse } from 'node:http';

/** Cookies of a request, by name. */
export function parseCookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!out.has(name)) {
      try {
        out.set(name, decodeURIComponent(part.slice(eq + 1).trim()));
      } catch {
        // A malformed value is ignored.
      }
    }
  }
  return out;
}

export interface CookieOptions {
  path?: string;
  /** Seconds; 0 deletes the cookie. Missing: a browser-session cookie. */
  maxAge?: number;
  secure: boolean;
}

/** A Set-Cookie value: always HttpOnly and SameSite=Lax (sent on top-level navigations, not on cross-site requests). */
export function cookie(name: string, value: string, opts: CookieOptions): string {
  let out = `${name}=${encodeURIComponent(value)}; Path=${opts.path ?? '/'}; HttpOnly; SameSite=Lax`;
  if (opts.maxAge !== undefined) out += `; Max-Age=${opts.maxAge}`;
  if (opts.secure) out += '; Secure';
  return out;
}

/** Adds a Set-Cookie header (several can be sent). */
export function addCookie(res: ServerResponse, value: string): void {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), value]);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/** The client's address: nginx's X-Real-IP (the app is only reachable through nginx), else the socket's. */
export function clientIp(req: IncomingMessage): string {
  const real = req.headers['x-real-ip'];
  return (typeof real === 'string' && real) || req.socket.remoteAddress || '?';
}

/**
 * Counts requests per key in a sliding window: `hit` returns false once `limit` is reached within `windowMs`.
 * In memory: a restart resets it.
 */
export function rateLimiter(limit: number, windowMs: number, now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    hit(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((h) => h > t - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((h) => h <= t - windowMs)) hits.delete(k);
      return true;
    },
  };
}
