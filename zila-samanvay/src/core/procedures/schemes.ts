import { z } from 'zod';
import { AppError, audit, inScope, lookups, requireUser, scopeSql, today } from '../context';
import { RULES, schemeGap } from '../rules';
import { insert, update } from '../sql';
import type { SchemeRow, SchemeTargetRow } from '../types';
import { financialYear, fyMonthNumber, fyMonthsElapsed } from '../time';
import { parseNum } from './works';
import { proc, zId, zText } from './_proc';

export const schemesProcs = {
  /** Non-works monitoring: block-wise targets vs achievement with pro-rata expectation and trend. */
  'schemes.overview': proc({
    access: 'auth',
    input: z.object({ departmentId: zId.optional() }).prefault({}),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const s = scopeSql(u, 't.block_id', 'sc.department_id');
      const rows = ctx.db.all<SchemeTargetRow & { department_id: number }>(
        `SELECT t.*, sc.department_id FROM scheme_targets t JOIN schemes sc ON sc.id = t.scheme_id WHERE ${s.sql} ${input.departmentId ? 'AND sc.department_id = ?' : ''}`,
        input.departmentId ? [...s.params, input.departmentId] : s.params,
      );
      const schemeIds = Array.from(new Set(rows.map((r) => r.scheme_id)));
      const schemes = schemeIds.length
        ? ctx.db.all<SchemeRow>(`SELECT * FROM schemes WHERE id IN (${schemeIds.map(() => '?').join(',')}) ORDER BY department_id, id`, schemeIds)
        : [];
      const monthly = ctx.db.all<{ scheme_id: number; block_id: number; month: string; cumulative: number }>('SELECT scheme_id, block_id, month, cumulative FROM scheme_monthly ORDER BY month');
      const curMonth = t.slice(0, 7);
      const elapsed = fyMonthsElapsed(t);
      return {
        asOf: t,
        fy: financialYear(t),
        expectedShare: Math.round((elapsed / 12) * 1000) / 10,
        thresholds: { gap: RULES.gapRatio, watch: RULES.watchRatio },
        schemes: schemes.map((sc) => {
          const blocks = rows
            .filter((r) => r.scheme_id === sc.id)
            .map((r) => {
              const g = schemeGap(r.annual_target, r.achieved, t);
              const trend = monthly
                .filter((m) => m.scheme_id === sc.id && m.block_id === r.block_id)
                .map((m) => {
                  const share = m.month === curMonth ? elapsed / 12 : fyMonthNumber(m.month) / 12;
                  const exp = Math.max(1, Math.round(r.annual_target * share));
                  return { month: m.month, cumulative: m.cumulative, expected: exp, ratio: Math.round((m.cumulative / exp) * 1000) / 1000 };
                });
              let streak = 0;
              for (let i = trend.length - 1; i >= 0; i--) {
                if (trend[i].month === curMonth) continue;
                if (trend[i].ratio < RULES.gapRatio) streak++;
                else break;
              }
              const officer = r.officer_id ? l.user.get(r.officer_id) : undefined;
              return {
                targetId: r.id,
                blockId: r.block_id,
                blockName: l.block.get(r.block_id)?.name ?? '',
                annualTarget: r.annual_target,
                achieved: r.achieved,
                ...g,
                gapStreak: streak,
                trend,
                officerId: r.officer_id,
                officerName: officer?.name ?? null,
                officerDesignation: officer?.designation ?? null,
                updatedAt: r.updated_at,
                source: r.source,
                canEdit: inScope(u, r.block_id, sc.department_id),
              };
            })
            .sort((a, b) => a.ratio - b.ratio);
          const tgt = blocks.reduce((x, b) => x + b.annualTarget, 0);
          const ach = blocks.reduce((x, b) => x + b.achieved, 0);
          const dg = schemeGap(tgt, ach, t);
          return {
            id: sc.id,
            code: sc.code,
            name: sc.name,
            name_hi: sc.name_hi,
            indicator: sc.indicator,
            unit: sc.unit,
            departmentId: sc.department_id,
            departmentName: l.dept.get(sc.department_id)?.name ?? '',
            canSetTarget: u.role === 'dm' || u.role === 'ddc' || (u.role === 'dept_officer' && u.department_id === sc.department_id),
            district: { annualTarget: tgt, achieved: ach, ...dg },
            gapBlocks: blocks.filter((b) => b.band === 'gap').length,
            blocks,
          };
        }),
      };
    },
  }),

  /** Block officer records latest cumulative achievement (updates the current month's figure). */
  'schemes.update': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ schemeId: zId, blockId: zId, achieved: z.number().min(0), remark: zText(300).min(3, 'Add a short remark') }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const t = today(ctx);
      const fy = financialYear(t);
      const sc = ctx.db.get<SchemeRow>('SELECT * FROM schemes WHERE id = ?', [input.schemeId]);
      if (!sc) throw new AppError(404, 'Scheme not found');
      if (!inScope(u, input.blockId, sc.department_id)) throw new AppError(403, 'Outside your jurisdiction.');
      const row = ctx.db.get<SchemeTargetRow>('SELECT * FROM scheme_targets WHERE scheme_id = ? AND block_id = ? AND fy = ?', [input.schemeId, input.blockId, fy]);
      if (!row) throw new AppError(404, 'No target set for this block in the current year.');
      if (input.achieved > row.annual_target * 1.5) throw new AppError(400, 'Achievement is more than 150% of the annual target — check the figure.');
      update(ctx.db, 'scheme_targets', row.id, { achieved: input.achieved, updated_at: ctx.now.toISOString(), source: 'manual' });
      const month = t.slice(0, 7);
      const m = ctx.db.get<{ id: number }>('SELECT id FROM scheme_monthly WHERE scheme_id = ? AND block_id = ? AND month = ?', [input.schemeId, input.blockId, month]);
      if (m) update(ctx.db, 'scheme_monthly', m.id, { cumulative: input.achieved });
      else insert(ctx.db, 'scheme_monthly', { scheme_id: input.schemeId, block_id: input.blockId, month, cumulative: input.achieved });
      const blockName = lookups(ctx.db).block.get(input.blockId)?.name;
      audit(ctx, 'scheme.update', 'scheme_target', row.id, `${sc.name} — ${blockName}: achievement ${row.achieved} → ${input.achieved} ${sc.unit}`, { remark: input.remark });
      return { ok: true };
    },
  }),

  /** Define / revise a block's annual target (DM, DDC, or the scheme's district department officer). */
  'schemes.setTarget': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ schemeId: zId, blockId: zId, annualTarget: z.number().positive().max(10_000_000), reason: zText(300).min(3, 'Give the basis for the target') }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const sc = ctx.db.get<SchemeRow>('SELECT * FROM schemes WHERE id = ?', [input.schemeId]);
      if (!sc) throw new AppError(404, 'Scheme not found');
      const allowed = u.role === 'dm' || u.role === 'ddc' || (u.role === 'dept_officer' && u.department_id === sc.department_id);
      if (!allowed) throw new AppError(403, 'Targets are set by the DM, DDC or the district officer of the department.');
      const fy = financialYear(today(ctx));
      const row = ctx.db.get<SchemeTargetRow>('SELECT * FROM scheme_targets WHERE scheme_id = ? AND block_id = ? AND fy = ?', [input.schemeId, input.blockId, fy]);
      const blockName = lookups(ctx.db).block.get(input.blockId)?.name;
      if (!blockName) throw new AppError(400, 'Unknown block');
      if (row) update(ctx.db, 'scheme_targets', row.id, { annual_target: Math.round(input.annualTarget), updated_at: ctx.now.toISOString() });
      else insert(ctx.db, 'scheme_targets', { scheme_id: sc.id, block_id: input.blockId, fy, annual_target: Math.round(input.annualTarget), achieved: 0, officer_id: null, updated_at: ctx.now.toISOString(), source: 'manual' });
      audit(ctx, 'scheme.target', 'scheme_target', row?.id ?? null, `${sc.name} — ${blockName}: FY ${fy} target ${row ? `${row.annual_target} → ` : ''}${Math.round(input.annualTarget)} ${sc.unit}`, { reason: input.reason });
      return { ok: true };
    },
  }),

  /** Re-use departmental MIS exports: scheme code/name + block + cumulative achievement. */
  'schemes.import': proc({
    access: 'auth',
    mutation: true,
    input: z.object({
      fileName: z.string().trim().min(1).max(200),
      dryRun: z.boolean(),
      rows: z.array(z.object({ scheme: z.string().trim().max(120).optional().nullable(), block: z.string().trim().max(80).optional().nullable(), achieved: z.union([z.number(), z.string()]).optional().nullable() })).min(1).max(2000),
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const fy = financialYear(t);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const schemes = ctx.db.all<SchemeRow>('SELECT * FROM schemes');
      const results: { row: number; action: 'update' | 'unchanged' | 'error'; label: string; messages: string[] }[] = [];
      let updated = 0;
      let failed = 0;
      input.rows.forEach((r, i) => {
        const rowNo = i + 2;
        const messages: string[] = [];
        const sc = r.scheme ? schemes.find((s) => norm(s.code) === norm(r.scheme!) || norm(s.name) === norm(r.scheme!)) : undefined;
        const blk = r.block ? l.blocks.find((b) => norm(b.name) === norm(r.block!).replace(/block$/, '') || norm(b.code) === norm(r.block!)) : undefined;
        const ach = parseNum(r.achieved);
        if (!sc) messages.push(`Unknown scheme "${r.scheme ?? ''}" — use a code such as ${schemes.slice(0, 3).map((s) => s.code).join(', ')}`);
        if (!blk) messages.push(`Unknown block "${r.block ?? ''}"`);
        if (ach === null || ach < 0) messages.push(`Achievement "${r.achieved ?? ''}" is not a valid number`);
        if (sc && blk && !inScope(u, blk.id, sc.department_id)) messages.push('Outside your jurisdiction');
        const row = sc && blk ? ctx.db.get<SchemeTargetRow>('SELECT * FROM scheme_targets WHERE scheme_id = ? AND block_id = ? AND fy = ?', [sc.id, blk.id, fy]) : undefined;
        if (sc && blk && !row) messages.push('No target set for this block this year');
        const label = `${sc?.code ?? r.scheme ?? '?'} · ${blk?.name ?? r.block ?? '?'}`;
        if (messages.length) {
          failed++;
          results.push({ row: rowNo, action: 'error', label, messages });
          return;
        }
        if (row!.achieved === ach) {
          results.push({ row: rowNo, action: 'unchanged', label, messages: ['Same as current figure'] });
          return;
        }
        updated++;
        results.push({ row: rowNo, action: 'update', label, messages: [`achieved: ${row!.achieved} → ${ach}`] });
        if (!input.dryRun) {
          update(ctx.db, 'scheme_targets', row!.id, { achieved: ach, updated_at: ctx.now.toISOString(), source: 'import' });
          const month = t.slice(0, 7);
          const m = ctx.db.get<{ id: number }>('SELECT id FROM scheme_monthly WHERE scheme_id = ? AND block_id = ? AND month = ?', [sc!.id, blk!.id, month]);
          if (m) update(ctx.db, 'scheme_monthly', m.id, { cumulative: ach });
          else insert(ctx.db, 'scheme_monthly', { scheme_id: sc!.id, block_id: blk!.id, month, cumulative: ach });
        }
      });
      let batchId: number | null = null;
      if (!input.dryRun) {
        batchId = insert(ctx.db, 'import_batches', {
          at: ctx.now.toISOString(), user_id: u.id, dataset: 'scheme_progress', file_name: input.fileName, total: input.rows.length, created: 0, updated, failed,
          errors: JSON.stringify(results.filter((r) => r.action === 'error').map((r) => ({ row: r.row, message: r.messages.join('; ') }))),
        });
        audit(ctx, 'schemes.import', 'import', batchId, `Imported ${input.fileName}: ${updated} block figures updated, ${failed} rejected`);
      }
      return { dryRun: input.dryRun, batchId, total: input.rows.length, created: 0, updated, failed, unchanged: results.filter((r) => r.action === 'unchanged').length, results };
    },
  }),
};
