"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Cifra } from "@/components/agencia/allok/cifra";
import { fmtNumber } from "@/lib/centro";
import { plata, totalCents, valorCitasCents, type LoQueTrajo } from "@/lib/lo-que-trajo";
import { parseMoneyToCents } from "@/lib/money";

/**
 * Inicio · «Lo que te trajo tu agente»: lo primero de «Cómo va», en plata.
 *
 * Un dueño no paga por mensajes contestados: paga por citas y ventas. Si dijo
 * cuánto le deja una cita, las del agente se cuentan en plata y se les suman
 * las ventas cerradas. Si no lo dijo, se cuentan las citas y se le pregunta
 * ahí mismo, con un número: nada se estima sin un dato suyo.
 */
export function LoQueTrajoTile({ trajo, periodLabel, owner }: { trajo: LoQueTrajo; periodLabel: string; owner: boolean }) {
  const [editing, setEditing] = useState(false);
  const total = totalCents(trajo);
  const citasValor = valorCitasCents(trajo);
  const sinValor = trajo.agenda && !trajo.valorCitaCents;

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-background px-5 py-5 lg:col-span-2" aria-labelledby="trajo-titulo">
      <h3 id="trajo-titulo" className="kicker">
        Lo que te trajo tu agente
      </h3>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          {total > 0 ? (
            <p className="flex items-baseline gap-2 text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              <Cifra value={plata(total, trajo.currency)} />
              <span className="text-[14px] font-medium tracking-normal text-text-3">{periodLabel}</span>
            </p>
          ) : trajo.citas > 0 ? (
            <p className="flex items-baseline gap-2 text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              <Cifra value={fmtNumber(trajo.citas)} />
              <span className="text-[14px] font-medium tracking-normal text-text-3">
                {trajo.citas === 1 ? "cita agendada" : "citas agendadas"} {periodLabel}
              </span>
            </p>
          ) : (
            <p className="text-[14px] leading-relaxed text-text-2">
              Tu agente todavía no agenda citas ni hay ventas cerradas {periodLabel}.
              {trajo.valorCitaCents ? ` Cada cita te deja unos ${plata(trajo.valorCitaCents, trajo.currency)}.` : ""}
            </p>
          )}
          <ul className="mt-3 space-y-1 font-mono text-[12.5px] tabular-nums text-text-2">
            {trajo.agenda && trajo.citas > 0 && citasValor !== null && (
              <li>
                {fmtNumber(trajo.citas)} {trajo.citas === 1 ? "cita" : "citas"} × {plata(trajo.valorCitaCents!, trajo.currency)} ={" "}
                {plata(citasValor, trajo.currency)}
              </li>
            )}
            {trajo.ventas.count > 0 && (
              <li>
                {fmtNumber(trajo.ventas.count)} {trajo.ventas.count === 1 ? "venta cerrada" : "ventas cerradas"}
                {trajo.ventas.cents > 0 ? ` = ${plata(trajo.ventas.cents, trajo.currency)}` : " (sin monto capturado)"}
              </li>
            )}
          </ul>
        </div>
        {owner && trajo.agenda && (sinValor || editing) ? (
          <ValorCitaForm
            initial={trajo.valorCitaCents}
            currency={trajo.currency}
            onDone={() => setEditing(false)}
            onCancel={sinValor ? undefined : () => setEditing(false)}
          />
        ) : owner && trajo.agenda && trajo.valorCitaCents ? (
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-[12.5px] font-medium text-text-2 underline-offset-4 hover:text-foreground hover:underline [@media(pointer:fine)]:min-h-0"
            onClick={() => setEditing(true)}
          >
            Una cita te deja {plata(trajo.valorCitaCents, trajo.currency)} · Cambiar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ValorCitaForm({
  initial,
  currency,
  onDone,
  onCancel,
}: {
  initial: number | null;
  currency: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial ? String(Math.round(initial / 100)) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseMoneyToCents(value);
    if (!cents || cents <= 0) {
      setError("Escribe cuánto te deja una cita, por ejemplo 500.");
      return;
    }
    setSaving(true);
    setError(null);
    const response = await fetch("/api/agent/valor-cita", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valorCitaCents: cents }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError("No se pudo guardar. Prueba de nuevo.");
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void save(event)} className="w-full max-w-sm space-y-2">
      <label htmlFor="valor-cita" className="block text-[13px] font-medium">
        ¿Cuánto te deja una cita, en promedio?
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-[12px] text-text-3">
            {currency}
          </span>
          <input
            id="valor-cita"
            inputMode="decimal"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-background pl-12 pr-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="500"
            value={value}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "valor-cita-error" : "valor-cita-hint"}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-11 items-center gap-2 rounded-[var(--btn-radius,10px)] bg-foreground px-4 text-sm font-semibold text-background transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          Guardar
        </button>
        {onCancel && (
          <button type="button" className="h-11 px-2 text-sm text-text-2 hover:text-foreground" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        )}
      </div>
      {error ? (
        <p id="valor-cita-error" role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      ) : (
        <p id="valor-cita-hint" className="text-[12.5px] text-text-3">
          Con esto te decimos en plata lo que agenda tu agente, aquí y en el resumen de las 19:00.
        </p>
      )}
    </form>
  );
}
