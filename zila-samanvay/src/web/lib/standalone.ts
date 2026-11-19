// Zero-install runtime: SQLite (sql.js / WebAssembly) inside the browser, seeded with the same
// Khagaria dataset and running the same core procedures as the server. Changes persist in
// IndexedDB on this device. Only bundled in the single-file build.

import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { sqlJsAdapter, type Db, type SqlJsDatabase } from '../../core/db';
import { AppError } from '../../core/context';
import { execute, isMutation } from '../../core/rpc';
import { initSchema, isSeeded, seed } from '../../core/seed';
import type { UserRow } from '../../core/types';
import { RpcError } from './rpc';

const IDB_NAME = 'zila-samanvay';
const IDB_STORE = 'db';
const KEY = 'sqlite';
const SESSION_KEY = 'zs_standalone_user';

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadSnapshot(): Promise<Uint8Array | null> {
  const d = await idb();
  if (!d) return null;
  return new Promise((resolve) => {
    const tx = d.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(KEY);
    r.onsuccess = () => resolve((r.result as Uint8Array) ?? null);
    r.onerror = () => resolve(null);
  });
}

async function saveSnapshot(bytes: Uint8Array) {
  const d = await idb();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

let ready: Promise<{ db: Db; raw: SqlJsDatabase }> | null = null;

function boot() {
  if (!ready) {
    ready = (async () => {
      const SQL = await (initSqlJs as unknown as (cfg: { locateFile: () => string }) => Promise<{ Database: new (d?: Uint8Array) => SqlJsDatabase }>)({ locateFile: () => wasmUrl });
      const snap = await loadSnapshot();
      const raw = snap ? new SQL.Database(snap) : new SQL.Database();
      const db = sqlJsAdapter(raw);
      initSchema(db);
      if (!isSeeded(db)) {
        seed(db, new Date());
        await saveSnapshot(raw.export());
      }
      return { db, raw };
    })();
  }
  return ready;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(raw: SqlJsDatabase) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveSnapshot(raw.export()), 300);
}

function currentUser(db: Db): UserRow | null {
  let id: number | null = null;
  try {
    id = Number(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    id = null;
  }
  if (!id) return null;
  return db.get<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', [id]) ?? null;
}

async function sha256Hex(dataUrl: string): Promise<string | undefined> {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export async function call(name: string, input: unknown): Promise<unknown> {
  const { db, raw } = await boot();
  const ev = (input as { evidence?: { dataUrl?: string; sha256?: string } } | undefined)?.evidence;
  if (ev?.dataUrl) ev.sha256 = await sha256Hex(ev.dataUrl);
  try {
    const out = execute(name, input ?? {}, { db, user: currentUser(db), now: new Date() });
    if (isMutation(name)) scheduleSave(raw);
    // round-trip through JSON so the UI sees exactly what the server would send
    return JSON.parse(JSON.stringify(out ?? null));
  } catch (e) {
    if (e instanceof AppError) throw new RpcError(e.status, e.message);
    console.error(e);
    throw new RpcError(500, 'Unexpected error. The action was not saved.');
  }
}

export async function login(userId: number) {
  const { db } = await boot();
  const u = db.get<UserRow>('SELECT * FROM users WHERE id = ? AND active = 1', [userId]);
  if (!u) throw new RpcError(400, 'Unknown officer');
  try {
    localStorage.setItem(SESSION_KEY, String(userId));
  } catch {
    /* private mode: session lasts for this tab only */
  }
  db.run('INSERT INTO audit_log (at, user_id, user_name, role, action, entity_type, entity_id, summary) VALUES (?,?,?,?,?,?,?,?)', [
    new Date().toISOString(), u.id, u.name, u.role, 'session.login', 'user', u.id, `${u.name} signed in`,
  ]);
}

export async function logout() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
