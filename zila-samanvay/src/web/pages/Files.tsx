import { FilePlus2, FileStack, Search, UserRoundCheck, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../../core/types';
import { NewFileModal } from '../components/files/NewFileModal';
import { AgingBadge, FileStatusBadge, idParam, PriorityBadge, ToneChip, useUrlFilters, useUrlSearch } from '../components/files/shared';
import {
  Button, Card, CardHeader, EmptyState, ErrorState, FilterSelect, Input, PageHeader, Pagination, Segmented, SkeletonRows, Table, Td, Th, cx,
} from '../components/ui';
import { fmtDate } from '../lib/format';
import { useLookups, useQ } from '../lib/hooks';

type StatusTab = 'pending' | 'query' | 'approved' | 'closed' | 'all';
type AgingKey = 'all' | 'within' | 'near' | 'beyond' | 'critical' | 'overdue';

const STATUS_TABS: StatusTab[] = ['pending', 'query', 'approved', 'closed', 'all'];
const AGING: { key: AgingKey; label: string; tone?: Tone }[] = [
  { key: 'all', label: 'All ages' },
  { key: 'within', label: 'Within SLA', tone: 'ok' },
  { key: 'near', label: 'Near SLA', tone: 'warn' },
  { key: 'beyond', label: 'Beyond SLA', tone: 'bad' },
  { key: 'critical', label: 'Critical (over 2× SLA)', tone: 'critical' },
  // Reached from dashboard links (beyond + critical); shown only while it is the active filter.
  { key: 'overdue', label: 'All overdue', tone: 'bad' },
];

export default function Files() {
  const { get, set, page } = useUrlFilters();
  const lk = useLookups();
  const [newOpen, setNewOpen] = useState(false);
  const closeNew = useCallback(() => setNewOpen(false), []);
  const [showAllDesks, setShowAllDesks] = useState(false);

  const statusParam = get('status') as StatusTab;
  const status: StatusTab = STATUS_TABS.includes(statusParam) ? statusParam : 'pending';
  const agingParam = get('aging') as AgingKey;
  const aging: AgingKey = AGING.some((a) => a.key === agingParam) ? agingParam : 'all';
  const officeId = idParam(get('office'));
  const departmentId = idParam(get('dept'));
  const blockId = idParam(get('block'));
  const mine = get('mine') === '1';
  const urlQ = get('q');
  const [q, setQ] = useUrlSearch('q', urlQ, set);

  const list = useQ('files.list', {
    status,
    aging,
    officeId,
    departmentId,
    blockId,
    mine: mine || undefined,
    q: urlQ || undefined,
    page,
    pageSize: 25,
  });
  const d = list.data;
  const c = d?.counts;

  const officeName = useMemo(() => new Map((lk.data?.offices ?? []).map((o) => [o.id, o.name])), [lk.data]);
  const anyFilter = !!(officeId || departmentId || blockId || mine || urlQ || aging !== 'all');
  const clearAll = () => {
    setQ('');
    set({ office: null, dept: null, block: null, mine: null, q: null, aging: null });
  };

  const desks = d?.desks ?? [];
  const visibleDesks = showAllDesks ? desks : desks.slice(0, 10);

  return (
    <div>
      <PageHeader
        title="File tracker"
        hindi="संचिका ट्रैकर"
        subtitle="Where every administrative file is pending, with whom, and for how long against its SLA. Oldest overdue files are listed first."
        actions={
          <Button variant="primary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => setNewOpen(true)}>
            Open new file
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<StatusTab>
              label="File status"
              value={status}
              onChange={(v) => set({ status: v === 'pending' ? null : v })}
              options={[
                { value: 'pending', label: 'Pending', count: c?.pending },
                { value: 'query', label: 'Query raised', count: c?.query },
                { value: 'approved', label: 'Approved', count: c?.approved },
                { value: 'closed', label: 'Closed', count: c?.closed },
                { value: 'all', label: 'All', count: c ? c.pending + c.approved + c.closed : undefined },
              ]}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink-3">Days at current desk (counts are for pending files)</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Ageing at current desk">
              {AGING.filter((a) => a.key !== 'overdue' || aging === 'overdue').map((a) => (
                <ToneChip
                  key={a.key}
                  tone={a.tone}
                  label={a.label}
                  count={c ? (a.key === 'all' ? c.pending : a.key === 'overdue' ? c.beyond + c.critical : c[a.key]) : undefined}
                  active={aging === a.key}
                  onClick={() => set({ aging: a.key === 'all' ? null : a.key })}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-full min-w-48 flex-col gap-0.5 sm:w-64">
              <label htmlFor="files-search" className="text-xs font-semibold text-ink-3">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input id="files-search" type="search" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} placeholder="File no, subject, office, officer" className="h-9 pl-8 text-[13px]" />
              </div>
            </div>
            <FilterSelect
              label="Current desk (office)"
              value={officeId ? String(officeId) : ''}
              onChange={(v) => set({ office: v || null })}
              allLabel="All offices"
              options={(lk.data?.offices ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
            />
            <FilterSelect
              label="Department"
              value={departmentId ? String(departmentId) : ''}
              onChange={(v) => set({ dept: v || null })}
              allLabel="All departments"
              options={(lk.data?.departments ?? []).map((x) => ({ value: String(x.id), label: x.name }))}
            />
            <FilterSelect
              label="Block"
              value={blockId ? String(blockId) : ''}
              onChange={(v) => set({ block: v || null })}
              allLabel="All blocks"
              options={(lk.data?.blocks ?? []).map((x) => ({ value: String(x.id), label: x.name }))}
            />
            <Button
              size="md"
              variant={mine ? 'primary' : 'secondary'}
              aria-pressed={mine}
              className="h-9"
              icon={<UserRoundCheck className="size-4" aria-hidden />}
              onClick={() => set({ mine: mine ? null : '1' })}
            >
              At my desk
              {c && <span className={cx('tabular rounded-full px-1.5 text-[11px]', mine ? 'bg-white/20' : 'bg-line text-ink-2')}>{c.mine}</span>}
            </Button>
            {anyFilter && (
              <Button variant="ghost" className="h-9" icon={<X className="size-4" aria-hidden />} onClick={clearAll}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardHeader
            title={officeId ? `Files at ${officeName.get(officeId) ?? 'selected office'}` : 'Files'}
            subtitle={d ? `${d.total} file${d.total === 1 ? '' : 's'} match` : 'Loading…'}
          />
          {list.isLoading ? (
            <SkeletonRows rows={8} />
          ) : list.error ? (
            <div className="p-4">
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            </div>
          ) : !d || d.rows.length === 0 ? (
            <EmptyState title="No files match these filters" icon={<FileStack className="size-8" aria-hidden />}>
              {anyFilter || status !== 'pending' ? (
                <span>
                  Try another status or{' '}
                  <button type="button" className="font-semibold text-accent hover:underline" onClick={clearAll}>
                    clear the filters
                  </button>
                  .
                </span>
              ) : (
                'No file is pending in your jurisdiction. New files appear here as soon as they are opened.'
              )}
            </EmptyState>
          ) : (
            <div className={cx('transition-opacity', list.isPlaceholderData && 'opacity-60')} aria-busy={list.isFetching}>
              <Table caption="Administrative files with current desk and ageing">
                <thead>
                  <tr>
                    <Th>File</Th>
                    <Th>Current desk</Th>
                    <Th>At desk vs SLA</Th>
                    <Th align="right">Total age</Th>
                    <Th>Priority</Th>
                    <Th>Decision required</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id} className={cx('hover:bg-subtle/60', r.atMyDesk && 'bg-accent-soft/30')}>
                      <Td className="min-w-64">
                        <div className="font-mono text-xs text-ink-3">{r.file_no}</div>
                        <Link to={`/files/${r.id}`} className="font-semibold leading-snug text-ink hover:text-accent hover:underline">
                          {r.subject}
                        </Link>
                        <div className="mt-0.5 text-xs text-ink-3">
                          {r.category}
                          {r.blockName ? ` · ${r.blockName}` : ' · District level'}
                        </div>
                      </Td>
                      <Td className="min-w-44">
                        <div className="font-semibold text-ink">{r.officeName}</div>
                        <div className="text-xs text-ink-3">
                          {r.holderName ? (
                            <>
                              {r.holderName}
                              {r.holderDesignation ? `, ${r.holderDesignation}` : ''}
                            </>
                          ) : (
                            'No officer assigned'
                          )}
                        </div>
                        {r.atMyDesk && <div className="mt-0.5 text-xs font-semibold text-accent">At your desk</div>}
                      </Td>
                      <Td className="min-w-36">
                        <AgingBadge aging={r.aging} />
                        <div className="tabular mt-1 text-xs text-ink-2">
                          {r.aging.daysAtDesk} d / SLA {r.sla_days}
                        </div>
                      </Td>
                      <Td align="right" className="min-w-24">
                        <div className="font-semibold">{r.aging.totalDays} d</div>
                        <div className="text-xs text-ink-3">since {fmtDate(r.opened_at)}</div>
                      </Td>
                      <Td>
                        <PriorityBadge priority={r.priority} showNormal />
                      </Td>
                      <Td className="min-w-56 max-w-xs">
                        <p className="line-clamp-2 text-ink-2" title={r.decision_required}>
                          {r.decision_required}
                        </p>
                      </Td>
                      <Td>
                        <FileStatusBadge status={r.status} label={r.statusLabel} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={d.page} pages={d.pages} total={d.total} onPage={(p) => set({ page: p })} />
            </div>
          )}
        </Card>

        <Card className="min-w-0 self-start xl:sticky xl:top-6">
          <CardHeader title="Desk-wise pendency" subtitle="Pending files by current office. Select a desk to filter." />
          {list.isLoading ? (
            <SkeletonRows rows={5} />
          ) : list.error ? (
            <p className="px-4 py-6 text-sm text-ink-3">Desk summary unavailable.</p>
          ) : desks.length === 0 ? (
            <EmptyState title="No pending files at any desk" />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {visibleDesks.map((k) => {
                  const active = officeId === k.officeId;
                  return (
                    <li key={k.officeId}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => set({ office: active ? null : k.officeId })}
                        className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle', active && 'bg-accent-soft/60')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={cx('block truncate text-[13px] font-semibold', active ? 'text-accent' : 'text-ink')}>{k.officeName}</span>
                          <span className="block text-xs text-ink-3">Oldest {k.maxDays} d at desk</span>
                        </span>
                        <span className="tabular shrink-0 text-right text-xs">
                          <span className="block font-bold text-ink">{k.pending} pending</span>
                          <span className={cx('block font-semibold', k.beyond > 0 ? 'text-bad' : 'text-ok')}>{k.beyond > 0 ? `${k.beyond} beyond SLA` : 'All within SLA'}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {desks.length > 10 && (
                <div className="border-t border-line px-4 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowAllDesks((s) => !s)}>
                    {showAllDesks ? 'Show top 10 desks' : `Show all ${desks.length} desks`}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <NewFileModal open={newOpen} onClose={closeNew} />
    </div>
  );
}
