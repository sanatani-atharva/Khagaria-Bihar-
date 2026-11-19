import type { Db } from './db';

/** INSERT a row object; returns the new id. Table/column names are code constants, never user input. */
export function insert(db: Db, table: string, row: Record<string, unknown>): number {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return db.run(sql, keys.map((k) => row[k])).lastInsertRowid;
}

/** UPDATE by id with a partial row object. */
export function update(db: Db, table: string, id: number, row: Record<string, unknown>): void {
  const keys = Object.keys(row);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.run(sql, [...keys.map((k) => row[k]), id]);
}

/** Build "a IN (?,?,?)" safely. Returns '0' (false) for an empty list. */
export function inList(column: string, values: number[]): { sql: string; params: number[] } {
  if (!values.length) return { sql: '0', params: [] };
  return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
}
