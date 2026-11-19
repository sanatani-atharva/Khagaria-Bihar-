// Shared UI kit. Every screen composes these so spacing, colour and states stay consistent.
// Status is never shown by colour alone: tones always carry a text label too.

import { ChevronLeft, ChevronRight, Loader2, Phone, X, AlertTriangle, Inbox } from 'lucide-react';
import {
  forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../../core/types';
import { TONE } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------- buttons ----------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 border-transparent',
  secondary: 'bg-white text-ink border-line-2 hover:bg-subtle',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-subtle',
  danger: 'bg-bad text-white border-transparent hover:bg-critical',
  success: 'bg-ok text-white border-transparent hover:brightness-95',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5 text-sm',
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ to, children, variant = 'secondary', size = 'md', icon, className }: { to: string; children: ReactNode; variant?: BtnVariant; size?: 'sm' | 'md'; icon?: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold transition-colors duration-150',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5 text-sm',
        BTN[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ---------------- surfaces ----------------
export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={cx('rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]', className)}>{children}</As>;
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold leading-snug text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, hindi, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; hindi?: string; crumbs?: { label: string; to?: string }[] }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && <Breadcrumbs items={crumbs} />}
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-2xl">
          {title} {hindi && <span lang="hi" className="hi ml-1 text-base font-normal text-ink-3">{hindi}</span>}
        </h1>
        {subtitle && <p className="mt-1 max-w-[52ch] text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-ink-3">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
            {c.to ? (
              <Link className="hover:text-accent hover:underline" to={c.to}>
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-semibold text-ink-2">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------- status ----------------
export function Badge({ tone = 'muted', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  const t = TONE[tone];
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', t.bg, t.text, t.border, className)}>
      <span className={cx('size-1.5 rounded-full', t.dot)} aria-hidden />
      {children}
    </span>
  );
}

/** KPI tile. `plain` renders a flat cell for use inside a grouped card (no card-in-card). */
export function Kpi({ label, value, sub, tone, to, onClick, hint, plain }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; to?: string; onClick?: () => void; hint?: string; plain?: boolean }) {
  const body = (
    <>
      <div className="text-[13px] font-semibold text-ink-3">{label}</div>
      <div className={cx('tabular mt-1 text-[26px] font-bold leading-none', tone ? TONE[tone].text : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1.5 text-[13px] text-ink-3">{sub}</div>}
      {hint && <div className="mt-2 text-xs font-semibold text-accent">{hint} →</div>}
    </>
  );
  const cls = plain ? 'block bg-panel px-4 py-3.5 text-left' : 'block rounded-[var(--radius-card)] border border-line bg-panel p-4 text-left shadow-[var(--shadow-card)]';
  if (to)
    return (
      <Link to={to} className={cx(cls, 'transition-colors hover:bg-accent-soft/40', !plain && 'hover:border-accent')}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx(cls, 'w-full transition-colors hover:bg-accent-soft/40', !plain && 'hover:border-accent')}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

/** Progress bar with an optional "expected by today" marker. */
export function Progress({ value, expected, tone = 'info', label, className }: { value: number; expected?: number; tone?: Tone; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cx('w-full', className)}>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-valuenow={Math.round(v)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className={cx('h-full rounded-full', TONE[tone].bar)} style={{ width: `${v}%` }} />
        {expected !== undefined && (
          <div className="absolute top-[-2px] h-3 w-0.5 bg-ink" style={{ left: `calc(${Math.max(0, Math.min(100, expected))}% - 1px)` }} title={`Expected by today: ${expected}%`} />
        )}
      </div>
    </div>
  );
}

export function Sparkline({ values, expected, width = 96, height = 28, tone = 'info' }: { values: number[]; expected?: number[]; width?: number; height?: number; tone?: Tone }) {
  if (!values.length) return null;
  const max = Math.max(...values, ...(expected ?? []), 1);
  const pts = (arr: number[]) => arr.map((v, i) => `${(i / Math.max(1, arr.length - 1)) * (width - 4) + 2},${height - 2 - (v / max) * (height - 4)}`).join(' ');
  const color = { ok: '#15803d', info: '#0369a1', warn: '#b45309', bad: '#b91c1c', critical: '#7f1d1d', muted: '#475569' }[tone];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      {expected && <polyline points={pts(expected)} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 3" />}
      <polyline points={pts(values)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function OfficerChip({ name, designation, phone, compact }: { name: string | null | undefined; designation?: string | null; phone?: string | null; compact?: boolean }) {
  if (!name) return <span className="text-ink-3">Not assigned</span>;
  const initials = name.replace(/^(Dr\.|Md\.)\s*/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-[11px] font-bold text-ink-2" aria-hidden>
        {initials}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
        {!compact && designation && <span className="block truncate text-xs text-ink-3">{designation}</span>}
        {!compact && phone && (
          <a href={`tel:${phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <Phone className="size-3" aria-hidden /> {phone}
          </a>
        )}
      </span>
    </span>
  );
}

// ---------------- forms ----------------
export function Field({ label, help, error, children, className, required }: { label: string; help?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string; required?: boolean }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
        {required && <span className="text-bad"> *</span>}
      </label>
      {children(id)}
      {help && !error && <p className="text-xs text-ink-3">{help}</p>}
      {error && (
        <p className="text-xs font-semibold text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls = 'h-10 w-full rounded-md border border-line-2 bg-white px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(inputCls, 'h-auto min-h-20 py-2', className)} {...p} />;
});

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'pr-8', className)} {...p}>
      {children}
    </select>
  );
}

/** Compact select used in filter bars. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All' }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-36 flex-col gap-0.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink-3">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, 'h-9 text-[13px]')}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-subtle p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors',
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cx('tabular rounded-full px-1.5 text-[11px]', value === o.value ? 'bg-ink text-white' : 'bg-line text-ink-2')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------- tables ----------------
export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cx('relative w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <th scope="col" className={cx('sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-subtle px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-3', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, align = 'left', colSpan }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center'; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('border-b border-line px-3 py-2.5 align-top', align === 'right' && 'tabular text-right', align === 'center' && 'text-center', className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <div className="px-4 py-3 text-xs text-ink-3">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-[13px] text-ink-3">
      <span>
        Page {page} of {pages} · {total} records
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="size-4" />} />
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="size-4" />} />
      </div>
    </div>
  );
}

// ---------------- states ----------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-line/70', className)} aria-hidden />;
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-6 h-8 w-80" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-ink-3">{icon ?? <Inbox className="size-8" aria-hidden />}</div>
      <p className="font-semibold text-ink-2">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string } | null | undefined; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-bad/30 bg-bad-soft px-6 py-8 text-center" role="alert">
      <AlertTriangle className="size-7 text-bad" aria-hidden />
      <p className="font-semibold text-bad">{error?.message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ---------------- overlays ----------------
/** Accessible dialog. Renders as a right-side drawer on wide screens when `side` is set. */
export function Modal({ open, onClose, title, children, footer, wide, side }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'flex max-h-[92vh] w-full flex-col bg-white shadow-xl',
          side ? 'sm:ml-auto sm:h-full sm:max-h-none sm:max-w-xl sm:rounded-none' : 'rounded-t-xl sm:rounded-xl',
          !side && (wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'),
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button data-close onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Small key/value list for detail panels. */
export function DL({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">{k}</dt>
          <dd className="mt-0.5 text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Next required action" call-out used across modules. */
export function NextAction({ text, due, owner }: { text: string; due?: string | null; owner?: ReactNode }) {
  return (
    <div className="rounded-md bg-accent-soft/70 px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-accent">Next required action</div>
      <p className="mt-1 text-sm font-semibold text-ink">{text}</p>
      {(due || owner) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {owner}
          {due && <span>Due {due}</span>}
        </div>
      )}
    </div>
  );
}
