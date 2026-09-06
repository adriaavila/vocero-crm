"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Toast = { id: number; message: string; tone: "success" | "error" };
/**
 * El default NO es un no-op silencioso.
 *
 * Lo era, y al fusionar el rediseño de upstream el layout dejó de montar el
 * proveedor: cada aviso de la app se perdía sin un solo error, en pantallas
 * que "funcionaban". Una fachada que se traga los avisos es peor que una que
 * revienta, así que al menos lo dice en la consola de desarrollo.
 */
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(
  (message) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[toast] aviso perdido ("${message}"): falta <ToastProvider> encima de este árbol`
      );
    }
  }
);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
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
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
