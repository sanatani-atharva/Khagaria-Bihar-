import { ScrollText, Search, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROLE_LABEL, type Role } from '../../core/types';
import { idParam, useUrlFilters, useUrlSearch } from '../components/files/shared';
import { Button, Card, EmptyState, ErrorState, FilterSelect, Input, PageHeader, Pagination, SkeletonRows, Table, Td, Th, cx } from '../components/ui';
import { fmtDateTime, num } from '../lib/format';
import { useLookups, useQ } from '../lib/hooks';

const ENTITY_LABEL: Record<string, string> = {
  file: 'File',
  work: 'Work',
  asset: 'Asset',
  finding: 'Finding',
  action: 'Review action',
  meeting: 'Review meeting',
  scheme_target: 'Scheme target',
  import: 'Data import',
  user: 'Sign-in',
  system: 'System',
};

const ROUTE: Record<string, (id: number) => string> = {
  work: (id) => `/works/${id}`,
  file: (id) => `/files/${id}`,
  asset: (id) => `/assets/${id}`,
  action: (id) => `/review?tab=actions&action=${id}`,
};

const entityLabel = (t: string) => ENTITY_LABEL[t] ?? t.replace(/_/g, ' ');

export default function Audit() {
  const { get, set, page } = useUrlFilters();
  const lk = useLookups();
  const entityType = get('type');
  const userId = idParam(get('user'));
  const urlQ = get('q');
  const [q, setQ] = useUrlSearch('q', urlQ, set);

  const list = useQ('audit.list', { q: urlQ || undefined, entityType: entityType || undefined, userId, page, pageSize: 50 });
  const d = list.data;
  const anyFilter = !!(urlQ || entityType || userId);
  const clearAll = () => {
    setQ('');
    set({ q: null, type: null, user: null });
  };

  const typeOptions = (d?.types ?? []).map((t) => ({ value: t.entity_type, label: `${entityLabel(t.entity_type)} (${num(t.n)})` }));
  if (entityType && !typeOptions.some((o) => o.value === entityType)) typeOptions.push({ value: entityType, label: entityLabel(entityType) });

  return (
    <div>
      <PageHeader title="Audit trail" hindi="लेखा-परीक्षा" subtitle="Append-only record of every state change in Zila Samanvay, newest first." />

      <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] border border-accent/30 bg-accent-soft/50 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <p className="max-w-[52ch] text-[13px] leading-relaxed text-ink-2">
          Every state change is written here with the officer and the timestamp: file movements, progress updates, inspections, evidence uploads, verification
          decisions, review-meeting decisions, publication to the public portal and sign-ins. Entries are append-only and{' '}
          <strong className="text-ink">cannot be edited or deleted from the user interface</strong>.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="flex w-full min-w-48 flex-col gap-0.5 sm:w-72">
            <label htmlFor="audit-search" className="text-xs font-semibold text-ink-3">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input id="audit-search" type="search" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Summary, officer or action" className="h-9 pl-8 text-[13px]" />
            </div>
          </div>
          <FilterSelect label="Record type" value={entityType} onChange={(v) => set({ type: v || null })} allLabel="All record types" options={typeOptions} />
          <FilterSelect
            label="Officer"
            value={userId ? String(userId) : ''}
            onChange={(v) => set({ user: v || null })}
            allLabel="All officers"
            options={(lk.data?.users ?? []).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.designation}` }))}
          />
          {anyFilter && (
            <Button variant="ghost" className="h-9" icon={<X className="size-4" aria-hidden />} onClick={clearAll}>
              Clear filters
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <SkeletonRows rows={10} />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !d || d.rows.length === 0 ? (
          <EmptyState title={anyFilter ? 'No audit entries match these filters' : 'No audit entries yet'} icon={<ScrollText className="size-8" aria-hidden />}>
            {anyFilter ? (
              <button type="button" className="font-semibold text-accent hover:underline" onClick={clearAll}>
                Clear the filters
              </button>
            ) : (
              'Entries appear as soon as officers act in the system.'
            )}
          </EmptyState>
        ) : (
          <div className={cx('transition-opacity', list.isPlaceholderData && 'opacity-60')} aria-busy={list.isFetching}>
            <Table caption="Audit trail entries">
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Officer</Th>
                  <Th>Action</Th>
                  <Th>Record</Th>
                  <Th>Summary</Th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => {
                  const role = r.role && r.role in ROLE_LABEL ? ROLE_LABEL[r.role as Role] : null;
                  const route = r.entity_id !== null ? ROUTE[r.entity_type] : undefined;
                  return (
                    <tr key={r.id} className="hover:bg-subtle/60">
                      <Td className="whitespace-nowrap text-ink-2">
                        <time dateTime={r.at}>{fmtDateTime(r.at)}</time>
                      </Td>
                      <Td className="min-w-44">
                        {role ? (
                          <>
                            <div className="font-semibold text-ink">{r.user_name ?? 'Unknown officer'}</div>
                            <div className="text-xs text-ink-3">{role}</div>
                          </>
                        ) : r.role === 'public' ? (
                          <span className="text-ink-2">Public</span>
                        ) : (
                          <span className="text-ink-2">System</span>
                        )}
                      </Td>
                      <Td>
                        <span className="whitespace-nowrap rounded border border-line bg-subtle px-1.5 py-0.5 text-xs font-semibold text-ink-2" title={r.action}>{actionLabel(r.action)}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="text-ink-2">{entityLabel(r.entity_type)}</span>
                        {r.entity_id !== null &&
                          (route ? (
                            <Link to={route(r.entity_id)} className="ml-1 font-semibold text-accent hover:underline">
                              #{r.entity_id}
                            </Link>
                          ) : (
                            <span className="ml-1 text-ink-3">#{r.entity_id}</span>
                          ))}
                      </Td>
                      <Td className="min-w-72 text-ink">{r.summary}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={d.page} pages={d.pages} total={d.total} onPage={(p) => set({ page: p })} />
            {d.total >= 2000 && <p className="px-4 pb-3 text-xs text-ink-3">Showing the latest 2,000 matching entries. Narrow the search or filters to see older ones.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'file.created': 'File opened', 'file.forwarded': 'File forwarded', 'file.approved': 'File approved', 'file.query': 'Query raised',
  'file.replied': 'Query replied', 'file.returned': 'File returned', 'file.closed': 'File closed',
  'work.progress': 'Progress updated', 'work.milestone': 'Milestone updated', 'work.publish': 'Published to portal', 'work.unpublish': 'Withdrawn from portal',
  'works.import': 'Works sheet imported', 'schemes.import': 'Scheme MIS imported', 'scheme.update': 'Achievement updated', 'scheme.target': 'Target set',
  'inspection.scheduled': 'Inspection scheduled', 'inspection.recorded': 'Inspection recorded',
  'finding.assigned': 'Corrective action assigned', 'finding.resolution_submitted': 'Evidence submitted', 'finding.closed': 'Finding verified & closed', 'finding.reopened': 'Finding reopened',
  'action.created': 'Review decision logged', 'action.progress': 'Action progress', 'action.resolution_submitted': 'Action evidence submitted', 'action.closed': 'Action verified & closed', 'action.reopened': 'Action reopened',
  'meeting.created': 'Meeting scheduled', 'meeting.held': 'Minutes recorded', 'initiative.created': 'Initiative defined',
  'session.login': 'Signed in', 'system.seed': 'Demo data loaded', 'system.reset': 'Demo data reset',
};

function actionLabel(code: string): string {
  return ACTION_LABELS[code] ?? code.replace(/[._]/g, ' ');
}
