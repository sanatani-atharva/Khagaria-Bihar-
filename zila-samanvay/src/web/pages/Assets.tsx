import { Building2, FilterX, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { conditionTone, fmtDate, num, relDays, severityTone } from '../lib/format';
import { useDebounced, useLookups, useMe, useQ } from '../lib/hooks';
import {
  Badge, Button, Card, EmptyState, ErrorState, FilterSelect, Input, Kpi, OfficerChip, PageHeader, Pagination, Segmented, Skeleton, SkeletonRows, Table, Td, Th, cx,
} from '../components/ui';

type ConditionFilter = '' | 'good' | 'needs_repair' | 'critical';
type InspectionFilter = 'all' | 'overdue' | 'due30';

const CONDITIONS = ['good', 'needs_repair', 'critical'] as const;
const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const PAGE_SIZE = 25;

export default function Assets() {
  const [sp, setSp] = useSearchParams();
  const me = useMe();
  const lk = useLookups();

  const block = sp.get('block') ?? '';
  const dept = sp.get('dept') ?? '';
  const type = sp.get('type') ?? '';
  const conditionRaw = sp.get('condition') ?? '';
  const condition: ConditionFilter = (CONDITIONS as readonly string[]).includes(conditionRaw) ? (conditionRaw as ConditionFilter) : '';
  const inspectionRaw = sp.get('inspection') ?? 'all';
  const inspection: InspectionFilter = inspectionRaw === 'overdue' || inspectionRaw === 'due30' ? inspectionRaw : 'all';
  const openOnly = sp.get('open') === '1';
  const urlQ = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);

  // Search box: typed locally, pushed to the URL after a 300 ms pause.
  const [qInput, setQInput] = useState(urlQ);
  const debouncedQ = useDebounced(qInput, 300);
  const spRef = useRef(sp);
  spRef.current = sp;
  useEffect(() => {
    const q = debouncedQ.trim();
    if ((spRef.current.get('q') ?? '') === q) return;
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q);
        else next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);
  // Keep the box in step when the URL changes from Back/Forward or "Clear filters".
  useEffect(() => {
    setQInput((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);

  const setParams = (patch: Record<string, string | null>) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    });
  };

  const list = useQ('assets.list', {
    q: urlQ || undefined,
    blockId: block ? Number(block) : undefined,
    departmentId: dept ? Number(dept) : undefined,
    type: type || undefined,
    condition: condition || undefined,
    inspection,
    openFindings: openOnly || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const role = me.data?.role;
  const blockOptions = useMemo(() => {
    const all = lk.data?.blocks ?? [];
    const own = role === 'block_officer' && me.data?.block_id ? all.filter((b) => b.id === me.data?.block_id) : all;
    return own.map((b) => ({ value: String(b.id), label: b.name }));
  }, [lk.data, role, me.data?.block_id]);
  const deptOptions = useMemo(() => {
    const all = lk.data?.departments ?? [];
    const own = me.data?.department_id && role !== 'dm' && role !== 'ddc' ? all.filter((d) => d.id === me.data?.department_id) : all;
    return own.map((d) => ({ value: String(d.id), label: d.name }));
  }, [lk.data, role, me.data?.department_id]);

  const counts = list.data?.counts;
  const typeOptions = (list.data?.types ?? []).slice().sort((a, b) => a.label.localeCompare(b.label)).map((t) => ({ value: t.type, label: `${t.label} (${t.count})` }));
  const anyFilter = !!(block || dept || type || condition || inspection !== 'all' || openOnly || urlQ);
  const clearAll = () => {
    setQInput('');
    setSp(new URLSearchParams());
  };

  return (
    <div>
      <PageHeader
        title="Asset register"
        hindi="परिसंपत्ति पंजी"
        subtitle={
          <>
            Department-wise register of schools, anganwadi centres, health centres, handpumps, water schemes and panchayat buildings
            {me.data ? ` · ${me.data.jurisdiction}` : ''}. Open an asset to inspect it and take findings through to verified closure.
          </>
        }
      />

      {/* KPI strip — each tile applies its filter */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {counts ? (
          <>
            <Kpi label="Assets in register" value={num(counts.total)} sub="In your jurisdiction" onClick={() => setParams({ condition: null, inspection: null, open: null })} />
            <Kpi label="Good condition" value={num(counts.good)} tone="ok" sub={pctOf(counts.good, counts.total)} onClick={() => setParams({ condition: 'good' })} />
            <Kpi label="Needs repair" value={num(counts.needs_repair)} tone="warn" sub={pctOf(counts.needs_repair, counts.total)} onClick={() => setParams({ condition: 'needs_repair' })} />
            <Kpi label="Critical" value={num(counts.critical)} tone="critical" sub={pctOf(counts.critical, counts.total)} onClick={() => setParams({ condition: 'critical' })} />
            <Kpi label="Inspections overdue" value={num(counts.overdue)} tone={counts.overdue ? 'bad' : 'ok'} sub="Past the due date" onClick={() => setParams({ inspection: 'overdue' })} />
            <Kpi label="With open findings" value={num(counts.withOpenFindings)} tone={counts.withOpenFindings ? 'warn' : 'ok'} sub="Awaiting closure" onClick={() => setParams({ open: '1' })} />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>

      <Card>
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-line p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
              <label htmlFor="asset-search" className="text-xs font-semibold text-ink-3">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input id="asset-search" type="search" maxLength={100} className="h-9 pl-8 text-[13px]" placeholder="Code, name, village or panchayat" value={qInput} onChange={(e) => setQInput(e.target.value)} />
              </div>
            </div>
            <FilterSelect label="Block" value={block} onChange={(v) => setParams({ block: v })} options={blockOptions} allLabel="All blocks" />
            <FilterSelect label="Department" value={dept} onChange={(v) => setParams({ dept: v })} options={deptOptions} allLabel="All departments" />
            <FilterSelect label="Asset type" value={type} onChange={(v) => setParams({ type: v })} options={typeOptions} allLabel="All types" />
            <FilterSelect
              label="Inspection"
              value={inspection === 'all' ? '' : inspection}
              onChange={(v) => setParams({ inspection: v || null })}
              options={[
                { value: 'overdue', label: 'Overdue' },
                { value: 'due30', label: 'Due in 30 days (incl. overdue)' },
              ]}
              allLabel="All"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-full overflow-x-auto">
              <Segmented<'all' | 'good' | 'needs_repair' | 'critical'>
                label="Condition"
                value={condition || 'all'}
                onChange={(v) => setParams({ condition: v === 'all' ? null : v })}
                options={[
                  { value: 'all', label: 'All conditions', count: counts?.total },
                  { value: 'good', label: 'Good', count: counts?.good },
                  { value: 'needs_repair', label: 'Needs repair', count: counts?.needs_repair },
                  { value: 'critical', label: 'Critical', count: counts?.critical },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-2">
                <input type="checkbox" className="size-4 accent-accent" checked={openOnly} onChange={(e) => setParams({ open: e.target.checked ? '1' : null })} />
                Open findings only
              </label>
              {anyFilter && (
                <Button size="sm" variant="ghost" icon={<FilterX className="size-4" />} onClick={clearAll}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        {list.isLoading ? (
          <SkeletonRows rows={8} />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !list.data || list.data.rows.length === 0 ? (
          <EmptyState title={anyFilter ? 'No assets match these filters' : 'No assets in your jurisdiction'} icon={<Building2 className="size-8" aria-hidden />}>
            {anyFilter ? (
              <Button size="sm" className="mt-2" onClick={clearAll}>
                Clear filters
              </Button>
            ) : (
              'Assets appear here once they are added to the district register.'
            )}
          </EmptyState>
        ) : (
          <div className={cx('transition-opacity', list.isPlaceholderData && 'opacity-60')} aria-busy={list.isFetching}>
            <Table caption="Asset register">
              <thead>
                <tr>
                  <Th>Asset</Th>
                  <Th>Type</Th>
                  <Th>Block / village</Th>
                  <Th>Department</Th>
                  <Th>Condition</Th>
                  <Th>Functional status</Th>
                  <Th>Open findings</Th>
                  <Th>Last inspected</Th>
                  <Th>Next inspection due</Th>
                  <Th>Responsible officer</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((a) => (
                  <tr key={a.id} className="hover:bg-subtle/60">
                    <Td className="min-w-56">
                      <Link to={`/assets/${a.id}`} className="font-semibold leading-snug text-ink hover:text-accent hover:underline">
                        {a.name}
                      </Link>
                      <div className="font-mono text-xs text-ink-3">{a.code}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{a.typeLabel}</Td>
                    <Td className="min-w-32">
                      <div className="font-semibold text-ink-2">{a.blockName}</div>
                      <div className="text-xs text-ink-3">{[a.village, a.panchayat && a.panchayat !== a.village ? `${a.panchayat} GP` : null].filter(Boolean).join(' · ') || '—'}</div>
                    </Td>
                    <Td className="min-w-32">{a.departmentName}</Td>
                    <Td>
                      <Badge tone={conditionTone(a.condition)}>{a.conditionLabel}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className={cx(a.functional_status === 'non_functional' ? 'font-semibold text-bad' : a.functional_status === 'partially' ? 'font-semibold text-warn' : 'text-ink-2')}>{a.functionalLabel}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {a.open_findings > 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular font-bold text-ink">{a.open_findings}</span>
                          {a.worstOpen && (
                            <Badge tone={severityTone(a.worstOpen)} title="Most severe open finding">
                              {SEVERITY_LABEL[a.worstOpen]}
                            </Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-ink-3">None</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div>{fmtDate(a.last_inspected)}</div>
                      {a.last_inspected && <div className="text-xs text-ink-3">{relDays(a.last_inspected)}</div>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div>{fmtDate(a.next_inspection_due)}</div>
                      {a.inspectionState === 'overdue' ? (
                        <Badge tone="bad" className="mt-1">
                          Overdue {a.inspectionOverdueBy} d
                        </Badge>
                      ) : a.inspectionState === 'due_soon' ? (
                        <Badge tone="warn" className="mt-1">
                          Due {relDays(a.next_inspection_due)}
                        </Badge>
                      ) : a.inspectionState === 'none' ? (
                        <span className="text-xs text-ink-3">Not scheduled</span>
                      ) : null}
                    </Td>
                    <Td className="min-w-44">
                      <OfficerChip name={a.officerName} designation={a.officerDesignation} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={(p) => setParams({ page: p > 1 ? String(p) : null })} />
          </div>
        )}
      </Card>
    </div>
  );
}

function pctOf(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}% of register` : '—';
}
