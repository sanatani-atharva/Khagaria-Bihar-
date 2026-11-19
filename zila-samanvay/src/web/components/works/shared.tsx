// Helpers shared by the works, scheme and import screens.

import { useCallback, useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Tone, WorkStatus } from '../../../core/types';
import { cx } from '../ui';

export const WORK_STATUS_TONE: Record<WorkStatus, Tone> = {
  not_started: 'muted',
  in_progress: 'info',
  stalled: 'bad',
  completed: 'ok',
};

/** Human label for a record's data source ('manual', 'import', 'import:<file name>'). */
export function sourceLabel(src: string | null | undefined): string {
  if (!src || src === 'manual') return 'Entered manually';
  if (src.startsWith('import:')) return `Imported from ${src.slice(7)}`;
  if (src === 'import') return 'Imported from MIS export';
  return src;
}

/** Text label for a scheme pro-rata tone, so status is never shown by colour alone. */
export function ratioLabel(tone: Tone): string {
  return tone === 'bad' || tone === 'critical' ? 'Service gap' : tone === 'warn' ? 'Watch' : 'On target';
}

type ParamValue = string | number | null | undefined | false;

/**
 * Filters kept in the URL so every view is shareable and Back restores the previous view.
 * Any change other than `page` resets pagination.
 */
export function useUrlParams() {
  const [sp, setSp] = useSearchParams();
  const get = useCallback((k: string) => sp.get(k) ?? '', [sp]);
  const set = useCallback(
    (patch: Record<string, ParamValue>, opts: { replace?: boolean } = {}) => {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '' || v === false) n.delete(k);
            else n.set(k, String(v));
          }
          if (!('page' in patch)) n.delete('page');
          return n;
        },
        { replace: opts.replace },
      );
    },
    [setSp],
  );
  return { sp, get, set };
}

/** Labelled native select for filter bars where "All" is not a valid choice (sort order, view). */
export function PlainSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex min-w-36 flex-col gap-0.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-ink-3">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-line-2 bg-white px-3 pr-8 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Parse a positive integer route/search param; null when absent or malformed. */
export function toId(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
