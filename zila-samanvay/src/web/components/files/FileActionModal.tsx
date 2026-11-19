import { Archive, CheckCircle2, HelpCircle, Reply, Send, Undo2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ProcOutput } from '../../../core/rpc';
import { useLookups, useM } from '../../lib/hooks';
import { Button, Field, Modal, Select, Textarea } from '../ui';

export type FileActionKey = 'forward' | 'approve' | 'query' | 'reply' | 'return' | 'close';
type FileGet = ProcOutput<'files.get'>;

export const FILE_ACTION_META: Record<FileActionKey, { label: string; title: string; icon: ReactNode; variant: 'primary' | 'secondary' | 'success'; done: string; remarkHint: string }> = {
  forward: {
    label: 'Forward',
    title: 'Forward file',
    icon: <Send className="size-4" aria-hidden />,
    variant: 'primary',
    done: 'Forwarded',
    remarkHint: 'e.g. Examined. Put up for technical sanction.',
  },
  approve: {
    label: 'Approve',
    title: 'Approve file',
    icon: <CheckCircle2 className="size-4" aria-hidden />,
    variant: 'success',
    done: 'Approved',
    remarkHint: 'e.g. Approved as proposed. Issue the order.',
  },
  query: {
    label: 'Raise query',
    title: 'Raise a query',
    icon: <HelpCircle className="size-4" aria-hidden />,
    variant: 'secondary',
    done: 'Query raised',
    remarkHint: 'e.g. Attach revised estimate and land NOC before sanction.',
  },
  reply: {
    label: 'Reply to query',
    title: 'Reply to query',
    icon: <Reply className="size-4" aria-hidden />,
    variant: 'primary',
    done: 'Reply sent',
    remarkHint: 'e.g. Revised estimate and NOC placed below as flagged.',
  },
  return: {
    label: 'Return',
    title: 'Return file',
    icon: <Undo2 className="size-4" aria-hidden />,
    variant: 'secondary',
    done: 'Returned',
    remarkHint: 'e.g. Returned for re-examination at block level.',
  },
  close: {
    label: 'Close file',
    title: 'Close file',
    icon: <Archive className="size-4" aria-hidden />,
    variant: 'secondary',
    done: 'File closed',
    remarkHint: 'e.g. Order issued. File closed and recorded.',
  },
};

/**
 * One modal for every file action. Each action needs a noting; Forward needs a destination,
 * Query / Return default to the previous desk but may be sent elsewhere.
 */
