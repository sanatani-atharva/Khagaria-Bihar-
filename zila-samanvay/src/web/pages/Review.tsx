// Review meeting command centre: the Review Meeting Priority Engine (ranked agenda with
// "why flagged"), the Review Decision Logger and the Action Tracker that follows every
// decision to verified closure. All filters live in the URL so a view can be shared.

import {
  CalendarDays, CalendarPlus, Check, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Download, ExternalLink, FileClock, Gavel,
  HardHat, History, Info, MapPin, Network, PencilLine, Printer, Search, ShieldAlert, Target, TriangleAlert, Upload, UserRound, XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { ProcOutput } from '../../core/rpc';
import { daysBetween } from '../../core/time';
import type { AgendaCategory, AgendaItem, Role } from '../../core/types';
import { AGENDA_CATEGORY_LABEL, ROLE_LABEL } from '../../core/types';
import { EvidenceList, EvidencePicker } from '../components/evidence';
import {
  actionLabel, actionTone, BAND_LABEL, briefLink, CATEGORY_ORDER, evidenceState, exportBriefCsv, isCategory, meetingStatusLabel, meetingTone,
  pickDefaultMeeting, posInt, refLink, scopeLabel, type ActionRow, type Lookups, type Meeting,
} from '../components/review/helpers';
import { useToast } from '../components/toast';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, FilterSelect, Input, Kpi, LinkButton, Modal, OfficerChip, PageHeader,
  Pagination, Progress, Segmented, Select, Skeleton, SkeletonRows, Textarea, cx,
} from '../components/ui';
import type { EvidencePayload } from '../lib/files';
import { addDaysFromToday, bandTone, fmtDate, fmtDateTime, relDays, TONE, today } from '../lib/format';
import { useDebounced, useLookups, useM, useMe, useQ } from '../lib/hooks';
import type { RpcError } from '../lib/rpc';

type Tab = 'agenda' | 'actions' | 'meetings';
type ActionFilter = 'all' | 'open' | 'overdue' | 'submitted' | 'closed';
type Patch = Record<string, string | number | null | undefined>;
type Update = (patch: Patch, replace?: boolean) => void;

const LIMITS = [25, 50, 100];
const ACTION_FILTERS: ActionFilter[] = ['all', 'open', 'overdue', 'submitted', 'closed'];
const ACTION_FILTER_LABEL: Record<ActionFilter, string> = { all: 'All', open: 'Open', overdue: 'Overdue', submitted: 'Awaiting verification', closed: 'Closed' };
const ACTIONS_PER_PAGE = 15;
const ROLE_ORDER: Role[] = ['dm', 'ddc', 'dept_officer', 'block_officer'];
const H4 = 'text-xs font-bold uppercase tracking-wide text-ink-3';

const CAT_ICON: Record<AgendaCategory, typeof HardHat> = {
  work_delay: HardHat,
  file_delay: FileClock,
  critical_finding: ShieldAlert,
  service_gap: Target,
  coordination: Network,
};

function actionLink(id: number, meetingId?: number) {
  const p = new URLSearchParams({ tab: 'actions', action: String(id) });
  if (meetingId) p.set('meeting', String(meetingId));
  return `/review?${p.toString()}`;
}

// =====================================================================================
// Page
// =====================================================================================
export default function Review() {
  const [params, setParams] = useSearchParams();
  const update = useCallback<Update>(
    (patch, replace = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  const me = useMe();
  const lookups = useLookups();
  const toast = useToast();
  const isExec = me.data?.role === 'dm' || me.data?.role === 'ddc';

  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'actions' || tabParam === 'meetings' ? tabParam : 'agenda';
  const blockId = posInt(params.get('block'));
  const departmentId = posInt(params.get('dept'));
  const catParam = params.get('cat');
  const category = isCategory(catParam) ? catParam : undefined;
  const limitParam = Number(params.get('limit'));
  const limit = LIMITS.includes(limitParam) ? limitParam : 25;

  const meetingsQ = useQ('review.meetings', {});
  const meetingParam = posInt(params.get('meeting'));
  const selectedMeeting = useMemo(() => {
    const list = meetingsQ.data ?? [];
    return list.find((m) => m.id === meetingParam) ?? pickDefaultMeeting(list);
  }, [meetingsQ.data, meetingParam]);
  const meetingId = selectedMeeting?.id;

  const agendaQ = useQ('review.agenda', { blockId, departmentId, category, limit });
  const summaryQ = useQ('review.actions', { status: 'all' });
  const flagged = agendaQ.data ? CATEGORY_ORDER.reduce((s, c) => s + agendaQ.data.counts[c], 0) : undefined;
  const ac = summaryQ.data?.counts;

  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const n = await exportBriefCsv({ meetingId, blockId, departmentId, limit: 50 }, scopeLabel(lookups.data, blockId, departmentId));
      toast.show(`Brief downloaded: ${n.items} agenda items and ${n.actions} actions.`, 'ok');
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setExporting(false);
    }
  };

  const [scheduling, setScheduling] = useState(false);
  const openSchedule = useCallback(() => setScheduling(true), []);
  const closeSchedule = useCallback(() => setScheduling(false), []);

  return (
    <div>
      <PageHeader
        title="Review meeting command centre"
        hindi="समीक्षा बैठक"
        subtitle="What needs the review meeting's attention, ranked, with the reason each item is flagged — and a tracker that follows every decision to verified closure."
        actions={
          <>
            <Button icon={<Download className="size-4" aria-hidden />} loading={exporting} onClick={doExport}>
              Export brief (CSV)
            </Button>
            <LinkButton to={briefLink(meetingId, blockId, departmentId)} icon={<Printer className="size-4" aria-hidden />}>
              Print-ready brief (PDF)
            </LinkButton>
            {isExec && (
              <Button variant="primary" icon={<CalendarPlus className="size-4" aria-hidden />} onClick={openSchedule}>
                Schedule meeting
              </Button>
            )}
          </>
        }
      />

      <MeetingBar
        loading={meetingsQ.isLoading}
        error={meetingsQ.error}
        retry={() => void meetingsQ.refetch()}
        meetings={meetingsQ.data ?? []}
        selected={selectedMeeting}
        onSelect={(id) => update({ meeting: id })}
        isExec={isExec}
        onSchedule={openSchedule}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {agendaQ.isLoading || summaryQ.isLoading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <Kpi
              label="Flagged for review"
              value={flagged ?? '—'}
              sub={blockId || departmentId ? 'Under the block / department filter' : 'Ranked by priority score'}
              onClick={() => update({ tab: 'agenda', action: null })}
            />
            <Kpi label="Open actions" value={ac?.open ?? '—'} sub="Decisions not yet closed" onClick={() => update({ tab: 'actions', status: 'open', action: null })} />
            <Kpi
              label="Overdue actions"
              value={ac?.overdue ?? '—'}
              tone={ac ? (ac.overdue ? 'bad' : 'ok') : undefined}
              sub="Past deadline, not closed"
              onClick={() => update({ tab: 'actions', status: 'overdue', action: null })}
            />
            <Kpi
              label="Awaiting verification"
              value={ac?.submitted ?? '—'}
              tone={ac?.submitted ? 'warn' : undefined}
              sub="Evidence submitted by officers"
              onClick={() => update({ tab: 'actions', status: 'submitted', action: null })}
            />
          </>
        )}
      </div>

      <div className="mb-4">
        <Segmented<Tab>
          label="Review sections"
          value={tab}
          onChange={(v) => update({ tab: v, action: null })}
          options={[
            { value: 'agenda', label: 'Ranked agenda', count: flagged },
            { value: 'actions', label: 'Action tracker', count: ac?.open },
            { value: 'meetings', label: 'Meetings', count: meetingsQ.data?.length },
          ]}
        />
      </div>

      {tab === 'agenda' && (
        <AgendaTab
          q={agendaQ}
          category={category}
          blockId={blockId}
          departmentId={departmentId}
          limit={limit}
          update={update}
          isExec={isExec}
          meetings={meetingsQ.data ?? []}
          meetingId={meetingId}
          lookups={lookups.data}
        />
      )}
      {tab === 'actions' && <ActionsTab params={params} update={update} meetingId={meetingId} meetingTitle={selectedMeeting?.title} isExec={isExec} />}
      {tab === 'meetings' && (
        <MeetingsTab
          loading={meetingsQ.isLoading}
          error={meetingsQ.error}
          retry={() => void meetingsQ.refetch()}
          meetings={meetingsQ.data ?? []}
          selectedId={meetingId}
          isExec={isExec}
          update={update}
          onSchedule={openSchedule}
        />
      )}

      {scheduling && <ScheduleMeetingModal onClose={closeSchedule} onCreated={(id) => update({ meeting: id })} />}
    </div>
  );
}

