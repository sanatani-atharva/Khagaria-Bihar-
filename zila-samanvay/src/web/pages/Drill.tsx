// Seamless drill-down: district -> block -> department -> item -> responsible officer -> next
// action. Metric, block, department, search and page all live in the URL, so every view is
// shareable and the browser Back button walks back up the trail.

import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ProcInput, ProcOutput } from '../../core/rpc';
import { IssueList } from '../components/issues';
import {
  Breadcrumbs, Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, Pagination, Skeleton, SkeletonRows, cx,
} from '../components/ui';
import { num } from '../lib/format';
import { useDebounced, useQ } from '../lib/hooks';

type Metric = ProcInput<'dashboard.drill'>['metric'];
type DrillOut = ProcOutput<'dashboard.drill'>;
type CountRow = DrillOut['byBlock'][number];

// Record<Metric, true> makes the compiler insist every metric is listed (and nothing else).
const METRIC_SET: Record<Metric, true> = {
  works_delayed: true,
  works_active: true,
  scheme_gaps: true,
  files_beyond_sla: true,
  files_pending: true,
  findings_open: true,
  assets_critical: true,
  inspections_overdue: true,
  actions_overdue: true,
};
const DEFAULT_METRIC: Metric = 'works_delayed';
const PAGE_SIZE = 20;

const isMetric = (s: string | null): s is Metric => !!s && Object.prototype.hasOwnProperty.call(METRIC_SET, s);
const parseId = (s: string | null): number | undefined => (s !== null && /^\d{1,9}$/.test(s) ? Number(s) : undefined);

