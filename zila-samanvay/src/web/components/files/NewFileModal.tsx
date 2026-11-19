import { FilePlus2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { RULES } from '../../../core/rules';
import { useLookups, useM, useMe, useQ } from '../../lib/hooks';
import { Button, Field, Input, Modal, Select, Textarea } from '../ui';

const CATEGORIES = Object.keys(RULES.fileSla);
type Priority = 'normal' | 'high' | 'urgent';

interface FormState {
  subject: string;
  category: string;
  departmentId: string;
  blockId: string;
  decisionRequired: string;
  slaDays: string;
  priority: Priority;
  toOfficeId: string;
  toUserId: string;
  workId: string;
  amountLakh: string;
  remark: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

/** "Open new file" form: creates the file, sends it to the chosen desk and opens it. */
export function NewFileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe().data;
  const lk = useLookups();
  const nav = useNavigate();
  const works = useQ('works.list', { pageSize: 200, sort: 'name' }, { enabled: open, staleTime: 60_000 });

  const initial = useMemo<FormState>(
    () => ({
      subject: '',
      category: CATEGORIES[0],
      departmentId: me?.department_id ? String(me.department_id) : '',
      blockId: me?.block_id ? String(me.block_id) : '',
      decisionRequired: '',
      slaDays: String(RULES.fileSla[CATEGORIES[0]]),
      priority: 'normal',
      toOfficeId: '',
      toUserId: '',
      workId: '',
      amountLakh: '',
      remark: '',
    }),
    [me?.department_id, me?.block_id],
  );
  const [f, setF] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (open) {
      setF(initial);
      setErrors({});
    }
  }, [open, initial]);

  const m = useM('files.create', {
    success: (out) => `File ${out.fileNo} opened and sent for decision.`,
  });

  const exec = me?.role === 'dm' || me?.role === 'ddc';
  const departments = (lk.data?.departments ?? []).filter((d) => exec || !me?.department_id || d.id === me.department_id);
  const blocks = (lk.data?.blocks ?? []).filter((b) => exec || me?.role !== 'block_officer' || !me.block_id || b.id === me.block_id);
  const allowDistrictLevel = exec || me?.role !== 'block_officer' || !me?.block_id;
  const offices = lk.data?.offices ?? [];
  const officers = (lk.data?.users ?? []).filter((u) => f.toOfficeId && u.office_id === Number(f.toOfficeId));

  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (f.subject.trim().length < 5) e.subject = 'Enter a subject of at least 5 characters.';
    if (!f.category) e.category = 'Choose a category.';
    if (!f.departmentId) e.departmentId = 'Choose the department.';
    if (f.decisionRequired.trim().length < 5) e.decisionRequired = 'State the decision required (at least 5 characters).';
    const sla = Number(f.slaDays);
    if (!Number.isInteger(sla) || sla < 1 || sla > 120) e.slaDays = 'SLA must be a whole number of days between 1 and 120.';
    if (!f.toOfficeId) e.toOfficeId = 'Choose the office the file goes to.';
    if (f.amountLakh !== '') {
      const a = Number(f.amountLakh);
      if (!Number.isFinite(a) || a < 0) e.amountLakh = 'Enter a valid amount in lakh (0 or more).';
    }
    if (f.remark.length > 600) e.remark = 'Keep the remark within 600 characters.';
    return e;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    m.mutate(
      {
        subject: f.subject.trim(),
        category: f.category,
        departmentId: Number(f.departmentId),
        blockId: f.blockId ? Number(f.blockId) : null,
        decisionRequired: f.decisionRequired.trim(),
        slaDays: Number(f.slaDays),
        priority: f.priority,
        toOfficeId: Number(f.toOfficeId),
        toUserId: f.toUserId ? Number(f.toUserId) : undefined,
        workId: f.workId ? Number(f.workId) : null,
        amountLakh: f.amountLakh !== '' ? Number(f.amountLakh) : null,
        remark: f.remark.trim() || undefined,
      },
      {
        onSuccess: (out) => {
          onClose();
          nav(`/files/${out.id}`);
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Open new file"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-file-form" loading={m.isPending} icon={<FilePlus2 className="size-4" aria-hidden />}>
            Open file and send
          </Button>
        </>
      }
    >
      <form id="new-file-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject" required error={errors.subject} className="sm:col-span-2">
          {(id) => <Input id={id} value={f.subject} maxLength={300} onChange={(e) => upd('subject', e.target.value)} placeholder="e.g. Technical sanction for PCC road, Ward 7" />}
        </Field>

        <Field label="Category" required error={errors.category}>
          {(id) => (
            <Select
              id={id}
              value={f.category}
              onChange={(e) => {
                const c = e.target.value;
                setF((p) => ({ ...p, category: c, slaDays: String(RULES.fileSla[c] ?? 15) }));
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c} (SLA {RULES.fileSla[c]} d)
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="SLA at each desk (days)" required error={errors.slaDays} help={`Default for ${f.category}: ${RULES.fileSla[f.category] ?? 15} days`}>
          {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={120} step={1} value={f.slaDays} onChange={(e) => upd('slaDays', e.target.value)} />}
        </Field>

        <Field label="Department" required error={errors.departmentId}>
          {(id) => (
            <Select id={id} value={f.departmentId} onChange={(e) => upd('departmentId', e.target.value)} disabled={lk.isLoading}>
              <option value="">Choose department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Block">
          {(id) => (
            <Select id={id} value={f.blockId} onChange={(e) => upd('blockId', e.target.value)} disabled={lk.isLoading}>
              {allowDistrictLevel && <option value="">District level (no block)</option>}
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Decision required" required error={errors.decisionRequired} className="sm:col-span-2" help="What the receiving officer must decide, in one or two lines.">
          {(id) => (
            <Textarea id={id} rows={2} maxLength={600} value={f.decisionRequired} onChange={(e) => upd('decisionRequired', e.target.value)} placeholder="e.g. Accord technical sanction of ₹18.4 L so the tender can be floated" />
          )}
        </Field>

        <Field label="Priority">
          {(id) => (
            <Select id={id} value={f.priority} onChange={(e) => upd('priority', e.target.value as Priority)}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          )}
        </Field>

        <Field label="Amount involved (₹ lakh)" error={errors.amountLakh} help="Leave blank if no money is involved.">
          {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" value={f.amountLakh} onChange={(e) => upd('amountLakh', e.target.value)} placeholder="0.00" />}
        </Field>

        <Field label="Send to office" required error={errors.toOfficeId}>
          {(id) => (
            <Select
              id={id}
              value={f.toOfficeId}
              disabled={lk.isLoading}
              onChange={(e) => {
                const v = e.target.value;
                setF((p) => ({ ...p, toOfficeId: v, toUserId: '' }));
                if (errors.toOfficeId) setErrors((x) => ({ ...x, toOfficeId: undefined }));
              }}
            >
              <option value="">Choose office</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Officer in that office" help={f.toOfficeId ? 'Optional. If left blank, the head of that office receives it.' : 'Choose an office first.'}>
          {(id) => (
            <Select id={id} value={f.toUserId} onChange={(e) => upd('toUserId', e.target.value)} disabled={!f.toOfficeId}>
              <option value="">Head of office (default)</option>
              {officers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.designation}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Linked public work"
          className="sm:col-span-2"
          help={works.isError ? 'Could not load works; you can link the file later.' : works.isLoading ? 'Loading works…' : 'Optional. Links the file to the work it holds up.'}
        >
          {(id) => (
            <Select id={id} value={f.workId} onChange={(e) => upd('workId', e.target.value)} disabled={works.isLoading}>
              <option value="">No linked work</option>
              {(works.data?.rows ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Forwarding remark / noting" error={errors.remark} className="sm:col-span-2" help={`${f.remark.length}/600`}>
          {(id) => <Textarea id={id} rows={3} maxLength={600} value={f.remark} onChange={(e) => upd('remark', e.target.value)} placeholder="Put up for decision. Relevant papers placed below." />}
        </Field>
      </form>
    </Modal>
  );
}
