import { CalendarPlus, ClipboardCheck, ExternalLink, MapPin, Network, RotateCcw, ShieldCheck, Upload, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ProcOutput } from '../../core/rpc';
import { CONDITION_LABEL, type FindingStatus } from '../../core/types';
import { daysBetween } from '../../core/time';
import { conditionTone, fmtDate, relDays, severityTone, today } from '../lib/format';
import { useMe, useQ } from '../lib/hooks';
import { EvidenceList } from '../components/evidence';
import {
  Badge, Button, Card, CardHeader, DL, EmptyState, ErrorState, LinkButton, NextAction, OfficerChip, PageHeader, SkeletonPage, Table, Td, Th, cx,
} from '../components/ui';
import { AssignModal, RecordInspectionModal, ScheduleInspectionModal, SubmitResolutionModal, VerifyModal, type FindingView } from '../components/assets/modals';
import { FindingStepper, SEVERITY_LABEL, WorkflowSummary, functionalTone } from '../components/assets/workflow';

type AssetData = ProcOutput<'assets.get'>;
type ModalState = { kind: 'assign' | 'submit' | 'verify'; finding: FindingView } | { kind: 'record'; inspectionId?: number } | { kind: 'schedule' } | null;

const humanize = (k: string) => {
  const s = k.replace(/_/g, ' ').replace(/\bft\b/i, '(ft)').replace(/\bmdm\b/i, 'Mid-day meal');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function AssetDetail() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const valid = Number.isInteger(id) && id > 0;
  const [sp] = useSearchParams();
  const focusId = Number(sp.get('finding')) || null;
  const me = useMe();
  const q = useQ('assets.get', { id: valid ? id : 1 }, { enabled: valid, placeholderData: undefined });
  const [modal, setModal] = useState<ModalState>(null);
  const [showClosed, setShowClosed] = useState(false);
  const scrolledFor = useRef<number | null>(null);
  const closeModal = useCallback(() => setModal(null), []);

  // Deep link: /assets/:id?finding=<id> scrolls to and highlights that finding.
  useEffect(() => {
    if (!focusId || !q.data || scrolledFor.current === focusId) return;
    const f = q.data.findings.find((x) => x.id === focusId);
    if (!f) return;
    scrolledFor.current = focusId;
    if (f.status === 'closed') setShowClosed(true);
    const t = setTimeout(() => document.getElementById(`finding-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => clearTimeout(t);
  }, [focusId, q.data]);

  if (!valid) return <ErrorState error={{ message: 'This asset link is not valid.' }} />;
  if (q.isLoading) return <SkeletonPage />;
  if (q.error || !q.data)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Asset" crumbs={[{ label: 'Assets', to: '/assets' }, { label: 'Not available' }]} />
        <ErrorState error={q.error} onRetry={q.error && q.error.status !== 403 && q.error.status !== 404 ? () => q.refetch() : undefined} />
        <div>
          <LinkButton to="/assets">Back to asset register</LinkButton>
        </div>
      </div>
    );

  const d = q.data;
  const a = d.asset;
  const scheduledRecordable = d.inspections.filter((i) => i.status === 'scheduled' && i.canRecord).sort((x, y) => x.scheduled_date.localeCompare(y.scheduled_date));

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Assets', to: '/assets' }, { label: a.code }]}
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="font-mono text-ink-2">{a.code}</span>
            <span aria-hidden>·</span>
            <span>{a.typeLabel}</span>
            <span aria-hidden>·</span>
            <span>{[a.blockName, a.village].filter(Boolean).join(' / ')}</span>
            <Badge tone={conditionTone(a.condition)}>Condition: {a.conditionLabel}</Badge>
            <Badge tone={functionalTone(a.functional_status)}>{a.functionalLabel}</Badge>
            {a.inspectionOverdueBy > 0 && <Badge tone="bad">Inspection overdue {a.inspectionOverdueBy} d</Badge>}
          </span>
        }
        actions={
          <>
            {d.can.schedule && (
              <Button icon={<CalendarPlus className="size-4" />} onClick={() => setModal({ kind: 'schedule' })}>
                Schedule inspection
              </Button>
            )}
            {d.can.inspect && (
              <Button variant="primary" icon={<ClipboardCheck className="size-4" />} onClick={() => setModal({ kind: 'record' })}>
                Record inspection
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <FindingsSection data={d} focusId={focusId} meId={me.data?.id ?? null} showClosed={showClosed} setShowClosed={setShowClosed} setModal={setModal} />
          <InspectionsSection data={d} canInspect={d.can.inspect} onRecord={(inspectionId) => setModal({ kind: 'record', inspectionId })} />
        </div>
        <aside className="flex min-w-0 flex-col gap-5">
          <AssetDetailsCard data={d} />
          <Card>
            <CardHeader title="Inter-department initiatives" subtitle="Coordinated efforts this asset or its findings belong to" />
            <div className="px-4 py-3">
              {d.initiatives.length ? (
                <ul className="flex flex-col gap-2">
                  {d.initiatives.map((i) => (
                    <li key={i.id}>
                      <Link to={`/dependencies?id=${i.id}`} className="inline-flex items-start gap-2 text-sm font-semibold text-accent hover:underline">
                        <Network className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {i.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-3">Not linked to any inter-department initiative.</p>
              )}
            </div>
          </Card>
        </aside>
      </div>

      {modal?.kind === 'assign' && <AssignModal finding={modal.finding} assignees={d.assignees} assetDepartmentId={a.department_id} onClose={closeModal} />}
      {modal?.kind === 'submit' && <SubmitResolutionModal finding={modal.finding} onClose={closeModal} />}
      {modal?.kind === 'verify' && <VerifyModal finding={modal.finding} onClose={closeModal} />}
      {modal?.kind === 'record' && (
        <RecordInspectionModal assetId={a.id} assetName={`${a.name} (${a.code})`} scheduled={scheduledRecordable} defaultInspectionId={modal.inspectionId} onClose={closeModal} />
      )}
      {modal?.kind === 'schedule' && (
        <ScheduleInspectionModal assetId={a.id} assignees={d.assignees} defaultInspectorId={a.officer_id} defaultDate={a.next_inspection_due} onClose={closeModal} />
      )}
    </div>
  );
}

// ---------------- findings ----------------
function FindingsSection({
  data, focusId, meId, showClosed, setShowClosed, setModal,
}: { data: AssetData; focusId: number | null; meId: number | null; showClosed: boolean; setShowClosed: (v: boolean) => void; setModal: (m: ModalState) => void }) {
  const open = data.findings.filter((f) => f.status !== 'closed');
  const closed = data.findings.filter((f) => f.status === 'closed');
  const counts = useMemo(() => {
    const c: Record<FindingStatus, number> = { open: 0, assigned: 0, resolution_submitted: 0, closed: 0 };
    for (const f of data.findings) c[f.status]++;
    return c;
  }, [data.findings]);
  const lastInspected = data.asset.last_inspected ? fmtDate(data.asset.last_inspected) : 'Not yet';

  return (
    <Card>
      <CardHeader
        title="Findings & corrective action"
        subtitle="Inspection → finding → action assigned → evidence submitted → verified & closed. A finding closes only when a second officer accepts the evidence."
      />
      <div className="border-b border-line bg-subtle/50 px-4 py-3">
        <WorkflowSummary counts={counts} lastInspected={lastInspected} />
      </div>
      <div className="flex flex-col divide-y divide-line">
        {open.length === 0 ? (
          <EmptyState title={closed.length ? 'No open findings' : 'No findings recorded'} icon={<ShieldCheck className="size-8" aria-hidden />}>
            {closed.length
              ? 'Every finding on this asset has been verified and closed.'
              : 'Findings are created when an inspection records a defect. Use “Record inspection” after a site visit.'}
          </EmptyState>
        ) : (
          open.map((f) => <FindingCard key={f.id} f={f} data={data} highlight={f.id === focusId} meId={meId} setModal={setModal} />)
        )}
        {closed.length > 0 && (
          <details open={showClosed} onToggle={(e) => setShowClosed(e.currentTarget.open)}>
            <summary className="flex min-h-11 items-center px-4 text-sm font-semibold text-ink-2 hover:bg-subtle">Closed findings ({closed.length})</summary>
            <div className="flex flex-col divide-y divide-line border-t border-line">
              {closed.map((f) => (
                <FindingCard key={f.id} f={f} data={data} highlight={f.id === focusId} meId={meId} setModal={setModal} />
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

function FindingCard({ f, data, highlight, meId, setModal }: { f: FindingView; data: AssetData; highlight: boolean; meId: number | null; setModal: (m: ModalState) => void }) {
  const pending = f.evidence.find((e) => e.review_status === 'pending');
  const selfUploaded = f.status === 'resolution_submitted' && !!pending && meId !== null && pending.uploaded_by === meId;
  const isClosed = f.status === 'closed';
  const primaryFor = (s: FindingStatus) => (f.status === s ? 'primary' : 'secondary');

  const meta: [ReactNode, ReactNode][] = [
    ['Category', f.category],
    ['Responsible department', f.responsibleDepartment ?? data.asset.departmentName],
    ['Age', isClosed ? `${f.ageDays} d to closure` : `${f.ageDays} d open`],
    [
      'Due date',
      f.due_date ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {fmtDate(f.due_date)}
          {f.overdueBy > 0 && <Badge tone="bad">Overdue {f.overdueBy} d</Badge>}
        </span>
      ) : (
        <span className="text-ink-3">Not set</span>
      ),
    ],
    ['Assigned to', <OfficerChip key="a" name={f.assigneeName} designation={f.assigneeDesignation} />],
  ];

  return (
    <article
      id={`finding-${f.id}`}
      aria-labelledby={`finding-title-${f.id}`}
      className={cx('scroll-mt-20 p-4 transition-colors', highlight && 'bg-accent-soft/40 ring-2 ring-inset ring-accent/40', isClosed && !highlight && 'bg-subtle/40')}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={isClosed ? 'muted' : severityTone(f.severity)}>{SEVERITY_LABEL[f.severity]} severity</Badge>
        <Badge tone={f.tone}>{f.statusLabel}</Badge>
        {highlight && <span className="text-xs font-semibold text-accent">Linked finding</span>}
      </div>
      <h3 id={`finding-title-${f.id}`} className="mt-2 text-[15px] font-bold leading-snug text-ink">
        {f.title}
      </h3>
      {f.description && <p className="mt-1 text-sm text-ink-2">{f.description}</p>}

      <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {meta.map(([k, v], i) => (
          <div key={i} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{k}</dt>
            <dd className="mt-0.5 text-[13px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <FindingStepper status={f.status} />
      </div>

      {f.reopen_count > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
          <RotateCcw className="mt-0.5 size-4 shrink-0" aria-hidden />
          Evidence rejected {f.reopen_count} time{f.reopen_count === 1 ? '' : 's'} — finding reopened for rework.
        </p>
      )}

      {isClosed ? (
        <p className="mt-3 text-[13px] text-ink-2">
          Verified and closed on <span className="font-semibold">{fmtDate(f.closed_at)}</span>.
        </p>
      ) : (
        <div className="mt-3">
          <NextAction
            text={f.nextAction}
            due={f.due_date ? fmtDate(f.due_date) : null}
            owner={f.assigneeName && f.status !== 'open' ? <OfficerChip name={f.assigneeName} designation={f.assigneeDesignation} compact /> : undefined}
          />
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-3">Evidence of resolution</h4>
        <EvidenceList items={f.evidence} />
      </div>

      {(f.can.assign || f.can.submit || f.can.verify) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          {f.can.verify && (
            <Button variant={primaryFor('resolution_submitted')} icon={<ShieldCheck className="size-4" />} onClick={() => setModal({ kind: 'verify', finding: f })}>
              Verify evidence
            </Button>
          )}
          {f.can.submit && (
            <Button variant={primaryFor('assigned')} icon={<Upload className="size-4" />} onClick={() => setModal({ kind: 'submit', finding: f })}>
              Submit resolution evidence
            </Button>
          )}
          {f.can.assign && (
            <Button variant={primaryFor('open')} icon={<UserPlus className="size-4" />} onClick={() => setModal({ kind: 'assign', finding: f })}>
              {f.status === 'open' ? 'Assign corrective action' : 'Reassign'}
            </Button>
          )}
        </div>
      )}
      {selfUploaded && (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          Separation of duties: you uploaded this evidence, so another supervising officer (department head, BDO, DDC or DM) must verify it.
        </p>
      )}
    </article>
  );
}

// ---------------- inspections ----------------
function InspectionsSection({ data, canInspect, onRecord }: { data: AssetData; canInspect: boolean; onRecord: (inspectionId: number) => void }) {
  const t = today();
  const upcoming = data.inspections.filter((i) => i.status === 'scheduled').sort((x, y) => x.scheduled_date.localeCompare(y.scheduled_date));
  const history = data.inspections.filter((i) => i.status !== 'scheduled');
  const raised = (inspectionId: number) => data.findings.filter((f) => f.inspection_id === inspectionId).length;

  return (
    <Card>
      <CardHeader title="Inspections" subtitle={`Inspection cycle: every ${data.asset.inspection_cycle_days} days. Recording an inspection schedules the next one automatically.`} />
      <div className="px-4 pt-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">Upcoming / scheduled</h3>
      </div>
      {upcoming.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-ink-3">No inspection is scheduled.{data.can.schedule ? ' Use “Schedule inspection” to plan the next visit.' : ''}</p>
      ) : (
        <ul className="divide-y divide-line">
          {upcoming.map((i) => {
            const overdueBy = Math.max(0, daysBetween(i.scheduled_date, t));
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-28">
                    <div className="tabular text-sm font-semibold text-ink">{fmtDate(i.scheduled_date)}</div>
                    <div className="text-xs text-ink-3">{relDays(i.scheduled_date)}</div>
                  </div>
                  <OfficerChip name={i.inspectorName} designation={i.inspectorDesignation} />
                  {i.overdue ? <Badge tone="bad">Overdue {overdueBy} d</Badge> : <Badge tone="info">Scheduled</Badge>}
                </div>
                {canInspect && i.canRecord && (
                  <Button size="sm" variant={i.overdue ? 'primary' : 'secondary'} icon={<ClipboardCheck className="size-4" />} onClick={() => onRecord(i.id)}>
                    Record result
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-line px-4 pt-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">Inspection history</h3>
      </div>
      {history.length === 0 ? (
        <EmptyState title="No inspections recorded yet" />
      ) : (
        <Table caption="Inspection history" className="mt-2">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Inspector</Th>
              <Th>Condition found</Th>
              <Th align="right">Findings</Th>
              <Th>Remarks</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((i) => (
              <tr key={i.id}>
                <Td className="whitespace-nowrap">
                  <div className="tabular font-semibold">{fmtDate(i.conducted_date ?? i.scheduled_date)}</div>
                  {i.status === 'missed' && <div className="text-xs text-ink-3">Scheduled visit</div>}
                </Td>
                <Td className="min-w-44">
                  <OfficerChip name={i.inspectorName} designation={i.inspectorDesignation} />
                </Td>
                <Td>
                  {i.status === 'missed' ? (
                    <Badge tone="bad">Missed</Badge>
                  ) : i.condition_found ? (
                    <Badge tone={conditionTone(i.condition_found)}>{CONDITION_LABEL[i.condition_found]}</Badge>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
                <Td align="right">{raised(i.id) || <span className="text-ink-3">0</span>}</Td>
                <Td className="min-w-64 text-ink-2">{i.remarks ?? <span className="text-ink-3">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------- asset details ----------------
function AssetDetailsCard({ data }: { data: AssetData }) {
  const a = data.asset;
  const details = Object.entries(a.details);
  const items: [ReactNode, ReactNode][] = [
    ['Type', a.typeLabel],
    ['Department', a.departmentName],
    ['Block / panchayat / village', [a.blockName, a.panchayat ? `${a.panchayat} GP` : null, a.village].filter(Boolean).join(' · ') || '—'],
    ['Responsible officer', <OfficerChip key="o" name={a.officerName} designation={a.officerDesignation} phone={a.officerPhone} />],
    ['Inspection cycle', `Every ${a.inspection_cycle_days} days`],
    [
      'Last inspected',
      a.last_inspected ? (
        <span>
          {fmtDate(a.last_inspected)} <span className="text-ink-3">({relDays(a.last_inspected)})</span>
        </span>
      ) : (
        'Never'
      ),
    ],
    [
      'Next inspection due',
      a.next_inspection_due ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {fmtDate(a.next_inspection_due)}
          {a.inspectionOverdueBy > 0 ? <Badge tone="bad">Overdue {a.inspectionOverdueBy} d</Badge> : <span className="text-ink-3">({relDays(a.next_inspection_due)})</span>}
        </span>
      ) : (
        'Not scheduled'
      ),
    ],
  ];
  if (a.lat !== null && a.lng !== null)
    items.push([
      'Coordinates',
      <span key="c" className="inline-flex flex-wrap items-center gap-x-2">
        <span className="tabular inline-flex items-center gap-1">
          <MapPin className="size-3.5 text-ink-3" aria-hidden />
          {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
        </span>
        <a
          href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
        >
          Map <ExternalLink className="size-3" aria-hidden />
        </a>
      </span>,
    ]);

  return (
    <Card>
      <CardHeader title="Asset details" />
      <div className="px-4 py-4">
        <DL cols={1} items={items} />
        {details.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-3">Facility particulars</h3>
            <dl className="divide-y divide-line border-y border-line">
              {details.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[13px]">
                  <dt className="text-ink-3">{humanize(k)}</dt>
                  <dd className="tabular text-right font-semibold text-ink">{typeof v === 'number' ? v.toLocaleString('en-IN') : v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Card>
  );
}
