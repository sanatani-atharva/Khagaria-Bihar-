import { z } from 'zod';
import type { Ctx } from '../context';
import type { Role } from '../types';

/** 'public' = no sign-in; 'auth' = any signed-in officer; Role[] = only these roles. */
export type Access = 'public' | 'auth' | Role[];

export interface ProcDef<I extends z.ZodTypeAny, O> {
  access: Access;
  /** Mutations run inside a transaction and trigger persistence. */
  mutation?: boolean;
  input: I;
  run: (ctx: Ctx, input: z.output<I>) => O;
}

export function proc<I extends z.ZodTypeAny, O>(def: ProcDef<I, O>): ProcDef<I, O> {
  return def;
}

export const zId = z.number().int().positive();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const zText = (max = 2000) => z.string().trim().max(max);
export const zPage = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(200).default(25),
};

/** Evidence upload. Images are compressed to WebP in the browser; PDFs pass through. */
export const zEvidence = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mime: z.enum(['image/webp', 'image/jpeg', 'image/png', 'application/pdf']),
    dataUrl: z.string().max(3_500_000),
    size: z.number().int().positive().max(2_600_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .refine((e) => e.dataUrl.startsWith(`data:${e.mime};base64,`), { message: 'File content does not match its type' })
  .refine((e) => hasSignature(e.mime, e.dataUrl), { message: 'File content is not a valid photo or PDF' });

/** Magic-byte check so a renamed HTML/script file cannot be stored as "evidence". */
function hasSignature(mime: string, dataUrl: string): boolean {
  let head: string;
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 24);
    head = atob(b64);
  } catch {
    return false;
  }
  const bytes = Array.from(head, (c) => c.charCodeAt(0));
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (mime === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
  if (mime === 'image/webp') return head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  if (mime === 'application/pdf') return head.slice(0, 5) === '%PDF-';
  return false;
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(page, pages);
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), total, page: p, pages, pageSize };
}
