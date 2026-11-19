// Review Meeting Priority Engine.
// Scans works, files, inspection findings, scheme targets and cross-department initiatives,
// scores each candidate with transparent, additive factors and explains "why flagged".
// Items that belong to a flagged cross-department initiative are folded into that
// coordination item so the DM sees one agenda line per real-world problem.

import type { Ctx } from './context';
import { lookups, requireUser, today } from './context';
import { fileAging, RULES, schemeGap, workHealth } from './rules';
import {
  scopedFiles, scopedFindings, scopedTargets, scopedWorks, scopedActions,
} from './issues';
import type { ActionItemRow, AgendaCategory, AgendaFactor, AgendaItem, FileRow, WorkRow } from './types';
import { resolveLinks } from './initiatives';
import { daysBetween, fmtDate, fyMonthNumber } from './time';

export interface AgendaOptions {
  blockId?: number | null;
  departmentId?: number | null;
  category?: AgendaCategory | null;
  limit?: number;
}

const SUGGEST: Record<AgendaCategory, { text: string; days: number }> = {
  work_delay: { text: 'Fix a recovery plan with the agency and executing officer; weekly progress to DDC', days: 14 },
  file_delay: { text: 'Decision to be taken on the file within 3 working days; reasons to be recorded if returned', days: 3 },
  critical_finding: { text: 'Rectify and upload geo-tagged evidence of resolution for verification', days: 7 },
  service_gap: { text: 'Block-level catch-up plan with panchayat-wise weekly targets', days: 15 },
  coordination: { text: 'Joint action by the departments named; DDC to monitor the dependency chain weekly', days: 10 },
};

function band(score: number): AgendaItem['band'] {
  return score >= 75 ? 'critical' : score >= 55 ? 'high' : 'medium';
}

