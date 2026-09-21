import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Inbox,
  LockKeyhole,
  MessageSquareWarning,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import type { ReadinessResponse } from "@/server/readiness";
import type { SaaSBillingState } from "@/server/saas/billing";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";

type OverviewData = {
  summary: { unreadConversations: number; pendingHandoffs: number; activeWindows: number; agentEnabled: boolean };
  inboundTrend: { date: string; count: number }[];
  pipeline: { stageId: string; name: string; kind: "open" | "won" | "lost"; count: number }[];
  priorities: ConversationDto[];
  latestLab: { score: number; delta: number | null; redCount: number; finishedAt: string } | null;
};

export function OverviewDashboard({ data, readiness, billing, billingNotice, userName, owner }: { data: OverviewData; readiness: ReadinessResponse | null; billing: SaaSBillingState | null; billingNotice?: string | null; userName: string; owner: boolean }) {
  const billingActive = !billing || billing.status === "active" || billing.status === "trialing";
  const proEnabled = !billing || (billing.plan === "pro" && (billing.status === "active" || billing.status === "trialing"));
  const automationActive = data.summary.agentEnabled && billingActive;
  const firstPending = readiness?.steps.find((step) => step.status === "pending" || step.status === "stale");
  const completeSteps = readiness?.steps.filter((step) => step.status === "complete").length ?? 0;
  const progress = readiness && readiness.steps.length > 0 ? Math.round((completeSteps / readiness.steps.length) * 100) : null;
  const whatsappReady = readiness?.steps.find((step) => step.id === "whatsapp")?.status === "complete";
  const knowledgeReady = readiness?.steps.find((step) => step.id === "knowledge")?.status === "complete";
  const businessHoursReady = readiness?.steps.find((step) => step.id === "business_hours")?.status === "complete";
  const testReady = readiness?.steps.find((step) => step.id === "simulation")?.status === "complete";
  const maxTrend = Math.max(...data.inboundTrend.map((point) => point.count), 1);
  const maxPipeline = Math.max(...data.pipeline.map((stage) => stage.count), 1);
  const primaryAction = billing && !billingActive
    ? { href: "/settings/billing", label: "Reactivar automatización" }
    : firstPending && owner
      ? { href: firstPending.href, label: "Continuar configuración" }
      : data.summary.pendingHandoffs > 0
        ? { href: "/inbox", label: "Revisar bandeja" }
        : owner
          ? { href: "/lab", label: "Probar una conversación" }
          : { href: "/inbox", label: "Ver conversaciones" };
  return (
    <div className="allok-overview h-full overflow-y-auto bg-subtle">
      <header className="border-b bg-background px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between">
          <div className="min-w-0"><p className="kicker">Centro de atención</p><h1 className="mt-1 truncate text-xl font-[680] tracking-tight">Inicio</h1></div>
          <Badge variant={automationActive ? "success" : billing && !billingActive ? "warning" : "secondary"}>{automationActive ? "Agente activo" : billing && !billingActive ? "Facturación pendiente" : "Agente en pausa"}</Badge>
        </div>
      </header>
      <div className="allok-overview-content mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
        {billingNotice && <p role="status" className="rounded-lg border border-brand-soft bg-brand-tint px-4 py-3 text-sm text-brand-text">{billingNotice}</p>}
        <section aria-label="Señales de operación" className="allok-signals grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SignalCard label="Sin leer" value={data.summary.unreadConversations} helper={data.summary.unreadConversations ? "Abrir bandeja" : "Todo al día"} icon={Inbox} href="/inbox" warning={data.summary.unreadConversations > 0} />
          <SignalCard label="Atención humana" value={data.summary.pendingHandoffs} helper={data.summary.pendingHandoffs ? "Tomar conversación" : "Ninguna pendiente"} icon={MessageSquareWarning} href="/inbox" warning={data.summary.pendingHandoffs > 0} />
          <SignalCard label="Ventanas activas" value={data.summary.activeWindows} helper="Conversaciones abiertas" icon={Clock3} href="/inbox" />
          <SignalCard label="Última prueba" value={data.latestLab ? `${data.latestLab.score}/100` : "—"} helper={data.latestLab ? (data.latestLab.redCount ? "Revisar hallazgos" : "Sin hallazgos críticos") : "Haz tu primera prueba"} icon={Sparkles} href={owner ? "/lab" : "/overview"} warning={Boolean(data.latestLab?.redCount)} />
        </section>

        <section className="allok-briefing grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="relative overflow-hidden rounded-lg border bg-background p-5 shadow-sm md:p-7">
            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-tint blur-3xl" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${automationActive ? "border-success-soft bg-success-tint text-success-text" : billing && !billingActive ? "border-warning-soft bg-warning-tint text-warning-text" : "border-border-strong bg-secondary text-text-2"}`}><span className={`h-2 w-2 rounded-full ${automationActive ? "bg-success" : billing && !billingActive ? "bg-warning" : "bg-border-strong"}`} />{automationActive ? "Tu WhatsApp está cubierto" : billing && !billingActive ? "Automatización pausada por facturación" : "Tu agente está en pausa"}</span>
                {data.summary.pendingHandoffs > 0 && <Badge variant="warning">{data.summary.pendingHandoffs} requiere atención</Badge>}
              </div>
              <h2 className="mt-5 text-3xl font-[720] tracking-[-0.04em] md:text-4xl">Tu operación, de un vistazo.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-text-2">Hola{userName ? `, ${userName.split(" ")[0]}` : ""}. Revisa las conversaciones que necesitan atención y prepara el siguiente paso.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href={primaryAction.href} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover"><WandSparkles className="h-4 w-4" /> {primaryAction.label}</Link>
                {primaryAction.href !== "/inbox" && <Link href="/inbox" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-semibold transition-colors hover:bg-accent">Abrir bandeja <ArrowUpRight className="h-4 w-4" /></Link>}
              </div>
            </div>
          </div>

          <aside className="rounded-lg border bg-background p-5 shadow-sm md:p-6">
            <div className="flex items-start justify-between gap-3"><div><p className="kicker">Nivel de cobertura</p><h2 className="mt-1 text-lg font-[680]">{readiness?.overall === "ready" && billingActive ? "Listo para atender" : "Falta poco"}</h2></div><CheckCircle2 className={readiness?.overall === "ready" && billingActive ? "h-6 w-6 text-success" : "h-6 w-6 text-brand"} /></div>
            <div className="mt-5 space-y-3">
              {billing && <CoverageRow label="Suscripción activa" complete={billingActive} href="/settings/billing" />}
              <CoverageRow label="WhatsApp conectado" complete={owner ? whatsappReady : Boolean(data.summary.activeWindows)} href="/settings/whatsapp" />
              <CoverageRow label="Información del negocio" complete={owner ? knowledgeReady : undefined} href="/agent" />
              {owner && <CoverageRow label="Horario de respuesta" complete={businessHoursReady} href="/agent" />}
              <CoverageRow label="Prueba del agente" complete={owner ? testReady : undefined} href="/lab" />
            </div>
            {progress !== null && <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-text-3"><span>{completeSteps} de {readiness?.steps.length} pasos</span><span className="font-semibold text-text-2">{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress}%` }} /></div></div>}
          </aside>
        </section>

        {owner && readiness && (
          <details className="allok-readiness overflow-hidden rounded-lg border bg-background shadow-sm">
            <summary className="cursor-pointer px-4 py-4 md:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Puesta en marcha</h2>
                <span className="text-xs text-text-3">{completeSteps}/{readiness.steps.length} completos</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-text-3">{firstPending ? `Siguiente: ${firstPending.label}.` : "Todo listo para atender."} Las simulaciones no envían mensajes a tus clientes.</p>
            </summary>
            <div className="grid gap-px bg-border md:grid-cols-3">
              {readiness.steps.map((step) => (
                <Link key={step.id} href={step.href} aria-current={firstPending?.id === step.id ? "step" : undefined} className={`group flex min-h-24 gap-3 bg-background p-4 transition-colors hover:bg-subtle ${firstPending?.id === step.id ? "bg-brand-tint/35 ring-1 ring-inset ring-brand-soft" : ""}`}>
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${step.status === "complete" ? "border-success bg-success text-white" : step.status === "unavailable" ? "bg-secondary text-text-4" : "border-brand-soft bg-brand-tint text-brand-text"}`}>
                    {step.status === "complete" ? <Check className="h-3.5 w-3.5" /> : <span className="text-[10px]">{step.status === "unavailable" ? "—" : "→"}</span>}
                  </span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">{step.label}</span><span className="mt-1 block text-xs leading-relaxed text-text-3">{step.detail}</span></span>
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t px-4 py-3 text-xs text-text-3">
              <span className="font-medium text-text-2">Recomendado</span>
              <Link href="/settings/branding" className="hover:text-foreground">{readiness.optional.brandingCustomized ? "✓ Marca personalizada" : "Personalizar marca"}</Link>
              <Link href="/settings/team" className="hover:text-foreground">{readiness.optional.teamMemberCount > 1 ? `✓ ${readiness.optional.teamMemberCount} personas en el equipo` : "Invitar al equipo"}</Link>
            </div>
          </details>
        )}



        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
            <ModuleTitle title="Mensajes entrantes" right={<span className="text-xs text-text-3">Últimos 7 días</span>} />
            <div className="allok-trend flex h-64 items-end gap-2 p-5" role="img" aria-label="Mensajes entrantes durante los últimos siete días">
              {data.inboundTrend.map((point) => (
                <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center">
                  <span className="text-xs font-semibold text-text-2">{point.count}</span>
                  <span className="min-h-1 rounded-t-sm bg-brand-soft transition-[height]" style={{ height: `${Math.max(4, (point.count / maxTrend) * 150)}px` }} />
                  <span className="truncate text-[10px] uppercase text-text-4">{new Date(`${point.date}T12:00:00Z`).toLocaleDateString("es", { weekday: "short" })}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
            <ModuleTitle title={proEnabled ? "Pipeline" : "Ventas"} right={proEnabled ? <Link href="/pipeline" className="text-xs font-medium text-brand-text">Ver tablero</Link> : <Badge variant="secondary">Pro</Badge>} />
            {proEnabled ? <div className="space-y-4 p-5">
              {data.pipeline.map((stage) => <div key={stage.stageId}><div className="mb-1.5 flex justify-between text-xs"><span>{stage.name}</span><span className="font-semibold">{stage.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-brand" style={{ width: `${(stage.count / maxPipeline) * 100}%` }} /></div></div>)}
            </div> : <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand-text"><LockKeyhole className="h-4 w-4" /></span><p className="mt-3 text-sm font-semibold">Convierte conversaciones en ventas</p><p className="mt-1 max-w-xs text-xs leading-5 text-text-3">Pipeline y agenda están incluidos en Pro, cuando tu equipo ya está listo para crecer.</p><Link href="/settings/billing" className="mt-4 inline-flex h-9 items-center rounded-md bg-brand px-3 text-xs font-semibold text-brand-fg hover:bg-brand-hover">Ver Pro <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Link></div>}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-background shadow-sm">
            <ModuleTitle title="Lo que requiere atención" right={<Link href="/inbox" className="inline-flex items-center gap-1 text-xs font-medium text-brand-text">Abrir bandeja <ArrowRight className="h-3.5 w-3.5" /></Link>} />
          {data.priorities.length ? <div className="divide-y">{data.priorities.map((conversation) => <Link key={conversation.id} href={`/inbox?conversation=${conversation.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle"><ContactAvatar name={conversation.contact.name} seed={conversation.contact.id} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{conversation.contact.name}</p><p className="truncate text-xs text-text-3">{conversation.preview ?? "Conversación pendiente"}</p></div>{conversation.handoffAt ? <Badge variant="warning">Atención humana</Badge> : <Badge variant="secondary">{conversation.unreadCount} sin leer</Badge>}<ArrowRight className="h-4 w-4 text-text-4" /></Link>)}</div> : <div className="flex flex-col items-center px-4 py-10 text-center"><Bot className="mb-2 h-6 w-6 text-success" /><p className="text-sm font-medium">Todo al día</p><p className="text-xs text-text-3">No hay conversaciones pendientes.</p></div>}
        </section>

        <section className="grid gap-4 rounded-lg border bg-background p-4 shadow-sm md:grid-cols-3 md:p-5">
          <QuickAction href="/inbox" icon={Inbox} title="Ver conversaciones" detail="Responde o toma el control cuando haga falta." />
          {owner && <>
            <QuickAction href="/lab" icon={WandSparkles} title="Probar Allok" detail="Comprueba cómo responderá antes de activarlo." />
            <QuickAction href="/agent" icon={Activity} title="Ajustar el agente" detail="Actualiza horarios, tono e información del negocio." />
          </>}
        </section>
      </div>
    </div>
  );
}

function ModuleTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="module-cap flex items-center justify-between border-b px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{right}</div>;
}

function SignalCard({ label, value, helper, icon: Icon, href, warning = false }: { label: string; value: string | number; helper: string; icon: typeof Inbox; href: string; warning?: boolean }) {
  return <Link href={href} className="group rounded-lg border bg-background p-4 shadow-sm transition-colors hover:border-brand-soft hover:bg-brand-tint"><div className="flex items-center justify-between text-xs font-medium text-text-2"><span>{label}</span><Icon className="h-4 w-4 text-text-3 transition-colors group-hover:text-brand" /></div><div className="mt-3 flex items-end justify-between gap-3"><span className="text-3xl font-[680] tracking-tight">{value}</span><span className={`text-right text-xs font-medium ${warning ? "text-warning-text" : "text-text-3"}`}>{helper}</span></div></Link>;
}

function CoverageRow({ label, complete, href }: { label: string; complete: boolean | undefined; href: string }) {
  return <Link href={href} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-subtle"><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${complete === true ? "bg-success text-white" : "border border-border-strong text-text-4"}`}>{complete === true ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />}</span><span className="min-w-0 flex-1 truncate">{label}</span>{complete === true ? <span className="text-xs text-success-text">Listo</span> : <ArrowRight className="h-3.5 w-3.5 text-text-4" />}</Link>;
}

function QuickAction({ href, icon: Icon, title, detail }: { href: string; icon: typeof Inbox; title: string; detail: string }) {
  return <Link href={href} className="group flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-subtle"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-tint text-brand-text"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-sm font-semibold">{title}<ArrowUpRight className="h-3.5 w-3.5 text-text-4 transition-colors group-hover:text-brand" /></span><span className="mt-1 block text-xs leading-relaxed text-text-3">{detail}</span></span></Link>;
}
