// Core behaviour tests: run with `npm test` (Node's built-in test runner via tsx).
// Each test gets a fresh in-memory SQLite (sql.js) seeded with the Khagaria demo data,
// and drives the same `execute()` entry point the server and the offline build use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sqlJsAdapter, type Db, type SqlJsDatabase } from '../src/core/db';
import { initSchema, seed } from '../src/core/seed';
import { execute } from '../src/core/rpc';
import type { Ctx } from '../src/core/context';
import type { UserRow } from '../src/core/types';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js') as () => Promise<{ Database: new () => SqlJsDatabase }>;

const NOW = new Date('2026-12-05T06:00:00.000Z');

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs();
  const db = sqlJsAdapter(new SQL.Database());
  initSchema(db);
  seed(db, NOW);
  return db;
}

function as(db: Db, designationLike: string): Ctx {
  const user = db.get<UserRow>('SELECT * FROM users WHERE designation LIKE ? LIMIT 1', [`${designationLike}%`]);
  assert.ok(user, `no user ${designationLike}`);
  return { db, user, now: NOW };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: string, input: unknown, ctx: Ctx) => execute(name, input, ctx) as any;

test('seed builds a complete Khagaria dataset', async () => {
  const db = await freshDb();
  const n = (t: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
  assert.equal(n('blocks'), 7);
  assert.ok(n('works') >= 100);
  assert.ok(n('assets') >= 140);
  assert.ok(n('files') >= 50);
  assert.equal(n('scheme_targets'), 8 * 7);
  assert.equal(n('initiatives'), 4);
});

test('priority engine ranks the cross-department school case first and explains why', async () => {
  const db = await freshDb();
  const agenda = run('review.agenda', { limit: 10 }, as(db, 'District Magistrate'));
  const top = agenda.items[0];
  assert.equal(top.category, 'coordination');
  assert.match(top.title, /UMS Raunia/);
  assert.ok(top.departmentNames.length >= 3, 'needs Education, PHED and Finance');
  assert.ok(top.reasons.some((r: string) => /District Treasury/.test(r)), 'names the Treasury file as a blocker');
  const total = top.factors.reduce((s: number, f: { points: number }) => s + f.points, 0);
  assert.equal(top.score, Math.max(0, Math.round(total)), 'score equals the sum of its factors');
  for (const c of ['work_delay', 'file_delay', 'critical_finding', 'service_gap', 'coordination']) {
    assert.ok(agenda.counts[c] > 0, `agenda has ${c} items`);
  }
});

test('items folded into a coordination item are not repeated as separate agenda lines', async () => {
  const db = await freshDb();
  const agenda = run('review.agenda', { limit: 200 }, as(db, 'District Magistrate'));
  const keys = new Set(agenda.items.map((i: { key: string }) => i.key));
  const school = agenda.items.find((i: { key: string; relatedKeys: string[] }) => i.key.startsWith('initiative:') && i.relatedKeys.length);
  for (const k of school.relatedKeys) assert.ok(!keys.has(k), `${k} should be folded into the initiative`);
});

test('file movement: only the holder can act; forward updates desk, timestamps and audit', async () => {
  const db = await freshDb();
  const file = db.get<{ id: number; current_holder_id: number }>("SELECT id, current_holder_id FROM files WHERE file_no = 'EDN/ALA/2026/118'")!;
  const bdo = as(db, 'Block Development Officer, Gogri');
  assert.throws(() => run('files.act', { id: file.id, action: 'approve', remark: 'Approved as proposed' }, bdo), /holding this file|cannot/);
  const dto = as(db, 'District Treasury Officer');
  assert.equal(dto.user!.id, file.current_holder_id);
  const ddcOffice = db.get<{ id: number }>("SELECT id FROM offices WHERE name LIKE 'DDC Office%'")!.id;
  const out = run('files.act', { id: file.id, action: 'forward', toOfficeId: ddcOffice, remark: 'Budget available under 2202-01; allotment advice issued.' }, dto);
  assert.equal(out.status, 'open');
  const after = db.get<{ current_office_id: number; arrived_at: string }>('SELECT current_office_id, arrived_at FROM files WHERE id = ?', [file.id])!;
  assert.equal(after.current_office_id, ddcOffice);
  assert.equal(after.arrived_at, NOW.toISOString());
  const audit = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'file' AND entity_id = ? AND action = 'file.forwarded' AND at = ?", [file.id, NOW.toISOString()])!;
  assert.equal(audit.n, 1);
});

test('a finding cannot be closed without evidence, and the uploader cannot verify it', async () => {
  const db = await freshDb();
  const f = db.get<{ id: number; assigned_to: number }>("SELECT id, assigned_to FROM findings WHERE title LIKE 'Handpump non-functional; FTK%'")!;
  const je = as(db, 'Junior Engineer, PHED (Alauli)');
  assert.equal(je.user!.id, f.assigned_to);
  assert.throws(() => run('findings.submitResolution', { findingId: f.id, note: 'Repaired the handpump' }, je), /evidence/i);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const sub = run('findings.submitResolution', { findingId: f.id, note: 'Riser pipe replaced; FTK iron 0.3 mg/L', evidence: { fileName: 'hp.png', mime: 'image/png', dataUrl: png, size: 70 } }, je);
  assert.ok(sub.evidenceId);
  // EE PHED supervises PHED findings, but the JE (uploader) must not be able to verify
  assert.throws(() => run('findings.verify', { findingId: f.id, evidenceId: sub.evidenceId, decision: 'accept', remark: 'Looks fine' }, je), /department head|Separation|verify/i);
  const ee = as(db, 'Executive Engineer, PHED');
  run('findings.verify', { findingId: f.id, evidenceId: sub.evidenceId, decision: 'accept', remark: 'Verified on site' }, ee);
  assert.equal(db.get<{ status: string }>('SELECT status FROM findings WHERE id = ?', [f.id])!.status, 'closed');
});

test('public portal returns only approved works and never internal fields', async () => {
  const db = await freshDb();
  const pub: Ctx = { db, user: null, now: NOW };
  const works = run('public.works', {}, pub);
  const approved = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM works WHERE public_approved = 1')!.n;
  assert.equal(works.length, approved);
  for (const w of works) {
    for (const k of ['hold_reason', 'next_action', 'officer_id', 'expenditure_lakh', 'source']) assert.ok(!(k in w), `public work leaks ${k}`);
  }
  const fac = run('public.facilities', {}, pub);
  assert.ok(fac.length > 0);
  assert.ok(!('condition' in fac[0]) && !('officer_id' in fac[0]));
  assert.throws(() => run('files.list', {}, pub), /sign in/i);
  assert.throws(() => run('dashboard.summary', {}, pub), /sign in/i);
});

test('jurisdiction: a block officer sees only their block', async () => {
  const db = await freshDb();
  const bdo = as(db, 'Block Development Officer, Alauli');
  const works = run('works.list', { pageSize: 200 }, bdo);
  assert.ok(works.total > 0);
  assert.ok(works.rows.every((w: { blockName: string }) => w.blockName === 'Alauli'));
  const other = db.get<{ id: number }>("SELECT w.id FROM works w JOIN blocks b ON b.id = w.block_id WHERE b.name = 'Gogri' LIMIT 1")!;
  assert.throws(() => run('works.get', { id: other.id }, bdo), /jurisdiction/);
});

test('works import upserts by code (no double entry) and rejects bad rows', async () => {
  const db = await freshDb();
  const ee = as(db, 'Executive Engineer, RWD');
  const w = db.get<{ code: string; physical_pct: number }>("SELECT code, physical_pct FROM works WHERE department_id = (SELECT id FROM departments WHERE code = 'RWD') AND status != 'completed' LIMIT 1")!;
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM works')!.n;
  const rows = [
    { code: w.code, physical: String(Math.min(99, w.physical_pct + 5)), expenditure: '10' },
    { name: 'New culvert at Sherchakla', block: 'Gogri', department: 'RWD', sanctioned: '32.5', start: '01-12-2026', target: '31-05-2027' },
    { name: 'Bad row', block: 'Gogri Jamalpur', department: 'RWD', sanctioned: 'abc' },
  ];
  const dry = run('works.import', { fileName: 't.csv', dryRun: true, rows }, ee);
  assert.deepEqual([dry.updated, dry.created, dry.failed], [1, 1, 1]);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM works')!.n, before, 'dry run writes nothing');
  run('works.import', { fileName: 't.csv', dryRun: false, rows }, ee);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM works')!.n, before + 1);
});

test('review decision logger creates an owned action that the tracker follows to closure', async () => {
  const db = await freshDb();
  const dm = as(db, 'District Magistrate');
  const item = run('review.agenda', { category: 'service_gap', limit: 1 }, dm).items[0];
  const moic = as(db, 'MOIC, PHC Alauli');
  const { id } = run('review.logDecision', { agendaKey: item.key, category: item.category, title: item.title, decision: 'Hold catch-up sessions', assignedTo: moic.user!.id, deadline: '2026-12-20', refType: item.refType, refId: item.refId }, dm);
  assert.throws(() => run('review.verifyAction', { id, evidenceId: 1, decision: 'accept', remark: 'Self check' }, moic), /role/);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { evidenceId } = run('review.submitActionEvidence', { id, note: 'Sessions held in 12 sub-centres', evidence: { fileName: 'r.png', mime: 'image/png', dataUrl: png, size: 70 } }, moic);
  run('review.verifyAction', { id, evidenceId, decision: 'accept', remark: 'Coverage verified' }, dm);
  assert.equal(db.get<{ status: string }>('SELECT status FROM action_items WHERE id = ?', [id])!.status, 'closed');
});

test('procedure lookup ignores prototype keys', async () => {
  const db = await freshDb();
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => run(name, {}, as(db, 'District Magistrate')), /Unknown procedure/);
  }
});

