"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Status = {
  configured: boolean;
  mode: "service_account" | "oauth" | null;
  accountEmail: string | null;
  meetSupported: boolean;
  error: string | null;
  oauthAvailable: boolean;
};

export function CalendarSettingsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/calendar", { cache: "no-store" });
    setStatus(response.ok ? await response.json() : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy(true);
    const response = await fetch("/api/settings/calendar/connect", { method: "POST" });
    const body = response.ok ? await response.json() : null;
    if (body?.url) window.location.assign(body.url);
    else setBusy(false);
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/settings/calendar", { method: "DELETE" });
    await load();
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Google Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          NEA consulta disponibilidad real y crea citas de 30 minutos con Google Meet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" /> Agenda de NEA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : status.configured && status.meetSupported ? (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Calendario listo
              </p>
              <p className="mt-1 text-xs">
                {status.mode === "oauth" ? "OAuth" : "Cuenta de servicio"}
                {status.accountEmail ? ` · ${status.accountEmail}` : ""} · Google Meet habilitado
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Calendario pendiente</p>
              <p className="mt-1 text-xs">
                {status.error ?? "La agenda configurada no permite crear Google Meet."}
              </p>
            </div>
          )}

          <div className="rounded-md border bg-secondary/30 p-3 text-xs leading-5 text-text-2">
            Lunes a viernes · 09:00–17:00 · America/Caracas · 30 min · 15 min de margen
          </div>

          {status?.oauthAvailable && status.mode !== "oauth" && (
            <Button onClick={() => void connect()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ExternalLink />}
              Conectar Google con OAuth
            </Button>
          )}
          {status?.mode === "oauth" && (
            <Button variant="outline" onClick={() => void disconnect()} disabled={busy}>
              Desconectar OAuth
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
