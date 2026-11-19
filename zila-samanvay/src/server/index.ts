// Zila Samanvay API server: Express + SQLite.
//   POST /api/login      { userId }      demo sign-in (sets a signed HttpOnly cookie)
//   POST /api/logout
//   POST /api/rpc/:name  { ...input }    every procedure in src/core/rpc.ts
//   GET  /api/health
// With --prod it also serves the built React app from ./dist.

import compression from 'compression';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorPayload, execute, isMutation } from '../core/rpc';
import type { Ctx } from '../core/context';
import type { UserRow } from '../core/types';
import { openDatabase } from './database';
import { cookieHeader, COOKIE, issue, loadSecret, readCookie, verify } from './session';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
// PORT is honoured only in production; in development the API always sits behind Vite's proxy on
// API_PORT (default 4000), so a PORT exported in the shell can never collide with the UI server.
const PORT = Number(PROD ? (process.env.PORT ?? 8080) : (process.env.API_PORT ?? 4000));
const HOST = process.env.HOST ?? (PROD ? '0.0.0.0' : '127.0.0.1');
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';
const DEMO_LOGIN = process.env.DEMO_LOGIN !== '0';

const { db, engine, file, persist } = await openDatabase(DATA_DIR, process.env.DB_ENGINE === 'sql.js' ? 'sql.js' : undefined);
const secret = loadSecret(DATA_DIR);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(compression());

// Security headers (strict CSP: no inline scripts, no third-party origins).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (SECURE_COOKIE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (PROD) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  next();
});

app.use('/api', express.json({ limit: '4mb' }));

// CSRF defence: every state-changing API call must carry the custom header the app sends.
// Browsers cannot add it cross-site without a CORS preflight, which this server never grants.
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && req.get('x-zs-client') !== '1') return res.status(403).json({ error: 'Missing client header' });
  next();
});

// Per-user session epoch: signing out bumps it, which revokes every token issued before.
const epochOf = (userId: number) => Number(db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [`session_epoch:${userId}`])?.value ?? 0);
const bumpEpoch = (userId: number) =>
  db.run("INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)", [`session_epoch:${userId}`]);

function currentUser(req: Request): UserRow | null {
  const tok = verify(secret, readCookie(req.headers.cookie, COOKIE));
  if (!tok || tok.epoch !== epochOf(tok.userId)) return null;
  const id = tok.userId;
  return db.get<UserRow>('SELECT id, name, designation, role, department_id, block_id, office_id, phone, active FROM users WHERE id = ? AND active = 1', [id]) ?? null;
}

// Tiny in-memory rate limiter for sign-in attempts.
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  a.n++;
  return a.n > max;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, engine, time: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
  if (!DEMO_LOGIN) return res.status(403).json({ error: 'Demo sign-in is disabled. Configure SSO / OTP sign-in for production.' });
  if (rateLimited(`login:${req.ip ?? 'x'}`)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  const userId = Number(req.body?.userId);
  const user = Number.isInteger(userId) ? db.get<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', [userId]) : undefined;
  if (!user) return res.status(400).json({ error: 'Unknown officer' });
  res.setHeader('Set-Cookie', cookieHeader(issue(secret, user.id, epochOf(user.id)), SECURE_COOKIE));
  db.run('INSERT INTO audit_log (at, user_id, user_name, role, action, entity_type, entity_id, summary) VALUES (?,?,?,?,?,?,?,?)', [
    new Date().toISOString(), user.id, user.name, user.role, 'session.login', 'user', user.id, `${user.name} signed in`,
  ]);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const tok = verify(secret, readCookie(req.headers.cookie, COOKIE));
  if (tok) bumpEpoch(tok.userId);
  res.setHeader('Set-Cookie', cookieHeader('', SECURE_COOKIE, 0));
  res.json({ ok: true });
});

app.post('/api/rpc/:name', (req, res) => {
  if (rateLimited(`rpc:${req.ip ?? 'x'}`, 900)) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  const name = req.params.name;
  const user = currentUser(req);
  const ctx: Ctx = { db, user, now: new Date() };
  const input = req.body ?? {};
  // Server recomputes the evidence hash rather than trusting the browser.
  const ev = (input as { evidence?: { dataUrl?: string; sha256?: string } }).evidence;
  if (ev?.dataUrl) {
    const b64 = ev.dataUrl.slice(ev.dataUrl.indexOf(',') + 1);
    ev.sha256 = crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
  }
  try {
    const out = execute(name, input, ctx);
    if (isMutation(name)) persist();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: out ?? null });
  } catch (e) {
    const { status, message } = errorPayload(e);
    res.status(status).json({ error: message });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

if (PROD) {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('dist/ not found — run `npm run build` first.');
    process.exit(1);
  }
  app.use(
    express.static(dist, {
      index: false,
      setHeaders: (res, p) => {
        // hashed assets are immutable; index.html must always revalidate
        res.setHeader('Cache-Control', p.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number })?.status ?? 500;
  res.status(status).json({ error: status === 413 ? 'Upload too large (max 2.5 MB).' : 'Bad request' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Zila Samanvay API  →  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Database (${engine}) →  ${path.relative(ROOT, file)}`);
  if (!PROD) console.log('  Open the app at       http://127.0.0.1:5173\n');
});
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
