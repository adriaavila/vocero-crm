"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEGUIMIENTO_CHOICES, seguimientoLabel } from "@/lib/seguimiento";

/**
 * Fork — «Si el cliente deja de contestar»: cuántas horas espera el agente
 * antes de escribirle una vez para retomar (`server/agencia/seguimiento.ts`).
 * Se guarda al elegir: no es parte del texto del negocio y no espera al botón
 * de abajo.
 */
export function SeguimientoAjuste({ disabled }: { disabled?: boolean }) {
  const [hours, setHours] = useState<number | null>(null);
  const [estado, setEstado] = useState<"idle" | "guardando" | "guardado" | "error">("idle");

  useEffect(() => {
    let vivo = true;
    void fetch("/api/agent/seguimiento")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hours: number } | null) => {
        if (vivo && data) setHours(data.hours);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  async function elegir(value: string) {
    const next = Number(value);
    const antes = hours;
    setHours(next);
    setEstado("guardando");
    try {
      const res = await fetch("/api/agent/seguimiento", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: next }),
      });
      if (!res.ok) throw new Error();
      setEstado("guardado");
    } catch {
      setHours(antes);
      setEstado("error");
    }
  }

  if (hours === null) return null;
  const opciones = (SEGUIMIENTO_CHOICES as readonly number[]).includes(hours)
    ? [...SEGUIMIENTO_CHOICES]
    : [...SEGUIMIENTO_CHOICES, hours].sort((a, b) => a - b);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor="seguimiento">Si el cliente deja de contestar</Label>
        {estado === "guardado" && (
          <span className="flex items-center gap-1 text-xs text-text-3" role="status">
            <Check className="h-3.5 w-3.5" aria-hidden /> Guardado
          </span>
        )}
      </div>
      <Select value={String(hours)} onValueChange={elegir} disabled={disabled || estado === "guardando"}>
        <SelectTrigger id="seguimiento" className="w-full max-sm:h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opciones.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {seguimientoLabel(h)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs leading-5 text-text-3">
        {estado === "error"
          ? "No se pudo guardar. Intenta de nuevo."
          : "Le escribe una sola vez para retomar lo que quedó pendiente, nunca de noche y solo dentro de las 24 h que permite WhatsApp. Si la conversación ya terminó, no escribe."}
      </p>
    </div>
  );
}
