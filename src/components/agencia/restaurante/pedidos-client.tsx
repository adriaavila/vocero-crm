"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ESTADO_LABEL,
  ESTADO_TONO,
  PASO_LABEL,
  lineaTexto,
  precio,
  siguientePaso,
  type EstadoPedido,
} from "@/lib/restaurante/pedido";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/components/use-events";
import { hace, llamar, type PedidoVista } from "./api";
import { PruebaTag } from "./estado-pill";
import { PedidoPanel } from "./pedido-panel";

const COLUMNAS: EstadoPedido[] = ["por_confirmar", "en_cocina", "listo", "en_camino", "entregado"];

/**
 * Fork — vertical restaurante: los pedidos en curso, por estado. En el
 * celular son grupos apilados; en escritorio, columnas. Un pedido por
 * confirmar se revisa en su conversación; los demás avanzan con un toque.
 */
export function PedidosClient() {
  const [pedidos, setPedidos] = useState<PedidoVista[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [, setTic] = useState(0);
  // El pedido que se está revisando: su hoja entra por abajo (celular) o por la derecha.
  const [revisando, setRevisando] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  const cargar = useCallback(async () => {
    const r = await llamar<{ pedidos: PedidoVista[] }>("/api/restaurante/pedidos");
    if (r.ok) {
      setPedidos(r.data.pedidos);
      setRev((n) => n + 1);
      setFallo(null);
    } else {
      setFallo(r.message);
    }
  }, []);

  useEffect(() => {
    void cargar();
    // El «hace 2 min» envejece solo, y si el aviso en vivo se pierde, esto lo alcanza.
    const t = setInterval(() => {
      setTic((n) => n + 1);
      void cargar();
    }, 30_000);
    return () => clearInterval(t);
  }, [cargar]);

  useEvents({ onConversationUpdated: () => void cargar(), onReconnect: () => void cargar() });

  async function mover(p: PedidoVista, hacia: EstadoPedido) {
    setOcupado(p.id);
    const r = await llamar<{ pedido: PedidoVista; avisado: boolean | null }>(
      `/api/restaurante/pedidos/${p.id}/estado`,
      { method: "POST", body: { hacia } }
    );
    setOcupado(null);
    if (!r.ok) setFallo(r.message);
    else if (r.data.avisado === false) {
      setFallo(`El pedido #${p.number} avanzó, pero no se le pudo avisar al cliente por WhatsApp.`);
    } else setFallo(null);
    void cargar();
  }

  const abiertos = (pedidos ?? []).filter((p) => p.status !== "entregado" && p.status !== "cancelado");
  const porConfirmar = abiertos.filter((p) => p.status === "por_confirmar").length;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-4 sm:px-6">
        <h2 className="page-title font-semibold">
          {pedidos === null
            ? "Pedidos"
            : abiertos.length === 0
              ? "Sin pedidos en curso."
              : `${abiertos.length} ${abiertos.length === 1 ? "pedido" : "pedidos"} en curso.`}
        </h2>
        {porConfirmar > 0 && (
          <p data-state="atencion" className="mt-1 flex items-center gap-2 text-sm text-[var(--st-ink,var(--warning-text))]">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--st,var(--warning))]" />
            {porConfirmar === 1 ? "1 espera tu confirmación." : `${porConfirmar} esperan tu confirmación.`}
          </p>
        )}
        {fallo && (
          <p role="alert" className="mt-2 text-xs text-danger-text">
            {fallo}
          </p>
        )}
      </header>

      {pedidos !== null && pedidos.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-base font-medium">Todavía no hay pedidos.</p>
          <p className="max-w-sm text-sm text-text-3">
            Cuando un cliente pida por WhatsApp, tu agente lo arma con los precios de tu menú y aparece aquí
            para que lo confirmes.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/menu" className="text-sm font-medium underline underline-offset-4">
              Ver tu menú
            </Link>
            <Link href="/lab" className="text-sm font-medium underline underline-offset-4">
              Probarlo como cliente
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-5 lg:gap-3">
            {COLUMNAS.map((estado) => {
              const lista = (pedidos ?? []).filter((p) => p.status === estado);
              if (lista.length === 0 && estado !== "por_confirmar") {
                // En el celular un grupo vacío no ocupa lugar; en escritorio la columna se queda.
                return (
                  <section key={estado} className="hidden lg:block" aria-label={ESTADO_LABEL[estado]}>
                    <Titulo estado={estado} n={0} />
                  </section>
                );
              }
              return (
                <section key={estado} aria-label={ESTADO_LABEL[estado]} className="flex flex-col gap-2">
                  <Titulo estado={estado} n={lista.length} />
                  {lista.map((p) => (
                    <Tarjeta
                      key={p.id}
                      p={p}
                      ocupado={ocupado === p.id}
                      onMover={mover}
                      onRevisar={() => setRevisando(p.id)}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {(() => {
        const p = (pedidos ?? []).find((x) => x.id === revisando);
        if (!p?.conversationId) return null;
        return (
          <>
            <button
              aria-label="Cerrar el pedido"
              tabIndex={-1}
              onClick={() => setRevisando(null)}
              className="fixed inset-0 z-30 bg-overlay"
            />
            <div
              role="dialog"
              aria-label={`Pedido ${p.number}`}
              className="fixed inset-x-0 bottom-0 z-40 max-h-[88dvh] overflow-y-auto rounded-t-[18px] border-t bg-background shadow-pop sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[360px] sm:rounded-none sm:border-l sm:border-t-0"
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <b className="min-w-0 truncate text-[15px] font-semibold">{p.contactName ?? "Cliente"}</b>
                <span className="flex shrink-0 items-center gap-3">
                  <Link href={chatDe(p)} className="text-[13px] font-medium text-text-2 hover:text-foreground">
                    Ver chat
                  </Link>
                  <button
                    type="button"
                    onClick={() => setRevisando(null)}
                    className="min-h-11 text-[13px] font-medium text-text-2 hover:text-foreground sm:min-h-0"
                  >
                    Cerrar
                  </button>
                </span>
              </div>
              <PedidoPanel
                conversationId={p.conversationId}
                contactName={p.contactName ?? "tu cliente"}
                refreshKey={rev}
              />
            </div>
          </>
        );
      })()}
    </div>
  );
}

/** Un pedido de prueba vive en «Probar tu agente», no en la bandeja. */
function chatDe(p: PedidoVista): string {
  if (p.isTest) return "/lab";
  return p.contactId ? `/inbox?contact=${encodeURIComponent(p.contactId)}` : "/inbox";
}

function Titulo({ estado, n }: { estado: EstadoPedido; n: number }) {
  return (
    <h3 data-state={ESTADO_TONO[estado]} className="flex items-center gap-2 px-0.5 pb-1 text-[13px] font-semibold">
      <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--st,var(--text-3))]" />
      {estado === "entregado" ? "Entregados" : ESTADO_LABEL[estado]}
      <span className="font-mono text-[12px] font-normal text-text-3">{n}</span>
    </h3>
  );
}

function Tarjeta({
  p,
  ocupado,
  onMover,
  onRevisar,
}: {
  p: PedidoVista;
  ocupado: boolean;
  onMover: (p: PedidoVista, hacia: EstadoPedido) => void;
  onRevisar: () => void;
}) {
  const paso = siguientePaso(p.status, p.mode ?? "retiro");
  const conversacion = chatDe(p);
  const porConfirmar = p.status === "por_confirmar";
  return (
    <article
      data-state={porConfirmar ? "atencion" : undefined}
      data-pedido-numero={p.number}
      className={cn(
        "flex flex-col gap-2 rounded-[14px] border bg-background p-3.5",
        porConfirmar && "border-[var(--st,var(--warning))]"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <b className="min-w-0 truncate text-[15px] font-semibold">{p.contactName ?? "Cliente"}</b>
        <span className="shrink-0 font-mono text-[15px]">{precio(p.totalCents, p.currency)}</span>
      </div>
      <p className="text-[13px] leading-snug text-text-2">{p.items.map((i) => lineaTexto(i)).join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-text-3">
        <span className="rounded-full border px-2 py-0.5 text-text-2">
          {p.mode === "envio" ? "Envío" : p.mode === "retiro" ? "Retiro" : "Falta envío o retiro"}
        </span>
        <span>#{p.number}</span>
        <span>{hace(p.createdAt)}</span>
        {p.isTest && <PruebaTag />}
      </div>
      {p.mode === "envio" && p.address && <p className="text-[12px] text-text-3">{p.address}</p>}
      {porConfirmar ? (
        <Button className="h-11 w-full" onClick={onRevisar}>
          Revisar y confirmar
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          {paso && paso !== "por_confirmar" && paso !== "cancelado" && (
            <Button className="h-11 flex-1" variant="outline" disabled={ocupado} onClick={() => onMover(p, paso)}>
              {PASO_LABEL[paso]}
            </Button>
          )}
          <Link
            href={conversacion}
            className="inline-flex min-h-11 items-center px-1 text-[12px] font-medium text-text-2 hover:text-foreground"
          >
            Ver chat
          </Link>
        </div>
      )}
    </article>
  );
}
