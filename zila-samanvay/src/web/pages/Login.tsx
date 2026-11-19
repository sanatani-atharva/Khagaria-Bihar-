import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Globe2, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQ } from '../lib/hooks';
import { login, STANDALONE } from '../lib/rpc';
import { useToast } from '../components/toast';
import { Card, ErrorState, Input, Skeleton, cx } from '../components/ui';

const GROUPS: { role: string; title: string; note: string }[] = [
  { role: 'dm', title: 'District Magistrate', note: 'Full district view, review meetings, approvals and verification' },
  { role: 'ddc', title: 'Deputy Development Commissioner', note: 'Runs the development review; publishes approved works' },
  { role: 'dept_officer', title: 'District department officers', note: 'Own department across all seven blocks' },
  { role: 'block_officer', title: 'Block & field officers', note: 'Own block (and department) — files, findings, progress updates' },
];

export default function Login() {
  const personas = useQ('session.personas', {});
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (personas.data ?? []).filter((p) => !s || `${p.name} ${p.designation} ${p.blockName ?? ''} ${p.departmentName ?? ''}`.toLowerCase().includes(s));
  }, [personas.data, q]);

  const signIn = async (id: number, role: string) => {
    setBusy(id);
    try {
      await login(id);
      qc.clear();
      nav(role === 'dm' || role === 'ddc' ? '/dashboard' : '/desk');
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-dvh bg-canvas">
      <div className="bg-ink px-4 py-10 text-white sm:py-14">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-semibold text-slate-300">District Administration, Khagaria · Bihar</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Zila Samanvay <span lang="hi" className="hi text-2xl font-normal text-slate-300 sm:text-3xl">ज़िला समन्वय</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-200">
            One dashboard for public works, scheme delivery, file movement and asset condition — from district summary to the responsible office and the next required action.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <Link to="/public" className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 font-semibold text-ink hover:bg-slate-100">
              <Globe2 className="size-4" /> Open public portal
            </Link>
            <span className="inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-2 text-slate-200">
              <ShieldCheck className="size-4" /> Role-based access · every action audited
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Sign in as a demo officer</h2>
            <p className="text-sm text-ink-3">
              Fictional officers for the selection demo. Production sign-in would use the State / NIC single sign-on with OTP.
              {STANDALONE && ' This copy runs entirely in your browser.'}
            </p>
          </div>
          <div className="w-full sm:w-72">
            <Input type="search" placeholder="Search name, block or department" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search officers" />
          </div>
        </div>

        {personas.isLoading && (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {personas.error && <ErrorState error={personas.error} onRetry={() => personas.refetch()} />}

        <div className="flex flex-col gap-6">
          {GROUPS.map((g) => {
            const people = filtered.filter((p) => p.role === g.role);
            if (!people.length) return null;
            return (
              <section key={g.role}>
                <h3 className="text-sm font-bold uppercase tracking-wide text-ink-2">{g.title}</h3>
                <p className="mb-2 text-[13px] text-ink-3">{g.note}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {people.map((p) => (
                    <Card key={p.id} as="div" className="p-0">
                      <button
                        onClick={() => signIn(p.id, p.role)}
                        disabled={busy !== null}
                        className={cx('flex w-full items-center gap-3 rounded-[var(--radius-card)] p-3 text-left transition-colors hover:bg-accent-soft/50', busy === p.id && 'opacity-60')}
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-subtle text-xs font-bold text-ink-2" aria-hidden>
                          {p.name.replace(/^(Dr\.|Md\.)\s*/, '').split(' ').map((x) => x[0]).slice(0, 2).join('')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{p.name}</span>
                          <span className="block truncate text-[13px] text-ink-3">{p.designation}</span>
                        </span>
                        <ArrowRight className="size-4 text-ink-3" aria-hidden />
                      </button>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
