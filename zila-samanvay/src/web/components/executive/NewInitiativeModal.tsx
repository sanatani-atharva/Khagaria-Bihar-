// Define a cross-department initiative by linking live records (works, files, inspection
// findings) from one block. Status is never typed in: it is derived from those records.

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { addDaysFromToday, today } from '../../lib/format';
import { useLookups, useM, useMe, useQ } from '../../lib/hooks';
import { Badge, Button, Field, Input, Modal, Select, Skeleton, Textarea } from '../ui';

type RefType = 'work' | 'file' | 'finding';
interface Row {
  refType: RefType;
  refId: string;
  label: string;
  dependsOn: string;
}

const TYPE_LABEL: Record<RefType, string> = { work: 'Public work', file: 'File awaiting decision', finding: 'Inspection finding' };
const emptyRow = (refType: RefType = 'work'): Row => ({ refType, refId: '', label: '', dependsOn: '' });

export function NewInitiativeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const me = useMe();
  const lk = useLookups();
  const [blockId, setBlockId] = useState('');
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [targetDate, setTargetDate] = useState(addDaysFromToday(60));
  const [assetId, setAssetId] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow('file'), emptyRow('work')]);
  const [err, setErr] = useState<string | null>(null);
  const cand = useQ('deps.candidates', { blockId: Number(blockId) || 0 }, { enabled: open && !!blockId });
  const m = useM('deps.create', { success: (o) => `Initiative ${o.code} created` });

  useEffect(() => {
    if (open) {
      setBlockId('');
      setTitle('');
      setOutcome('');
      setTargetDate(addDaysFromToday(60));
      setAssetId('');
      setRows([emptyRow('file'), emptyRow('work')]);
      setErr(null);
    }
  }, [open]);

  const options = useMemo(() => {
    const d = cand.data;
    return { work: d?.works ?? [], file: d?.files ?? [], finding: d?.findings ?? [] };
  }, [cand.data]);

  const picked = rows.map((r) => options[r.refType].find((o) => String(o.refId) === r.refId));
  const departments = Array.from(new Set(picked.filter(Boolean).map((p) => p!.departmentName)));

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (patch.refType && patch.refType !== r.refType) {
          next.refId = '';
          next.label = '';
        }
        if (patch.refId !== undefined && !r.label) {
          const o = options[next.refType].find((x) => String(x.refId) === patch.refId);
          if (o) next.label = `${TYPE_LABEL[next.refType]} (${o.departmentName})`;
        }
        return next;
      }),
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!blockId) return setErr('Choose the block.');
    if (title.trim().length < 5 || outcome.trim().length < 5) return setErr('Give a title and the intended outcome (at least 5 characters each).');
    if (rows.length < 2 || rows.some((r) => !r.refId || r.label.trim().length < 3)) return setErr('Every component needs a linked record and a short label.');
    if (departments.length < 2) return setErr('Link records from at least two departments — otherwise it is not an inter-department matter.');
    m.mutate(
      {
        title: title.trim(),
        outcome: outcome.trim(),
        blockId: Number(blockId),
        assetId: assetId ? Number(assetId) : null,
        targetDate: targetDate || null,
        coordinatorId: me.data?.id ?? null,
        links: rows.map((r) => ({ label: r.label.trim(), refType: r.refType, refId: Number(r.refId), dependsOn: r.dependsOn === '' ? null : Number(r.dependsOn) })),
      },
      { onSuccess: (o) => onCreated(o.id) },
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => !m.isPending && onClose()}
      wide
      title="Define an inter-department initiative"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-initiative" loading={m.isPending}>
            Create initiative
          </Button>
        </>
      }
    >
      <form id="new-initiative" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-3">
          Link the works, pending files and inspection findings that together decide one outcome. Their status updates automatically, and the priority engine
          flags the initiative when any component is blocked.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Block" required>
            {(id) => (
              <Select id={id} value={blockId} onChange={(e) => { setBlockId(e.target.value); setRows([emptyRow('file'), emptyRow('work')]); setAssetId(''); }}>
                <option value="">Choose block…</option>
                {lk.data?.blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Outcome target date">
            {(id) => <Input id={id} type="date" min={today()} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}
          </Field>
          <Field label="Title" required className="sm:col-span-2">
            {(id) => <Input id={id} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Middle School Improvement — UMS Kosra" />}
          </Field>
          <Field label="Intended outcome" required className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={2} maxLength={400} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Safe classrooms and drinking water for 300 students by March" />}
          </Field>
          <Field label="Facility (optional)" className="sm:col-span-2">
            {(id) => (
              <Select id={id} value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!blockId}>
                <option value="">— none —</option>
                {cand.data?.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">Components</h3>
            <div className="flex flex-wrap gap-1">
              {departments.map((d) => (
                <Badge key={d} tone="info">
                  {d}
                </Badge>
              ))}
            </div>
          </div>
          {!blockId ? (
            <p className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-3">Choose a block to list its works, pending files and open findings.</p>
          ) : cand.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ol className="flex flex-col gap-3">
              {rows.map((r, i) => (
                <li key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-ink-3">Component {i + 1}</span>
                    {rows.length > 2 && (
                      <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i).map((x) => ({ ...x, dependsOn: x.dependsOn === String(i) ? '' : x.dependsOn !== '' && Number(x.dependsOn) > i ? String(Number(x.dependsOn) - 1) : x.dependsOn })))}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <Field label="Type">
                      {(id) => (
                        <Select id={id} value={r.refType} onChange={(e) => setRow(i, { refType: e.target.value as RefType })}>
                          {(Object.keys(TYPE_LABEL) as RefType[]).map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABEL[t]} ({options[t].length})
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Linked record" required>
                      {(id) => (
                        <Select id={id} value={r.refId} onChange={(e) => setRow(i, { refId: e.target.value })}>
                          <option value="">Choose…</option>
                          {options[r.refType].map((o) => (
                            <option key={o.refId} value={o.refId}>
                              [{o.departmentName}] {o.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Label shown in the chain" required>
                      {(id) => <Input id={id} maxLength={160} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="e.g. Fund allotment (Treasury)" />}
                    </Field>
                    <Field label="Cannot finish until">
                      {(id) => (
                        <Select id={id} value={r.dependsOn} onChange={(e) => setRow(i, { dependsOn: e.target.value })}>
                          <option value="">— independent —</option>
                          {rows.map((_, j) =>
                            j === i ? null : (
                              <option key={j} value={j}>
                                Component {j + 1}
                                {rows[j].label ? `: ${rows[j].label}` : ''}
                              </option>
                            ),
                          )}
                        </Select>
                      )}
                    </Field>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {blockId && rows.length < 12 && (
            <Button className="mt-2" size="sm" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              Add component
            </Button>
          )}
        </div>
        {err && (
          <p role="alert" className="text-sm font-semibold text-bad">
            {err}
          </p>
        )}
      </form>
    </Modal>
  );
}
