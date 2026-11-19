import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { IssueItem } from '../../core/types';
import { fmtDate } from '../lib/format';
import { Badge, EmptyState, OfficerChip } from './ui';

const TYPE_LABEL: Record<IssueItem['type'], string> = {
  work: 'Work',
  file: 'File',
  finding: 'Finding',
  scheme_gap: 'Service gap',
  asset: 'Asset',
  inspection: 'Inspection',
  action: 'Review action',
};

/**
 * Uniform list for anything that needs attention: what it is, where, who owns it and the
 * exact next required action. Used by the drill-down and the officer desk.
 */
export function IssueList({ items, empty = 'Nothing pending here.', showPlace = true, showOfficer = true, showStatus = true }: { items: IssueItem[]; empty?: string; showPlace?: boolean; showOfficer?: boolean; showStatus?: boolean }) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.key} className={showOfficer ? 'grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)]' : 'grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)]'}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">{TYPE_LABEL[i.type]}</span>
              {showStatus && <Badge tone={i.tone}>{i.status}</Badge>}
            </div>
            <Link to={i.link} className="mt-1 block font-semibold leading-snug text-ink hover:text-accent hover:underline">
              {i.title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-ink-3">{i.subtitle}</p>
            {showPlace && (
              <p className="mt-0.5 text-xs text-ink-3">
                {[i.blockName ?? 'District level', i.departmentName].filter(Boolean).join(' · ')} · <span className="tabular font-semibold text-ink-2">{i.metric}</span>
              </p>
            )}
          </div>
          {showOfficer && (
            <div className="min-w-0">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">Responsible officer</div>
              <OfficerChip name={i.officerName} designation={i.officerDesignation} phone={i.officerPhone} />
            </div>
          )}
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">Next required action</div>
            <p className="text-[13px] text-ink">{i.nextAction}</p>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-ink-3">{i.dueDate ? `Due ${fmtDate(i.dueDate)}` : ''}</span>
              <Link to={i.link} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                Open record <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
