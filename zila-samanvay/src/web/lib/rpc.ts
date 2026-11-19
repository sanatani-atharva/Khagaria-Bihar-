// Typed client for the core procedures. In the server build it calls the Express API; in the
// zero-install single-file build it runs the very same procedures in the browser (sql.js).

import type { ProcInput, ProcName, ProcOutput } from '../../core/rpc';

declare const __STANDALONE__: boolean;
export const STANDALONE = __STANDALONE__;

export class RpcError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zs-client': '1' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(25_000),
  }).catch((e: Error) => {
    throw new RpcError(0, e.name === 'TimeoutError' ? 'The server took too long to respond. Try again.' : 'Cannot reach the server. Check your connection.');
  });
  const data = (await res.json().catch(() => ({}))) as { data?: unknown; error?: string };
  if (!res.ok) throw new RpcError(res.status, data.error ?? res.statusText);
  return data;
}

export async function rpc<N extends ProcName>(name: N, input?: ProcInput<N>): Promise<ProcOutput<N>> {
  if (STANDALONE) {
    const m = await import('./standalone');
    return m.call(name, input) as Promise<ProcOutput<N>>;
  }
  const res = await post(`/api/rpc/${name}`, input);
  return res.data as ProcOutput<N>;
}

export async function login(userId: number): Promise<void> {
  if (STANDALONE) {
    const m = await import('./standalone');
    return m.login(userId);
  }
  await post('/api/login', { userId });
}

export async function logout(): Promise<void> {
  if (STANDALONE) {
    const m = await import('./standalone');
    return m.logout();
  }
  await post('/api/logout', {});
}
