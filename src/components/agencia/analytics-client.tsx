"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Award,
  Bot,
  Clock3,
  MessageSquareWarning,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { AnaliticaData } from "@/server/agencia/analitica";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatMoneyCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts";

const LOSS_REASON_LABEL: Record<string, string> = {
  precio: "Precio",
  no_es_perfil: "No es el perfil",
  sin_presupuesto: "Sin presupuesto",
  eligio_otro: "Eligió otro",
  nunca_contesto: "Nunca contestó",
  otro: "Otro",
};

const HANDOFF_REASON_LABEL: Record<string, string> = {
  cliente: "Lo pidió el cliente",
  modelo: "El agente decidió escalar",
  error: "Error del agente",
  ventana: "Ventana de WhatsApp cerrada",
  hostilidad: "El lead se puso hostil",
  manual_reply: "Alguien contestó desde el teléfono",
};

export function AnalyticsClient({ data }: { data: AnaliticaData }) {
  const router = useRouter();

  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace)]">
      <header className="border-b bg-background px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-4">
              Principal / Analítica
            </p>
            <h1 className="mt-1 text-lg font-[680]">Analítica</h1>
          </div>
          <Select
            value={String(data.rango)}
            onValueChange={(v) => router.push(`/analytics?rango=${v}`)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
        {data.ahora.ventanasPorVencer > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-warning-soft bg-warning-tint px-4 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <p className="text-warning-text">
              {data.ahora.ventanasPorVencer} ventana
              {data.ahora.ventanasPorVencer === 1 ? "" : "s"} de WhatsApp por vencer en menos
              de 4 horas — sin responder, esa conversación vuelve a costar una plantilla.
            </p>
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Tasa de cierre"
            value={pct(data.conversion.tasaCierre.actual)}
            delta={ppDelta(data.conversion.tasaCierre.actual, data.conversion.tasaCierre.previo)}
            detail={`${data.conversion.tasaCierre.ganados} ganados · ${data.conversion.tasaCierre.perdidos} perdidos`}
          />
          <KpiCard
            label="Ingreso ganado"
            value={formatMoneyCents(data.conversion.ingreso.ganadoCents.actual, data.moneda) ?? "—"}
            delta={moneyDelta(
              data.conversion.ingreso.ganadoCents.actual,
              data.conversion.ingreso.ganadoCents.previo
            )}
            detail={
              data.conversion.ingreso.fueraDeMoneda > 0
                ? `${data.conversion.ingreso.fueraDeMoneda} trato(s) en otra moneda, fuera del total`
                : "vs. ventana anterior"
            }
          />
          <KpiCard
            label="Resueltas sin humano"
            value={pct(data.agente.resueltasSinHandoff.actual)}
            delta={ppDelta(data.agente.resueltasSinHandoff.actual, data.agente.resueltasSinHandoff.previo)}
            detail={`${data.agente.resueltasSinHandoff.sinHandoff} de ${data.agente.resueltasSinHandoff.total} conversaciones`}
          />
          <KpiCard
            label="Citas agendadas por IA"
            value={String(data.agente.citas.ia.actual)}
            delta={countDelta(data.agente.citas.ia.actual, data.agente.citas.ia.previo)}
            detail={`${data.agente.citas.manual.actual} agendadas a mano`}
          />
        </section>

        <Tabs defaultValue="conversion">
          <TabsList>
            <TabsTrigger value="conversion">Conversión y dinero</TabsTrigger>
            <TabsTrigger value="agente">Agente IA</TabsTrigger>
            <TabsTrigger value="operacion">Operación y canales</TabsTrigger>
          </TabsList>

          <TabsContent value="conversion" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Embudo</CardTitle>
                </CardHeader>
                <CardContent>
                  <FunnelBars stages={data.conversion.embudo} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Tiempo mediano por etapa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.conversion.tiempoPorEtapa.length === 0 ? (
                    <EmptyHint texto="Sin movimientos suficientes en esta ventana." />
                  ) : (
                    data.conversion.tiempoPorEtapa.map((row) => (
                      <div key={row.etapa} className="flex items-center justify-between text-sm">
                        <span className="text-text-2">{row.etapa}</span>
                        <span className="font-semibold">
                          {row.medianaHoras !== null ? formatHoras(row.medianaHoras) : "—"}
                          <span className="ml-1.5 font-normal text-text-4">
                            ({row.muestras})
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Motivos de pérdida</CardTitle>
              </CardHeader>
              <CardContent>
                {data.conversion.motivosPerdida.length === 0 ? (
                  <EmptyHint texto="Nada perdido en esta ventana." />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.conversion.motivosPerdida.map((m) => (
                      <Badge key={m.motivo} variant="secondary">
                        {LOSS_REASON_LABEL[m.motivo] ?? m.motivo}: {m.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="agente" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Citas</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <Stat icon={Bot} label="Agendadas por IA" value={String(data.agente.citas.ia.actual)} />
                  <Stat icon={Clock3} label="Agendadas a mano" value={String(data.agente.citas.manual.actual)} />
                  <Stat
                    icon={MessageSquareWarning}
                    label="No-show"
                    value={data.agente.citas.noShowRate !== null ? pct(data.agente.citas.noShowRate) : "—"}
                  />
                  <Stat
                    icon={AlertTriangle}
                    label="Canceladas"
                    value={data.agente.citas.canceladaRate !== null ? pct(data.agente.citas.canceladaRate) : "—"}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Motivo de escalar a un humano</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.agente.handoffPorMotivo.length === 0 ? (
                    <EmptyHint texto="El agente no ha escalado nada en esta ventana." />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.agente.handoffPorMotivo.map((m) => (
                        <Badge key={m.motivo} variant="secondary">
                          {HANDOFF_REASON_LABEL[m.motivo] ?? m.motivo}: {m.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Evolución del Laboratorio</CardTitle>
              </CardHeader>
              <CardContent>
                {data.agente.scoreLab.length < 2 ? (
                  <EmptyHint texto="Corre el Laboratorio más de una vez en esta ventana para ver la evolución." />
                ) : (
                  <ScoreChart puntos={data.agente.scoreLab} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="operacion" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Primera respuesta (mediana)</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <Stat
                    icon={Award}
                    label="Contestada por la IA"
                    value={
                      data.operacion.primeraRespuesta.medianaMinutosIA !== null
                        ? formatMinutos(data.operacion.primeraRespuesta.medianaMinutosIA)
                        : "—"
                    }
                    hint={`${data.operacion.primeraRespuesta.muestrasIA} conversación(es)`}
                  />
                  <Stat
                    icon={Clock3}
                    label="Contestada por el equipo"
                    value={
                      data.operacion.primeraRespuesta.medianaMinutosOperador !== null
                        ? formatMinutos(data.operacion.primeraRespuesta.medianaMinutosOperador)
                        : "—"
                    }
                    hint={`${data.operacion.primeraRespuesta.muestrasOperador} conversación(es)`}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Volumen por canal</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.operacion.volumenPorCanal.every((c) => c.count === 0) ? (
                    <EmptyHint texto="Sin mensajes entrantes en esta ventana." />
                  ) : (
                    data.operacion.volumenPorCanal.map((c) => (
                      <div key={c.canal} className="flex items-center justify-between text-sm">
                        <span className="text-text-2">{CHANNEL_LABEL[c.canal]}</span>
                        <span className="font-semibold">{c.count}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Horas pico</CardTitle>
              </CardHeader>
              <CardContent>
                {data.operacion.horasPico.every((h) => h.count === 0) ? (
                  <EmptyHint texto="Sin mensajes entrantes en esta ventana." />
                ) : (
                  <HorasPicoChart horas={data.operacion.horasPico} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Piezas pequeñas
// ---------------------------------------------------------------------------

type Delta = { texto: string; positivo: boolean } | null;

function KpiCard({
  label,
  value,
  delta,
  detail,
}: {
  label: string;
  value: string;
  delta: Delta;
  detail: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="module-cap border-b py-2.5">
        <CardTitle className="text-xs font-medium text-text-2">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-end justify-between gap-2">
          <span className="text-2xl font-[680] tracking-tight">{value}</span>
          {delta && (
            <span
              className={`flex items-center gap-0.5 text-xs font-medium ${
                delta.positivo ? "text-success" : "text-danger"
              }`}
            >
              {delta.positivo ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {delta.texto}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-text-3">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
      <div>
        <p className="text-lg font-[680] leading-none">{value}</p>
        <p className="mt-1 text-xs text-text-3">{label}</p>
        {hint && <p className="text-[11px] text-text-4">{hint}</p>}
      </div>
    </div>
  );
}

function EmptyHint({ texto }: { texto: string }) {
  return <p className="py-6 text-center text-sm text-text-3">{texto}</p>;
}

function FunnelBars({
  stages,
}: {
  stages: { nombre: string; kind: "open" | "won" | "lost"; posicion: number; leads: number }[];
}) {
  const max = Math.max(...stages.map((s) => s.leads), 1);
  if (stages.every((s) => s.leads === 0)) {
    return <EmptyHint texto="Sin leads que entraran a una etapa en esta ventana." />;
  }
  return (
    <div className="space-y-3">
      {stages.map((s) => (
        <div key={s.nombre}>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className={s.kind === "lost" ? "text-danger-text" : "text-text-2"}>
              {s.nombre}
            </span>
            <span className="font-semibold">{s.leads}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full ${s.kind === "lost" ? "bg-danger" : s.kind === "won" ? "bg-success" : "bg-brand"}`}
              style={{ width: `${(s.leads / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const scoreConfig: ChartConfig = {
  score: { label: "Score", color: "var(--accent)" },
};

function ScoreChart({ puntos }: { puntos: { fecha: string; score: number }[] }) {
  return (
    <ChartContainer config={scoreConfig} className="aspect-auto h-56 w-full">
      <LineChart data={puntos} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="fecha"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="score"
          type="monotone"
          stroke="var(--color-score)"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

const horasConfig: ChartConfig = {
  count: { label: "Mensajes", color: "var(--accent)" },
};

function HorasPicoChart({ horas }: { horas: { hora: number; count: number }[] }) {
  return (
    <ChartContainer config={horasConfig} className="aspect-auto h-56 w-full">
      <BarChart data={horas} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="hora"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={2}
          tickFormatter={(v: number) => `${v}h`}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

function pct(v: number | null): string {
  return v !== null ? `${Math.round(v * 100)}%` : "—";
}

function formatHoras(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 48) return `${horas.toFixed(1)} h`;
  return `${(horas / 24).toFixed(1)} días`;
}

function formatMinutos(minutos: number): string {
  if (minutos < 60) return `${Math.round(minutos)} min`;
  if (minutos < 1440) return `${(minutos / 60).toFixed(1)} h`;
  return `${(minutos / 1440).toFixed(1)} días`;
}

function ppDelta(actual: number | null, previo: number | null): Delta {
  if (actual === null || previo === null) return null;
  const diff = Math.round((actual - previo) * 100);
  if (diff === 0) return null;
  return { texto: `${diff > 0 ? "+" : ""}${diff} pp`, positivo: diff > 0 };
}

function countDelta(actual: number, previo: number): Delta {
  const diff = actual - previo;
  if (diff === 0) return null;
  return { texto: `${diff > 0 ? "+" : ""}${diff}`, positivo: diff > 0 };
}

function moneyDelta(actualCents: number, previoCents: number): Delta {
  const diff = actualCents - previoCents;
  if (diff === 0) return null;
  if (previoCents === 0) return { texto: "nuevo", positivo: diff > 0 };
  const pctDiff = Math.round((diff / previoCents) * 100);
  return { texto: `${pctDiff > 0 ? "+" : ""}${pctDiff}%`, positivo: diff > 0 };
}
