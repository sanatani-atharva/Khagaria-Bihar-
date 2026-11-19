import { CircleCheck, CircleDot, FileClock, Globe2, History, Network, Pencil, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProcOutput } from '../../core/rpc';
import { FILE_STATUS_LABEL, WORK_STATUS_LABEL, type FileStatus, type Tone, type WorkStatus } from '../../core/types';
import { EvidenceList } from '../components/evidence';
import { useToast } from '../components/toast';
import { WORK_STATUS_TONE, sourceLabel, toId } from '../components/works/shared';
import {
  Badge, Button, Card, CardHeader, DL, EmptyState, ErrorState, Field, Input, Modal, NextAction, OfficerChip, PageHeader, Progress, Select,
  SkeletonPage, Table, Td, Textarea, Th, cx,
} from '../components/ui';
import { fmtDate, fmtDateTime, lakh, pct, relDays, today } from '../lib/format';
import { useM, useQ } from '../lib/hooks';

type WorkGet = ProcOutput<'works.get'>;
type Work = WorkGet['work'];

const FILE_STATUS_TONE: Record<FileStatus, Tone> = { open: 'info', query: 'warn', approved: 'ok', closed: 'muted' };

export default function WorkDetail() {
  const { id: rawId } = useParams();
  const id = toId(rawId);
  const q = useQ('works.get', { id: id ?? 0 }, { enabled: id !== null, placeholderData: undefined });
  const [editOpen, setEditOpen] = useState(false);

  if (id === null) return <ErrorState error={{ message: 'This link does not point to a valid work.' }} />;
  if (q.isLoading) return <SkeletonPage />;
  if (q.error || !q.data)
    return (
      <>
        <PageHeader title="Work" crumbs={[{ label: 'Public works', to: '/works' }, { label: `#${id}` }]} />
        <ErrorState error={q.error ?? { message: 'Work not found.' }} onRetry={() => q.refetch()} />
      </>
    );

  const d = q.data;
  const w = d.work;
  const pendingFileId = w.pendingFile ? d.files.find((f) => f.file_no === w.pendingFile!.file_no)?.id : undefined;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Public works', to: '/works' }, { label: w.code }]}
        title={w.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular font-semibold text-ink-2">{w.code}</span>
            <span aria-hidden>·</span>
            <span>
              {w.blockName} block{w.panchayat ? `, ${w.panchayat}` : ''}
            </span>
            <span aria-hidden>·</span>
            <span>{w.departmentName}</span>
          </span>
        }
        actions={
          d.canEdit && (
            <Button variant="primary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditOpen(true)}>
              Update progress
            </Button>
          )
        }
      />

      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={WORK_STATUS_TONE[w.status]}>{w.statusLabel}</Badge>
        {w.health.label !== w.statusLabel && <Badge tone={w.health.tone}>{w.health.label}</Badge>}
        {w.public_approved ? (
          <Badge tone="ok">
            <Globe2 className="size-3" aria-hidden /> On public portal
          </Badge>
        ) : (
          <Badge tone="muted">Not on public portal</Badge>
        )}
        {!d.canEdit && <span className="text-xs text-ink-3">View only — outside the works you can update.</span>}
      </div>

      {/* What needs to happen next, and why this work is on the radar */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <NextAction
            text={w.next_action ?? (w.status === 'completed' ? 'Completed — record the completion certificate and close linked files.' : 'No next action recorded. Update progress to set one.')}
            due={w.next_action_due ? `${fmtDate(w.next_action_due)} (${relDays(w.next_action_due)})` : null}
            owner={<OfficerChip name={w.officerName} designation={w.officerDesignation} phone={w.officerPhone} />}
          />
          {w.pendingFile && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
              <FileClock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <span className="font-bold">Held up by file </span>
                <Link
                  to={pendingFileId ? `/files/${pendingFileId}` : `/files?q=${encodeURIComponent(w.pendingFile.file_no)}&status=all`}
                  className="font-bold underline hover:text-ink"
                >
                  {w.pendingFile.file_no}
                </Link>{' '}
                at {w.pendingFile.office} for {w.pendingFile.days} days — beyond its decision deadline.
              </p>
            </div>
          )}
        </div>
        <Card>
          <CardHeader title="Why this work is flagged" subtitle="Derived from the district rules, not typed in." />
          <div className="px-4 py-3">
            {w.health.reasons.length ? (
              <ul className="space-y-2">
                {w.health.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-sm text-ink">
                    <TriangleAlert className={cx('mt-0.5 size-4 shrink-0', w.health.tone === 'bad' ? 'text-bad' : 'text-warn')} aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-start gap-2 text-sm text-ok">
                <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                {w.status === 'completed' ? 'Completed — no open concerns.' : 'On track: progress is in line with the time-based expectation and reporting is current.'}
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <KeyFacts w={w} />
          <Milestones d={d} />
          <LinkedFiles files={d.files} />
          <ProgressHistory updates={d.updates} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <PublicPanel w={w} canApprove={d.canApprovePublic} />
          <Initiatives items={d.initiatives} />
          {d.evidence.length > 0 && (
            <Card>
              <CardHeader title="Site evidence" subtitle="Photos and documents attached to this work" />
              <div className="p-4">
                <EvidenceList items={d.evidence} />
              </div>
            </Card>
          )}
          <AuditHistory history={d.history} />
        </div>
      </div>

      {d.canEdit && <ProgressModal open={editOpen} onClose={() => setEditOpen(false)} w={w} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function KeyFacts({ w }: { w: Work }) {
  return (
    <Card>
      <CardHeader title="Key facts" />
      <div className="p-4">
        <DL
          items={[
            ['Scheme', w.scheme],
            ['Category', w.category],
            ['Department', w.departmentName],
            ['Block / panchayat', `${w.blockName}${w.panchayat ? ` / ${w.panchayat}` : ''}`],
            ['Executing agency', w.agency ?? 'Not recorded'],
            ['Sanctioned', <span className="tabular">{lakh(w.sanctioned_lakh)}</span>],
            [
              'Expenditure',
              <span className="tabular">
                {lakh(w.expenditure_lakh)} <span className="text-ink-3">({pct(w.financialPct, 1)} of sanction)</span>
              </span>,
            ],
            [
              'Physical progress',
              <div className="max-w-xs">
                <div className="mb-1 flex justify-between text-[13px]">
                  <span className="tabular font-bold">{pct(w.physical_pct)}</span>
                  {w.status !== 'completed' && <span className="tabular text-ink-3">{pct(w.health.expected)} expected by today</span>}
                </div>
                <Progress value={w.physical_pct} expected={w.status === 'completed' ? undefined : w.health.expected} tone={w.health.tone} label="Physical progress" />
              </div>,
            ],
            ['Start date', fmtDate(w.start_date)],
            [
              'Target date',
              <span>
                {fmtDate(w.target_date)}
                {w.health.overdueDays > 0 && <span className="ml-1 font-semibold text-bad">({w.health.overdueDays} d overdue)</span>}
              </span>,
            ],
            ['Data source', sourceLabel(w.source)],
            ['Last updated', `${fmtDateTime(w.updated_at)} (${relDays(w.updated_at)})`],
            ...(w.hold_reason && w.status !== 'completed' ? ([['Hold reason', w.hold_reason]] as [string, string][]) : []),
          ]}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Milestones({ d }: { d: WorkGet }) {
  const m = useM('works.milestone', { success: 'Milestone updated' });
  const busyId = m.isPending ? m.variables?.milestoneId : undefined;
  const done = d.milestones.filter((x) => x.state === 'done').length;
  return (
    <Card>
      <CardHeader title="Milestones" subtitle={d.milestones.length ? `${done} of ${d.milestones.length} complete` : undefined} />
      {d.milestones.length === 0 ? (
        <EmptyState title="No milestones defined for this work" />
      ) : (
        <ol className="px-4 py-2">
          {d.milestones.map((ms, i) => {
            const tone: Tone = ms.state === 'done' ? (ms.lateBy > 0 ? 'warn' : 'ok') : ms.state === 'overdue' ? 'bad' : 'muted';
            const label =
              ms.state === 'done'
                ? ms.lateBy > 0
                  ? `Done · ${ms.lateBy} d late`
                  : 'Done on time'
                : ms.state === 'overdue'
                  ? `Overdue by ${ms.lateBy} d`
                  : `Due ${relDays(ms.planned_date)}`;
            const last = i === d.milestones.length - 1;
            return (
              <li key={ms.id} className="relative flex gap-3 pb-4 last:pb-2">
                {!last && <span className="absolute left-[9px] top-6 h-[calc(100%-1rem)] w-px bg-line-2" aria-hidden />}
                <span className="relative mt-0.5 shrink-0">
                  {ms.state === 'done' ? (
                    <CircleCheck className="size-5 text-ok" aria-hidden />
                  ) : (
                    <CircleDot className={cx('size-5', ms.state === 'overdue' ? 'text-bad' : 'text-ink-3')} aria-hidden />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {ms.seq}. {ms.name}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      Planned {fmtDate(ms.planned_date)}
                      {ms.actual_date && <> · Actual {fmtDate(ms.actual_date)}</>}
                      {ms.weight ? <> · Weight {ms.weight}%</> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={tone}>{label}</Badge>
                    {d.canEdit &&
                      (ms.state === 'done' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Undo2 className="size-3.5" aria-hidden />}
                          loading={busyId === ms.id}
                          disabled={m.isPending}
                          onClick={() => m.mutate({ milestoneId: ms.id, actualDate: null })}
                        >
                          Undo
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          icon={<CircleCheck className="size-3.5" aria-hidden />}
                          loading={busyId === ms.id}
                          disabled={m.isPending}
                          onClick={() => m.mutate({ milestoneId: ms.id, actualDate: today() })}
                        >
                          Mark complete
                        </Button>
                      ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function LinkedFiles({ files }: { files: WorkGet['files'] }) {
  return (
    <Card>
      <CardHeader title="Linked files" subtitle="Approvals, sanctions and payments raised for this work" />
      {files.length === 0 ? (
        <EmptyState title="No files linked to this work" />
      ) : (
        <Table caption="Files linked to this work">
          <thead>
            <tr>
              <Th>File no.</Th>
              <Th>Subject</Th>
              <Th>Status</Th>
              <Th>With</Th>
              <Th>Ageing</Th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <Td className="whitespace-nowrap">
                  <Link to={`/files/${f.id}`} className="tabular font-semibold text-accent hover:underline">
                    {f.file_no}
                  </Link>
                </Td>
                <Td className="min-w-56">
                  <div className="text-ink">{f.subject}</div>
                  {f.status !== 'closed' && f.decision_required && <div className="text-xs text-ink-3">Decision: {f.decision_required}</div>}
                </Td>
                <Td>
                  <Badge tone={FILE_STATUS_TONE[f.status]}>{FILE_STATUS_LABEL[f.status]}</Badge>
                </Td>
                <Td className="min-w-40">
                  <div className="text-ink">{f.officeName}</div>
                  <div className="text-xs text-ink-3">{f.holderName ?? 'No holder'}</div>
                </Td>
                <Td className="whitespace-nowrap">
                  <Badge tone={f.aging.tone}>{f.aging.label}</Badge>
                  {f.status !== 'closed' && <div className="mt-1 text-xs text-ink-3">{f.aging.daysAtDesk} d at this desk</div>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Initiatives({ items }: { items: WorkGet['initiatives'] }) {
  return (
    <Card>
      <CardHeader title="Cross-department initiatives" subtitle="Outcomes this work contributes to" />
      {items.length === 0 ? (
        <EmptyState title="Not part of any inter-department initiative" icon={<Network className="size-7" aria-hidden />} />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={`${i.id}-${i.role}`} className="px-4 py-3">
              <Link to={`/dependencies?id=${i.id}`} className="text-sm font-semibold text-ink hover:text-accent hover:underline">
                {i.title}
              </Link>
              <div className="mt-0.5 text-xs text-ink-3">Role of this work: {i.role}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge tone={i.state.tone}>{i.state.done ? 'Done' : i.state.blocked ? 'Blocking' : i.state.waiting ? 'Waiting upstream' : 'In progress'}</Badge>
                <span className="text-xs text-ink-2">{i.state.statusLabel}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ProgressHistory({ updates }: { updates: WorkGet['updates'] }) {
  return (
    <Card>
      <CardHeader title="Progress history" subtitle="Every reported change of physical and financial progress" />
      {updates.length === 0 ? (
        <EmptyState title="No progress reported yet" />
      ) : (
        <Table caption="Progress updates">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th align="right">Physical</Th>
              <Th align="right">Expenditure</Th>
              <Th>Remark</Th>
              <Th>Reported by</Th>
            </tr>
          </thead>
          <tbody>
            {updates.map((u) => (
              <tr key={u.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(u.at)}</Td>
                <Td align="right">{pct(u.physical_pct)}</Td>
                <Td align="right" className="whitespace-nowrap">
                  {lakh(u.expenditure_lakh)}
                </Td>
                <Td className="min-w-52 text-ink-2">{u.remark ?? '—'}</Td>
                <Td className="whitespace-nowrap">
                  <div>{u.userName ?? '—'}</div>
                  <Badge tone={u.source === 'import' ? 'info' : 'muted'} className="mt-1">
                    {u.source === 'import' ? 'Sheet import' : 'Manual'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AuditHistory({ history }: { history: WorkGet['history'] }) {
  return (
    <Card>
      <CardHeader title="Audit history" subtitle="Who changed what, and when" />
      {history.length === 0 ? (
        <EmptyState title="No recorded actions yet" icon={<History className="size-7" aria-hidden />} />
      ) : (
        <ol className="divide-y divide-line">
          {history.map((h) => (
            <li key={h.id} className="px-4 py-2.5">
              <div className="text-[13px] text-ink">{h.summary}</div>
              <div className="mt-0.5 text-xs text-ink-3">
                {h.user_name} · {fmtDateTime(h.at)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function PublicPanel({ w, canApprove }: { w: Work; canApprove: boolean }) {
  const [summary, setSummary] = useState(w.public_summary ?? '');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const m = useM('works.setPublic');
  const publish = () => {
    const s = summary.trim();
    if (s.length < 10) return setErr('Write a short public summary (at least 10 characters) before publishing.');
    if (s.length > 400) return setErr('Keep the public summary within 400 characters.');
    setErr(null);
    m.mutate({ id: w.id, approved: true, summary: s }, { onSuccess: () => toast.show('Published to the citizen portal', 'ok') });
  };
  const withdraw = () => m.mutate({ id: w.id, approved: false }, { onSuccess: () => toast.show('Withdrawn from the citizen portal', 'ok') });
  const approved = !!w.public_approved;
  return (
    <Card>
      <CardHeader
        title="Public portal"
        subtitle="Only works approved by the DM or DDC appear on the citizen portal, with the summary below."
        actions={approved ? <Badge tone="ok">Published</Badge> : <Badge tone="muted">Not published</Badge>}
      />
      <div className="space-y-3 p-4">
        {approved && w.approved_at && <p className="text-xs text-ink-3">Approved {fmtDateTime(w.approved_at)}</p>}
        {!canApprove && (
          <p className="text-sm text-ink-2">{w.public_summary ? <>&ldquo;{w.public_summary}&rdquo;</> : 'No public summary written yet.'}</p>
        )}
        {canApprove && (
          <>
            <Field label="Public summary" required error={err} help={`${summary.trim().length}/400 · Plain language, no officer names or amounts in dispute.`}>
              {(fid) => (
                <Textarea
                  id={fid}
                  rows={4}
                  maxLength={400}
                  value={summary}
                  onChange={(e) => {
                    setSummary(e.target.value);
                    if (err) setErr(null);
                  }}
                  placeholder="e.g. PCC road connecting Raunia to the block HQ; 70% complete, expected by March 2027."
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" icon={<Globe2 className="size-4" aria-hidden />} loading={m.isPending && m.variables?.approved === true} disabled={m.isPending} onClick={publish}>
                {approved ? 'Update & keep published' : 'Publish'}
              </Button>
              {approved && (
                <Button variant="danger" loading={m.isPending && m.variables?.approved === false} disabled={m.isPending} onClick={withdraw}>
                  Withdraw
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

interface ProgressForm {
  physical: string;
  expenditure: string;
  status: WorkStatus;
  holdReason: string;
  nextAction: string;
  nextActionDue: string;
  remark: string;
}

function ProgressModal({ open, onClose, w }: { open: boolean; onClose: () => void; w: Work }) {
  const initial = (): ProgressForm => ({
    physical: String(w.physical_pct),
    expenditure: String(w.expenditure_lakh),
    status: w.status,
    holdReason: w.hold_reason ?? '',
    nextAction: w.next_action ?? '',
    nextActionDue: w.next_action_due ?? '',
    remark: '',
  });
  const [f, setF] = useState<ProgressForm>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ProgressForm, string>>>({});
  const m = useM('works.updateProgress', { success: (o) => `Progress saved — status: ${WORK_STATUS_LABEL[o.status]}` });

  // Prefill from the latest record every time the form opens.
  useEffect(() => {
    if (open) {
      setF(initial());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    if (!m.isPending) onClose();
  };
  const upd = <K extends keyof ProgressForm>(k: K, v: ProgressForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Floor, not round: the server rejects anything above exactly 125% of the sanction.
  const maxExp = Math.floor(w.sanctioned_lakh * 1.25 * 10) / 10;
  const physicalNum = Number(f.physical);
  const willComplete = f.physical !== '' && physicalNum >= 100;
  const showHold = f.status === 'stalled' || f.status === 'not_started';

  const validate = () => {
    const e: Partial<Record<keyof ProgressForm, string>> = {};
    const p = Number(f.physical);
    const x = Number(f.expenditure);
    if (f.physical.trim() === '' || !Number.isFinite(p)) e.physical = 'Enter physical progress as a number.';
    else if (p < 0 || p > 100) e.physical = 'Physical progress must be between 0 and 100.';
    if (f.expenditure.trim() === '' || !Number.isFinite(x)) e.expenditure = 'Enter expenditure in ₹ lakh.';
    else if (x < 0) e.expenditure = 'Expenditure cannot be negative.';
    else if (x > maxExp) e.expenditure = `Exceeds 125% of the sanctioned ${lakh(w.sanctioned_lakh)}. Record a revised sanction first.`;
    if (!willComplete && f.status === 'stalled' && !f.holdReason.trim()) e.holdReason = 'Give the reason the work is stalled.';
    if (f.nextActionDue && !/^\d{4}-\d{2}-\d{2}$/.test(f.nextActionDue)) e.nextActionDue = 'Use a valid date.';
    if (f.nextActionDue && !f.nextAction.trim()) e.nextAction = 'Describe the action due on this date.';
    if (f.remark.trim().length < 3) e.remark = 'Add a short remark on what changed (at least 3 characters).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    m.mutate(
      {
        id: w.id,
        physicalPct: Number(f.physical),
        expenditureLakh: Number(f.expenditure),
        status: f.status,
        holdReason: showHold && !willComplete ? f.holdReason.trim() || null : null,
        nextAction: f.nextAction.trim() || null,
        nextActionDue: f.nextActionDue || null,
        remark: f.remark.trim(),
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Update progress · ${w.code}`}
      side
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="work-progress-form" loading={m.isPending}>
            Save progress
          </Button>
        </>
      }
    >
      <form id="work-progress-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-3">
          Current: {pct(w.physical_pct)} physical, {lakh(w.expenditure_lakh)} spent of {lakh(w.sanctioned_lakh)} sanctioned. Expected by today: {pct(w.health.expected)}.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Physical progress (%)" required error={errors.physical} help={willComplete ? 'Saving at 100% marks the work Completed.' : physicalNum < w.physical_pct ? 'Lower than the last report — explain in the remark.' : undefined}>
            {(fid) => <Input id={fid} type="number" inputMode="decimal" min={0} max={100} step={1} value={f.physical} onChange={(e) => upd('physical', e.target.value)} aria-invalid={!!errors.physical} />}
          </Field>
          <Field label="Expenditure (₹ lakh)" required error={errors.expenditure} help={`Up to ${lakh(maxExp)} (125% of sanction)`}>
            {(fid) => <Input id={fid} type="number" inputMode="decimal" min={0} step={0.1} value={f.expenditure} onChange={(e) => upd('expenditure', e.target.value)} aria-invalid={!!errors.expenditure} />}
          </Field>
        </div>
        <Field label="Status" required help={willComplete ? 'Will be set to Completed automatically.' : undefined}>
          {(fid) => (
            <Select id={fid} value={f.status} onChange={(e) => upd('status', e.target.value as WorkStatus)} disabled={willComplete}>
              {(Object.keys(WORK_STATUS_LABEL) as WorkStatus[]).map((s) => (
                <option key={s} value={s}>
                  {WORK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {showHold && !willComplete && (
          <Field label={f.status === 'stalled' ? 'Reason work is stalled' : 'Reason work has not started'} required={f.status === 'stalled'} error={errors.holdReason}>
            {(fid) => (
              <Textarea
                id={fid}
                rows={2}
                maxLength={400}
                value={f.holdReason}
                onChange={(e) => upd('holdReason', e.target.value)}
                placeholder="e.g. Land dispute at chainage 0.8 km; NOC awaited from CO."
                aria-invalid={!!errors.holdReason}
              />
            )}
          </Field>
        )}
        <Field label="Next required action" error={errors.nextAction} help="What must happen next, and by whom.">
          {(fid) => <Textarea id={fid} rows={2} maxLength={400} value={f.nextAction} onChange={(e) => upd('nextAction', e.target.value)} placeholder="e.g. EE to release 2nd instalment after measurement book check." />}
        </Field>
        <Field label="Next action due" error={errors.nextActionDue}>
          {(fid) => <Input id={fid} type="date" value={f.nextActionDue} min={today()} onChange={(e) => upd('nextActionDue', e.target.value)} className="sm:max-w-56" />}
        </Field>
        <Field label="Remark" required error={errors.remark} help="Recorded in the progress history and audit trail.">
          {(fid) => (
            <Textarea
              id={fid}
              rows={3}
              maxLength={400}
              value={f.remark}
              onChange={(e) => upd('remark', e.target.value)}
              placeholder="e.g. Slab casting of 2nd floor completed; site visit by JE on 18-Nov."
              aria-invalid={!!errors.remark}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
