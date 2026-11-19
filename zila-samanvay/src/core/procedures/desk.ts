import { z } from 'zod';
import { AppError, audit as _audit, isExecutive, lookups, requireRole, requireUser, today } from '../context';
import { actionIssue, fileIssue, findingIssue, findingScope, pendingFileByWork, scopedActions, scopedWorks, workIssue } from '../issues';
import { resolveLinks, summariseInitiative, type InitiativeRow, type LinkRow } from '../initiatives';
import { fileAging, workHealth } from '../rules';
import type { FileRow, InspectionRow } from '../types';
import { addDays, daysBetween } from '../time';
import { initSchema, seed, wipe } from '../seed';
import { insert } from '../sql';
import { invalidateLookups } from '../context';
import { paginate, proc, zId } from './_proc';

export const deskProcs = {
  /** Officer's personal work queue: everything waiting on *this* officer, in one place. */
  'desk.mine': proc({
    access: 'auth',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const files = ctx.db
        .all<FileRow>("SELECT * FROM files WHERE status IN ('open','query','approved') AND (current_holder_id = ? OR (current_holder_id IS NULL AND current_office_id = ?))", [u.id, u.office_id ?? -1])
        .map((f) => ({ f, a: fileAging(f, t) }))
        .sort((x, y) => y.a.overSla - x.a.overSla || y.a.daysAtDesk - x.a.daysAtDesk)
        .map((x) => fileIssue(ctx, x.f));
      const fs = findingScope(u);
      const findingsAssigned = ctx.db
        .all<Parameters<typeof findingIssue>[1]>(
          `SELECT f.*, a.name AS asset_name, a.block_id AS asset_block, a.department_id AS asset_dept FROM findings f JOIN assets a ON a.id = f.asset_id
            WHERE f.assigned_to = ? AND f.status IN ('assigned','open') ORDER BY f.due_date`,
          [u.id],
        )
        .map((f) => findingIssue(ctx, f));
      // supervisors: unassigned findings to allocate, and evidence to verify
      const supervisor = isExecutive(u) || u.role === 'dept_officer' || (u.role === 'block_officer' && !u.department_id);
      const findingsToAssign = supervisor
        ? ctx.db
            .all<Parameters<typeof findingIssue>[1]>(
              `SELECT f.*, a.name AS asset_name, a.block_id AS asset_block, a.department_id AS asset_dept FROM findings f JOIN assets a ON a.id = f.asset_id
                WHERE f.status = 'open' AND ${fs.sql} ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, f.created_at LIMIT 40`,
              fs.params,
            )
            .map((f) => findingIssue(ctx, f))
        : [];
      const toVerify = supervisor
        ? ctx.db
            .all<Parameters<typeof findingIssue>[1]>(
              `SELECT f.*, a.name AS asset_name, a.block_id AS asset_block, a.department_id AS asset_dept FROM findings f JOIN assets a ON a.id = f.asset_id
                WHERE f.status = 'resolution_submitted' AND ${fs.sql}
                  AND EXISTS (SELECT 1 FROM evidence e WHERE e.entity_type = 'finding' AND e.entity_id = f.id AND e.review_status = 'pending' AND (e.uploaded_by IS NULL OR e.uploaded_by != ?))
                ORDER BY f.updated_at LIMIT 40`,
              [...fs.params, u.id],
            )
            .map((f) => findingIssue(ctx, f))
        : [];
      const actionsToVerify = isExecutive(u) ? scopedActions(ctx, "status = 'resolution_submitted'").map((a) => actionIssue(ctx, a)) : [];
      const actions = scopedActions(ctx, "assigned_to = ? AND status != 'closed'", [u.id])
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .map((a) => actionIssue(ctx, a));
      const pf = pendingFileByWork(ctx);
      const works = scopedWorks(ctx, "officer_id = ? AND status != 'completed'", [u.id])
        .map((w) => ({ issue: workIssue(ctx, w, pf.get(w.id)), staleDays: workHealth(w, t).staleDays }))
        .sort((a, b) => b.staleDays - a.staleDays)
        .map((x) => ({ ...x.issue, staleDays: x.staleDays }));
      const inspections = ctx.db
        .all<InspectionRow & { asset_name: string; asset_code: string; block_id: number }>(
          `SELECT i.*, a.name AS asset_name, a.code AS asset_code, a.block_id FROM inspections i JOIN assets a ON a.id = i.asset_id
            WHERE i.status = 'scheduled' AND i.inspector_id = ? AND i.scheduled_date <= ? ORDER BY i.scheduled_date LIMIT 50`,
          [u.id, addDays(t, 30)],
        )
        .map((i) => ({ id: i.id, assetId: i.asset_id, assetName: i.asset_name, assetCode: i.asset_code, blockName: l.block.get(i.block_id)?.name ?? '', scheduledDate: i.scheduled_date, overdueBy: Math.max(0, daysBetween(i.scheduled_date, t)), link: `/assets/${i.asset_id}` }));
      return {
        user: { id: u.id, name: u.name, designation: u.designation },
        files,
        findingsAssigned,
        findingsToAssign,
        toVerify,
        actionsToVerify,
        actions,
        works,
        inspections,
        counts: {
          files: files.length,
          findings: findingsAssigned.length,
          toAssign: findingsToAssign.length,
          toVerify: toVerify.length + actionsToVerify.length,
          actions: actions.length,
          worksToUpdate: works.filter((w) => w.staleDays > 14).length,
          inspections: inspections.length,
        },
      };
    },
  }),

  /** Cross-department dependency chains with the bottleneck called out. */
  'deps.list': proc({
    access: 'auth',
    input: z.object({ id: zId.optional() }).prefault({}),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const inis = ctx.db.all<InitiativeRow>(input.id ? 'SELECT * FROM initiatives WHERE id = ?' : 'SELECT * FROM initiatives ORDER BY target_date', input.id ? [input.id] : []);
      const links = ctx.db.all<LinkRow>('SELECT * FROM initiative_links ORDER BY id');
      return inis
        .map((ini) => {
          const states = resolveLinks(ctx, links.filter((x) => x.initiative_id === ini.id));
          const summary = summariseInitiative(ini, states, t);
          const coordinator = ini.coordinator_id ? l.user.get(ini.coordinator_id) : undefined;
          return {
            ...ini,
            blockName: ini.block_id ? l.block.get(ini.block_id)?.name ?? null : null,
            coordinatorName: coordinator?.name ?? null,
            coordinatorDesignation: coordinator?.designation ?? null,
            asset: ini.asset_id ? ctx.db.get<{ id: number; name: string; code: string }>('SELECT id, name, code FROM assets WHERE id = ?', [ini.asset_id]) ?? null : null,
            links: states,
            summary,
            departments: Array.from(new Set(states.map((s) => s.departmentName).filter(Boolean))),
          };
        })
        .filter((x) => isExecutive(u) || x.links.some((s) => s.department_id === u.department_id || s.ownerId === u.id) || (u.block_id && x.block_id === u.block_id))
        .sort((a, b) => {
          const rank = (s: string) => (s === 'blocked' ? 0 : s === 'on_track' ? 1 : 2);
          return rank(a.summary.status) - rank(b.summary.status) || b.summary.blockedCount - a.summary.blockedCount || b.summary.pendingDepartments.length - a.summary.pendingDepartments.length || (a.summary.daysLeft ?? 9999) - (b.summary.daysLeft ?? 9999);
        });
    },
  }),

  /** Live records in a block that can be linked into a new inter-department initiative. */
  'deps.candidates': proc({
    access: ['dm', 'ddc'],
    input: z.object({ blockId: zId }),
    run: (ctx, { blockId }) => {
      requireRole(ctx, ['dm', 'ddc']);
      const l = lookups(ctx.db);
      const dn = (id: number | null) => (id ? l.dept.get(id)?.name ?? '' : '');
      const works = ctx.db
        .all<{ id: number; code: string; name: string; department_id: number; status: string; physical_pct: number }>(
          "SELECT id, code, name, department_id, status, physical_pct FROM works WHERE block_id = ? AND status != 'completed' ORDER BY name",
          [blockId],
        )
        .map((w) => ({ refType: 'work' as const, refId: w.id, label: `${w.code} · ${w.name} (${w.physical_pct}%)`, departmentId: w.department_id, departmentName: dn(w.department_id) }));
      const files = ctx.db
        .all<{ id: number; file_no: string; subject: string; department_id: number; current_office_id: number }>(
          "SELECT id, file_no, subject, department_id, current_office_id FROM files WHERE (block_id = ? OR block_id IS NULL) AND status IN ('open','query') ORDER BY arrived_at",
          [blockId],
        )
        .map((f) => {
          const off = l.office.get(f.current_office_id);
          return { refType: 'file' as const, refId: f.id, label: `${f.file_no} · ${f.subject} (at ${off?.name ?? ''})`, departmentId: off?.department_id ?? f.department_id, departmentName: dn(off?.department_id ?? f.department_id) };
        });
      const findings = ctx.db
        .all<{ id: number; title: string; severity: string; dept: number; asset_name: string }>(
          `SELECT f.id, f.title, f.severity, COALESCE(f.responsible_department_id, a.department_id) AS dept, a.name AS asset_name
             FROM findings f JOIN assets a ON a.id = f.asset_id WHERE a.block_id = ? AND f.status != 'closed' ORDER BY a.name`,
          [blockId],
        )
        .map((f) => ({ refType: 'finding' as const, refId: f.id, label: `${f.asset_name}: ${f.title} (${f.severity})`, departmentId: f.dept, departmentName: dn(f.dept) }));
      const assets = ctx.db.all<{ id: number; name: string; code: string }>('SELECT id, name, code FROM assets WHERE block_id = ? ORDER BY name', [blockId]);
      return { works, files, findings, assets };
    },
  }),

  /** DM / DDC define a cross-department outcome by linking live records; status is then derived automatically. */
  'deps.create': proc({
    access: ['dm', 'ddc'],
    mutation: true,
    input: z.object({
      title: z.string().trim().min(5).max(200),
      outcome: z.string().trim().min(5).max(400),
      blockId: zId,
      assetId: zId.optional().nullable(),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      coordinatorId: zId.optional().nullable(),
      links: z
        .array(z.object({ label: z.string().trim().min(3).max(160), refType: z.enum(['work', 'file', 'finding']), refId: zId, dependsOn: z.number().int().min(0).nullable().optional() }))
        .min(2, 'Link at least two records')
        .max(12),
    }),
    run: (ctx, input) => {
      const u = requireRole(ctx, ['dm', 'ddc']);
      const l = lookups(ctx.db);
      const blk = l.block.get(input.blockId);
      if (!blk) throw new AppError(400, 'Unknown block');
      const resolved = input.links.map((lk, i) => {
        let dept: number | null = null;
        if (lk.refType === 'work') dept = ctx.db.get<{ d: number }>('SELECT department_id AS d FROM works WHERE id = ?', [lk.refId])?.d ?? null;
        if (lk.refType === 'file') {
          const f = ctx.db.get<{ d: number; o: number }>('SELECT department_id AS d, current_office_id AS o FROM files WHERE id = ?', [lk.refId]);
          dept = f ? l.office.get(f.o)?.department_id ?? f.d : null;
        }
        if (lk.refType === 'finding') dept = ctx.db.get<{ d: number }>('SELECT COALESCE(f.responsible_department_id, a.department_id) AS d FROM findings f JOIN assets a ON a.id = f.asset_id WHERE f.id = ?', [lk.refId])?.d ?? null;
        if (dept === null) throw new AppError(400, `Component ${i + 1}: linked record not found`);
        if (lk.dependsOn !== null && lk.dependsOn !== undefined && (lk.dependsOn >= input.links.length || lk.dependsOn === i)) throw new AppError(400, `Component ${i + 1}: invalid dependency`);
        return { ...lk, dept };
      });
      if (new Set(resolved.map((r) => r.dept)).size < 2) throw new AppError(400, 'An inter-department initiative needs records from at least two departments.');
      const n = (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM initiatives WHERE block_id = ?', [blk.id])?.n ?? 0) + 1;
      let code = `INIT-${blk.code}-${String(n).padStart(2, '0')}`;
      while (ctx.db.get('SELECT id FROM initiatives WHERE code = ?', [code])) code += 'A';
      const id = insert(ctx.db, 'initiatives', {
        code, title: input.title, outcome: input.outcome, block_id: blk.id, asset_id: input.assetId ?? null,
        coordinator_id: input.coordinatorId ?? u.id, target_date: input.targetDate ?? null, created_at: ctx.now.toISOString(),
      });
      const linkIds = resolved.map((r) => insert(ctx.db, 'initiative_links', { initiative_id: id, label: r.label, department_id: r.dept, ref_type: r.refType, ref_id: r.refId, depends_on_link_id: null }));
      resolved.forEach((r, i) => {
        if (r.dependsOn !== null && r.dependsOn !== undefined) ctx.db.run('UPDATE initiative_links SET depends_on_link_id = ? WHERE id = ?', [linkIds[r.dependsOn], linkIds[i]]);
      });
      _audit(ctx, 'initiative.created', 'initiative', id, `${code}: "${input.title}" defined with ${resolved.length} linked records across ${new Set(resolved.map((r) => r.dept)).size} departments`);
      return { ok: true, id, code };
    },
  }),

  'audit.list': proc({
    access: ['dm', 'ddc'],
    input: z
      .object({ q: z.string().trim().max(100).optional(), entityType: z.string().max(30).optional(), userId: zId.optional(), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(200).default(50) })
      .prefault({}),
    run: (ctx, input) => {
      requireRole(ctx, ['dm', 'ddc']);
      const where: string[] = ['1=1'];
      const params: unknown[] = [];
      if (input.entityType) {
        where.push('entity_type = ?');
        params.push(input.entityType);
      }
      if (input.userId) {
        where.push('user_id = ?');
        params.push(input.userId);
      }
      if (input.q) {
        where.push('(summary LIKE ? OR user_name LIKE ? OR action LIKE ?)');
        params.push(`%${input.q}%`, `%${input.q}%`, `%${input.q}%`);
      }
      const rows = ctx.db.all<{ id: number; at: string; user_id: number | null; user_name: string | null; role: string | null; action: string; entity_type: string; entity_id: number | null; summary: string; details: string | null }>(
        `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT 2000`,
        params,
      );
      const types = ctx.db.all<{ entity_type: string; n: number }>('SELECT entity_type, COUNT(*) AS n FROM audit_log GROUP BY entity_type ORDER BY n DESC');
      return { ...paginate(rows, input.page, input.pageSize), types };
    },
  }),

  'audit.entity': proc({
    access: ['dm', 'ddc'],
    input: z.object({ entityType: z.string().max(30), entityId: zId }),
    run: (ctx, input) => {
      requireRole(ctx, ['dm', 'ddc']);
      return ctx.db.all<{ id: number; at: string; user_name: string | null; role: string | null; action: string; summary: string }>(
        'SELECT id, at, user_name, role, action, summary FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC, id DESC LIMIT 100',
        [input.entityType, input.entityId],
      );
    },
  }),

  /** Restore the demo dataset (DM only). */
  'admin.resetDemo': proc({
    access: ['dm'],
    mutation: true,
    input: z.object({ confirm: z.literal('RESET') }),
    run: (ctx) => {
      requireRole(ctx, ['dm']);
      wipe(ctx.db);
      initSchema(ctx.db);
      seed(ctx.db, ctx.now);
      invalidateLookups(ctx.db);
      _audit(ctx, 'system.reset', 'system', null, 'Demo dataset restored');
      return { ok: true };
    },
  }),
};
