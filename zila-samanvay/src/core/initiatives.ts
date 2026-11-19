// Cross-department dependency model. An initiative is a real-world outcome (e.g. "Middle
// School Improvement — UMS Raunia") that needs several offices to act. Each link points to a
// live record (work, file or inspection finding), so its status is always derived, never typed in.

import type { Ctx } from './context';
import { lookups, today } from './context';
import { fileAging, workHealth } from './rules';
import type { FileRow, FindingRow, Tone, WorkRow } from './types';
import { daysBetween } from './time';

export interface InitiativeRow {
  id: number;
  code: string;
  title: string;
  outcome: string;
  block_id: number | null;
  asset_id: number | null;
  coordinator_id: number | null;
  target_date: string | null;
  created_at: string;
}

export interface LinkRow {
  id: number;
  initiative_id: number;
  label: string;
  department_id: number | null;
  ref_type: string;
  ref_id: number;
  depends_on_link_id: number | null;
}

export interface LinkState extends LinkRow {
  departmentName: string;
  done: boolean;
  blocked: boolean;
  waiting: boolean; // waiting on an unfinished upstream link
  detail: string;
  days: number;
  ownerId: number | null;
  ownerName: string | null;
  ownerDesignation: string | null;
  refTitle: string;
  refLink: string;
  statusLabel: string;
  tone: Tone;
}

export function resolveLinks(ctx: Ctx, links: LinkRow[]): LinkState[] {
  const l = lookups(ctx.db);
  const t = today(ctx);
  const states: LinkState[] = links.map((lk) => {
    let done = false;
    let blocked = false;
    let detail = 'Record not found';
    let days = 0;
    let owner: number | null = null;
    let refTitle = '';
    let refLink = '';
    let statusLabel = 'Unknown';
    if (lk.ref_type === 'work') {
      const w = ctx.db.get<WorkRow>('SELECT * FROM works WHERE id = ?', [lk.ref_id]);
      if (w) {
        const h = workHealth(w, t);
        done = w.status === 'completed';
        blocked = !done && h.delayed;
        days = Math.max(h.overdueDays, h.staleDays, h.notStartedDays);
        owner = w.officer_id;
        refTitle = `${w.code} · ${w.name}`;
        refLink = `/works/${w.id}`;
        statusLabel = done ? 'Completed' : `${h.label} · ${w.physical_pct}%`;
        detail = done ? 'completed' : `${w.physical_pct}% done${h.reasons[0] ? ' — ' + h.reasons[0].toLowerCase() : ''}`;
      }
    } else if (lk.ref_type === 'file') {
      const f = ctx.db.get<FileRow>('SELECT * FROM files WHERE id = ?', [lk.ref_id]);
      if (f) {
        const a = fileAging(f, t);
        done = f.status === 'closed' || f.status === 'approved';
        blocked = !done && (a.band === 'beyond' || a.band === 'critical');
        days = a.daysAtDesk;
        owner = f.current_holder_id;
        refTitle = `${f.file_no} · ${f.subject}`;
        refLink = `/files/${f.id}`;
        statusLabel = done ? (f.status === 'approved' ? 'Approved' : 'Closed') : f.status === 'query' ? 'Query pending' : a.label;
        detail = done ? 'decision taken' : `file ${f.file_no} at ${l.office.get(f.current_office_id)?.name} for ${a.daysAtDesk} days (SLA ${f.sla_days})`;
      }
    } else if (lk.ref_type === 'finding') {
      const fd = ctx.db.get<FindingRow & { asset_name: string }>('SELECT f.*, a.name AS asset_name FROM findings f JOIN assets a ON a.id = f.asset_id WHERE f.id = ?', [lk.ref_id]);
      if (fd) {
        done = fd.status === 'closed';
        const age = daysBetween(fd.created_at, t);
        const overdue = fd.due_date ? daysBetween(fd.due_date, t) : 0;
        blocked = !done && fd.status !== 'resolution_submitted' && (fd.severity === 'critical' || overdue > 0 || (fd.status === 'open' && age > 7));
        days = age;
        owner = fd.assigned_to;
        refTitle = `${fd.title} (${fd.asset_name})`;
        refLink = `/assets/${fd.asset_id}?finding=${fd.id}`;
        statusLabel = done ? 'Closed' : fd.status === 'resolution_submitted' ? 'Evidence submitted' : fd.status === 'assigned' ? (overdue > 0 ? `Overdue ${overdue} d` : 'Action assigned') : 'Not assigned';
        detail = done
          ? 'closed with verified evidence'
          : fd.status === 'resolution_submitted'
            ? 'evidence submitted, awaiting verification'
            : `${fd.severity} finding open ${age} days${overdue > 0 ? `, ${overdue} days past due` : ''}`;
      }
    }
    const u = owner ? l.user.get(owner) : undefined;
    return {
      ...lk,
      departmentName: lk.department_id ? l.dept.get(lk.department_id)?.name ?? '' : '',
      done,
      blocked,
      waiting: false,
      detail,
      days,
      ownerId: owner,
      ownerName: u?.name ?? null,
      ownerDesignation: u?.designation ?? null,
      refTitle,
      refLink,
      statusLabel,
      tone: done ? 'ok' : blocked ? 'bad' : 'warn',
    };
  });
  for (const s of states) {
    const up = s.depends_on_link_id ? states.find((x) => x.id === s.depends_on_link_id) : undefined;
    s.waiting = !!up && !up.done && !s.done;
    if (s.waiting && !s.blocked) s.tone = 'warn';
  }
  return states;
}

export function summariseInitiative(ini: InitiativeRow, states: LinkState[], todayStr: string) {
  const pending = states.filter((s) => !s.done);
  const blocked = states.filter((s) => s.blocked);
  const pendingDepts = Array.from(new Set(pending.map((s) => s.departmentName).filter(Boolean)));
  // root bottleneck = blocked link that is not itself waiting on something upstream, longest wait first
  const roots = blocked.filter((s) => !s.waiting).sort((a, b) => b.days - a.days);
  const bottleneck = roots[0] ?? blocked.sort((a, b) => b.days - a.days)[0] ?? null;
  const daysLeft = ini.target_date ? daysBetween(todayStr, ini.target_date) : null;
  const status: 'done' | 'blocked' | 'on_track' = !pending.length ? 'done' : blocked.length ? 'blocked' : 'on_track';
  return {
    status,
    progress: states.length ? Math.round(((states.length - pending.length) / states.length) * 100) : 0,
    pendingCount: pending.length,
    blockedCount: blocked.length,
    pendingDepartments: pendingDepts,
    bottleneck,
    daysLeft,
  };
}
