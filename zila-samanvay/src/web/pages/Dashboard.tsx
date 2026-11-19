// District executive command view (DM / DDC). One screen answers: what is slipping, where,
// with which department, and what goes on the next review meeting's agenda. Every number
// links into the drill-down so the officer and next action are always two clicks away.

import {
  Activity, ArrowRight, Building2, ClipboardCheck, FileStack, Grid3x3, HardHat, Layers, ListOrdered, Network, Target,
} from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProcOutput } from '../../core/rpc';
import { RULES } from '../../core/rules';
import { AGENDA_CATEGORY_LABEL, type Tone } from '../../core/types';
import { BlockDeptHeatmap } from '../components/executive/Heatmap';
import { BAND_LABEL, INITIATIVE_STATUS, daysLeftLabel, drillHref } from '../components/executive/shared';
import {
  Badge, Card, CardHeader, EmptyState, ErrorState, Kpi, LinkButton, PageHeader, Progress, SkeletonPage, Table, Td, Th, cx,
} from '../components/ui';
import { bandTone, fmtDate, fmtDateTime, lakh, num, pct, ratioTone, TONE } from '../lib/format';
import { useMe, useQ } from '../lib/hooks';

type Summary = ProcOutput<'dashboard.summary'>;

export default function Dashboard() {
  const me = useMe();
  const q = useQ('dashboard.summary', {});
  const s = q.data;

  const header = (
    <PageHeader
      title="District dashboard"
      hindi="ज़िला डैशबोर्ड"
      subtitle={
        s ? (
          <>
            As of {fmtDate(s.asOf)} · {me.data?.jurisdiction ?? 'Your jurisdiction'} · every figure opens the drill-down to the responsible officer and next action.
          </>
        ) : (
          'District summary of public works, scheme delivery, file movement and asset condition.'
        )
      }
      actions={
        <>
          <LinkButton to="/review" variant="primary" icon={<ListOrdered className="size-4" aria-hidden />}>
            Open review agenda
          </LinkButton>
          <LinkButton to="/drill" icon={<Layers className="size-4" aria-hidden />}>
            Drill-down
          </LinkButton>
        </>
      }
    />
  );

  if (q.isLoading) {
    return (
      <>
        {header}
        <SkeletonPage />
      </>
    );
  }
  if (q.error || !s) {
    return (
      <>
        {header}
        <ErrorState error={q.error ?? { message: 'The dashboard could not be loaded.' }} onRetry={() => q.refetch()} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <WorksGroup s={s} />
        <SchemesGroup s={s} />
        <FilesGroup s={s} />
        <AssetsGroup s={s} />
      </div>

      <ReviewFollowUp s={s} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-3">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Grid3x3 className="size-4 text-ink-3" aria-hidden /> Where the problems are — block × department
              </span>
            }
            subtitle="Open issues per cell. Select a cell to see each item, its responsible officer and next action."
          />
          <div className="p-3 sm:p-4">
            <BlockDeptHeatmap heat={s.heatmap} />
          </div>
        </Card>
        <AgendaPreview s={s} />
      </div>

      <BlockTable s={s} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Initiatives s={s} />
        <RecentActivity s={s} own={me.data?.role !== 'dm' && me.data?.role !== 'ddc'} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- KPI groups

function KpiGroup({ title, icon, children, footer }: { title: string; icon: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-ink-3" aria-hidden>
          {icon}
        </span>
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-2">{title}</h2>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line">{children}</div>
      {footer && <div className="flex flex-col gap-3 px-4 py-3">{footer}</div>}
    </Card>
  );
}

function Meter({ label, value, display, sub, tone = 'info' }: { label: string; value: number; display: string; sub?: ReactNode; tone?: Tone }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-ink-3">{label}</span>
        <span className={cx('tabular font-bold', TONE[tone].text)}>{display}</span>
      </div>
      <Progress value={value} tone={tone} label={label} className="mt-1" />
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tabular text-sm font-bold text-ink">{value}</dd>
    </div>
  );
}

function WorksGroup({ s }: { s: Summary }) {
  const w = s.works;
  return (
    <KpiGroup
      title="Public works"
      icon={<HardHat className="size-4" />}
      footer={
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Sanctioned" value={lakh(w.sanctionedLakh, { crore: true })} />
            <Stat label="Spent" value={lakh(w.expenditureLakh, { crore: true })} />
          </dl>
          <Meter label="Financial progress" value={w.financialPct} display={pct(w.financialPct, 1)} sub="Expenditure as share of sanctioned cost" tone="info" />
          <Meter label="Average physical progress" value={w.avgPhysical} display={pct(w.avgPhysical)} sub={`Across ${num(w.active)} works not yet completed`} tone="info" />
        </>
      }
    >
      <Kpi plain
        label="Delayed / stalled"
        value={num(w.delayed)}
        tone={w.delayed ? 'bad' : 'ok'}
        sub={`${num(w.stalled)} stalled · of ${num(w.active)} active`}
        to={drillHref('works_delayed')}
        hint="Drill down"
      />
      <Kpi plain
        label="In execution"
        value={num(w.active)}
        sub={`${num(w.completed)} completed · ${num(w.notStarted)} not started`}
        to={drillHref('works_active')}
        hint="Drill down"
      />
    </KpiGroup>
  );
}

function SchemesGroup({ s }: { s: Summary }) {
  const sc = s.schemes;
  const ratio = sc.avgRatio / 100;
  return (
    <KpiGroup
      title="Schemes & services"
      icon={<Target className="size-4" />}
      footer={
        <>
          <Meter
            label="Average achievement vs pro-rata target"
            value={sc.avgRatio}
            display={pct(sc.avgRatio)}
            tone={ratioTone(ratio)}
            sub={`Service gap below ${Math.round(RULES.gapRatio * 100)}% of the target expected by today; watch below ${Math.round(RULES.watchRatio * 100)}%.`}
          />
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Schemes tracked" value={num(sc.tracked)} />
            <Stat label="Scheme–block pairs" value={num(sc.pairs)} />
          </dl>
        </>
      }
    >
      <Kpi plain
        label="Service gaps"
        value={num(sc.gaps)}
        tone={sc.gaps ? 'bad' : 'ok'}
        sub={`Block-level, of ${num(sc.pairs)} pairs`}
        to={drillHref('scheme_gaps')}
        hint="Drill down"
      />
      <Kpi plain label="On watch" value={num(sc.watch)} tone={sc.watch ? 'warn' : 'ok'} sub="Close to the gap line" to="/schemes" hint="Schemes" />
    </KpiGroup>
  );
}

function FilesGroup({ s }: { s: Summary }) {
  const f = s.files;
  return (
    <KpiGroup
      title="File movement"
      icon={<FileStack className="size-4" />}
      footer={
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Average days at current desk" value={`${num(f.avgDaysAtDesk)} d`} />
          <Stat label="Oldest pending file" value={`${num(f.oldestDays)} d at desk`} />
          <Stat label="Query raised" value={num(f.query)} />
          <Stat label="Over 2× SLA" value={<span className={f.critical ? 'text-critical' : undefined}>{num(f.critical)}</span>} />
        </dl>
      }
    >
      <Kpi plain label="Pending decision" value={num(f.pending)} sub={`${num(f.query)} awaiting query reply`} to={drillHref('files_pending')} hint="Drill down" />
      <Kpi plain
        label="Beyond SLA"
        value={num(f.beyondSla)}
        tone={f.beyondSla ? 'bad' : 'ok'}
        sub={`${f.pending ? pct((f.beyondSla / f.pending) * 100) : '0%'} of pending files`}
        to={drillHref('files_beyond_sla')}
        hint="Drill down"
      />
    </KpiGroup>
  );
}

function AssetsGroup({ s }: { s: Summary }) {
  const a = s.assets;
  const total = Math.max(1, a.good + a.needsRepair + a.critical);
  const split: { label: string; n: number; cls: string }[] = [
    { label: 'Good', n: a.good, cls: 'bg-ok' },
    { label: 'Needs repair', n: a.needsRepair, cls: 'bg-warn' },
    { label: 'Critical', n: a.critical, cls: 'bg-critical' },
  ];
  return (
    <KpiGroup
      title="Asset health"
      icon={<Building2 className="size-4" />}
      footer={
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="text-ink-3">Condition of {num(a.total)} assets</span>
            </div>
            <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-subtle" role="img" aria-label={split.map((x) => `${x.label} ${x.n}`).join(', ')}>
              {split.map((x) => (x.n ? <div key={x.label} className={cx('h-full', x.cls)} style={{ width: `${(x.n / total) * 100}%` }} /> : null))}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
              {split.map((x) => (
                <li key={x.label} className="inline-flex items-center gap-1">
                  <span className={cx('size-2 rounded-full', x.cls)} aria-hidden />
                  {x.label} <b className="tabular text-ink-2">{num(x.n)}</b>
                </li>
              ))}
            </ul>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Open findings (all)" value={num(a.openFindings)} />
            <Stat label="Evidence awaiting verification" value={num(a.awaitingVerification)} />
          </dl>
        </>
      }
    >
      <Kpi plain
        label="Critical assets"
        value={num(a.critical)}
        tone={a.critical ? 'critical' : 'ok'}
        sub={`${num(a.criticalFindings)} critical findings open`}
        to={drillHref('assets_critical')}
        hint="Drill down"
      />
      <Kpi plain
        label="Inspections overdue"
        value={num(a.inspectionsOverdue)}
        tone={a.inspectionsOverdue ? 'warn' : 'ok'}
        sub="Past the inspection cycle"
        to={drillHref('inspections_overdue')}
        hint="Drill down"
      />
      <div className="col-span-2">
        <Link
          to={drillHref('findings_open')}
          className="flex items-center justify-between gap-2 bg-panel px-4 py-2.5 text-[13px] transition-colors hover:bg-accent-soft/40"
        >
          <span className="text-ink-2">Open high / critical findings</span>
          <span className="inline-flex items-center gap-1 font-semibold text-accent">
            Drill down <ArrowRight className="size-3.5" aria-hidden />
          </span>
        </Link>
      </div>
    </KpiGroup>
  );
}

function ReviewFollowUp({ s }: { s: Summary }) {
  const a = s.actions;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-ink-2">
          <ClipboardCheck className="size-4 text-ink-3" aria-hidden /> Review follow-up
        </h2>
        <Link to="/review" className="text-xs font-semibold text-accent hover:underline">
          Action register →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
        <Kpi plain label="Open actions" value={num(a.open)} sub="Decisions not yet closed" to="/review?tab=actions&status=open" />
        <Kpi plain label="Overdue" value={num(a.overdue)} tone={a.overdue ? 'bad' : 'ok'} sub="Past the deadline set in review" to={drillHref('actions_overdue')} hint="Drill down" />
        <Kpi plain label="Evidence submitted" value={num(a.submitted)} tone={a.submitted ? 'warn' : undefined} sub="Awaiting verification" to="/review?tab=actions&status=submitted" />
        <Kpi plain label="Closed this month" value={num(a.closedThisMonth)} tone="ok" sub="Verified with evidence" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- agenda

function AgendaPreview({ s }: { s: Summary }) {
  return (
    <Card className="flex min-w-0 flex-col xl:col-span-2">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ListOrdered className="size-4 text-ink-3" aria-hidden /> Top items for the next review meeting
          </span>
        }
        subtitle="Ranked by the priority engine; each item says why it was flagged."
      />
      {s.agendaPreview.length === 0 ? (
        <EmptyState title="Nothing needs escalation right now">No work, file, finding or service gap crosses the review thresholds.</EmptyState>
      ) : (
        <ol className="divide-y divide-line">
          {s.agendaPreview.map((it, i) => {
            const place = [it.blockName ?? 'District level', it.departmentNames.join(', ')].filter(Boolean).join(' · ');
            return (
              <li key={it.key} className="flex gap-3 px-4 py-3">
                <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-[13px] font-bold text-ink-2" aria-label={`Rank ${i + 1}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={bandTone(it.band)}>
                      {BAND_LABEL[it.band] ?? it.band} · score {it.score}
                    </Badge>
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">{AGENDA_CATEGORY_LABEL[it.category]}</span>
                  </div>
                  <Link to={it.link} className="mt-1 block font-semibold leading-snug text-ink hover:text-accent hover:underline">
                    {it.title}
                  </Link>
                  {place && <p className="mt-0.5 text-xs text-ink-3">{place}</p>}
                  {it.reasons.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-2" aria-label="Why flagged">
                      {it.reasons.map((r) => (
                        <li key={r} className="flex gap-1.5">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-auto border-t border-line px-4 py-3">
        <Link to="/review" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
          See all {num(s.agendaTotal)} agenda items <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- block table

function NumLink({ n, to, tone, label }: { n: number; to: string; tone: Tone; label: string }) {
  if (!n) return <span className="text-ink-3">0</span>;
  return (
    <Link to={to} onClick={(e: MouseEvent) => e.stopPropagation()} aria-label={label} className={cx('tabular font-bold hover:underline', TONE[tone].text)}>
      {num(n)}
    </Link>
  );
}

function BlockTable({ s }: { s: Summary }) {
  const nav = useNavigate();
  const rows = s.blockTable;
  const t = rows.reduce(
    (acc, r) => ({
      works: acc.works + r.works,
      delayed: acc.delayed + r.delayedWorks,
      physSum: acc.physSum + r.avgPhysical * r.works,
      gaps: acc.gaps + r.gaps,
      files: acc.files + r.filesBeyondSla,
      assets: acc.assets + r.criticalAssets,
      issues: acc.issues + r.issues,
      severe: acc.severe + r.severe,
    }),
    { works: 0, delayed: 0, physSum: 0, gaps: 0, files: 0, assets: 0, issues: 0, severe: 0 },
  );
  return (
    <Card>
      <CardHeader
        title="Block performance"
        subtitle="Select a block to drill into its delayed works; select a number to drill into that metric."
      />
      {rows.length === 0 ? (
        <EmptyState title="No blocks in your jurisdiction" />
      ) : (
        <Table caption="Block performance">
          <thead>
            <tr>
              <Th>Block</Th>
              <Th align="right">Works</Th>
              <Th align="right">Delayed</Th>
              <Th>Avg physical</Th>
              <Th align="right">Service gaps</Th>
              <Th align="right">Files beyond SLA</Th>
              <Th align="right">Critical assets</Th>
              <Th align="right">Issues (severe)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const to = drillHref('works_delayed', { block: r.blockId });
              return (
                <tr key={r.blockId} className="cursor-pointer hover:bg-subtle/60" onClick={() => nav(to)}>
                  <Td>
                    <Link to={to} onClick={(e: MouseEvent) => e.stopPropagation()} className="font-semibold text-ink hover:text-accent hover:underline">
                      {r.name}
                    </Link>
                    <span lang="hi" className="hi ml-1.5 text-xs text-ink-3">
                      {r.name_hi}
                    </span>
                  </Td>
                  <Td align="right">{num(r.works)}</Td>
                  <Td align="right">
                    <NumLink n={r.delayedWorks} to={to} tone="bad" label={`${r.name}: ${r.delayedWorks} delayed works`} />
                  </Td>
                  <Td>
                    <div className="flex min-w-28 items-center gap-2">
                      <Progress value={r.avgPhysical} tone="info" label={`${r.name} average physical progress`} className="w-16" />
                      <span className="tabular text-ink-2">{pct(r.avgPhysical)}</span>
                    </div>
                  </Td>
                  <Td align="right">
                    <NumLink n={r.gaps} to={drillHref('scheme_gaps', { block: r.blockId })} tone="bad" label={`${r.name}: ${r.gaps} service gaps`} />
                  </Td>
                  <Td align="right">
                    <NumLink n={r.filesBeyondSla} to={drillHref('files_beyond_sla', { block: r.blockId })} tone="bad" label={`${r.name}: ${r.filesBeyondSla} files beyond SLA`} />
                  </Td>
                  <Td align="right">
                    <NumLink n={r.criticalAssets} to={drillHref('assets_critical', { block: r.blockId })} tone="critical" label={`${r.name}: ${r.criticalAssets} critical assets`} />
                  </Td>
                  <Td align="right">
                    <span className="tabular font-bold text-ink">{num(r.issues)}</span>{' '}
                    <span className={cx('tabular text-xs', r.severe ? 'font-semibold text-bad' : 'text-ink-3')}>({num(r.severe)} severe)</span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-subtle/60 font-bold">
              <Td>All blocks</Td>
              <Td align="right">{num(t.works)}</Td>
              <Td align="right">{num(t.delayed)}</Td>
              <Td>
                <span className="tabular text-ink-2">{t.works ? pct(t.physSum / t.works) : '—'}</span>
              </Td>
              <Td align="right">{num(t.gaps)}</Td>
              <Td align="right">{num(t.files)}</Td>
              <Td align="right">{num(t.assets)}</Td>
              <Td align="right">
                {num(t.issues)} <span className="text-xs font-semibold text-ink-3">({num(t.severe)} severe)</span>
              </Td>
            </tr>
          </tfoot>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- initiatives & activity

function Initiatives({ s }: { s: Summary }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Network className="size-4 text-ink-3" aria-hidden /> Cross-department initiatives
          </span>
        }
        subtitle="Outcomes that need several offices to act, with the current bottleneck."
        actions={
          <Link to="/dependencies" className="text-xs font-semibold text-accent hover:underline">
            All dependencies →
          </Link>
        }
      />
      {s.initiatives.length === 0 ? (
        <EmptyState title="No cross-department initiatives in your jurisdiction" />
      ) : (
        <ul className="divide-y divide-line">
          {s.initiatives.map((ini) => {
            const st = INITIATIVE_STATUS[ini.status];
            const dl = daysLeftLabel(ini.daysLeft);
            return (
              <li key={ini.id}>
                <Link to={`/dependencies?id=${ini.id}`} className="block px-4 py-3 transition-colors hover:bg-subtle/60">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-semibold leading-snug text-ink">{ini.title}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-3">
                    <span>{ini.blockName ?? 'District level'}</span>
                    <span aria-hidden>·</span>
                    <span className={dl.tone === 'bad' ? 'font-semibold text-bad' : dl.tone === 'warn' ? 'font-semibold text-warn' : undefined}>{dl.text}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={ini.progress} tone={st.tone} label={`${ini.title}: components complete`} />
                    <span className="tabular shrink-0 text-xs font-semibold text-ink-2">{pct(ini.progress)} done</span>
                  </div>
                  {ini.pendingDepartments.length > 0 && (
                    <p className="mt-1.5 text-xs text-ink-3">
                      Pending with: <span className="text-ink-2">{ini.pendingDepartments.join(', ')}</span>
                    </p>
                  )}
                  {ini.bottleneck && (
                    <p className="mt-1 text-[13px] text-ink-2">
                      <span className="font-bold text-bad">Bottleneck:</span> {ini.bottleneck.label} — {ini.bottleneck.detail}
                      {ini.bottleneck.owner && <span className="text-ink-3"> · {ini.bottleneck.owner}</span>}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentActivity({ s, own }: { s: Summary; own: boolean }) {
  return (
    <Card className="min-w-0">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Activity className="size-4 text-ink-3" aria-hidden /> Recent activity
          </span>
        }
        subtitle={own ? 'Your latest recorded actions from the audit trail.' : 'Latest recorded actions across the district, from the audit trail.'}
      />
      {s.recent.length === 0 ? (
        <EmptyState title="No recent activity" />
      ) : (
        <ul className="divide-y divide-line">
          {s.recent.map((r) => (
            <li key={r.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-ink-3">
                <span className="font-semibold text-ink-2">{r.user_name}</span>
                <time dateTime={r.at} className="tabular">
                  {fmtDateTime(r.at)}
                </time>
              </div>
              <p className="mt-0.5 text-[13px] text-ink">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
