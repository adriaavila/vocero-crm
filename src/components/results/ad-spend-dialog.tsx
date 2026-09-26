"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AdSpendEntryDto } from "@/lib/analytics";
import type { SourceValue } from "@/lib/types";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast-provider";

/** Ventana para deshacer un borrado antes de que sea de verdad al servidor. */
const UNDO_MS = 5000;

/** Hoy - 29 días, para que el diálogo abra con el mismo rango que Resultados
 * suele mirar por default — casi siempre es lo que el dueño quiere cargar. */
function rangoPorDefecto(): { from: string; to: string } {
  const hoy = new Date();
  const hace30 = new Date(hoy.getTime() - 29 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(hace30), to: iso(hoy) };
}

const FUENTES: { value: SourceValue; label: string }[] = [
  { value: "anuncio", label: "Anuncio" },
  { value: "organico", label: "Contenido orgánico" },
  { value: "referido", label: "Referido" },
  { value: "conocido", label: "Conocido" },
  { value: "otro", label: "Otro" },
];

type Estado =
  | { tipo: "idle" }
  | { tipo: "guardando" }
  | { tipo: "guardado" }
  | { tipo: "error"; mensaje: string };

/**
 * Fork — "Cargar gasto". Por fuente y periodo, nunca por anuncio: el gasto de
 * Meta se factura por conjunto/campaña, y repartirlo entre creativos sería
 * inventar un número que nadie cargó (ver la nota en la sección).
 *
 * Es una pantalla de gestión, no un alta de una sola vez: se queda abierta
 * tras guardar para poder cargar varias fuentes del mismo periodo seguidas, y
 * la lista de abajo se puede editar (borrar) sin cerrarla.
 */
