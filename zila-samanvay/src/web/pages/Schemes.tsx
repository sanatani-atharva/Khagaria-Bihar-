import { FileUp, Grid3x3, List, Pencil, Target, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ProcOutput } from '../../core/rpc';
import { fmtMonth } from '../../core/time';
import { ratioLabel, toId, useUrlParams } from '../components/works/shared';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, FilterSelect, Input, Kpi, LinkButton, Modal, PageHeader, Progress, Segmented,
  Skeleton, SkeletonRows, Sparkline, Table, Td, Textarea, Th, cx,
} from '../components/ui';
import { fmtDate, fmtDateTime, num, pct, ratioTone, relDays, TONE } from '../lib/format';
import { useLookups, useM, useQ } from '../lib/hooks';

type Overview = ProcOutput<'schemes.overview'>;
type SchemeOv = Overview['schemes'][number];
type BlockOv = SchemeOv['blocks'][number];
type View = 'scheme' | 'matrix';

const ratioPct = (r: number) => Math.round(r * 100);

export default function Schemes() {
  const { get, set } = useUrlParams();
  const lookups = useLookups();
  const deptId = toId(get('dept'));
  const view: View = get('view') === 'matrix' ? 'matrix' : 'scheme';
  const hlScheme = toId(get('scheme'));
  const hlBlock = toId(get('block'));
  const q = useQ('schemes.overview', deptId ? { departmentId: deptId } : {});
  const [editing, setEditing] = useState<{ scheme: SchemeOv; row: BlockOv } | null>(null);
  const [targeting, setTargeting] = useState<{ scheme: SchemeOv; row: BlockOv } | null>(null);

  const d = q.data;

  // Bring a linked (scheme, block) row into view once per highlight, not on every refetch.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (view === 'matrix') scrolledFor.current = null;
    if (view !== 'scheme' || !d || !hlScheme) return;
    const key = `${hlScheme}-${hlBlock ?? ''}`;
    if (scrolledFor.current === key) return;
    const el = document.getElementById(hlBlock ? `sg-${hlScheme}-${hlBlock}` : `scheme-${hlScheme}`);
    if (el) {
      scrolledFor.current = key;
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [view, d, hlScheme, hlBlock]);

  const stats = useMemo(() => {
    const pairs = d?.schemes.flatMap((s) => s.blocks) ?? [];
    return {
      schemes: d?.schemes.length ?? 0,
      pairs: pairs.length,
      gap: pairs.filter((b) => b.band === 'gap').length,
      watch: pairs.filter((b) => b.band === 'watch').length,
      ok: pairs.filter((b) => b.band === 'ok').length,
      persistent: pairs.filter((b) => b.gapStreak >= 2).length,
    };
  }, [d]);

  const highlighted = d && hlScheme ? d.schemes.find((s) => s.id === hlScheme) : undefined;
  const highlightedBlock = highlighted && hlBlock ? highlighted.blocks.find((b) => b.blockId === hlBlock) : undefined;
  const gapPct = d ? Math.round(d.thresholds.gap * 100) : 75;
  const watchPct = d ? Math.round(d.thresholds.watch * 100) : 90;

  return (
    <>
      <PageHeader
        title="Schemes & service delivery"
        hindi="योजनाएँ एवं सेवाएँ"
        subtitle={
          d
            ? `FY ${d.fy} · as of ${fmtDate(d.asOf)}. ${pct(d.expectedShare, 1)} of the year has elapsed, so each block is expected to have reached ${pct(d.expectedShare, 1)} of its annual target (its pro-rata target).`
            : 'Block-wise achievement of non-works programmes against their annual targets, compared with the pro-rata target to date.'
        }
        actions={
          <LinkButton to="/works/import?dataset=schemes" icon={<FileUp className="size-4" aria-hidden />}>
            Import MIS export
          </LinkButton>
        }
      />

      {/* Thresholds */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span className="font-semibold">Bands, as a share of the pro-rata target:</span>
        <Badge tone="ok">On target · {watchPct}% or more</Badge>
        <Badge tone="warn">
          Watch · {gapPct}–{watchPct}%
        </Badge>
        <Badge tone="bad">Service gap · below {gapPct}%</Badge>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!d ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[98px]" />)
        ) : (
          <>
            <Kpi label="Schemes monitored" value={stats.schemes} sub={`${stats.pairs} block targets`} />
            <Kpi label="Service gaps" value={stats.gap} tone={stats.gap ? 'bad' : 'ok'} sub={`Below ${gapPct}% of pro-rata`} />
            <Kpi label="On watch" value={stats.watch} tone={stats.watch ? 'warn' : undefined} sub={`${gapPct}–${watchPct}% of pro-rata`} />
            <Kpi label="Persistent gaps" value={stats.persistent} tone={stats.persistent ? 'bad' : undefined} sub={`Below ${gapPct}% for 2+ months running`} />
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <FilterSelect
          label="Department"
          value={deptId ? String(deptId) : ''}
          onChange={(v) => set({ dept: v })}
          options={(lookups.data?.departments ?? []).map((x) => ({ value: String(x.id), label: x.name }))}
          allLabel="All departments"
        />
        <Segmented<View>
          label="View"
          value={view}
          onChange={(v) => set({ view: v === 'matrix' ? 'matrix' : null })}
          options={[
            {
              value: 'scheme',
              label: (
                <>
                  <List className="size-3.5" aria-hidden /> By scheme
                </>
              ),
            },
            {
              value: 'matrix',
              label: (
                <>
                  <Grid3x3 className="size-3.5" aria-hidden /> Matrix
                </>
              ),
            },
          ]}
        />
      </div>

      {highlighted && view === 'scheme' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2 text-[13px] text-ink">
          <span>
            Showing <span className="font-semibold">{highlighted.name}</span>
            {highlightedBlock ? (
              <>
                {' '}
                in <span className="font-semibold">{highlightedBlock.blockName}</span>
              </>
            ) : null}
          </span>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" aria-hidden />} onClick={() => set({ scheme: null, block: null })}>
            Clear highlight
          </Button>
        </div>
      )}

      {q.isLoading ? (
        <Card>
          <SkeletonRows rows={8} />
        </Card>
      ) : q.error && !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || d.schemes.length === 0 ? (
        <Card>
          <EmptyState title={deptId ? 'No scheme targets for this department' : 'No scheme targets in your jurisdiction'} icon={<Target className="size-8" aria-hidden />}>
            Annual block targets are set by the department at the start of the financial year. Achievement can then be updated here or imported from the MIS export.
          </EmptyState>
        </Card>
      ) : (
        <div className={cx('transition-opacity', q.isFetching && q.isPlaceholderData && 'opacity-60')}>
          {view === 'matrix' ? (
            <Matrix data={d} onPick={(s, b) => set({ scheme: s, block: b, view: null })} />
          ) : (
            <div className="flex flex-col gap-4">
              {d.schemes.map((s) => (
                <SchemeCard
                  key={s.id}
                  s={s}
                  expectedShare={d.expectedShare}
                  gapPct={gapPct}
                  highlightBlock={hlScheme === s.id ? hlBlock : null}
                  highlightCard={hlScheme === s.id && !hlBlock}
                  onEdit={(row) => setEditing({ scheme: s, row })}
                  onTarget={(row) => setTargeting({ scheme: s, row })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <UpdateModal target={editing} onClose={() => setEditing(null)} />
      <TargetModal target={targeting} onClose={() => setTargeting(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function SchemeCard({
  s, expectedShare, gapPct, highlightBlock, highlightCard, onEdit, onTarget,
}: { s: SchemeOv; expectedShare: number; gapPct: number; highlightBlock: number | null; highlightCard: boolean; onEdit: (row: BlockOv) => void; onTarget: (row: BlockOv) => void }) {
  const dt = ratioTone(s.district.ratio);
  return (
    <section id={`scheme-${s.id}`} className={cx('scroll-mt-20 rounded-[var(--radius-card)]', highlightCard && 'ring-2 ring-accent')}>
      <Card>
        <CardHeader
          title={
            <>
              {s.name}{' '}
              <span lang="hi" className="hi ml-1 text-sm font-normal text-ink-3">
                {s.name_hi}
              </span>
            </>
          }
          subtitle={
            <>
              <span className="tabular font-semibold text-ink-2">{s.code}</span> · {s.indicator} · {s.departmentName}
            </>
          }
          actions={
            <>
              <Badge tone={dt}>
                District {ratioPct(s.district.ratio)}% of pro-rata · {ratioLabel(dt)}
              </Badge>
              <Badge tone={s.gapBlocks ? 'bad' : 'ok'}>{s.gapBlocks ? `${s.gapBlocks} gap block${s.gapBlocks === 1 ? '' : 's'}` : 'No gap blocks'}</Badge>
            </>
          }
        />
        <div className="grid gap-3 border-b border-line px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
          <p className="text-ink-2">
            District achieved <span className="tabular font-bold text-ink">{num(s.district.achieved)}</span> of{' '}
            <span className="tabular font-semibold">{num(s.district.annualTarget)}</span> {s.unit} ({pct(s.district.pctOfAnnual, 1)} of annual) · expected by today{' '}
            <span className="tabular font-semibold">{num(s.district.expected)}</span>
          </p>
          <Progress value={s.district.pctOfAnnual} expected={expectedShare} tone={dt} label={`${s.name}: district share of annual target achieved`} />
        </div>
        <Table caption={`${s.name} — block-wise achievement`}>
          <thead>
            <tr>
              <Th>Block</Th>
              <Th align="right">Annual target</Th>
              <Th align="right">Achieved</Th>
              <Th align="right">Expected by today</Th>
              <Th>Against pro-rata</Th>
              <Th align="right">Of annual</Th>
              <Th>Trend</Th>
              <Th>Officer</Th>
              <Th>Last updated</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {s.blocks.map((b) => {
              const tone = ratioTone(b.ratio);
              const hl = highlightBlock === b.blockId;
              const first = b.trend[0];
              const last = b.trend[b.trend.length - 1];
              return (
                <tr key={b.targetId} id={`sg-${s.id}-${b.blockId}`} className={cx('scroll-mt-20', hl ? 'bg-accent-soft outline-2 -outline-offset-2 outline-accent' : 'hover:bg-subtle/60')} aria-current={hl ? 'true' : undefined}>
                  <Td className="whitespace-nowrap font-semibold text-ink">{b.blockName}</Td>
                  <Td align="right">{num(b.annualTarget)}</Td>
                  <Td align="right" className="font-semibold text-ink">
                    {num(b.achieved)}
                  </Td>
                  <Td align="right">{num(b.expected)}</Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={tone}>
                      {ratioPct(b.ratio)}% · {ratioLabel(tone)}
                    </Badge>
                    {b.gapStreak >= 2 && <div className="mt-1 text-xs font-semibold text-bad">Below {gapPct}% for {b.gapStreak} months running</div>}
                  </Td>
                  <Td align="right">{pct(b.pctOfAnnual, 1)}</Td>
                  <Td>
                    {b.trend.length > 1 ? (
                      <>
                        <Sparkline values={b.trend.map((t) => t.cumulative)} expected={b.trend.map((t) => t.expected)} tone={tone} />
                        <span className="sr-only">
                          Cumulative {num(first.cumulative)} in {fmtMonth(first.month)} to {num(last.cumulative)} in {fmtMonth(last.month)}, against {num(last.expected)} expected.
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </Td>
                  <Td className="min-w-36">
                    {b.officerName ? (
                      <>
                        <div className="font-semibold text-ink">{b.officerName}</div>
                        {b.officerDesignation && <div className="text-xs text-ink-3">{b.officerDesignation}</div>}
                      </>
                    ) : (
                      <span className="text-ink-3">Not assigned</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span title={fmtDateTime(b.updatedAt)}>{relDays(b.updatedAt)}</span>
                    <div className="mt-0.5">
                      <Badge tone={b.source === 'import' ? 'info' : 'muted'}>{b.source === 'import' ? 'MIS import' : 'Manual'}</Badge>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      {b.canEdit && (
                        <Button size="sm" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => onEdit(b)} aria-label={`Update ${s.name} achievement for ${b.blockName}`}>
                          Update
                        </Button>
                      )}
                      {s.canSetTarget && (
                        <Button size="sm" variant="ghost" icon={<Target className="size-3.5" aria-hidden />} onClick={() => onTarget(b)} aria-label={`Set ${s.name} annual target for ${b.blockName}`}>
                          Target
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="px-4 py-2 text-xs text-ink-3">Trend: solid line is the cumulative achievement month by month; dashed line is the pro-rata expectation.</p>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Matrix({ data, onPick }: { data: Overview; onPick: (schemeId: number, blockId: number) => void }) {
  const lookups = useLookups();
  const blocks = useMemo(() => {
    const ids = new Map<number, string>();
    for (const s of data.schemes) for (const b of s.blocks) ids.set(b.blockId, b.blockName);
    const order = lookups.data?.blocks.map((b) => b.id) ?? [];
    return Array.from(ids, ([id, name]) => ({ id, name })).sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return ia >= 0 && ib >= 0 ? ia - ib : a.name.localeCompare(b.name);
    });
  }, [data, lookups.data]);

  return (
    <Card>
      <CardHeader title="Scheme × block matrix" subtitle="Each cell is achievement as a share of the pro-rata target to date. Select a cell to open that block's row." />
      <Table caption="Achievement against pro-rata target by scheme and block">
        <thead>
          <tr>
            <Th className="sticky left-0 z-[2] min-w-48">Scheme</Th>
            {blocks.map((b) => (
              <Th key={b.id} align="center">
                {b.name}
              </Th>
            ))}
            <Th align="center">District</Th>
          </tr>
        </thead>
        <tbody>
          {data.schemes.map((s) => {
            const dt = ratioTone(s.district.ratio);
            return (
              <tr key={s.id}>
                <th scope="row" className="sticky left-0 z-[1] border-b border-line bg-panel px-3 py-2 text-left align-middle">
                  <div className="text-[13px] font-semibold text-ink">{s.name}</div>
                  <div className="text-xs font-normal text-ink-3">{s.departmentName}</div>
                </th>
                {blocks.map((blk) => {
                  const cell = s.blocks.find((b) => b.blockId === blk.id);
                  if (!cell)
                    return (
                      <td key={blk.id} className="border-b border-line px-1 py-1 text-center text-ink-3">
                        <span aria-label="No target">—</span>
                      </td>
                    );
                  const tone = ratioTone(cell.ratio);
                  return (
                    <td key={blk.id} className="border-b border-line p-1">
                      <button
                        type="button"
                        onClick={() => onPick(s.id, blk.id)}
                        className={cx(
                          'flex min-h-12 w-full min-w-16 flex-col items-center justify-center rounded-md border px-1.5 py-1 transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-accent',
                          TONE[tone].bg,
                          TONE[tone].text,
                          TONE[tone].border,
                        )}
                        aria-label={`${s.name}, ${blk.name}: ${ratioPct(cell.ratio)}% of pro-rata, ${ratioLabel(tone)}. Open row.`}
                        title={`${num(cell.achieved)} of ${num(cell.expected)} expected by today`}
                      >
                        <span className="tabular text-sm font-bold">{ratioPct(cell.ratio)}%</span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide">{tone === 'bad' ? 'Gap' : tone === 'warn' ? 'Watch' : 'OK'}</span>
                      </button>
                    </td>
                  );
                })}
                <td className="border-b border-line bg-subtle/60 px-2 py-1 text-center">
                  <span className={cx('tabular text-sm font-bold', TONE[dt].text)}>{ratioPct(s.district.ratio)}%</span>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{ratioLabel(dt)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function UpdateModal({ target, onClose }: { target: { scheme: SchemeOv; row: BlockOv } | null; onClose: () => void }) {
  const [achieved, setAchieved] = useState('');
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<{ achieved?: string; remark?: string }>({});
  const m = useM('schemes.update', { success: 'Achievement updated' });

  useEffect(() => {
    if (target) {
      setAchieved(String(target.row.achieved));
      setRemark('');
      setErrors({});
    }
  }, [target]);

  if (!target) return null;
  const { scheme: s, row: b } = target;
  const max = Math.floor(b.annualTarget * 1.5);
  const n = Number(achieved);

  const close = () => {
    if (!m.isPending) onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: typeof errors = {};
    if (achieved.trim() === '' || !Number.isFinite(n)) err.achieved = 'Enter the cumulative achievement as a number.';
    else if (n < 0) err.achieved = 'Achievement cannot be negative.';
    else if (n > max) err.achieved = `More than 150% of the annual target (${num(b.annualTarget)}) — check the figure.`;
    if (remark.trim().length < 3) err.remark = 'Add a short remark (source of the figure, at least 3 characters).';
    setErrors(err);
    if (Object.keys(err).length) return;
    m.mutate({ schemeId: s.id, blockId: b.blockId, achieved: n, remark: remark.trim() }, { onSuccess: () => onClose() });
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Update achievement · ${b.blockName}`}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="scheme-update-form" loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="scheme-update-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">
          <div className="font-semibold text-ink">{s.name}</div>
          <div>{s.indicator}</div>
          <div className="mt-1 tabular">
            Annual target {num(b.annualTarget)} · current {num(b.achieved)} · expected by today {num(b.expected)} {s.unit}
          </div>
        </div>
        <Field
          label={`Cumulative achieved this year (${s.unit})`}
          required
          error={errors.achieved}
          help={
            achieved !== '' && Number.isFinite(n) && n < b.achieved
              ? 'Lower than the current figure — cumulative totals normally only rise. Explain the correction in the remark.'
              : `Year-to-date total. Updates this month's figure. ${achieved !== '' && Number.isFinite(n) ? `New position: ${ratioPct(n / b.expected)}% of pro-rata.` : ''}`
          }
        >
          {(fid) => (
            <Input id={fid} type="number" inputMode="numeric" min={0} step={1} value={achieved} onChange={(e) => setAchieved(e.target.value)} aria-invalid={!!errors.achieved} />
          )}
        </Field>
        <Field label="Remark" required error={errors.remark} help="Recorded in the audit trail.">
          {(fid) => (
            <Textarea
              id={fid}
              rows={3}
              maxLength={300}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="e.g. As per HMIS report dated 15-Nov; 3 catch-up sessions held."
              aria-invalid={!!errors.remark}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** Define or revise a block's annual target (DM, DDC or the scheme's district officer). */
function TargetModal({ target, onClose }: { target: { scheme: SchemeOv; row: BlockOv } | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ value?: string; reason?: string }>({});
  const m = useM('schemes.setTarget', { success: 'Annual target saved' });

  useEffect(() => {
    if (target) {
      setValue(String(target.row.annualTarget));
      setReason('');
      setErrors({});
    }
  }, [target]);

  if (!target) return null;
  const { scheme: s, row: b } = target;
  const n = Number(value);
  const close = () => {
    if (!m.isPending) onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: typeof errors = {};
    if (value.trim() === '' || !Number.isFinite(n) || n <= 0) err.value = 'Enter the annual target as a positive number.';
    if (reason.trim().length < 3) err.reason = 'Give the basis for the target (at least 3 characters).';
    setErrors(err);
    if (Object.keys(err).length) return;
    m.mutate({ schemeId: s.id, blockId: b.blockId, annualTarget: Math.round(n), reason: reason.trim() }, { onSuccess: () => onClose() });
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Annual target · ${b.blockName}`}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="scheme-target-form" loading={m.isPending}>
            Save target
          </Button>
        </>
      }
    >
      <form id="scheme-target-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">
          <div className="font-semibold text-ink">{s.name}</div>
          <div>{s.indicator}</div>
          <div className="tabular mt-1">
            Current target {num(b.annualTarget)} · achieved so far {num(b.achieved)} {s.unit}
          </div>
        </div>
        <Field
          label={`Annual target for the financial year (${s.unit})`}
          required
          error={errors.value}
          help={value !== '' && Number.isFinite(n) && n > 0 ? `Pro-rata expectation and gap flags are recalculated from this figure. Current achievement would be ${Math.round((b.achieved / n) * 100)}% of the year's target.` : 'Pro-rata expectation and gap flags are recalculated from this figure.'}
        >
          {(fid) => <Input id={fid} type="number" inputMode="numeric" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!errors.value} />}
        </Field>
        <Field label="Basis / order reference" required error={errors.reason} help="Recorded in the audit trail.">
          {(fid) => (
            <Textarea id={fid} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. As per department letter fixing FY targets; population-based share." aria-invalid={!!errors.reason} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
