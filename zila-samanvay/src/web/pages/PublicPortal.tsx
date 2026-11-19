// Citizen portal. Calls ONLY the public.* procedures, which return approved, whitelisted
// fields. No sign-in, no AppShell, no images: built to load quickly on 2G/3G phones.

import { Building2, CalendarCheck2, Globe2, HardHat, LayoutGrid, LogIn, MapPin, Search, Target } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RULES } from '../../core/rules';
import type { Tone } from '../../core/types';
import { fmtDate, lakh, num, pct, ratioTone } from '../lib/format';
import { useDebounced, useQ } from '../lib/hooks';
import { Badge, EmptyState, ErrorState, Pagination, Progress, Skeleton, SkeletonRows, cx } from '../components/ui';

type Tab = 'overview' | 'works' | 'schemes' | 'facilities';
type SetParams = (patch: Record<string, string | null>) => void;

const TABS: { value: Tab; label: string; hi: string; icon: ReactNode }[] = [
  { value: 'overview', label: 'Overview', hi: 'सारांश', icon: <LayoutGrid className="size-4" aria-hidden /> },
  { value: 'works', label: 'Works', hi: 'निर्माण कार्य', icon: <HardHat className="size-4" aria-hidden /> },
  { value: 'schemes', label: 'Schemes', hi: 'योजनाएँ', icon: <Target className="size-4" aria-hidden /> },
  { value: 'facilities', label: 'Facilities', hi: 'सुविधाएँ', icon: <Building2 className="size-4" aria-hidden /> },
];

const WORKS_PAGE = 18;
const FACILITIES_PAGE = 25;

export default function PublicPortal() {
  const [sp, setSp] = useSearchParams();
  const tabRaw = sp.get('tab');
  const tab: Tab = TABS.some((t) => t.value === tabRaw) ? (tabRaw as Tab) : 'overview';
  const overview = useQ('public.overview', {}, { staleTime: 5 * 60_000 });

  useEffect(() => {
    document.title = 'Khagaria District · Public Works & Services';
  }, []);

  const setTab = (t: Tab) => {
    setSp(t === 'overview' ? {} : { tab: t });
    window.scrollTo({ top: 0 });
  };
  const setParams: SetParams = (patch) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    });
  };

  const blocks = overview.data?.blocks ?? [];

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-base">
      {/* HashRouter: a plain "#public-main" href would be read as the route "/public-main" and
          bounce the visitor to sign-in, so the skip link moves focus itself. */}
      <a
        href="#public-main"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById('public-main');
          main?.focus();
          main?.scrollIntoView();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="bg-ink px-4 py-6 text-white sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-300">District Administration, Khagaria · Bihar</p>
              <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">Khagaria District · Public Works &amp; Services</h1>
              <p lang="hi" className="hi mt-1 text-lg text-slate-300 sm:text-xl">
                खगड़िया ज़िला · जन सूचना पोर्टल
              </p>
            </div>
            <Link to="/login" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-white/30 px-3.5 text-sm font-semibold text-white hover:bg-white/10">
              <LogIn className="size-4" aria-hidden /> Officer sign-in
            </Link>
          </div>
          <p className="mt-3 max-w-3xl text-slate-200">Information published after approval by the District Administration. Internal files and unverified reports are not shown.</p>
          <span className="mt-3 inline-flex items-center rounded-full border border-warn/40 bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn">Prototype — synthetic data</span>
        </div>
      </header>

      <nav aria-label="Portal" className="sticky top-0 z-30 border-b border-line bg-panel">
        <div role="tablist" aria-label="Portal sections" className="mx-auto grid max-w-6xl grid-cols-4 px-2 sm:flex sm:gap-1 sm:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={active}
                aria-controls="public-main"
                onClick={() => setTab(t.value)}
                className={cx(
                  'flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 border-b-[3px] px-1 py-2 text-center transition-colors sm:flex-row sm:gap-2 sm:px-4',
                  active ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink',
                )}
              >
                <span className="hidden sm:inline">{t.icon}</span>
                <span className="text-sm font-bold leading-tight sm:text-[15px]">{t.label}</span>
                <span lang="hi" className="hi truncate text-xs leading-tight sm:text-sm">
                  {t.hi}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <main id="public-main" role="tabpanel" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 focus:outline-none">
        {tab === 'overview' && <OverviewTab q={overview} onTab={setTab} />}
        {tab === 'works' && <WorksTab sp={sp} setParams={setParams} blocks={blocks} />}
        {tab === 'schemes' && <SchemesTab />}
        {tab === 'facilities' && <FacilitiesTab sp={sp} setParams={setParams} blocks={blocks} types={(overview.data?.facilities ?? []).map((f) => ({ value: f.type, label: f.label }))} />}
      </main>

      <footer className="border-t border-line bg-panel">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-3">
          <p className="font-semibold text-ink-2">
            District Administration, Khagaria, Bihar · <span lang="hi" className="hi">ज़िला प्रशासन, खगड़िया</span>
          </p>
          <p>
            Only works approved for publication, public facilities and scheme targets are shown here. Internal notings, pending files, officer contact details and unverified inspection reports are
            never published.
          </p>
          <p>Prototype for District Administration, Khagaria (Problem Statement 3). All records are synthetic demo data.</p>
          <p>
            <Link to="/login" className="font-semibold text-accent hover:underline">
              Officer sign-in
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