test('DM can define an inter-department initiative from live records; single-department chains are refused', async () => {
  const db = await freshDb();
  const dm = as(db, 'District Magistrate');
  const blk = db.get<{ id: number }>("SELECT id FROM blocks WHERE name = 'Khagaria'")!.id;
  const c = run('deps.candidates', { blockId: blk }, dm);
  const edu = c.works.find((w: { departmentName: string }) => w.departmentName === 'Education');
  const phed = c.works.find((w: { departmentName: string }) => w.departmentName.startsWith('Public Health'));
  const edu2 = c.works.filter((w: { departmentName: string }) => w.departmentName === 'Education')[1];
  assert.throws(() => run('deps.create', { title: 'Single dept test', outcome: 'Should fail', blockId: blk, links: [
    { label: 'Repair one', refType: 'work', refId: edu.refId }, { label: 'Repair two', refType: 'work', refId: edu2.refId }] }, dm), /at least two departments/);
  const out = run('deps.create', { title: 'School upgrade — test', outcome: 'Classrooms and water', blockId: blk, links: [
    { label: 'Water supply', refType: 'work', refId: phed.refId }, { label: 'Classrooms', refType: 'work', refId: edu.refId, dependsOn: 0 }] }, dm);
  const list = run('deps.list', { id: out.id }, dm);
  assert.equal(list[0].links.length, 2);
  assert.equal(list[0].links[1].depends_on_link_id, list[0].links[0].id);
  assert.throws(() => run('deps.create', { title: 'x'.repeat(10), outcome: 'y'.repeat(10), blockId: blk, links: [] }, as(db, 'Block Development Officer, Khagaria')), /role/);
});

