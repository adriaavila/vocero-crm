"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RECUPERAR_CHOICES, RECUPERAR_PLANTILLA, RECUPERAR_RECOMENDADO, recuperarLabel } from "@/lib/recuperar";

type Plantilla = { id: string; name: string; body: string; status: string };
type Datos = {
  dias: number;
  templateId: string | null;
  plantillas: Plantilla[];
  esperando: number;
  resultados: { escritos: number; volvieron: number };
};

/**
 * Fork — «Clientes que no volvieron»: a los cuántos días sin saber de un
 * cliente el agente le escribe una vez (`server/agencia/recuperar.ts`). Fuera
 * de las 24 h WhatsApp solo deja escribir con una plantilla aprobada: si el
 * dueño no tiene una, aquí mismo se manda la propuesta a Meta. Se guarda al
 * elegir, como el seguimiento.
 */
export function RecuperarAjuste({ disabled }: { disabled?: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [estado, setEstado] = useState<"idle" | "guardando" | "guardado" | "creando" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    const res = await fetch("/api/agent/recuperar").catch(() => null);
    if (res?.ok) setDatos((await res.json()) as Datos);
  }

  useEffect(() => {
    void cargar();
  }, []);

  if (!datos) return null;
  const aprobadas = datos.plantillas.filter((p) => p.status === "approved");
  const elegida = aprobadas.find((p) => p.id === datos.templateId) ?? null;
  // Nunca se elige sola una plantilla cualquiera (una confirmación de cita no
  // sirve para recuperar a nadie): solo la propuesta, si ya está aprobada.
  const propuesta = datos.plantillas.find((p) => p.name === RECUPERAR_PLANTILLA.name) ?? null;
  const porDefecto = propuesta?.status === "approved" ? propuesta.id : null;

  async function guardar(dias: number, templateId: string | null) {
    const antes = datos;
    setDatos((d) => (d ? { ...d, dias, templateId } : d));
    setEstado("guardando");
    setError(null);
    const res = await fetch("/api/agent/recuperar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dias, templateId }),
    }).catch(() => null);
    if (!res?.ok) {
      setDatos(antes);
      setEstado("error");
      setError("No se pudo guardar. Intenta de nuevo.");
      return;
    }
    const json = (await res.json()) as { esperando: number };
    setDatos((d) => (d ? { ...d, esperando: json.esperando } : d));
    setEstado("guardado");
  }

  async function crearPlantilla() {
    setEstado("creando");
    setError(null);
    const res = await fetch("/api/agent/recuperar", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      const json = (await res?.json().catch(() => null)) as { message?: string } | null;
      setEstado("error");
      setError(json?.message ?? "No se pudo mandar el mensaje a Meta. Intenta de nuevo.");
      return;
    }
    setEstado("idle");
    await cargar();
  }

  const opciones = (RECUPERAR_CHOICES as readonly number[]).includes(datos.dias)
    ? [...RECUPERAR_CHOICES]
    : [...RECUPERAR_CHOICES, datos.dias].sort((a, b) => a - b);
  const diasVista = datos.dias || RECUPERAR_RECOMENDADO;

  return (
    <div className="space-y-1.5" aria-labelledby="recuperar-titulo">
      <div className="flex items-center gap-2">
        <Label id="recuperar-titulo" htmlFor="recuperar">
          Clientes que no volvieron
        </Label>
        {estado === "guardado" && (
          <span className="flex items-center gap-1 text-xs text-text-3" role="status">
            <Check className="h-3.5 w-3.5" aria-hidden /> Guardado
          </span>
        )}
      </div>
      <Select
        value={String(datos.dias)}
        onValueChange={(value) => {
          const dias = Number(value);
          void guardar(dias, datos.templateId ?? porDefecto);
        }}
        disabled={disabled || estado === "guardando" || (!datos.templateId && !porDefecto)}
      >
        <SelectTrigger id="recuperar" className="w-full max-sm:h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opciones.map((d) => (
            <SelectItem key={d} value={String(d)}>
              {recuperarLabel(d)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {aprobadas.length > 0 && (
        <Select
          value={datos.templateId ?? porDefecto ?? ""}
          onValueChange={(id) => void guardar(datos.dias, id)}
          disabled={disabled || estado === "guardando"}
        >
          <SelectTrigger id="recuperar-mensaje" aria-label="Mensaje que se les manda" className="w-full max-sm:h-11">
            <SelectValue placeholder="Elige el mensaje que se les manda" />
          </SelectTrigger>
          <SelectContent>
            {aprobadas.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {(elegida ?? propuesta) && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs leading-5 text-text-2">
          «{(elegida ?? propuesta)!.body}»
        </p>
      )}

      {propuesta?.status === "pending" && !elegida && (
        <p className="text-xs leading-5 text-text-2" role="status">
          Tu mensaje está esperando la aprobación de Meta. En cuanto lo aprueben puedes encender esto.
        </p>
      )}

      {!propuesta && !elegida && (
        <div className="space-y-1.5">
          <p className="text-xs leading-5 text-text-2">
            Fuera de las 24 h, WhatsApp solo deja escribir con un mensaje aprobado por Meta.
            {aprobadas.length > 0 ? " Elige uno tuyo arriba, o" : ""} te proponemos uno y lo mandamos a revisión.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-sm:h-11"
            disabled={disabled || estado === "creando"}
            onClick={() => void crearPlantilla()}
          >
            {estado === "creando" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            Mandar el mensaje a Meta
          </Button>
        </div>
      )}

      <p className="text-xs leading-5 text-text-3" id="recuperar-hint">
        {error ??
          `${datos.esperando === 0 ? "Hoy ningún cliente" : datos.esperando === 1 ? "Hoy 1 cliente" : `Hoy ${datos.esperando} clientes`} que ya vino o ya compró lleva ${diasVista} días o más sin escribir y no tiene cita. El agente les escribe una sola vez, de 10:00 a 19:00, hasta 20 al día; si contestan, sigue la conversación.`}
        {datos.resultados.escritos > 0 &&
          ` En los últimos 30 días les escribió a ${datos.resultados.escritos} y ${datos.resultados.volvieron} contestaron.`}
      </p>
    </div>
  );
}
