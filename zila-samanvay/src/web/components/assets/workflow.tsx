// Inspection-to-closure workflow visuals for the asset module: the per-finding stepper and the
// asset-level stage summary. Every state carries a text label, never colour alone.

import { Check, ChevronRight } from 'lucide-react';
import type { FindingStatus, Tone } from '../../../core/types';
import { TONE } from '../../lib/format';
import { cx } from '../ui';

export const FINDING_STEPS: { status: FindingStatus; label: string; hint: string }[] = [
  { status: 'open', label: 'Open', hint: 'Finding recorded at inspection' },
  { status: 'assigned', label: 'Action assigned', hint: 'Officer and due date fixed' },
  { status: 'resolution_submitted', label: 'Evidence submitted', hint: 'Photo / document uploaded' },
  { status: 'closed', label: 'Verified & closed', hint: 'Evidence accepted by a second officer' },
];

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export function functionalTone(s: string): Tone {
  return s === 'non_functional' ? 'bad' : s === 'partially' ? 'warn' : 'ok';
}

/** Four-step stepper for one finding, with the current step highlighted. */
export function FindingStepper({ status }: { status: FindingStatus }) {
  const cur = FINDING_STEPS.findIndex((s) => s.status === status);
  const closed = status === 'closed';
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Corrective action progress">
      {FINDING_STEPS.map((s, i) => {
        const state: 'done' | 'current' | 'todo' = closed || i < cur ? 'done' : i === cur ? 'current' : 'todo';
        return (
          <li
            key={s.status}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cx(
              'flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2',
              state === 'current' ? 'border-accent bg-accent-soft' : state === 'done' ? 'border-ok/30 bg-ok-soft/50' : 'border-line bg-white',
            )}
          >
            <span
              className={cx(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                state === 'done' ? 'bg-ok text-white' : state === 'current' ? 'bg-accent text-white' : 'bg-subtle text-ink-3',
              )}
              aria-hidden
            >
              {state === 'done' ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx('block text-[13px] font-semibold leading-tight', state === 'todo' ? 'text-ink-3' : 'text-ink')}>{s.label}</span>
              <span className={cx('block text-[11px] font-semibold', state === 'current' ? 'text-accent' : state === 'done' ? 'text-ok' : 'text-ink-3')}>
                {state === 'done' ? 'Done' : state === 'current' ? 'Current step' : 'Pending'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Asset-level summary: how many findings sit at each stage of the workflow. */
export function WorkflowSummary({ counts, lastInspected }: { counts: Record<FindingStatus, number>; lastInspected: string }) {
  const stages: { label: string; sub: string; value: number | string; tone: Tone }[] = [
    { label: 'Inspection', sub: 'Last recorded', value: lastInspected, tone: 'muted' },
    { label: 'Open', sub: 'Awaiting assignment', value: counts.open, tone: counts.open ? 'bad' : 'muted' },
    { label: 'Action assigned', sub: 'Being rectified', value: counts.assigned, tone: counts.assigned ? 'warn' : 'muted' },
    { label: 'Evidence submitted', sub: 'Awaiting verification', value: counts.resolution_submitted, tone: counts.resolution_submitted ? 'info' : 'muted' },
    { label: 'Verified & closed', sub: 'Evidence accepted', value: counts.closed, tone: counts.closed ? 'ok' : 'muted' },
  ];
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Inspection-to-closure workflow">
      {stages.map((s, i) => (
        <li key={s.label} className="relative flex min-w-0 flex-col rounded-md bg-panel px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
            {i + 1}. {s.label}
          </span>
          <span className={cx('tabular mt-1 truncate text-lg font-bold leading-tight', typeof s.value === 'number' ? TONE[s.tone].text : 'text-ink')}>
            {typeof s.value === 'number' ? `${s.value} finding${s.value === 1 ? '' : 's'}` : s.value}
          </span>
          <span className="text-xs text-ink-3">{s.sub}</span>
          {i < stages.length - 1 && (
            <ChevronRight className="absolute -right-2.5 top-1/2 z-[1] hidden size-4 -translate-y-1/2 rounded-full bg-canvas text-ink-3 lg:block" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
