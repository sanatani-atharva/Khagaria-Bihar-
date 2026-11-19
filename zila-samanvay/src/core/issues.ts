// Builds uniform IssueItems for every district metric. Used by the drill-down
// (district -> block -> department -> item -> officer -> next action), the
// block x department heatmap and the officer desk.

import type { Ctx } from './context';
import { lookups, officerInfo, requireUser, scopeSql, today } from './context';
import { fileAging, findingNextAction, findingTone, schemeGap, workHealth } from './rules';
import type { ActionItemRow, AssetRow, FileRow, FindingRow, IssueItem, SchemeTargetRow, UserRow, WorkRow } from './types';
import { ACTION_STATUS_LABEL, CONDITION_LABEL, FINDING_STATUS_LABEL } from './types';
import { daysBetween, fmtDate } from './time';

export const METRICS = {
  works_delayed: { label: 'Delayed / stalled works', group: 'Public works' },
  works_active: { label: 'Works in execution', group: 'Public works' },
  scheme_gaps: { label: 'Block-level service gaps', group: 'Non-works schemes' },
  files_beyond_sla: { label: 'Files pending beyond SLA', group: 'File movement' },
  files_pending: { label: 'Files pending decision', group: 'File movement' },
  findings_open: { label: 'Open inspection findings (high / critical)', group: 'Asset health' },
  assets_critical: { label: 'Assets in critical condition', group: 'Asset health' },
  inspections_overdue: { label: 'Inspections overdue', group: 'Asset health' },
  actions_overdue: { label: 'Review actions overdue', group: 'Review follow-up' },
} as const;
export type MetricKey = keyof typeof METRICS;

function base(ctx: Ctx, blockId: number | null, deptId: number | null) {
  const l = lookups(ctx.db);
  return {
    blockId,
    blockName: blockId ? (l.block.get(blockId)?.name ?? null) : null,
    departmentId: deptId,
    departmentName: deptId ? (l.dept.get(deptId)?.name ?? null) : null,
  };
}

export function workIssue(ctx: Ctx, w: WorkRow, pendingFile?: { file_no: string; office: string; days: number } | null): IssueItem {
  const l = lookups(ctx.db);
  const h = workHealth(w, today(ctx));
  const next = pendingFile
    ? `Decision on file ${pendingFile.file_no} at ${pendingFile.office} (pending ${pendingFile.days} d) — then: ${w.next_action ?? 'resume work'}`
    : (w.next_action ?? 'Update progress');
  return {
    key: `work:${w.id}`,
    type: 'work',
    refId: w.id,
    title: w.name,
    subtitle: `${w.code} · ${w.scheme} · ₹${w.sanctioned_lakh.toFixed(1)} L`,
    ...base(ctx, w.block_id, w.department_id),
    ...officerInfo(l, w.officer_id),
    nextAction: next,
    dueDate: w.next_action_due,
    status: h.label,
    tone: h.tone,
    metric: h.overdueDays > 0 ? `${h.overdueDays} d past target · ${w.physical_pct}% done` : `${w.physical_pct}% done vs ${h.expected}% expected`,
    link: `/works/${w.id}`,
  };
}

export function fileIssue(ctx: Ctx, f: FileRow): IssueItem {
  const l = lookups(ctx.db);
  const a = fileAging(f, today(ctx));
  const off = l.office.get(f.current_office_id);
  const office = off?.name ?? 'Unknown desk';
  // A pending file is attributed to the department of the office *holding* it (e.g. Treasury),
  // so the heat-map and drill-down show who is sitting on the decision, not who asked for it.
  const holdingDept = off?.department_id ?? f.department_id;
  return {
    key: `file:${f.id}`,
    type: 'file',
    refId: f.id,
    title: f.subject,
    subtitle: `${f.file_no} · at ${office}${holdingDept !== f.department_id ? ` · for ${l.dept.get(f.department_id)?.name ?? ''}` : ''}`,
    ...base(ctx, f.block_id, holdingDept),
    ...officerInfo(l, f.current_holder_id),
    nextAction:
      f.status === 'query'
        ? `Reply to the query raised on the file — ${f.decision_required}`
        : f.status === 'approved'
          ? 'Decision approved — originating office to act on it and close the file'
          : f.decision_required,
    dueDate: null,
    status: f.status === 'query' ? 'Query pending reply' : a.label,
    tone: a.tone,
    metric: `${a.daysAtDesk} d at current desk (SLA ${f.sla_days})`,
    link: `/files/${f.id}`,
  };
}

