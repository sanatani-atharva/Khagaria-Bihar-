import {
  ChevronDown, ChevronRight, CircleAlert, CircleCheck, ClipboardPaste, Download, FileSpreadsheet, HardHat, ListChecks, RotateCcw, Target, Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProcInput } from '../../core/rpc';
import { addDays } from '../../core/time';
import { useUrlParams } from '../components/works/shared';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Kpi, LinkButton, PageHeader, Pagination, Segmented, Select, SkeletonRows, Table, Td,
  Textarea, Th, cx,
} from '../components/ui';
import { downloadText } from '../lib/files';
import { fmtDateTime, today } from '../lib/format';
import { useLookups, useM, useMe, useQ } from '../lib/hooks';
import { parseCsv, readSheet, toCsv, type Grid } from '../lib/sheets';
import worksSampleCsv from '../../../samples/works-progress-sample.csv?raw';
import schemesSampleCsv from '../../../samples/scheme-progress-sample.csv?raw';

const SAMPLE_CSV: Record<Dataset, string> = { works: worksSampleCsv, schemes: schemesSampleCsv };

type Dataset = 'works' | 'schemes';
type WorkImportRow = ProcInput<'works.import'>['rows'][number];
type SchemeImportRow = ProcInput<'schemes.import'>['rows'][number];

interface FieldDef {
  key: string;
  label: string;
  synonyms: string[];
  required?: boolean;
  help?: string;
}

const WORK_FIELDS: FieldDef[] = [
  { key: 'code', label: 'Work code', synonyms: ['work id', 'work code', 'code', 'id', 'work no', 'work number'], help: 'Matches an existing work; leave blank for a new work' },
  { key: 'name', label: 'Name of work', synonyms: ['name of work', 'work name', 'name', 'name of the work', 'work'] },
  { key: 'block', label: 'Block', synonyms: ['block', 'prakhand', 'block name'] },
  { key: 'department', label: 'Department', synonyms: ['department', 'dept', 'vibhag', 'department name'] },
  { key: 'panchayat', label: 'Panchayat', synonyms: ['panchayat', 'gram panchayat', 'gp'] },
  { key: 'scheme', label: 'Scheme', synonyms: ['scheme', 'scheme name', 'yojana'] },
  { key: 'category', label: 'Category', synonyms: ['category', 'type', 'work type', 'type of work'] },
  {
    key: 'sanctioned',
    label: 'Sanctioned (₹ lakh)',
    synonyms: ['sanctioned', 'sanction amount', 'aa amount', 'estimated cost', 'amount (lakh)', 'sanctioned amount', 'sanctioned cost', 'amount'],
  },
  { key: 'expenditure', label: 'Expenditure (₹ lakh)', synonyms: ['expenditure', 'spent', 'exp', 'exp incurred', 'expenditure incurred', 'total expenditure', 'expenditure till date', 'amount spent'] },
  { key: 'physical', label: 'Physical progress (%)', synonyms: ['physical', 'physical %', 'progress', 'physical progress', 'physical progress %', 'progress %'] },
  { key: 'agency', label: 'Executing agency', synonyms: ['agency', 'contractor', 'executing agency', 'name of agency'] },
  { key: 'start', label: 'Start date', synonyms: ['start date', 'date of start', 'start', 'commencement date'] },
  { key: 'target', label: 'Target date', synonyms: ['target date', 'completion date', 'scheduled completion', 'tdc', 'target', 'date of completion'] },
  { key: 'status', label: 'Status', synonyms: ['status', 'work status', 'current status'] },
  { key: 'nextAction', label: 'Next action', synonyms: ['next action', 'action required', 'next step'] },
  { key: 'remark', label: 'Remark', synonyms: ['remark', 'remarks', 'comment', 'comments'] },
];

const SCHEME_FIELDS: FieldDef[] = [
  { key: 'scheme', label: 'Scheme code or name', synonyms: ['scheme', 'scheme code', 'scheme name', 'programme', 'yojana'], required: true },
  { key: 'block', label: 'Block', synonyms: ['block', 'prakhand', 'block name'], required: true },
  {
    key: 'achieved',
    label: 'Cumulative achievement',
    synonyms: ['achieved', 'achievement', 'cumulative', 'cumulative achievement', 'cumulative achieved', 'total achieved', 'progress'],
    required: true,
    help: 'Year-to-date total, not the monthly figure',
  },
];

