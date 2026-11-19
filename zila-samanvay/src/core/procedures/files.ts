import { z } from 'zod';
import { AppError, audit, inScope, isExecutive, lookups, requireUser, today } from '../context';
import { fileScope } from '../issues';
import { fileAging, RULES } from '../rules';
import { insert, update } from '../sql';
import type { FileRow, UserRow } from '../types';
import { FILE_STATUS_LABEL } from '../types';
import { daysBetween } from '../time';
import { paginate, proc, zId, zPage, zText } from './_proc';

interface MovementRow {
  id: number;
  file_id: number;
  at: string;
  action: string;
  from_office_id: number | null;
  to_office_id: number | null;
  by_user_id: number | null;
  to_user_id: number | null;
  remark: string | null;
}

function canAct(u: UserRow, f: FileRow) {
  return isExecutive(u) || f.current_holder_id === u.id || (u.office_id !== null && f.current_office_id === u.office_id);
}

function allowedActions(u: UserRow, f: FileRow): string[] {
  if (!canAct(u, f) || f.status === 'closed') return [];
  if (f.status === 'query') return ['reply', 'forward', 'close'];
  if (f.status === 'approved') return ['forward', 'close'];
  return ['forward', 'approve', 'query', 'return', 'close'];
}

function defaultHolder(db: Parameters<typeof lookups>[0], officeId: number): number | null {
  return (
    db.get<{ id: number }>(
      "SELECT id FROM users WHERE office_id = ? AND active = 1 ORDER BY CASE role WHEN 'dm' THEN 0 WHEN 'ddc' THEN 0 WHEN 'dept_officer' THEN 1 ELSE 2 END, designation LIKE 'Block Development%' DESC, id LIMIT 1",
      [officeId],
    )?.id ?? null
  );
}

