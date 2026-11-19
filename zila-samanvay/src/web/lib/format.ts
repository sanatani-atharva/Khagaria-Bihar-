import { daysBetween, fmtDate as coreFmtDate, ymd } from '../../core/time';
import type { Tone } from '../../core/types';

export const fmtDate = coreFmtDate;

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${coreFmtDate(ymd(d))}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}

/** ₹ in lakh, Indian grouping: 412.5 -> "₹412.5 L"; ≥100 L shown in crore too when asked. */
export function lakh(n: number | null | undefined, opts: { crore?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (opts.crore && n >= 100) return `₹${(n / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: digits })}%`;
}

export function today(): string {
  return ymd(new Date());
}

/** "today", "3 d ago", "in 5 d" */
export function relDays(date: string | null | undefined): string {
  if (!date) return '—';
  const d = daysBetween(today(), date.slice(0, 10));
  if (d === 0) return 'today';
  return d < 0 ? `${-d} d ago` : `in ${d} d`;
}

export function addDaysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Tailwind classes for each semantic tone (text + soft background + border). */
export const TONE: Record<Tone, { text: string; bg: string; border: string; dot: string; bar: string }> = {
  ok: { text: 'text-ok', bg: 'bg-ok-soft', border: 'border-ok/30', dot: 'bg-ok', bar: 'bg-ok' },
  info: { text: 'text-info', bg: 'bg-info-soft', border: 'border-info/30', dot: 'bg-info', bar: 'bg-info' },
  warn: { text: 'text-warn', bg: 'bg-warn-soft', border: 'border-warn/30', dot: 'bg-warn', bar: 'bg-warn' },
  bad: { text: 'text-bad', bg: 'bg-bad-soft', border: 'border-bad/30', dot: 'bg-bad', bar: 'bg-bad' },
  critical: { text: 'text-critical', bg: 'bg-critical-soft', border: 'border-critical/40', dot: 'bg-critical', bar: 'bg-critical' },
  muted: { text: 'text-ink-3', bg: 'bg-subtle', border: 'border-line', dot: 'bg-ink-3', bar: 'bg-ink-3' },
};

export function severityTone(s: string): Tone {
  return s === 'critical' ? 'critical' : s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'info';
}

export function conditionTone(c: string): Tone {
  return c === 'critical' ? 'critical' : c === 'needs_repair' ? 'warn' : 'ok';
}

export function bandTone(b: string): Tone {
  return b === 'critical' ? 'critical' : b === 'high' ? 'bad' : 'warn';
}

export function ratioTone(r: number): Tone {
  return r < 0.75 ? 'bad' : r < 0.9 ? 'warn' : 'ok';
}
