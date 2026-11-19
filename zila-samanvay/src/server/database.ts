// Opens the SQLite database. Prefers Node's built-in node:sqlite (Node 22.13+, real on-disk
// file, WAL journaling). Falls back to sql.js (WebAssembly SQLite) with atomic file snapshots
// on older Node versions, so `npm install && npm run dev` works without native compilers.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sqlJsAdapter, toSql, type Db, type RunResult, type SqlJsDatabase } from '../core/db';
import { initSchema, isSeeded, seed } from '../core/seed';

export interface OpenedDb {
  db: Db;
  engine: 'node:sqlite' | 'sql.js';
  file: string;
  /** Persist after a mutation (no-op for node:sqlite, which writes through). */
  persist: () => void;
}

const require = createRequire(import.meta.url);

// Silence the one-time ExperimentalWarning that node:sqlite prints on Node 22.
const origEmit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message;
  if (msg && msg.includes('SQLite is an experimental feature')) return;
  return (origEmit as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

async function openNodeSqlite(file: string): Promise<Db | null> {
  try {
    const mod = (await import('node:sqlite')) as unknown as {
      DatabaseSync: new (f: string) => {
        prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } };
        exec(sql: string): void;
      };
    };
    const raw = new mod.DatabaseSync(file);
    raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const stmts = new Map<string, ReturnType<typeof raw.prepare>>();
    const prep = (sql: string) => {
      let s = stmts.get(sql);
      if (!s) {
        s = raw.prepare(sql);
        if (stmts.size > 500) stmts.clear();
        stmts.set(sql, s);
      }
      return s;
    };
    let depth = 0;
    const db: Db = {
      all: <T,>(sql: string, params?: unknown[]) => prep(sql).all(...toSql(params)).map((r) => ({ ...(r as object) })) as T[],
      get: <T,>(sql: string, params?: unknown[]) => {
        const r = prep(sql).get(...toSql(params));
        return (r ? { ...(r as object) } : undefined) as T | undefined;
      },
      run: (sql: string, params?: unknown[]): RunResult => {
        const r = prep(sql).run(...toSql(params));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
      exec: (sql: string) => raw.exec(sql),
      transaction<T>(fn: () => T): T {
        if (depth > 0) return fn();
        depth++;
        raw.exec('BEGIN IMMEDIATE');
        try {
          const out = fn();
          raw.exec('COMMIT');
          return out;
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        } finally {
          depth--;
        }
      },
    };
    return db;
  } catch {
    return null;
  }
}

async function openSqlJs(file: string): Promise<{ db: Db; persist: () => void }> {
  const initSqlJs = require('sql.js') as (cfg?: unknown) => Promise<{ Database: new (data?: Uint8Array) => SqlJsDatabase }>;
  const SQL = await initSqlJs();
  const raw = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  raw.exec('PRAGMA foreign_keys = ON;');
  const persist = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, raw.export());
    fs.renameSync(tmp, file);
  };
  return { db: sqlJsAdapter(raw), persist };
}

export async function openDatabase(dataDir: string, forceEngine?: 'sql.js'): Promise<OpenedDb> {
  fs.mkdirSync(dataDir, { recursive: true });
  let engine: OpenedDb['engine'] = 'node:sqlite';
  let file = path.join(dataDir, 'zila-samanvay.db');
  let db = forceEngine ? null : await openNodeSqlite(file);
  let persist = () => {};
  if (!db) {
    engine = 'sql.js';
    file = path.join(dataDir, 'zila-samanvay.sqljs.db');
    const o = await openSqlJs(file);
    db = o.db;
    persist = o.persist;
  }
  initSchema(db);
  if (!isSeeded(db)) {
    seed(db, new Date());
    persist();
  }
  return { db, engine, file, persist };
}
