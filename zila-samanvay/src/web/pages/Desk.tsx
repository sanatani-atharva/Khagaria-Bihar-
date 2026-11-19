import { ArrowRight, CalendarClock, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProcOutput } from '../../core/rpc';
import { IssueList } from '../components/issues';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Kpi, LinkButton, PageHeader, SkeletonPage, Table, Td, Th, cx } from '../components/ui';
import { fmtDate, relDays, today } from '../lib/format';
import { useMe, useQ } from '../lib/hooks';
import type { Tone } from '../../core/types';

type DeskData = ProcOutput<'desk.mine'>;

const STALE_DAYS = 14;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

export default function Desk() {
  const me = useMe().data;
  const q = useQ('desk.mine', {});

  if (q.isLoading) return <SkeletonPage />;
  if (q.error || !q.data)
    return (
      <div>
        <PageHeader title="My desk" hindi="मेरा कार्य" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );

  const d = q.data;
  const c = d.counts;
  const exec = me?.role === 'dm' || me?.role === 'ddc';
  const supervisor = exec || me?.role === 'dept_officer' || (me?.role === 'block_officer' && !me?.department_id);
  const filesOverSla = d.files.filter((f) => f.tone === 'bad' || f.tone === 'critical').length;
  const now = today();
  const findingsOverdue = d.findingsAssigned.filter((f) => f.dueDate && f.dueDate < now).length;
  const actionsOverdue = d.actions.filter((a) => a.tone === 'bad').length;
  const inspectionsOverdue = d.inspections.filter((i) => i.overdueBy > 0).length;
  const total = c.files + c.findings + c.toAssign + c.toVerify + c.actions + c.worksToUpdate + c.inspections;
  const verifyItems = [...d.toVerify, ...d.actionsToVerify];

  const tiles: { id: string; label: string; value: number; sub: string; tone: Tone; show: boolean }[] = [
    { id: 'desk-files', label: 'Files at my desk', value: c.files, sub: filesOverSla ? `${filesOverSla} beyond SLA` : 'All within SLA', tone: filesOverSla ? 'bad' : 'ok', show: true },
    { id: 'desk-findings', label: 'Findings to rectify', value: c.findings, sub: findingsOverdue ? `${findingsOverdue} past due date` : 'None past due', tone: findingsOverdue ? 'bad' : c.findings ? 'warn' : 'ok', show: true },
    { id: 'desk-assign', label: 'Findings to assign', value: c.toAssign, sub: 'Need owner and due date', tone: c.toAssign ? 'warn' : 'ok', show: supervisor },
    { id: 'desk-verify', label: 'Evidence to verify', value: c.toVerify, sub: 'Accept or reopen', tone: c.toVerify ? 'warn' : 'ok', show: supervisor },
    { id: 'desk-actions', label: 'Review actions', value: c.actions, sub: actionsOverdue ? `${actionsOverdue} overdue` : 'None overdue', tone: actionsOverdue ? 'bad' : 'ok', show: true },
    { id: 'desk-works', label: 'Works needing update', value: c.worksToUpdate, sub: `No update for ${STALE_DAYS}+ days`, tone: c.worksToUpdate ? 'warn' : 'ok', show: true },
    { id: 'desk-inspections', label: 'Inspections due', value: c.inspections, sub: inspectionsOverdue ? `${inspectionsOverdue} overdue` : 'Next 30 days', tone: inspectionsOverdue ? 'bad' : 'ok', show: true },
  ];
  const shown = tiles.filter((t) => t.show);

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${d.user.name}`}
        hindi="मेरा कार्य"
        subtitle={
          <>
            {d.user.designation}
            {me?.jurisdiction ? <> · Jurisdiction: {me.jurisdiction}</> : null}
            {' · '}
            {total === 0 ? 'Nothing is waiting on you right now.' : `${total} item${total === 1 ? '' : 's'} waiting on you.`}
          </>
        }
      />

      <div className={cx('mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', shown.length === 7 ? 'xl:grid-cols-7' : 'xl:grid-cols-5')}>
        {shown.map((t) => (
          <Kpi key={t.id} label={t.label} value={t.value} sub={t.sub} tone={t.value ? t.tone : 'ok'} onClick={() => scrollTo(t.id)} />
        ))}
      </div>

      {total === 0 && (
        <Card className="mb-4">
          <EmptyState title="All clear" icon={<CheckCircle2 className="size-8 text-ok" aria-hidden />}>
            No files, findings, review actions, work updates or inspections are waiting on you. New items appear here as soon as they reach you.
          </EmptyState>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        <Section
          id="desk-files"
          title="Files at my desk"
          subtitle="Open a file to forward, approve, raise a query or close it. Oldest first."
          actions={
            <LinkButton size="sm" to="/files?mine=1">
              File tracker
            </LinkButton>
          }
        >
          <IssueList items={d.files} empty="No files are waiting at your desk." showPlace showOfficer={false} />
        </Section>

        <Section id="desk-findings" title="Inspection findings assigned to me" subtitle="Rectify, then open the asset to upload evidence of resolution (photo or PDF) for verification.">
          <IssueList items={d.findingsAssigned} empty="No findings are assigned to you for rectification." showOfficer={false} />
        </Section>

        {supervisor && (
          <Section id="desk-assign" title="Findings waiting to be assigned" subtitle="Open findings in your jurisdiction with no owner yet. Assign corrective action, an officer and a due date.">
            <IssueList items={d.findingsToAssign} empty="Every open finding in your jurisdiction has an owner." />
          </Section>
        )}

        {supervisor && (
          <Section id="desk-verify" title="Verification queue" subtitle="Evidence of resolution submitted by other officers. Accept to close, or reject to reopen.">
            <IssueList items={verifyItems} empty="No evidence is waiting for your verification." showStatus={false} />
          </Section>
        )}

        <Section
          id="desk-actions"
          title="My review-meeting actions"
          subtitle="Decisions from district review meetings assigned to you."
          actions={
            <LinkButton size="sm" to="/review?tab=actions">
              All review actions
            </LinkButton>
          }
        >
          <IssueList items={d.actions} empty="No open review-meeting actions are assigned to you." showOfficer={false} />
        </Section>

        <Section id="desk-works" title="My works" subtitle={`Works where you are the responsible officer. Progress not updated for more than ${STALE_DAYS} days is flagged.`}>
          <WorksList works={d.works} />
        </Section>

        <Section id="desk-inspections" title="Inspections due" subtitle="Scheduled inspections assigned to you, overdue and due in the next 30 days.">
          <InspectionsTable rows={d.inspections} />
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, subtitle, actions, children }: { id: string; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} tabIndex={-1} className="scroll-mt-20 rounded-[var(--radius-card)] focus:outline-none" aria-labelledby={`${id}-h`}>
      <Card as="div">
        <CardHeader title={<span id={`${id}-h`}>{title}</span>} subtitle={subtitle} actions={actions} />
        {children}
      </Card>
    </section>
  );
}

function WorksList({ works }: { works: DeskData['works'] }) {
  if (!works.length) return <EmptyState title="No ongoing works are assigned to you." />;
  return (
    <ul className="divide-y divide-line">
      {works.map((w) => {
        const stale = w.staleDays > STALE_DAYS;
        return (
          <li key={w.key} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={w.tone}>{w.status}</Badge>
                {stale && <Badge tone="warn">Update overdue</Badge>}
              </div>
              <Link to={w.link} className="mt-1 block font-semibold leading-snug text-ink hover:text-accent hover:underline">
                {w.title}
              </Link>
              <p className="mt-0.5 truncate text-xs text-ink-3">{w.subtitle}</p>
              <p className="mt-0.5 text-xs text-ink-3">
                {w.blockName ?? 'District level'} · <span className="tabular font-semibold text-ink-2">{w.metric}</span>
              </p>
            </div>
            <div className="min-w-0 text-[13px]">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">Last progress update</div>
              <span className={cx('font-semibold', stale ? 'text-warn' : 'text-ink')}>{w.staleDays === 0 ? 'Today' : `${w.staleDays} d ago`}</span>
              {stale && <span className="block text-xs text-ink-3">Update is due every {STALE_DAYS} days</span>}
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">Next required action</div>
              <p className="text-[13px] text-ink">{w.nextAction}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-3">{w.dueDate ? `Due ${fmtDate(w.dueDate)}` : ''}</span>
                <Link to={w.link} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                  {stale ? 'Update progress' : 'Open work'} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function InspectionsTable({ rows }: { rows: DeskData['inspections'] }) {
  if (!rows.length) return <EmptyState title="No inspections are due from you in the next 30 days." icon={<CalendarClock className="size-8" aria-hidden />} />;
  return (
    <Table caption="Inspections due">
      <thead>
        <tr>
          <Th>Asset</Th>
          <Th>Block</Th>
          <Th>Scheduled</Th>
          <Th>Status</Th>
          <Th align="right">
            <span className="sr-only">Open</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.id} className="hover:bg-subtle/60">
            <Td className="min-w-52">
              <Link to={i.link} className="font-semibold text-ink hover:text-accent hover:underline">
                {i.assetName}
              </Link>
              <div className="font-mono text-xs text-ink-3">{i.assetCode}</div>
            </Td>
            <Td>{i.blockName || '—'}</Td>
            <Td className="whitespace-nowrap">{fmtDate(i.scheduledDate)}</Td>
            <Td>{i.overdueBy > 0 ? <Badge tone={i.overdueBy > 30 ? 'critical' : 'bad'}>Overdue {i.overdueBy} d</Badge> : <Badge tone="info">Due {relDays(i.scheduledDate)}</Badge>}</Td>
            <Td align="right">
              <Link to={i.link} className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold text-accent hover:underline">
                Record inspection <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
