import { Download, FileClock, FileUp, Search, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProcInput, ProcOutput } from '../../core/rpc';
import { RULES } from '../../core/rules';
import { PlainSelect, toId, useUrlParams } from '../components/works/shared';
import { useToast } from '../components/toast';
import {
  Badge, Button, Card, EmptyState, ErrorState, FilterSelect, Input, Kpi, LinkButton, PageHeader, Pagination, Progress, Segmented, Skeleton,
  SkeletonRows, Table, Td, Th, cx,
} from '../components/ui';
import { downloadText } from '../lib/files';
import { fmtDate, lakh, pct, today } from '../lib/format';
import { useDebounced, useLookups, useQ } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { toCsv } from '../lib/sheets';

type StatusKey = 'all' | 'delayed' | 'in_progress' | 'stalled' | 'not_started' | 'completed';
type SortKey = 'risk' | 'target' | 'progress' | 'value' | 'updated' | 'name';
type WorkListRow = ProcOutput<'works.list'>['rows'][number];

const STATUS_TABS: { value: StatusKey; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'not_started', label: 'Not started' },
  { value: 'completed', label: 'Completed' },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'risk', label: 'Risk (highest first)' },
  { value: 'target', label: 'Target date (earliest)' },
  { value: 'progress', label: 'Physical progress (lowest)' },
  { value: 'value', label: 'Sanctioned value (highest)' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
];

const isStatus = (v: string): v is StatusKey => STATUS_TABS.some((s) => s.value === v);
const isSort = (v: string): v is SortKey => SORTS.some((s) => s.value === v);

/** Column headers chosen so an exported sheet can be re-imported through the import screen. */
function exportCsv(rows: WorkListRow[]): string {
  const header = [
    'Work Code', 'Name of Work', 'Block', 'Department', 'Panchayat', 'Scheme', 'Category', 'Sanctioned (Lakh)', 'Expenditure (Lakh)', 'Financial %',
    'Physical %', 'Expected % by today', 'Status', 'Health', 'Start Date', 'Target Date', 'Overdue days', 'Agency', 'Officer', 'Officer designation',
    'Next Action', 'Next action due', 'Pending file', 'Public portal', 'Last updated',
  ];
  return toCsv([
    header,
    ...rows.map((r) => [
      r.code, r.name, r.blockName, r.departmentName, r.panchayat, r.scheme, r.category, r.sanctioned_lakh, r.expenditure_lakh, r.financialPct,
      r.physical_pct, r.health.expected, r.statusLabel, r.health.label, r.start_date, r.target_date, r.health.overdueDays || '', r.agency, r.officerName,
      r.officerDesignation, r.next_action, r.next_action_due, r.pendingFile ? `${r.pendingFile.file_no} at ${r.pendingFile.office} (${r.pendingFile.days} d)` : '',
      r.public_approved ? 'Approved' : 'Not published', r.updated_at.slice(0, 10),
    ]),
  ]);
}