export default function Drill() {
  const [sp, setSp] = useSearchParams();
  const metricParam = sp.get('metric');
  const metric: Metric = isMetric(metricParam) ? metricParam : DEFAULT_METRIC;
  const blockId = parseId(sp.get('block'));
  const departmentId = parseId(sp.get('dept'));
  const qParam = sp.get('q') ?? '';
  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1);

  /** Patch the URL. Navigation steps push history; typing in the search box replaces it. */
  const update = (patch: Record<string, string | number | null | undefined>, replace = false) => {
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined || v === '') n.delete(k);
          else n.set(k, String(v));
        }
        return n;
      },
      { replace },
    );
  };

  /** URL for a crumb: same metric, with the given filters. */
  const hrefFor = (patch: Record<string, string | number | null>) => {
    const n = new URLSearchParams(sp);
    n.set('metric', metric);
    n.delete('page');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') n.delete(k);
      else n.set(k, String(v));
    }
    return `/drill?${n.toString()}`;
  };

  // debounced search box mirrored into the URL
  const [search, setSearch] = useState(qParam);
  const dq = useDebounced(search.trim(), 300);
  useEffect(() => {
    if (dq !== qParam) update({ q: dq || null, page: null }, true);
  }, [dq]);
  useEffect(() => {
    // URL changed from outside the box (Back button, Clear): reflect it
    if (qParam !== dq) setSearch(qParam);
  }, [qParam]);

  const q = useQ('dashboard.drill', { metric, blockId, departmentId });
  const d = q.data;
  const updating = q.isFetching && q.isPlaceholderData;

  const groups = useMemo(() => {
    const out: { group: string; items: { key: string; label: string }[] }[] = [];
    for (const m of d?.metrics ?? []) {
      let g = out.find((x) => x.group === m.group);
      if (!g) {
        g = { group: m.group, items: [] };
        out.push(g);
      }
      g.items.push({ key: m.key, label: m.label });
    }
    return out;
  }, [d?.metrics]);

  const filtered = useMemo(() => {
    const items = d?.items ?? [];
    const s = qParam.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) =>
      [i.title, i.subtitle, i.officerName, i.officerDesignation, i.nextAction, i.status, i.blockName, i.departmentName, i.metric]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(s),
    );
  }, [d?.items, qParam]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  // number of items in the current block / department selection (before the 300-item cap)
  const selectionCount = useMemo(() => {
    if (!d) return 0;
    if (blockId !== undefined) return d.byBlock.find((b) => b.id === blockId)?.count ?? 0;
    return d.byBlock.reduce((s, b) => s + b.count, 0);
  }, [d, blockId]);

  const blockName = d?.blockName ?? (blockId === undefined ? null : blockId === 0 ? 'District offices' : `Block #${blockId}`);
  const deptName = d?.departmentName ?? (departmentId === undefined ? null : departmentId === 0 ? 'Unassigned' : `Department #${departmentId}`);

  const crumbs: { label: string; to?: string }[] = [{ label: 'District', to: hrefFor({ block: null, dept: null, q: null }) }];
  if (blockId !== undefined) crumbs.push({ label: blockName ?? '…', to: hrefFor({ dept: null, q: null }) });
  if (departmentId !== undefined) crumbs.push({ label: deptName ?? '…' });
  crumbs[crumbs.length - 1] = { label: crumbs[crumbs.length - 1].label }; // current step is not a link

  const hasFilter = blockId !== undefined || departmentId !== undefined || !!qParam;
  const clearAll = () => {
    setSearch('');
    update({ block: null, dept: null, q: null, page: null });
  };

  const place = [blockName ?? 'All blocks', deptName ?? 'all departments'].join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Drill-down"
        hindi="विस्तृत विवरण"
        crumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Drill-down' }]}
        subtitle="From the district figure to the block, the department, each item, the responsible officer and the next required action."
      />

      {/* metric picker */}
      <Card className="p-3 sm:p-4">
        <h2 className="sr-only">Choose a metric</h2>
        {!d && q.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-5">
            {groups.map((g) => (
              <div key={g.group} role="group" aria-label={g.group} className="min-w-0">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">{g.group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((m) => {
                    const active = m.key === metric;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update({ metric: m.key, page: null })}
                        className={cx(
                          'min-h-8 rounded-md border px-2.5 py-1 text-left text-[13px] font-semibold leading-snug transition-colors',
                          active ? 'border-ink bg-ink text-white' : 'border-line-2 bg-panel text-ink-2 hover:bg-subtle hover:text-ink',
                        )}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {q.error && !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {/* trail */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <Breadcrumbs items={crumbs} />
              {d ? (
                <h2 className="text-lg font-bold leading-tight text-ink">
                  {d.label}
                  <span className="ml-2 text-base font-normal text-ink-3">{place}</span>
                </h2>
              ) : (
                <Skeleton className="h-6 w-64 max-w-full" />
              )}
              {d && (
                <p className="mt-0.5 text-[13px] text-ink-3">
                  <span className="tabular font-semibold text-ink-2">{num(selectionCount)}</span> in this selection ·{' '}
                  <span className="tabular">{num(d.total)}</span> across your jurisdiction
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {updating && (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-3" role="status">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Updating…
                </span>
              )}
              {q.error && d && (
                <Button size="sm" onClick={() => q.refetch()}>
                  Retry
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={!hasFilter} onClick={clearAll} icon={<X className="size-4" aria-hidden />}>
                Clear selection
              </Button>
            </div>
          </div>

          {/* breakdown panels */}
          <div className="grid gap-4 md:grid-cols-2">
            <BarList
              title="By block"
              subtitle={departmentId !== undefined ? `Within ${deptName ?? 'the selected department'}` : 'All departments'}
              rows={d?.byBlock}
              loading={!d}
              selected={blockId}
              onSelect={(id) => update({ block: id ?? null, page: null })}
              noun="block"
            />
            <BarList
              title="By department"
              subtitle={blockId !== undefined ? `Within ${blockName ?? 'the selected block'}` : 'All blocks'}
              rows={d?.byDepartment}
              loading={!d}
              selected={departmentId}
              onSelect={(id) => update({ dept: id ?? null, page: null })}
              noun="department"
            />
          </div>

          {/* items */}
          <Card>
            <CardHeader
              title={`Items — ${place}`}
              subtitle={
                d
                  ? filtered.length
                    ? `Showing ${num((curPage - 1) * PAGE_SIZE + 1)}–${num((curPage - 1) * PAGE_SIZE + pageItems.length)} of ${num(filtered.length)}${qParam ? ' matching' : ''} · ${num(d.total)} in your jurisdiction${d.items.length < selectionCount ? ` · first ${num(d.items.length)} by severity loaded` : ''}`
                    : `Showing 0 of ${num(selectionCount)} · ${num(d.total)} in your jurisdiction`
                  : 'Loading…'
              }
            />
            <div className="border-b border-line px-4 py-2.5">
              <div className="relative sm:max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search item, officer or next action"
                  aria-label="Search the items in this selection"
                  className="h-9 pl-8 text-[13px]"
                />
              </div>
            </div>
            {!d ? (
              <SkeletonRows rows={6} />
            ) : (
              <>
                <IssueList
                  items={pageItems}
                  empty={qParam ? `No items match “${qParam}”.` : selectionCount === 0 && hasFilter ? 'Nothing pending for this selection.' : 'Nothing pending — no items for this metric.'}
                />
                {filtered.length > 0 && <Pagination page={curPage} pages={pages} total={filtered.length} onPage={(p) => update({ page: p > 1 ? p : null })} />}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function BarList({
  title, subtitle, rows, loading, selected, onSelect, noun,
}: {
  title: string;
  subtitle: string;
  rows: CountRow[] | undefined;
  loading: boolean;
  selected: number | undefined;
  onSelect: (id: number | undefined) => void;
  noun: string;
}) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.count));
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          selected !== undefined && (
            <Button size="sm" variant="ghost" onClick={() => onSelect(undefined)} icon={<X className="size-4" aria-hidden />}>
              All {noun}s
            </Button>
          )
        }
      />
      {loading ? (
        <SkeletonRows rows={5} />
      ) : !rows || rows.length === 0 ? (
        <EmptyState title={`No items in any ${noun}`} />
      ) : (
        <>
          <ul className="p-2">
            {rows.map((r) => {
              const active = r.id === selected;
              const label = `${r.name}: ${r.count} item${r.count === 1 ? '' : 's'}${r.severe ? `, ${r.severe} high or critical` : ''}`;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={active ? `${label}. Selected — select again to show all ${noun}s.` : `${label}. Filter to this ${noun}.`}
                    onClick={() => onSelect(active ? undefined : r.id)}
                    className={cx(
                      'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-subtle',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className={cx('min-w-0 truncate font-semibold', active ? 'text-accent' : 'text-ink')}>{r.name}</span>
                      <span className="tabular shrink-0 text-ink-2">
                        <b className="text-ink">{num(r.count)}</b>
                        {r.severe > 0 && <span className="text-bad"> · {num(r.severe)} severe</span>}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-subtle" aria-hidden>
                      <div className="flex h-full" style={{ width: `${(r.count / max) * 100}%` }}>
                        <div className="h-full bg-bad" style={{ width: `${(r.severe / Math.max(1, r.count)) * 100}%` }} />
                        <div className="h-full flex-1 bg-ink-3/40" />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="flex items-center gap-3 border-t border-line px-4 py-2 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-bad" aria-hidden /> High / critical
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-sm bg-ink-3/40" aria-hidden /> Other
            </span>
          </p>
        </>
      )}
    </Card>
  );
}
