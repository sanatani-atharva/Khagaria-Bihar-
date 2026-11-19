// Dialogs for the asset inspection-to-closure workflow: assign corrective action, submit
// evidence of resolution, verify evidence, record an inspection and schedule an inspection.
// Each dialog is mounted only while open, so its form state starts fresh every time.

import { AlertTriangle, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { ProcOutput } from '../../../core/rpc';
import { CONDITION_LABEL, FUNCTIONAL_LABEL, type AssetCondition, type FunctionalStatus, type Severity } from '../../../core/types';
import { RULES } from '../../../core/rules';
import { addDaysFromToday, fmtDate, today } from '../../lib/format';
import type { EvidencePayload } from '../../lib/files';
import { useM } from '../../lib/hooks';
import { EvidenceList, EvidencePicker } from '../evidence';
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '../ui';
import { SEVERITY_LABEL } from './workflow';

type AssetData = ProcOutput<'assets.get'>;
export type FindingView = AssetData['findings'][number];
type Assignee = AssetData['assignees'][number];
type InspectionView = AssetData['inspections'][number];

const DUE_DAYS: Record<Severity, number> = { critical: 7, high: RULES.highFindingDays, medium: 30, low: 45 };

function FindingContext({ f }: { f: FindingView }) {
  return (
    <div className="mb-4 rounded-lg border border-line bg-subtle px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={f.tone}>{SEVERITY_LABEL[f.severity]} severity</Badge>
        <span className="text-xs text-ink-3">{f.category}</span>
      </div>
      <p className="mt-1 text-sm font-semibold leading-snug text-ink">{f.title}</p>
      {f.assigneeName && (
        <p className="mt-0.5 text-xs text-ink-3">
          Assigned to {f.assigneeName}
          {f.due_date ? ` · due ${fmtDate(f.due_date)}` : ''}
        </p>
      )}
    </div>
  );
}

// ---------------- assign corrective action ----------------
export function AssignModal({ finding, assignees, assetDepartmentId, onClose }: { finding: FindingView; assignees: Assignee[]; assetDepartmentId: number; onClose: () => void }) {
  const respDept = finding.responsible_department_id ?? assetDepartmentId;
  const [officer, setOfficer] = useState(finding.assigned_to ? String(finding.assigned_to) : '');
  const [due, setDue] = useState(finding.due_date && finding.due_date >= today() ? finding.due_date : addDaysFromToday(DUE_DAYS[finding.severity]));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const m = useM('findings.assign', { success: 'Corrective action assigned. The officer will see it on their desk.' });

  const { own, others } = useMemo(() => {
    const sorted = assignees.slice().sort((a, b) => a.name.localeCompare(b.name));
    return { own: sorted.filter((a) => a.department_id === respDept), others: sorted.filter((a) => a.department_id !== respDept) };
  }, [assignees, respDept]);
  const currentMissing = finding.assigned_to && !assignees.some((a) => a.id === finding.assigned_to);

  const errs = {
    officer: !officer ? 'Choose the officer who will rectify this finding' : null,
    due: !due ? 'Set a due date' : due < today() ? 'Due date cannot be in the past' : null,
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errs.officer || errs.due) return;
    m.mutate({ findingId: finding.id, assignedTo: Number(officer), dueDate: due, note: note.trim() || undefined }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={finding.status === 'open' ? 'Assign corrective action' : 'Reassign corrective action'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="assign-finding-form" loading={m.isPending}>
            {finding.status === 'open' ? 'Assign action' : 'Save assignment'}
          </Button>
        </>
      }
    >
      <FindingContext f={finding} />
      <form id="assign-finding-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Officer responsible for rectification" required error={tried ? errs.officer : null}>
          {(id) => (
            <Select id={id} value={officer} onChange={(e) => setOfficer(e.target.value)} aria-invalid={tried && !!errs.officer}>
              <option value="">Select officer</option>
              {currentMissing && <option value={String(finding.assigned_to)}>{finding.assigneeName ?? 'Current assignee'} (current)</option>}
              {own.length > 0 && (
                <optgroup label="Responsible department">
                  {own.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.designation}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Other officers for this block">
                  {others.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.designation}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
        </Field>
        <Field label="Due date" required error={tried ? errs.due : null} help={`Suggested for ${SEVERITY_LABEL[finding.severity].toLowerCase()} severity: ${DUE_DAYS[finding.severity]} days.`}>
          {(id) => <Input id={id} type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={tried && !!errs.due} />}
        </Field>
        <Field label="Instructions to the officer" help="Optional. Recorded in the audit trail.">
          {(id) => <Textarea id={id} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Coordinate with the JE, PHED; upload a geo-tagged photo after repair." />}
        </Field>
      </form>
    </Modal>
  );
}

// ---------------- submit resolution evidence ----------------
async function sha256OfDataUrl(dataUrl: string): Promise<string | undefined> {
  try {
    if (!globalThis.crypto?.subtle) return undefined;
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export function SubmitResolutionModal({ finding, onClose }: { finding: FindingView; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<EvidencePayload | null>(null);
  const [tried, setTried] = useState(false);
  const [hashing, setHashing] = useState(false);
  const m = useM('findings.submitResolution', { success: 'Evidence submitted. A supervising officer will verify it before the finding closes.' });
  const noteErr = note.trim().length < 5 ? 'Describe what was done (at least 5 characters)' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (noteErr || !evidence) return;
    setHashing(true);
    const sha256 = await sha256OfDataUrl(evidence.dataUrl);
    setHashing(false);
    m.mutate(
      { findingId: finding.id, note: note.trim(), evidence: { fileName: evidence.fileName, mime: evidence.mime, dataUrl: evidence.dataUrl, size: evidence.size, sha256 } },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Submit evidence of resolution"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="submit-resolution-form" disabled={!evidence} loading={m.isPending || hashing}>
            Submit for verification
          </Button>
        </>
      }
    >
      <FindingContext f={finding} />
      <form id="submit-resolution-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="What was done" required error={tried ? noteErr : null}>
          {(id) => (
            <Textarea
              id={id}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={tried && !!noteErr}
              placeholder="e.g. Riser pipe and chain replaced; FTK re-test shows iron 0.6 mg/L; handpump functional."
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink-2">
            Evidence of resolution <span className="text-bad">*</span>
          </span>
          <EvidencePicker value={evidence} onChange={setEvidence} />
        </div>
        {!evidence && (
          <p role="note" className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />A finding cannot be closed without evidence of resolution
          </p>
        )}
        <p className="text-xs text-ink-3">
          A SHA-256 fingerprint of the file is recorded with the upload. The evidence must then be verified by a supervising officer other than the one who uploaded it.
        </p>
      </form>
    </Modal>
  );
}

// ---------------- verify evidence ----------------
export function VerifyModal({ finding, onClose }: { finding: FindingView; onClose: () => void }) {
  const pending = finding.evidence.filter((e) => e.review_status === 'pending');
  const target = pending[0];
  const earlier = finding.evidence.filter((e) => e.review_status !== 'pending');
  const [remark, setRemark] = useState('');
  const [tried, setTried] = useState(false);
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const m = useM('findings.verify', {
    success: (out) => (out.condition ? `Evidence accepted — finding closed. Asset condition is now "${CONDITION_LABEL[out.condition]}".` : 'Evidence rejected — finding reopened and returned to the assigned officer.'),
  });
  const remarkErr = remark.trim().length < 3 ? 'Add a verification remark (at least 3 characters)' : null;

  const decide = (d: 'accept' | 'reject') => {
    setTried(true);
    if (remarkErr || !target) return;
    setDecision(d);
    m.mutate({ findingId: finding.id, evidenceId: target.id, decision: d, remark: remark.trim() }, { onSuccess: onClose, onSettled: () => setDecision(null) });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Verify evidence of resolution"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => decide('reject')} loading={decision === 'reject'} disabled={!target || (m.isPending && decision !== 'reject')}>
            Reject &amp; reopen
          </Button>
          <Button variant="success" onClick={() => decide('accept')} loading={decision === 'accept'} disabled={!target || (m.isPending && decision !== 'accept')}>
            Accept &amp; close finding
          </Button>
        </>
      }
    >
      <FindingContext f={finding} />
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-3">Evidence awaiting verification</h3>
          {target ? <EvidenceList items={pending} /> : <p className="text-[13px] text-ink-3">There is no evidence awaiting verification.</p>}
        </section>
        {earlier.length > 0 && (
          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="text-[13px] font-semibold text-ink-2">Earlier submissions ({earlier.length})</summary>
            <div className="mt-2">
              <EvidenceList items={earlier} />
            </div>
          </details>
        )}
        <p className="flex items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-[13px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>
            <strong>Separation of duties:</strong> the officer who uploaded evidence cannot verify it. Accepting closes the finding and re-derives the asset’s condition from its remaining open findings; rejecting reopens the finding for rework.
          </span>
        </p>
        <Field label="Verification remark" required error={tried ? remarkErr : null}>
          {(id) => (
            <Textarea
              id={id}
              maxLength={600}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              aria-invalid={tried && !!remarkErr}
              placeholder="e.g. Photo matches site; supply restored as confirmed by Mukhiya. / Photo does not show the repaired roof slab — re-upload."
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

// ---------------- record inspection ----------------
interface DraftFinding {
  key: number;
  title: string;
  category: string;
  severity: Severity;
  description: string;
}

const CATEGORY_SUGGESTIONS = ['Structure', 'Drinking water', 'Water quality', 'Sanitation', 'Electrical', 'Equipment', 'Supplies', 'Staffing', 'Access', 'O&M', 'Service delivery'];
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const CONDITIONS: AssetCondition[] = ['good', 'needs_repair', 'critical'];
const FUNCTIONAL: FunctionalStatus[] = ['functional', 'partially', 'non_functional'];
let draftSeq = 1;

export function RecordInspectionModal({
  assetId, assetName, scheduled, defaultInspectionId, onClose,
}: { assetId: number; assetName: string; scheduled: InspectionView[]; defaultInspectionId?: number; onClose: () => void }) {
  const t = today();
  const initialInspection = defaultInspectionId ?? scheduled.find((i) => i.scheduled_date <= t)?.id;
  const [inspectionId, setInspectionId] = useState(initialInspection ? String(initialInspection) : '');
  const [date, setDate] = useState(t);
  const [condition, setCondition] = useState<AssetCondition | ''>('');
  const [functional, setFunctional] = useState<FunctionalStatus | ''>('');
  const [remarks, setRemarks] = useState('');
  const [findings, setFindings] = useState<DraftFinding[]>([]);
  const [tried, setTried] = useState(false);
  const m = useM('assets.recordInspection', { success: (out) => `Inspection recorded. Next inspection due ${fmtDate(out.nextDue)}.` });

  const newFinding = (sev: Severity): DraftFinding => ({ key: draftSeq++, title: '', category: '', severity: sev, description: '' });
  const onCondition = (c: AssetCondition | '') => {
    setCondition(c);
    if (c && c !== 'good' && findings.length === 0) setFindings([newFinding(c === 'critical' ? 'critical' : 'medium')]);
    if (c === 'good' && !functional) setFunctional('functional');
  };
  const patch = (key: number, p: Partial<DraftFinding>) => setFindings((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)));

  const errs = {
    date: !date ? 'Enter the inspection date' : date > t ? 'Inspection date cannot be in the future' : null,
    condition: !condition ? 'Select the condition found' : null,
    functional: !functional ? 'Select the functional status' : null,
    remarks: remarks.trim().length < 3 ? 'Add inspection remarks (at least 3 characters)' : null,
    findings: condition && condition !== 'good' && findings.length === 0 ? 'Record at least one finding when the condition is not Good.' : null,
  };
  const findingErr = (f: DraftFinding) => ({
    title: f.title.trim().length < 3 ? 'Describe the finding (at least 3 characters)' : null,
    category: f.category.trim().length < 2 ? 'Enter a category' : null,
  });
  const findingsValid = findings.every((f) => {
    const e = findingErr(f);
    return !e.title && !e.category;
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errs.date || errs.condition || errs.functional || errs.remarks || errs.findings || !findingsValid || !condition || !functional) return;
    m.mutate(
      {
        assetId,
        inspectionId: inspectionId ? Number(inspectionId) : undefined,
        conductedDate: date,
        condition,
        functionalStatus: functional,
        remarks: remarks.trim(),
        findings: findings.map((f) => ({ title: f.title.trim(), category: f.category.trim(), severity: f.severity, description: f.description.trim() || undefined })),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Record inspection"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="record-inspection-form" loading={m.isPending}>
            Save inspection{findings.length ? ` & ${findings.length} finding${findings.length === 1 ? '' : 's'}` : ''}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-ink-3">
        {assetName}. The inspection is recorded under your name; the asset’s condition is updated and the next inspection is scheduled automatically.
      </p>
      <form id="record-inspection-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Against scheduled inspection" help="Choose a scheduled visit to mark it completed, or record an ad-hoc inspection.">
            {(id) => (
              <Select id={id} value={inspectionId} onChange={(e) => setInspectionId(e.target.value)}>
                <option value="">Ad-hoc inspection (not scheduled)</option>
                {scheduled.map((i) => (
                  <option key={i.id} value={i.id}>
                    {fmtDate(i.scheduled_date)} — {i.inspectorName ?? 'No inspector'}
                    {i.overdue ? ' (overdue)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date of inspection" required error={tried ? errs.date : null}>
            {(id) => <Input id={id} type="date" max={t} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={tried && !!errs.date} />}
          </Field>
          <Field label="Condition found" required error={tried ? errs.condition : null}>
            {(id) => (
              <Select id={id} value={condition} onChange={(e) => onCondition(e.target.value as AssetCondition | '')} aria-invalid={tried && !!errs.condition}>
                <option value="">Select condition</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Functional status" required error={tried ? errs.functional : null}>
            {(id) => (
              <Select id={id} value={functional} onChange={(e) => setFunctional(e.target.value as FunctionalStatus | '')} aria-invalid={tried && !!errs.functional}>
                <option value="">Select status</option>
                {FUNCTIONAL.map((s) => (
                  <option key={s} value={s}>
                    {FUNCTIONAL_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Inspection remarks" required error={tried ? errs.remarks : null}>
          {(id) => (
            <Textarea
              id={id}
              maxLength={1000}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              aria-invalid={tried && !!errs.remarks}
              placeholder="Overall observations: attendance, usage, structure, water, sanitation…"
            />
          )}
        </Field>

        <div role="group" aria-labelledby="inspection-findings-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="inspection-findings-heading" className="text-[13px] font-semibold text-ink-2">
              Findings {condition && condition !== 'good' && <span className="text-bad">*</span>}
              <span className="ml-1 font-normal text-ink-3">— each becomes a tracked item needing corrective action</span>
            </h3>
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setFindings((fs) => [...fs, newFinding('medium')])} disabled={findings.length >= 20}>
              Add finding
            </Button>
          </div>
          {findings.length === 0 && <p className="rounded-md border border-dashed border-line-2 px-3 py-3 text-[13px] text-ink-3">No findings added. Add one for every defect that needs corrective action.</p>}
          {findings.map((f, i) => {
            const fe = findingErr(f);
            return (
              <div key={f.key} className="rounded-lg border border-line bg-subtle/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-ink-3">Finding {i + 1}</span>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setFindings((fs) => fs.filter((x) => x.key !== f.key))} aria-label={`Remove finding ${i + 1}`}>
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <Field label="Title" required error={tried ? fe.title : null}>
                    {(id) => <Input id={id} maxLength={200} value={f.title} onChange={(e) => patch(f.key, { title: e.target.value })} aria-invalid={tried && !!fe.title} placeholder="e.g. Roof leakage in classrooms" />}
                  </Field>
                  <Field label="Category" required error={tried ? fe.category : null}>
                    {(id) => (
                      <Input id={id} maxLength={60} list="finding-categories" value={f.category} onChange={(e) => patch(f.key, { category: e.target.value })} aria-invalid={tried && !!fe.category} placeholder="e.g. Structure" />
                    )}
                  </Field>
                  <Field label="Severity" required>
                    {(id) => (
                      <Select id={id} value={f.severity} onChange={(e) => patch(f.key, { severity: e.target.value as Severity })}>
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {SEVERITY_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Field label="Description" className="mt-3">
                  {(id) => <Textarea id={id} maxLength={1000} className="min-h-16" value={f.description} onChange={(e) => patch(f.key, { description: e.target.value })} placeholder="Where exactly, how serious, who is affected" />}
                </Field>
              </div>
            );
          })}
          <datalist id="finding-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {tried && errs.findings && (
            <p role="alert" className="text-xs font-semibold text-bad">
              {errs.findings}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------- schedule inspection ----------------
export function ScheduleInspectionModal({
  assetId, assignees, defaultInspectorId, defaultDate, onClose,
}: { assetId: number; assignees: Assignee[]; defaultInspectorId: number | null; defaultDate: string | null; onClose: () => void }) {
  const t = today();
  const [date, setDate] = useState(defaultDate && defaultDate >= t ? defaultDate : addDaysFromToday(7));
  const [inspector, setInspector] = useState(defaultInspectorId && assignees.some((a) => a.id === defaultInspectorId) ? String(defaultInspectorId) : '');
  const [tried, setTried] = useState(false);
  const m = useM('assets.scheduleInspection', { success: 'Inspection scheduled. It now appears on the inspector’s desk.' });
  const sorted = useMemo(() => assignees.slice().sort((a, b) => a.name.localeCompare(b.name)), [assignees]);
  const errs = {
    date: !date ? 'Choose a date' : date < t ? 'Date cannot be in the past' : null,
    inspector: !inspector ? 'Choose the inspecting officer' : null,
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errs.date || errs.inspector) return;
    m.mutate({ assetId, date, inspectorId: Number(inspector) }, { onSuccess: onClose });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule inspection"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="schedule-inspection-form" loading={m.isPending}>
            Schedule
          </Button>
        </>
      }
    >
      <form id="schedule-inspection-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Inspection date" required error={tried ? errs.date : null}>
          {(id) => <Input id={id} type="date" min={t} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={tried && !!errs.date} />}
        </Field>
        <Field label="Inspecting officer" required error={tried ? errs.inspector : null}>
          {(id) => (
            <Select id={id} value={inspector} onChange={(e) => setInspector(e.target.value)} aria-invalid={tried && !!errs.inspector}>
              <option value="">Select officer</option>
              {sorted.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.designation}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}
