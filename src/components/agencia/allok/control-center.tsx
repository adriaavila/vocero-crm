"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { STATE_HINT, STATE_LABEL, type SystemSnapshot, type SystemState } from "@/lib/estado";
import type { Centro } from "@/server/agencia/estado";
import type { getOverview } from "@/server/overview";
import type { ReadinessResponse } from "@/server/readiness";
import { previewText } from "@/components/inbox/helpers";
import { cn } from "@/lib/utils";
import { Anillo, Cifra } from "./cifra";
import { DayLine } from "./day-line";
import { FunnelChart } from "./embudo";
import { StateDot } from "./mark";
import { useSystemRevision, useSystemState } from "./system-state";

type Overview = Awaited<ReturnType<typeof getOverview>>;

const STATES: SystemState[] = ["activo", "atendiendo", "atencion", "pausado"];

/** Qué dice el botón según adónde lleva el estado. */
function actionLabel(snapshot: SystemSnapshot): string | null {
  switch (snapshot.href) {
    case "/settings/whatsapp":
      return snapshot.whatsapp.status === "missing" ? "Conectar WhatsApp" : "Reconectar WhatsApp";
    case "/settings/billing":
      return "Ver mi plan";
    case "/agent":
      return "Encender el agente";
    case "/inbox":
      return "Abrir conversaciones";
    default:
      return null;
  }
}

/**
 * Inicio del SaaS allok: el centro de control de allok.fun con los datos del
 * negocio. Contesta una sola pregunta en su primera línea —¿está funcionando?—
 * y el resto es evidencia: lo que pasó hoy y quién espera. Mismas reglas que
 * el punto del logotipo (lib/estado), así que nunca se contradicen.
 */