export function findingIssue(ctx: Ctx, f: FindingRow & { asset_name: string; asset_block: number; asset_dept: number }): IssueItem {
  const l = lookups(ctx.db);
  const owner = f.assigned_to ?? null;
  const assignee = owner ? l.user.get(owner)?.name ?? null : null;
  const age = daysBetween(f.created_at, today(ctx));
  const overdue = f.due_date && f.status !== 'closed' ? daysBetween(f.due_date, today(ctx)) : 0;
  return {
    key: `finding:${f.id}`,
    type: 'finding',
    refId: f.id,
    title: f.title,
    subtitle: `${f.asset_name} · ${f.severity.toUpperCase()}`,
    ...base(ctx, f.asset_block, f.responsible_department_id ?? f.asset_dept),
    ...officerInfo(l, owner),
    nextAction: findingNextAction(f, assignee),
    dueDate: f.due_date,
    status: FINDING_STATUS_LABEL[f.status],
    tone: findingTone(f),
    metric: overdue > 0 ? `Open ${age} d · ${overdue} d past due` : `Open ${age} d`,
    link: `/assets/${f.asset_id}?finding=${f.id}`,
  };
}

export function assetIssue(ctx: Ctx, a: AssetRow, mode: 'critical' | 'inspection'): IssueItem {
  const l = lookups(ctx.db);
  const t = today(ctx);
  const overdueBy = a.next_inspection_due ? daysBetween(a.next_inspection_due, t) : 0;
  return {
    key: `asset:${a.id}`,
    type: mode === 'critical' ? 'asset' : 'inspection',
    refId: a.id,
    title: a.name,
    subtitle: `${a.code} · ${a.village ?? ''}`,
    ...base(ctx, a.block_id, a.department_id),
    ...officerInfo(l, a.officer_id),
    nextAction:
      mode === 'critical'
        ? 'Close open findings with verified evidence; re-inspect after repair'
        : `Conduct inspection (due ${fmtDate(a.next_inspection_due)}) and record findings`,
    dueDate: mode === 'inspection' ? a.next_inspection_due : null,
    status: mode === 'critical' ? CONDITION_LABEL[a.condition] : `Inspection overdue ${overdueBy} d`,
    tone: mode === 'critical' ? 'critical' : overdueBy > 30 ? 'bad' : 'warn',
    metric: mode === 'critical' ? `Last inspected ${fmtDate(a.last_inspected)}` : `${overdueBy} d overdue (cycle ${a.inspection_cycle_days} d)`,
    link: `/assets/${a.id}`,
  };
}

export function gapIssue(ctx: Ctx, t: SchemeTargetRow & { scheme_code: string; scheme_name: string; unit: string; department_id: number }): IssueItem {
  const l = lookups(ctx.db);
  const g = schemeGap(t.annual_target, t.achieved, today(ctx));
  return {
    key: `gap:${t.scheme_code}:${t.block_id}`,
    type: 'scheme_gap',
    refId: t.id,
    title: `${t.scheme_name} — ${l.block.get(t.block_id)?.name ?? ''}`,
    subtitle: `${t.achieved.toLocaleString('en-IN')} of ${g.expected.toLocaleString('en-IN')} ${t.unit} expected by today`,
    ...base(ctx, t.block_id, t.department_id),
    ...officerInfo(l, t.officer_id),
    nextAction: 'Block officer to submit a catch-up plan with weekly targets; department to review shortfall causes',
    dueDate: null,
    status: g.band === 'gap' ? 'Service gap' : g.band === 'watch' ? 'Watch' : 'On target',
    tone: g.tone,
    metric: `${Math.round(g.ratio * 100)}% of pro-rata target`,
    link: `/schemes?scheme=${t.scheme_id}&block=${t.block_id}`,
  };
}

