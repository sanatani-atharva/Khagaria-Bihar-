import { z } from 'zod';
import { AppError, audit, inScope, isExecutive, lookups, requireUser, scopeSql, today } from '../context';
import { findingScope } from '../issues';
import type { LinkRow } from '../initiatives';
import { findingNextAction, findingTone, severityRank } from '../rules';
import { insert, update } from '../sql';
import type { AssetCondition, AssetRow, EvidenceMeta, FindingRow, InspectionRow, UserRow } from '../types';
import { ASSET_TYPE_LABEL, CONDITION_LABEL, FINDING_STATUS_LABEL, FUNCTIONAL_LABEL } from '../types';
import { addDays, daysBetween } from '../time';
import { paginate, proc, zDate, zEvidence, zId, zPage, zText } from './_proc';

const EVIDENCE_COLS = 'id, entity_type, entity_id, file_name, mime, size, sha256, note, uploaded_by, uploaded_at, review_status, reviewed_by, reviewed_at, review_remark';

function withNames(db: Parameters<typeof lookups>[0], ev: EvidenceMeta[]): EvidenceMeta[] {
  const l = lookups(db);
  return ev.map((e) => ({ ...e, uploaded_by_name: e.uploaded_by ? l.user.get(e.uploaded_by)?.name ?? null : null, reviewed_by_name: e.reviewed_by ? l.user.get(e.reviewed_by)?.name ?? null : null }));
}

/** Who may assign corrective action / verify evidence for a finding. */
function isSupervisor(u: UserRow, asset: AssetRow, f: FindingRow) {
  if (isExecutive(u)) return true;
  const dept = f.responsible_department_id ?? asset.department_id;
  if (u.role === 'dept_officer' && u.department_id === dept) return true;
  // BDO (block officer without a department) supervises everything in the block
  if (u.role === 'block_officer' && !u.department_id && u.block_id === asset.block_id) return true;
  return false;
}

/** Re-derive asset condition from its open findings after a closure. */
function recomputeCondition(db: Parameters<typeof lookups>[0], assetId: number, at: string) {
  const open = db.all<{ severity: string }>("SELECT severity FROM findings WHERE asset_id = ? AND status != 'closed'", [assetId]);
  const worst = open.reduce((m, f) => Math.max(m, severityRank(f.severity)), 0);
  const condition: AssetCondition = worst >= 4 ? 'critical' : worst >= 2 ? 'needs_repair' : 'good';
  const functional = worst >= 4 ? 'partially' : 'functional';
  update(db, 'assets', assetId, { condition, functional_status: functional, updated_at: at });
  return condition;
}