// =====================================================================================
// Meeting selector
// =====================================================================================
function MeetingBar({
  loading, error, retry, meetings, selected, onSelect, isExec, onSchedule,
}: {
  loading: boolean;
  error: { message: string } | null;
  retry: () => void;
  meetings: Meeting[];
  selected: Meeting | null;
  onSelect: (id: number) => void;
  isExec: boolean;
  onSchedule: () => void;
}) {
  const id = useId();
  if (loading)
    return (
      <Card className="mb-4 p-4">
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  if (error)
    return (
      <div className="mb-4">
        <ErrorState error={error} onRetry={retry} />
      </div>
    );
  if (!selected)
    return (
      <Card className="mb-4">
        <EmptyState icon={<CalendarDays className="size-8" aria-hidden />} title="No review meeting on record">
          {isExec ? (
            <Button size="sm" variant="primary" className="mt-2" icon={<CalendarPlus className="size-4" aria-hidden />} onClick={onSchedule}>
              Schedule the first meeting
            </Button>
          ) : (
            'The DM or DDC schedules review meetings. The ranked agenda below is still live.'
          )}
        </EmptyState>
      </Card>
    );
  const pctClosed = selected.actions ? (selected.closed / selected.actions) * 100 : 0;
  return (
    <Card className="mb-4 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)] lg:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={id} className="text-xs font-semibold text-ink-3">
            Review meeting
          </label>
          <Select id={id} value={String(selected.id)} onChange={(e) => onSelect(Number(e.target.value))}>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} — {fmtDate(m.meeting_date)} ({m.status === 'scheduled' ? 'scheduled' : m.status})
              </option>
            ))}
          </Select>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div className="min-w-0">
            <dt className={H4}>Date</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              {fmtDate(selected.meeting_date)} <span className="font-normal text-ink-3">({relDays(selected.meeting_date)})</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={H4}>Chair</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-ink">{selected.chairName ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className={H4}>Status</dt>
            <dd className="mt-0.5">
              <Badge tone={meetingTone(selected.status)}>{meetingStatusLabel(selected.status)}</Badge>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={H4}>Actions closed</dt>
            <dd className="mt-0.5">
              <span className="tabular text-sm font-semibold text-ink">
                {selected.closed} / {selected.actions}
              </span>
              <Progress value={pctClosed} tone={selected.actions && selected.closed === selected.actions ? 'ok' : 'info'} label={`${selected.closed} of ${selected.actions} actions closed`} className="mt-1" />
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

// =====================================================================================
// Agenda tab — Review Meeting Priority Engine
// =====================================================================================
type AgendaQuery = UseQueryResult<ProcOutput<'review.agenda'>, RpcError>;

function Chip({ active, onClick, count, icon, children }: { active: boolean; onClick: () => void; count?: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors',
        active ? 'border-ink bg-ink text-white' : 'border-line-2 bg-white text-ink-2 hover:bg-subtle hover:text-ink',
      )}
    >
      {icon}
      {children}
      {count !== undefined && <span className={cx('tabular rounded-full px-1.5 text-[11px]', active ? 'bg-white/20 text-white' : 'bg-subtle text-ink-2')}>{count}</span>}
    </button>
  );
}

function LimitSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink-3">
        Show top
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border border-line-2 bg-white px-3 pr-8 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        {LIMITS.map((n) => (
          <option key={n} value={n}>
            {n} items
          </option>
        ))}
      </select>
    </div>
  );
}

function AgendaTab({
  q, category, blockId, departmentId, limit, update, isExec, meetings, meetingId, lookups,
}: {
  q: AgendaQuery;
  category?: AgendaCategory;
  blockId?: number;
  departmentId?: number;
  limit: number;
  update: Update;
  isExec: boolean;
  meetings: Meeting[];
  meetingId?: number;
  lookups?: Lookups;
}) {
  const [logItem, setLogItem] = useState<AgendaItem | null>(null);
  const closeLog = useCallback(() => setLogItem(null), []);
  const counts = q.data?.counts;
  const total = counts ? CATEGORY_ORDER.reduce((s, c) => s + counts[c], 0) : undefined;
  const filtered = !!(blockId || departmentId || category);
  const clear = () => update({ cat: null, block: null, dept: null });
  const nextLimit = LIMITS.find((n) => n > limit);

  let body: ReactNode;
  if (q.isLoading) {
    body = (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading agenda">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    );
  } else if (q.error) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  } else if (!q.data || !q.data.items.length) {
    body = (
      <Card>
        <EmptyState icon={<ClipboardCheck className="size-8" aria-hidden />} title={filtered ? 'Nothing flagged under these filters' : 'Nothing needs the review meeting right now'}>
          {filtered ? (
            <Button size="sm" className="mt-2" onClick={clear}>
              Clear filters
            </Button>
          ) : (
            'No work, file, inspection finding, service gap or inter-department initiative crosses the review thresholds.'
          )}
        </EmptyState>
      </Card>
    );
  } else {
    const items = q.data.items;
    body = (
      <>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-ink-3">
          <h2 className="text-[13px] font-normal">
            <span className="font-semibold text-ink">
              Top {items.length} of {q.data.total}
            </span>{' '}
            flagged item{q.data.total === 1 ? '' : 's'}
            {category ? ` in “${AGENDA_CATEGORY_LABEL[category]}”` : ''}, highest score first.
          </h2>
          <p aria-live="polite">{q.isFetching ? 'Updating…' : `Computed ${fmtDateTime(q.data.generatedAt)}`}</p>
        </div>
        <ol className={cx('flex flex-col gap-3 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          {items.map((it, i) => (
            <li key={it.key}>
              <AgendaCard item={it} rank={i + 1} canLog={isExec} onLog={setLogItem} meetingId={meetingId} />
            </li>
          ))}
        </ol>
        {q.data.total > items.length && (
          <p className="text-center text-[13px] text-ink-3">
            {q.data.total - items.length} lower-scoring item{q.data.total - items.length === 1 ? '' : 's'} not shown.{' '}
            {nextLimit && (
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => update({ limit: nextLimit })}>
                Show top {nextLimit}
              </button>
            )}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div role="group" aria-label="Filter by agenda category" className="flex flex-wrap gap-1.5">
          <Chip active={!category} onClick={() => update({ cat: null })} count={total}>
            All categories
          </Chip>
          {CATEGORY_ORDER.map((c) => {
            const Icon = CAT_ICON[c];
            return (
              <Chip key={c} active={category === c} onClick={() => update({ cat: category === c ? null : c })} count={counts?.[c]} icon={<Icon className="size-3.5" aria-hidden />}>
                {AGENDA_CATEGORY_LABEL[c]}
              </Chip>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Block"
            value={blockId ? String(blockId) : ''}
            onChange={(v) => update({ block: v || null })}
            options={(lookups?.blocks ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
            allLabel="All blocks"
          />
          <FilterSelect
            label="Department"
            value={departmentId ? String(departmentId) : ''}
            onChange={(v) => update({ dept: v || null })}
            options={(lookups?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
            allLabel="All departments"
          />
          <LimitSelect value={limit} onChange={(v) => update({ limit: v === 25 ? null : v })} />
          {filtered && (
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear filters
            </Button>
          )}
        </div>
        <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-[13px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>
            <span className="font-semibold text-ink">How ranking works:</span> each item gets transparent, additive priority points from the length of delay, severity, value at stake,
            persistence over time and repeat flags in earlier meetings; open the score breakdown on any item to see every point. Items inside a flagged inter-department initiative are
            folded into that one coordination item. Bands: Critical 75+, High 55–74, Medium below 55.
          </span>
        </p>
      </Card>

      {body}

      {logItem && <LogDecisionModal item={logItem} meetings={meetings} defaultMeetingId={meetingId} lookups={lookups} onClose={closeLog} />}
    </div>
  );
}

function AgendaCard({ item, rank, canLog, onLog, meetingId }: { item: AgendaItem; rank: number; canLog: boolean; onLog: (i: AgendaItem) => void; meetingId?: number }) {
  const Icon = CAT_ICON[item.category];
  const raw = item.factors.reduce((s, f) => s + f.points, 0);
  const tone = bandTone(item.band);
  const t = today();
  return (
    <Card as="article" className="p-4">
      <div className="flex gap-3">
        <div className="flex w-8 shrink-0 flex-col items-center pt-0.5 sm:w-10">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">Rank</span>
          <span className="tabular text-xl font-bold leading-tight text-ink">{rank}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-3">
                  <Icon className="size-3.5" aria-hidden />
                  {AGENDA_CATEGORY_LABEL[item.category]}
                </span>
                {item.timesFlaggedBefore > 0 && (
                  <Badge tone="warn">
                    <History className="size-3" aria-hidden />
                    Flagged in {item.timesFlaggedBefore} earlier meeting{item.timesFlaggedBefore > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              <h3 className="mt-1 text-[15px] font-bold leading-snug text-ink">
                <Link to={item.link} className="hover:text-accent hover:underline">
                  {item.title}
                </Link>
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-3">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span>{item.blockName ? `${item.blockName} block` : 'District-wide'}</span>
                <span aria-hidden>·</span>
                <span>{item.departmentNames.filter(Boolean).join(', ') || 'Department not set'}</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Score</div>
              <div className={cx('tabular text-[32px] font-bold leading-none', TONE[tone].text)}>{item.score}</div>
              <Badge tone={tone} className="mt-1.5">
                {BAND_LABEL[item.band]}
              </Badge>
            </div>
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0">
              <h4 className={H4}>Why flagged</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-ink-2 marker:text-ink-3">
                {item.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <details className="group mt-3 border-t border-line pt-1">
                <summary className="flex list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-ink-2 hover:bg-subtle [&::-webkit-details-marker]:hidden">
                  <span>
                    Score breakdown <span className="font-normal text-ink-3">({item.factors.length} factors)</span>
                  </span>
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <table className="w-full border-t border-line text-[13px]">
                  <caption className="sr-only">Score factors for {item.title}</caption>
                  <tbody>
                    {item.factors.map((f, i) => (
                      <tr key={i} className="border-b border-line">
                        <td className="px-3 py-1.5 text-ink-2">{f.label}</td>
                        <td className={cx('tabular whitespace-nowrap px-3 py-1.5 text-right font-semibold', f.points < 0 ? 'text-ok' : 'text-ink')}>
                          {f.points > 0 ? '+' : f.points < 0 ? '−' : ''}
                          {Math.abs(f.points)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-subtle">
                      <th scope="row" className="rounded-bl-lg px-3 py-1.5 text-left font-bold text-ink">
                        Priority score{raw !== item.score ? ` (sum ${raw}, floored at 0)` : ''}
                      </th>
                      <td className="tabular rounded-br-lg px-3 py-1.5 text-right font-bold text-ink">{item.score}</td>
                    </tr>
                  </tfoot>
                </table>
              </details>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <h4 className={H4}>Responsible officer</h4>
                <div className="mt-1">
                  <OfficerChip name={item.officerName} compact />
                  {item.officerDesignation && <p className="mt-0.5 pl-9 text-xs text-ink-3">{item.officerDesignation}</p>}
                </div>
              </div>
              <div className="rounded-md bg-accent-soft/70 px-3 py-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wide text-accent">Suggested action</h4>
                <p className="mt-1 text-[13px] font-semibold text-ink">{item.suggestedAction}</p>
                <p className="mt-1 text-xs text-ink-2">Suggested deadline: {item.suggestedDeadlineDays} days</p>
              </div>
            </div>
          </div>

          {item.openActions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <h4 className={H4}>Action already assigned</h4>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {item.openActions.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span className="font-semibold text-ink">{o.assignee || 'Officer'}</span>
                    <span className="text-ink-3">Due {fmtDate(o.deadline)}</span>
                    <Badge tone={actionTone(o.status)}>{actionLabel(o.status)}</Badge>
                    {o.overdue && <Badge tone="bad">Overdue by {Math.max(1, daysBetween(o.deadline, t))} d</Badge>}
                    <Link to={actionLink(o.id, meetingId)} className="font-semibold text-accent hover:underline">
                      Track action
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
            <LinkButton size="sm" variant="ghost" to={item.link} icon={<ExternalLink className="size-3.5" aria-hidden />}>
              Open record
            </LinkButton>
            {canLog && (
              <Button variant="primary" icon={<Gavel className="size-4" aria-hidden />} onClick={() => onLog(item)}>
                Log decision
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------- Review Decision Logger ----------------
function LogDecisionModal({ item, meetings, defaultMeetingId, lookups, onClose }: { item: AgendaItem; meetings: Meeting[]; defaultMeetingId?: number; lookups?: Lookups; onClose: () => void }) {
  const formId = useId();
  const m = useM('review.logDecision', { success: 'Decision logged — the action is assigned and now tracked.' });
  const [title, setTitle] = useState(item.title.slice(0, 300));
  const [decision, setDecision] = useState(item.suggestedAction);
  const [assignee, setAssignee] = useState(item.officerId ? String(item.officerId) : '');
  const [deadline, setDeadline] = useState(addDaysFromToday(item.suggestedDeadlineDays));
  const [meeting, setMeeting] = useState(defaultMeetingId ? String(defaultMeetingId) : '');
  const [tried, setTried] = useState(false);
  const min = today();

  const errors = {
    title: title.trim().length < 3 ? 'Enter a title of at least 3 characters.' : null,
    decision: decision.trim().length < 5 ? 'Record the decision taken (at least 5 characters).' : null,
    assignee: !assignee ? 'Choose the officer responsible.' : null,
    deadline: !deadline ? 'Set a deadline.' : deadline < min ? 'The deadline cannot be in the past.' : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  const groups = useMemo(
    () =>
      ROLE_ORDER.map((r) => ({ role: r, users: (lookups?.users ?? []).filter((u) => u.role === r).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.users.length),
    [lookups],
  );

  const submit = () => {
    setTried(true);
    if (!valid) return;
    m.mutate(
      {
        meetingId: meeting ? Number(meeting) : null,
        agendaKey: item.key,
        category: item.category,
        title: title.trim(),
        decision: decision.trim(),
        assignedTo: Number(assignee),
        deadline,
        refType: item.refType,
        refId: item.refId,
        departmentId: item.departmentIds[0] ?? null,
        blockId: item.blockId ?? null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Log review decision"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={m.isPending} icon={<Gavel className="size-4" aria-hidden />}>
            Log decision and assign
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="rounded-lg border border-line bg-subtle p-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={bandTone(item.band)}>
              {BAND_LABEL[item.band]} · score {item.score}
            </Badge>
            <span className="font-semibold text-ink-3">{AGENDA_CATEGORY_LABEL[item.category]}</span>
          </div>
          <p className="mt-1.5 font-semibold text-ink">{item.title}</p>
          {item.reasons[0] && <p className="mt-0.5 text-ink-2">{item.reasons[0]}</p>}
        </div>

        <Field label="Action title" required error={tried ? errors.title : null}>
          {(id) => <Input id={id} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && !!errors.title} />}
        </Field>
        <Field label="Decision taken" required help="Prefilled with the suggested action. Edit it to record exactly what the meeting decided." error={tried ? errors.decision : null}>
          {(id) => <Textarea id={id} rows={4} maxLength={1200} value={decision} onChange={(e) => setDecision(e.target.value)} aria-invalid={tried && !!errors.decision} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assign to" required help={item.officerName ? `Responsible officer: ${item.officerName}` : undefined} error={tried ? errors.assignee : null}>
            {(id) => (
              <Select id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!lookups} aria-invalid={tried && !!errors.assignee}>
                <option value="">{lookups ? 'Choose an officer' : 'Loading officers…'}</option>
                {groups.map((g) => (
                  <optgroup key={g.role} label={ROLE_LABEL[g.role]}>
                    {g.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.designation}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Deadline" required help={`Suggested: ${item.suggestedDeadlineDays} days from today`} error={tried ? errors.deadline : null}>
            {(id) => <Input id={id} type="date" min={min} value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={tried && !!errors.deadline} />}
          </Field>
        </div>
        <Field label="Review meeting" help="The decision is recorded against this meeting and appears in its action-taken report.">
          {(id) => (
            <Select id={id} value={meeting} onChange={(e) => setMeeting(e.target.value)}>
              <option value="">Not linked to a meeting</option>
              {meetings.map((mt) => (
                <option key={mt.id} value={mt.id}>
                  {mt.title} — {fmtDate(mt.meeting_date)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

// =====================================================================================
// Actions tab — Action tracker
// =====================================================================================
type DialogKind = 'update' | 'submit' | 'verify';

function Toggle({ pressed, onClick, disabled, icon, children, title }: { pressed: boolean; onClick: () => void; disabled?: boolean; icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cx(
        'inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        pressed ? 'border-accent bg-accent-soft text-accent' : 'border-line-2 bg-white text-ink-2 hover:bg-subtle hover:text-ink',
      )}
    >
      {pressed ? <Check className="size-4" aria-hidden /> : icon}
      {children}
    </button>
  );
}

function ActionsTab({ params, update, meetingId, meetingTitle, isExec }: { params: URLSearchParams; update: Update; meetingId?: number; meetingTitle?: string; isExec: boolean }) {
  const statusParam = params.get('status') ?? '';
  const status: ActionFilter = (ACTION_FILTERS as string[]).includes(statusParam) ? (statusParam as ActionFilter) : 'all';
  const mine = params.get('mine') === '1';
  const onlyMeeting = params.get('scope') === 'meeting' && !!meetingId;
  const urlQ = params.get('q') ?? '';
  const focusId = posInt(params.get('action'));

  // debounced search, mirrored into the URL
  const [text, setText] = useState(urlQ);
  const dq = useDebounced(text.trim(), 300);
  // refs keep this effect keyed on the debounced text only (setSearchParams changes identity with the URL)
  const urlQRef = useRef(urlQ);
  urlQRef.current = urlQ;
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    if (dq !== urlQRef.current) updateRef.current({ q: dq || null }, true);
  }, [dq]);
  useEffect(() => {
    setText((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);

  const q = useQ('review.actions', { status, meetingId: onlyMeeting ? meetingId : undefined, mine: mine || undefined, q: urlQ || undefined });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const counts = q.data?.counts;

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, mine, onlyMeeting, urlQ]);
  useEffect(() => {
    if (!focusId) return;
    const idx = rows.findIndex((r) => r.id === focusId);
    if (idx >= 0) setPage(Math.floor(idx / ACTIONS_PER_PAGE) + 1);
  }, [focusId, rows]);
  const pages = Math.max(1, Math.ceil(rows.length / ACTIONS_PER_PAGE));
  const cur = Math.min(page, pages);
  const visible = rows.slice((cur - 1) * ACTIONS_PER_PAGE, cur * ACTIONS_PER_PAGE);

  // scroll the linked action into view once
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (!focusId || scrolledFor.current === focusId) return;
    const el = document.getElementById(`action-${focusId}`);
    if (!el) return;
    scrolledFor.current = focusId;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [focusId, cur, q.data]);

  const [dialog, setDialog] = useState<{ kind: DialogKind; row: ActionRow } | null>(null);
  const openDialog = useCallback((kind: DialogKind, row: ActionRow) => setDialog({ kind, row }), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const focusHidden = !!focusId && !!q.data && !rows.some((r) => r.id === focusId);
  const anyFilter = status !== 'all' || mine || onlyMeeting || !!urlQ;
  const showAll = () => {
    setText('');
    update({ status: null, mine: null, scope: null, q: null });
  };

  let body: ReactNode;
  if (q.isLoading) {
    body = (
      <Card>
        <SkeletonRows rows={5} />
      </Card>
    );
  } else if (q.error) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  } else if (!rows.length) {
    const title =
      status === 'overdue' ? 'No overdue actions' : status === 'submitted' ? 'No evidence awaiting verification' : status === 'closed' ? 'No closed actions yet' : 'No actions match';
    body = (
      <Card>
        <EmptyState icon={<ClipboardList className="size-8" aria-hidden />} title={title}>
          {anyFilter ? (
            <Button size="sm" className="mt-2" onClick={showAll}>
              Show all actions
            </Button>
          ) : (
            'Decisions logged from the ranked agenda appear here with an owner, a deadline and evidence of completion.'
          )}
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <>
        <ul className={cx('flex flex-col gap-3 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          {visible.map((r) => (
            <li key={r.id} id={`action-${r.id}`} className="scroll-mt-24">
              <ActionCard row={r} focused={r.id === focusId} onOpen={openDialog} />
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <Card>
            <Pagination page={cur} pages={pages} total={rows.length} onPage={setPage} />
          </Card>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <Segmented<ActionFilter>
            label="Action status"
            value={status}
            onChange={(v) => update({ status: v === 'all' ? null : v, action: null })}
            options={ACTION_FILTERS.map((f) => ({ value: f, label: ACTION_FILTER_LABEL[f], count: counts?.[f] }))}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Toggle pressed={mine} onClick={() => update({ mine: mine ? null : '1', action: null })} icon={<UserRound className="size-4" aria-hidden />}>
              Assigned to me
            </Toggle>
            <Toggle
              pressed={onlyMeeting}
              disabled={!meetingId}
              title={meetingId ? undefined : 'Select a meeting first'}
              onClick={() => update({ scope: onlyMeeting ? null : 'meeting', action: null })}
              icon={<CalendarDays className="size-4" aria-hidden />}
            >
              This meeting only
            </Toggle>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input type="search" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search title or decision" aria-label="Search actions" className="pl-9" />
            </div>
          </div>
        </div>
        {onlyMeeting && meetingTitle && <p className="mt-2 text-xs text-ink-3">Showing actions logged in “{meetingTitle}”.</p>}
      </Card>

      {focusHidden && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-ink">
          <span className="inline-flex items-center gap-2">
            <TriangleAlert className="size-4 text-warn" aria-hidden />
            Action #{focusId} is hidden by the current filters.
          </span>
          <Button size="sm" onClick={showAll}>
            Show all actions
          </Button>
        </div>
      )}

      {body}

      {dialog?.kind === 'update' && <UpdateActionModal row={dialog.row} isExec={isExec} onClose={closeDialog} />}
      {dialog?.kind === 'submit' && <SubmitEvidenceModal row={dialog.row} onClose={closeDialog} />}
      {dialog?.kind === 'verify' && <VerifyActionModal row={dialog.row} onClose={closeDialog} />}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={H4}>{label}</div>
      <div className="mt-1 text-[13px] text-ink">{children}</div>
    </div>
  );
}

function ActionCard({ row, focused, onOpen }: { row: ActionRow; focused: boolean; onOpen: (kind: DialogKind, row: ActionRow) => void }) {
  const ev = evidenceState(row);
  const link = row.refLink ?? refLink(row.ref_type, row.ref_id);
  return (
    <Card as="article" className={cx('p-4', focused && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs font-bold uppercase tracking-wide text-ink-3">
            <span>Action #{row.id}</span>
            {row.categoryLabel && (
              <>
                <span aria-hidden>·</span>
                <span>{row.categoryLabel}</span>
              </>
            )}
          </div>
          <h3 className="mt-1 text-[15px] font-bold leading-snug text-ink">{row.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={actionTone(row.status)}>{row.statusLabel}</Badge>
          {row.overdueBy > 0 && <Badge tone={row.overdueBy > 14 ? 'critical' : 'bad'}>Overdue by {row.overdueBy} d</Badge>}
        </div>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">
        <span className="font-semibold text-ink">Decision: </span>
        {row.decision}
      </p>

      <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Assigned to">
          <OfficerChip name={row.assigneeName} designation={row.assigneeDesignation} phone={row.assigneePhone} />
        </Meta>
        <Meta label="Department / block">
          {row.departmentName ?? '—'}
          <span className="block text-ink-3">{row.blockName ? `${row.blockName} block` : 'District level'}</span>
        </Meta>
        <Meta label="Review meeting">
          {row.meetingTitle ? (
            <>
              {row.meetingTitle.title}
              <span className="block text-ink-3">{fmtDate(row.meetingTitle.meeting_date)}</span>
            </>
          ) : (
            <span className="text-ink-3">Not linked to a meeting</span>
          )}
        </Meta>
        <Meta label="Deadline">
          <span className="tabular font-semibold">{fmtDate(row.deadline)}</span>
          <span className={cx('block', row.overdueBy > 0 ? 'font-semibold text-bad' : 'text-ink-3')}>
            {row.status === 'closed' ? `Closed ${fmtDate(row.closed_at)}` : row.overdueBy > 0 ? `${row.overdueBy} days overdue` : `Due ${relDays(row.deadline)}`}
          </span>
        </Meta>
      </div>

      {row.progress_note && (
        <div className="mt-3 rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Latest progress: </span>
          {row.progress_note}
          <span className="text-ink-3"> · updated {fmtDateTime(row.updated_at)}</span>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <h4 className={H4}>Evidence of completion</h4>
          {row.evidence.length > 0 && <Badge tone={ev.tone}>{ev.label}</Badge>}
        </div>
        <EvidenceList items={row.evidence} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        {link ? (
          <Link to={link} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
            <ExternalLink className="size-3.5" aria-hidden /> Open source record
          </Link>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {row.can.update && (
            <Button icon={<PencilLine className="size-4" aria-hidden />} onClick={() => onOpen('update', row)}>
              Update progress
            </Button>
          )}
          {row.can.submit && (
            <Button variant="primary" icon={<Upload className="size-4" aria-hidden />} onClick={() => onOpen('submit', row)}>
              Submit evidence
            </Button>
          )}
          {row.can.verify && (
            <Button variant="primary" icon={<ClipboardCheck className="size-4" aria-hidden />} onClick={() => onOpen('verify', row)}>
              Verify evidence
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ActionContext({ row }: { row: ActionRow }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={actionTone(row.status)}>{row.statusLabel}</Badge>
        <span className="text-ink-3">
          Due {fmtDate(row.deadline)}
          {row.overdueBy > 0 ? ` · ${row.overdueBy} days overdue` : ''}
        </span>
      </div>
      <p className="mt-1.5 font-semibold text-ink">{row.title}</p>
      <p className="mt-0.5 text-ink-2">{row.decision}</p>
      <p className="mt-1 text-ink-3">
        Assigned to {row.assigneeName}
        {row.assigneeDesignation ? `, ${row.assigneeDesignation}` : ''}
      </p>
    </div>
  );
}

function UpdateActionModal({ row, isExec, onClose }: { row: ActionRow; isExec: boolean; onClose: () => void }) {
  const formId = useId();
  const m = useM('review.updateAction', { success: 'Progress update saved.' });
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [tried, setTried] = useState(false);
  const min = today();
  const errNote = note.trim().length < 3 ? 'Describe the progress made (at least 3 characters).' : null;
  const errDeadline = deadline && deadline < min ? 'The new deadline cannot be in the past.' : null;

  const submit = () => {
    setTried(true);
    if (errNote || errDeadline) return;
    m.mutate({ id: row.id, note: note.trim(), deadline: isExec && deadline ? deadline : undefined }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Update progress"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={m.isPending}>
            Save update
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ActionContext row={row} />
        {row.progress_note && (
          <p className="text-[13px] text-ink-2">
            <span className="font-semibold text-ink">Previous update: </span>
            {row.progress_note}
          </p>
        )}
        <Field label="Progress note" required help={`${note.trim().length}/600 characters`} error={tried ? errNote : null}>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What has been done since the last review, and what remains"
              aria-invalid={tried && !!errNote}
            />
          )}
        </Field>
        {isExec && (
          <Field label="Extend deadline to (optional)" help={`Current deadline ${fmtDate(row.deadline)}. Leave blank to keep it.`} error={tried ? errDeadline : null}>
            {(id) => <Input id={id} type="date" min={min} value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={tried && !!errDeadline} />}
          </Field>
        )}
      </form>
    </Modal>
  );
}

function SubmitEvidenceModal({ row, onClose }: { row: ActionRow; onClose: () => void }) {
  const formId = useId();
  const evLabel = useId();
  const m = useM('review.submitActionEvidence', { success: 'Evidence submitted. The DM / DDC will verify it before the action is closed.' });
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<EvidencePayload | null>(null);
  const [tried, setTried] = useState(false);
  const errNote = note.trim().length < 5 ? 'Describe what was done (at least 5 characters).' : null;
  const errEvidence = !evidence ? 'Attach a photo or PDF as evidence.' : null;

  const submit = () => {
    setTried(true);
    if (errNote || !evidence) return;
    m.mutate({ id: row.id, note: note.trim(), evidence }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Submit evidence of completion"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={m.isPending} icon={<Upload className="size-4" aria-hidden />}>
            Submit for verification
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ActionContext row={row} />
        <Field label="What was done" required help={`${note.trim().length}/600 characters`} error={tried ? errNote : null}>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Work completed, quantities, dates and where it can be checked"
              aria-invalid={tried && !!errNote}
            />
          )}
        </Field>
        <div role="group" aria-labelledby={evLabel} className="flex flex-col gap-1">
          <p id={evLabel} className="text-[13px] font-semibold text-ink-2">
            Evidence<span className="text-bad"> *</span>
          </p>
          <EvidencePicker value={evidence} onChange={setEvidence} />
          {tried && errEvidence && (
            <p className="text-xs font-semibold text-bad" role="alert">
              {errEvidence}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}

function VerifyActionModal({ row, onClose }: { row: ActionRow; onClose: () => void }) {
  const toast = useToast();
  const m = useM('review.verifyAction');
  const [remark, setRemark] = useState('');
  const [tried, setTried] = useState(false);
  const [choice, setChoice] = useState<'accept' | 'reject' | null>(null);
  const pending = row.evidence.filter((e) => e.review_status === 'pending');
  const earlier = row.evidence.filter((e) => e.review_status !== 'pending');
  const target = pending[0];
  const errRemark = remark.trim().length < 3 ? 'Record a verification remark (at least 3 characters).' : null;

  const act = (decision: 'accept' | 'reject') => {
    setTried(true);
    if (errRemark || !target) return;
    setChoice(decision);
    m.mutate(
      { id: row.id, evidenceId: target.id, decision, remark: remark.trim() },
      {
        onSuccess: () => {
          toast.show(decision === 'accept' ? 'Evidence verified — action closed.' : 'Evidence rejected — action reopened for the officer.', 'ok');
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Verify evidence"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={m.isPending && choice === 'reject'} disabled={m.isPending || !target} icon={<XCircle className="size-4" aria-hidden />} onClick={() => act('reject')}>
            Reject and reopen
          </Button>
          <Button variant="success" loading={m.isPending && choice === 'accept'} disabled={m.isPending || !target} icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => act('accept')}>
            Accept and close
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ActionContext row={row} />
        {row.progress_note && (
          <p className="text-[13px] text-ink-2">
            <span className="font-semibold text-ink">Officer's note: </span>
            {row.progress_note}
          </p>
        )}
        <div>
          <h3 className={cx(H4, 'mb-1.5')}>Evidence awaiting verification</h3>
          {target ? <EvidenceList items={pending} /> : <p className="text-[13px] text-ink-3">No pending evidence on this action.</p>}
        </div>
        {earlier.length > 0 && (
          <div>
            <h3 className={cx(H4, 'mb-1.5')}>Earlier submissions</h3>
            <EvidenceList items={earlier} />
          </div>
        )}
        <Field label="Verification remark" required help="Say how the evidence was checked (site visit, photo check, document)." error={tried ? errRemark : null}>
          {(id) => (
            <Textarea id={id} rows={3} maxLength={600} value={remark} onChange={(e) => setRemark(e.target.value)} aria-invalid={tried && !!errRemark} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

// =====================================================================================
// Meetings tab
// =====================================================================================
function MeetingsTab({
  loading, error, retry, meetings, selectedId, isExec, update, onSchedule,
}: {
  loading: boolean;
  error: { message: string } | null;
  retry: () => void;
  meetings: Meeting[];
  selectedId?: number;
  isExec: boolean;
  update: Update;
  onSchedule: () => void;
}) {
  const [closing, setClosing] = useState<Meeting | null>(null);
  const closeModal = useCallback(() => setClosing(null), []);

  if (loading)
    return (
      <Card>
        <SkeletonRows rows={4} />
      </Card>
    );
  if (error) return <ErrorState error={error} onRetry={retry} />;

  return (
    <Card>
      <CardHeader
        title="Review meetings"
        subtitle="Every decision logged in a meeting becomes a tracked action with an owner, a deadline and verified evidence."
        actions={
          isExec && (
            <Button size="sm" icon={<CalendarPlus className="size-4" aria-hidden />} onClick={onSchedule}>
              Schedule meeting
            </Button>
          )
        }
      />
      {!meetings.length ? (
        <EmptyState icon={<CalendarDays className="size-8" aria-hidden />} title="No review meetings recorded">
          {isExec ? 'Schedule a meeting to start logging decisions against it.' : 'The DM or DDC schedules review meetings.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {meetings.map((m) => {
            const selected = m.id === selectedId;
            return (
              <li key={m.id} className={cx('px-4 py-4', selected && 'bg-accent-soft/30')}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-bold text-ink">{m.title}</h3>
                      <Badge tone={meetingTone(m.status)}>{meetingStatusLabel(m.status)}</Badge>
                      {selected && <Badge tone="info">Selected</Badge>}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {fmtDate(m.meeting_date)} ({relDays(m.meeting_date)}) · Chair: {m.chairName ?? '—'}
                    </p>
                    {m.minutes ? (
                      <p className="mt-2 whitespace-pre-line text-[13px] text-ink-2">
                        <span className="font-semibold text-ink">Minutes: </span>
                        {m.minutes}
                      </p>
                    ) : (
                      <p className="mt-2 text-[13px] text-ink-3">Minutes not yet recorded.</p>
                    )}
                  </div>
                  <div className="w-full shrink-0 md:w-72">
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="font-semibold text-ink-2">Actions closed</span>
                      <span className="tabular font-bold text-ink">
                        {m.closed} / {m.actions}
                      </span>
                    </div>
                    <Progress
                      value={m.actions ? (m.closed / m.actions) * 100 : 0}
                      tone={m.actions && m.closed === m.actions ? 'ok' : 'info'}
                      label={`${m.closed} of ${m.actions} actions closed`}
                      className="mt-1"
                    />
                    <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
                      {!selected && (
                        <Button size="sm" onClick={() => update({ meeting: m.id })}>
                          Select
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => update({ tab: 'actions', meeting: m.id, scope: 'meeting', status: null, action: null })}>
                        View actions
                      </Button>
                      {isExec && m.status === 'scheduled' && (
                        <Button size="sm" variant="primary" icon={<ClipboardCheck className="size-4" aria-hidden />} onClick={() => setClosing(m)}>
                          Record minutes &amp; mark held
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {closing && <CloseMeetingModal meeting={closing} onClose={closeModal} />}
    </Card>
  );
}

function CloseMeetingModal({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const formId = useId();
  const m = useM('review.closeMeeting', { success: 'Minutes recorded — meeting marked as held.' });
  const actionsQ = useQ('review.actions', { meetingId: meeting.id });
  const [minutes, setMinutes] = useState('');
  const [tried, setTried] = useState(false);
  const err = minutes.trim().length < 3 ? 'Record the minutes (at least 3 characters).' : minutes.length > 4000 ? 'Keep the minutes under 4,000 characters.' : null;
  const future = meeting.meeting_date > today();

  const draft = () => {
    const rows = actionsQ.data?.rows ?? [];
    const lines = [`Review meeting held on ${fmtDate(meeting.meeting_date)}, chaired by ${meeting.chairName ?? 'the District Magistrate'}.`];
    if (rows.length) {
      lines.push('', 'Decisions taken:');
      rows.forEach((a, i) => lines.push(`${i + 1}. ${a.title} — ${a.assigneeName}, by ${fmtDate(a.deadline)}.`));
    } else lines.push('', 'No decisions were logged against this meeting.');
    const text = lines.join('\n');
    setMinutes((cur) => (cur.trim() ? `${cur.trim()}\n\n${text}` : text));
  };

  const submit = () => {
    setTried(true);
    if (err) return;
    m.mutate({ id: meeting.id, minutes: minutes.trim() }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record minutes and mark held"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={m.isPending} icon={<ClipboardCheck className="size-4" aria-hidden />}>
            Save minutes and mark held
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="rounded-lg border border-line bg-subtle p-3 text-[13px]">
          <p className="font-semibold text-ink">{meeting.title}</p>
          <p className="text-ink-3">
            {fmtDate(meeting.meeting_date)} · Chair: {meeting.chairName ?? '—'} · {meeting.actions} action{meeting.actions === 1 ? '' : 's'} logged
          </p>
        </div>
        {future && (
          <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            This meeting is dated {fmtDate(meeting.meeting_date)}. Mark it held only after it has taken place.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-ink-3">Start from the decisions already logged against this meeting, then edit.</p>
          <Button size="sm" onClick={draft} loading={actionsQ.isLoading} disabled={!!actionsQ.error}>
            Insert logged decisions
          </Button>
        </div>
        <Field label="Minutes" required help={`${minutes.length}/4000 characters`} error={tried ? err : null}>
          {(id) => <Textarea id={id} rows={10} maxLength={4000} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-invalid={tried && !!err} />}
        </Field>
      </form>
    </Modal>
  );
}

// ---------------- schedule ----------------
function ScheduleMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const formId = useId();
  const m = useM('review.createMeeting', { success: 'Review meeting scheduled.' });
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(addDaysFromToday(7));
  const [tried, setTried] = useState(false);
  const min = today();
  const errTitle = title.trim().length < 3 ? 'Enter a meeting title (at least 3 characters).' : null;
  const errDate = !date ? 'Choose the meeting date.' : date < min ? 'A new meeting cannot be scheduled in the past.' : null;

  const submit = () => {
    setTried(true);
    if (errTitle || errDate) return;
    m.mutate(
      { title: title.trim(), date },
      {
        onSuccess: (out) => {
          onCreated(out.id);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule review meeting"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={m.isPending} icon={<CalendarPlus className="size-4" aria-hidden />}>
            Schedule
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Meeting title" required error={tried ? errTitle : null}>
          {(id) => (
            <Input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly DM Review Meeting" aria-invalid={tried && !!errTitle} />
          )}
        </Field>
        <Field label="Date" required help="The DM chairs the meeting; decisions logged in it are tracked to closure." error={tried ? errDate : null}>
          {(id) => <Input id={id} type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={tried && !!errDate} />}
        </Field>
      </form>
    </Modal>
  );
}
