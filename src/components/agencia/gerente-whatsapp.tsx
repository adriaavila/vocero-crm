"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, MessageCircle } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";

/**
 * Fork — «Tu gerente de ventas, en tu WhatsApp» (server/agencia/gerente.ts).
 * La persona conecta su WhatsApp mandando un código al número de Rei; desde
 * ahí le pregunta «¿cómo vamos?» y recibe el reporte de los lunes. Sin el
 * módulo encendido (GERENTE_NEGOCIO) la tarjeta no aparece.
 */

type Estado =
  | { disponible: false }
  | { disponible: true; numero: string | null; conectado: boolean; reporteSemanal: boolean; codigo: string | null; vence: string | null };

export function GerenteWhatsapp() {
  const notify = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const leer = useCallback(async () => {
    const res = await fetch("/api/gerente").catch(() => null);
    if (res?.ok) setEstado((await res.json()) as Estado);
  }, []);

  useEffect(() => {
    void leer();
  }, [leer]);

  // Con un código en pantalla, mirar cada pocos segundos si ya llegó.
  const esperando = estado?.disponible && !estado.conectado && Boolean(estado.codigo);
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(() => void leer(), 4000);
    return () => clearInterval(t);
  }, [esperando, leer]);

  async function pedirCodigo() {
    setOcupado(true);
    try {
      const res = await fetch("/api/gerente", { method: "POST" });
      if (!res.ok) throw new Error();
      setEstado((await res.json()) as Estado);
    } catch {
      notify("No pudimos generar el código. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    try {
      const res = await fetch("/api/gerente", { method: "DELETE" });
      if (res.ok) setEstado((await res.json()) as Estado);
    } finally {
      setOcupado(false);
    }
  }

  if (!estado?.disponible) return null;

  if (estado.conectado) {
    return (
      <section aria-label="Gerente de ventas por WhatsApp" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border bg-background px-4 py-3 md:px-5">
        <p className="flex items-center gap-2 text-[14px] text-text-2">
          <Check className="h-4 w-4 text-foreground" aria-hidden />
          Tu WhatsApp está conectado al gerente de ventas.{" "}
          {estado.reporteSemanal ? "El reporte te llega los lunes a las 8." : "El reporte de los lunes está en pausa."}
        </p>
        <span className="ml-auto flex gap-1">
          {estado.numero && (
            <a href={`https://wa.me/${estado.numero}?text=${encodeURIComponent("¿Cómo vamos?")}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-[var(--btn-radius,10px)] px-3 text-sm font-semibold hover:underline">
              Preguntarle
            </a>
          )}
          <button type="button" disabled={ocupado} onClick={desconectar} className="min-h-11 rounded-[var(--btn-radius,10px)] px-3 text-sm text-text-3 hover:underline disabled:opacity-60">
            Desconectar
          </button>
        </span>
      </section>
    );
  }

  return (
    <section aria-label="Gerente de ventas por WhatsApp" className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[16px] border bg-background px-4 py-3 md:px-5">
      <div className="min-w-0 max-w-xl">
        <p className="mb-1 flex items-center gap-2.5 text-[15px] font-semibold">
          <MessageCircle className="h-4 w-4" aria-hidden />
          Tu gerente de ventas, en tu WhatsApp
        </p>
        {estado.codigo ? (
          <p className="text-[14px] leading-relaxed text-text-2">
            Manda este código {estado.numero ? <>al <span className="font-mono">+{estado.numero}</span></> : "al WhatsApp de Rei"} desde tu teléfono. Vence en 30 minutos.
            <span className="mt-2 block font-mono text-[22px] font-semibold tracking-[0.08em] text-foreground">{estado.codigo}</span>
          </p>
        ) : (
          <p className="text-[14px] leading-relaxed text-text-2">
            Pregúntale «¿cómo vamos?» o «¿a quién llamo hoy?» desde tu WhatsApp, cuando quieras. Y cada lunes a las 8, el reporte de la semana con lo que conviene mejorar.
          </p>
        )}
      </div>
      {estado.codigo && estado.numero ? (
        <a
          href={`https://wa.me/${estado.numero}?text=${encodeURIComponent(estado.codigo)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--btn-radius,10px)] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[transform] active:scale-[0.97]"
        >
          Abrir WhatsApp
        </a>
      ) : (
        !estado.codigo && (
          <button
            type="button"
            disabled={ocupado}
            onClick={pedirCodigo}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--btn-radius,10px)] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[transform] active:scale-[0.97] disabled:opacity-60"
          >
            Conectar mi WhatsApp
          </button>
        )
      )}
    </section>
  );
}