const lakh = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} lakh`;

export function buildAgenda(ctx: Ctx, opts: AgendaOptions = {}) {
  requireUser(ctx);
  const l = lookups(ctx.db);
  const t = today(ctx);
  const blockName = (id: number | null) => (id ? l.block.get(id)?.name ?? null : null);
  const deptName = (id: number | null) => (id ? l.dept.get(id)?.name ?? '' : '');
  const userName = (id: number | null) => (id ? l.user.get(id)?.name ?? null : null);
  const userDesig = (id: number | null) => (id ? l.user.get(id)?.designation ?? null : null);

  // ---- review history: repeats and open actions by agenda key ----
  const actions = scopedActions(ctx, 'agenda_key IS NOT NULL');
  const allActions = ctx.db.all<ActionItemRow>('SELECT * FROM action_items WHERE agenda_key IS NOT NULL');
  const meetingsByKey = new Map<string, Set<number>>();
  // Only meetings already held (or dated before today) count as "earlier" review meetings.
  const pastMeetings = new Set(
    ctx.db.all<{ id: number }>("SELECT id FROM meetings WHERE status = 'held' OR meeting_date < ?", [t]).map((m) => m.id),
  );
  for (const a of allActions) {
    if (!a.agenda_key || !a.meeting_id || !pastMeetings.has(a.meeting_id)) continue;
    if (!meetingsByKey.has(a.agenda_key)) meetingsByKey.set(a.agenda_key, new Set());
    meetingsByKey.get(a.agenda_key)!.add(a.meeting_id);
  }
  const openByKey = new Map<string, AgendaItem['openActions']>();
  for (const a of actions) {
    if (!a.agenda_key || a.status === 'closed') continue;
    const list = openByKey.get(a.agenda_key) ?? [];
    list.push({ id: a.id, status: a.status, deadline: a.deadline, assignee: userName(a.assigned_to) ?? '', overdue: a.deadline < t });
    openByKey.set(a.agenda_key, list);
  }

  const items: AgendaItem[] = [];

  function finish(partial: Omit<AgendaItem, 'score' | 'band' | 'timesFlaggedBefore' | 'openActions' | 'suggestedAction' | 'suggestedDeadlineDays'> & { suggestedAction?: string }) {
    const factors = [...partial.factors];
    const reasons = [...partial.reasons];
    const keys = [partial.key, ...partial.relatedKeys];
    const meetingIds = new Set<number>();
    for (const k of keys) for (const m of meetingsByKey.get(k) ?? []) meetingIds.add(m);
    const repeats = meetingIds.size;
    if (repeats > 0) {
      factors.push({ label: `Flagged in ${repeats} earlier review meeting${repeats > 1 ? 's' : ''}`, points: 6 * repeats });
      reasons.push(`Already discussed in ${repeats} earlier review meeting${repeats > 1 ? 's' : ''} — still unresolved`);
    }
    const open = keys.flatMap((k) => openByKey.get(k) ?? []);
    const overdueAction = open.find((o) => o.overdue);
    if (overdueAction) {
      const d = daysBetween(overdueAction.deadline, t);
      factors.push({ label: 'Earlier review action overdue', points: 10 });
      reasons.push(`Previous review action assigned to ${overdueAction.assignee} is overdue by ${d} days`);
    } else if (open.length) {
      factors.push({ label: 'Action already assigned and within deadline', points: -8 });
      reasons.push(`Action already assigned to ${open[0].assignee} (due ${fmtDate(open[0].deadline)}) — monitor`);
    }
    // Additive priority points: the breakdown always sums exactly to the score (no ceiling,
    // so two severe items never tie at an artificial cap).
    const score = Math.max(0, Math.round(factors.reduce((s, f) => s + f.points, 0)));
    const sug = SUGGEST[partial.category];
    items.push({
      ...partial,
      factors,
      reasons,
      score,
      band: band(score),
      timesFlaggedBefore: repeats,
      openActions: open,
      suggestedAction: partial.suggestedAction ?? sug.text,
      suggestedDeadlineDays: sug.days,
    });
  }

  // ---- data ----
  const works = scopedWorks(ctx, "status != 'completed'");
  const worksById = new Map<number, WorkRow>(works.map((w) => [w.id, w]));
  const files = scopedFiles(ctx, "f.status IN ('open','query')");
  const filesById = new Map<number, FileRow>(files.map((f) => [f.id, f]));
  const findings = scopedFindings(ctx, "f.status != 'closed'");
  const findingsById = new Map(findings.map((f) => [f.id, f]));
  const queryCounts = new Map<number, number>(
    ctx.db.all<{ file_id: number; n: number }>("SELECT file_id, COUNT(*) AS n FROM file_movements WHERE action = 'query' GROUP BY file_id").map((r) => [r.file_id, r.n]),
  );
  // files that block works (beyond SLA)
  const blockingFileForWork = new Map<number, FileRow>();
  for (const f of files) {
    if (!f.work_id) continue;
    const a = fileAging(f, t);
    if (a.band === 'beyond' || a.band === 'critical') {
      const prev = blockingFileForWork.get(f.work_id);
      if (!prev || fileAging(prev, t).daysAtDesk < a.daysAtDesk) blockingFileForWork.set(f.work_id, f);
    }
  }

  // ---- (d) cross-department coordination bottlenecks ----
  const suppressed = new Set<string>();
  const initiatives = ctx.db.all<{ id: number; code: string; title: string; outcome: string; block_id: number | null; coordinator_id: number | null; target_date: string | null }>(
    'SELECT id, code, title, outcome, block_id, coordinator_id, target_date FROM initiatives',
  );
  const links = ctx.db.all<{ id: number; initiative_id: number; label: string; department_id: number | null; ref_type: string; ref_id: number; depends_on_link_id: number | null }>(
    'SELECT * FROM initiative_links',
  );
  for (const ini of initiatives) {
    const ls = links.filter((x) => x.initiative_id === ini.id);
    const resolved = resolveLinks(ctx, ls);
    const state = new Map(resolved.map((s) => [s.id, { done: s.done, blocked: s.blocked, detail: s.detail, days: s.days, owner: s.ownerId }]));
    const pending = ls.filter((x) => !state.get(x.id)?.done);
    const blocked = ls.filter((x) => state.get(x.id)?.blocked);
    const depts = Array.from(new Set(pending.map((x) => x.department_id).filter((x): x is number => !!x)));
    if (!blocked.length || depts.length < 2) continue;
    if (opts.blockId && ini.block_id !== opts.blockId) continue;
    if (opts.departmentId && !depts.includes(opts.departmentId)) continue;
    const factors: AgendaFactor[] = [{ label: 'Cross-department dependency', points: 38 }];
    const reasons: string[] = [`Needs ${depts.length} departments to act together: ${depts.map(deptName).join(', ')}`];
    factors.push({ label: `${depts.length} departments involved`, points: depts.length * 5 });
    factors.push({ label: `${blocked.length} blocking component${blocked.length > 1 ? 's' : ''}`, points: blocked.length * 7 });
    let maxDays = 0;
    for (const b of blocked) {
      const st = state.get(b.id)!;
      maxDays = Math.max(maxDays, st.days);
      reasons.push(`Blocked: ${b.label} — ${st.detail}`);
    }
    for (const lk of ls) {
      if (!lk.depends_on_link_id) continue;
      const up = ls.find((x) => x.id === lk.depends_on_link_id);
      if (up && !state.get(up.id)?.done && !state.get(lk.id)?.done) reasons.push(`Chain: "${lk.label}" cannot finish until "${up.label}" is done`);
    }
    factors.push({ label: 'Longest wait in the chain', points: Math.min(15, Math.round(maxDays / 4)) });
    if (ini.target_date) {
      const left = daysBetween(t, ini.target_date);
      if (left <= 60) {
        factors.push({ label: 'Outcome deadline within 60 days', points: 8 });
        reasons.push(`Outcome target ${fmtDate(ini.target_date)} (${left} days left) is at risk`);
      }
    }
    for (const lk of ls) suppressed.add(`${lk.ref_type}:${lk.ref_id}`);
    const firstBlocked = blocked[0];
    finish({
      key: `initiative:${ini.id}`,
      category: 'coordination',
      title: ini.title,
      blockId: ini.block_id,
      blockName: blockName(ini.block_id),
      departmentIds: depts,
      departmentNames: depts.map(deptName),
      officerId: state.get(firstBlocked.id)?.owner ?? ini.coordinator_id,
      officerName: userName(state.get(firstBlocked.id)?.owner ?? ini.coordinator_id),
      officerDesignation: userDesig(state.get(firstBlocked.id)?.owner ?? ini.coordinator_id),
      reasons,
      factors,
      refType: 'initiative',
      refId: ini.id,
      link: `/dependencies?id=${ini.id}`,
      relatedKeys: ls.map((x) => `${x.ref_type}:${x.ref_id}`),
      suggestedAction: `Joint decision: ${blocked.map((b) => b.label).join('; ')}. DDC to track the chain weekly.`,
    });
  }

  // ---- (a) persistent work delays ----
  for (const w of works) {
    const key = `work:${w.id}`;
    if (suppressed.has(key)) continue;
    const h = workHealth(w, t);
    if (!h.delayed) continue;
    const factors: AgendaFactor[] = [{ label: 'Work behind schedule', points: 28 }];
    if (h.overdueDays > 0) factors.push({ label: `${h.overdueDays} days past target`, points: Math.min(25, Math.round(h.overdueDays / 4)) });
    if (h.slip > 0) factors.push({ label: `${h.slip} points behind expected progress`, points: Math.min(20, Math.round(h.slip / 2)) });
    if (w.status === 'stalled') factors.push({ label: 'Stalled', points: 10 });
    if (h.notStartedDays > 60) factors.push({ label: 'Start delayed > 60 days', points: 8 });
    if (h.staleDays > RULES.workStaleDays) factors.push({ label: 'Progress not reported for 30+ days', points: 5 });
    if (w.sanctioned_lakh >= 200) factors.push({ label: 'High value (≥ ₹2 crore)', points: 10 });
    else if (w.sanctioned_lakh >= 50) factors.push({ label: 'Value ≥ ₹50 lakh', points: 5 });
    const reasons = [...h.reasons, `Sanctioned ${lakh(w.sanctioned_lakh)}; spent ${lakh(w.expenditure_lakh)} (${Math.round((w.expenditure_lakh / w.sanctioned_lakh) * 100)}%)`];
    const bf = blockingFileForWork.get(w.id);
    if (bf) {
      const a = fileAging(bf, t);
      factors.push({ label: 'Held up by a file beyond SLA', points: 8 });
      reasons.push(`Held up by file ${bf.file_no} at ${l.office.get(bf.current_office_id)?.name} for ${a.daysAtDesk} days (SLA ${bf.sla_days})`);
      suppressed.add(`file:${bf.id}`);
    }
    const persistent = h.overdueDays > 30 || h.staleDays > 30 || (meetingsByKey.get(key)?.size ?? 0) > 0;
    if (persistent) reasons[0] = `Persistent delay — ${reasons[0].charAt(0).toLowerCase()}${reasons[0].slice(1)}`;
    if (opts.blockId && w.block_id !== opts.blockId) continue;
    if (opts.departmentId && w.department_id !== opts.departmentId) continue;
    finish({
      key,
      category: 'work_delay',
      title: w.name,
      blockId: w.block_id,
      blockName: blockName(w.block_id),
      departmentIds: [w.department_id],
      departmentNames: [deptName(w.department_id)],
      officerId: w.officer_id,
      officerName: userName(w.officer_id),
      officerDesignation: userDesig(w.officer_id),
      reasons,
      factors,
      refType: 'work',
      refId: w.id,
      link: `/works/${w.id}`,
      relatedKeys: bf ? [`file:${bf.id}`] : [],
    });
  }

  // ---- decisions pending beyond SLA (persistent delays in file movement) ----
  for (const f of files) {
    const key = `file:${f.id}`;
    if (suppressed.has(key)) continue;
    const a = fileAging(f, t);
    if (a.band !== 'beyond' && a.band !== 'critical') continue;
    if (opts.blockId && f.block_id !== opts.blockId) continue;
    if (opts.departmentId && f.department_id !== opts.departmentId) continue;
    const office = l.office.get(f.current_office_id)?.name ?? '';
    const factors: AgendaFactor[] = [{ label: 'Decision pending beyond SLA', points: 24 }];
    factors.push({ label: `${a.overSla} days beyond SLA`, points: Math.min(30, Math.round((a.overSla / f.sla_days) * 12)) });
    if (f.priority === 'urgent') factors.push({ label: 'Marked urgent', points: 12 });
    else if (f.priority === 'high') factors.push({ label: 'High priority', points: 6 });
    const reasons = [`At ${office} for ${a.daysAtDesk} days — ${a.overSla} days beyond the ${f.sla_days}-day SLA`, `Decision required: ${f.decision_required}`];
    if (f.work_id) {
      const w = worksById.get(f.work_id);
      factors.push({ label: 'Blocks a public work', points: 8 });
      if (w) reasons.push(`Blocks work: ${w.name} (${w.physical_pct}% done)`);
    }
    if ((f.amount_lakh ?? 0) >= 50) factors.push({ label: 'Amount ≥ ₹50 lakh', points: 5 });
    const q = queryCounts.get(f.id) ?? 0;
    if (q >= 2) {
      factors.push({ label: 'Repeated queries', points: 5 });
      reasons.push(`Returned with queries ${q} times — total age ${a.totalDays} days`);
    } else reasons.push(`Total age of file ${a.totalDays} days`);
    finish({
      key,
      category: 'file_delay',
      title: `${f.file_no}: ${f.subject}`,
      blockId: f.block_id,
      blockName: blockName(f.block_id),
      departmentIds: [f.department_id],
      departmentNames: [deptName(f.department_id)],
      officerId: f.current_holder_id,
      officerName: userName(f.current_holder_id),
      officerDesignation: userDesig(f.current_holder_id),
      reasons,
      factors,
      refType: 'file',
      refId: f.id,
      link: `/files/${f.id}`,
      relatedKeys: f.work_id ? [`work:${f.work_id}`] : [],
    });
  }

  // ---- (b) unresolved critical inspection findings ----
  for (const f of findings) {
    const key = `finding:${f.id}`;
    if (suppressed.has(key)) continue;
    const age = daysBetween(f.created_at, t);
    const overdue = f.due_date ? daysBetween(f.due_date, t) : 0;
    const qualifies = f.severity === 'critical' || (f.severity === 'high' && (age > RULES.highFindingDays || overdue > 0)) || f.reopen_count > 0;
    if (!qualifies) continue;
    const deptId = f.responsible_department_id ?? f.asset_dept;
    if (opts.blockId && f.asset_block !== opts.blockId) continue;
    if (opts.departmentId && deptId !== opts.departmentId) continue;
    const factors: AgendaFactor[] = [{ label: 'Unresolved inspection finding', points: 28 }];
    factors.push({ label: f.severity === 'critical' ? 'Critical severity' : 'High severity', points: f.severity === 'critical' ? 20 : 8 });
    factors.push({ label: `Open ${age} days`, points: Math.min(18, Math.round(age / 2)) });
    const reasons = [`${f.severity === 'critical' ? 'Critical' : 'High'} finding at ${f.asset_name}: ${f.title}`, `Open for ${age} days since inspection`];
    if (overdue > 0) {
      factors.push({ label: 'Corrective action past due', points: Math.min(15, overdue) });
      reasons.push(`Corrective action ${overdue} days past due (assigned to ${userName(f.assigned_to) ?? '—'})`);
    }
    if (f.status === 'open') {
      factors.push({ label: 'No corrective action assigned', points: age > 7 ? 8 : 4 });
      reasons.push('No corrective action or owner assigned yet');
    }
    if (f.status === 'resolution_submitted') {
      factors.push({ label: 'Evidence awaiting verification', points: -10 });
      reasons.push('Evidence of resolution submitted — verification pending');
    }
    if (f.reopen_count > 0) {
      factors.push({ label: 'Reopened after rejected evidence', points: 6 * f.reopen_count });
      reasons.push(`Evidence rejected ${f.reopen_count} time${f.reopen_count > 1 ? 's' : ''} — reopened`);
    }
    finish({
      key,
      category: 'critical_finding',
      title: `${f.title} — ${f.asset_name}`,
      blockId: f.asset_block,
      blockName: blockName(f.asset_block),
      departmentIds: [deptId],
      departmentNames: [deptName(deptId)],
      officerId: f.assigned_to,
      officerName: userName(f.assigned_to),
      officerDesignation: userDesig(f.assigned_to),
      reasons,
      factors,
      refType: 'finding',
      refId: f.id,
      link: `/assets/${f.asset_id}?finding=${f.id}`,
      relatedKeys: [],
    });
  }

  // ---- (c) block-level service gaps ----
  const targets = scopedTargets(ctx);
  const monthly = ctx.db.all<{ scheme_id: number; block_id: number; month: string; cumulative: number }>('SELECT scheme_id, block_id, month, cumulative FROM scheme_monthly ORDER BY month');
  const bySchemeAll = new Map<number, { block_id: number; ratio: number }[]>();
  for (const x of ctx.db.all<{ scheme_id: number; block_id: number; annual_target: number; achieved: number }>('SELECT scheme_id, block_id, annual_target, achieved FROM scheme_targets')) {
    const list = bySchemeAll.get(x.scheme_id) ?? [];
    list.push({ block_id: x.block_id, ratio: schemeGap(x.annual_target, x.achieved, t).ratio });
    bySchemeAll.set(x.scheme_id, list);
  }
  const curMonth = t.slice(0, 7);
  for (const x of targets) {
    const g = schemeGap(x.annual_target, x.achieved, t);
    if (g.band !== 'gap') continue;
    if (opts.blockId && x.block_id !== opts.blockId) continue;
    if (opts.departmentId && x.department_id !== opts.departmentId) continue;
    const hist = monthly.filter((m) => m.scheme_id === x.scheme_id && m.block_id === x.block_id && m.month < curMonth);
    let streak = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      const exp = (x.annual_target * fyMonthNumber(hist[i].month)) / 12;
      if (hist[i].cumulative / exp < RULES.gapRatio) streak++;
      else break;
    }
    const peers = bySchemeAll.get(x.scheme_id) ?? [];
    const avg = peers.reduce((s, p) => s + p.ratio, 0) / Math.max(1, peers.length);
    const lowest = peers.every((p) => p.ratio >= g.ratio);
    const factors: AgendaFactor[] = [{ label: 'Service delivery below target', points: 24 }];
    factors.push({ label: `${Math.round((RULES.gapRatio - g.ratio) * 100)} points below the 75% threshold`, points: Math.min(30, Math.round((RULES.gapRatio - g.ratio) * 120)) });
    const reasons = [
      `Achievement ${Math.round(g.ratio * 100)}% of pro-rata target (${x.achieved.toLocaleString('en-IN')} of ${g.expected.toLocaleString('en-IN')} ${x.unit} expected by today)`,
    ];
    if (streak >= 2) {
      factors.push({ label: `Below threshold ${streak} months running`, points: Math.min(16, streak * 4) });
      reasons.push(`Below 75% of target for ${streak} consecutive months — persistent gap`);
    }
    if (lowest) {
      factors.push({ label: 'Lowest block in the district', points: 6 });
      reasons.push(`Lowest of ${peers.length} blocks; district average ${Math.round(avg * 100)}%`);
    } else reasons.push(`District average ${Math.round(avg * 100)}%`);
    reasons.push(`At current pace the block will reach about ${Math.round(g.ratio * 100)}% of the annual target of ${x.annual_target.toLocaleString('en-IN')}`);
    finish({
      key: `gap:${x.scheme_code}:${x.block_id}`,
      category: 'service_gap',
      title: `${x.scheme_name} — ${blockName(x.block_id)} block`,
      blockId: x.block_id,
      blockName: blockName(x.block_id),
      departmentIds: [x.department_id],
      departmentNames: [deptName(x.department_id)],
      officerId: x.officer_id,
      officerName: userName(x.officer_id),
      officerDesignation: userDesig(x.officer_id),
      reasons,
      factors,
      refType: 'scheme_target',
      refId: x.id,
      link: `/schemes?scheme=${x.scheme_id}&block=${x.block_id}`,
      relatedKeys: [],
    });
  }

  let out = items;
  if (opts.category) out = out.filter((i) => i.category === opts.category);
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const counts: Record<AgendaCategory, number> = { work_delay: 0, file_delay: 0, critical_finding: 0, service_gap: 0, coordination: 0 };
  for (const i of items) counts[i.category]++;
  return {
    generatedAt: ctx.now.toISOString(),
    total: out.length,
    counts,
    items: out.slice(0, opts.limit ?? 25),
  };
}
