// Request context, errors, role checks, jurisdiction scoping and the audit trail.

import type { Db } from './db';
import { insert } from './sql';
import type { BlockRow, DepartmentRow, OfficeRow, Role, UserRow } from './types';
import { EXECUTIVE_ROLES } from './types';
import { ymd } from './time';

export interface Ctx {
  db: Db;
  user: UserRow | null;
  now: Date;
}

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const today = (ctx: Ctx) => ymd(ctx.now);

export function requireUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw new AppError(401, 'Please sign in.');
  return ctx.user;
}

export function requireRole(ctx: Ctx, roles: Role[]): UserRow {
  const u = requireUser(ctx);
  if (!roles.includes(u.role)) throw new AppError(403, 'Your role is not permitted to perform this action.');
  return u;
}

export const isExecutive = (u: UserRow | null) => !!u && EXECUTIVE_ROLES.includes(u.role);

/**
 * Jurisdiction filter. Executives see the whole district; a district department officer sees
 * their department in every block; a block / field officer sees their block (and only their
 * department within it, if they belong to one).
 */
export function scopeSql(u: UserRow, blockCol: string | null, deptCol: string | null): { sql: string; params: number[] } {
  if (isExecutive(u)) return { sql: '1=1', params: [] };
  const parts: string[] = [];
  const params: number[] = [];
  if (u.role === 'dept_officer') {
    if (deptCol && u.department_id) {
      parts.push(`${deptCol} = ?`);
      params.push(u.department_id);
    }
  } else {
    if (blockCol && u.block_id) {
      parts.push(`${blockCol} = ?`);
      params.push(u.block_id);
    }
    if (deptCol && u.department_id) {
      parts.push(`${deptCol} = ?`);
      params.push(u.department_id);
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', params };
}

export function inScope(u: UserRow, blockId: number | null, deptId: number | null): boolean {
  if (isExecutive(u)) return true;
  if (u.role === 'dept_officer') return !u.department_id || deptId === u.department_id;
  if (u.block_id && blockId !== u.block_id) return false;
  if (u.department_id && deptId !== u.department_id) return false;
  return true;
}

// ---- cached lookups (small reference tables) ----
export interface Lookups {
  blocks: BlockRow[];
  departments: DepartmentRow[];
  offices: OfficeRow[];
  users: UserRow[];
  block: Map<number, BlockRow>;
  dept: Map<number, DepartmentRow>;
  office: Map<number, OfficeRow>;
  user: Map<number, UserRow>;
}

const cache = new WeakMap<Db, Lookups>();

export function lookups(db: Db): Lookups {
  const hit = cache.get(db);
  if (hit) return hit;
  const blocks = db.all<BlockRow>('SELECT id, code, name, name_hi, panchayats, population FROM blocks ORDER BY name');
  const departments = db.all<DepartmentRow>('SELECT id, code, name, name_hi FROM departments ORDER BY id');
  const offices = db.all<OfficeRow>('SELECT id, name, kind, department_id, block_id FROM offices ORDER BY id');
  const users = db.all<UserRow>('SELECT id, name, designation, role, department_id, block_id, office_id, phone, active FROM users ORDER BY id');
  const l: Lookups = {
    blocks,
    departments,
    offices,
    users,
    block: new Map(blocks.map((b) => [b.id, b])),
    dept: new Map(departments.map((d) => [d.id, d])),
    office: new Map(offices.map((o) => [o.id, o])),
    user: new Map(users.map((u) => [u.id, u])),
  };
  cache.set(db, l);
  return l;
}

export function invalidateLookups(db: Db) {
  cache.delete(db);
}

export function audit(ctx: Ctx, action: string, entityType: string, entityId: number | null, summary: string, details?: unknown) {
  insert(ctx.db, 'audit_log', {
    at: ctx.now.toISOString(),
    user_id: ctx.user?.id ?? null,
    user_name: ctx.user?.name ?? 'Public',
    role: ctx.user?.role ?? 'public',
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
    details: details === undefined ? null : JSON.stringify(details),
  });
}

export function officerInfo(l: Lookups, id: number | null | undefined) {
  const u = id ? l.user.get(id) : undefined;
  return { officerId: u?.id ?? null, officerName: u?.name ?? null, officerDesignation: u?.designation ?? null, officerPhone: u?.phone ?? null };
}
