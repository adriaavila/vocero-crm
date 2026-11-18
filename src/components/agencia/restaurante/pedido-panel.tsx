"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PASO_LABEL,
  precio,
  siguientePaso,
  type EstadoPedido,
  type LineaPedida,
  type Modalidad,
} from "@/lib/restaurante/pedido";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aCentavos, deCentavos, llamar, restauranteApagado, type PedidoVista } from "./api";
import { EstadoPill, PruebaTag } from "./estado-pill";
import { PedidoEditor } from "./pedido-editor";

/**
 * Fork — vertical restaurante: el pedido DENTRO de la conversación.
 *
 * El agente lo arma y lo deja «por confirmar»; aquí una persona lo revisa,
 * pone el envío y lo pasa a cocina. Cada paso le escribe al cliente lo que
 * corresponde, con el total real. En un negocio sin el vertical no pinta nada.
 */
export function PedidoPanel({
  conversationId,
  contactName,
  refreshKey = 0,
}: {
  conversationId: string;
  contactName: string;
  refreshKey?: number;
}) {
  const [pedidos, setPedidos] = useState<PedidoVista[] | null>(null);
  const [editando, setEditando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinAviso, setSinAviso] = useState(false);

  const cargar = useCallback(async () => {
    const r = await llamar<{ pedidos: PedidoVista[] }>(
      `/api/restaurante/pedidos?conversationId=${encodeURIComponent(conversationId)}`
    );
    setPedidos(r.ok ? r.data.pedidos : null);
  }, [conversationId]);

  useEffect(() => {
    setPedidos(null);
    setEditando(false);
    setCancelando(false);
    setError(null);
    setSinAviso(false);
  }, [conversationId]);

  useEffect(() => {
    void cargar();
  }, [cargar, refreshKey]);

  if (restauranteApagado() || pedidos === null) return null;

  const pedido = pedidos[0] ?? null;
  const reemplazar = (p: PedidoVista) => setPedidos((ps) => [p, ...(ps ?? []).filter((x) => x.id !== p.id)]);

  async function accion<T extends { pedido: PedidoVista }>(
    url: string,
    method: string,
    body: unknown
  ): Promise<T | null> {
    setOcupado(true);
    setError(null);
    const r = await llamar<T>(url, { method, body });
    setOcupado(false);
    if (!r.ok) {
      setError(r.message);
      void cargar();
      return null;
    }
    reemplazar(r.data.pedido);
    return r.data;
  }

  const editar = (cambio: Record<string, unknown>) =>
    pedido ? accion(`/api/restaurante/pedidos/${pedido.id}`, "PATCH", cambio) : Promise.resolve(null);

  async function mover(hacia: EstadoPedido) {
    if (!pedido) return;
    const r = await accion<{ pedido: PedidoVista; avisado: boolean | null }>(
      `/api/restaurante/pedidos/${pedido.id}/estado`,
      "POST",
      { hacia }
    );
    setCancelando(false);
    if (r) setSinAviso(r.avisado === false);
  }

  async function guardarLineas(lineas: LineaPedida[]) {
    const abierto = pedido?.status === "por_confirmar" ? pedido : null;
    const r = abierto
      ? await editar({ lineas })
      : await accion("/api/restaurante/pedidos", "POST", { conversationId, lineas });
    if (r) setEditando(false);
  }

  const cabecera = (
    <h4 className="kicker text-text-2">Pedido</h4>
  );

  const abierto = pedido && pedido.status !== "entregado" && pedido.status !== "cancelado";

  if (editando) {
    return (
      <section className="border-b p-4" aria-label="Pedido">
        {cabecera}
        <div className="mt-3">
          <PedidoEditor
            inicial={
              pedido?.status === "por_confirmar"
                ? pedido.items.map((i) => ({
                    name: i.name,
                    quantity: i.quantity,
                    extras: i.extras.map((e) => e.name),
                    ...(i.note ? { note: i.note } : {}),
                  }))
                : []
            }
            guardando={ocupado}
            error={error}
            onGuardar={(l) => void guardarLineas(l)}
            onCancelar={() => {
              setEditando(false);
              setError(null);
            }}
          />
        </div>
      </section>
    );
  }

  if (!pedido || !abierto) {
    return (
      <section className="border-b p-4" aria-label="Pedido">
        {cabecera}
        {pedido && (
          <div className="mt-3 flex items-center justify-between gap-2 text-[13px]">
            <span className="text-text-2">
              #{pedido.number} · {precio(pedido.totalCents, pedido.currency)}
            </span>
            <EstadoPill estado={pedido.status} />
          </div>
        )}
        <Button size="sm" variant="outline" className="mt-3 w-full max-sm:h-11" onClick={() => setEditando(true)}>
          {pedido ? "Armar otro pedido" : "Armar un pedido"}
        </Button>
      </section>
    );
  }

  const porConfirmar = pedido.status === "por_confirmar";
  const paso = siguientePaso(pedido.status, pedido.mode ?? "retiro");
  const c = (cents: number) => precio(cents, pedido.currency);

  return (
    <section className="border-b p-4" aria-label={`Pedido ${pedido.number}`} data-pedido={pedido.status}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <h4 className="kicker text-text-2">Pedido #{pedido.number}</h4>
          {pedido.isTest && <PruebaTag />}
        </span>
        <EstadoPill estado={pedido.status} />
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.035em]" data-pedido-total>
        {c(pedido.totalCents)}
      </p>
      <p className="mt-1 text-[12px] text-text-3">
        {pedido.createdBy === "agente" ? "Lo armó tu agente con los precios de tu menú." : "Lo armó tu equipo."}
      </p>

      <ul className="mt-3 divide-y border-y text-[13px]">
        {pedido.items.map((i) => (
          <li key={i.id} className="flex gap-2.5 py-2">
            <span className="w-4 shrink-0 font-mono text-text-3">{i.quantity}</span>
            <span className="min-w-0 flex-1">
              {i.name}
              {(i.extras.length > 0 || i.note) && (
                <span className="block text-[12px] text-text-3">
                  {[...i.extras.map((e) => e.name), ...(i.note ? [i.note] : [])].join(" · ")}
                </span>
              )}
            </span>
            <span className="shrink-0 font-mono">{c(i.lineTotalCents)}</span>
          </li>
        ))}
        {pedido.mode === "envio" && (
          <li className="flex items-center gap-2.5 py-2">
            <span className="w-4 shrink-0" />
            <span className="min-w-0 flex-1 text-text-2">
              Envío
              {pedido.address && <span className="block text-[12px] text-text-3">{pedido.address}</span>}
            </span>
            {porConfirmar ? (
              <CampoMonto
                key={`${pedido.id}-${pedido.deliveryFeeCents}`}
                etiqueta="Costo del envío"
                valor={pedido.deliveryFeeCents}
                disabled={ocupado}
                onGuardar={(cents) => void editar({ deliveryFeeCents: cents })}
              />
            ) : (
              <span className="shrink-0 font-mono">{c(pedido.deliveryFeeCents)}</span>
            )}
          </li>
        )}
      </ul>

      {porConfirmar && (
        <div className="mt-3 flex flex-col gap-2">
          <div role="group" aria-label="Cómo lo recibe" className="grid grid-cols-2 gap-1 rounded-md border p-1">
            {(["envio", "retiro"] as Modalidad[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={pedido.mode === m}
                disabled={ocupado}
                onClick={() => void editar({ mode: m })}
                className={cn(
                  "h-8 rounded text-[13px] font-medium max-sm:h-10",
                  pedido.mode === m ? "bg-foreground text-background" : "text-text-2 hover:bg-accent"
                )}
              >
                {m === "envio" ? "Envío" : "Retiro"}
              </button>
            ))}
          </div>
          {pedido.mode === "envio" && (
            <Input
              key={`${pedido.id}-${pedido.address ?? ""}`}
              aria-label="Dirección del envío"
              placeholder="Dirección del envío"
              defaultValue={pedido.address ?? ""}
              className="max-sm:h-11"
              onBlur={(e) => {
                if (e.target.value.trim() !== (pedido.address ?? "")) void editar({ address: e.target.value });
              }}
            />
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-[12px]">
        {pedido.paymentStatus === "cobrado" ? (
          <>
            <span data-state="activo" className="inline-flex items-center gap-1.5 text-[var(--st-ink,var(--text-2))]">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--st,var(--success))]" />
              Cobrado{pedido.paymentMethod === "qr" ? " con QR" : pedido.paymentMethod === "efectivo" ? " en efectivo" : ""}
            </span>
            <button
              type="button"
              className="text-text-3 underline-offset-2 hover:underline"
              disabled={ocupado}
              onClick={() => void accion(`/api/restaurante/pedidos/${pedido.id}/pago`, "POST", { status: "pendiente" })}
            >
              Deshacer
            </button>
          </>
        ) : (
          <>
            <span className="text-text-3">Pago pendiente</span>
            <span className="flex gap-1.5">
              {(["qr", "efectivo"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={ocupado}
                  onClick={() =>
                    void accion(`/api/restaurante/pedidos/${pedido.id}/pago`, "POST", { status: "cobrado", method: m })
                  }
                  className="rounded-full border px-2.5 py-1 text-text-2 hover:border-border-strong max-sm:min-h-9"
                >
                  {m === "qr" ? "Cobré por QR" : "Cobré en efectivo"}
                </button>
              ))}
            </span>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-text">
          {error}
        </p>
      )}
      {sinAviso && (
        <p role="status" className="mt-3 rounded-md border border-warning-soft bg-warning-tint p-2.5 text-[12px] text-warning-text">
          El pedido cambió, pero no se le pudo avisar a {contactName} por WhatsApp. Escríbele tú.
        </p>
      )}

      {cancelando ? (
        <div className="mt-3 rounded-md border p-3">
          <p className="text-[13px]">¿Cancelar el pedido #{pedido.number}? Le avisamos a {contactName}.</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1 max-sm:h-11"
              disabled={ocupado}
              onClick={() => void mover("cancelado")}
            >
              Sí, cancelar
            </Button>
            <Button size="sm" variant="outline" className="max-sm:h-11" onClick={() => setCancelando(false)}>
              Volver
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {paso && paso !== "por_confirmar" && paso !== "cancelado" && (
            <Button
              className="h-11 w-full"
              disabled={ocupado || (porConfirmar && !pedido.mode)}
              onClick={() => void mover(paso)}
            >
              {PASO_LABEL[paso]}
            </Button>
          )}
          {porConfirmar && !pedido.mode && (
            <p className="text-center text-[12px] text-text-3">Elige si es envío o retiro para confirmar.</p>
          )}
          <div className="flex gap-2">
            {porConfirmar && (
              <Button size="sm" variant="outline" className="flex-1 max-sm:h-11" onClick={() => setEditando(true)}>
                Editar
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="flex-1 max-sm:h-11"
              onClick={() => setCancelando(true)}
            >
              {porConfirmar ? "No se puede hoy" : "Cancelar pedido"}
            </Button>
          </div>
          {porConfirmar && (
            <p className="text-center text-[12px] text-text-3">
              Al confirmar, le escribimos a {contactName} el total.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CampoMonto({
  etiqueta,
  valor,
  disabled,
  onGuardar,
}: {
  etiqueta: string;
  valor: number;
  disabled: boolean;
  onGuardar: (cents: number) => void;
}) {
  const [texto, setTexto] = useState(valor > 0 ? deCentavos(valor) : "");
  const guardar = () => {
    const cents = texto.trim() === "" ? 0 : aCentavos(texto);
    if (cents === null) return setTexto(valor > 0 ? deCentavos(valor) : "");
    if (cents !== valor) onGuardar(cents);
  };
  return (
    <Input
      aria-label={etiqueta}
      inputMode="decimal"
      placeholder="0"
      value={texto}
      disabled={disabled}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-20 shrink-0 text-right font-mono max-sm:h-11"
    />
  );
}