export function actionIssue(ctx: Ctx, a: ActionItemRow): IssueItem {
  const l = lookups(ctx.db);
  const overdue = a.status !== 'closed' ? daysBetween(a.deadline, today(ctx)) : 0;
  return {
    key: `action:${a.id}`,
    type: 'action',
    refId: a.id,
    title: a.title,
    subtitle: a.decision,
    ...base(ctx, a.block_id, a.department_id),
    ...officerInfo(l, a.assigned_to),
    nextAction: a.status === 'resolution_submitted' ? 'DM / DDC to verify the submitted evidence and close' : 'Complete the review decision and upload evidence of resolution',
    dueDate: a.deadline,
    status: a.status === 'resolution_submitted' ? ACTION_STATUS_LABEL.resolution_submitted : overdue > 0 ? `Overdue ${overdue} d` : ACTION_STATUS_LABEL[a.status],
    tone: a.status === 'resolution_submitted' ? 'warn' : overdue > 0 ? 'bad' : 'info',
    metric: `Deadline ${fmtDate(a.deadline)}`,
    link: `/review?tab=actions&action=${a.id}`,
  };
}

// ---- scoped loaders ----

export function scopedWorks(ctx: Ctx, extra = '1=1', extraParams: unknown[] = []): WorkRow[] {
  const u = requireUser(ctx);
  const s = scopeSql(u, 'block_id', 'department_id');
  return ctx.db.all<WorkRow>(`SELECT * FROM works WHERE (${s.sql}) AND (${extra})`, [...s.params, ...extraParams]);
}

export function fileScope(u: UserRow) {
  const s = scopeSql(u, 'f.block_id', 'f.department_id');
  return { sql: `((${s.sql}) OR f.current_holder_id = ? OR f.current_office_id = ?)`, params: [...s.params, u.id, u.office_id ?? -1] };
}

export function scopedFiles(ctx: Ctx, extra = '1=1', extraParams: unknown[] = []): FileRow[] {
  const u = requireUser(ctx);
  const s = fileScope(u);
  return ctx.db.all<FileRow>(`SELECT f.* FROM files f WHERE ${s.sql} AND (${extra})`, [...s.params, ...extraParams]);
}

export function findingScope(u: UserRow) {
  const s = scopeSql(u, 'a.block_id', 'COALESCE(f.responsible_department_id, a.department_id)');
  return { sql: `((${s.sql}) OR f.assigned_to = ?)`, params: [...s.params, u.id] };
}

export function scopedFindings(ctx: Ctx, extra = '1=1', extraParams: unknown[] = []) {
  const u = requireUser(ctx);
  const s = findingScope(u);
  return ctx.db.all<FindingRow & { asset_name: string; asset_block: number; asset_dept: number }>(
    `SELECT f.*, a.name AS asset_name, a.block_id AS asset_block, a.department_id AS asset_dept
       FROM findings f JOIN assets a ON a.id = f.asset_id WHERE ${s.sql} AND (${extra})`,
    [...s.params, ...extraParams],
  );
}

export function scopedAssets(ctx: Ctx, extra = '1=1', extraParams: unknown[] = []): AssetRow[] {
  const u = requireUser(ctx);
  const s = scopeSql(u, 'block_id', 'department_id');
  return ctx.db.all<AssetRow>(`SELECT * FROM assets WHERE (${s.sql}) AND (${extra})`, [...s.params, ...extraParams]);
}

