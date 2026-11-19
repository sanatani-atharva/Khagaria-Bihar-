import { Archive, ArrowRight, CheckCircle2, Clock, FilePlus2, HelpCircle, Lock, Reply, Send, Undo2 } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProcOutput } from '../../core/rpc';
import { addDays } from '../../core/time';
import { FILE_ACTION_META, FileActionModal, type FileActionKey } from '../components/files/FileActionModal';
import { AgingBadge, FileStatusBadge, PriorityBadge } from '../components/files/shared';
import {
  Badge, Button, Card, CardHeader, DL, EmptyState, ErrorState, NextAction, OfficerChip, PageHeader, Progress, SkeletonPage, cx,
} from '../components/ui';
import { fmtDate, fmtDateTime, lakh, TONE } from '../lib/format';
import { useQ } from '../lib/hooks';

type FileGet = ProcOutput<'files.get'>;
type Movement = FileGet['movements'][number];

const MOVE_META: Record<string, { label: string; icon: ReactNode }> = {
  created: { label: 'File opened', icon: <FilePlus2 className="size-4" aria-hidden /> },
  forwarded: { label: 'Forwarded', icon: <Send className="size-4" aria-hidden /> },
  approved: { label: 'Approved', icon: <CheckCircle2 className="size-4" aria-hidden /> },
  query: { label: 'Query raised', icon: <HelpCircle className="size-4" aria-hidden /> },
  replied: { label: 'Replied to query', icon: <Reply className="size-4" aria-hidden /> },
  returned: { label: 'Returned', icon: <Undo2 className="size-4" aria-hidden /> },
  closed: { label: 'Closed', icon: <Archive className="size-4" aria-hidden /> },
};

const ACTION_ORDER: FileActionKey[] = ['reply', 'forward', 'approve', 'query', 'return', 'close'];

