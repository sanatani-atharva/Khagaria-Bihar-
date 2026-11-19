// Shared helpers for the Review Meeting module (command centre + print-ready brief).
// Pure browser code: only type imports from core/rpc, label maps from core/types.

import type { ProcInput, ProcOutput } from '../../../core/rpc';
import type { ActionStatus, AgendaCategory, AgendaItem, EvidenceMeta, Tone } from '../../../core/types';
import { ACTION_STATUS_LABEL, AGENDA_CATEGORY_LABEL } from '../../../core/types';
import { downloadText } from '../../lib/files';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { rpc } from '../../lib/rpc';
import { toCsv } from '../../lib/sheets';

export type Brief = ProcOutput<'review.brief'>;
export type ActionRow = ProcOutput<'review.actions'>['rows'][number];
export type Meeting = ProcOutput<'review.meetings'>[number];
export type Lookups = ProcOutput<'ref.lookups'>;

/** Display order of agenda categories (filter chips, summaries). */
export const CATEGORY_ORDER: AgendaCategory[] = ['work_delay', 'file_delay', 'critical_finding', 'service_gap', 'coordination'];

export const BAND_ORDER: AgendaItem['band'][] = ['critical', 'high', 'medium'];
export const BAND_LABEL: Record<AgendaItem['band'], string> = { critical: 'Critical', high: 'High', medium: 'Medium' };
export const BAND_RANGE: Record<AgendaItem['band'], string> = { critical: 'score 75 and above', high: 'score 55–74', medium: 'score below 55' };

export function isCategory(v: string | null): v is AgendaCategory {
  return !!v && (CATEGORY_ORDER as string[]).includes(v);
}

