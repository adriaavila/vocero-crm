"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, MessageCircle, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Sala = {
  id: string;
  url: string;
  planPagoId: string | null;
  alquilerActual: number | null;
  aperturas: number;
  motivo: string | null;
};
type Plan = { id: string; nombre: string };

/**
 * Fork — la sala de venta del contacto, en su panel. Sin la bandera
 * `SALA_VENTA` o sin el vertical, la API responde 404 y esto no se dibuja.
 */
export function SalaVentaPanel({ contactId, nombre }: { contactId: string; nombre: string }) {
  const [disponible, setDisponible] = useState(false);
  const [sala, setSala] = useState<Sala | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [alquiler, setAlquiler] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<"link" | "mensaje" | null>(null);
  const [whatsapp, setWhatsapp] = useState<"listo" | "confirmar" | "enviando" | "enviada">("listo");

  useEffect(() => {
    let vivo = true;
    void Promise.all([
      fetch(`/api/salas?contactId=${encodeURIComponent(contactId)}`),
      fetch("/api/salas/planes"),
    ]).then(async ([rSala, rPlanes]) => {
      if (!vivo || !rSala.ok) return;
      const { sala } = (await rSala.json()) as { sala: Sala | null };
      const planesJson = rPlanes.ok ? ((await rPlanes.json()) as { planes: Plan[] }) : { planes: [] };
      if (!vivo) return;
      setDisponible(true);
      setSala(sala);
      setAlquiler(sala?.alquilerActual ? String(sala.alquilerActual) : "");
      setPlanes(planesJson.planes);
    });
    return () => {
      vivo = false;
    };
  }, [contactId]);

  const guardar = useCallback(
    async (cambios: Record<string, unknown>) => {
      setTrabajando(true);
      setError(null);
      try {
        const res = await fetch("/api/salas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactId, ...cambios }),
        });
        const json = (await res.json().catch(() => null)) as
          | { sala?: Sala; error?: { message: string } }
          | null;
        if (!res.ok || !json?.sala) {
          setError(json?.error?.message ?? "No se pudo guardar la sala");
          return;
        }
        setSala(json.sala);
      } finally {
        setTrabajando(false);
      }
    },
    [contactId]
  );

  async function copiar(que: "link" | "mensaje") {
    if (!sala) return;
    const primerNombre = nombre.split(" ")[0];
    const texto =
      que === "link"
        ? sala.url
        : `Hola ${primerNombre}, armamos tu sala con las casas que te sirven y lo que te quedaría pagando. Mírala aquí: ${sala.url}`;
    await navigator.clipboard.writeText(texto);
    setCopiado(que);
    setTimeout(() => setCopiado(null), 1500);
  }

  async function mandarPorWhatsapp() {
    setWhatsapp("enviando");
    setError(null);
    const res = await fetch("/api/salas/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    if (res.ok) {
      setWhatsapp("enviada");
      return;
    }
    const json = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
    setError(json?.error?.message ?? "No se pudo mandar por WhatsApp");
    setWhatsapp("listo");
  }

  if (!disponible) return null;

  return (
    <section className="border-b p-4">
      <p className="kicker mb-2">Sala de venta</p>

      {!sala ? (
        <>
          <p className="mb-3 text-xs leading-relaxed text-text-3">
            Las casas que le caben y lo que le quedaría pagando, dentro de su WhatsApp y en un
            link que es suyo. Ves cuándo lo abre y si pide visita.
          </p>
          <Button size="sm" disabled={trabajando} onClick={() => void guardar({})}>
            <Presentation className="h-3.5 w-3.5" />
            Armar su sala
          </Button>
        </>
      ) : (
        <div className="space-y-2.5 text-xs">
          <p className={sala.motivo ? "font-medium text-success-text" : "text-text-3"}>
            {sala.motivo ??
              (sala.aperturas === 0 ? "Todavía no la abre" : `La abrió ${sala.aperturas} ${sala.aperturas === 1 ? "vez" : "veces"}`)}
          </p>
          {whatsapp === "confirmar" ? (
            <div className="rounded-[var(--radius)] bg-brand-tint p-2.5">
              <p className="mb-2 text-foreground">
                Le llegan ahora a {nombre.split(" ")[0]}: un saludo, cada casa con su foto y botones, y el
                link de su sala.
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => void mandarPorWhatsapp()}>
                  Mandar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setWhatsapp("listo")}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              disabled={whatsapp === "enviando"}
              onClick={() => setWhatsapp("confirmar")}
            >
              {whatsapp === "enviada" ? <Check className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
              {whatsapp === "enviando" ? "Mandando…" : whatsapp === "enviada" ? "Mandada por WhatsApp" : "Mandar por WhatsApp"}
            </Button>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void copiar("mensaje")}>
              {copiado === "mensaje" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Copiar mensaje
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copiar("link")}>
              {copiado === "link" ? "Copiado" : "Copiar link"}
            </Button>
            <a
              href={sala.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded px-2 py-1 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              Ver
            </a>
          </div>
          <label className="block text-text-3" htmlFor={`alquiler-${contactId}`}>
            Paga de alquiler por mes
          </label>
          <Input
            id={`alquiler-${contactId}`}
            inputMode="decimal"
            value={alquiler}
            placeholder="Si lo contó"
            onChange={(e) => setAlquiler(e.target.value)}
            onBlur={() => {
              const valor = Number(alquiler.replace(/[^\d.]/g, "")) || null;
              if (valor !== sala.alquilerActual) void guardar({ alquilerActual: valor });
            }}
            className="h-7 py-0 text-xs"
          />
          {planes.length > 0 ? (
            <select
              aria-label="Plan de pago"
              value={sala.planPagoId ?? ""}
              onChange={(e) => void guardar({ planPagoId: e.target.value || null })}
              className="h-7 w-full rounded border border-border-strong bg-background px-2 text-xs"
            >
              <option value="">Sin calculadora</option>
              {planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-text-3">
              Sin plan de pago aprobado la sala no muestra calculadora.{" "}
              <a href="/salas" className="underline">Cargar uno</a>
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}
    </section>
  );
}
