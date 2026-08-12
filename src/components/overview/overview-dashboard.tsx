import Link from "next/link";
import { AlertCircle, ArrowRight, Bot, Check, Clock3, Inbox, MessageSquareWarning, Sparkles } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import type { ReadinessResponse } from "@/server/readiness";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";

type OverviewData = {
  summary: { unreadConversations: number; pendingHandoffs: number; activeWindows: number; agentEnabled: boolean };
  inboundTrend: { date: string; count: number }[];
  pipeline: { stageId: string; name: string; kind: "open" | "won" | "lost"; count: number }[];
  priorities: ConversationDto[];
  latestLab: { score: number; delta: number | null; redCount: number; finishedAt: string } | null;
};

export function OverviewDashboard({ data, readiness, userName, owner }: { data: OverviewData; readiness: ReadinessResponse | null; userName: string; owner: boolean }) {
  const firstPending = readiness?.steps.find((step) => step.status !== "complete");
  const maxTrend = Math.max(...data.inboundTrend.map((point) => point.count), 1);
  const maxPipeline = Math.max(...data.pipeline.map((stage) => stage.count), 1);
  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace)]">
      <header className="border-b bg-background px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-4">Principal / Inicio</p><h1 className="mt-1 text-lg font-[680]">Panel operativo</h1></div>
          <Badge variant={data.summary.agentEnabled ? "success" : "secondary"}>{data.summary.agentEnabled ? "Agente activo" : "Agente en pausa"}</Badge>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
        <section className="flex flex-col justify-between gap-4 rounded-lg border bg-background p-5 shadow-sm md:flex-row md:items-end">
          <div><p className="text-2xl font-[680] tracking-tight">Hola{userName ? `, ${userName.split(" ")[0]}` : ""}.</p><p className="mt-1 text-sm text-text-3">Esto es lo que necesita atención hoy.</p></div>
          {owner && firstPending && <Link href={firstPending.href} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#20242c] px-4 text-sm font-medium text-white">Continuar puesta en marcha <ArrowRight className="h-4 w-4" /></Link>}
        </section>

        {owner && readiness && (
          <section className="overflow-hidden rounded-lg border bg-background shadow-sm">
            <ModuleTitle title="Puesta en marcha" right={<span className="text-xs text-text-3">{readiness.steps.filter((step) => step.status === "complete").length}/{readiness.steps.length} pasos</span>} />
            <div className="grid gap-px bg-border md:grid-cols-3">
              {readiness.steps.map((step) => (
                <Link key={step.id} href={step.href} className="group flex min-h-24 gap-3 bg-background p-4 hover:bg-subtle">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${step.status === "complete" ? "border-success bg-success text-white" : "bg-secondary text-text-3"}`}>
                    {step.status === "complete" ? <Check className="h-3.5 w-3.5" /> : <span className="text-[10px]">•</span>}
                  </span>
                  <span><span className="block text-sm font-semibold">{step.label}</span><span className="mt-1 block text-xs leading-relaxed text-text-3">{step.detail}</span></span>
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t px-4 py-3 text-xs text-text-3">
              <span className="font-medium text-text-2">Recomendado</span>
              <Link href="/settings/branding" className="hover:text-foreground">{readiness.optional.brandingCustomized ? "✓ Marca personalizada" : "Personalizar marca"}</Link>
              <Link href="/settings/team" className="hover:text-foreground">{readiness.optional.teamMemberCount > 1 ? `✓ ${readiness.optional.teamMemberCount} personas en el equipo` : "Invitar al equipo"}</Link>
            </div>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Mensajes sin leer" value={data.summary.unreadConversations} icon={Inbox} href="/inbox" />
          <MetricCard label="Atención humana" value={data.summary.pendingHandoffs} icon={MessageSquareWarning} href="/inbox" warning={data.summary.pendingHandoffs > 0} />
          <MetricCard label="Ventanas activas" value={data.summary.activeWindows} icon={Clock3} href="/inbox" />
          <MetricCard label="Última evaluación" value={data.latestLab ? `${data.latestLab.score}/100` : "—"} icon={Sparkles} href={owner ? "/lab" : "/overview"} warning={Boolean(data.latestLab?.redCount)} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
            <ModuleTitle title="Mensajes entrantes" right={<span className="text-xs text-text-3">Últimos 7 días</span>} />
            <div className="flex h-64 items-end gap-2 p-5" role="img" aria-label="Mensajes entrantes durante los últimos siete días">
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
            <ModuleTitle title="Pipeline" right={<Link href="/pipeline" className="text-xs font-medium text-brand-text">Ver tablero</Link>} />
            <div className="space-y-4 p-5">
              {data.pipeline.map((stage) => <div key={stage.stageId}><div className="mb-1.5 flex justify-between text-xs"><span>{stage.name}</span><span className="font-semibold">{stage.count}</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-brand" style={{ width: `${(stage.count / maxPipeline) * 100}%` }} /></div></div>)}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-background shadow-sm">
          <ModuleTitle title="Prioridades" right={<Link href="/inbox" className="text-xs font-medium text-brand-text">Abrir bandeja</Link>} />
          {data.priorities.length ? <div className="divide-y">{data.priorities.map((conversation) => <Link key={conversation.id} href={`/inbox?conversation=${conversation.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle"><ContactAvatar name={conversation.contact.name} seed={conversation.contact.id} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{conversation.contact.name}</p><p className="truncate text-xs text-text-3">{conversation.preview ?? "Conversación pendiente"}</p></div>{conversation.handoffAt ? <Badge variant="warning">Atención humana</Badge> : <Badge variant="secondary">{conversation.unreadCount} sin leer</Badge>}<ArrowRight className="h-4 w-4 text-text-4" /></Link>)}</div> : <div className="flex flex-col items-center px-4 py-10 text-center"><Bot className="mb-2 h-6 w-6 text-success" /><p className="text-sm font-medium">Todo al día</p><p className="text-xs text-text-3">No hay conversaciones pendientes.</p></div>}
        </section>
      </main>
    </div>
  );
}

function ModuleTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="module-cap flex items-center justify-between border-b px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{right}</div>;
}

function MetricCard({ label, value, icon: Icon, href, warning = false }: { label: string; value: string | number; icon: typeof AlertCircle; href: string; warning?: boolean }) {
  return <Link href={href} className="overflow-hidden rounded-lg border bg-background shadow-sm transition-transform hover:-translate-y-0.5"><div className="module-cap flex items-center justify-between border-b px-4 py-2.5 text-xs font-medium text-text-2"><span>{label}</span><Icon className="h-4 w-4 text-text-3" /></div><div className="flex items-end justify-between p-4"><span className="text-3xl font-[680] tracking-tight">{value}</span><span className={`text-xs font-medium ${warning ? "text-warning" : "text-success"}`}>{warning ? "Revisar" : "Al día"}</span></div></Link>;
}
