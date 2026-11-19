import { z } from 'zod';
import { AppError, audit, isExecutive, lookups, requireRole, requireUser, today } from '../context';
import { scopedActions } from '../issues';
import { buildAgenda } from '../priority';
import { insert, update } from '../sql';
import type { ActionItemRow, AgendaCategory, EvidenceMeta } from '../types';
import { ACTION_STATUS_LABEL, AGENDA_CATEGORY_LABEL } from '../types';
import { daysBetween } from '../time';
import { EVIDENCE_COLS, withNames } from './assets';
import { proc, zDate, zEvidence, zId, zText } from './_proc';

const CATEGORIES = ['work_delay', 'file_delay', 'critical_finding', 'service_gap', 'coordination'] as const;

/** Route to the record an action came from (asset page for findings, scheme row for gaps). */
function actionLink(db: Parameters<typeof lookups>[0], a: ActionItemRow): string | null {
  const id = a.ref_id ?? 0;
  if (a.ref_type === 'work' && id) return `/works/${id}`;
  if (a.ref_type === 'file' && id) return `/files/${id}`;
  if (a.ref_type === 'initiative' && id) return `/dependencies?id=${id}`;
  if (a.ref_type === 'finding' && id) {
    const r = db.get<{ asset_id: number }>('SELECT asset_id FROM findings WHERE id = ?', [id]);
    return r ? `/assets/${r.asset_id}?finding=${id}` : null;
  }
  if (a.ref_type === 'scheme_target') {
    if (id) {
      const r = db.get<{ scheme_id: number; block_id: number }>('SELECT scheme_id, block_id FROM scheme_targets WHERE id = ?', [id]);
      if (r) return `/schemes?scheme=${r.scheme_id}&block=${r.block_id}`;
    }
    const m = /^gap:([^:]+):(\d+)$/.exec(a.agenda_key ?? '');
    if (m) {
      const s = db.get<{ id: number }>('SELECT id FROM schemes WHERE code = ?', [m[1]]);
      if (s) return `/schemes?scheme=${s.id}&block=${m[2]}`;
    }
  }
  const k = /^initiative:(\d+)$/.exec(a.agenda_key ?? '');
  return k ? `/dependencies?id=${k[1]}` : null;
}

function decorateActions(ctx: Parameters<typeof buildAgenda>[0], rows: ActionItemRow[]) {
  const l = lookups(ctx.db);
  const t = today(ctx);
  const ids = rows.map((r) => r.id);
  const ev = ids.length
    ? withNames(ctx.db, ctx.db.all<EvidenceMeta>(`SELECT ${EVIDENCE_COLS} FROM evidence WHERE entity_type = 'action' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY uploaded_at DESC`, ids))
    : [];
  const u = ctx.user!;
  return rows.map((a) => {
    const assignee = l.user.get(a.assigned_to);
    const overdueBy = a.status !== 'closed' ? Math.max(0, daysBetween(a.deadline, t)) : 0;
    const evidence = ev.filter((e) => e.entity_id === a.id);
    const pending = evidence.find((e) => e.review_status === 'pending');
    return {
      ...a,
      statusLabel: ACTION_STATUS_LABEL[a.status],
      categoryLabel: a.agenda_category ? AGENDA_CATEGORY_LABEL[a.agenda_category as AgendaCategory] ?? a.agenda_category : null,
      assigneeName: assignee?.name ?? '',
      assigneeDesignation: assignee?.designation ?? '',
      assigneePhone: assignee?.phone ?? null,
      departmentName: a.department_id ? l.dept.get(a.department_id)?.name ?? null : null,
      blockName: a.block_id ? l.block.get(a.block_id)?.name ?? null : null,
      meetingTitle: a.meeting_id ? ctx.db.get<{ title: string; meeting_date: string }>('SELECT title, meeting_date FROM meetings WHERE id = ?', [a.meeting_id]) ?? null : null,
      overdueBy,
      evidence,
      refLink: actionLink(ctx.db, a),
      can: {
        update: a.status !== 'closed' && (a.assigned_to === u.id || isExecutive(u)),
        submit: (a.status === 'open' || a.status === 'in_progress' || a.status === 'reopened') && (a.assigned_to === u.id || isExecutive(u)),
        verify: a.status === 'resolution_submitted' && isExecutive(u) && !!pending && pending.uploaded_by !== u.id,
      },
    };
  });
}

