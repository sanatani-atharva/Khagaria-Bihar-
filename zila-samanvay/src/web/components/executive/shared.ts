// Small helpers shared by the executive screens (dashboard, drill-down, dependencies).
// Pure functions only: safe for the browser bundle.

import type { Tone } from '../../../core/types';

export type InitiativeStatus = 'done' | 'blocked' | 'on_track';

export const INITIATIVE_STATUS: Record<InitiativeStatus, { tone: Tone; label: string }> = {
  done: { tone: 'ok', label: 'Done' },
  blocked: { tone: 'bad', label: 'Blocked' },
  on_track: { tone: 'info', label: 'On track' },
};

/** "45 d left", "12 d past target", "Due today" or "No target date". */
export function daysLeftLabel(daysLeft: number | null | undefined): { text: string; tone: Tone } {
  if (daysLeft === null || daysLeft === undefined) return { text: 'No target date', tone: 'muted' };
  if (daysLeft < 0) return { text: `${-daysLeft} d past target`, tone: 'bad' };
  if (daysLeft === 0) return { text: 'Due today', tone: 'warn' };
  return { text: `${daysLeft} d left`, tone: daysLeft <= 14 ? 'warn' : 'muted' };
}

/**
 * The one-word state of a dependency component, always shown next to its colour.
 * "Waiting" = held up by an unfinished upstream step (red when it is also past its own limits);
 * "Blocked" = stuck on its own account, with nothing upstream to blame.
 */
export function componentState(l: { done: boolean; blocked: boolean; waiting: boolean }): { word: string; tone: Tone } {
  if (l.done) return { word: 'Done', tone: 'ok' };
  if (l.waiting) return { word: 'Waiting', tone: l.blocked ? 'bad' : 'warn' };
  if (l.blocked) return { word: 'Blocked', tone: 'bad' };
  return { word: 'In progress', tone: 'warn' };
}

export const BAND_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium' };

/** Build a /drill URL from a metric and optional block / department filters. */
export function drillHref(metric: string, opts: { block?: number | null; dept?: number | null } = {}): string {
  const p = new URLSearchParams({ metric });
  if (opts.block !== undefined && opts.block !== null) p.set('block', String(opts.block));
  if (opts.dept !== undefined && opts.dept !== null) p.set('dept', String(opts.dept));
  return `/drill?${p.toString()}`;
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