// ---------------- shared bits ----------------
function SectionTitle({ title, hi, sub }: { title: string; hi: string; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold leading-tight text-ink">
        {title} <span lang="hi" className="hi ml-1 text-base font-normal text-ink-3">{hi}</span>
      </h2>
      {sub && <p className="mt-1 text-sm text-ink-3">{sub}</p>}
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]', className)}>{children}</section>;
}

const fieldCls = 'h-11 w-full rounded-md border border-line-2 bg-white px-3 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

function PSelect({ label, options, allLabel, ...p }: { label: string; options: { value: string; label: string }[]; allLabel: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <select id={id} className={cx(fieldCls, 'pr-8')} {...p}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Search box whose value is pushed to the URL (?q=) after a 300 ms pause. */
function PSearch({ sp, setParams, label, placeholder }: { sp: URLSearchParams; setParams: SetParams; label: string; placeholder: string }) {
  const id = useId();
  const urlQ = sp.get('q') ?? '';
  const [value, setValue] = useState(urlQ);
  const debounced = useDebounced(value, 300);
  const spRef = useRef(sp);
  spRef.current = sp;
  useEffect(() => {
    const q = debounced.trim();
    if ((spRef.current.get('q') ?? '') !== q) setParams({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    setValue((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input id={id} type="search" maxLength={80} className={cx(fieldCls, 'pl-9')} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
    </div>
  );
}

function useClientPage<T>(rows: T[] | undefined, sp: URLSearchParams, size: number) {
  const all = rows ?? [];
  const pages = Math.max(1, Math.ceil(all.length / size));
  const page = Math.min(Math.max(1, Number(sp.get('page')) || 1), pages);
  return { page, pages, total: all.length, slice: all.slice((page - 1) * size, page * size) };
}

function Bar({ label, value, tone, text }: { label: ReactNode; value: number; tone: Tone; text: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-semibold text-ink">{label}</span>
        <span className="tabular text-sm text-ink-2">{text}</span>
      </div>
      <Progress value={value} tone={tone} label={typeof label === 'string' ? label : undefined} />
    </div>
  );
}

// ---------------- overview ----------------
type OverviewQuery = ReturnType<typeof useQ<'public.overview'>>;

function OverviewTab({ q, onTab }: { q: OverviewQuery; onTab: (t: Tab) => void }) {
  if (q.isLoading)
    return (
      <div aria-busy="true" aria-label="Loading">
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const facilities = o.facilities.slice().sort((a, b) => a.label.localeCompare(b.label));
  const facTotal = facilities.reduce((s, f) => s + f.total, 0);
  const facFunctional = facilities.reduce((s, f) => s + f.functional, 0);

  const stats: { label: string; hi: string; value: string; sub?: string }[] = [
    { label: 'Approved public works', hi: 'स्वीकृत कार्य', value: num(o.works.approved), sub: 'Published after approval' },
    { label: 'Completed', hi: 'पूर्ण', value: num(o.works.completed), sub: o.works.approved ? `${Math.round((o.works.completed / o.works.approved) * 100)}% of approved works` : undefined },
    { label: 'In progress', hi: 'प्रगति पर', value: num(o.works.inProgress), sub: 'Sanctioned or under construction' },
    { label: 'Total sanctioned value', hi: 'कुल स्वीकृत राशि', value: lakh(o.works.valueLakh, { crore: true }), sub: lakh(o.works.valueLakh) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle
          title="Khagaria at a glance"
          hi="एक नज़र में"
          sub={
            <>
              Data as of {fmtDate(o.asOf)}
              {o.lastPublished ? ` · last work published ${fmtDate(o.lastPublished)}` : ''}
            </>
          }
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Panel key={s.label} className="p-4">
              <div className="text-sm font-semibold text-ink-2">{s.label}</div>
              <div lang="hi" className="hi text-xs text-ink-3">
                {s.hi}
              </div>
              <div className="tabular mt-2 text-2xl font-bold leading-none text-ink sm:text-3xl">{s.value}</div>
              {s.sub && <div className="mt-1.5 text-sm text-ink-3">{s.sub}</div>}
            </Panel>
          ))}
        </div>
        <button type="button" onClick={() => onTab('works')} className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-accent hover:underline">
          See all approved works →
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="p-4 sm:p-5">
          <SectionTitle
            title="Public facilities functioning"
            hi="कार्यरत सुविधाएँ"
            sub={facTotal ? `${pct((facFunctional / facTotal) * 100)} of ${num(facTotal)} listed facilities are fully functional.` : undefined}
          />
          {facilities.length === 0 ? (
            <EmptyState title="No facilities published yet" />
          ) : (
            <div className="flex flex-col gap-4">
              {facilities.map((f) => {
                const share = f.total ? (f.functional / f.total) * 100 : 0;
                return <Bar key={f.type} label={f.label} value={share} tone={ratioTone(share / 100)} text={`${pct(share)} functional · ${num(f.functional)} of ${num(f.total)}`} />;
              })}
            </div>
          )}
          <button type="button" onClick={() => onTab('facilities')} className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-accent hover:underline">
            Find a facility near you →
          </button>
        </Panel>

        <Panel className="p-4 sm:p-5">
          <SectionTitle title="Scheme progress this year" hi="योजनाओं की प्रगति" sub="Achievement so far as a share of the full-year target." />
          {o.schemes.length === 0 ? (
            <EmptyState title="No scheme targets published yet" />
          ) : (
            <div className="flex flex-col gap-4">
              {o.schemes.map((s) => (
                <Bar
                  key={s.id}
                  label={
                    <>
                      {s.name}{' '}
                      <span lang="hi" className="hi text-sm font-normal text-ink-3">
                        {s.name_hi}
                      </span>
                    </>
                  }
                  value={s.pctOfAnnual}
                  tone="info"
                  text={`${pct(s.pctOfAnnual, 1)} · ${num(s.achieved)} of ${num(s.annualTarget)} ${s.unit}`}
                />
              ))}
            </div>
          )}
          <button type="button" onClick={() => onTab('schemes')} className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-accent hover:underline">
            See block-wise progress →
          </button>
        </Panel>
      </div>
    </div>
  );
}

// ---------------- works ----------------
function WorksTab({ sp, setParams, blocks }: { sp: URLSearchParams; setParams: SetParams; blocks: { id: number; name: string; name_hi: string }[] }) {
  const block = sp.get('block') ?? '';
  const statusRaw = sp.get('status');
  const status: 'all' | 'completed' | 'ongoing' = statusRaw === 'completed' || statusRaw === 'ongoing' ? statusRaw : 'all';
  const q = sp.get('q') ?? '';
  const works = useQ('public.works', { blockId: block ? Number(block) : undefined, status, q: q || undefined });
  const pg = useClientPage(works.data, sp, WORKS_PAGE);

  return (
    <div>
      <SectionTitle title="Approved public works" hi="स्वीकृत निर्माण कार्य" sub="Roads, buildings, water supply and other works approved for public information." />
      <Panel className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <PSelect label="Block" value={block} onChange={(e) => setParams({ block: e.target.value || null })} allLabel="All blocks" options={blocks.map((b) => ({ value: String(b.id), label: `${b.name} (${b.name_hi})` }))} />
          <PSelect
            label="Status"
            value={status === 'all' ? '' : status}
            onChange={(e) => setParams({ status: e.target.value || null })}
            allLabel="All works"
            options={[
              { value: 'ongoing', label: 'Ongoing' },
              { value: 'completed', label: 'Completed' },
            ]}
          />
          <PSearch sp={sp} setParams={setParams} label="Search" placeholder="Work name, panchayat or code" />
        </div>
      </Panel>

      {works.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : works.error ? (
        <ErrorState error={works.error} onRetry={() => works.refetch()} />
      ) : pg.total === 0 ? (
        <Panel>
          <EmptyState title="No approved works match your search">Try another block or clear the search.</EmptyState>
        </Panel>
      ) : (
        <div className={cx('transition-opacity', works.isPlaceholderData && 'opacity-60')}>
          <p className="mb-3 text-sm text-ink-3" aria-live="polite">
            {num(pg.total)} work{pg.total === 1 ? '' : 's'}
            {pg.total >= 500 ? ' (first 500 shown — narrow the search to see more)' : ''}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pg.slice.map((w) => (
              <article key={w.id} className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-panel p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={w.completed ? 'ok' : 'info'}>{w.status}</Badge>
                  <span className="font-mono text-xs text-ink-3">{w.code}</span>
                </div>
                <h3 className="mt-2 font-bold leading-snug text-ink">{w.name}</h3>
                <p className="mt-1 flex items-start gap-1 text-sm text-ink-3">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {w.blockName} block{w.panchayat ? ` · ${w.panchayat}` : ''}
                </p>
                <div className="mt-3">
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-ink-2">Physical progress</span>
                    <span className="tabular font-bold text-ink">{pct(w.physical_pct)}</span>
                  </div>
                  <Progress value={w.physical_pct} tone={w.completed ? 'ok' : 'info'} label={`Physical progress ${w.physical_pct}%`} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold text-ink-3">Sanctioned cost</dt>
                    <dd className="tabular font-semibold text-ink">{lakh(w.sanctioned_lakh)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold text-ink-3">{w.completed ? 'Target date' : 'Expected completion'}</dt>
                    <dd className="text-ink">{fmtDate(w.target_date)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold text-ink-3">Department</dt>
                    <dd className="text-ink">{w.departmentName}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold text-ink-3">Scheme</dt>
                    <dd className="text-ink">{w.scheme}</dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs font-semibold text-ink-3">Executing agency</dt>
                    <dd className="text-ink">{w.agency ?? '—'}</dd>
                  </div>
                </dl>
                {w.public_summary && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">{w.public_summary}</p>}
              </article>
            ))}
          </div>
          <Pager page={pg.page} pages={pg.pages} total={pg.total} setParams={setParams} />
        </div>
      )}
    </div>
  );
}

function Pager({ page, pages, total, setParams }: { page: number; pages: number; total: number; setParams: SetParams }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-panel">
      <Pagination
        page={page}
        pages={pages}
        total={total}
        onPage={(p) => {
          setParams({ page: p > 1 ? String(p) : null });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}

// ---------------- schemes ----------------
function SchemesTab() {
  const q = useQ('public.schemes', {}, { staleTime: 5 * 60_000 });
  const gapPct = Math.round(RULES.gapRatio * 100);
  return (
    <div>
      <SectionTitle
        title="Scheme progress by block"
        hi="प्रखंडवार योजना प्रगति"
        sub={`Bars show achievement so far as a share of each block's full-year target. “On track” means achievement is at least ${gapPct}% of what is expected for the part of the year already passed.`}
      />
      {q.isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Panel>
          <EmptyState title="No scheme targets published yet" />
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {q.data.map((s) => {
            const target = s.blocks.reduce((t, b) => t + b.annualTarget, 0);
            const achieved = s.blocks.reduce((t, b) => t + b.achieved, 0);
            const behind = s.blocks.filter((b) => !b.onTrack).length;
            return (
              <Panel key={s.id} className="p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold leading-snug text-ink">
                      {s.name}{' '}
                      <span lang="hi" className="hi text-base font-normal text-ink-3">
                        {s.name_hi}
                      </span>
                    </h3>
                    <p className="text-sm text-ink-3">
                      {s.indicator} · {s.departmentName}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="tabular text-xl font-bold text-ink">{pct(target ? (achieved / target) * 100 : 0, 1)}</div>
                    <div className="text-sm text-ink-3">
                      District: {num(achieved)} of {num(target)} {s.unit}
                    </div>
                  </div>
                </div>
                <ul className="flex flex-col divide-y divide-line">
                  {s.blocks.map((b) => (
                    <li key={b.blockId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 md:grid-cols-[9rem_minmax(0,1fr)_11rem_auto]">
                      <span className="font-semibold text-ink">{b.blockName}</span>
                      <span className="md:order-last">
                        <Badge tone={b.onTrack ? 'ok' : 'warn'}>{b.onTrack ? 'On track' : 'Needs attention'}</Badge>
                      </span>
                      <span className="col-span-2 md:col-span-1">
                        <Progress value={b.pctOfAnnual} tone={b.onTrack ? 'ok' : 'warn'} label={`${b.blockName}: ${b.pctOfAnnual}% of annual target`} />
                      </span>
                      <span className="tabular col-span-2 text-sm text-ink-2 md:col-span-1">
                        <span className="font-semibold text-ink">{pct(b.pctOfAnnual, 1)}</span> · {num(b.achieved)} of {num(b.annualTarget)}
                      </span>
                    </li>
                  ))}
                </ul>
                {behind > 0 && (
                  <p className="mt-3 text-sm text-ink-3">
                    {behind} of {s.blocks.length} blocks need attention.
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- facilities ----------------
const FUNCTIONAL_TONE: Record<string, Tone> = { functional: 'ok', partially: 'warn', non_functional: 'bad' };

function FacilitiesTab({
  sp, setParams, blocks, types,
}: { sp: URLSearchParams; setParams: SetParams; blocks: { id: number; name: string; name_hi: string }[]; types: { value: string; label: string }[] }) {
  const block = sp.get('block') ?? '';
  const type = sp.get('type') ?? '';
  const q = sp.get('q') ?? '';
  const facilities = useQ('public.facilities', { blockId: block ? Number(block) : undefined, type: type || undefined, q: q || undefined });
  const pg = useClientPage(facilities.data, sp, FACILITIES_PAGE);
  const functionalCount = useMemo(() => (facilities.data ?? []).filter((f) => f.functional_status === 'functional').length, [facilities.data]);
  const sortedTypes = useMemo(() => types.slice().sort((a, b) => a.label.localeCompare(b.label)), [types]);

  return (
    <div>
      <SectionTitle title="Public facilities" hi="सार्वजनिक सुविधाएँ" sub="Schools, anganwadi centres, health centres, handpumps, water supply schemes and panchayat buildings, with their current status." />
      <Panel className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <PSelect label="Block" value={block} onChange={(e) => setParams({ block: e.target.value || null })} allLabel="All blocks" options={blocks.map((b) => ({ value: String(b.id), label: `${b.name} (${b.name_hi})` }))} />
          <PSelect label="Facility type" value={type} onChange={(e) => setParams({ type: e.target.value || null })} allLabel="All types" options={sortedTypes} />
          <PSearch sp={sp} setParams={setParams} label="Search" placeholder="Facility name or village" />
        </div>
      </Panel>

      {facilities.isLoading ? (
        <Panel>
          <SkeletonRows rows={8} />
        </Panel>
      ) : facilities.error ? (
        <ErrorState error={facilities.error} onRetry={() => facilities.refetch()} />
      ) : pg.total === 0 ? (
        <Panel>
          <EmptyState title="No facilities match your search">Try another block or type, or clear the search.</EmptyState>
        </Panel>
      ) : (
        <div className={cx('transition-opacity', facilities.isPlaceholderData && 'opacity-60')}>
          <p className="mb-3 text-sm text-ink-3" aria-live="polite">
            {num(pg.total)} facilit{pg.total === 1 ? 'y' : 'ies'} · {num(functionalCount)} fully functional
          </p>
          <Panel>
            <ul className="divide-y divide-line">
              {pg.slice.map((f) => (
                <li key={f.id} className="grid gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_12rem_9rem] md:items-center">
                  <div className="min-w-0">
                    <div className="font-semibold leading-snug text-ink">{f.name}</div>
                    <div className="text-sm text-ink-3">{f.typeLabel}</div>
                  </div>
                  <div className="flex items-start gap-1 text-sm text-ink-2">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                    {f.blockName}
                    {f.village ? ` / ${f.village}` : ''}
                  </div>
                  <div>
                    <Badge tone={FUNCTIONAL_TONE[f.functional_status] ?? 'muted'}>{f.statusLabel}</Badge>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-ink-3">
                    <CalendarCheck2 className="size-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="md:sr-only">Last inspected </span>
                      {f.last_inspected ? fmtDate(f.last_inspected) : 'Not yet inspected'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="mt-2 hidden text-xs text-ink-3 md:block">Date shown is the last inspection by the department.</p>
          <Pager page={pg.page} pages={pg.pages} total={pg.total} setParams={setParams} />
        </div>
      )}
      <p className="mt-6 flex items-start gap-2 text-sm text-ink-3">
        <Globe2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        Status reflects the latest inspection recorded by the department. Detailed inspection reports are internal records and are not published.
      </p>
    </div>
  );
}
