import { z } from 'zod';
import { lookups, requireUser } from '../context';
import { ROLE_LABEL } from '../types';
import { proc } from './_proc';

export const sessionProcs = {
  /** The signed-in user (or null). */
  'session.me': proc({
    access: 'public',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      if (!ctx.user) return null;
      const l = lookups(ctx.db);
      const u = ctx.user;
      return {
        ...u,
        roleLabel: ROLE_LABEL[u.role],
        departmentName: u.department_id ? l.dept.get(u.department_id)?.name ?? null : null,
        blockName: u.block_id ? l.block.get(u.block_id)?.name ?? null : null,
        officeName: u.office_id ? l.office.get(u.office_id)?.name ?? null : null,
        jurisdiction:
          u.role === 'dm' || u.role === 'ddc'
            ? 'Whole district'
            : u.role === 'dept_officer'
              ? `${l.dept.get(u.department_id ?? 0)?.name ?? ''} — all blocks`
              : `${l.block.get(u.block_id ?? 0)?.name ?? ''} block${u.department_id ? ` — ${l.dept.get(u.department_id)?.name}` : ' — all departments'}`,
      };
    },
  }),

  /** Demo personas for the sign-in screen (fictional officers). */
  'session.personas': proc({
    access: 'public',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      const l = lookups(ctx.db);
      return l.users
        .filter((u) => u.active)
        .map((u) => ({
          id: u.id,
          name: u.name,
          designation: u.designation,
          role: u.role,
          roleLabel: ROLE_LABEL[u.role],
          departmentName: u.department_id ? l.dept.get(u.department_id)?.name ?? null : null,
          blockName: u.block_id ? l.block.get(u.block_id)?.name ?? null : null,
        }));
    },
  }),

  /** Reference lists for filters and forms. */
  'ref.lookups': proc({
    access: 'auth',
    input: z.object({}).prefault({}),
    run: (ctx) => {
      requireUser(ctx);
      const l = lookups(ctx.db);
      return {
        blocks: l.blocks,
        departments: l.departments,
        offices: l.offices,
        users: l.users.map((u) => ({ id: u.id, name: u.name, designation: u.designation, role: u.role, department_id: u.department_id, block_id: u.block_id, office_id: u.office_id, phone: u.phone })),
      };
    },
  }),
};