const DATASETS: Record<Dataset, { title: string; sub: string; fields: FieldDef[]; max: number; template: string; sample: string; back: string; backLabel: string }> = {
  works: {
    title: 'Public works progress sheet',
    sub: 'RWD / PHED / Building division progress statements. Matched by work code (or name + block): existing works are updated, new ones created.',
    fields: WORK_FIELDS,
    max: 5000,
    template: 'works-progress-template.csv',
    sample: 'samples/works-progress-sample.csv',
    back: '/works',
    backLabel: 'Open works register',
  },
  schemes: {
    title: 'Scheme achievement MIS export',
    sub: 'Block-wise cumulative achievement from the department MIS (HMIS, e-Kalyan, AwaasSoft…). Updates the current month figure for each block.',
    fields: SCHEME_FIELDS,
    max: 2000,
    template: 'scheme-progress-template.csv',
    sample: 'samples/scheme-progress-sample.csv',
    back: '/schemes',
    backLabel: 'Open scheme monitoring',
  },
};

/**
 * Text-length limits of the works.import / schemes.import row schemas. One over-long cell makes
 * the server reject the whole batch, so cells are checked here first and reported by sheet row.
 */
const MAX_LEN: Record<string, number> = {
  code: 60, name: 300, department: 80, block: 80, panchayat: 80, scheme: 120, category: 80, agency: 160, status: 40, nextAction: 400, remark: 400,
};

type Action = 'create' | 'update' | 'unchanged' | 'error';
interface ResultRow {
  row: number;
  action: Action;
  label: string;
  sub: string | null;
  messages: string[];
}
interface Outcome {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  results: ResultRow[];
}