export function AdSpendDialog({
  entries,
  currency,
  onClose,
  onChanged,
}: {
  entries: AdSpendEntryDto[];
  currency: string;
  onClose: () => void;
  /** Tras crear o borrar una carga: el padre vuelve a pedir lista + resumen. */
  onChanged: () => void;
}) {
  const [source, setSource] = useState<SourceValue>("anuncio");
  const [from, setFrom] = useState(() => rangoPorDefecto().from);
  const [to, setTo] = useState(() => rangoPorDefecto().to);
  const [monto, setMonto] = useState("");
  const [note, setNote] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "idle" });
  const [pendientesDeBorrar, setPendientesDeBorrar] = useState<Set<string>>(new Set());
  // `setTimeout` no depende de que el componente siga montado: si el dueño
  // cierra el diálogo dentro de la ventana de "Deshacer", el borrado real
  // igual se hace más tarde — nunca se pierde, solo ya sin el toast a la
  // vista. Por eso este ref NO se limpia en un cleanup de useEffect.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const notify = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsedCents = monto.trim() ? parseMoneyToCents(monto) : null;
  const montoInvalido = monto.trim().length > 0 && (parsedCents === null || parsedCents < 0);
  const rangoInvalido = Boolean(from) && Boolean(to) && to < from;
  const listo =
    Boolean(from) &&
    Boolean(to) &&
    !rangoInvalido &&
    parsedCents !== null &&
    parsedCents >= 0 &&
    estado.tipo !== "guardando";

  async function guardar() {
    if (!listo || parsedCents === null) return;
    setEstado({ tipo: "guardando" });
    const res = await fetch("/api/analytics/spend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        periodStart: from,
        periodEnd: to,
        amountCents: parsedCents,
        note: note.trim() || undefined,
      }),
    }).catch(() => null);

    if (!res) {
      setEstado({ tipo: "error", mensaje: "No se pudo guardar. Revisa tu conexión." });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      setEstado({
        tipo: "error",
        mensaje: data?.error?.message ?? "No se pudo guardar la carga.",
      });
      return;
    }
    setMonto("");
    setNote("");
    setEstado({ tipo: "guardado" });
    onChanged();
    setTimeout(() => setEstado((e) => (e.tipo === "guardado" ? { tipo: "idle" } : e)), 2000);
  }

  /**
   * Borrado optimista: desaparece de la lista AHORA (se siente instantáneo),
   * pero el DELETE de verdad espera `UNDO_MS` — tiempo para arrepentirse
   * antes de que sea definitivo. "Deshacer" solo cancela ese timer local; no
   * hay que deshacer nada en el servidor porque nunca se le pidió el borrado.
   */
  function borrar(entrada: AdSpendEntryDto) {
    setPendientesDeBorrar((prev) => new Set(prev).add(entrada.id));
    const timer = setTimeout(async () => {
      timers.current.delete(entrada.id);
      const res = await fetch(`/api/analytics/spend?id=${encodeURIComponent(entrada.id)}`, {
        method: "DELETE",
      }).catch(() => null);
      if (!res?.ok) {
        // No se pudo: se devuelve a la lista en vez de dejarla desaparecida
        // sin haberse borrado en verdad.
        setPendientesDeBorrar((prev) => {
          const next = new Set(prev);
          next.delete(entrada.id);
          return next;
        });
        notify("No se pudo borrar esa carga.", "error");
        return;
      }
      onChanged();
    }, UNDO_MS);
    timers.current.set(entrada.id, timer);

    const etiqueta = FUENTES.find((f) => f.value === entrada.source)?.label ?? entrada.source;
    notify(`Carga de ${etiqueta} borrada.`, "success", {
      label: "Deshacer",
      onClick: () => {
        const t = timers.current.get(entrada.id);
        if (t) {
          clearTimeout(t);
          timers.current.delete(entrada.id);
        }
        setPendientesDeBorrar((prev) => {
          const next = new Set(prev);
          next.delete(entrada.id);
          return next;
        });
      },
    });
  }

  const visibles = entries.filter((e) => !pendientesDeBorrar.has(e.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cargar gasto de anuncios"
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">Cargar gasto</h3>
        <p className="mt-0.5 text-xs text-text-3">
          Por fuente y periodo, en {currency}. El costo y el retorno se calculan sobre
          esto, nunca por anuncio individual.
        </p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="as-source">
                Fuente
              </label>
              <select
                id="as-source"
                value={source}
                onChange={(e) => setSource(e.target.value as SourceValue)}
                className="h-11 w-full rounded-md border border-input bg-card px-2 text-sm sm:h-9"
                autoFocus
              >
                {FUENTES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="as-monto">
                Monto ({currency})
              </label>
              <Input
                id="as-monto"
                value={monto}
                inputMode="decimal"
                onChange={(e) => setMonto(e.target.value)}
                placeholder="5,000.00"
                className="h-11 sm:h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="as-from">
                Desde
              </label>
              <input
                id="as-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="as-to">
                Hasta
              </label>
              <input
                id="as-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground sm:h-9"
              />
            </div>
          </div>
          {rangoInvalido && (
            <p role="alert" className="text-xs text-danger-text">
              La fecha final va antes que la inicial.
            </p>
          )}
          {montoInvalido && (
            <p role="alert" className="text-xs text-danger-text">
              No reconozco ese monto. Escríbelo como 5000 o 5,000.00.
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="as-note">
              Nota (opcional)
            </label>
            <Textarea
              id="as-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Campaña de lanzamiento, presupuesto de la agencia…"
            />
          </div>
        </div>

        {estado.tipo === "error" && (
          <p role="alert" aria-live="assertive" className="mt-3 text-xs text-danger-text">
            {estado.mensaje}
          </p>
        )}
        {estado.tipo === "guardado" && (
          <p role="status" aria-live="polite" className="mt-3 text-xs text-success-text">
            Carga guardada.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" className="h-11 sm:h-9" onClick={onClose}>
            Cerrar
          </Button>
          <Button className="h-11 sm:h-9" disabled={!listo} onClick={() => void guardar()}>
            {estado.tipo === "guardando" ? "Guardando…" : "Guardar carga"}
          </Button>
        </div>

        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium text-text-2">Cargas registradas</p>
          {visibles.length === 0 ? (
            <p className="mt-2 text-xs text-text-3">Todavía no hay ninguna.</p>
          ) : (
            <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
              {visibles.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {FUENTES.find((f) => f.value === e.source)?.label ?? e.source} ·{" "}
                      {formatMoneyCents(e.amountCents, e.currency)}
                    </p>
                    <p className="truncate text-text-3">
                      {e.periodStart} a {e.periodEnd}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Borrar carga de ${FUENTES.find((f) => f.value === e.source)?.label ?? e.source}, ${e.periodStart} a ${e.periodEnd}`}
                    className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
                    onClick={() => borrar(e)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
