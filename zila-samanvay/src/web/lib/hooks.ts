import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ProcInput, ProcName, ProcOutput } from '../../core/rpc';
import { rpc, RpcError } from './rpc';
import { useToast } from '../components/toast';

/** Read a procedure with caching, de-duplication and stale-while-revalidate. */
export function useQ<N extends ProcName>(
  name: N,
  input?: ProcInput<N>,
  opts?: Omit<UseQueryOptions<ProcOutput<N>, RpcError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ProcOutput<N>, RpcError>({
    queryKey: [name, input ?? {}],
    queryFn: () => rpc(name, input),
    placeholderData: keepPreviousData,
    ...opts,
  });
}

/**
 * Run a mutation. On success every cached query is invalidated, because one action
 * (say, forwarding a file) changes the dashboard, the agenda and the officer desk at once.
 */
export function useM<N extends ProcName>(name: N, opts?: { success?: string | ((out: ProcOutput<N>) => string); onSuccess?: (out: ProcOutput<N>) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<ProcOutput<N>, RpcError, ProcInput<N>>({
    mutationFn: (input) => rpc(name, input),
    onSuccess: (out) => {
      void qc.invalidateQueries();
      const msg = typeof opts?.success === 'function' ? opts.success(out) : opts?.success;
      if (msg) toast.show(msg, 'ok');
      opts?.onSuccess?.(out);
    },
    onError: (e) => toast.show(e.message, 'bad'),
  });
}

export function useMe() {
  return useQ('session.me', {}, { staleTime: 60_000, retry: false });
}

export function useLookups() {
  return useQ('ref.lookups', {}, { staleTime: 10 * 60_000 });
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