test('annual targets: department officer may set own scheme targets, block officer may not', async () => {
  const db = await freshDb();
  const sch = db.get<{ id: number }>("SELECT id FROM schemes WHERE code = 'HLT-FIC'")!.id;
  const blk = db.get<{ id: number }>("SELECT id FROM blocks WHERE name = 'Alauli'")!.id;
  assert.throws(() => run('schemes.setTarget', { schemeId: sch, blockId: blk, annualTarget: 9000, reason: 'Test' }, as(db, 'MOIC, PHC Alauli')), /Targets are set/);
  run('schemes.setTarget', { schemeId: sch, blockId: blk, annualTarget: 9000, reason: 'Revised per state letter' }, as(db, 'Civil Surgeon'));
  assert.equal(db.get<{ t: number }>('SELECT annual_target AS t FROM scheme_targets WHERE scheme_id = ? AND block_id = ?', [sch, blk])!.t, 9000);
});

test('an officer can still open a file they forwarded out of their jurisdiction', async () => {
  const db = await freshDb();
  const file = db.get<{ id: number }>("SELECT id FROM files WHERE file_no = 'EDN/ALA/2026/118'")!;
  const dto = as(db, 'District Treasury Officer');
  const ddcOffice = db.get<{ id: number }>("SELECT id FROM offices WHERE name LIKE 'DDC Office%'")!.id;
  run('files.act', { id: file.id, action: 'forward', toOfficeId: ddcOffice, remark: 'Allotment advice issued' }, dto);
  const got = run('files.get', { id: file.id }, dto);
  assert.equal(got.allowedActions.length, 0, 'read-only once it has moved on');
  assert.throws(() => run('files.get', { id: file.id }, as(db, 'Block Development Officer, Gogri')), /not found|jurisdiction/);
});

test('evidence must really be a photo or PDF (magic bytes), not a renamed HTML file', async () => {
  const db = await freshDb();
  const f = db.get<{ id: number }>("SELECT id FROM findings WHERE title LIKE 'Handpump non-functional; FTK%'")!;
  const je = as(db, 'Junior Engineer, PHED (Alauli)');
  const html = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  assert.throws(() => run('findings.submitResolution', { findingId: f.id, note: 'Repaired the handpump', evidence: { fileName: 'x.png', mime: 'image/png', dataUrl: html, size: 40 } }, je), /valid photo or PDF/);
});

test('audit lookups by record are DM / DDC only', async () => {
  const db = await freshDb();
  assert.throws(() => run('audit.entity', { entityType: 'file', entityId: 1 }, as(db, 'Block Development Officer, Gogri')), /role/);
  assert.ok(Array.isArray(run('audit.entity', { entityType: 'file', entityId: 1 }, as(db, 'District Magistrate'))));
});
