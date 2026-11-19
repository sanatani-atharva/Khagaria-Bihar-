// Stateless signed-cookie sessions (HMAC-SHA256). The secret lives in data/.session-secret
// (generated on first run) unless SESSION_SECRET is set.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const COOKIE = 'zs_session';
const MAX_AGE_S = 60 * 60 * 10; // a working day

export function loadSecret(dataDir: string): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, '.session-secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

function sign(secret: string, payload: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issue(secret: string, userId: number, epoch: number): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const payload = `${userId}.${epoch}.${exp}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Returns the user id and session epoch of a valid, unexpired token. */
export function verify(secret: string, token: string | undefined): { userId: number; epoch: number } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [uid, epoch, exp, mac] = parts;
  const expected = sign(secret, `${uid}.${epoch}.${exp}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const id = Number(uid);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { userId: id, epoch: Number(epoch) || 0 };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function cookieHeader(value: string, secure: boolean, maxAge = MAX_AGE_S) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