export function FileActionModal({ action, data, onClose }: { action: FileActionKey | null; data: FileGet; onClose: () => void }) {
  const lk = useLookups();
  const [office, setOffice] = useState('');
  const [officer, setOfficer] = useState('');
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<{ office?: string; officer?: string; remark?: string }>({});

  useEffect(() => {
    setOffice('');
    setOfficer('');
    setRemark('');
    setErrors({});
  }, [action]);

  const meta = action ? FILE_ACTION_META[action] : null;
  const m = useM('files.act', {
    success: (out) =>
      action === 'close'
        ? 'File closed.'
        : `${meta?.done ?? 'Done'} — now at ${out.officeName}${out.holderName ? ` with ${out.holderName}` : ''}.`,
  });

  const f = data.file;
  const moves = data.movements;
  const prevDesk = [...moves].reverse().find((x) => x.to_office_id === f.current_office_id && x.from_office_id && x.from_office_id !== f.current_office_id);
  const lastQuery = [...moves].reverse().find((x) => x.action === 'query');
  const origin = moves[0];
  const offices = lk.data?.offices ?? [];
  const officers = (lk.data?.users ?? []).filter((u) => office && u.office_id === Number(office));

  const needsOffice = action === 'forward';
  const canChooseOffice = action === 'forward' || action === 'query' || action === 'return';

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!action) return;
    const e: typeof errors = {};
    if (remark.trim().length < 3) e.remark = 'A remark / noting of at least 3 characters is required.';
    if (needsOffice && !office) e.office = 'Choose the office to forward to.';
    if (needsOffice && office && Number(office) === f.current_office_id && !officer) e.office = 'The file is already at this office. Choose another office or a specific officer.';
    if ((action === 'query' || action === 'return') && !office && !prevDesk) e.office = 'There is no earlier desk to send this back to. Choose an office.';
    // Sending a query / return somewhere other than the previous desk must name the receiving officer,
    // otherwise it would default to the officer who sent the file here.
    if ((action === 'query' || action === 'return') && office && Number(office) !== prevDesk?.from_office_id && !officer)
      e.officer = 'Choose the officer in that office who should receive the file.';
    setErrors(e);
    if (e.office || e.officer || e.remark) return;
    m.mutate(
      {
        id: f.id,
        action,
        toOfficeId: canChooseOffice && office ? Number(office) : undefined,
        toUserId: canChooseOffice && office && officer ? Number(officer) : undefined,
        remark: remark.trim(),
      },
      { onSuccess: onClose },
    );
  };

  let note: ReactNode = null;
  if (action === 'approve')
    note = (
      <>
        On approval the file goes back to the originating desk{origin?.fromOffice ? <> — <strong>{origin.fromOffice}</strong></> : ''}
        {f.creatorName ? <> ({f.creatorName})</> : ''} for issue of orders.
      </>
    );
  else if (action === 'reply')
    note = lastQuery ? (
      <>
        Your reply goes back to <strong>{lastQuery.fromOffice ?? 'the office that raised the query'}</strong>
        {lastQuery.byName ? <> ({lastQuery.byName})</> : ''}. Query: “{lastQuery.remark ?? '—'}”
      </>
    ) : (
      'Your reply goes back to the office that raised the query.'
    );
  else if (action === 'close') note = 'Closing stops the SLA clock and ends the file’s movement. A closed file cannot be acted on again.';
  else if (action === 'query') note = 'The file moves to the chosen desk with status “Query raised” until it is replied to.';
  else if (action === 'return') note = 'The file moves back for re-examination; it stays pending.';

  return (
    <Modal
      open={!!action}
      onClose={onClose}
      title={meta ? `${meta.title} · ${f.file_no}` : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="file-action-form" variant={meta?.variant === 'success' ? 'success' : 'primary'} loading={m.isPending} icon={meta?.icon}>
            {meta?.label ?? 'Submit'}
          </Button>
        </>
      }
    >
      <form id="file-action-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {note && <p className="rounded-md border border-line bg-subtle px-3 py-2 text-[13px] text-ink-2">{note}</p>}

        {canChooseOffice && (
          <>
            <Field
              label={action === 'forward' ? 'Forward to office' : 'Send to office'}
              required={needsOffice || !prevDesk}
              error={errors.office}
              help={!needsOffice && prevDesk ? 'Leave as previous desk unless the query / return must go elsewhere.' : undefined}
            >
              {(id) => (
                <Select
                  id={id}
                  value={office}
                  disabled={lk.isLoading}
                  onChange={(e) => {
                    setOffice(e.target.value);
                    setOfficer('');
                    if (errors.office || errors.officer) setErrors((x) => ({ ...x, office: undefined, officer: undefined }));
                  }}
                >
                  <option value="">{needsOffice ? 'Choose office' : prevDesk ? `Previous desk — ${prevDesk.fromOffice ?? 'earlier office'}` : 'Choose office'}</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.id === f.current_office_id ? ' (current desk)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Officer in that office"
              required={!needsOffice && !!office && Number(office) !== prevDesk?.from_office_id}
              error={errors.officer}
              help={
                !office
                  ? 'Choose an office to pick a specific officer.'
                  : needsOffice
                    ? 'Optional. If left blank, the head of that office receives it.'
                    : Number(office) === prevDesk?.from_office_id
                      ? 'Optional. If left blank, it goes back to the officer who sent it here.'
                      : undefined
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={officer}
                  disabled={!office}
                  onChange={(e) => {
                    setOfficer(e.target.value);
                    if (errors.officer) setErrors((x) => ({ ...x, officer: undefined }));
                  }}
                >
                  <option value="">
                    {needsOffice
                      ? 'Head of office (default)'
                      : !office || Number(office) === prevDesk?.from_office_id
                        ? prevDesk?.byName
                          ? `${prevDesk.byName} (sent it here)`
                          : 'Officer who sent it here'
                        : 'Choose officer'}
                  </option>
                  {officers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.designation}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        <Field label="Remark / noting" required error={errors.remark} help={`Recorded in the file movement and audit trail with your name and time. ${remark.length}/600`}>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={600}
              value={remark}
              placeholder={meta?.remarkHint}
              onChange={(e) => {
                setRemark(e.target.value);
                if (errors.remark) setErrors((x) => ({ ...x, remark: undefined }));
              }}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
