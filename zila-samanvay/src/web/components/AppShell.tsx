import {
  Building2, ClipboardList, FileStack, Gauge, Globe2, HardHat, LogOut, Menu, Network, ScrollText, Target, UserRoundCheck, X, Layers,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Role } from '../../core/types';
import { useMe } from '../lib/hooks';
import { logout, STANDALONE } from '../lib/rpc';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  hi: string;
  icon: ReactNode;
  roles?: Role[];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Command centre',
    items: [
      { to: '/dashboard', label: 'District dashboard', hi: 'ज़िला डैशबोर्ड', icon: <Gauge className="size-4" /> },
      { to: '/review', label: 'Review meeting', hi: 'समीक्षा बैठक', icon: <ClipboardList className="size-4" /> },
      { to: '/drill', label: 'Drill-down', hi: 'विस्तृत विवरण', icon: <Layers className="size-4" /> },
      { to: '/dependencies', label: 'Inter-department', hi: 'अंतर-विभागीय', icon: <Network className="size-4" /> },
    ],
  },
  {
    group: 'Monitoring',
    items: [
      { to: '/works', label: 'Public works', hi: 'निर्माण कार्य', icon: <HardHat className="size-4" /> },
      { to: '/schemes', label: 'Schemes & services', hi: 'योजनाएँ', icon: <Target className="size-4" /> },
      { to: '/files', label: 'File tracker', hi: 'संचिका', icon: <FileStack className="size-4" /> },
      { to: '/assets', label: 'Asset register', hi: 'परिसंपत्ति', icon: <Building2 className="size-4" /> },
    ],
  },
  {
    group: 'My work',
    items: [
      { to: '/desk', label: 'My desk', hi: 'मेरा कार्य', icon: <UserRoundCheck className="size-4" /> },
      { to: '/audit', label: 'Audit trail', hi: 'लेखा-परीक्षा', icon: <ScrollText className="size-4" />, roles: ['dm', 'ddc'] },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const u = me.data;
  const role = u?.role;

  const signOut = async () => {
    await logout();
    qc.clear();
    nav('/login');
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="grid size-9 place-items-center rounded-lg bg-white text-sm font-black text-ink" aria-hidden>
          ZS
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold text-white">Zila Samanvay</div>
          <div className="text-xs text-slate-300">
            Khagaria · <span lang="hi" className="hi">खगड़िया</span>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.roles || (role && i.roles.includes(role)));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mt-3">
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g.group}</div>
              <ul>
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cx(
                          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                          isActive ? 'bg-white text-ink' : 'text-slate-200 hover:bg-white/10 hover:text-white',
                        )
                      }
                    >
                      {i.icon}
                      <span className="flex-1">{i.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="mt-3">
          <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Citizens</div>
          <NavLink to="/public" className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 hover:text-white">
            <Globe2 className="size-4" /> Public portal
          </NavLink>
        </div>
      </div>
      {u && (
        <div className="border-t border-white/10 p-3">
          <div className="rounded-lg bg-white/5 p-3">
            <div className="truncate text-sm font-bold text-white">{u.name}</div>
            <div className="truncate text-xs text-slate-300">{u.designation}</div>
            <div className="mt-1 truncate text-[11px] text-slate-400">Jurisdiction: {u.jurisdiction}</div>
            <button onClick={signOut} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-white">
              <LogOut className="size-3.5" /> Switch officer / sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          const m = document.getElementById('main');
          m?.focus();
          m?.scrollIntoView();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="no-print sticky top-0 hidden h-dvh bg-ink lg:block">{sidebar}</aside>

      {/* mobile top bar */}
      <div className="no-print sticky top-0 z-40 flex items-center justify-between bg-ink px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2 text-white">
          <span className="grid size-8 place-items-center rounded-md bg-white text-xs font-black text-ink">ZS</span>
          <span className="text-sm font-bold">Zila Samanvay · Khagaria</span>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-md p-2 text-white hover:bg-white/10" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-ink">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded-md p-2 text-white hover:bg-white/10" aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="min-w-0">
        <div className="no-print border-b border-warn/30 bg-warn-soft px-4 py-1.5 text-center text-xs text-warn">
          Prototype for District Administration, Khagaria (Letter No. 305 · PS-3). All officers and records are synthetic demo data.
          {STANDALONE && ' Running offline in this browser — changes are saved on this device only.'}
        </div>
        <main id="main" tabIndex={-1} className="focus:outline-none mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}


