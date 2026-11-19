// Citizen portal. Every query here selects an explicit whitelist of columns from records that
// have been approved for publication. Internal notings, pending files, officer phone numbers,
// inspection findings, hold reasons and unverified updates never leave the server.

import { z } from 'zod';
import { lookups, today } from '../context';
import { schemeGap } from '../rules';
import { ASSET_TYPE_LABEL, FUNCTIONAL_LABEL } from '../types';
import { financialYear } from '../time';
import { proc, zId } from './_proc';

const PUBLIC_STATUS: Record<string, string> = {
  not_started: 'Sanctioned — work yet to start',
  in_progress: 'Work in progress',
  stalled: 'Work in progress',
  completed: 'Completed',
};

export const publicProcs = {
  'public.overview': proc({
    access: 'public',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      const t = today(ctx);
      const l = lookups(ctx.db);
      const w = ctx.db.get<{ n: number; done: number; value: number }>(
        "SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done, SUM(sanctioned_lakh) AS value FROM works WHERE public_approved = 1",
      );
      const fac = ctx.db.all<{ type: string; total: number; functional: number }>(
        "SELECT type, COUNT(*) AS total, SUM(CASE WHEN functional_status = 'functional' THEN 1 ELSE 0 END) AS functional FROM assets WHERE public = 1 GROUP BY type",
      );
      const sch = ctx.db.all<{ id: number; name: string; name_hi: string; unit: string; target: number; achieved: number }>(
        `SELECT s.id, s.name, s.name_hi, s.unit, SUM(t.annual_target) AS target, SUM(t.achieved) AS achieved
           FROM schemes s JOIN scheme_targets t ON t.scheme_id = s.id WHERE s.public = 1 AND t.fy = ? GROUP BY s.id ORDER BY s.id`,
        [financialYear(t)],
      );
      const last = ctx.db.get<{ at: string }>("SELECT MAX(approved_at) AS at FROM works WHERE public_approved = 1");
      return {
        asOf: t,
        district: 'Khagaria',
        blocks: l.blocks.map((b) => ({ id: b.id, name: b.name, name_hi: b.name_hi })),
        works: { approved: w?.n ?? 0, completed: w?.done ?? 0, inProgress: (w?.n ?? 0) - (w?.done ?? 0), valueLakh: Math.round((w?.value ?? 0) * 10) / 10 },
        facilities: fac.map((f) => ({ type: f.type, label: ASSET_TYPE_LABEL[f.type] ?? f.type, total: f.total, functional: f.functional })),
        schemes: sch.map((s) => ({ id: s.id, name: s.name, name_hi: s.name_hi, unit: s.unit, annualTarget: s.target, achieved: s.achieved, pctOfAnnual: s.target ? Math.round((s.achieved / s.target) * 1000) / 10 : 0 })),
        lastPublished: last?.at ?? null,
      };
    },
  }),

  'public.works': proc({
    access: 'public',
    input: z.object({ blockId: zId.optional(), q: z.string().trim().max(80).optional(), status: z.enum(['all', 'completed', 'ongoing']).default('all') }).prefault({}),
    run: (ctx, input) => {
      const l = lookups(ctx.db);
      const where = ['public_approved = 1'];
      const params: unknown[] = [];
      if (input.blockId) {
        where.push('block_id = ?');
        params.push(input.blockId);
      }
      if (input.status === 'completed') where.push("status = 'completed'");
      if (input.status === 'ongoing') where.push("status != 'completed'");
      if (input.q) {
        where.push('(name LIKE ? OR panchayat LIKE ? OR code LIKE ?)');
        params.push(`%${input.q}%`, `%${input.q}%`, `%${input.q}%`);
      }
      return ctx.db
        .all<{ id: number; code: string; name: string; scheme: string; category: string; department_id: number; block_id: number; panchayat: string | null; sanctioned_lakh: number; physical_pct: number; agency: string | null; target_date: string | null; status: string; public_summary: string | null; approved_at: string | null }>(
          `SELECT id, code, name, scheme, category, department_id, block_id, panchayat, sanctioned_lakh, physical_pct, agency, target_date, status, public_summary, approved_at
             FROM works WHERE ${where.join(' AND ')} ORDER BY status = 'completed', name LIMIT 500`,
          params,
        )
        .map((w) => ({
          ...w,
          status: PUBLIC_STATUS[w.status] ?? 'Work in progress',
          completed: w.status === 'completed',
          blockName: l.block.get(w.block_id)?.name ?? '',
          departmentName: l.dept.get(w.department_id)?.name ?? '',
        }));
    },
  }),

  'public.schemes': proc({
    access: 'public',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      const t = today(ctx);
      const l = lookups(ctx.db);
      const rows = ctx.db.all<{ scheme_id: number; name: string; name_hi: string; indicator: string; unit: string; department_id: number; block_id: number; annual_target: number; achieved: number }>(
        `SELECT t.scheme_id, s.name, s.name_hi, s.indicator, s.unit, s.department_id, t.block_id, t.annual_target, t.achieved
           FROM scheme_targets t JOIN schemes s ON s.id = t.scheme_id WHERE s.public = 1 AND t.fy = ? ORDER BY s.id, t.block_id`,
        [financialYear(t)],
      );
      const ids = Array.from(new Set(rows.map((r) => r.scheme_id)));
      return ids.map((id) => {
        const rs = rows.filter((r) => r.scheme_id === id);
        return {
          id,
          name: rs[0].name,
          name_hi: rs[0].name_hi,
          indicator: rs[0].indicator,
          unit: rs[0].unit,
          departmentName: l.dept.get(rs[0].department_id)?.name ?? '',
          blocks: rs.map((r) => {
            const g = schemeGap(r.annual_target, r.achieved, t);
            return { blockId: r.block_id, blockName: l.block.get(r.block_id)?.name ?? '', annualTarget: r.annual_target, achieved: r.achieved, pctOfAnnual: g.pctOfAnnual, onTrack: g.band !== 'gap' };
          }),
        };
      });
    },
  }),

  'public.facilities': proc({
    access: 'public',
    input: z.object({ blockId: zId.optional(), type: z.string().max(40).optional(), q: z.string().trim().max(80).optional() }).prefault({}),
    run: (ctx, input) => {
      const l = lookups(ctx.db);
      const where = ['public = 1'];
      const params: unknown[] = [];
      if (input.blockId) {
        where.push('block_id = ?');
        params.push(input.blockId);
      }
      if (input.type) {
        where.push('type = ?');
        params.push(input.type);
      }
      if (input.q) {
        where.push('(name LIKE ? OR village LIKE ?)');
        params.push(`%${input.q}%`, `%${input.q}%`);
      }
      return ctx.db
        .all<{ id: number; name: string; type: string; block_id: number; village: string | null; functional_status: string; last_inspected: string | null }>(
          `SELECT id, name, type, block_id, village, functional_status, last_inspected FROM assets WHERE ${where.join(' AND ')} ORDER BY block_id, type, name LIMIT 800`,
          params,
        )
        .map((a) => ({ ...a, typeLabel: ASSET_TYPE_LABEL[a.type] ?? a.type, statusLabel: FUNCTIONAL_LABEL[a.functional_status as keyof typeof FUNCTIONAL_LABEL] ?? a.functional_status, blockName: l.block.get(a.block_id)?.name ?? '' }));
    },
  }),
};