/** Positive integer from a URL param, else undefined. */
export function posInt(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function actionLabel(s: string): string {
  return ACTION_STATUS_LABEL[s as ActionStatus] ?? s;
}

export function actionTone(s: string): Tone {
  switch (s as ActionStatus) {
    case 'closed':
      return 'ok';
    case 'resolution_submitted':
      return 'warn';
    case 'reopened':
      return 'bad';
    case 'in_progress':
      return 'info';
    default:
      return 'muted';
  }
}

export function meetingStatusLabel(s: string): string {
  if (s === 'scheduled') return 'Scheduled';
  if (s === 'held') return 'Held — minutes recorded';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function meetingTone(s: string): Tone {
  return s === 'scheduled' ? 'info' : s === 'held' ? 'ok' : 'muted';
}

/** Default meeting: the earliest still-scheduled one, else the most recent. */
export function pickDefaultMeeting(meetings: Meeting[]): Meeting | null {
  if (!meetings.length) return null;
  const scheduled = meetings.filter((m) => m.status === 'scheduled').sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  if (scheduled.length) return scheduled[0];
  return [...meetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))[0];
}

/** One-line evidence state of an action (used in the tracker, the brief and the CSV). */
export function evidenceState(a: { status: string; evidence: EvidenceMeta[] }): { label: string; tone: Tone } {
  if (a.evidence.some((e) => e.review_status === 'accepted')) return { label: 'Verified', tone: 'ok' };
  if (a.evidence.some((e) => e.review_status === 'pending')) return { label: 'Awaiting verification', tone: 'warn' };
  if (a.evidence.some((e) => e.review_status === 'rejected')) return { label: 'Rejected — resubmission due', tone: 'bad' };
  return { label: 'No evidence yet', tone: 'muted' };
}

/** Text summary of actions already assigned against an agenda item. */
export function existingActionText(open: AgendaItem['openActions']): string {
  if (!open.length) return 'None';
  return open
    .map((o) => `${o.assignee || 'Officer'} — ${actionLabel(o.status)}, due ${fmtDate(o.deadline)}${o.overdue ? ' (overdue)' : ''}`)
    .join('; ');
}

/** Source record of an action, when it has its own page. */
export function refLink(refType: string | null, refId: number | null): string | null {
  if (!refType || !refId) return null;
  if (refType === 'work') return `/works/${refId}`;
  if (refType === 'file') return `/files/${refId}`;
  if (refType === 'initiative') return `/dependencies?id=${refId}`;
  return null;
}

/** "Alauli block · Health" style description of the active filters. */
export function scopeLabel(lookups: Lookups | undefined, blockId?: number, departmentId?: number): string {
  if (!blockId && !departmentId) return 'All blocks, all departments (within your jurisdiction)';
  const bName = blockId ? lookups?.blocks.find((x) => x.id === blockId)?.name : null;
  const dName = departmentId ? lookups?.departments.find((x) => x.id === departmentId)?.name : null;
  const b = blockId ? (bName ? `${bName} block` : `Block #${blockId}`) : 'All blocks';
  const d = departmentId ? (dName ?? `Department #${departmentId}`) : 'All departments';
  return `${b} · ${d}`;
}

export function briefLink(meetingId?: number, blockId?: number, departmentId?: number): string {
  const p = new URLSearchParams();
  if (meetingId) p.set('meeting', String(meetingId));
  if (blockId) p.set('block', String(blockId));
  if (departmentId) p.set('dept', String(departmentId));
  const s = p.toString();
  return `/review/brief${s ? `?${s}` : ''}`;
}

/** The review brief as CSV: ranked agenda, then the action-taken report. */
export function briefCsv(b: Brief, scope?: string): string {
  const rows: (string | number | null)[][] = [];
  rows.push(['District Administration, Khagaria — Review Meeting Brief']);
  if (b.meeting) rows.push(['Meeting', b.meeting.title, fmtDate(b.meeting.meeting_date), `Chair: ${b.meeting.chairName ?? '—'}`]);
  else rows.push(['Meeting', 'No meeting scheduled — brief for the next review']);
  if (scope) rows.push(['Scope', scope]);
  rows.push(['Generated by', b.generatedBy, fmtDateTime(b.generatedAt)]);
  rows.push(['Note', 'Prototype — synthetic data']);
  rows.push([]);

  rows.push([`SECTION 1: RANKED AGENDA (top ${b.agenda.items.length} of ${b.agenda.total} flagged items)`]);
  rows.push(['Rank', 'Score', 'Band', 'Category', 'Title', 'Block', 'Departments', 'Responsible officer', 'Why flagged', 'Suggested action', 'Existing action']);
  b.agenda.items.forEach((it, i) => {
    rows.push([
      i + 1,
      it.score,
      BAND_LABEL[it.band],
      AGENDA_CATEGORY_LABEL[it.category],
      it.title,
      it.blockName ?? 'District-wide',
      it.departmentNames.filter(Boolean).join(', '),
      it.officerName ? `${it.officerName}${it.officerDesignation ? `, ${it.officerDesignation}` : ''}` : 'Not assigned',
      it.reasons.join(' | '),
      it.suggestedAction,
      existingActionText(it.openActions),
    ]);
  });
  rows.push([]);

  rows.push([`SECTION 2: ACTION-TAKEN REPORT (${b.actions.length} actions; closed actions from the last 30 days included)`]);
  rows.push(['Title', 'Decision', 'Assignee', 'Department', 'Block', 'Deadline', 'Status', 'Overdue days', 'Evidence status']);
  for (const a of b.actions) {
    rows.push([
      a.title,
      a.decision,
      `${a.assigneeName}${a.assigneeDesignation ? `, ${a.assigneeDesignation}` : ''}`,
      a.departmentName ?? '',
      a.blockName ?? '',
      fmtDate(a.deadline),
      a.statusLabel,
      a.overdueBy,
      evidenceState(a).label,
    ]);
  }
  return toCsv(rows);
}

export function briefFileName(b: Brief): string {
  const d = (b.meeting?.meeting_date ?? b.generatedAt).slice(0, 10);
  return `review-brief-khagaria-${d}.csv`;
}

/** Fetch the brief and download it as CSV. Returns what was exported. */
export async function exportBriefCsv(input: NonNullable<ProcInput<'review.brief'>>, scope?: string) {
  const b = await rpc('review.brief', input);
  downloadText(briefFileName(b), briefCsv(b, scope));
  return { items: b.agenda.items.length, actions: b.actions.length };
}
