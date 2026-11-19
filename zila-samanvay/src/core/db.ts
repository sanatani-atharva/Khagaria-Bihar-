// Minimal synchronous database contract shared by the Node server (node:sqlite or sql.js)
// and the zero-install browser build (sql.js). Every query in the core goes through this,
// always with positional `?` parameters, so the same SQL runs unchanged in both places.

export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): RunResult;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

/** Normalise JS values to SQLite-safe values (booleans -> 0/1, undefined -> null). */
export function toSql(params: unknown[] = []): SqlValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number') return Number.isFinite(p) ? p : null;
    if (typeof p === 'string') return p;
    if (p instanceof Date) return p.toISOString();
    return JSON.stringify(p);
  });
}

// ---- sql.js adapter (browser build, and Node fallback when node:sqlite is unavailable) ----

// Structural type so this file does not depend on the sql.js typings at runtime.
interface SqlJsStatement {
  bind(values?: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}
export interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  exec(sql: string): unknown;
  run(sql: string, params?: SqlValue[]): unknown;
  getRowsModified(): number;
  export(): Uint8Array;
}

export function sqlJsAdapter(raw: SqlJsDatabase): Db {
  let depth = 0;
  const db: Db = {
    all<T>(sql: string, params?: unknown[]): T[] {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(toSql(params));
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    get<T>(sql: string, params?: unknown[]): T | undefined {
      return db.all<T>(sql, params)[0];
    },
    run(sql: string, params?: unknown[]): RunResult {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(toSql(params));
        stmt.step();
      } finally {
        stmt.free();
      }
      const changes = raw.getRowsModified();
      const idRow = db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
      return { changes, lastInsertRowid: Number(idRow?.id ?? 0) };
    },
    exec(sql: string) {
      raw.exec(sql);
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
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
}