const ACTION_BADGE: Record<Action, { tone: 'ok' | 'info' | 'muted' | 'bad'; label: string }> = {
  create: { tone: 'ok', label: 'Create' },
  update: { tone: 'info', label: 'Update' },
  unchanged: { tone: 'muted', label: 'No change' },
  error: { tone: 'bad', label: 'Error' },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const colLetter = (i: number): string => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const ddmmyyyy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');

/** Map sheet headers to target fields: exact synonym first, then "header contains synonym". */
function autoMap(headers: string[], fields: FieldDef[]): Record<string, number> {
  const nh = headers.map(norm);
  const used = new Set<number>();
  const map: Record<string, number> = {};
  for (const f of fields) {
    for (const s of f.synonyms.map(norm)) {
      const i = nh.findIndex((h, idx) => h === s && !used.has(idx));
      if (i >= 0) {
        map[f.key] = i;
        used.add(i);
        break;
      }
    }
  }
  for (const f of fields) {
    if (map[f.key] !== undefined) continue;
    for (const s of f.synonyms.map(norm).filter((x) => x.length >= 5)) {
      const i = nh.findIndex((h, idx) => !used.has(idx) && h.includes(s));
      if (i >= 0) {
        map[f.key] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

/** Excel copies to the clipboard as tab-separated text; everything else is treated as CSV. */
function parsePasted(text: string): Grid {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (firstLine.includes('\t')) {
    return text
      .split(/\r?\n/)
      .map((l) => l.split('\t').map((c) => c.replace(/^"(.*)"$/, '$1').trim()))
      .filter((r) => r.some((c) => c !== ''));
  }
  return parseCsv(text);
}

export default function WorksImport() {
  const { get, set } = useUrlParams();
  const dataset: Dataset = get('dataset') === 'schemes' ? 'schemes' : 'works';
  const cfg = DATASETS[dataset];

  const [grid, setGrid] = useState<Grid | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [check, setCheck] = useState<Outcome | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);
  const [running, setRunning] = useState<null | 'check' | 'import'>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  const reset = () => {
    setGrid(null);
    setFileName('');
    setMapping({});
    setLoadErr(null);
    setPasteText('');
    setPasteOpen(false);
    setCheck(null);
    setDone(null);
    setRunErr(null);
  };

  // Switching dataset starts over: the mapping and validation belong to one dataset.
  useEffect(reset, [dataset]);

  const headers = useMemo(() => (grid ? grid[0].map((h, i) => h.trim() || `Column ${colLetter(i)}`) : []), [grid]);

  const rows = useMemo(() => {
    if (!grid) return [] as Record<string, string>[];
    return grid.slice(1).map((r) => {
      const o: Record<string, string> = {};
      for (const f of cfg.fields) {
        const idx = mapping[f.key];
        if (idx === undefined || idx < 0) continue;
        const v = String(r[idx] ?? '').trim();
        if (v !== '') o[f.key] = v;
      }
      return o;
    });
  }, [grid, mapping, cfg.fields]);

  // A changed mapping makes an earlier validation stale.
  useEffect(() => {
    setCheck(null);
    setRunErr(null);
  }, [rows]);

  const accept = (g: Grid, name: string) => {
    if (g.length < 2) {
      setLoadErr('The sheet needs a header row and at least one data row.');
      return;
    }
    if (g.length - 1 > cfg.max) {
      setLoadErr(`This sheet has ${g.length - 1} data rows; one import can take up to ${cfg.max}. Split the file and import it in parts.`);
      return;
    }
    setLoadErr(null);
    setGrid(g);
    setFileName(name);
    setMapping(autoMap(g[0], cfg.fields));
    setCheck(null);
    setDone(null);
    setPasteOpen(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15_000_000) {
      setLoadErr('File is larger than 15 MB. Export only the columns needed, or split it.');
      return;
    }
    setReading(true);
    try {
      accept(await readSheet(file), file.name);
    } catch (e) {
      setLoadErr((e as Error).message || 'Could not read this file. Save it as .csv or .xlsx and try again.');
    } finally {
      setReading(false);
    }
  };

  const mapped = cfg.fields.filter((f) => (mapping[f.key] ?? -1) >= 0);
  const missingRequired = cfg.fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0);
  const worksKeyMissing = dataset === 'works' && (mapping.code ?? -1) < 0 && (mapping.name ?? -1) < 0;
  const tooLong = useMemo(() => {
    const out: { row: number; label: string; max: number }[] = [];
    rows.forEach((r, i) => {
      for (const f of cfg.fields) {
        const max = MAX_LEN[f.key];
        if (max && (r[f.key]?.length ?? 0) > max) out.push({ row: i + 2, label: f.label, max });
      }
    });
    return out;
  }, [rows, cfg.fields]);
  const canValidate = !!grid && missingRequired.length === 0 && !worksKeyMissing && tooLong.length === 0 && rows.length > 0;

  // ---- server calls ----
  const worksM = useM('works.import', { success: (o) => (o.dryRun ? '' : `Imported ${fileName}: ${o.created} created, ${o.updated} updated, ${o.failed} rejected`) });
  const schemesM = useM('schemes.import', { success: (o) => (o.dryRun ? '' : `Imported ${fileName}: ${o.updated} block figures updated, ${o.failed} rejected`) });

  const run = async (dryRun: boolean) => {
    setRunning(dryRun ? 'check' : 'import');
    setRunErr(null);
    try {
      let out: Outcome;
      if (dataset === 'works') {
        const o = await worksM.mutateAsync({ fileName: fileName.slice(0, 200), dryRun, rows: rows as WorkImportRow[] });
        out = { ...o, results: o.results.map((r) => ({ row: r.row, action: r.action, label: r.code ?? '—', sub: r.name, messages: r.messages })) };
      } else {
        const o = await schemesM.mutateAsync({ fileName: fileName.slice(0, 200), dryRun, rows: rows as SchemeImportRow[] });
        out = { ...o, results: o.results.map((r) => ({ row: r.row, action: r.action, label: r.label, sub: null, messages: r.messages })) };
      }
      if (dryRun) setCheck(out);
      else setDone(out);
    } catch (e) {
      setRunErr((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const toImport = check ? check.created + check.updated : 0;
  const step = done ? 6 : check ? 5 : grid && canValidate ? 4 : grid ? 3 : 2;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: dataset === 'works' ? 'Public works' : 'Schemes & services', to: cfg.back },
          { label: 'Import' },
        ]}
        title="Import departmental sheets"
        hindi="डेटा आयात"
        subtitle="Re-use the progress sheets and MIS exports departments already maintain, so nothing is typed twice. Validate first; nothing is saved until you confirm."
      />

      <Stepper step={step} />

      <div className="flex flex-col gap-4">
        {/* Step 1 */}
        <Card>
          <CardHeader title="1. Choose what you are importing" />
          <div className="grid gap-3 p-4 md:grid-cols-2" role="radiogroup" aria-label="Dataset">
            {(Object.keys(DATASETS) as Dataset[]).map((k) => {
              const d = DATASETS[k];
              const active = k === dataset;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => !active && set({ dataset: k === 'works' ? null : k })}
                  className={cx(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    active ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/20' : 'border-line-2 bg-panel hover:bg-subtle',
                  )}
                >
                  <span className={cx('grid size-9 shrink-0 place-items-center rounded-md', active ? 'bg-accent text-white' : 'bg-subtle text-ink-2')} aria-hidden>
                    {k === 'works' ? <HardHat className="size-4" /> : <Target className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{d.title}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-3">{d.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Step 2 */}
        <Card>
          <CardHeader
            title="2. Upload the sheet"
            subtitle={`.csv or .xlsx (first worksheet), first row = column headings, up to ${cfg.max.toLocaleString('en-IN')} rows.`}
            actions={<TemplateButton dataset={dataset} />}
          />
          <div className="p-4">
            {grid ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-4 py-3">
                <FileSpreadsheet className="size-6 text-ok" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{fileName}</div>
                  <div className="text-[13px] text-ink-3">
                    {grid.length - 1} data rows · {headers.length} columns
                  </div>
                </div>
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={reset} disabled={running !== null}>
                  Use a different file
                </Button>
              </div>
            ) : (
              <>
                <DropZone onFile={onFile} busy={reading} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" icon={<ClipboardPaste className="size-4" aria-hidden />} onClick={() => setPasteOpen((x) => !x)} aria-expanded={pasteOpen}>
                    {pasteOpen ? 'Hide paste box' : 'Paste from Excel or CSV instead'}
                  </Button>
                </div>
                {pasteOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <label htmlFor="paste-csv" className="text-[13px] font-semibold text-ink-2">
                      Paste rows including the heading row
                    </label>
                    <Textarea
                      id="paste-csv"
                      rows={7}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      className="font-mono text-xs"
                      placeholder={dataset === 'works' ? 'Work Code,Name of Work,Block,Physical %\nRWD/KHG/2025-26/004,PCC road …,Khagaria,65' : 'Scheme Code,Block,Cumulative Achieved\nHLT-FIC,Alauli,1460'}
                    />
                    <div>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!pasteText.trim()}
                        onClick={() => accept(parsePasted(pasteText), `pasted-${dataset}-${today()}.csv`)}
                      >
                        Use pasted data
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span>No sheet at hand? Try a sample departmental sheet (includes two rows with deliberate errors):</span>
                  <Button size="sm" variant="secondary" onClick={() => accept(parseCsv(SAMPLE_CSV[dataset]), DATASETS[dataset].sample.split('/').pop()!)}>
                    Load sample sheet
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => downloadText(DATASETS[dataset].sample.split('/').pop()!, SAMPLE_CSV[dataset])}>
                    Download sample
                  </Button>
                </div>
                <p className="mt-2 text-xs text-ink-3">Dates may be DD-MM-YYYY, YYYY-MM-DD, 05-Mar-2026 or Excel dates; amounts in ₹ lakh.</p>
              </>
            )}
            {loadErr && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] font-semibold text-bad" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {loadErr}
              </p>
            )}
          </div>
        </Card>

        {/* Step 3 */}
        {grid && (
          <Card>
            <CardHeader
              title="3. Match columns"
              subtitle="Columns were matched automatically from their headings. Correct any that are wrong; unmatched columns are ignored."
              actions={
                <Button size="sm" variant="ghost" onClick={() => setMapping(autoMap(grid[0], cfg.fields))} disabled={running !== null}>
                  Re-run auto-match
                </Button>
              }
            />
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0 border-line lg:border-r">
                <Table caption="Column mapping">
                  <thead>
                    <tr>
                      <Th>Field</Th>
                      <Th>Column in your sheet</Th>
                      <Th>First value</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfg.fields.map((f) => {
                      const idx = mapping[f.key] ?? -1;
                      return (
                        <tr key={f.key}>
                          <Td className="min-w-40">
                            <label htmlFor={`map-${f.key}`} className="font-semibold text-ink">
                              {f.label}
                              {f.required && <span className="text-bad"> *</span>}
                            </label>
                            {f.help && <div className="text-xs text-ink-3">{f.help}</div>}
                          </Td>
                          <Td className="min-w-48">
                            <Select
                              id={`map-${f.key}`}
                              value={String(idx)}
                              onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                              className={cx('h-9 text-[13px]', idx < 0 && f.required && 'border-bad')}
                              disabled={running !== null}
                            >
                              <option value="-1">— not mapped —</option>
                              {headers.map((h, i) => (
                                <option key={i} value={i}>
                                  {colLetter(i)} · {h}
                                </option>
                              ))}
                            </Select>
                          </Td>
                          <Td className="max-w-48 truncate text-ink-3">{idx >= 0 ? rows[0]?.[f.key] ?? '(blank)' : '—'}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <div className="min-w-0 p-4">
                {worksKeyMissing && (
                  <Notice tone="bad">Map at least the Work code (to update existing works) or the Name of work (to create new ones).</Notice>
                )}
                {missingRequired.length > 0 && <Notice tone="bad">Map the required field{missingRequired.length > 1 ? 's' : ''}: {missingRequired.map((f) => f.label).join(', ')}.</Notice>}
                {tooLong.length > 0 && (
                  <Notice tone="bad">
                    {tooLong.length} cell{tooLong.length === 1 ? ' is' : 's are'} too long for the register:{' '}
                    {tooLong
                      .slice(0, 3)
                      .map((t) => `row ${t.row}, ${t.label} (max ${t.max} characters)`)
                      .join('; ')}
                    {tooLong.length > 3 ? '; …' : ''}. Shorten them in the sheet, or unmap that column, and upload again.
                  </Notice>
                )}
                {dataset === 'works' && !worksKeyMissing && (
                  <Notice tone="info">
                    Rows with a known work code update that work. Rows without one create a new work and need Name, Block, Department and Sanctioned amount.
                    Rows outside your jurisdiction are rejected.
                  </Notice>
                )}
                <h3 className="mb-2 mt-1 text-[13px] font-bold uppercase tracking-wide text-ink-3">Preview · first {Math.min(5, rows.length)} rows as they will be read</h3>
                {mapped.length === 0 ? (
                  <p className="text-sm text-ink-3">No columns mapped yet.</p>
                ) : (
                  <div className="rounded-md border border-line">
                    <Table caption="Preview of mapped rows">
                      <thead>
                        <tr>
                          <Th>Row</Th>
                          {mapped.map((f) => (
                            <Th key={f.key}>{f.label}</Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            <Td className="tabular text-ink-3">{i + 2}</Td>
                            {mapped.map((f) => (
                              <Td key={f.key} className="max-w-56 whitespace-nowrap">
                                <span className="block truncate">{r[f.key] ?? <span className="text-ink-3">—</span>}</span>
                              </Td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Step 4 + 5 */}
        {grid && !done && (
          <Card>
            <CardHeader
              title="4. Validate"
              subtitle="Checks every row against the register — codes, blocks, departments, amounts, dates and your jurisdiction. Nothing is saved yet."
              actions={
                <Button
                  variant={check ? 'secondary' : 'primary'}
                  icon={<ListChecks className="size-4" aria-hidden />}
                  loading={running === 'check'}
                  disabled={!canValidate || running !== null}
                  onClick={() => run(true)}
                >
                  {check ? 'Validate again' : `Validate ${rows.length} rows`}
                </Button>
              }
            />
            {running === 'check' && <SkeletonRows rows={4} />}
            {runErr && running === null && (
              <div className="p-4">
                <ErrorState error={{ message: runErr }} onRetry={() => run(!check)} />
              </div>
            )}
            {!check && running !== 'check' && !runErr && (
              <p className="px-4 py-4 text-sm text-ink-3">{canValidate ? 'Run validation to see what will be created, updated or rejected.' : 'Complete the column matching above to continue.'}</p>
            )}
            {check && running !== 'check' && (
              <>
                <OutcomeKpis o={check} dataset={dataset} preview />
                <ResultsTable results={check.results} />
                <div className="flex flex-col gap-3 border-t border-line bg-subtle/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13px] text-ink-2">
                    <span className="font-bold">5. Import.</span>{' '}
                    {toImport > 0
                      ? `${toImport} row${toImport === 1 ? '' : 's'} will be saved${check.failed ? `; ${check.failed} row${check.failed === 1 ? '' : 's'} with errors will be skipped and listed in the import log` : ''}. Every change is recorded in the audit trail.`
                      : 'Nothing to import: every row is either unchanged or has errors. Fix the sheet and upload it again.'}
                  </p>
                  <Button
                    variant="primary"
                    icon={<Upload className="size-4" aria-hidden />}
                    loading={running === 'import'}
                    disabled={toImport === 0 || running !== null}
                    onClick={() => run(false)}
                    className="shrink-0"
                  >
                    Import {toImport} row{toImport === 1 ? '' : 's'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}

        {done && (
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <CircleCheck className="size-5 text-ok" aria-hidden /> Import complete
                </span>
              }
              subtitle={`${fileName} · ${done.total} rows processed`}
              actions={
                <>
                  <LinkButton to={cfg.back} variant="primary">
                    {cfg.backLabel}
                  </LinkButton>
                  <Button icon={<RotateCcw className="size-4" aria-hidden />} onClick={reset}>
                    Import another file
                  </Button>
                </>
              }
            />
            <OutcomeKpis o={done} dataset={dataset} />
            <ResultsTable results={done.results} />
          </Card>
        )}

        <RecentImports />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const STEPS = ['Choose dataset', 'Upload sheet', 'Match columns', 'Validate', 'Import'];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-4 grid grid-cols-5 gap-1.5" aria-label="Import steps">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'todo';
        return (
          <li key={s} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
            <div className={cx('h-1 rounded-full', state === 'done' ? 'bg-ok' : state === 'current' ? 'bg-accent' : 'bg-line-2')} aria-hidden />
            <div className={cx('mt-1.5 flex items-center gap-1 text-xs font-semibold', state === 'todo' ? 'text-ink-3' : 'text-ink')}>
              <span className="tabular">{n}.</span>
              <span className="hidden truncate sm:inline">{s}</span>
              <span className="sr-only sm:hidden">{s}</span>
              {state === 'done' && <span className="sr-only">(done)</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Notice({ tone, children }: { tone: 'bad' | 'info'; children: ReactNode }) {
  return (
    <p
      className={cx(
        'mb-3 rounded-md border px-3 py-2 text-[13px]',
        tone === 'bad' ? 'border-bad/30 bg-bad-soft font-semibold text-bad' : 'border-accent/30 bg-accent-soft/60 text-ink-2',
      )}
      role={tone === 'bad' ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}

function DropZone({ onFile, busy }: { onFile: (f: File | undefined) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFile(e.dataTransfer.files?.[0]);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
        over ? 'border-accent bg-accent-soft/50' : 'border-line-2 bg-subtle/50',
      )}
    >
      <FileSpreadsheet className="size-8 text-ink-3" aria-hidden />
      <p className="text-sm font-semibold text-ink-2">Drop a .csv or .xlsx file here</p>
      <input
        ref={ref}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Choose spreadsheet file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          onFile(f);
        }}
      />
      <Button variant="primary" icon={<Upload className="size-4" aria-hidden />} loading={busy} onClick={() => ref.current?.click()}>
        Choose file
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Template with the expected headings, pre-filled from real records so an update can be demonstrated. */
function TemplateButton({ dataset }: { dataset: Dataset }) {
  const me = useMe();
  const lookups = useLookups();
  const works = useQ('works.list', { pageSize: 5 }, { enabled: dataset === 'works' });
  const schemes = useQ('schemes.overview', {}, { enabled: dataset === 'schemes' });
  const ready = dataset === 'works' ? !!works.data && !!lookups.data : !!schemes.data;
  const failed = dataset === 'works' ? !!works.error : !!schemes.error;

  const build = () => {
    if (dataset === 'works') {
      const list = works.data?.rows ?? [];
      const pick = [...list.filter((w) => w.status !== 'completed'), ...list.filter((w) => w.status === 'completed')].slice(0, 3);
      const header = [
        'Work Code', 'Name of Work', 'Block', 'Department', 'Panchayat', 'Scheme', 'Category', 'Sanctioned (Lakh)', 'Expenditure (Lakh)', 'Physical %',
        'Agency', 'Start Date', 'Target Date', 'Status', 'Next Action', 'Remark',
      ];
      const body = pick.map((w) => {
        const physical = w.physical_pct >= 100 ? 100 : Math.min(99, Math.round((w.physical_pct + 10) * 10) / 10);
        const exp = Math.round(Math.min(w.sanctioned_lakh * 1.2, w.expenditure_lakh + w.sanctioned_lakh * 0.1) * 10) / 10;
        return [
          w.code, w.name, w.blockName, w.departmentName, w.panchayat ?? '', w.scheme, w.category, w.sanctioned_lakh, exp, physical, w.agency ?? '',
          ddmmyyyy(w.start_date), ddmmyyyy(w.target_date), physical >= 100 ? 'Completed' : 'In progress', w.next_action ?? '',
          'Monthly progress statement',
        ];
      });
      const ref = pick[0];
      const blockName = me.data?.blockName ?? ref?.blockName ?? lookups.data?.blocks[0]?.name ?? '';
      const deptName = me.data?.departmentName ?? ref?.departmentName ?? lookups.data?.departments[0]?.name ?? '';
      const t = today();
      body.push([
        '', 'Construction of Anganwadi Centre building (new sanction)', blockName, deptName, ref?.blockName === blockName ? ref?.panchayat ?? '' : '',
        'State Plan', 'Building', 45.5, 0, 0, '', ddmmyyyy(t), ddmmyyyy(addDays(t, 365)), 'Not started', 'Issue work order to the executing agency',
        'New administrative approval',
      ]);
      downloadText(DATASETS.works.template, toCsv([header, ...body]));
    } else {
      const header = ['Scheme Code', 'Block', 'Cumulative Achieved'];
      const body: (string | number)[][] = [];
      for (const s of schemes.data?.schemes ?? []) {
        for (const b of s.blocks) {
          if (!b.canEdit || body.length >= 3) continue;
          body.push([s.code, b.blockName, b.achieved + Math.max(1, Math.round(b.annualTarget * 0.04))]);
        }
        if (body.length >= 3) break;
      }
      downloadText(DATASETS.schemes.template, toCsv([header, ...body]));
    }
  };

  return (
    <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={build} disabled={!ready} loading={!ready && !failed} title={failed ? 'Could not load records for the template' : undefined}>
      Download template
    </Button>
  );
}

// ---------------------------------------------------------------------------

function OutcomeKpis({ o, dataset, preview }: { o: Outcome; dataset: Dataset; preview?: boolean }) {
  return (
    <div className={cx('grid gap-3 p-4', dataset === 'works' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3')}>
      {dataset === 'works' && <Kpi label={preview ? 'Will be created' : 'Created'} value={o.created} tone={o.created ? 'ok' : undefined} />}
      <Kpi label={preview ? 'Will be updated' : 'Updated'} value={o.updated} tone={o.updated ? 'info' : undefined} />
      <Kpi label="Unchanged" value={o.unchanged} />
      <Kpi label={preview ? 'Errors' : 'Rejected'} value={o.failed} tone={o.failed ? 'bad' : undefined} sub={o.failed ? 'Fix in the sheet and re-import' : undefined} />
    </div>
  );
}

type ResultFilter = 'all' | 'error' | 'change' | 'unchanged';
const PAGE = 50;

function ResultsTable({ results }: { results: ResultRow[] }) {
  const counts = {
    all: results.length,
    error: results.filter((r) => r.action === 'error').length,
    change: results.filter((r) => r.action === 'create' || r.action === 'update').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
  };
  const [filter, setFilter] = useState<ResultFilter>(counts.error ? 'error' : 'all');
  const [page, setPage] = useState(1);
  const shown = results.filter((r) =>
    filter === 'all' ? true : filter === 'error' ? r.action === 'error' : filter === 'change' ? r.action === 'create' || r.action === 'update' : r.action === 'unchanged',
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const p = Math.min(page, pages);
  return (
    <div className="border-t border-line">
      <div className="px-4 pt-3">
        <Segmented<ResultFilter>
          label="Filter results"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All rows', count: counts.all },
            { value: 'error', label: 'Errors only', count: counts.error },
            { value: 'change', label: 'Changes', count: counts.change },
            { value: 'unchanged', label: 'Unchanged', count: counts.unchanged },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title={filter === 'error' ? 'No errors — every row passed validation' : 'No rows in this view'} icon={<CircleCheck className="size-8 text-ok" aria-hidden />} />
      ) : (
        <>
          <Table caption="Per-row validation results" className="mt-3">
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Result</Th>
                <Th>Record</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {shown.slice((p - 1) * PAGE, p * PAGE).map((r) => (
                <tr key={r.row} className={cx(r.action === 'error' && 'bg-bad-soft/50')}>
                  <Td className="tabular text-ink-3">{r.row}</Td>
                  <Td>
                    <Badge tone={ACTION_BADGE[r.action].tone}>{ACTION_BADGE[r.action].label}</Badge>
                  </Td>
                  <Td className="min-w-48">
                    <div className="tabular font-semibold text-ink">{r.label}</div>
                    {r.sub && <div className="text-xs text-ink-3">{r.sub}</div>}
                  </Td>
                  <Td className="min-w-64">
                    {r.messages.length ? (
                      <ul className={cx('space-y-0.5 text-[13px]', r.action === 'error' ? 'font-semibold text-bad' : 'text-ink-2')}>
                        {r.messages.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-ink-3">New record</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={p} pages={pages} total={shown.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RecentImports() {
  const q = useQ('import.batches', {});
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Card>
      <CardHeader title="Recent imports" subtitle="Last 50 imports across the district, with rejected rows" />
      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.error && !q.data ? (
        <div className="p-4">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : !q.data?.length ? (
        <EmptyState title="No sheets imported yet">Imports appear here with who ran them and any rows that were rejected.</EmptyState>
      ) : (
        <Table caption="Recent imports">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>File</Th>
              <Th>Dataset</Th>
              <Th>By</Th>
              <Th align="right">Rows</Th>
              <Th align="right">Created</Th>
              <Th align="right">Updated</Th>
              <Th align="right">Rejected</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((b) => {
              const expanded = open === b.id;
              return (
                <ImportRow key={b.id} b={b} expanded={expanded} onToggle={() => setOpen(expanded ? null : b.id)} />
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

interface Batch {
  id: number;
  at: string;
  dataset: string;
  file_name: string;
  userName: string | null;
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
}

function ImportRow({ b, expanded, onToggle }: { b: Batch; expanded: boolean; onToggle: () => void }) {
  const isWorks = b.dataset === 'works';
  return (
    <>
      <tr>
        <Td className="whitespace-nowrap">{fmtDateTime(b.at)}</Td>
        <Td className="min-w-48 break-all font-semibold text-ink">{b.file_name}</Td>
        <Td className="whitespace-nowrap">
          <Link to={isWorks ? '/works' : '/schemes'} className="text-accent hover:underline">
            {isWorks ? 'Public works' : 'Scheme MIS'}
          </Link>
        </Td>
        <Td className="whitespace-nowrap">{b.userName ?? '—'}</Td>
        <Td align="right">{b.total}</Td>
        <Td align="right">{isWorks ? b.created : '—'}</Td>
        <Td align="right">{b.updated}</Td>
        <Td align="right">
          {b.failed > 0 ? (
            <button type="button" onClick={onToggle} aria-expanded={expanded} className="inline-flex items-center gap-1 font-semibold text-bad hover:underline">
              {expanded ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
              {b.failed}
              <span className="sr-only"> rejected rows — {expanded ? 'hide' : 'show'} errors</span>
            </button>
          ) : (
            0
          )}
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="border-b border-line bg-bad-soft/40 px-4 py-3">
            {b.errors.length ? (
              <ul className="space-y-1 text-[13px]">
                {b.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    <span className="tabular font-semibold text-ink">Row {e.row}:</span> <span className="text-bad">{e.message}</span>
                  </li>
                ))}
                {b.errors.length > 50 && <li className="text-ink-3">…and {b.errors.length - 50} more</li>}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">Error details were not recorded for this import.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
