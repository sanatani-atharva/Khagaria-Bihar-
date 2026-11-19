import { z } from 'zod';
import { AppError, audit, inScope, isExecutive, lookups, requireRole, requireUser, today } from '../context';
import { pendingFileByWork, scopedWorks } from '../issues';
import { resolveLinks, type LinkRow } from '../initiatives';
import { fileAging, workHealth } from '../rules';
import { insert, update } from '../sql';
import type { EvidenceMeta, FileRow, MilestoneRow, WorkRow, WorkStatus } from '../types';
import { WORK_STATUS_LABEL } from '../types';
import { daysBetween, financialYear } from '../time';
import { paginate, proc, zDate, zId, zPage, zText } from './_proc';

const WORK_STATUSES = ['not_started', 'in_progress', 'stalled', 'completed'] as const;

function decorate(ctx: Parameters<typeof scopedWorks>[0], w: WorkRow, pf?: { file_no: string; office: string; days: number }) {
  const l = lookups(ctx.db);
  const h = workHealth(w, today(ctx));
  const officer = w.officer_id ? l.user.get(w.officer_id) : undefined;
  return {
    ...w,
    blockName: l.block.get(w.block_id)?.name ?? '',
    departmentName: l.dept.get(w.department_id)?.name ?? '',
    departmentCode: l.dept.get(w.department_id)?.code ?? '',
    officerName: officer?.name ?? null,
    officerDesignation: officer?.designation ?? null,
    officerPhone: officer?.phone ?? null,
    statusLabel: WORK_STATUS_LABEL[w.status],
    financialPct: w.sanctioned_lakh ? Math.round((w.expenditure_lakh / w.sanctioned_lakh) * 1000) / 10 : 0,
    health: h,
    pendingFile: pf ?? null,
    riskScore: (h.delayed ? 50 : 0) + Math.min(30, h.overdueDays / 3) + Math.max(0, h.slip) / 2 + (w.status === 'stalled' ? 15 : 0),
  };
}

function canEditWork(ctx: { user: import('../types').UserRow | null }, w: WorkRow) {
  const u = ctx.user;
  if (!u) return false;
  return isExecutive(u) || w.officer_id === u.id || inScope(u, w.block_id, w.department_id);
}

// ---- import helpers (CSV / Excel rows already parsed in the browser) ----
const zImportRow = z.object({
  code: z.string().trim().max(60).optional().nullable(),
  name: z.string().trim().max(300).optional().nullable(),
  department: z.string().trim().max(80).optional().nullable(),
  block: z.string().trim().max(80).optional().nullable(),
  panchayat: z.string().trim().max(80).optional().nullable(),
  scheme: z.string().trim().max(120).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  sanctioned: z.union([z.number(), z.string()]).optional().nullable(),
  expenditure: z.union([z.number(), z.string()]).optional().nullable(),
  physical: z.union([z.number(), z.string()]).optional().nullable(),
  agency: z.string().trim().max(160).optional().nullable(),
  start: z.union([z.number(), z.string()]).optional().nullable(),
  target: z.union([z.number(), z.string()]).optional().nullable(),
  status: z.string().trim().max(40).optional().nullable(),
  nextAction: z.string().trim().max(400).optional().nullable(),
  remark: z.string().trim().max(400).optional().nullable(),
});
type ImportRow = z.infer<typeof zImportRow>;

