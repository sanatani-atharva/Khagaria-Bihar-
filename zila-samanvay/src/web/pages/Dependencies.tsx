// Inter-department dependencies. A real-world outcome (say, a safe school with drinking
// water) often needs a building repair, a working water supply and an administrative
// decision held up in another office. This page shows that chain, which link is the root
// bottleneck, who owns it and what must happen first.

import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Network } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NewInitiativeModal } from '../components/executive/NewInitiativeModal';
import {
  Badge, Button, Card, CardHeader, DL, EmptyState, ErrorState, LinkButton, NextAction, OfficerChip, PageHeader, Progress, Skeleton, SkeletonRows, Table, Td, Th, cx,
} from '../components/ui';
import {
  ChainList, DependencyGraph, GraphLegend, buildGraph, downstreamOf, type Component, type GraphModel, type Initiative,
} from '../components/executive/DependencyGraph';
import { INITIATIVE_STATUS, capitalise, componentState, daysLeftLabel } from '../components/executive/shared';
import { fmtDate, num, TONE } from '../lib/format';
import { useMe, useQ } from '../lib/hooks';

export default function Dependencies() {
  const [sp] = useSearchParams();
  const idParam = sp.get('id');
  const wantedId = idParam && /^\d+$/.test(idParam) ? Number(idParam) : undefined;
  const q = useQ('deps.list', {});
  const list = q.data ?? [];
  const selected = list.find((x) => x.id === wantedId) ?? list[0];
  const notFound = wantedId !== undefined && !!q.data && !list.some((x) => x.id === wantedId);
  const me = useMe();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const canCreate = me.data?.role === 'dm' || me.data?.role === 'ddc';
  const raiseLink = `/review?tab=agenda&cat=coordination${selected?.block_id ? `&block=${selected.block_id}` : ''}`;

  const header = (
    <PageHeader
      title="Inter-department dependencies"
      hindi="अंतर-विभागीय निर्भरता"
      subtitle="Outcomes that need several offices to act. Each component is tied to a live work, file or inspection finding, so its status is derived from the record, never typed in."
      actions={
        <>
          {canCreate && (
            <Button onClick={() => setCreating(true)} icon={<Network className="size-4" aria-hidden />}>
              Define initiative
            </Button>
          )}
          <LinkButton to={raiseLink} variant="primary" icon={<ClipboardList className="size-4" aria-hidden />}>
            Raise in review meeting
          </LinkButton>
          <NewInitiativeModal
            open={creating}
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              nav(`/dependencies?id=${id}`);
            }}
          />
        </>
      }
    />
  );

  if (q.isLoading) {
    return (
      <>
        {header}
        <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
          <Card>
            <SkeletonRows rows={4} />
          </Card>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </>
    );
  }
  if (q.error) {
    return (
      <>
        {header}
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </>
    );
  }
  if (!selected) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title="No cross-department initiatives in your jurisdiction" icon={<Network className="size-8" aria-hidden />}>
            Initiatives appear here when an outcome depends on works, files or inspection findings owned by more than one office.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {notFound && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn" role="status">
          That initiative is not in your jurisdiction or no longer exists. Showing the first one instead.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        <InitiativeList list={list} selectedId={selected.id} />
        <InitiativeDetail key={selected.id} ini={selected} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- left list

function InitiativeList({ list, selectedId }: { list: Initiative[]; selectedId: number }) {
  return (
    <Card className="h-fit min-w-0 lg:sticky lg:top-4">
      <CardHeader title={`Initiatives (${list.length})`} subtitle="Select one to see its chain." />
      <ul className="divide-y divide-line">
        {list.map((ini) => {
          const st = INITIATIVE_STATUS[ini.summary.status];
          const active = ini.id === selectedId;
          return (
            <li key={ini.id}>
              <Link
                to={`/dependencies?id=${ini.id}`}
                aria-current={active ? 'page' : undefined}
                className={cx('block border-l-[3px] px-4 py-3 transition-colors', active ? 'border-accent bg-accent-soft/50' : 'border-transparent hover:bg-subtle/60')}
              >
                <span className={cx('block text-[13px] font-semibold leading-snug', active ? 'text-accent' : 'text-ink')}>{ini.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {ini.blockName ?? 'District level'}
                </span>
                <span className="mt-2 flex items-center gap-2">
                  <Progress value={ini.summary.progress} tone={st.tone} label={`${ini.title}: components complete`} />
                  <span className="tabular shrink-0 text-xs font-semibold text-ink-2">{ini.summary.progress}%</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- main panel

function InitiativeDetail({ ini }: { ini: Initiative }) {
  const model = useMemo(() => buildGraph(ini.links), [ini.links]);
  const s = ini.summary;
  const st = INITIATIVE_STATUS[s.status];
  const dl = daysLeftLabel(s.daysLeft);
  const bottleneckId = s.bottleneck?.id ?? null;
  const done = ini.links.length - s.pendingCount;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-3">
            <span className="tabular">{ini.code}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {s.blockedCount > 0 && (
              <Badge tone="bad">
                {s.blockedCount} blocked component{s.blockedCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          <h2 className="mt-1 text-lg font-bold leading-snug text-ink">{ini.title}</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            <span className="font-semibold">Outcome:</span> {ini.outcome}
          </p>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4">
          <DL
            cols={3}
            items={[
              ['Block', ini.blockName ?? 'District level'],
              ['Coordinator', <OfficerChip key="c" name={ini.coordinatorName} designation={ini.coordinatorDesignation} />],
              [
                'Target date',
                <span key="t">
                  {fmtDate(ini.target_date)} <span className={cx('text-[13px] font-semibold', dl.tone === 'muted' ? 'text-ink-3' : TONE[dl.tone].text)}>· {dl.text}</span>
                </span>,
              ],
              [
                'Departments involved',
                <span key="d" className="flex flex-wrap gap-1">
                  {ini.departments.map((d) => (
                    <span key={d} className={cx('rounded border px-1.5 py-0.5 text-xs font-semibold', s.pendingDepartments.includes(d) ? 'border-warn/40 bg-warn-soft text-warn' : 'border-ok/30 bg-ok-soft text-ok')}>
                      {d}
                      <span className="sr-only">{s.pendingDepartments.includes(d) ? ' (has pending components)' : ' (all components done)'}</span>
                    </span>
                  ))}
                </span>,
              ],
              [
                'Facility',
                ini.asset ? (
                  <Link key="a" to={`/assets/${ini.asset.id}`} className="font-semibold text-accent hover:underline">
                    {ini.asset.name}
                  </Link>
                ) : (
                  <span key="a" className="text-ink-3">Not linked to a single facility</span>
                ),
              ],
              [
                'Progress',
                <span key="p" className="flex items-center gap-2">
                  <Progress value={s.progress} tone={st.tone} label="Components complete" className="max-w-40" />
                  <span className="tabular shrink-0 text-[13px] font-semibold">
                    {done} of {ini.links.length} done
                  </span>
                </span>,
              ],
            ]}
          />
          {s.pendingDepartments.length > 0 && (
            <p className="text-[13px] text-ink-3">
              Still pending with: <span className="font-semibold text-ink-2">{s.pendingDepartments.join(', ')}</span>
            </p>
          )}
        </div>
      </Card>

      <BottleneckCallout ini={ini} model={model} />

      <Card>
        <CardHeader
          title="Dependency chain"
          subtitle="Read left to right. Each box is one office's piece of work; an arrow means the next step cannot finish until the previous one is done. Select a box to open the record."
        />
        {ini.links.length === 0 ? (
          <EmptyState title="No components recorded for this initiative" />
        ) : (
          <div className="flex flex-col gap-3 p-3 sm:p-4">
            <div className="hidden sm:block">
              <DependencyGraph ini={ini} model={model} bottleneckId={bottleneckId} />
            </div>
            <div className="sm:hidden">
              <ChainList ini={ini} model={model} bottleneckId={bottleneckId} />
            </div>
            <div className="hidden border-t border-line pt-3 sm:block">
              <GraphLegend />
            </div>
          </div>
        )}
      </Card>

      <ComponentsTable ini={ini} model={model} />
    </div>
  );
}

// ---------------------------------------------------------------- bottleneck

function firstStep(b: Component): string {
  const ref = b.refTitle.split(' · ')[0];
  switch (b.ref_type) {
    case 'file':
      return `Take the pending decision on file ${ref} and move it on — record reasons if it is returned.`;
    case 'work':
      return `Restart work ${ref}: fix a recovery plan with the executing agency and report progress weekly.`;
    case 'finding':
      return b.statusLabel === 'Not assigned'
        ? `Assign corrective action, an owner and a due date for “${b.refTitle}”.`
        : `Rectify “${b.refTitle}” and upload evidence of resolution for verification.`;
    default:
      return `Clear “${b.label}”.`;
  }
}

function BottleneckCallout({ ini, model }: { ini: Initiative; model: GraphModel }) {
  const s = ini.summary;
  const b = s.bottleneck;

  if (s.status === 'done') {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-ok/30 bg-ok-soft px-4 py-3" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div>
          <p className="font-semibold text-ok">Every component is complete</p>
          <p className="text-[13px] text-ink-2">All offices have finished their part. Verify the outcome on the ground and close the initiative in the review meeting.</p>
        </div>
      </div>
    );
  }

  if (!b) {
    // nothing blocked: show what can move right now
    const actionable = model.ordered.filter((l) => !l.done && !l.waiting);
    const first = actionable[0];
    return (
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-ok">No bottleneck</div>
        <p className="mt-0.5 text-sm text-ink-2">No component is blocked. Keep these moving to reach the outcome on time:</p>
        {first && (
          <div className="mt-3">
            <NextAction
              text={`${first.label}: ${capitalise(first.detail)}.`}
              owner={<OfficerChip name={first.ownerName} designation={first.ownerDesignation} />}
            />
          </div>
        )}
        {actionable.length > 1 && (
          <ul className="mt-2 space-y-0.5 text-[13px] text-ink-2">
            {actionable.slice(1).map((l) => (
              <li key={l.id}>
                <Link to={l.refLink} className="hover:text-accent hover:underline">
                  {l.label}
                </Link>{' '}
                <span className="text-ink-3">— {l.statusLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const downstream = downstreamOf(model, b.id);
  return (
    <section aria-labelledby="bottleneck-h" className="rounded-[var(--radius-card)] border-2 border-critical/50 bg-panel shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-critical-soft text-critical" aria-hidden>
          <AlertTriangle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="bottleneck-h" className="text-xs font-bold uppercase tracking-wide text-critical">
              Bottleneck · fix this first
            </h3>
            <Badge tone="bad">{b.statusLabel}</Badge>
            {b.days > 0 && <span className="tabular text-xs font-semibold text-ink-3">{num(b.days)} d pending</span>}
          </div>
          <p className="mt-1 text-base font-bold leading-snug text-ink">{b.label}</p>
          <p className="text-sm text-ink-2">
            {b.departmentName && <span className="font-semibold">{b.departmentName}: </span>}
            {capitalise(b.detail)}.
          </p>
          <Link to={b.refLink} className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
            {b.refTitle} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
      <div className="px-4 py-4">
        <NextAction text={firstStep(b)} owner={<OfficerChip name={b.ownerName} designation={b.ownerDesignation} />} />
        <p className="mt-3 text-[13px] text-ink-2">
          {downstream.length > 0 ? (
            <>
              Until this moves, {downstream.length === 1 ? 'this step' : `these ${downstream.length} steps`} cannot finish:{' '}
              <span className="font-semibold">{downstream.map((d) => d.label).join(' → ')}</span>
              {' '}— and the outcome stays out of reach.
            </>
          ) : (
            <>Nothing else waits on this step, but the outcome cannot be delivered until it is done.</>
          )}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- components table

function ComponentsTable({ ini, model }: { ini: Initiative; model: GraphModel }) {
  const bottleneckId = ini.summary.bottleneck?.id ?? null;
  return (
    <Card>
      <CardHeader title="Components" subtitle="Every office's piece of work, the live record behind it and who owns it." />
      {model.ordered.length === 0 ? (
        <EmptyState title="No components recorded for this initiative" />
      ) : (
        <>
          <Table caption={`Components of ${ini.title}`}>
            <thead>
              <tr>
                <Th>Department</Th>
                <Th>Component</Th>
                <Th>Linked record</Th>
                <Th>Status</Th>
                <Th>Owner</Th>
                <Th>Waiting on</Th>
                <Th align="right">Days pending</Th>
              </tr>
            </thead>
            <tbody>
              {model.ordered.map((l) => {
                const st = componentState(l);
                const up = model.parent.get(l.id);
                const isB = l.id === bottleneckId;
                return (
                  <tr key={l.id} className={isB ? 'bg-critical-soft/30' : undefined}>
                    <Td className="whitespace-nowrap font-semibold text-ink-2">{l.departmentName || '—'}</Td>
                    <Td className="min-w-48">
                      <span className="font-semibold text-ink">{l.label}</span>
                      {isB && (
                        <Badge tone="critical" className="ml-1.5 align-middle">
                          Bottleneck
                        </Badge>
                      )}
                      <span className="mt-0.5 block text-xs text-ink-3">{capitalise(l.detail)}</span>
                    </Td>
                    <Td className="min-w-48">
                      {l.refLink ? (
                        <Link to={l.refLink} className="text-accent hover:underline">
                          {l.refTitle}
                        </Link>
                      ) : (
                        <span className="text-ink-3">Record not found</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.word}</Badge>
                      <span className="mt-1 block whitespace-nowrap text-xs text-ink-2">{l.statusLabel}</span>
                    </Td>
                    <Td className="min-w-44">
                      <OfficerChip name={l.ownerName} designation={l.ownerDesignation} />
                    </Td>
                    <Td className="min-w-36">
                      {l.waiting && up ? (
                        <span className="text-warn">{up.label}</span>
                      ) : up ? (
                        <span className="text-ink-3">
                          Prerequisite done
                          <span className="sr-only">: {up.label}</span>
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                    <Td align="right">{l.done ? <span className="text-ink-3">—</span> : `${num(l.days)} d`}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
            Days pending: files — days at the current desk; works — days past target or without a progress update; findings — days since the finding was raised.
          </p>
        </>
      )}
    </Card>
  );
}
