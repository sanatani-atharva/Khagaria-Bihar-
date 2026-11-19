// Small building blocks shared by the file tracker, file detail, officer desk and audit pages.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FileStatus, Tone } from '../../../core/types';
import type { FileAging } from '../../../core/rules';
import { useDebounced } from '../../lib/hooks';
import { TONE } from '../../lib/format';
import { Badge, cx } from '../ui';

export const FILE_STATUS_TONE: Record<FileStatus, Tone> = {
  open: 'info',
  query: 'warn',
  approved: 'ok',
  closed: 'muted',
};

export function FileStatusBadge({ status, label }: { status: FileStatus; label: string }) {
  return <Badge tone={FILE_STATUS_TONE[status]}>{label}</Badge>;
}

/** Ageing at the current desk, always with a text label ("23 d over SLA", "Within SLA"). */
export function AgingBadge({ aging }: { aging: Pick<FileAging, 'tone' | 'label' | 'band'> }) {
  return (
    <Badge tone={aging.tone} title={aging.band === 'critical' ? 'More than twice the SLA at this desk' : undefined}>
      {aging.label}
    </Badge>
  );
}

export function PriorityBadge({ priority, showNormal }: { priority: 'normal' | 'high' | 'urgent'; showNormal?: boolean }) {
  if (priority === 'urgent') return <Badge tone="critical">Urgent</Badge>;
  if (priority === 'high') return <Badge tone="warn">High priority</Badge>;
  return showNormal ? <span className="text-xs text-ink-3">Normal</span> : null;
}

/** A pressable filter chip with a tone dot, label and count. */
export function ToneChip({ tone, label, count, active, onClick }: { tone?: Tone; label: string; count?: number; active: boolean; onClick: () => void }) {
  const t = tone ? TONE[tone] : null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors',
        active ? cx('ring-2 ring-accent/30', t ? cx(t.bg, t.text, t.border) : 'border-ink bg-ink text-white') : 'border-line-2 bg-white text-ink-2 hover:bg-subtle',
      )}
    >
      {t && <span className={cx('size-2 rounded-full', t.dot)} aria-hidden />}
      {label}
      {count !== undefined && (
        <span className={cx('tabular rounded-full px-1.5 text-[11px]', active && !t ? 'bg-white/20' : 'bg-line text-ink-2')}>{count}</span>
      )}
    </button>
  );
}

type Patch = Record<string, string | number | null | undefined>;

/**
 * Filters kept in the URL so views are shareable and Back works. Any change other than an
 * explicit `page` resets pagination to page 1.
 */
export function useUrlFilters() {
  const [sp, setSp] = useSearchParams();
  const get = useCallback((k: string) => sp.get(k) ?? '', [sp]);
  const set = useCallback(
    (patch: Patch, opts?: { replace?: boolean }) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: opts?.replace },
      );
    },
    [setSp],
  );
  const page = Math.max(1, Number(sp.get('page')) || 1);
  return { sp, get, set, page };
}

/** Search box state that is debounced into the `key` URL parameter and follows Back/Forward. */
export function useUrlSearch(key: string, urlValue: string, set: (patch: Patch, opts?: { replace?: boolean }) => void) {
  const [value, setValue] = useState(urlValue);
  const debounced = useDebounced(value.trim(), 300);
  useEffect(() => {
    if (debounced !== urlValue) set({ [key]: debounced || null }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    if (urlValue !== debounced) setValue(urlValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlValue]);
  return [value, setValue] as const;
}

/** Positive integer id from a URL parameter, or undefined. */
export function idParam(v: string): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