export default function Works() {
  const { get, set } = useUrlParams();
  const lookups = useLookups();
  const toast = useToast();

  const blockId = toId(get('block'));
  const deptId = toId(get('dept'));
  const status: StatusKey = isStatus(get('status')) ? (get('status') as StatusKey) : 'all';
  const sort: SortKey = isSort(get('sort')) ? (get('sort') as SortKey) : 'risk';
  const publicOnly = get('public') === '1';
  const page = toId(get('page')) ?? 1;

  // Search box: local state for instant typing, debounced into the URL.
  const urlQ = get('q');
  const [q, setQ] = useState(urlQ);
  const dq = useDebounced(q.trim(), 300);
  useEffect(() => {
    if (dq !== urlQ) set({ q: dq || null }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  useEffect(() => {
    // URL changed from outside (Back button, shared link): reflect it in the box.
    if (urlQ !== dq) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const filters: ProcInput<'works.list'> = {
    q: urlQ || undefined,
    blockId: blockId ?? undefined,
    departmentId: deptId ?? undefined,
    status,
    sort,
    publicOnly: publicOnly || undefined,
  };
  const list = useQ('works.list', { ...filters, page, pageSize: 25 });
  const data = list.data;
  const filtered = !!(urlQ || blockId || deptId || publicOnly || status !== 'all');

  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const all: WorkListRow[] = [];
      let p = 1;
      let pages = 1;
      do {
        const res = await rpc('works.list', { ...filters, page: p, pageSize: 200 });
        all.push(...res.rows);
        pages = res.pages;
        p++;
      } while (p <= pages);
      if (!all.length) {
        toast.show('No works match these filters — nothing to export.', 'bad');
        return;
      }
      downloadText(`works-register-${today()}.csv`, exportCsv(all));
      toast.show(`Exported ${all.length} works to CSV.`, 'ok');
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setExporting(false);
    }
  };

  const blockOptions = (lookups.data?.blocks ?? []).map((b) => ({ value: String(b.id), label: b.name }));
  const deptOptions = (lookups.data?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name }));

  return (
    <>
      <PageHeader
        title="Public works monitoring"
        hindi="निर्माण कार्य"
        subtitle="Every sanctioned work with physical and financial progress against the time-based expectation, the responsible officer and any file holding it up."
        actions={
          <>
            <LinkButton to="/works/import" icon={<FileUp className="size-4" aria-hidden />}>
              Import CSV / Excel
            </LinkButton>
            <Button onClick={doExport} loading={exporting} disabled={!data || data.total === 0} icon={<Download className="size-4" aria-hidden />}>
              Export CSV
            </Button>
          </>
        }
      />

      {/* Totals for the current filter */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[98px]" />)
        ) : (
          <>
            <Kpi label="Sanctioned value" value={lakh(data.totals.sanctionedLakh, { crore: true })} sub={`${data.total} work${data.total === 1 ? '' : 's'} in view`} />
            <Kpi label="Expenditure" value={lakh(data.totals.expenditureLakh, { crore: true })} sub="Booked against sanction" />
            <Kpi
              label="Financial progress"
              value={pct(data.totals.financialPct, 1)}
              sub="Expenditure ÷ sanctioned"
              tone={data.total ? (data.totals.financialPct < 40 ? 'warn' : undefined) : undefined}
            />
            <Kpi label="Average physical progress" value={pct(data.totals.avgPhysical)} sub="Simple average across works" />
          </>
        )}
      </div>

      <Card>
        {/* Filter bar */}
        <div className="flex flex-col gap-3 border-b border-line p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-full flex-col gap-0.5 sm:w-72">
              <label htmlFor="works-search" className="text-xs font-semibold text-ink-3">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input
                  id="works-search"
                  type="search"
                  maxLength={100}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Code, name, panchayat, agency, scheme"
                  className="h-9 pl-8 text-[13px]"
                />
              </div>
            </div>
            <FilterSelect label="Block" value={blockId ? String(blockId) : ''} onChange={(v) => set({ block: v })} options={blockOptions} allLabel="All blocks" />
            <FilterSelect label="Department" value={deptId ? String(deptId) : ''} onChange={(v) => set({ dept: v })} options={deptOptions} allLabel="All departments" />
            <PlainSelect label="Sort by" value={sort} onChange={(v) => set({ sort: v === 'risk' ? null : v })} options={SORTS} />
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-2">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={publicOnly} onChange={(e) => set({ public: e.target.checked ? '1' : null })} />
              Public portal approved only
            </label>
            {filtered && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQ('');
                  set({ q: null, block: null, dept: null, status: null, public: null });
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
          <div className="relative -mx-1 overflow-x-auto px-1">
            <Segmented
              label="Work status"
              value={status}
              onChange={(v) => set({ status: v === 'all' ? null : v })}
              options={STATUS_TABS.map((s) => ({ ...s, count: data?.statusCounts[s.value] }))}
            />
          </div>
        </div>

        {list.isLoading ? (
          <SkeletonRows rows={8} />
        ) : list.error && !data ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title={filtered ? 'No works match these filters' : 'No works in your jurisdiction yet'} icon={<SearchX className="size-8" aria-hidden />}>
            {filtered ? 'Change the status tab, block or department, or clear the search.' : 'Import a departmental progress sheet to load works without re-typing them.'}
          </EmptyState>
        ) : (
          <div className={cx('transition-opacity', list.isFetching && list.isPlaceholderData && 'opacity-60')}>
            <Table caption="Public works register">
              <thead>
                <tr>
                  <Th>Work</Th>
                  <Th>Block</Th>
                  <Th>Department</Th>
                  <Th align="right">Sanctioned</Th>
                  <Th>Physical</Th>
                  <Th align="right">Financial</Th>
                  <Th>Target date</Th>
                  <Th>Status</Th>
                  <Th>Officer</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((w) => (
                  <tr key={w.id} className="hover:bg-subtle/60">
                    <Td className="min-w-64 max-w-sm">
                      <div className="text-xs font-semibold text-ink-3 tabular">{w.code}</div>
                      <Link to={`/works/${w.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                        {w.name}
                      </Link>
                      <div className="text-xs text-ink-3">
                        {w.panchayat ? `${w.panchayat} panchayat` : 'Panchayat not recorded'} · {w.scheme}
                      </div>
                      {w.pendingFile && (
                        <span
                          className="mt-1 inline-flex items-center gap-1 rounded border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn"
                          title={`File ${w.pendingFile.file_no} pending at ${w.pendingFile.office}`}
                        >
                          <FileClock className="size-3" aria-hidden />
                          File {w.pendingFile.file_no} · {w.pendingFile.days} d at {w.pendingFile.office}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{w.blockName}</Td>
                    <Td className="min-w-32">{w.departmentName}</Td>
                    <Td align="right" className="whitespace-nowrap">
                      {lakh(w.sanctioned_lakh)}
                    </Td>
                    <Td className="min-w-36">
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                        <span className="tabular font-bold text-ink">{pct(w.physical_pct)}</span>
                        {w.status !== 'completed' && <span className="tabular text-ink-3">exp. {pct(w.health.expected)}</span>}
                      </div>
                      <Progress value={w.physical_pct} expected={w.status === 'completed' ? undefined : w.health.expected} tone={w.health.tone} label={`Physical progress of ${w.code}`} />
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      {pct(w.financialPct, 1)}
                      <div className="text-xs text-ink-3">{lakh(w.expenditure_lakh)}</div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {fmtDate(w.target_date)}
                      {w.health.overdueDays > 0 && <div className="text-xs font-semibold text-bad">{w.health.overdueDays} d overdue</div>}
                    </Td>
                    <Td>
                      <Badge tone={w.health.tone}>{w.health.label}</Badge>
                      {w.health.label !== w.statusLabel && <div className="mt-1 text-xs text-ink-3">{w.statusLabel}</div>}
                    </Td>
                    <Td className="min-w-36">
                      {w.officerName ? (
                        <>
                          <div className="font-semibold text-ink">{w.officerName}</div>
                          {w.officerDesignation && <div className="text-xs text-ink-3">{w.officerDesignation}</div>}
                        </>
                      ) : (
                        <span className="text-ink-3">Not assigned</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pages={data.pages} total={data.total} onPage={(p) => set({ page: p > 1 ? p : null })} />
          </div>
        )}
      </Card>
      <p className="mt-3 max-w-[52ch] text-xs text-ink-3">
        The black tick on each progress bar marks the progress expected by today on a straight line from start date to target date. A work is
        flagged when it trails that mark by {RULES.workSlipPoints} points or more, crosses its target date, is stalled, has not started{' '}
        {RULES.notStartedGraceDays} days after its planned start, or has had no progress update for {RULES.workStaleDays} days.
      </p>
    </>
  );
}