export function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[₹,%\s]/g, '').replace(/lakh|lac|l$/i, ''));
  return Number.isFinite(n) ? n : null;
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, DD-Mon-YYYY or an Excel serial date. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{5}$/.test(String(v))) {
    const serial = Number(v);
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{4})$/);
  if (m) {
    const mi = months.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function normStatus(s: string | null | undefined): WorkStatus | null {
  if (!s) return null;
  const v = s.toLowerCase().replace(/[^a-z]/g, '');
  if (['completed', 'complete', 'done', 'finished'].includes(v)) return 'completed';
  if (['stalled', 'stopped', 'held', 'onhold', 'hold'].includes(v)) return 'stalled';
  if (['notstarted', 'yettostart', 'new', 'pending'].includes(v)) return 'not_started';
  if (['inprogress', 'ongoing', 'running', 'progress', 'wip'].includes(v)) return 'in_progress';
  return null;
}

export const worksProcs = {
  'works.list': proc({
    access: 'auth',
    input: z.object({
      q: z.string().trim().max(100).optional(),
      blockId: zId.optional(),
      departmentId: zId.optional(),
      status: z.enum(['all', 'delayed', 'not_started', 'in_progress', 'stalled', 'completed']).default('all'),
      publicOnly: z.boolean().optional(),
      sort: z.enum(['risk', 'name', 'value', 'progress', 'target', 'updated']).default('risk'),
      ...zPage,
    }),
    run: (ctx, input) => {
      requireUser(ctx);
      const pf = pendingFileByWork(ctx);
      let rows = scopedWorks(ctx).map((w) => decorate(ctx, w, pf.get(w.id)));
      if (input.blockId) rows = rows.filter((r) => r.block_id === input.blockId);
      if (input.departmentId) rows = rows.filter((r) => r.department_id === input.departmentId);
      if (input.publicOnly) rows = rows.filter((r) => r.public_approved);
      if (input.q) {
        const q = input.q.toLowerCase();
        rows = rows.filter((r) => `${r.code} ${r.name} ${r.panchayat ?? ''} ${r.agency ?? ''} ${r.scheme}`.toLowerCase().includes(q));
      }
      const all = rows;
      if (input.status === 'delayed') rows = rows.filter((r) => r.health.delayed);
      else if (input.status !== 'all') rows = rows.filter((r) => r.status === input.status);
      const sorters: Record<string, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
        risk: (a, b) => b.riskScore - a.riskScore,
        name: (a, b) => a.name.localeCompare(b.name),
        value: (a, b) => b.sanctioned_lakh - a.sanctioned_lakh,
        progress: (a, b) => a.physical_pct - b.physical_pct,
        target: (a, b) => (a.target_date ?? '').localeCompare(b.target_date ?? ''),
        updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      };
      rows.sort(sorters[input.sort]);
      const sanctioned = rows.reduce((s, r) => s + r.sanctioned_lakh, 0);
      const spent = rows.reduce((s, r) => s + r.expenditure_lakh, 0);
      return {
        ...paginate(rows, input.page, input.pageSize),
        totals: {
          sanctionedLakh: Math.round(sanctioned * 10) / 10,
          expenditureLakh: Math.round(spent * 10) / 10,
          financialPct: sanctioned ? Math.round((spent / sanctioned) * 1000) / 10 : 0,
          avgPhysical: rows.length ? Math.round(rows.reduce((s, r) => s + r.physical_pct, 0) / rows.length) : 0,
        },
        statusCounts: {
          all: all.length,
          delayed: all.filter((r) => r.health.delayed).length,
          not_started: all.filter((r) => r.status === 'not_started').length,
          in_progress: all.filter((r) => r.status === 'in_progress').length,
          stalled: all.filter((r) => r.status === 'stalled').length,
          completed: all.filter((r) => r.status === 'completed').length,
        },
      };
    },
  }),

  'works.get': proc({
    access: 'auth',
    input: z.object({ id: zId }),
    run: (ctx, { id }) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const w = ctx.db.get<WorkRow>('SELECT * FROM works WHERE id = ?', [id]);
      if (!w) throw new AppError(404, 'Work not found');
      if (!canEditWork(ctx, w) && !isExecutive(u)) {
        // read access follows jurisdiction too
        throw new AppError(403, 'This work is outside your jurisdiction.');
      }
      const pf = pendingFileByWork(ctx).get(w.id);
      const milestones = ctx.db.all<MilestoneRow>('SELECT * FROM work_milestones WHERE work_id = ? ORDER BY seq', [id]).map((m) => ({
        ...m,
        state: m.actual_date ? 'done' : m.planned_date < t ? 'overdue' : 'upcoming',
        lateBy: m.actual_date ? daysBetween(m.planned_date, m.actual_date) : m.planned_date < t ? daysBetween(m.planned_date, t) : 0,
      }));
      const updates = ctx.db
        .all<{ id: number; at: string; physical_pct: number; expenditure_lakh: number; remark: string | null; source: string; user_id: number | null }>(
          'SELECT id, at, physical_pct, expenditure_lakh, remark, source, user_id FROM work_updates WHERE work_id = ? ORDER BY at DESC',
          [id],
        )
        .map((x) => ({ ...x, userName: x.user_id ? l.user.get(x.user_id)?.name ?? null : null }));
      const files = ctx.db.all<FileRow>('SELECT * FROM files WHERE work_id = ? ORDER BY opened_at DESC', [id]).map((f) => ({
        id: f.id,
        file_no: f.file_no,
        subject: f.subject,
        status: f.status,
        officeName: l.office.get(f.current_office_id)?.name ?? '',
        holderName: f.current_holder_id ? l.user.get(f.current_holder_id)?.name ?? null : null,
        aging: fileAging(f, t),
        decision_required: f.decision_required,
      }));
      const evidence = ctx.db.all<EvidenceMeta>(
        "SELECT id, entity_type, entity_id, file_name, mime, size, sha256, note, uploaded_by, uploaded_at, review_status, reviewed_by, reviewed_at, review_remark FROM evidence WHERE entity_type = 'work' AND entity_id = ? ORDER BY uploaded_at DESC",
        [id],
      );
      const linkRows = ctx.db.all<LinkRow & { title: string }>(
        "SELECT il.*, i.title FROM initiative_links il JOIN initiatives i ON i.id = il.initiative_id WHERE il.ref_type = 'work' AND il.ref_id = ?",
        [id],
      );
      const initiatives = linkRows.map((r) => ({ id: r.initiative_id, title: r.title, role: r.label, state: resolveLinks(ctx, [r])[0] }));
      const history = ctx.db.all<{ id: number; at: string; user_name: string; action: string; summary: string }>(
        "SELECT id, at, user_name, action, summary FROM audit_log WHERE entity_type = 'work' AND entity_id = ? ORDER BY at DESC LIMIT 30",
        [id],
      );
      return {
        work: decorate(ctx, w, pf),
        milestones,
        updates,
        files,
        evidence,
        initiatives,
        history,
        canEdit: canEditWork(ctx, w),
        canApprovePublic: isExecutive(u),
      };
    },
  }),

  'works.updateProgress': proc({
    access: 'auth',
    mutation: true,
    input: z.object({
      id: zId,
      physicalPct: z.number().min(0).max(100),
      expenditureLakh: z.number().min(0),
      remark: zText(400).min(3, 'Add a short remark'),
      status: z.enum(WORK_STATUSES).optional(),
      holdReason: zText(400).optional().nullable(),
      nextAction: zText(400).optional().nullable(),
      nextActionDue: zDate.optional().nullable(),
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const w = ctx.db.get<WorkRow>('SELECT * FROM works WHERE id = ?', [input.id]);
      if (!w) throw new AppError(404, 'Work not found');
      if (!canEditWork(ctx, w)) throw new AppError(403, 'Only the responsible officer or a supervising officer can update this work.');
      if (input.expenditureLakh > w.sanctioned_lakh * 1.25) throw new AppError(400, `Expenditure ₹${input.expenditureLakh} L exceeds 125% of the sanctioned ₹${w.sanctioned_lakh} L. Record a revised sanction first.`);
      let status: WorkStatus = input.status ?? w.status;
      if (input.physicalPct >= 100) status = 'completed';
      else if (status === 'completed') status = 'in_progress';
      if (status === 'not_started' && input.physicalPct > 0) status = 'in_progress';
      if (status === 'stalled' && !(input.holdReason ?? w.hold_reason)) throw new AppError(400, 'Give the reason the work is stalled.');
      const at = ctx.now.toISOString();
      update(ctx.db, 'works', w.id, {
        physical_pct: input.physicalPct,
        expenditure_lakh: input.expenditureLakh,
        status,
        hold_reason: status === 'completed' ? null : input.holdReason !== undefined ? input.holdReason || null : w.hold_reason,
        next_action: input.nextAction !== undefined ? input.nextAction || null : w.next_action,
        next_action_due: input.nextActionDue !== undefined ? input.nextActionDue || null : w.next_action_due,
        updated_at: at,
      });
      insert(ctx.db, 'work_updates', { work_id: w.id, user_id: u.id, at, physical_pct: input.physicalPct, expenditure_lakh: input.expenditureLakh, remark: input.remark, source: 'manual' });
      audit(ctx, 'work.progress', 'work', w.id, `${w.code}: physical ${w.physical_pct}% → ${input.physicalPct}%, expenditure ₹${w.expenditure_lakh} → ₹${input.expenditureLakh} L (${WORK_STATUS_LABEL[status]})`, { remark: input.remark });
      return { ok: true, status };
    },
  }),

  'works.milestone': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ milestoneId: zId, actualDate: zDate.nullable() }),
    run: (ctx, input) => {
      requireUser(ctx);
      const m = ctx.db.get<MilestoneRow>('SELECT * FROM work_milestones WHERE id = ?', [input.milestoneId]);
      if (!m) throw new AppError(404, 'Milestone not found');
      const w = ctx.db.get<WorkRow>('SELECT * FROM works WHERE id = ?', [m.work_id])!;
      if (!canEditWork(ctx, w)) throw new AppError(403, 'Not permitted.');
      if (input.actualDate && input.actualDate > today(ctx)) throw new AppError(400, 'Completion date cannot be in the future.');
      update(ctx.db, 'work_milestones', m.id, { actual_date: input.actualDate });
      update(ctx.db, 'works', w.id, { updated_at: ctx.now.toISOString() });
      audit(ctx, 'work.milestone', 'work', w.id, `${w.code}: milestone "${m.name}" ${input.actualDate ? `completed on ${input.actualDate}` : 'marked pending'}`);
      return { ok: true };
    },
  }),

  'works.setPublic': proc({
    access: ['dm', 'ddc'],
    mutation: true,
    input: z.object({ id: zId, approved: z.boolean(), summary: zText(400).optional().nullable() }),
    run: (ctx, input) => {
      const u = requireRole(ctx, ['dm', 'ddc']);
      const w = ctx.db.get<WorkRow>('SELECT * FROM works WHERE id = ?', [input.id]);
      if (!w) throw new AppError(404, 'Work not found');
      if (input.approved && !(input.summary ?? w.public_summary)) throw new AppError(400, 'Write a short public summary before publishing.');
      update(ctx.db, 'works', w.id, {
        public_approved: input.approved ? 1 : 0,
        public_summary: input.summary ?? w.public_summary,
        approved_by: input.approved ? u.id : null,
        approved_at: input.approved ? ctx.now.toISOString() : null,
      });
      audit(ctx, input.approved ? 'work.publish' : 'work.unpublish', 'work', w.id, `${w.code}: ${input.approved ? 'approved for' : 'withdrawn from'} the public portal`);
      return { ok: true };
    },
  }),

  /**
   * Bulk import / update from an existing departmental sheet (CSV or Excel parsed in the
   * browser). Rows are matched by work code, else by name + block; matched rows are updated
   * in place so departments never enter the same work twice. dryRun validates only.
   */
  'works.import': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ fileName: z.string().trim().min(1).max(200), dryRun: z.boolean(), rows: z.array(zImportRow).min(1).max(5000) }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const findDept = (s: string | null | undefined) => {
        if (!s) return undefined;
        const n = norm(s);
        return l.departments.find((d) => norm(d.code) === n || norm(d.name) === n || norm(d.name).startsWith(n) || n.startsWith(norm(d.code)));
      };
      const findBlock = (s: string | null | undefined) => {
        if (!s) return undefined;
        const n = norm(s).replace(/block$/, '');
        return l.blocks.find((b) => norm(b.code) === n || norm(b.name) === n);
      };
      const results: { row: number; action: 'create' | 'update' | 'unchanged' | 'error'; code: string | null; name: string | null; messages: string[] }[] = [];
      let created = 0;
      let updated = 0;
      let failed = 0;
      let seq = (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM works')?.n ?? 0) + 1;
      input.rows.forEach((r: ImportRow, idx) => {
        const rowNo = idx + 2; // header is row 1
        const messages: string[] = [];
        let existing: WorkRow | undefined;
        if (r.code) existing = ctx.db.get<WorkRow>('SELECT * FROM works WHERE code = ?', [r.code]);
        const block = findBlock(r.block) ?? (existing ? l.block.get(existing.block_id) : undefined);
        const dept = findDept(r.department) ?? (existing ? l.dept.get(existing.department_id) : undefined);
        if (!existing && r.name && block) existing = ctx.db.get<WorkRow>('SELECT * FROM works WHERE lower(name) = lower(?) AND block_id = ?', [r.name, block.id]);
        if (r.block && !findBlock(r.block)) messages.push(`Unknown block "${r.block}" — use one of ${l.blocks.map((b) => b.name).join(', ')}`);
        if (r.department && !findDept(r.department)) messages.push(`Unknown department "${r.department}"`);
        const sanctioned = parseNum(r.sanctioned);
        const expenditure = parseNum(r.expenditure);
        const physical = parseNum(r.physical);
        const start = parseDate(r.start);
        const target = parseDate(r.target);
        if (r.sanctioned != null && r.sanctioned !== '' && sanctioned === null) messages.push(`Sanctioned amount "${r.sanctioned}" is not a number`);
        if (physical !== null && (physical < 0 || physical > 100)) messages.push(`Physical progress ${physical} must be 0–100`);
        if (r.start && !start) messages.push(`Start date "${r.start}" not understood (use DD-MM-YYYY)`);
        if (r.target && !target) messages.push(`Target date "${r.target}" not understood (use DD-MM-YYYY)`);
        const status = normStatus(r.status);
        if (r.status && !status) messages.push(`Status "${r.status}" not understood`);
        if (!existing) {
          if (!r.name) messages.push('Work name is required for a new work');
          if (!block) messages.push('Block is required for a new work');
          if (!dept) messages.push('Department is required for a new work');
          if (sanctioned === null) messages.push('Sanctioned amount (₹ lakh) is required for a new work');
        }
        const blockId = block?.id ?? existing?.block_id ?? null;
        const deptId = dept?.id ?? existing?.department_id ?? null;
        if (blockId && deptId && !inScope(u, blockId, deptId)) messages.push('Outside your jurisdiction — only rows for your own department / block can be imported');
        const sanc = sanctioned ?? existing?.sanctioned_lakh ?? 0;
        if (expenditure !== null && sanc && expenditure > sanc * 1.25) messages.push(`Expenditure ${expenditure} exceeds 125% of sanction ${sanc}`);
        if (messages.length) {
          failed++;
          results.push({ row: rowNo, action: 'error', code: r.code ?? existing?.code ?? null, name: r.name ?? existing?.name ?? null, messages });
          return;
        }
        const at = ctx.now.toISOString();
        const src = `import:${input.fileName}`;
        if (existing) {
          const patch: Record<string, unknown> = {};
          const set = (k: keyof WorkRow, v: unknown) => {
            if (v !== null && v !== undefined && v !== '' && existing![k] !== v) patch[k] = v;
          };
          set('name', r.name);
          set('panchayat', r.panchayat);
          set('scheme', r.scheme);
          set('category', r.category);
          set('agency', r.agency);
          set('sanctioned_lakh', sanctioned);
          set('expenditure_lakh', expenditure);
          set('physical_pct', physical);
          set('start_date', start);
          set('target_date', target);
          set('next_action', r.nextAction);
          let st = status ?? existing.status;
          if ((physical ?? existing.physical_pct) >= 100) st = 'completed';
          set('status', st);
          if (!Object.keys(patch).length) {
            results.push({ row: rowNo, action: 'unchanged', code: existing.code, name: existing.name, messages: ['No change from the current record'] });
            return;
          }
          updated++;
          results.push({ row: rowNo, action: 'update', code: existing.code, name: existing.name, messages: Object.keys(patch).map((k) => `${k}: ${String(existing![k as keyof WorkRow] ?? '—')} → ${String(patch[k])}`) });
          if (!input.dryRun) {
            update(ctx.db, 'works', existing.id, { ...patch, source: src, updated_at: at });
            if ('physical_pct' in patch || 'expenditure_lakh' in patch) {
              insert(ctx.db, 'work_updates', {
                work_id: existing.id, user_id: u.id, at, physical_pct: physical ?? existing.physical_pct, expenditure_lakh: expenditure ?? existing.expenditure_lakh,
                remark: r.remark || `Imported from ${input.fileName}`, source: 'import',
              });
            }
          }
        } else {
          const blk = block!;
          const dp = dept!;
          const code = r.code || `${dp.code}/${blk.code}/${financialYear(start ?? t)}/${String(seq++).padStart(3, '0')}`;
          created++;
          results.push({ row: rowNo, action: 'create', code, name: r.name!, messages: [] });
          if (!input.dryRun) {
            const id = insert(ctx.db, 'works', {
              code, name: r.name, category: r.category || 'Other', scheme: r.scheme || 'Not specified', department_id: dp.id, block_id: blk.id,
              panchayat: r.panchayat || null, sanctioned_lakh: sanctioned, expenditure_lakh: expenditure ?? 0, physical_pct: physical ?? 0,
              agency: r.agency || null, start_date: start, target_date: target,
              status: (physical ?? 0) >= 100 ? 'completed' : status ?? ((physical ?? 0) > 0 ? 'in_progress' : 'not_started'),
              officer_id: u.role === 'block_officer' || u.role === 'dept_officer' ? u.id : null, next_action: r.nextAction || null,
              next_action_due: null, hold_reason: null, public_approved: 0, public_summary: null, approved_by: null, approved_at: null,
              source: src, created_at: at, updated_at: at,
            });
            if ((physical ?? 0) > 0) insert(ctx.db, 'work_updates', { work_id: id, user_id: u.id, at, physical_pct: physical ?? 0, expenditure_lakh: expenditure ?? 0, remark: `Imported from ${input.fileName}`, source: 'import' });
          }
        }
      });
      let batchId: number | null = null;
      if (!input.dryRun) {
        batchId = insert(ctx.db, 'import_batches', {
          at: ctx.now.toISOString(), user_id: u.id, dataset: 'works', file_name: input.fileName, total: input.rows.length, created, updated, failed,
          errors: JSON.stringify(results.filter((r) => r.action === 'error').slice(0, 200).map((r) => ({ row: r.row, message: r.messages.join('; ') }))),
        });
        audit(ctx, 'works.import', 'import', batchId, `Imported ${input.fileName}: ${created} created, ${updated} updated, ${failed} rejected`);
      }
      return { dryRun: input.dryRun, batchId, total: input.rows.length, created, updated, failed, unchanged: results.filter((r) => r.action === 'unchanged').length, results };
    },
  }),

  'import.batches': proc({
    access: 'auth',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const own = !isExecutive(u);
      return ctx.db
        .all<{ id: number; at: string; user_id: number | null; dataset: string; file_name: string; total: number; created: number; updated: number; failed: number; errors: string | null }>(
          own ? 'SELECT * FROM import_batches WHERE user_id = ? ORDER BY at DESC LIMIT 50' : 'SELECT * FROM import_batches ORDER BY at DESC LIMIT 50',
          own ? [u.id] : [],
        )
        .map((b) => ({ ...b, userName: b.user_id ? l.user.get(b.user_id)?.name ?? null : null, errors: b.errors ? (JSON.parse(b.errors) as { row: number; message: string }[]) : [] }));
    },
  }),
};
