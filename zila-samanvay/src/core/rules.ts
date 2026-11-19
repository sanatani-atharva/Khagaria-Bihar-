// Business rules in one place: delay detection, SLA ageing, service-gap thresholds.
// The priority engine, drill-down, dashboards and UI badges all read from here, so a
// threshold changed here changes everywhere consistently.

import type { FileRow, FindingRow, Tone, WorkRow } from './types';
import { daysBetween, fyMonthsElapsed } from './time';

export const RULES = {
  /** A work is "behind" when physical progress trails the time-based expectation by this many points. */
  workSlipPoints: 20,
  /** No progress update for this many days = stale reporting. */
  workStaleDays: 30,
  /** Not started this many days after the planned start date = delayed. */
  notStartedGraceDays: 30,
  /** Scheme achievement below this share of the pro-rata target = service gap. */
  gapRatio: 0.75,
  /** Between gapRatio and this = watch. */
  watchRatio: 0.9,
  /** High-severity findings older than this are escalated. */
  highFindingDays: 14,
  /** SLA defaults per file category (days at one desk). */
  fileSla: {
    'Administrative approval': 15,
    'Technical sanction': 15,
    'Fund allotment': 10,
    'Payment / bill': 7,
    'Tender approval': 21,
    'Land / NOC': 30,
    Establishment: 15,
    'Utilisation certificate': 10,
    Other: 15,
  } as Record<string, number>,
};

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Linear time-based expected physical progress (%) for a work on `today`. */
export function expectedProgress(w: Pick<WorkRow, 'start_date' | 'target_date' | 'status'>, today: string): number {
  if (!w.start_date || !w.target_date) return 0;
  const span = daysBetween(w.start_date, w.target_date);
  if (span <= 0) return 100;
  return Math.round(clamp((daysBetween(w.start_date, today) / span) * 100, 0, 100));
}

export interface WorkHealth {
  expected: number;
  slip: number;
  overdueDays: number;
  staleDays: number;
  notStartedDays: number;
  delayed: boolean;
  tone: Tone;
  label: string;
  reasons: string[];
}

export function workHealth(w: WorkRow, today: string): WorkHealth {
  const expected = expectedProgress(w, today);
  const slip = Math.round(expected - w.physical_pct);
  const overdueDays = w.target_date && w.status !== 'completed' ? Math.max(0, daysBetween(w.target_date, today)) : 0;
  const staleDays = w.status === 'completed' ? 0 : Math.max(0, daysBetween(w.updated_at, today));
  const notStartedDays = w.status === 'not_started' && w.start_date ? Math.max(0, daysBetween(w.start_date, today)) : 0;
  const reasons: string[] = [];
  if (w.status === 'completed') {
    return { expected: 100, slip: 0, overdueDays: 0, staleDays: 0, notStartedDays: 0, delayed: false, tone: 'ok', label: 'Completed', reasons };
  }
  if (overdueDays > 0) reasons.push(`Target date crossed ${overdueDays} days ago`);
  if (slip >= RULES.workSlipPoints) reasons.push(`Physical progress ${w.physical_pct}% vs ${expected}% expected by today (${slip} points behind)`);
  if (w.status === 'stalled') reasons.push(`Marked stalled${w.hold_reason ? `: ${w.hold_reason}` : ''}`);
  if (notStartedDays > RULES.notStartedGraceDays) reasons.push(`Not started ${notStartedDays} days after planned start${w.hold_reason ? ` — ${w.hold_reason}` : ''}`);
  if (staleDays > RULES.workStaleDays) reasons.push(`No progress update for ${staleDays} days`);
  const delayed = reasons.length > 0;
  let tone: Tone = 'ok';
  let label = w.status === 'not_started' ? 'Not started' : 'On track';
  if (delayed) {
    const severe = overdueDays > 30 || slip >= 35 || w.status === 'stalled' || notStartedDays > 60;
    tone = severe ? 'bad' : 'warn';
    label = w.status === 'stalled' ? 'Stalled' : overdueDays > 0 ? 'Overdue' : slip >= RULES.workSlipPoints ? 'Behind schedule' : notStartedDays > RULES.notStartedGraceDays ? 'Start delayed' : 'Reporting stale';
  }
  return { expected, slip, overdueDays, staleDays, notStartedDays, delayed, tone, label, reasons };
}

export interface FileAging {
  daysAtDesk: number;
  totalDays: number;
  overSla: number;
  band: 'within' | 'near' | 'beyond' | 'critical' | 'closed';
  tone: Tone;
  label: string;
}

export function fileAging(f: Pick<FileRow, 'arrived_at' | 'opened_at' | 'sla_days' | 'status' | 'closed_at'>, today: string): FileAging {
  const end = f.status === 'closed' && f.closed_at ? f.closed_at : today;
  const daysAtDesk = Math.max(0, daysBetween(f.arrived_at, end));
  const totalDays = Math.max(0, daysBetween(f.opened_at, end));
  const overSla = daysAtDesk - f.sla_days;
  if (f.status === 'closed') return { daysAtDesk, totalDays, overSla: 0, band: 'closed', tone: 'muted', label: 'Closed' };
  if (daysAtDesk > f.sla_days * 2) return { daysAtDesk, totalDays, overSla, band: 'critical', tone: 'critical', label: `${overSla} d over SLA` };
  if (daysAtDesk > f.sla_days) return { daysAtDesk, totalDays, overSla, band: 'beyond', tone: 'bad', label: `${overSla} d over SLA` };
  if (daysAtDesk > f.sla_days * 0.7) return { daysAtDesk, totalDays, overSla, band: 'near', tone: 'warn', label: `${f.sla_days - daysAtDesk} d to SLA` };
  return { daysAtDesk, totalDays, overSla, band: 'within', tone: 'ok', label: 'Within SLA' };
}

export interface GapStatus {
  expected: number;
  ratio: number;
  pctOfAnnual: number;
  band: 'ok' | 'watch' | 'gap';
  tone: Tone;
}

export function schemeGap(annualTarget: number, achieved: number, today: string): GapStatus {
  const expected = Math.max(1, Math.round((annualTarget * fyMonthsElapsed(today)) / 12));
  const ratio = achieved / expected;
  const band = ratio < RULES.gapRatio ? 'gap' : ratio < RULES.watchRatio ? 'watch' : 'ok';
  return {
    expected,
    ratio: Math.round(ratio * 1000) / 1000,
    pctOfAnnual: annualTarget ? Math.round((achieved / annualTarget) * 1000) / 10 : 0,
    band,
    tone: band === 'gap' ? 'bad' : band === 'watch' ? 'warn' : 'ok',
  };
}

export function findingTone(f: Pick<FindingRow, 'severity' | 'status'>): Tone {
  if (f.status === 'closed') return 'muted';
  if (f.severity === 'critical') return 'critical';
  if (f.severity === 'high') return 'bad';
  if (f.severity === 'medium') return 'warn';
  return 'info';
}

export function findingNextAction(f: Pick<FindingRow, 'status' | 'due_date'>, assigneeName: string | null): string {
  switch (f.status) {
    case 'open':
      return 'Department head to assign corrective action, owner and due date';
    case 'assigned':
      return `${assigneeName ?? 'Assigned officer'} to rectify and upload evidence of resolution`;
    case 'resolution_submitted':
      return 'Verifying officer to check the evidence and close or reopen';
    default:
      return 'Closed — no action';
  }
}

export function severityRank(s: string): number {
  return s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}