export const assetsProcs = {
  'assets.list': proc({
    access: 'auth',
    input: z.object({
      q: z.string().trim().max(100).optional(),
      blockId: zId.optional(),
      departmentId: zId.optional(),
      type: z.string().max(40).optional(),
      condition: z.enum(['good', 'needs_repair', 'critical']).optional(),
      inspection: z.enum(['all', 'overdue', 'due30']).default('all'),
      openFindings: z.boolean().optional(),
      ...zPage,
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const s = scopeSql(u, 'a.block_id', 'a.department_id');
      const rows0 = ctx.db.all<AssetRow & { open_findings: number; worst: number | null }>(
        `SELECT a.*,
                (SELECT COUNT(*) FROM findings f WHERE f.asset_id = a.id AND f.status != 'closed') AS open_findings,
                (SELECT MAX(CASE f.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) FROM findings f WHERE f.asset_id = a.id AND f.status != 'closed') AS worst
           FROM assets a WHERE ${s.sql} ORDER BY a.block_id, a.type, a.name`,
        s.params,
      );
      let rows = rows0.map((a) => {
        const due = a.next_inspection_due;
        const overdueBy = due ? daysBetween(due, t) : 0;
        const officer = a.officer_id ? l.user.get(a.officer_id) : undefined;
        return {
          ...a,
          typeLabel: ASSET_TYPE_LABEL[a.type] ?? a.type,
          conditionLabel: CONDITION_LABEL[a.condition],
          functionalLabel: FUNCTIONAL_LABEL[a.functional_status],
          blockName: l.block.get(a.block_id)?.name ?? '',
          departmentName: l.dept.get(a.department_id)?.name ?? '',
          officerName: officer?.name ?? null,
          officerDesignation: officer?.designation ?? null,
          inspectionState: !due ? 'none' : overdueBy > 0 ? 'overdue' : overdueBy > -30 ? 'due_soon' : 'scheduled',
          inspectionOverdueBy: Math.max(0, overdueBy),
          worstOpen: a.worst === 4 ? 'critical' : a.worst === 3 ? 'high' : a.worst === 2 ? 'medium' : a.worst === 1 ? 'low' : null,
        };
      });
      const base = rows;
      if (input.blockId) rows = rows.filter((r) => r.block_id === input.blockId);
      if (input.departmentId) rows = rows.filter((r) => r.department_id === input.departmentId);
      if (input.type) rows = rows.filter((r) => r.type === input.type);
      if (input.condition) rows = rows.filter((r) => r.condition === input.condition);
      if (input.inspection === 'overdue') rows = rows.filter((r) => r.inspectionState === 'overdue');
      if (input.inspection === 'due30') rows = rows.filter((r) => r.inspectionState === 'overdue' || r.inspectionState === 'due_soon');
      if (input.openFindings) rows = rows.filter((r) => r.open_findings > 0);
      if (input.q) {
        const q = input.q.toLowerCase();
        rows = rows.filter((r) => `${r.code} ${r.name} ${r.village ?? ''} ${r.panchayat ?? ''}`.toLowerCase().includes(q));
      }
      rows.sort((a, b) => (b.worst ?? 0) - (a.worst ?? 0) || b.inspectionOverdueBy - a.inspectionOverdueBy || a.name.localeCompare(b.name));
      const typeCounts: Record<string, number> = {};
      for (const r of base) typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
      return {
        ...paginate(rows, input.page, input.pageSize),
        counts: {
          total: base.length,
          good: base.filter((r) => r.condition === 'good').length,
          needs_repair: base.filter((r) => r.condition === 'needs_repair').length,
          critical: base.filter((r) => r.condition === 'critical').length,
          overdue: base.filter((r) => r.inspectionState === 'overdue').length,
          withOpenFindings: base.filter((r) => r.open_findings > 0).length,
        },
        types: Object.entries(typeCounts).map(([type, count]) => ({ type, label: ASSET_TYPE_LABEL[type] ?? type, count })),
      };
    },
  }),

  'assets.get': proc({
    access: 'auth',
    input: z.object({ id: zId }),
    run: (ctx, { id }) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const a = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
      if (!a) throw new AppError(404, 'Asset not found');
      const assignedToMe = ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM findings WHERE asset_id = ? AND assigned_to = ? AND status != 'closed'", [id, u.id])?.n ?? 0;
      if (!inScope(u, a.block_id, a.department_id) && !assignedToMe) throw new AppError(403, 'This asset is outside your jurisdiction.');
      const inspections = ctx.db.all<InspectionRow>('SELECT * FROM inspections WHERE asset_id = ? ORDER BY COALESCE(conducted_date, scheduled_date) DESC', [id]).map((i) => ({
        ...i,
        inspectorName: i.inspector_id ? l.user.get(i.inspector_id)?.name ?? null : null,
        inspectorDesignation: i.inspector_id ? l.user.get(i.inspector_id)?.designation ?? null : null,
        overdue: i.status === 'scheduled' && i.scheduled_date < t,
        canRecord: i.status === 'scheduled' && (isExecutive(u) || i.inspector_id === u.id || inScope(u, a.block_id, a.department_id)),
      }));
      const findingsRaw = ctx.db.all<FindingRow>('SELECT * FROM findings WHERE asset_id = ? ORDER BY CASE status WHEN \'closed\' THEN 1 ELSE 0 END, created_at DESC', [id]);
      const evidence = findingsRaw.length
        ? withNames(ctx.db, ctx.db.all<EvidenceMeta>(`SELECT ${EVIDENCE_COLS} FROM evidence WHERE entity_type = 'finding' AND entity_id IN (${findingsRaw.map(() => '?').join(',')}) ORDER BY uploaded_at DESC`, findingsRaw.map((f) => f.id)))
        : [];
      const findings = findingsRaw.map((f) => {
        const assignee = f.assigned_to ? l.user.get(f.assigned_to) : undefined;
        const sup = isSupervisor(u, a, f);
        const ev = evidence.filter((e) => e.entity_id === f.id);
        const pending = ev.find((e) => e.review_status === 'pending');
        return {
          ...f,
          statusLabel: FINDING_STATUS_LABEL[f.status],
          tone: findingTone(f),
          ageDays: daysBetween(f.created_at, f.closed_at ?? t),
          overdueBy: f.due_date && f.status !== 'closed' ? Math.max(0, daysBetween(f.due_date, t)) : 0,
          assigneeName: assignee?.name ?? null,
          assigneeDesignation: assignee?.designation ?? null,
          responsibleDepartment: f.responsible_department_id ? l.dept.get(f.responsible_department_id)?.name ?? null : null,
          nextAction: findingNextAction(f, assignee?.name ?? null),
          evidence: ev,
          can: {
            assign: f.status !== 'closed' && sup,
            submit: (f.status === 'assigned' || f.status === 'open') && (f.assigned_to === u.id || sup || inScope(u, a.block_id, f.responsible_department_id ?? a.department_id)),
            verify: f.status === 'resolution_submitted' && sup && !!pending && pending.uploaded_by !== u.id,
          },
        };
      });
      const linkRows = ctx.db.all<LinkRow & { title: string }>(
        `SELECT il.*, i.title FROM initiative_links il JOIN initiatives i ON i.id = il.initiative_id
          WHERE (il.ref_type = 'finding' AND il.ref_id IN (${findingsRaw.map(() => '?').join(',') || 'NULL'})) OR i.asset_id = ?`,
        [...findingsRaw.map((f) => f.id), id],
      );
      const initiatives = Array.from(new Map(linkRows.map((r) => [r.initiative_id, { id: r.initiative_id, title: r.title }])).values());
      const officer = a.officer_id ? l.user.get(a.officer_id) : undefined;
      const blockUsers = l.users.filter((x) => (x.block_id === a.block_id || x.block_id === null) && x.role !== 'dm');
      return {
        asset: {
          ...a,
          details: a.details ? (JSON.parse(a.details) as Record<string, string | number>) : {},
          typeLabel: ASSET_TYPE_LABEL[a.type] ?? a.type,
          conditionLabel: CONDITION_LABEL[a.condition],
          functionalLabel: FUNCTIONAL_LABEL[a.functional_status],
          blockName: l.block.get(a.block_id)?.name ?? '',
          departmentName: l.dept.get(a.department_id)?.name ?? '',
          officerName: officer?.name ?? null,
          officerDesignation: officer?.designation ?? null,
          officerPhone: officer?.phone ?? null,
          inspectionOverdueBy: a.next_inspection_due ? Math.max(0, daysBetween(a.next_inspection_due, t)) : 0,
        },
        inspections,
        findings,
        initiatives,
        assignees: blockUsers.map((x) => ({ id: x.id, name: x.name, designation: x.designation, department_id: x.department_id })),
        can: { schedule: inScope(u, a.block_id, a.department_id), inspect: inScope(u, a.block_id, a.department_id) },
      };
    },
  }),

  'assets.scheduleInspection': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ assetId: zId, date: zDate, inspectorId: zId }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const a = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [input.assetId]);
      if (!a) throw new AppError(404, 'Asset not found');
      if (!inScope(u, a.block_id, a.department_id)) throw new AppError(403, 'Outside your jurisdiction.');
      const inspector = lookups(ctx.db).user.get(input.inspectorId);
      if (!inspector) throw new AppError(400, 'Unknown inspecting officer');
      const id = insert(ctx.db, 'inspections', { asset_id: a.id, scheduled_date: input.date, conducted_date: null, inspector_id: input.inspectorId, status: 'scheduled', condition_found: null, remarks: null, created_at: ctx.now.toISOString() });
      if (!a.next_inspection_due || input.date < a.next_inspection_due) update(ctx.db, 'assets', a.id, { next_inspection_due: input.date });
      audit(ctx, 'inspection.scheduled', 'asset', a.id, `${a.code}: inspection scheduled on ${input.date} (${inspector.name})`);
      return { ok: true, id };
    },
  }),

  /** Record an inspection with findings. Updates asset condition and auto-schedules the next cycle. */
  'assets.recordInspection': proc({
    access: 'auth',
    mutation: true,
    input: z.object({
      assetId: zId,
      inspectionId: zId.optional(),
      conductedDate: zDate,
      condition: z.enum(['good', 'needs_repair', 'critical']),
      functionalStatus: z.enum(['functional', 'partially', 'non_functional']),
      remarks: zText(1000).min(3, 'Add inspection remarks'),
      findings: z
        .array(z.object({ title: zText(200).min(3), description: zText(1000).optional(), category: zText(60).min(2), severity: z.enum(['low', 'medium', 'high', 'critical']) }))
        .max(20)
        .default([]),
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const a = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [input.assetId]);
      if (!a) throw new AppError(404, 'Asset not found');
      if (!inScope(u, a.block_id, a.department_id)) throw new AppError(403, 'Outside your jurisdiction.');
      if (input.conductedDate > today(ctx)) throw new AppError(400, 'Inspection date cannot be in the future.');
      if (input.condition !== 'good' && !input.findings.length) throw new AppError(400, 'Record at least one finding when the condition is not Good.');
      const at = ctx.now.toISOString();
      let inspectionId = input.inspectionId;
      if (inspectionId) {
        const ins = ctx.db.get<InspectionRow>('SELECT * FROM inspections WHERE id = ? AND asset_id = ?', [inspectionId, a.id]);
        if (!ins) throw new AppError(404, 'Inspection not found');
        update(ctx.db, 'inspections', inspectionId, { conducted_date: input.conductedDate, inspector_id: u.id, status: 'completed', condition_found: input.condition, remarks: input.remarks });
      } else {
        inspectionId = insert(ctx.db, 'inspections', { asset_id: a.id, scheduled_date: input.conductedDate, conducted_date: input.conductedDate, inspector_id: u.id, status: 'completed', condition_found: input.condition, remarks: input.remarks, created_at: at });
      }
      for (const f of input.findings) {
        insert(ctx.db, 'findings', {
          asset_id: a.id, inspection_id: inspectionId, title: f.title, description: f.description ?? null, category: f.category, severity: f.severity,
          status: 'open', responsible_department_id: a.department_id, assigned_to: null, assigned_by: null, due_date: null, reopen_count: 0,
          created_at: at, updated_at: at, closed_at: null, closed_by: null,
        });
      }
      const next = addDays(input.conductedDate, a.inspection_cycle_days);
      update(ctx.db, 'assets', a.id, { condition: input.condition, functional_status: input.functionalStatus, last_inspected: input.conductedDate, next_inspection_due: next, updated_at: at });
      const hasNext = ctx.db.get<{ id: number }>("SELECT id FROM inspections WHERE asset_id = ? AND status = 'scheduled' AND scheduled_date > ?", [a.id, input.conductedDate]);
      if (!hasNext) insert(ctx.db, 'inspections', { asset_id: a.id, scheduled_date: next, conducted_date: null, inspector_id: a.officer_id ?? u.id, status: 'scheduled', condition_found: null, remarks: null, created_at: at });
      audit(ctx, 'inspection.recorded', 'asset', a.id, `${a.code}: inspected on ${input.conductedDate} — ${CONDITION_LABEL[input.condition]}, ${input.findings.length} finding(s); next due ${next}`);
      return { ok: true, inspectionId, nextDue: next };
    },
  }),

  'findings.assign': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ findingId: zId, assignedTo: zId, dueDate: zDate, note: zText(400).optional() }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const f = ctx.db.get<FindingRow>('SELECT * FROM findings WHERE id = ?', [input.findingId]);
      if (!f) throw new AppError(404, 'Finding not found');
      const a = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [f.asset_id])!;
      if (!isSupervisor(u, a, f)) throw new AppError(403, 'Only the department head, BDO, DDC or DM can assign corrective action.');
      if (f.status === 'closed') throw new AppError(400, 'Finding is already closed.');
      if (input.dueDate < today(ctx)) throw new AppError(400, 'Due date cannot be in the past.');
      const assignee = l.user.get(input.assignedTo);
      if (!assignee) throw new AppError(400, 'Unknown officer');
      update(ctx.db, 'findings', f.id, { status: 'assigned', assigned_to: input.assignedTo, assigned_by: u.id, due_date: input.dueDate, updated_at: ctx.now.toISOString() });
      audit(ctx, 'finding.assigned', 'finding', f.id, `"${f.title}" (${a.code}) assigned to ${assignee.name}, due ${input.dueDate}`, { note: input.note });
      return { ok: true };
    },
  }),

  /** Field officer uploads evidence of resolution — a finding can never close without it. */
  'findings.submitResolution': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ findingId: zId, note: zText(600).min(5, 'Describe what was done'), evidence: zEvidence }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const f = ctx.db.get<FindingRow>('SELECT * FROM findings WHERE id = ?', [input.findingId]);
      if (!f) throw new AppError(404, 'Finding not found');
      const a = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [f.asset_id])!;
      const allowed = f.assigned_to === u.id || isSupervisor(u, a, f) || inScope(u, a.block_id, f.responsible_department_id ?? a.department_id);
      if (!allowed) throw new AppError(403, 'Only the assigned officer can submit the resolution.');
      if (f.status === 'closed' || f.status === 'resolution_submitted') throw new AppError(400, 'Resolution already submitted or closed.');
      const at = ctx.now.toISOString();
      const evId = insert(ctx.db, 'evidence', {
        entity_type: 'finding', entity_id: f.id, file_name: input.evidence.fileName, mime: input.evidence.mime, size: input.evidence.size,
        data_url: input.evidence.dataUrl, sha256: input.evidence.sha256 ?? null, note: input.note, uploaded_by: u.id, uploaded_at: at, review_status: 'pending',
      });
      update(ctx.db, 'findings', f.id, { status: 'resolution_submitted', assigned_to: f.assigned_to ?? u.id, updated_at: at });
      audit(ctx, 'finding.resolution_submitted', 'finding', f.id, `Evidence submitted for "${f.title}" (${a.code}): ${input.evidence.fileName}`, { evidenceId: evId, sha256: input.evidence.sha256 });
      return { ok: true, evidenceId: evId };
    },
  }),

  'findings.verify': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ findingId: zId, evidenceId: zId, decision: z.enum(['accept', 'reject']), remark: zText(600).min(3, 'Add a verification remark') }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const f = ctx.db.get<FindingRow>('SELECT * FROM findings WHERE id = ?', [input.findingId]);
      if (!f) throw new AppError(404, 'Finding not found');
      const a = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [f.asset_id])!;
      if (!isSupervisor(u, a, f)) throw new AppError(403, 'Only the department head, BDO, DDC or DM can verify evidence.');
      const ev = ctx.db.get<EvidenceMeta>(`SELECT ${EVIDENCE_COLS} FROM evidence WHERE id = ? AND entity_type = 'finding' AND entity_id = ?`, [input.evidenceId, f.id]);
      if (!ev) throw new AppError(404, 'Evidence not found');
      if (ev.review_status !== 'pending') throw new AppError(400, 'This evidence has already been reviewed.');
      if (ev.uploaded_by === u.id) throw new AppError(403, 'Separation of duties: you cannot verify evidence you uploaded.');
      const at = ctx.now.toISOString();
      update(ctx.db, 'evidence', ev.id, { review_status: input.decision === 'accept' ? 'accepted' : 'rejected', reviewed_by: u.id, reviewed_at: at, review_remark: input.remark });
      let condition: AssetCondition | null = null;
      if (input.decision === 'accept') {
        update(ctx.db, 'findings', f.id, { status: 'closed', closed_at: at, closed_by: u.id, updated_at: at });
        condition = recomputeCondition(ctx.db, a.id, at);
      } else {
        update(ctx.db, 'findings', f.id, { status: 'assigned', reopen_count: f.reopen_count + 1, updated_at: at });
      }
      audit(ctx, input.decision === 'accept' ? 'finding.closed' : 'finding.reopened', 'finding', f.id, `"${f.title}" (${a.code}) — evidence ${input.decision === 'accept' ? 'accepted, finding closed' : 'rejected, finding reopened'}`, { remark: input.remark });
      return { ok: true, condition };
    },
  }),

  /** Full evidence file (lists only carry metadata, to keep pages light). */
  'evidence.get': proc({
    access: 'auth',
    input: z.object({ id: zId }),
    run: (ctx, { id }) => {
      const u = requireUser(ctx);
      const e = ctx.db.get<EvidenceMeta & { data_url: string }>(`SELECT ${EVIDENCE_COLS}, data_url FROM evidence WHERE id = ?`, [id]);
      if (!e) throw new AppError(404, 'Evidence not found');
      if (!isExecutive(u)) {
        let ok: unknown;
        if (e.entity_type === 'finding') {
          const fs = findingScope(u);
          ok = ctx.db.get(`SELECT f.id FROM findings f JOIN assets a ON a.id = f.asset_id WHERE f.id = ? AND ${fs.sql}`, [e.entity_id, ...fs.params]);
        } else if (e.entity_type === 'action') {
          const s = scopeSql(u, 'block_id', 'department_id');
          ok = ctx.db.get(`SELECT id FROM action_items WHERE id = ? AND ((${s.sql}) OR assigned_to = ?)`, [e.entity_id, ...s.params, u.id]);
        } else {
          const s = scopeSql(u, 'block_id', 'department_id');
          ok = ctx.db.get(`SELECT id FROM works WHERE id = ? AND ((${s.sql}) OR officer_id = ?)`, [e.entity_id, ...s.params, u.id]);
        }
        if (!ok) throw new AppError(403, 'Outside your jurisdiction.');
      }
      return withNames(ctx.db, [e])[0] as EvidenceMeta & { data_url: string };
    },
  }),
};

export { withNames, EVIDENCE_COLS };
