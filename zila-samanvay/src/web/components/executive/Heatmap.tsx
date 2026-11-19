// Block x Department heatmap for the district dashboard. Each cell counts open issues
// (delayed works, files beyond SLA, high/critical findings, service gaps) for one block and
// one department; clicking a cell lists the underlying items with the responsible officer.

import { ArrowRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProcOutput } from '../../../core/rpc';
import { useQ } from '../../lib/hooks';
import { IssueList } from '../issues';
import { Badge, Button, EmptyState, ErrorState, LinkButton, Modal, SkeletonRows, cx } from '../ui';
import { drillHref } from './shared';

type Heat = ProcOutput<'dashboard.summary'>['heatmap'];
type HeatMetric = Heat['metrics'][number];

// Sequential single-hue scale (light -> dark). Text colour switches for contrast.
const LEVEL_CLASS = ['', 'bg-bad/10 text-ink', 'bg-bad/20 text-ink', 'bg-bad/40 text-ink', 'bg-bad text-white', 'bg-critical text-white'];

function level(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5)));
}

interface Selection {
  blockId: number;
  blockName: string;
  departmentId: number;
  departmentName: string;
  count: number;
  severe: number;
}

export function BlockDeptHeatmap({ heat }: { heat: Heat }) {
  const [sel, setSel] = useState<Selection | null>(null);
  const close = useCallback(() => setSel(null), []);

  const cellMap = useMemo(() => new Map(heat.cells.map((c) => [`${c.blockId}:${c.departmentId}`, c])), [heat.cells]);
  const max = useMemo(() => Math.max(1, ...heat.cells.map((c) => c.count)), [heat.cells]);

  const columns = useMemo(() => {
    const cols = heat.departments.map((d) => ({ id: d.id, code: d.code, name: d.name }));
    const known = new Set(cols.map((c) => c.id));
    if (heat.cells.some((c) => !known.has(c.departmentId))) cols.push({ id: 0, code: 'N/A', name: 'Department not recorded' });
    return cols;
  }, [heat.departments, heat.cells]);

  const rowTotals = useMemo(() => {
    const m = new Map<number, { count: number; severe: number }>();
    for (const c of heat.cells) {
      const r = m.get(c.blockId) ?? { count: 0, severe: 0 };
      r.count += c.count;
      r.severe += c.severe;
      m.set(c.blockId, r);
    }
    return m;
  }, [heat.cells]);

  const colTotals = useMemo(() => {
    const known = new Set(heat.departments.map((d) => d.id));
    const m = new Map<number, number>();
    for (const c of heat.cells) {
      const id = known.has(c.departmentId) ? c.departmentId : 0;
      m.set(id, (m.get(id) ?? 0) + c.count);
    }
    return m;
  }, [heat.cells, heat.departments]);

  const grand = heat.cells.reduce((s, c) => s + c.count, 0);

  // legend: integer ranges covered by each level
  const legend = useMemo(() => {
    const out: { level: number; from: number; to: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const from = Math.floor(((i - 1) * max) / 5) + 1;
      const to = Math.floor((i * max) / 5);
      if (from <= to) out.push({ level: i, from, to });
    }
    return out;
  }, [max]);

  if (!heat.cells.length) {
    return <EmptyState title="No open issues in your jurisdiction">Delayed works, files beyond SLA, high / critical findings and service gaps will appear here by block and department.</EmptyState>;
  }

  const cellFor = (blockId: number, deptId: number) => {
    if (deptId !== 0) return cellMap.get(`${blockId}:${deptId}`);
    // 'not recorded' column collects every department id the lookup list does not know
    const known = new Set(heat.departments.map((d) => d.id));
    let count = 0;
    let severe = 0;
    for (const c of heat.cells) {
      if (c.blockId === blockId && !known.has(c.departmentId)) {
        count += c.count;
        severe += c.severe;
      }
    }
    return count ? { blockId, departmentId: 0, count, severe } : undefined;
  };

  return (
    <div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-[13px]">
          <caption className="sr-only">Open issues by block and department. Select a cell to list the items.</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] bg-panel px-2 py-1 text-left text-xs font-bold uppercase tracking-wide text-ink-3">
                Block
              </th>
              {columns.map((d) => (
                <th key={d.id} scope="col" title={d.name} className="px-1 py-1 text-center text-xs font-bold text-ink-2">
                  <abbr title={d.name} className="no-underline" aria-hidden>
                    {d.code}
                  </abbr>
                  <span className="sr-only">{d.name}</span>
                </th>
              ))}
              <th scope="col" className="px-1 py-1 text-center text-xs font-bold uppercase tracking-wide text-ink-3">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {heat.blocks.map((b) => {
              const rt = rowTotals.get(b.id);
              return (
                <tr key={b.id}>
                  <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-panel px-2 py-1 text-left font-semibold text-ink">
                    {b.name}
                    <span lang="hi" className="hi ml-1.5 text-xs font-normal text-ink-3">
                      {b.name_hi}
                    </span>
                  </th>
                  {columns.map((d) => {
                    const c = cellFor(b.id, d.id);
                    if (!c) {
                      return (
                        <td key={d.id} className="h-11 min-w-12 rounded-md bg-subtle/60 text-center text-ink-3">
                          <span aria-hidden>–</span>
                          <span className="sr-only">
                            {b.name}, {d.name}: no open issues
                          </span>
                        </td>
                      );
                    }
                    const label = `${b.name}, ${d.name}: ${c.count} open issue${c.count === 1 ? '' : 's'}${c.severe ? `, ${c.severe} high or critical` : ''}. Show the list.`;
                    return (
                      <td key={d.id} className="h-11 min-w-12 p-0">
                        <button
                          type="button"
                          title={label}
                          aria-label={label}
                          onClick={() => setSel({ blockId: b.id, blockName: b.name, departmentId: d.id, departmentName: d.name, count: c.count, severe: c.severe })}
                          className={cx(
                            'flex h-11 w-full flex-col items-center justify-center rounded-md leading-none transition-[box-shadow] hover:ring-2 hover:ring-accent focus-visible:ring-2 focus-visible:ring-accent',
                            LEVEL_CLASS[level(c.count, max)],
                          )}
                        >
                          <span className="tabular text-sm font-bold">{c.count}</span>
                          {c.severe > 0 && <span className="tabular mt-0.5 text-[11px] font-semibold opacity-90">{c.severe} sev</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="h-11 min-w-12 text-center">
                    {rt ? (
                      <span className="tabular inline-flex flex-col items-center font-bold text-ink">
                        {rt.count}
                        {rt.severe > 0 && <span className="text-[11px] font-semibold text-bad">{rt.severe} sev</span>}
                      </span>
                    ) : (
                      <span className="text-ink-3">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="sticky left-0 z-[1] bg-panel px-2 py-1 text-left text-xs font-bold uppercase tracking-wide text-ink-3">
                Total
              </th>
              {columns.map((d) => (
                <td key={d.id} className="tabular py-1 text-center font-bold text-ink-2">
                  {colTotals.get(d.id) ?? 0}
                </td>
              ))}
              <td className="tabular py-1 text-center font-bold text-ink">{grand}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-xs text-ink-3 [&>p]:max-w-[52ch]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-semibold text-ink-2">Open issues per cell</span>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {legend.map((l) => (
              <span key={l.level} className="inline-flex items-center gap-1">
                <span className={cx('inline-block size-4 rounded', LEVEL_CLASS[l.level])} aria-hidden />
                <span className="tabular">{l.from === l.to ? l.from : `${l.from}–${l.to}`}</span>
              </span>
            ))}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-grid size-4 place-items-center rounded bg-subtle text-ink-3" aria-hidden>
              –
            </span>
            none
          </span>
          <span>
            <b className="text-ink-2">“n sev”</b> = high / critical items in the cell
          </span>
        </div>
        <p>
          Counts combine: {heat.metrics.map((m) => m.label.toLowerCase()).join('; ')}. Department codes:{' '}
          {columns.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ' · '}
              <b className="text-ink-2">{d.code}</b> {d.name}
            </span>
          ))}
          .
        </p>
      </div>

      <Modal
        open={!!sel}
        onClose={close}
        wide
        title={sel ? `${sel.blockName} · ${sel.departmentName}` : ''}
        footer={
          sel && (
            <>
              <Button variant="ghost" onClick={close}>
                Close
              </Button>
              <LinkButton variant="primary" to={drillHref(heat.metrics[0]?.key ?? 'works_delayed', { block: sel.blockId, dept: sel.departmentId })} icon={<ArrowRight className="size-4" aria-hidden />}>
                Open full drill-down
              </LinkButton>
            </>
          )
        }
      >
        {sel && (
          <div className="-mx-5 -my-4">
            <p className="border-b border-line px-5 py-3 text-[13px] text-ink-3">
              <span className="tabular font-semibold text-ink">{sel.count}</span> open issue{sel.count === 1 ? '' : 's'}
              {sel.severe > 0 && (
                <>
                  , <span className="tabular font-semibold text-bad">{sel.severe}</span> high or critical
                </>
              )}
              . Each item shows the responsible officer and the next required action.
            </p>
            {heat.metrics.map((m) => (
              <CellMetric key={m.key} metric={m} blockId={sel.blockId} departmentId={sel.departmentId} />
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function CellMetric({ metric, blockId, departmentId }: { metric: HeatMetric; blockId: number; departmentId: number }) {
  const q = useQ('dashboard.drill', { metric: metric.key, blockId, departmentId });
  const items = q.data?.items ?? [];
  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-subtle px-5 py-2">
      <h3 className="text-[13px] font-bold text-ink-2">
        {metric.label}
        {q.data && (
          <Badge tone={items.length ? 'bad' : 'muted'} className="ml-2 align-middle">
            {items.length}
          </Badge>
        )}
      </h3>
      {items.length > 0 && (
        <Link to={drillHref(metric.key, { block: blockId, dept: departmentId })} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
          Open in drill-down <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
  if (q.isLoading) {
    return (
      <section className="border-b border-line">
        {heading}
        <SkeletonRows rows={2} />
      </section>
    );
  }
  if (q.error) {
    return (
      <section className="border-b border-line">
        {heading}
        <div className="p-4">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      </section>
    );
  }
  if (!items.length) {
    return (
      <section className="border-b border-line">
        {heading}
        <p className="px-5 py-2 text-[13px] text-ink-3">None for this block and department.</p>
      </section>
    );
  }
  return (
    <section className="border-b border-line">
      {heading}
      <IssueList items={items} />
    </section>
  );
}