export const reviewProcs = {
  /** Ranked agenda with "why flagged" for the next review meeting. */
  'review.agenda': proc({
    access: 'auth',
    input: z
      .object({ blockId: zId.optional(), departmentId: zId.optional(), category: z.enum(CATEGORIES).optional(), limit: z.number().int().min(1).max(200).default(25) })
      .prefault({}),
    run: (ctx, input) => buildAgenda(ctx, input),
  }),

  'review.meetings': proc({
    access: 'auth',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      requireUser(ctx);
      const l = lookups(ctx.db);
      const rows = ctx.db.all<{ id: number; title: string; meeting_date: string; chaired_by: number | null; status: string; minutes: string | null }>(
        'SELECT id, title, meeting_date, chaired_by, status, minutes FROM meetings ORDER BY meeting_date DESC',
      );
      return rows.map((m) => {
        const c = ctx.db.get<{ total: number; closed: number }>("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed FROM action_items WHERE meeting_id = ?", [m.id]);
        return { ...m, chairName: m.chaired_by ? l.user.get(m.chaired_by)?.name ?? null : null, actions: c?.total ?? 0, closed: c?.closed ?? 0 };
      });
    },
  }),

  'review.createMeeting': proc({
    access: ['dm', 'ddc'],
    mutation: true,
    input: z.object({ title: zText(200).min(3), date: zDate }),
    run: (ctx, input) => {
      const u = requireRole(ctx, ['dm', 'ddc']);
      const id = insert(ctx.db, 'meetings', { title: input.title, meeting_date: input.date, chaired_by: u.role === 'dm' ? u.id : lookups(ctx.db).users.find((x) => x.role === 'dm')?.id ?? u.id, status: 'scheduled', minutes: null, created_at: ctx.now.toISOString() });
      audit(ctx, 'meeting.created', 'meeting', id, `Review meeting "${input.title}" scheduled for ${input.date}`);
      return { ok: true, id };
    },
  }),

  'review.closeMeeting': proc({
    access: ['dm', 'ddc'],
    mutation: true,
    input: z.object({ id: zId, minutes: zText(4000).min(3) }),
    run: (ctx, input) => {
      requireRole(ctx, ['dm', 'ddc']);
      const m = ctx.db.get<{ id: number; title: string }>('SELECT id, title FROM meetings WHERE id = ?', [input.id]);
      if (!m) throw new AppError(404, 'Meeting not found');
      update(ctx.db, 'meetings', m.id, { status: 'held', minutes: input.minutes });
      audit(ctx, 'meeting.held', 'meeting', m.id, `Minutes recorded for "${m.title}"`);
      return { ok: true };
    },
  }),

  /** Review Decision Logger: an agenda item becomes an owned action with a deadline. */
  'review.logDecision': proc({
    access: ['dm', 'ddc'],
    mutation: true,
    input: z.object({
      meetingId: zId.optional().nullable(),
      agendaKey: z.string().max(80),
      category: z.enum(CATEGORIES),
      title: zText(300).min(3),
      decision: zText(1200).min(5, 'Record the decision taken'),
      assignedTo: zId,
      deadline: zDate,
      refType: z.string().max(30).optional().nullable(),
      refId: z.number().int().min(0).optional().nullable(),
      departmentId: zId.optional().nullable(),
      blockId: zId.optional().nullable(),
    }),
    run: (ctx, input) => {
      const u = requireRole(ctx, ['dm', 'ddc']);
      const l = lookups(ctx.db);
      const assignee = l.user.get(input.assignedTo);
      if (!assignee) throw new AppError(400, 'Unknown officer');
      if (input.deadline < today(ctx)) throw new AppError(400, 'Deadline cannot be in the past.');
      if (input.meetingId && !ctx.db.get('SELECT id FROM meetings WHERE id = ?', [input.meetingId])) throw new AppError(400, 'Unknown meeting');
      const at = ctx.now.toISOString();
      const id = insert(ctx.db, 'action_items', {
        meeting_id: input.meetingId ?? null, agenda_key: input.agendaKey, agenda_category: input.category, title: input.title, decision: input.decision,
        assigned_to: input.assignedTo, department_id: input.departmentId ?? assignee.department_id ?? null, block_id: input.blockId ?? assignee.block_id ?? null,
        deadline: input.deadline, status: 'open', ref_type: input.refType ?? null, ref_id: input.refId ?? null, progress_note: null,
        created_by: u.id, created_at: at, updated_at: at, closed_at: null, closed_by: null,
      });
      audit(ctx, 'action.created', 'action', id, `Review decision: "${input.title}" → ${assignee.name}, due ${input.deadline}`, { decision: input.decision, agendaKey: input.agendaKey });
      return { ok: true, id };
    },
  }),

  'review.actions': proc({
    access: 'auth',
    input: z
      .object({
        status: z.enum(['all', 'open', 'overdue', 'submitted', 'closed']).default('all'),
        meetingId: zId.optional(),
        mine: z.boolean().optional(),
        q: z.string().trim().max(100).optional(),
      })
      .prefault({}),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const t = today(ctx);
      let rows = scopedActions(ctx);
      if (input.meetingId) rows = rows.filter((r) => r.meeting_id === input.meetingId);
      if (input.mine) rows = rows.filter((r) => r.assigned_to === u.id);
      const all = rows;
      if (input.status === 'open') rows = rows.filter((r) => r.status !== 'closed');
      if (input.status === 'overdue') rows = rows.filter((r) => r.status !== 'closed' && r.deadline < t);
      if (input.status === 'submitted') rows = rows.filter((r) => r.status === 'resolution_submitted');
      if (input.status === 'closed') rows = rows.filter((r) => r.status === 'closed');
      if (input.q) {
        const q = input.q.toLowerCase();
        rows = rows.filter((r) => `${r.title} ${r.decision}`.toLowerCase().includes(q));
      }
      rows.sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.deadline.localeCompare(b.deadline));
      return {
        rows: decorateActions(ctx, rows),
        counts: {
          all: all.length,
          open: all.filter((r) => r.status !== 'closed').length,
          overdue: all.filter((r) => r.status !== 'closed' && r.deadline < t).length,
          submitted: all.filter((r) => r.status === 'resolution_submitted').length,
          closed: all.filter((r) => r.status === 'closed').length,
        },
      };
    },
  }),

  'review.updateAction': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ id: zId, note: zText(600).min(3), deadline: zDate.optional() }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const a = ctx.db.get<ActionItemRow>('SELECT * FROM action_items WHERE id = ?', [input.id]);
      if (!a) throw new AppError(404, 'Action not found');
      if (a.status === 'closed') throw new AppError(400, 'Action is closed.');
      if (a.assigned_to !== u.id && !isExecutive(u)) throw new AppError(403, 'Only the assigned officer can update this action.');
      if (input.deadline && !isExecutive(u)) throw new AppError(403, 'Only the DM / DDC can extend a deadline.');
      update(ctx.db, 'action_items', a.id, {
        status: a.status === 'open' || a.status === 'reopened' ? 'in_progress' : a.status,
        progress_note: input.note,
        deadline: input.deadline ?? a.deadline,
        updated_at: ctx.now.toISOString(),
      });
      audit(ctx, 'action.progress', 'action', a.id, `"${a.title}": ${input.note}${input.deadline ? ` (deadline → ${input.deadline})` : ''}`);
      return { ok: true };
    },
  }),

  'review.submitActionEvidence': proc({
    access: 'auth',
    mutation: true,
    input: z.object({ id: zId, note: zText(600).min(5, 'Describe what was done'), evidence: zEvidence }),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const a = ctx.db.get<ActionItemRow>('SELECT * FROM action_items WHERE id = ?', [input.id]);
      if (!a) throw new AppError(404, 'Action not found');
      if (a.assigned_to !== u.id && !isExecutive(u)) throw new AppError(403, 'Only the assigned officer can submit evidence.');
      if (a.status === 'closed' || a.status === 'resolution_submitted') throw new AppError(400, 'Evidence already submitted or action closed.');
      const at = ctx.now.toISOString();
      const evId = insert(ctx.db, 'evidence', {
        entity_type: 'action', entity_id: a.id, file_name: input.evidence.fileName, mime: input.evidence.mime, size: input.evidence.size,
        data_url: input.evidence.dataUrl, sha256: input.evidence.sha256 ?? null, note: input.note, uploaded_by: u.id, uploaded_at: at, review_status: 'pending',
      });
      update(ctx.db, 'action_items', a.id, { status: 'resolution_submitted', progress_note: input.note, updated_at: at });
      audit(ctx, 'action.resolution_submitted', 'action', a.id, `Evidence submitted for "${a.title}": ${input.evidence.fileName}`, { evidenceId: evId, sha256: input.evidence.sha256 });
      return { ok: true, evidenceId: evId };
    },
  }),

  'review.verifyAction': proc({
    access: ['dm', 'ddc'],
    mutation: true,
    input: z.object({ id: zId, evidenceId: zId, decision: z.enum(['accept', 'reject']), remark: zText(600).min(3) }),
    run: (ctx, input) => {
      const u = requireRole(ctx, ['dm', 'ddc']);
      const a = ctx.db.get<ActionItemRow>('SELECT * FROM action_items WHERE id = ?', [input.id]);
      if (!a) throw new AppError(404, 'Action not found');
      const ev = ctx.db.get<EvidenceMeta>(`SELECT ${EVIDENCE_COLS} FROM evidence WHERE id = ? AND entity_type = 'action' AND entity_id = ?`, [input.evidenceId, a.id]);
      if (!ev) throw new AppError(404, 'Evidence not found');
      if (ev.review_status !== 'pending') throw new AppError(400, 'Evidence already reviewed.');
      if (ev.uploaded_by === u.id) throw new AppError(403, 'Separation of duties: you cannot verify evidence you uploaded.');
      const at = ctx.now.toISOString();
      update(ctx.db, 'evidence', ev.id, { review_status: input.decision === 'accept' ? 'accepted' : 'rejected', reviewed_by: u.id, reviewed_at: at, review_remark: input.remark });
      update(ctx.db, 'action_items', a.id, input.decision === 'accept' ? { status: 'closed', closed_at: at, closed_by: u.id, updated_at: at } : { status: 'reopened', updated_at: at });
      audit(ctx, input.decision === 'accept' ? 'action.closed' : 'action.reopened', 'action', a.id, `"${a.title}" — evidence ${input.decision === 'accept' ? 'verified, action closed' : 'rejected, action reopened'}`, { remark: input.remark });
      return { ok: true };
    },
  }),

  /** Everything needed for the one-click review brief (CSV + print-ready PDF view). */
  'review.brief': proc({
    access: 'auth',
    input: z.object({ meetingId: zId.optional(), blockId: zId.optional(), departmentId: zId.optional(), limit: z.number().int().min(1).max(100).default(20) }).prefault({}),
    run: (ctx, input) => {
      const u = requireUser(ctx);
      const l = lookups(ctx.db);
      const agenda = buildAgenda(ctx, { blockId: input.blockId, departmentId: input.departmentId, limit: input.limit });
      const meeting = input.meetingId
        ? ctx.db.get<{ id: number; title: string; meeting_date: string; status: string; minutes: string | null; chaired_by: number | null }>('SELECT * FROM meetings WHERE id = ?', [input.meetingId]) ?? null
        : ctx.db.get<{ id: number; title: string; meeting_date: string; status: string; minutes: string | null; chaired_by: number | null }>("SELECT * FROM meetings WHERE status = 'scheduled' ORDER BY meeting_date LIMIT 1") ?? null;
      let actions = scopedActions(ctx);
      actions = actions.filter((a) => a.status !== 'closed' || (a.closed_at ?? '') >= new Date(ctx.now.getTime() - 30 * 86400000).toISOString());
      actions.sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.deadline.localeCompare(b.deadline));
      return {
        generatedAt: ctx.now.toISOString(),
        generatedBy: `${u.name}, ${u.designation}`,
        meeting: meeting ? { ...meeting, chairName: meeting.chaired_by ? l.user.get(meeting.chaired_by)?.name ?? null : null } : null,
        agenda,
        actions: decorateActions(ctx, actions),
      };
    },
  }),
};
