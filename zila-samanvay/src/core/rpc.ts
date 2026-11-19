// The single procedure registry and executor. Both the Express server and the zero-install
// browser build call `execute`, so access control, validation, transactions and auditing
// behave identically everywhere.

import { ZodError } from 'zod';
import { AppError, type Ctx } from './context';
import { assetsProcs } from './procedures/assets';
import { dashboardProcs } from './procedures/dashboard';
import { deskProcs } from './procedures/desk';
import { filesProcs } from './procedures/files';
import { publicProcs } from './procedures/public';
import { reviewProcs } from './procedures/review';
import { schemesProcs } from './procedures/schemes';
import { sessionProcs } from './procedures/session';
import { worksProcs } from './procedures/works';
import type { ProcDef } from './procedures/_proc';

export const procedures = {
  ...sessionProcs,
  ...dashboardProcs,
  ...worksProcs,
  ...schemesProcs,
  ...filesProcs,
  ...assetsProcs,
  ...reviewProcs,
  ...deskProcs,
  ...publicProcs,
};

export type Procedures = typeof procedures;
export type ProcName = keyof Procedures;
type AnyProc = ProcDef<import('zod').ZodTypeAny, unknown>;
export type ProcInput<N extends ProcName> = import('zod').input<Procedures[N]['input']>;
export type ProcOutput<N extends ProcName> = ReturnType<Procedures[N]['run']>;

/** Own-property lookup only, so names like "__proto__" or "constructor" never resolve. */
function lookup(name: string): AnyProc | undefined {
  return Object.prototype.hasOwnProperty.call(procedures, name) ? (procedures as unknown as Record<string, AnyProc>)[name] : undefined;
}

export function isMutation(name: string): boolean {
  return !!lookup(name)?.mutation;
}

export function execute(name: string, rawInput: unknown, ctx: Ctx): unknown {
  const p = lookup(name);
  if (!p) throw new AppError(404, 'Unknown procedure');
  if (p.access !== 'public') {
    if (!ctx.user) throw new AppError(401, 'Please sign in.');
    if (Array.isArray(p.access) && !p.access.includes(ctx.user.role)) throw new AppError(403, 'Your role is not permitted to perform this action.');
  }
  let input: unknown;
  try {
    input = p.input.parse(rawInput ?? {});
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      throw new AppError(400, `${first.path.length ? first.path.join('.') + ': ' : ''}${first.message}`);
    }
    throw e;
  }
  return p.mutation ? ctx.db.transaction(() => p.run(ctx, input)) : p.run(ctx, input);
}

export function errorPayload(e: unknown): { status: number; message: string } {
  if (e instanceof AppError) return { status: e.status, message: e.message };
  console.error(e);
  return { status: 500, message: 'Unexpected error. The action was not saved.' };
}