export const filesProcs = {
  'files.list': proc({
    access: 'auth',
    input: z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['pending', 'query', 'approved', 'closed', 'all']).default('pending'),
      aging: z.enum(['all', 'within', 'near', 'beyond', 'critical', 'overdue']).default('all'),
      officeId: zId.optional(),
      departmentId: zId.optional(),
      blockId: zId.optional(),
      mine: z.boolean().optional(),
      sort: z.enum(['age', 'recent', 'total']).default('age'),
      ...zPage,
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const s = fileScope(u);
      let rows = ctx.db.all<FileRow>(`SELECT f.* FROM files f WHERE ${s.sql}`, s.params).map((f) => {
        const a = fileAging(f, t);
        const holder = f.current_holder_id ? l.user.get(f.current_holder_id) : undefined;
        return {
          ...f,
          aging: a,
          statusLabel: FILE_STATUS_LABEL[f.status],
          officeName: l.office.get(f.current_office_id)?.name ?? '',
          holderName: holder?.name ?? null,
          holderDesignation: holder?.designation ?? null,
          departmentName: l.dept.get(f.department_id)?.name ?? '',
          blockName: f.block_id ? l.block.get(f.block_id)?.name ?? null : null,
          atMyDesk: f.current_holder_id === u.id,
        };
      });
      const base = rows;
      if (input.status === 'pending') rows = rows.filter((r) => r.status === 'open' || r.status === 'query');
      else if (input.status !== 'all') rows = rows.filter((r) => r.status === input.status);
      if (input.aging === 'overdue') rows = rows.filter((r) => r.aging.band === 'beyond' || r.aging.band === 'critical');
      else if (input.aging !== 'all') rows = rows.filter((r) => r.aging.band === input.aging);
      if (input.officeId) rows = rows.filter((r) => r.current_office_id === input.officeId);
      if (input.departmentId) rows = rows.filter((r) => r.department_id === input.departmentId);
      if (input.blockId) rows = rows.filter((r) => r.block_id === input.blockId);
      if (input.mine) rows = rows.filter((r) => r.current_holder_id === u.id);
      if (input.q) {
        const q = input.q.toLowerCase();
        rows = rows.filter((r) => `${r.file_no} ${r.subject} ${r.officeName} ${r.holderName ?? ''}`.toLowerCase().includes(q));
      }
      if (input.sort === 'age') rows.sort((a, b) => b.aging.overSla - a.aging.overSla || b.aging.daysAtDesk - a.aging.daysAtDesk);
      else if (input.sort === 'total') rows.sort((a, b) => b.aging.totalDays - a.aging.totalDays);
      else rows.sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));

      const pending = base.filter((r) => r.status === 'open' || r.status === 'query');
      const deskMap = new Map<number, { officeId: number; officeName: string; pending: number; beyond: number; maxDays: number }>();
      for (const r of pending) {
        const d = deskMap.get(r.current_office_id) ?? { officeId: r.current_office_id, officeName: r.officeName, pending: 0, beyond: 0, maxDays: 0 };
        d.pending++;
        if (r.aging.overSla > 0) d.beyond++;
        d.maxDays = Math.max(d.maxDays, r.aging.daysAtDesk);
        deskMap.set(r.current_office_id, d);
      }
      return {
        ...paginate(rows, input.page, input.pageSize),
        counts: {
          pending: pending.length,
          query: pending.filter((r) => r.status === 'query').length,
          within: pending.filter((r) => r.aging.band === 'within').length,
          near: pending.filter((r) => r.aging.band === 'near').length,
          beyond: pending.filter((r) => r.aging.band === 'beyond').length,
          critical: pending.filter((r) => r.aging.band === 'critical').length,
          approved: base.filter((r) => r.status === 'approved').length,
          closed: base.filter((r) => r.status === 'closed').length,
          mine: pending.filter((r) => r.current_holder_id === u.id).length,
        },
        desks: Array.from(deskMap.values()).sort((a, b) => b.beyond - a.beyond || b.pending - a.pending),
      };
    },
  }),

  'files.get': proc({
    access: 'auth',
    input: z.object({ id: zId }),
    run: (ctx, { id }) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const t = today(ctx);
      const s = fileScope(u);
      // Read access: jurisdiction, current desk, or any officer who has handled the file
      // (so the officer who just forwarded it can still follow it).
      const f = ctx.db.get<FileRow>(
        `SELECT f.* FROM files f WHERE f.id = ? AND (${s.sql} OR EXISTS (SELECT 1 FROM file_movements m WHERE m.file_id = f.id AND (m.by_user_id = ? OR m.to_user_id = ?)))`,
        [id, ...s.params, u.id, u.id],
      );
      if (!f) throw new AppError(404, 'File not found or outside your jurisdiction.');
      const moves = ctx.db.all<MovementRow>('SELECT * FROM file_movements WHERE file_id = ? ORDER BY at, id', [id]);
      const movements = moves.map((m, i) => {
        const next = moves[i + 1];
        const by = m.by_user_id ? l.user.get(m.by_user_id) : undefined;
        const to = m.to_user_id ? l.user.get(m.to_user_id) : undefined;
        return {
          ...m,
          fromOffice: m.from_office_id ? l.office.get(m.from_office_id)?.name ?? null : null,
          toOffice: m.to_office_id ? l.office.get(m.to_office_id)?.name ?? null : null,
          byName: by?.name ?? null,
          byDesignation: by?.designation ?? null,
          toName: to?.name ?? null,
          daysHeld: daysBetween(m.at, next ? next.at : f.status === 'closed' && f.closed_at ? f.closed_at : t),
        };
      });
      const work = f.work_id ? ctx.db.get<{ id: number; code: string; name: string; physical_pct: number; status: string }>('SELECT id, code, name, physical_pct, status FROM works WHERE id = ?', [f.work_id]) : null;
      const asset = f.asset_id ? ctx.db.get<{ id: number; code: string; name: string; condition: string }>('SELECT id, code, name, condition FROM assets WHERE id = ?', [f.asset_id]) : null;
      const holder = f.current_holder_id ? l.user.get(f.current_holder_id) : undefined;
      const creator = f.created_by ? l.user.get(f.created_by) : undefined;
      return {
        file: {
          ...f,
          aging: fileAging(f, t),
          statusLabel: FILE_STATUS_LABEL[f.status],
          officeName: l.office.get(f.current_office_id)?.name ?? '',
          holderName: holder?.name ?? null,
          holderDesignation: holder?.designation ?? null,
          holderPhone: holder?.phone ?? null,
          departmentName: l.dept.get(f.department_id)?.name ?? '',
          blockName: f.block_id ? l.block.get(f.block_id)?.name ?? null : null,
          creatorName: creator?.name ?? null,
        },
        movements,
        queryCount: moves.filter((m) => m.action === 'query').length,
        work: work ?? null,
        asset: asset ?? null,
        allowedActions: allowedActions(u, f),
      };
    },
  }),

  /** Forward / Approve / Query / Reply / Return / Close — every action is time-stamped and audited. */
  'files.act': proc({
    access: 'auth',
    mutation: true,
    input: z.object({
      id: zId,
      action: z.enum(['forward', 'approve', 'query', 'reply', 'return', 'close']),
      toOfficeId: zId.optional(),
      toUserId: zId.optional(),
      remark: zText(600).min(3, 'A remark / noting is required'),
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const f = ctx.db.get<FileRow>('SELECT * FROM files WHERE id = ?', [input.id]);
      if (!f) throw new AppError(404, 'File not found');
      if (!allowedActions(u, f).includes(input.action)) throw new AppError(403, `You cannot "${input.action}" this file. Only the officer holding the file (or the DM / DDC) can act on it.`);
      const at = ctx.now.toISOString();
      const moves = ctx.db.all<MovementRow>('SELECT * FROM file_movements WHERE file_id = ? ORDER BY at, id', [f.id]);
      const from = f.current_office_id;
      let toOffice = from;
      let toUser: number | null = f.current_holder_id;
      let status = f.status;
      let arrived = f.arrived_at;
      switch (input.action) {
        case 'forward': {
          if (!input.toOfficeId) throw new AppError(400, 'Choose the office to forward to.');
          if (!l.office.get(input.toOfficeId)) throw new AppError(400, 'Unknown office.');
          if (input.toOfficeId === from && !input.toUserId) throw new AppError(400, 'The file is already at this office.');
          toOffice = input.toOfficeId;
          toUser = input.toUserId ?? defaultHolder(ctx.db, toOffice);
          if (input.toUserId && l.user.get(input.toUserId)?.office_id !== toOffice) throw new AppError(400, 'That officer does not sit in the selected office.');
          status = status === 'approved' ? 'approved' : 'open';
          arrived = at;
          break;
        }
        case 'approve': {
          const origin = moves[0];
          toOffice = origin?.from_office_id ?? from;
          toUser = f.created_by ?? defaultHolder(ctx.db, toOffice);
          status = 'approved';
          arrived = at;
          break;
        }
        case 'query':
        case 'return': {
          const prev = [...moves].reverse().find((m) => m.to_office_id === from && m.from_office_id && m.from_office_id !== from);
          toOffice = input.toOfficeId ?? prev?.from_office_id ?? from;
          toUser = input.toUserId ?? prev?.by_user_id ?? defaultHolder(ctx.db, toOffice);
          if (toOffice === from && !input.toOfficeId) throw new AppError(400, 'No earlier desk to send the file back to — choose an office.');
          status = input.action === 'query' ? 'query' : 'open';
          arrived = at;
          break;
        }
        case 'reply': {
          const q = [...moves].reverse().find((m) => m.action === 'query');
          if (!q || !q.from_office_id) throw new AppError(400, 'No query found to reply to.');
          toOffice = q.from_office_id;
          toUser = q.by_user_id ?? defaultHolder(ctx.db, toOffice);
          status = 'open';
          arrived = at;
          break;
        }
        case 'close': {
          status = 'closed';
          break;
        }
      }
      const actionWord = { forward: 'forwarded', approve: 'approved', query: 'query', reply: 'replied', return: 'returned', close: 'closed' }[input.action];
      update(ctx.db, 'files', f.id, {
        current_office_id: toOffice,
        current_holder_id: toUser,
        status,
        arrived_at: arrived,
        closed_at: status === 'closed' ? at : null,
      });
      insert(ctx.db, 'file_movements', { file_id: f.id, at, action: actionWord, from_office_id: from, to_office_id: toOffice, by_user_id: u.id, to_user_id: toUser, remark: input.remark });
      const fromName = l.office.get(from)?.name;
      const toName = l.office.get(toOffice)?.name;
      audit(ctx, `file.${actionWord}`, 'file', f.id, `${f.file_no}: ${actionWord}${toOffice !== from ? ` — ${fromName} → ${toName}` : ''}`, { remark: input.remark });
      return { ok: true, status, officeName: toName ?? '', holderName: toUser ? l.user.get(toUser)?.name ?? null : null };
    },
  }),

  'files.create': proc({
    access: 'auth',
    mutation: true,
    input: z.object({
      subject: zText(300).min(5),
      category: z.enum(Object.keys(RULES.fileSla) as [string, ...string[]]),
      departmentId: zId,
      blockId: zId.optional().nullable(),
      decisionRequired: zText(600).min(5),
      slaDays: z.number().int().min(1).max(120).optional(),
      priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
      toOfficeId: zId,
      toUserId: zId.optional(),
      workId: zId.optional().nullable(),
      assetId: zId.optional().nullable(),
      amountLakh: z.number().min(0).optional().nullable(),
      remark: zText(600).optional(),
    }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      if (!inScope(u, input.blockId ?? u.block_id ?? null, input.departmentId) && !isExecutive(u)) throw new AppError(403, 'You can open files only for your own department / block.');
      const dept = l.dept.get(input.departmentId);
      if (!dept) throw new AppError(400, 'Unknown department');
      if (!l.office.get(input.toOfficeId)) throw new AppError(400, 'Unknown office');
      const blk = input.blockId ? l.block.get(input.blockId) : undefined;
      const year = today(ctx).slice(0, 4);
      const seq = (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n ?? 0) + 501;
      const fileNo = `${dept.code === 'EDU' ? 'EDN' : dept.code}/${blk?.code ?? 'DIST'}/${year}/${seq}`;
      const at = ctx.now.toISOString();
      const myOffice = u.office_id ?? input.toOfficeId;
      const toUser = input.toUserId ?? defaultHolder(ctx.db, input.toOfficeId);
      const id = insert(ctx.db, 'files', {
        file_no: fileNo, subject: input.subject, category: input.category, department_id: input.departmentId, block_id: input.blockId ?? null,
        current_office_id: input.toOfficeId, current_holder_id: toUser, status: 'open', priority: input.priority, decision_required: input.decisionRequired,
        sla_days: input.slaDays ?? RULES.fileSla[input.category] ?? 15, amount_lakh: input.amountLakh ?? null, work_id: input.workId ?? null, asset_id: input.assetId ?? null,
        opened_at: at, arrived_at: at, closed_at: null, created_by: u.id,
      });
      insert(ctx.db, 'file_movements', { file_id: id, at, action: 'created', from_office_id: myOffice, to_office_id: myOffice, by_user_id: u.id, to_user_id: u.id, remark: input.remark || 'File opened.' });
      if (input.toOfficeId !== myOffice) {
        insert(ctx.db, 'file_movements', { file_id: id, at, action: 'forwarded', from_office_id: myOffice, to_office_id: input.toOfficeId, by_user_id: u.id, to_user_id: toUser, remark: input.remark || 'Put up for decision.' });
      }
      audit(ctx, 'file.created', 'file', id, `${fileNo}: opened and sent to ${l.office.get(input.toOfficeId)?.name}`);
      return { ok: true, id, fileNo };
    },
  }),
};
