"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AdSpendEntryDto } from "@/lib/analytics";
import type { SourceValue } from "@/lib/types";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { defaultRange } from "./range-picker";

export const FUENTES: { value: SourceValue; label: string }[] = [
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
 * "field: mensaje; field2: mensaje2" (ver `parseBody` en `lib/api.ts`) → un
 * mapa por campo, para poder pintar cada error bajo SU input en vez de una
 * sola frase genérica arriba del formulario.
 */
function erroresPorCampo(detalle: string): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const parte of detalle.split(";")) {
    const [campo, ...resto] = parte.trim().split(":");
    if (campo && resto.length > 0) mapa[campo.trim()] = resto.join(":").trim();
  }
  return mapa;
}

const FORMATO_FECHA = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "2026-09-26" → "26 sept" — corto y en español, no el ISO crudo. `timeZone:
 * "UTC"` porque la fecha ya es de calendario (no un instante): parsearla con
 * la hora local restaría un día cerca de medianoche en husos negativos. */
function fechaCorta(iso: string): string {
  return FORMATO_FECHA.format(new Date(`${iso}T00:00:00Z`));
}

/**
 * Fork — "Cargar gasto". Por fuente y periodo, nunca por anuncio: el gasto de
 * Meta se factura por conjunto/campaña, y repartirlo entre creativos sería
 * inventar un número que nadie cargó (ver la nota en la sección).
 *
 * Es una pantalla de gestión, no un alta de una sola vez: se queda abierta
 * tras guardar para poder cargar varias fuentes del mismo periodo seguidas, y
 * la lista de abajo se puede editar (borrar) sin cerrarla.
 *
 * El ciclo de "borrado pendiente" (optimista + deshacer) vive en `AdsSection`,
 * no aquí: así sobrevive a que el dueño cierre y reabra este diálogo dentro
 * de la ventana de deshacer. Este componente solo pide el borrado.
 */
export function AdSpendDialog({
  entries,
  currency,
  today,
  onClose,
  onChanged,
  onDelete,
}: {
  entries: AdSpendEntryDto[];
  currency: string;
  /** Hoy en la zona del negocio (`YYYY-MM-DD`) — el rango por defecto usa
   * esta fecha, no la del reloj del navegador. */
  today: string;
  onClose: () => void;
  /** Tras crear una carga: el padre vuelve a pedir lista + resumen. */
  onChanged: () => void;
  onDelete: (entry: AdSpendEntryDto) => void;
}) {
  const [source, setSource] = useState<SourceValue>("anuncio");
  const [{ from, to }, setRango] = useState(() => defaultRange(today));
  const [monto, setMonto] = useState("");
  const [note, setNote] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "idle" });
  const [erroresServidor, setErroresServidor] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);

  // `showModal()` es lo que hace de esto un modal DE VERDAD: el navegador
  // mismo atrapa el foco adentro (Tab/Shift+Tab ya no se escapan al resto de
  // la página), pinta el `::backdrop` cubriendo el viewport completo (nada
  // de una franja sin atenuar arriba) y, al cerrar con Esc, devuelve el foco
  // solo al elemento que lo tenía antes de abrir — "Cargar gasto" en este
  // caso. Nada de esto se puede imitar bien con un `<div>` fijo + JS propio
  // (ver `activation-gate.tsx`, mismo patrón en este fork).
  useLayoutEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const parsedCents = monto.trim() ? parseMoneyToCents(monto) : null;
  const montoInvalidoLocal = monto.trim().length > 0 && (parsedCents === null || parsedCents < 0);
  const rangoInvalidoLocal = Boolean(from) && Boolean(to) && to < from;
  const montoError = montoInvalidoLocal
    ? "No reconozco ese monto. Escríbelo como 5000 o 5,000.00."
    : erroresServidor.amountCents;
  const rangoError = rangoInvalidoLocal
    ? "La fecha final va antes que la inicial."
    : erroresServidor.periodEnd ?? erroresServidor.periodStart;
  const listo =
    Boolean(from) &&
    Boolean(to) &&
    !rangoInvalidoLocal &&
    parsedCents !== null &&
    parsedCents >= 0 &&
    estado.tipo !== "guardando";

  async function guardar() {
    if (!listo || parsedCents === null) return;
    setEstado({ tipo: "guardando" });
    setErroresServidor({});
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
      const detalle = data?.error?.message ?? "";
      setErroresServidor(erroresPorCampo(detalle));
      setEstado({
        tipo: "error",
        mensaje: detalle || "No se pudo guardar la carga.",
      });
      return;
    }
    setMonto("");
    setNote("");
    setEstado({ tipo: "guardado" });
    onChanged();
    setTimeout(() => setEstado((e) => (e.tipo === "guardado" ? { tipo: "idle" } : e)), 2000);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Cargar gasto de anuncios"
      className="m-auto max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-card p-0 text-foreground shadow-pop backdrop:bg-black/35"
      onClose={onClose}
      onClick={(e) => {
        // Clic en el `::backdrop` (fuera del contenido): en un `<dialog>`
        // eso llega como un clic sobre el propio elemento, nunca sobre un
        // hijo — por eso comparar el target alcanza sin más manejo.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void guardar();
        }}
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
                aria-invalid={!!montoError}
                aria-describedby={montoError ? "as-monto-error" : undefined}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="5,000.00"
                className="h-11 sm:h-9"
              />
              {montoError && (
                <p id="as-monto-error" role="alert" className="text-xs text-danger-text">
                  {montoError}
                </p>
              )}
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
                onChange={(e) => setRango((r) => ({ ...r, from: e.target.value }))}
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
                aria-invalid={!!rangoError}
                aria-describedby={rangoError ? "as-to-error" : undefined}
                onChange={(e) => setRango((r) => ({ ...r, to: e.target.value }))}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground sm:h-9"
              />
              {rangoError && (
                <p id="as-to-error" role="alert" className="text-xs text-danger-text">
                  {rangoError}
                </p>
              )}
            </div>
          </div>

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
          <Button
            type="button"
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={() => dialogRef.current?.close()}
          >
            Cerrar
          </Button>
          <Button type="submit" className="h-11 sm:h-9" disabled={!listo}>
            {estado.tipo === "guardando" ? "Guardando…" : "Guardar carga"}
          </Button>
        </div>

        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium text-text-2">Cargas registradas</p>
          {entries.length === 0 ? (
            <p className="mt-2 text-xs text-text-3">Todavía no hay ninguna.</p>
          ) : (
            <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
              {entries.map((e) => (
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
                      {fechaCorta(e.periodStart)} a {fechaCorta(e.periodEnd)}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Borrar carga de ${FUENTES.find((f) => f.value === e.source)?.label ?? e.source}, ${e.periodStart} a ${e.periodEnd}`}
                    className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
                    onClick={() => onDelete(e)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </dialog>
  );
}
