"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; message: string; tone: "success" | "error"; action?: ToastAction };
type Notify = (message: string, tone?: Toast["tone"], action?: ToastAction) => void;

/**
 * El default NO es un no-op silencioso.
 *
 * Lo era, y al fusionar el rediseño de upstream el layout dejó de montar el
 * proveedor: cada aviso de la app se perdía sin un solo error, en pantallas
 * que "funcionaban". Una fachada que se traga los avisos es peor que una que
 * revienta, así que al menos lo dice en la consola de desarrollo.
 */
const ToastContext = createContext<Notify>((message) => {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[toast] aviso perdido ("${message}"): falta <ToastProvider> encima de este árbol`
    );
  }
});

/** Un aviso con "Deshacer" espera a que lo lean, no se va solo a los 3.5s. */
const DURATION_MS = { normal: 3500, action: 6000 };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback<Notify>((message, tone = "success", action) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone, action }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      action ? DURATION_MS.action : DURATION_MS.normal
    );
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="fixed bottom-20 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 md:bottom-4" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="flex items-start gap-2 rounded-md border bg-card px-3 py-2.5 text-sm shadow-pop">
            {toast.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="min-h-11 shrink-0 font-semibold text-brand-text underline sm:min-h-0"
                onClick={() => {
                  toast.action?.onClick();
                  setToasts((current) => current.filter((t) => t.id !== toast.id));
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
