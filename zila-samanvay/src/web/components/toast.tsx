import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'ok' | 'bad';
interface Toast {
  id: number;
  text: string;
  kind: Kind;
}

const Ctx = createContext<{ show: (text: string, kind?: Kind) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const show = useCallback((text: string, kind: Kind = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'bad' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-lg items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${t.kind === 'ok' ? 'border-ok/30 bg-white text-ink' : 'border-bad/40 bg-bad-soft text-bad'}`}
          >
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span className="flex-1">{t.text}</span>
            <button className="text-ink-3 hover:text-ink" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
