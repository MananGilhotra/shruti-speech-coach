import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getHealth, getVersion } from '../api';
import type { VersionInfo } from '../types';

export type ApiStatus = 'checking' | 'online' | 'offline';

interface AppState {
  status: ApiStatus;
  online: boolean;
  version: VersionInfo | null;
  recheck: () => void;
}

const Ctx = createContext<AppState>({ status: 'checking', online: false, version: null, recheck: () => {} });

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ApiStatus>('checking');
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const seq = useRef(0);

  const check = useCallback(() => {
    const id = ++seq.current;
    getHealth()
      .then(() => {
        if (id !== seq.current) return;
        setStatus('online');
        getVersion()
          .then((v) => id === seq.current && setVersion(v))
          .catch(() => undefined);
      })
      .catch(() => id === seq.current && setStatus('offline'));
  }, []);

  useEffect(() => {
    check();
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  const value = useMemo(
    () => ({ status, online: status === 'online', version, recheck: check }),
    [status, version, check],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  return useContext(Ctx);
}

// ----------------------------------------------------------------------------- toasts
export type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t.filter((x) => x.text !== text), { id, kind, text }].slice(-4));
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-lg border bg-white px-3 py-2 text-sm shadow-sm ${
              t.kind === 'error'
                ? 'border-red-200 text-red-800'
                : t.kind === 'success'
                  ? 'border-emerald-200 text-emerald-800'
                  : 'border-line text-ink-soft'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
