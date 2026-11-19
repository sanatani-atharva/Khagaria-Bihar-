// Print-ready Review Meeting Brief. Generated straight from the priority engine and the
// action tracker, so nobody assembles the report by hand: print it, or save it as a PDF.
// Rendered without the app shell on an A4-width sheet; print rules live in index.css.

import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AGENDA_CATEGORY_LABEL } from '../../core/types';
import {
  actionLabel, actionTone, BAND_LABEL, BAND_ORDER, BAND_RANGE, briefCsv, briefFileName, CATEGORY_ORDER, evidenceState, meetingStatusLabel, posInt,
  scopeLabel, type Brief,
} from '../components/review/helpers';
import { useToast } from '../components/toast';
import { Button, ErrorState, Skeleton, cx } from '../components/ui';
import { downloadText } from '../lib/files';
import { bandTone, fmtDate, fmtDateTime, TONE } from '../lib/format';
import { useLookups, useQ } from '../lib/hooks';

const TH = 'border-b-2 border-ink px-1.5 py-1.5 text-left align-bottom text-[11px] font-bold uppercase print:text-[10px] tracking-wide text-ink-2';
const TD = 'border-b border-line px-1.5 py-1.5 align-top';

export default function ReviewBrief() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const lookups = useLookups();
  const meetingId = posInt(params.get('meeting'));
  const blockId = posInt(params.get('block'));
  const departmentId = posInt(params.get('dept'));
  const q = useQ('review.brief', { meetingId, blockId, departmentId, limit: 30 });
  const b = q.data;
  const scope = scopeLabel(lookups.data, blockId, departmentId);

  // A meaningful default file name when the officer chooses "Save as PDF".
  useEffect(() => {
    if (!b) return;
    const prev = document.title;
    const when = b.meeting ? fmtDate(b.meeting.meeting_date) : fmtDate(b.generatedAt.slice(0, 10));
    document.title = `Review Meeting Brief — Khagaria — ${when}`;
    return () => {
      document.title = prev;
    };
  }, [b]);

  const back = () => {
    if (loc.key !== 'default') {
      nav(-1);
      return;
    }
    const p = new URLSearchParams();
    if (meetingId) p.set('meeting', String(meetingId));
    if (blockId) p.set('block', String(blockId));
    if (departmentId) p.set('dept', String(departmentId));
    const s = p.toString();
    nav(`/review${s ? `?${s}` : ''}`);
  };

  const downloadCsv = () => {
    if (!b) return;
    downloadText(briefFileName(b), briefCsv(b, scope));
    toast.show('Brief downloaded as CSV.', 'ok');
  };

  return (
    <div className="min-h-dvh bg-canvas px-3 py-4 sm:px-6 sm:py-8 print:min-h-0 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={back}>
          Back
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Download className="size-4" aria-hidden />} onClick={downloadCsv} disabled={!b}>
            Download CSV
          </Button>
          <Button variant="primary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()} disabled={!b}>
            Print / Save as PDF
          </Button>
        </div>
      </div>
      <p className="no-print mx-auto mb-4 max-w-[210mm] text-[13px] text-ink-3">
        In the print dialog choose A4, portrait, and turn off the browser's headers and footers. Choose “Save as PDF” as the printer to file a copy.
      </p>

      <article
        aria-label="Review Meeting Brief"
        className="mx-auto w-full max-w-[210mm] border border-line bg-white px-4 py-6 text-ink shadow-[var(--shadow-card)] [-webkit-print-color-adjust:exact] [print-color-adjust:exact] sm:px-[14mm] sm:py-[12mm] print:max-w-none print:border-0 print:p-0 print:shadow-none"
      >
        {q.isLoading ? (
          <BriefSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : b ? (
          <BriefDocument b={b} scope={scope} />
        ) : null}
      </article>
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div aria-busy="true" aria-label="Preparing the brief">
      <Skeleton className="mx-auto mb-2 h-5 w-72" />
      <Skeleton className="mx-auto mb-6 h-4 w-48" />
      <Skeleton className="mb-3 h-7 w-56" />
      <Skeleton className="mb-6 h-20 w-full" />
      <Skeleton className="mb-3 h-5 w-40" />
      <Skeleton className="mb-6 h-32 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function Section({ n, title, children, className }: { n: number; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mt-6', className)}>
      <h2 className="mb-2 break-after-avoid border-b border-line-2 pb-1 text-[13px] font-bold uppercase tracking-wide text-ink">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function MetaRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-semibold text-ink-3">{k}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function CountTable({ caption, rows, total }: { caption: string; rows: { label: ReactNode; value: number; note?: string }[]; total?: { label: string; value: number } }) {
  return (
    <table className="w-full border-collapse text-[12px] print:text-[10.5px]">
      <caption className="mb-1 text-left text-[11px] font-bold uppercase tracking-wide text-ink-3">{caption}</caption>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line">
            <td className="py-1 pr-2 text-ink-2">
              {r.label}
              {r.note && <span className="text-ink-3"> ({r.note})</span>}
            </td>
            <td className="tabular py-1 text-right font-semibold text-ink">{r.value}</td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="border-t-2 border-ink">
            <th scope="row" className="py-1 pr-2 text-left font-bold">
              {total.label}
            </th>
            <td className="tabular py-1 text-right font-bold">{total.value}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function BriefDocument({ b, scope }: { b: Brief; scope: string }) {
  const items = b.agenda.items;
  const totalFlagged = CATEGORY_ORDER.reduce((s, c) => s + b.agenda.counts[c], 0);
  const byBand = BAND_ORDER.map((band) => ({ band, n: items.filter((i) => i.band === band).length }));
  const open = b.actions.filter((a) => a.status !== 'closed');
  const overdue = open.filter((a) => a.overdueBy > 0);
  const submitted = b.actions.filter((a) => a.status === 'resolution_submitted');
  const closed = b.actions.filter((a) => a.status === 'closed');
  const repeat = items.filter((i) => i.timesFlaggedBefore > 0).length;

  return (
    <>
      {/* Letterhead */}
      <header className="border-b-2 border-ink pb-3 text-center">
        <p className="text-[17px] font-bold uppercase tracking-wide">District Administration, Khagaria</p>
        <p lang="hi" className="hi text-[15px] text-ink-2">
          ज़िला प्रशासन, खगड़िया
        </p>
        <p className="mt-0.5 text-[13px] font-semibold text-ink-2">Office of the District Magistrate</p>
      </header>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Review Meeting Brief</h1>
          <p className="text-[12px] text-ink-3">For discussion and decision. Generated from live records — no manual compilation.</p>
        </div>
        <span className="rounded border border-warn/40 bg-warn-soft px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-warn">Prototype — synthetic data</span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2 print:grid-cols-2 print:text-[10.5px]">
        <MetaRow k="Meeting">{b.meeting ? b.meeting.title : 'No meeting scheduled — brief for the next review'}</MetaRow>
        <MetaRow k="Meeting date">{b.meeting ? fmtDate(b.meeting.meeting_date) : '—'}</MetaRow>
        <MetaRow k="Chair">{b.meeting?.chairName ?? '—'}</MetaRow>
        <MetaRow k="Meeting status">{b.meeting ? meetingStatusLabel(b.meeting.status) : '—'}</MetaRow>
        <MetaRow k="Scope">{scope}</MetaRow>
        <MetaRow k="Generated by">{b.generatedBy}</MetaRow>
        <MetaRow k="Generated at">{fmtDateTime(b.generatedAt)}</MetaRow>
        <MetaRow k="Source">Zila Samanvay — Review Meeting Priority Engine</MetaRow>
      </dl>

      {/* 1. Summary */}
      <Section n={1} title="Summary">
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2 print:text-[11px]">
          <span className="font-semibold text-ink">{totalFlagged}</span> item{totalFlagged === 1 ? '' : 's'} cross the review thresholds; the top{' '}
          <span className="font-semibold text-ink">{items.length}</span> by priority score are listed in section 2
          {repeat > 0 && (
            <>
              , of which <span className="font-semibold text-ink">{repeat}</span> were already discussed in an earlier meeting
            </>
          )}
          . <span className="font-semibold text-ink">{open.length}</span> review action{open.length === 1 ? ' is' : 's are'} open,{' '}
          <span className={cx('font-semibold', overdue.length ? 'text-bad' : 'text-ink')}>{overdue.length} overdue</span>, and{' '}
          <span className="font-semibold text-ink">{submitted.length}</span> await verification of evidence.
        </p>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 print:grid-cols-2">
          <CountTable
            caption="Flagged items by agenda category"
            rows={CATEGORY_ORDER.map((c) => ({ label: AGENDA_CATEGORY_LABEL[c], value: b.agenda.counts[c] }))}
            total={{ label: 'Total flagged', value: totalFlagged }}
          />
          <div className="flex flex-col gap-4">
            <CountTable
              caption={`Listed items by priority band (top ${items.length})`}
              rows={byBand.map((x) => ({ label: <span className={cx('font-semibold', TONE[bandTone(x.band)].text)}>{BAND_LABEL[x.band]}</span>, value: x.n, note: BAND_RANGE[x.band] }))}
            />
            <CountTable
              caption="Review actions"
              rows={[
                { label: 'Open', value: open.length },
                { label: 'Overdue', value: overdue.length },
                { label: 'Evidence awaiting verification', value: submitted.length },
                { label: 'Verified and closed', value: closed.length, note: 'last 30 days' },
              ]}
            />
          </div>
        </div>
      </Section>

      {/* 2. Ranked agenda */}
      <Section n={2} className="print-break print:mt-0" title={`Ranked agenda — top ${items.length} of ${totalFlagged}`}>
        <p className="mb-2 text-[11.5px] text-ink-3 print:text-[10px]">
          Score is a transparent additive total of priority points from delay length, severity, value at stake, persistence and repeat flags. Bands: Critical 75+, High 55–74, Medium below 55.
          Items inside a flagged inter-department initiative are folded into that coordination item.
        </p>
        {items.length ? (
          <div className="relative overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[680px] table-fixed border-collapse text-[11.5px] leading-snug print:min-w-0 print:text-[9.5px]">
              <caption className="sr-only">Ranked agenda items with reasons, responsible officers and suggested actions</caption>
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[19%]" />
                <col className="w-[13%]" />
                <col className="w-[30%]" />
                <col className="w-[8%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    No.
                  </th>
                  <th scope="col" className={TH}>
                    Item &amp; place
                  </th>
                  <th scope="col" className={TH}>
                    Responsible officer
                  </th>
                  <th scope="col" className={TH}>
                    Why flagged
                  </th>
                  <th scope="col" className={TH}>
                    Score
                  </th>
                  <th scope="col" className={TH}>
                    Suggested action
                  </th>
                  <th scope="col" className={TH}>
                    Existing action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.key} className="avoid-break">
                    <td className={cx(TD, 'tabular font-bold')}>{i + 1}</td>
                    <td className={TD}>
                      <div className="font-semibold text-ink">{it.title}</div>
                      <div className="mt-0.5 text-ink-3">{AGENDA_CATEGORY_LABEL[it.category]}</div>
                      <div className="text-ink-3">
                        {it.blockName ? `${it.blockName} block` : 'District-wide'}
                        {it.departmentNames.filter(Boolean).length ? ` · ${it.departmentNames.filter(Boolean).join(', ')}` : ''}
                      </div>
                      {it.timesFlaggedBefore > 0 && (
                        <div className="mt-0.5 font-semibold text-warn">
                          Flagged in {it.timesFlaggedBefore} earlier meeting{it.timesFlaggedBefore > 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td className={TD}>
                      <div className="font-semibold text-ink">{it.officerName ?? 'Not assigned'}</div>
                      {it.officerDesignation && <div className="text-ink-3">{it.officerDesignation}</div>}
                    </td>
                    <td className={TD}>
                      <ul className="list-disc space-y-0.5 pl-3.5 text-ink-2">
                        {it.reasons.map((r, k) => (
                          <li key={k}>{r}</li>
                        ))}
                      </ul>
                    </td>
                    <td className={TD}>
                      <div className="tabular text-[15px] font-bold leading-none text-ink print:text-[12px]">{it.score}</div>
                      <div className={cx('mt-0.5 font-semibold', TONE[bandTone(it.band)].text)}>{BAND_LABEL[it.band]}</div>
                    </td>
                    <td className={TD}>
                      <div className="text-ink">{it.suggestedAction}</div>
                      <div className="mt-0.5 text-ink-3">Within {it.suggestedDeadlineDays} days</div>
                    </td>
                    <td className={TD}>
                      {it.openActions.length ? (
                        <ul className="space-y-1">
                          {it.openActions.map((o) => (
                            <li key={o.id}>
                              <span className={cx('font-semibold', TONE[actionTone(o.status)].text)}>{actionLabel(o.status)}</span>
                              <span className="text-ink-2">, due {fmtDate(o.deadline)}</span>
                              {o.overdue && <span className="font-semibold text-bad"> — overdue</span>}
                              {o.assignee && <div className="text-ink-3">{o.assignee}</div>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-ink-3">None — decision required</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded border border-line px-3 py-4 text-center text-[12px] text-ink-3">No item crosses the review thresholds under this scope.</p>
        )}
      </Section>

      {/* 3. Action-taken report */}
      <Section n={3} title="Action-taken report" className={items.length > 6 ? 'print-break' : undefined}>
        <p className="mb-2 text-[11.5px] text-ink-3 print:text-[10px]">
          All open review actions, and actions closed in the last 30 days. An action closes only after the DM / DDC verifies the evidence submitted.
        </p>
        {b.actions.length ? (
          <div className="relative overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-[11.5px] leading-snug print:min-w-0 print:text-[9.5px]">
              <caption className="sr-only">Action-taken report on review decisions</caption>
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[33%]" />
                <col className="w-[19%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    No.
                  </th>
                  <th scope="col" className={TH}>
                    Action &amp; decision
                  </th>
                  <th scope="col" className={TH}>
                    Assignee
                  </th>
                  <th scope="col" className={TH}>
                    Deadline
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={cx(TH, 'text-right')}>
                    Days overdue
                  </th>
                  <th scope="col" className={TH}>
                    Evidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.actions.map((a, i) => {
                  const ev = evidenceState(a);
                  return (
                    <tr key={a.id} className="avoid-break">
                      <td className={cx(TD, 'tabular font-bold')}>{i + 1}</td>
                      <td className={TD}>
                        <div className="font-semibold text-ink">{a.title}</div>
                        <div className="mt-0.5 text-ink-2">{a.decision}</div>
                        {a.progress_note && <div className="mt-0.5 text-ink-3">Progress: {a.progress_note}</div>}
                        {a.meetingTitle && (
                          <div className="mt-0.5 text-ink-3">
                            Decided in: {a.meetingTitle.title}, {fmtDate(a.meetingTitle.meeting_date)}
                          </div>
                        )}
                      </td>
                      <td className={TD}>
                        <div className="font-semibold text-ink">{a.assigneeName}</div>
                        {a.assigneeDesignation && <div className="text-ink-3">{a.assigneeDesignation}</div>}
                        <div className="text-ink-3">{[a.departmentName, a.blockName ? `${a.blockName} block` : null].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className={cx(TD, 'tabular')}>{fmtDate(a.deadline)}</td>
                      <td className={cx(TD, 'font-semibold', TONE[actionTone(a.status)].text)}>
                        {a.statusLabel}
                        {a.status === 'closed' && a.closed_at && <div className="font-normal text-ink-3">on {fmtDate(a.closed_at)}</div>}
                      </td>
                      <td className={cx(TD, 'tabular text-right')}>{a.overdueBy > 0 ? <span className="font-bold text-bad">{a.overdueBy}</span> : <span className="text-ink-3">—</span>}</td>
                      <td className={cx(TD, 'font-semibold', TONE[ev.tone].text)}>{ev.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded border border-line px-3 py-4 text-center text-[12px] text-ink-3">No review actions in scope.</p>
        )}
      </Section>

      {/* Signatures */}
      <footer className="avoid-break mt-12">
        <div className="grid grid-cols-2 gap-8 sm:gap-16">
          {['Deputy Development Commissioner', 'District Magistrate'].map((who) => (
            <div key={who} className="text-center">
              <div className="h-12" aria-hidden />
              <div className="border-t border-ink pt-1.5 text-[12px] font-semibold text-ink print:text-[10.5px]">{who}</div>
              <div className="text-[11px] text-ink-3 print:text-[10px]">Khagaria</div>
            </div>
          ))}
        </div>
        <p className="mt-8 border-t border-line pt-2 text-[10.5px] leading-relaxed text-ink-3 print:text-[9px]">
          Generated by Zila Samanvay on {fmtDateTime(b.generatedAt)} for {b.generatedBy}. The ranking, reasons and action status are computed from the records at that moment; open
          the Review module for the score breakdown of any item. Prototype — all names and figures are synthetic.
        </p>
      </footer>
    </>
  );
}
