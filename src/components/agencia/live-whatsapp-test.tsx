"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, MessageCircle, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Capa de agencia — el round-trip de verdad, por WhatsApp.
 *
 * El Laboratorio de upstream evalúa al agente contra clientes SIMULADOS: mide
 * el criterio del agente, no la instalación. Antes de entregarle una instancia
 * a un cliente hace falta la otra prueba, la aburrida: ¿un mensaje que sale de
 * un teléfono real llega al número empresarial, lo recibe el webhook, lo
 * procesa el agente y vuelve la respuesta? Eso es lo que corre aquí, a través
 * de la sesión WAHA de pruebas.
 *
 * Manda un mensaje REAL. Por eso avisa antes y no se dispara solo.
 */

type LiveTest = {
  configured: boolean;
  status?: string;
  phone?: string | null;
  name?: string | null;
};

export function LiveWhatsappTest() {
  const [live, setLive] = useState<LiveTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/lab/live", { cache: "no-store" }).catch(
      () => null
    );
    if (res?.ok) setLive((await res.json()) as LiveTest);
    else setLive({ configured: false });
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function run() {
    setBusy(true);
    setReply(null);
    setError(null);
    const res = await fetch("/api/lab/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo ejecutar la prueba real");
      return;
    }
    const data = (await res.json()) as { reply?: string };
    if (data.reply) setReply(data.reply);
    await refetch();
  }

  // Instancia sin teléfono de pruebas: la tarjeta no aparece en vez de
  // ofrecer un botón que no puede funcionar.
  if (live && !live.configured) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" /> Prueba real con
          WhatsApp
        </CardTitle>
        <CardDescription>
          Un mensaje de ida y vuelta por el número de verdad: webhook, agente y
          respuesta. Es la prueba que hay que ver en verde antes de entregar la
          instancia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Esta prueba SÍ envía un mensaje real desde el teléfono de pruebas al
            WhatsApp empresarial.
          </p>
        </div>

        {!live ? (
          <p className="text-sm text-muted-foreground">
            Comprobando el teléfono de prueba…
          </p>
        ) : live.status !== "WORKING" ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Vincula primero un teléfono de prueba
            </p>
            <p className="text-sm text-muted-foreground">
              El emparejamiento se administra junto a las demás conexiones de
              WhatsApp.
            </p>
            <Link
              className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="/settings/whatsapp"
            >
              Ir a Configuración → WhatsApp
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant="success">Conectado</Badge>
              <p className="text-sm text-muted-foreground">
                {live.name || "WhatsApp personal"}
                {live.phone ? ` · +${live.phone}` : ""}
              </p>
            </div>
            <Button onClick={() => void run()} disabled={busy}>
              <Play className="h-4 w-4" />
              {busy ? "Esperando respuesta…" : "Ejecutar prueba real"}
            </Button>
            {reply && (
              <p className="rounded-md border bg-muted/40 p-3 text-sm">
                <span className="font-medium">Respuesta del agente:</span>{" "}
                {reply}
              </p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
