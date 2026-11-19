// npm run db:reset — wipe and re-seed the Khagaria demo dataset.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

for (const f of ['zila-samanvay.db', 'zila-samanvay.db-wal', 'zila-samanvay.db-shm', 'zila-samanvay.sqljs.db']) {
  const p = path.join(DATA_DIR, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
const { openDatabase } = await import('./database');
const { engine, file } = await openDatabase(DATA_DIR, process.env.DB_ENGINE === 'sql.js' ? 'sql.js' : undefined);
console.log(`Re-seeded ${path.relative(ROOT, file)} (${engine}).`);
