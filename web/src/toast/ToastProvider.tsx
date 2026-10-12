import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

/**
 * The app's one success surface: a mutation that worked says so.
 *
 * It is a context rather than a `useState` per panel because there is exactly
 * one surface for the whole app — a file operation in the drawer, a download and
 * a drag-move all report through `useToast()` — and because one message at a
 * time means they cannot each own one. Like the prototype's (`common.js:666-672`)
 * it replaces whatever is showing and clears itself after about two seconds.
 *
 * The surface is rendered *beside* the workspace, not inside it: the drawer is a
 * 42vh strip with its own scrollers, and anything mounted within it would be
 * clipped by them. `fixed` at the foot of the viewport keeps the message over
 * the drawer rather than under it.
 */

/** How long a message stays up (the prototype's 2200ms). */
const TOAST_MS = 2200;

/** Say that something took effect. The newest message wins. */
export type Toast = (message: string) => void;

const ToastContext = createContext<Toast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const toast = useCallback<Toast>((next) => {
    setMessage(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMessage(null);
    }, TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastSurface message={message} />
    </ToastContext.Provider>
  );
}

/**
 * The surface. It is a live region and it is never unmounted — only emptied —
 * so a screen reader is watching it before the message arrives; `role="status"`
 * is the polite half of that contract.
 */
function ToastSurface({ message }: { message: string | null }): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-ok/40 bg-panel px-3 py-1 font-mono text-[11px] text-ok shadow-lg transition-opacity duration-150 ${
        message === null ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {message}
    </div>
  );
}

/**
 * The seam later tickets report through. Using it outside a provider is a
 * wiring bug, not a state to render around, so it says so rather than dropping
 * the message silently.
 */
export function useToast(): Toast {
  const toast = useContext(ToastContext);
  if (toast === null) throw new Error('useToast needs a ToastProvider above it (the workspace mounts one).');
  return toast;
}