export default function FileDetail() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const valid = Number.isInteger(id) && id > 0;
  // No placeholder: moving between /files/:id must never show (or act on) the previous file.
  const q = useQ('files.get', { id }, { enabled: valid, placeholderData: undefined });
  const [action, setAction] = useState<FileActionKey | null>(null);
  const closeAction = useCallback(() => setAction(null), []);

  const crumbs = [{ label: 'Files', to: '/files' }, { label: q.data?.file.file_no ?? (valid ? `File #${id}` : 'File') }];

  if (!valid)
    return (
      <div>
        <PageHeader title="File not found" crumbs={crumbs} />
        <ErrorState error={{ message: 'This file link is not valid.' }} />
      </div>
    );
  if (q.isLoading) return <SkeletonPage />;
  if (q.error || !q.data)
    return (
      <div>
        <PageHeader title="File" crumbs={crumbs} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );

  const data = q.data;
  const f = data.file;
  const closed = f.status === 'closed';
  const allowed = ACTION_ORDER.filter((a) => data.allowedActions.includes(a));

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title={f.subject}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] text-ink-2">{f.file_no}</span>
            <FileStatusBadge status={f.status} label={f.statusLabel} />
            {!closed && <AgingBadge aging={f.aging} />}
            <PriorityBadge priority={f.priority} />
          </span>
        }
      />

      <WherePending data={data} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="File facts" />
            <div className="p-4">
              <DL
                cols={2}
                items={[
                  ['Category', f.category],
                  ['Department', f.departmentName || '—'],
                  ['Block', f.blockName ?? 'District level'],
                  [
                    'Opened',
                    <>
                      {fmtDate(f.opened_at)} <span className="text-ink-3">· {f.aging.totalDays} d {closed ? 'in total' : 'old'}</span>
                    </>,
                  ],
                  ['Amount involved', f.amount_lakh !== null ? lakh(f.amount_lakh, { crore: true }) : 'No amount'],
                  ['SLA at each desk', `${f.sla_days} days`],
                  [
                    'Linked work',
                    data.work ? (
                      <Link to={`/works/${data.work.id}`} className="font-semibold text-accent hover:underline">
                        {data.work.code} — {data.work.name}
                        <span className="font-normal text-ink-3"> · {data.work.physical_pct}% done</span>
                      </Link>
                    ) : (
                      'None'
                    ),
                  ],
                  [
                    'Linked asset',
                    data.asset ? (
                      <Link to={`/assets/${data.asset.id}`} className="font-semibold text-accent hover:underline">
                        {data.asset.code} — {data.asset.name}
                      </Link>
                    ) : (
                      'None'
                    ),
                  ],
                  ['Opened by', f.creatorName ?? '—'],
                  [
                    'Queries raised',
                    data.queryCount > 0 ? (
                      <span className="font-semibold text-warn">
                        {data.queryCount} {data.queryCount === 1 ? 'query' : 'queries'}
                      </span>
                    ) : (
                      'None'
                    ),
                  ],
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Movement history" subtitle="Every movement is time-stamped with the officer who acted. Time held at each desk is checked against the SLA." />
            {data.movements.length === 0 ? <EmptyState title="No movements recorded yet" /> : <Timeline moves={data.movements} sla={f.sla_days} closed={closed} />}
          </Card>
        </div>

        <aside className="order-first min-w-0 lg:sticky lg:top-6 lg:order-none lg:self-start">
          <Card className="lg:sticky lg:top-4">
            <CardHeader title="Act on this file" subtitle={allowed.length ? 'Each action needs a noting and moves the file.' : undefined} />
            <div className="p-4">
              {closed ? (
                <p className="flex items-start gap-2 text-sm text-ink-3">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                  This file was closed on {fmtDate(f.closed_at)}. No further action is possible.
                </p>
              ) : allowed.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-ink-3">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Only the officer holding this file (or the DM/DDC) can act on it.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {allowed.map((a) => {
                    const meta = FILE_ACTION_META[a];
                    return (
                      <Button key={a} variant={meta.variant} icon={meta.icon} className="w-full justify-start" onClick={() => setAction(a)}>
                        {meta.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <FileActionModal action={action} data={data} onClose={closeAction} />
    </div>
  );
}

function WherePending({ data }: { data: FileGet }) {
  const f = data.file;
  const a = f.aging;
  const t = TONE[a.tone];
  const closed = f.status === 'closed';
  const lastQuery = [...data.movements].reverse().find((m) => m.action === 'query');
  const pct = f.sla_days > 0 ? (a.daysAtDesk / f.sla_days) * 100 : 100;
  const due = addDays(f.arrived_at, f.sla_days);

  return (
    <Card className={cx(t.border)}>
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold text-ink">
            {closed ? 'Where did it end?' : 'Where is it pending?'}
            <span lang="hi" className="hi text-sm font-normal text-ink-3">
              {closed ? 'संचिका बंद' : 'कहाँ लंबित है?'}
            </span>
          </h2>
          {closed ? (
            <p className="mt-2 text-base text-ink">
              Closed on <strong>{fmtDate(f.closed_at)}</strong> at <strong>{f.officeName}</strong> after <strong>{a.totalDays} days</strong> in movement.
            </p>
          ) : (
            <p className="mt-2 text-base leading-relaxed text-ink">
              {f.status === 'approved' ? 'Approved; now at ' : 'Pending at '}
              <strong>{f.officeName}</strong>
              {f.holderName ? (
                <>
                  {' '}
                  with <strong>{f.holderName}</strong>
                  {f.holderDesignation ? ` (${f.holderDesignation})` : ''}
                </>
              ) : (
                ' (no officer assigned)'
              )}{' '}
              for{' '}
              <strong className={t.text}>
                {a.daysAtDesk} {a.daysAtDesk === 1 ? 'day' : 'days'}
              </strong>{' '}
              — SLA {f.sla_days} days.
            </p>
          )}
          {!closed && (
            <div className="mt-3 max-w-md">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden /> At this desk since {fmtDateTime(f.arrived_at)}
                </span>
                <AgingBadge aging={a} />
              </div>
              <Progress value={pct} tone={a.tone} label={`${a.daysAtDesk} of ${f.sla_days} SLA days used`} />
            </div>
          )}
          {!closed && f.holderName && (
            <div className="mt-3">
              <OfficerChip name={f.holderName} designation={f.holderDesignation} phone={f.holderPhone} />
            </div>
          )}
        </div>
        {!closed && (
          <div className="md:w-[380px] md:shrink-0">
            <NextAction
              text={
                f.status === 'query'
                  ? `Reply to query${lastQuery?.remark ? ` — “${lastQuery.remark}”` : ''}`
                  : f.status === 'approved'
                    ? 'Decision approved — act on it and close the file (or forward for execution).'
                    : f.decision_required
              }
              due={`${fmtDate(due)} (SLA)`}
            />
            {f.status === 'query' && <p className="mt-2 text-xs text-ink-3">Decision sought: {f.decision_required}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

function Timeline({ moves, sla, closed }: { moves: Movement[]; sla: number; closed: boolean }) {
  return (
    <ol className="px-4 py-4">
      {moves.map((m, i) => {
        const meta = MOVE_META[m.action] ?? { label: m.action, icon: <ArrowRight className="size-4" aria-hidden /> };
        const last = i === moves.length - 1;
        const current = last && !closed;
        const over = m.daysHeld > sla;
        const moved = m.toOffice && m.fromOffice && m.to_office_id !== m.from_office_id;
        return (
          <li key={m.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className="absolute left-4 top-9 bottom-0 w-px bg-line-2" aria-hidden />}
            <span
              className={cx(
                'relative z-[1] grid size-8 shrink-0 place-items-center rounded-full border',
                current ? 'border-accent bg-accent-soft text-accent' : m.action === 'query' ? 'border-warn/40 bg-warn-soft text-warn' : m.action === 'approved' || m.action === 'closed' ? 'border-ok/30 bg-ok-soft text-ok' : 'border-line-2 bg-subtle text-ink-2',
              )}
            >
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-ink">{meta.label}</span>
                {current && <Badge tone="info">Current desk</Badge>}
                <span className="text-xs text-ink-3">{fmtDateTime(m.at)}</span>
              </div>
              <div className="mt-0.5 text-[13px] text-ink-2">
                {moved ? (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {m.fromOffice} <ArrowRight className="size-3.5 text-ink-3" aria-hidden /> <strong className="font-semibold">{m.toOffice}</strong>
                    {m.toName && <span className="text-ink-3">({m.toName})</span>}
                  </span>
                ) : (
                  <span>at {m.toOffice ?? m.fromOffice ?? '—'}</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-ink-3">
                By {m.byName ?? 'Unknown officer'}
                {m.byDesignation ? `, ${m.byDesignation}` : ''}
              </div>
              {m.remark && <p className="mt-1.5 rounded-md bg-subtle px-3 py-1.5 text-[13px] text-ink-2">{m.remark}</p>}
              {m.action !== 'closed' && (
                <div className="mt-1.5">
                  {m.daysHeld === 0 && !current ? (
                    <span className="text-xs text-ink-3">Moved on the same day</span>
                  ) : over ? (
                    <Badge tone="bad">
                      {current ? 'At this desk' : 'Held'} {m.daysHeld} d — {m.daysHeld - sla} d over SLA
                    </Badge>
                  ) : (
                    <span className="text-xs text-ink-3">
                      {current ? 'At this desk' : 'Held'} {m.daysHeld} {m.daysHeld === 1 ? 'day' : 'days'} (SLA {sla})
                    </span>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