export function ControlCenter({
  centro,
  overview,
  readiness,
  pro,
  billingNotice,
  businessName,
  userName,
  owner,
}: {
  centro: Centro;
  overview: Overview;
  readiness: ReadinessResponse | null;
  /** Ventas, Agenda y Equipo (plan Completo activo). */
  pro: boolean;
  billingNotice?: string | null;
  businessName: string;
  userName: string;
  owner: boolean;
}) {
  const snapshot = useSystemState();
  const revision = useSystemRevision();
  const router = useRouter();

  // Cuando el estado se relee (llegó un mensaje, pasó un minuto), lo del día
  // también: una sola fuente de eventos para toda la pantalla. Refrescar
  // re-arma la página entera, así que va como mucho una vez cada 20 s.
  // ponytail: con cuentas grandes, un endpoint solo para el feed y los números.
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (revision === 0) return;
    const wait = Math.max(0, lastRefresh.current + 20_000 - Date.now());
    const timer = setTimeout(() => {
      lastRefresh.current = Date.now();
      router.refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [revision, router]);

  if (!snapshot) return null;
  const state = snapshot.state;
  const action = actionLabel(snapshot);
  const tz = centro.timezone;
  const firstName = userName.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());
  // El saludo va con la hora del negocio, no con la del servidor.
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const { conversations, solo } = centro.today;
  const summary =
    conversations === 0
      ? "Todavía no escribió nadie hoy."
      : solo === 0
        ? `Hoy escribieron ${conversations} ${conversations === 1 ? "persona" : "personas"}.`
        : `allok atendió sin ayuda ${solo} de ${conversations} ${conversations === 1 ? "conversación" : "conversaciones"} de hoy.`;

  const kpis: { label: string; value: number; of?: number; state?: SystemState }[] = [
    { label: "Conversaciones", value: conversations },
    { label: "Atendidas solas", value: solo, of: conversations > 0 ? conversations : undefined },
    { label: "Leads nuevos", value: centro.today.nuevos },
    { label: "Esperan por ti", value: centro.waiting, state: centro.waiting > 0 ? "atencion" : undefined },
  ];

  return (
    <div className="h-full overflow-y-auto bg-subtle">
      <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
        {billingNotice && (
          <p role="status" className="mb-6 rounded-md border border-info-soft bg-info-tint px-4 py-3 text-sm leading-relaxed text-info-text">
            {billingNotice}
          </p>
        )}

        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="kicker" suppressHydrationWarning>{today}</p>
            <h1 suppressHydrationWarning className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] text-balance md:text-[38px]">
              {firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-text-2">{summary}</p>
          </div>
        </header>

        {/* El centro de control. Tinta en los dos temas: es donde el punto se lee. */}
        <section
          aria-label="Estado de tu negocio"
          className="ak-ink mt-7 overflow-hidden rounded-[22px] border border-border bg-background shadow-md"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-5 md:px-7">
            <span className="flex items-center gap-3">
              <StateDot state={state} size={14} decorative motion />
              <span className="text-[24px] font-bold leading-none tracking-[-0.035em] md:text-[28px]">
                {STATE_LABEL[state]}
              </span>
            </span>
            <span className="font-mono text-[11.5px] text-text-3">
              {snapshot.whatsapp.phone ?? "Sin número conectado"}
            </span>
            <span className="kicker ml-auto">{businessName} · hoy</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-5 py-4 md:px-7">
            <p className="text-[15px] leading-relaxed text-text-2">{snapshot.reason}</p>
            {snapshot.href && action && (
              <Link
                href={snapshot.href}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand px-4 text-sm font-semibold text-brand-fg transition-[opacity,transform] hover:opacity-90 active:scale-[0.97]"
              >
                {action}
                <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
              </Link>
            )}
          </div>

          <DayLine day={centro.day} timezone={tz} owner={owner} />

          <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="bg-background px-5 py-5 md:px-7 md:py-6">
                <dt className="kicker">{kpi.label}</dt>
                <dd className="mt-2.5 flex items-baseline gap-2.5 text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums md:text-[42px]">
                  <Cifra value={kpi.value} />
                  {kpi.of !== undefined && (
                    <span className="-ml-1.5 text-[17px] font-semibold tracking-[-0.02em] text-text-3 md:text-[19px]">/{kpi.of}</span>
                  )}
                  {kpi.of !== undefined && <Anillo value={kpi.value} of={kpi.of} className="ml-auto self-center" />}
                  {kpi.state && <StateDot state={kpi.state} size={9} />}
                </dd>
              </div>
            ))}
          </dl>

          <div className="border-t">
            <div className="flex items-center justify-between px-5 pb-1 pt-4 md:px-7">
              <h2 className="kicker">{centro.waiting > 0 ? "Primero lo que espera por ti" : "Lo último"}</h2>
              {/* Una acción por destino: si el estado ya lleva a Conversaciones, no se repite. */}
              {centro.feed.length > 0 && !(snapshot.href === "/inbox" && action) && (
                <Link href="/inbox" className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-medium text-text-2 hover:text-foreground md:min-h-0">
                  Ver todas <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </div>
            {centro.feed.length ? (
              <ul className="pb-2">
                {centro.feed.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/inbox?contact=${row.contactId}`}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-3 transition-colors hover:bg-[var(--bg-hover)] md:grid-cols-[auto_minmax(0,11rem)_minmax(0,1fr)_auto] md:px-7"
                    >
                      <StateDot state={row.state} size={8} />
                      <span className="truncate text-[14.5px] font-medium">{row.name}</span>
                      <span className="col-start-2 min-w-0 truncate text-[13.5px] text-text-2 md:col-start-auto">
                        <span data-state={row.state} className="text-[var(--st-ink)]">{row.note}</span>
                        {row.preview && <span className="text-text-3"> · {previewText(row.preview)}</span>}
                      </span>
                      <span suppressHydrationWarning className="col-start-3 row-start-1 font-mono text-[11px] text-text-3 md:col-start-auto md:row-start-auto">
                        {when(row.at, tz)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-6 pt-3 text-[14px] text-text-2 md:px-7">
                Todavía no escribió nadie. Cuando alguien lo haga, lo vas a ver aquí primero.
              </p>
            )}
          </div>
        </section>

        {/* La leyenda: el color es el estado, y se aprende una vez. */}
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3.5 px-1 md:flex md:flex-wrap md:gap-x-8">
          {STATES.map((s) => (
            <div key={s} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 md:flex">
              <StateDot state={s} size={8} decorative />
              <dt className="text-[13px] font-semibold">{STATE_LABEL[s]}</dt>
              <dd className="col-start-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-3">{STATE_HINT[s]}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Trend overview={overview} owner={owner} />
          {pro ? <Sales overview={overview} /> : <Upsell owner={owner} />}
        </div>

        {owner && readiness && <Readiness readiness={readiness} />}
      </div>
    </div>
  );
}

/** Hora del día si fue hoy, «ayer», o la fecha; siempre en la zona del negocio. */
function when(iso: string | null, tz: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const now = new Date();
  if (day(date) === day(now)) {
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(date);
  }
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return "ayer";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: tz }).format(date);
}

function Card({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-lg border bg-background", className)}>
      <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Trend({ overview, owner }: { overview: Overview; owner: boolean }) {
  const points = overview.inboundTrend;
  const max = Math.max(...points.map((p) => p.count), 1);
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const weekday = (date: string) =>
    new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const lab = overview.latestLab;

  return (
    <Card title="Mensajes que entraron" aside={<span className="kicker">Últimos 7 días · {total}</span>}>
      <div
        className="flex h-52 items-end gap-2 px-5 pb-4 pt-6 sm:gap-3"
        role="img"
        aria-label={`Mensajes entrantes por día: ${points.map((p) => `${weekday(p.date)} ${p.count}`).join(", ")}`}
      >
        {points.map((p, i) => {
          const last = i === points.length - 1;
          return (
            <div key={p.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <Cifra value={p.count} className={cn("font-mono text-[11px]", last ? "text-foreground" : "text-text-3")} />
              <span
                className={cn("ak-grow-y w-full rounded-[5px]", last ? "bg-foreground" : "bg-[var(--ground-4)]")}
                style={{ height: `${Math.max(3, (p.count / max) * 120)}px`, "--i": i } as React.CSSProperties}
              />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">{weekday(p.date)}</span>
            </div>
          );
        })}
      </div>
      {owner && (
        <Link
          href="/lab"
          className="flex items-center justify-between gap-3 border-t px-5 py-3.5 text-[13.5px] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <span className="min-w-0 truncate text-text-2">
            {lab ? (
              <>
                Última prueba del agente{" "}
                <span className="font-mono font-medium text-foreground">{lab.score}/100</span>
                {lab.redCount > 0 ? ` · ${lab.redCount} por revisar` : " · sin hallazgos graves"}
              </>
            ) : (
              "Todavía no probaste al agente como si fueras un cliente."
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-medium">
            {lab ? "Probar de nuevo" : "Probar ahora"} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Link>
      )}
    </Card>
  );
}

function Sales({ overview }: { overview: Overview }) {
  return (
    <Card
      title="Ventas"
      aside={
        <Link href="/pipeline" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-text-2 hover:text-foreground">
          Ver tablero <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
    >
      <FunnelChart stages={overview.pipeline.map((s) => ({ id: s.stageId, name: s.name, kind: s.kind, count: s.count }))} />
    </Card>
  );
}

/** Las etapas de siempre, para dibujar la forma del embudo cuando todavía no hay tablero. */
const GHOST_STAGES = ["Nuevo", "En conversación", "Interesado", "Cliente"].map((name, i, all) => ({
  id: name,
  name,
  kind: i === all.length - 1 ? ("won" as const) : ("open" as const),
  count: 0,
}));

function Upsell({ owner }: { owner: boolean }) {
  return (
    <Card title="Ventas, agenda y equipo">
      {/* La forma del embudo, sin una sola cifra: es lo que Pro llena. */}
      <FunnelChart stages={GHOST_STAGES} ghost />
      <div className="px-5 py-5">
        <p className="text-[14px] leading-relaxed text-text-2">
          Con Completo cada conversación entra a un tablero de ventas, el agente agenda
          citas y tu equipo atiende desde la misma bandeja.
        </p>
        {owner && (
          <Link
            href="/settings/billing"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] border border-border-strong px-4 text-sm font-semibold transition-[border-color,transform] hover:border-foreground active:scale-[0.97]"
          >
            Ver planes <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
    </Card>
  );
}

function Readiness({ readiness }: { readiness: ReadinessResponse }) {
  const done = readiness.steps.filter((s) => s.status === "complete").length;
  const next = readiness.steps.find((s) => s.status === "pending" || s.status === "stale");
  const complete = !next;
  const n = readiness.steps.length;
  const mdFill = (2 - (n % 2)) % 2;
  const xlFill = (3 - (n % 3)) % 3;
  return (
    <details open={!complete} className="group mt-5 overflow-hidden rounded-lg border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-[-0.01em]">
            {complete ? "Puesta en marcha completa" : "Puesta en marcha"}
          </span>
          <span className="mt-0.5 block text-[13px] text-text-3">
            {next ? `Siguiente: ${next.label}.` : "Tu agente tiene todo lo que necesita para atender."} Probar nunca le escribe a tus clientes.
          </span>
        </span>
        <span className="hidden w-40 items-center gap-3 sm:flex">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ground-3)]">
            <span
              className="block h-full rounded-full bg-foreground"
              style={{ width: `${Math.round((done / readiness.steps.length) * 100)}%` }}
            />
          </span>
          <span className="font-mono text-[11px] text-text-3">
            {done}/{readiness.steps.length}
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-3 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <ol className="grid gap-px border-t bg-border md:grid-cols-2 xl:grid-cols-3">
        {readiness.steps.map((step) => {
          const isNext = step.id === next?.id;
          return (
            <li key={step.id} className="bg-background">
              <Link
                href={step.href}
                aria-current={isNext ? "step" : undefined}
                className={cn(
                  "flex h-full gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-hover)]",
                  isNext && "bg-[var(--bg-hover)]",
                )}
              >
                <span
                  data-state={step.status === "complete" ? "activo" : isNext ? "atencion" : undefined}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                    step.status === "complete"
                      ? "border-transparent bg-[var(--st-soft)] text-[var(--st-ink)]"
                      : isNext
                        ? "border-[var(--st)] text-[var(--st-ink)]"
                        : "text-text-4",
                  )}
                >
                  {step.status === "complete" ? <Check className="h-3 w-3" strokeWidth={3} /> : step.status === "unavailable" ? "—" : "→"}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{step.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-3">{step.detail}</span>
                </span>
              </Link>
            </li>
          );
        })}
        {/* Rellena la última fila: si no, el fondo de la rejilla asoma como un
            bloque gris donde falta un paso. */}
        {Array.from({ length: Math.max(xlFill, mdFill) }, (_, i) => (
          <li
            key={`fill-${i}`}
            aria-hidden
            className={cn("hidden bg-background", i < mdFill && "md:block", i < xlFill ? "xl:block" : "xl:hidden")}
          />
        ))}
      </ol>
    </details>
  );
}
