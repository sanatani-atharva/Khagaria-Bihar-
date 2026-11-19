import { z } from 'zod';
import { isExecutive, lookups, requireUser, today } from '../context';
import { collectIssues, findingScope, METRICS, scopedActions, scopedAssets, scopedFiles, scopedTargets, scopedWorks, sortIssues, type MetricKey } from '../issues';
import { resolveLinks, summariseInitiative, type InitiativeRow, type LinkRow } from '../initiatives';
import { buildAgenda } from '../priority';
import { fileAging, schemeGap, workHealth } from '../rules';
import type { IssueItem } from '../types';
import { proc } from './_proc';

const HEAT_METRICS: MetricKey[] = ['works_delayed', 'files_beyond_sla', 'findings_open', 'scheme_gaps'];

function groupCount(items: IssueItem[], by: 'block' | 'department') {
  const m = new Map<number, { id: number; name: string; count: number; severe: number }>();
  for (const i of items) {
    const id = (by === 'block' ? i.blockId : i.departmentId) ?? 0;
    const name = (by === 'block' ? i.blockName : i.departmentName) ?? (by === 'block' ? 'District-level offices' : 'Unassigned');
    const row = m.get(id) ?? { id, name, count: 0, severe: 0 };
    row.count++;
    if (i.tone === 'critical' || i.tone === 'bad') row.severe++;
    m.set(id, row);
  }
  return Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const dashboardProcs = {
  'dashboard.summary': proc({
    access: 'auth',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);

      const works = scopedWorks(ctx);
      const health = works.map((w) => ({ w, h: workHealth(w, t) }));
      const active = health.filter((x) => x.w.status !== 'completed');
      const sanctioned = works.reduce((s, w) => s + w.sanctioned_lakh, 0);
      const spent = works.reduce((s, w) => s + w.expenditure_lakh, 0);

      const targets = scopedTargets(ctx);
      const gaps = targets.map((x) => schemeGap(x.annual_target, x.achieved, t));

      const files = scopedFiles(ctx, "f.status IN ('open','query')");
      const aging = files.map((f) => fileAging(f, t));

      const assets = scopedAssets(ctx);
      const fs = findingScope(u);
      const findingCounts = ctx.db.get<{ open: number; critical: number; submitted: number }>(
        `SELECT SUM(CASE WHEN f.status != 'closed' THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN f.status != 'closed' AND f.severity = 'critical' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN f.status = 'resolution_submitted' THEN 1 ELSE 0 END) AS submitted
           FROM findings f JOIN assets a ON a.id = f.asset_id WHERE ${fs.sql}`,
        fs.params,
      );

      const actions = scopedActions(ctx);
      const monthStart = t.slice(0, 8) + '01';

      // heatmap: block x department count of issues
      const issues = HEAT_METRICS.flatMap((m) => collectIssues(ctx, m));
      const cells = new Map<string, { blockId: number; departmentId: number; count: number; severe: number }>();
      for (const i of issues) {
        const b = i.blockId ?? 0;
        const d = i.departmentId ?? 0;
        const k = `${b}:${d}`;
        const c = cells.get(k) ?? { blockId: b, departmentId: d, count: 0, severe: 0 };
        c.count++;
        if (i.tone === 'critical' || i.tone === 'bad') c.severe++;
        cells.set(k, c);
      }
      const blockRows = [...l.blocks.map((b) => ({ id: b.id, name: b.name, name_hi: b.name_hi })), { id: 0, name: 'District offices', name_hi: 'जिला स्तर' }];

      const visibleBlocks = !isExecutive(u) && u.role === 'block_officer' && u.block_id ? l.blocks.filter((b) => b.id === u.block_id) : l.blocks;
      const blockTable = visibleBlocks.map((b) => {
        const bw = health.filter((x) => x.w.block_id === b.id);
        const bIssues = issues.filter((i) => i.blockId === b.id);
        return {
          blockId: b.id,
          name: b.name,
          name_hi: b.name_hi,
          works: bw.length,
          delayedWorks: bw.filter((x) => x.h.delayed).length,
          avgPhysical: bw.length ? Math.round(bw.reduce((s, x) => s + x.w.physical_pct, 0) / bw.length) : 0,
          gaps: targets.filter((x) => x.block_id === b.id && schemeGap(x.annual_target, x.achieved, t).band === 'gap').length,
          filesBeyondSla: files.filter((f) => f.block_id === b.id && fileAging(f, t).overSla > 0).length,
          criticalAssets: assets.filter((a) => a.block_id === b.id && a.condition === 'critical').length,
          issues: bIssues.length,
          severe: bIssues.filter((i) => i.tone === 'critical' || i.tone === 'bad').length,
        };
      });

      // initiatives in scope
      const inis = ctx.db.all<InitiativeRow>('SELECT * FROM initiatives ORDER BY target_date');
      const links = ctx.db.all<LinkRow>('SELECT * FROM initiative_links');
      const initiatives = inis
        .map((ini) => {
          const states = resolveLinks(ctx, links.filter((x) => x.initiative_id === ini.id));
          const s = summariseInitiative(ini, states, t);
          return { ini, states, s };
        })
        .filter(({ ini, states }) => isExecutive(u) || states.some((x) => x.department_id === u.department_id) || (u.block_id && ini.block_id === u.block_id))
        .map(({ ini, s }) => ({
          id: ini.id,
          title: ini.title,
          blockName: ini.block_id ? l.block.get(ini.block_id)?.name ?? null : null,
          status: s.status,
          progress: s.progress,
          pendingDepartments: s.pendingDepartments,
          bottleneck: s.bottleneck ? { label: s.bottleneck.label, detail: s.bottleneck.detail, owner: s.bottleneck.ownerName } : null,
          daysLeft: s.daysLeft,
        }));

      const agenda = buildAgenda(ctx, { limit: 6 });
      const recent = isExecutive(u)
        ? ctx.db.all<{ id: number; at: string; user_name: string; action: string; entity_type: string; entity_id: number | null; summary: string }>(
            'SELECT id, at, user_name, action, entity_type, entity_id, summary FROM audit_log ORDER BY at DESC, id DESC LIMIT 8',
          )
        : ctx.db.all<{ id: number; at: string; user_name: string; action: string; entity_type: string; entity_id: number | null; summary: string }>(
            'SELECT id, at, user_name, action, entity_type, entity_id, summary FROM audit_log WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 8',
            [u.id],
          );

      return {
        asOf: t,
        works: {
          total: works.length,
          active: active.length,
          completed: works.filter((w) => w.status === 'completed').length,
          notStarted: works.filter((w) => w.status === 'not_started').length,
          delayed: health.filter((x) => x.h.delayed).length,
          stalled: works.filter((w) => w.status === 'stalled').length,
          sanctionedLakh: Math.round(sanctioned * 10) / 10,
          expenditureLakh: Math.round(spent * 10) / 10,
          financialPct: sanctioned ? Math.round((spent / sanctioned) * 1000) / 10 : 0,
          avgPhysical: active.length ? Math.round(active.reduce((s2, x) => s2 + x.w.physical_pct, 0) / active.length) : 0,
        },
        schemes: {
          tracked: new Set(targets.map((x) => x.scheme_id)).size,
          pairs: targets.length,
          gaps: gaps.filter((g) => g.band === 'gap').length,
          watch: gaps.filter((g) => g.band === 'watch').length,
          avgRatio: gaps.length ? Math.round((gaps.reduce((s2, g) => s2 + g.ratio, 0) / gaps.length) * 100) : 0,
        },
        files: {
          pending: files.length,
          query: files.filter((f) => f.status === 'query').length,
          beyondSla: aging.filter((a) => a.band === 'beyond' || a.band === 'critical').length,
          critical: aging.filter((a) => a.band === 'critical').length,
          avgDaysAtDesk: aging.length ? Math.round(aging.reduce((s2, a) => s2 + a.daysAtDesk, 0) / aging.length) : 0,
          oldestDays: aging.reduce((m, a) => Math.max(m, a.daysAtDesk), 0),
        },
        assets: {
          total: assets.length,
          good: assets.filter((a) => a.condition === 'good').length,
          needsRepair: assets.filter((a) => a.condition === 'needs_repair').length,
          critical: assets.filter((a) => a.condition === 'critical').length,
          inspectionsOverdue: assets.filter((a) => a.next_inspection_due && a.next_inspection_due < t).length,
          openFindings: findingCounts?.open ?? 0,
          criticalFindings: findingCounts?.critical ?? 0,
          awaitingVerification: findingCounts?.submitted ?? 0,
        },
        actions: {
          open: actions.filter((a) => a.status !== 'closed').length,
          overdue: actions.filter((a) => a.status !== 'closed' && a.deadline < t).length,
          submitted: actions.filter((a) => a.status === 'resolution_submitted').length,
          closedThisMonth: actions.filter((a) => a.status === 'closed' && (a.closed_at ?? '') >= monthStart).length,
        },
        heatmap: {
          blocks: blockRows,
          departments: l.departments.map((d) => ({ id: d.id, code: d.code, name: d.name })),
          cells: Array.from(cells.values()),
          metrics: HEAT_METRICS.map((m) => ({ key: m, label: METRICS[m].label })),
        },
        blockTable,
        initiatives,
        agendaPreview: agenda.items.map((i) => ({ key: i.key, title: i.title, category: i.category, score: i.score, band: i.band, reasons: i.reasons.slice(0, 2), blockName: i.blockName, departmentNames: i.departmentNames, link: i.link })),
        agendaTotal: agenda.total,
        recent,
      };
    },
  }),

  /**
   * Drill-down: metric -> block -> department -> items (each with responsible officer and the
   * next required action). blockId 0 = district-level offices; departmentId 0 = unassigned.
   */
  'dashboard.drill': proc({
    access: 'auth',
    input: z.object({
      metric: z.enum(Object.keys(METRICS) as [MetricKey, ...MetricKey[]]),
      blockId: z.number().int().min(0).optional(),
      departmentId: z.number().int().min(0).optional(),
    }),
    run: (ctx, input) => {
      requireUser(ctx);
      const all = collectIssues(ctx, input.metric);
      const matchBlock = (i: IssueItem) => input.blockId === undefined || (i.blockId ?? 0) === input.blockId;
      const matchDept = (i: IssueItem) => input.departmentId === undefined || (i.departmentId ?? 0) === input.departmentId;
      const l = lookups(ctx.db);
      return {
        metric: input.metric,
        label: METRICS[input.metric].label,
        group: METRICS[input.metric].group,
        total: all.length,
        blockName: input.blockId === undefined ? null : input.blockId === 0 ? 'District offices' : l.block.get(input.blockId)?.name ?? null,
        departmentName: input.departmentId === undefined ? null : input.departmentId === 0 ? 'Unassigned' : l.dept.get(input.departmentId)?.name ?? null,
        byBlock: groupCount(all.filter(matchDept), 'block'),
        byDepartment: groupCount(all.filter(matchBlock), 'department'),
        items: sortIssues(all.filter((i) => matchBlock(i) && matchDept(i))).slice(0, 300),
        metrics: Object.entries(METRICS).map(([key, v]) => ({ key, ...v })),
      };
    },
  }),
};