export function scopedTargets(ctx: Ctx) {
  const u = requireUser(ctx);
  const s = scopeSql(u, 't.block_id', 's.department_id');
  return ctx.db.all<SchemeTargetRow & { scheme_code: string; scheme_name: string; unit: string; department_id: number }>(
    `SELECT t.*, s.code AS scheme_code, s.name AS scheme_name, s.unit, s.department_id
       FROM scheme_targets t JOIN schemes s ON s.id = t.scheme_id WHERE ${s.sql}`,
    s.params,
  );
}

export function scopedActions(ctx: Ctx, extra = '1=1', extraParams: unknown[] = []): ActionItemRow[] {
  const u = requireUser(ctx);
  const s = scopeSql(u, 'block_id', 'department_id');
  return ctx.db.all<ActionItemRow>(`SELECT * FROM action_items WHERE ((${s.sql}) OR assigned_to = ?) AND (${extra})`, [...s.params, u.id, ...extraParams]);
}

/** Open file blocking each work (most overdue), for "next required action" chains. */
export function pendingFileByWork(ctx: Ctx): Map<number, { file_no: string; office: string; days: number }> {
  const l = lookups(ctx.db);
  const t = today(ctx);
  const rows = ctx.db.all<FileRow>("SELECT * FROM files WHERE work_id IS NOT NULL AND status IN ('open','query')");
  const out = new Map<number, { file_no: string; office: string; days: number }>();
  for (const f of rows) {
    const a = fileAging(f, t);
    if (a.band !== 'beyond' && a.band !== 'critical') continue;
    const prev = out.get(f.work_id!);
    if (!prev || prev.days < a.daysAtDesk) out.set(f.work_id!, { file_no: f.file_no, office: l.office.get(f.current_office_id)?.name ?? '', days: a.daysAtDesk });
  }
  return out;
}

export function collectIssues(ctx: Ctx, metric: MetricKey): IssueItem[] {
  const t = today(ctx);
  switch (metric) {
    case 'works_delayed': {
      const pf = pendingFileByWork(ctx);
      return scopedWorks(ctx, "status != 'completed'")
        .filter((w) => workHealth(w, t).delayed)
        .map((w) => workIssue(ctx, w, pf.get(w.id)));
    }
    case 'works_active': {
      const pf = pendingFileByWork(ctx);
      return scopedWorks(ctx, "status != 'completed'").map((w) => workIssue(ctx, w, pf.get(w.id)));
    }
    case 'files_beyond_sla':
      return scopedFiles(ctx, "f.status IN ('open','query')")
        .filter((f) => {
          const b = fileAging(f, t).band;
          return b === 'beyond' || b === 'critical';
        })
        .map((f) => fileIssue(ctx, f));
    case 'files_pending':
      return scopedFiles(ctx, "f.status IN ('open','query')").map((f) => fileIssue(ctx, f));
    case 'findings_open':
      return scopedFindings(ctx, "f.status != 'closed' AND f.severity IN ('high','critical')").map((f) => findingIssue(ctx, f));
    case 'assets_critical':
      return scopedAssets(ctx, "condition = 'critical'").map((a) => assetIssue(ctx, a, 'critical'));
    case 'inspections_overdue':
      return scopedAssets(ctx, 'next_inspection_due < ?', [t]).map((a) => assetIssue(ctx, a, 'inspection'));
    case 'scheme_gaps':
      return scopedTargets(ctx)
        .filter((x) => schemeGap(x.annual_target, x.achieved, t).band === 'gap')
        .map((x) => gapIssue(ctx, x));
    case 'actions_overdue':
      return scopedActions(ctx, "status != 'closed' AND deadline < ?", [t]).map((a) => actionIssue(ctx, a));
  }
}

const TONE_RANK: Record<string, number> = { critical: 5, bad: 4, warn: 3, info: 2, ok: 1, muted: 0 };
export function sortIssues(items: IssueItem[]): IssueItem[] {
  return [...items].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone] || a.title.localeCompare(b.title));
}
