import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Cifra } from "@/components/agencia/allok/cifra";
import { FunnelChart } from "@/components/agencia/allok/embudo";
import { StateDot } from "@/components/agencia/allok/mark";
import { fmtNumber } from "@/lib/centro";
import type { StageCount } from "@/lib/embudo";
import { cn } from "@/lib/utils";
import { PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from "@/lib/centro";
import type { CentroMetricas } from "@/server/agencia/centro-metricas";

/**
 * Inicio · «Cómo va»: cuatro cifras del periodo que se elige (Hoy, 7, 30 o 90
 * días, en la zona del negocio y en la URL: `?p=7d`). Un negocio sin un solo
 * mensaje no recibe ceros vestidos de dato: recibe una frase que dice qué
 * falta. Las cifras salen de lo mismo que Resultados.
 */

const ES_MONTH = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (iso: string) => ES_MONTH.format(new Date(`${iso}T12:00:00Z`)).replace(".", "");

export function MetricasSection({
  metricas,
  funnel,
  pro,
  owner,
  productLabel,
}: {
  metricas: CentroMetricas;
  funnel: StageCount[];
  /** Ventas (el embudo) es del plan Completo; sin él, la forma vacía y ninguna cifra. */
  pro: boolean;
  owner: boolean;
  productLabel: string;
}) {
  return (
    <section aria-labelledby="metricas-titulo" className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 id="metricas-titulo" className="kicker">
          Cómo va
        </h2>
        {metricas.hasActivity && <PeriodToggle active={metricas.period} />}
      </div>

      {metricas.hasActivity ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Tile label="Conversaciones" className="lg:col-start-1 lg:row-start-1">
            <ConversationsTile metricas={metricas} />
          </Tile>
          <div className="grid gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-start-2">
            <Tile label="Leads nuevos">
              <LeadsTile metricas={metricas} />
            </Tile>
            <Tile label={`Respondió ${productLabel}`}>
              <RepliesTile replies={metricas.replies} />
            </Tile>
          </div>
          <Tile label="Embudo" className="lg:col-start-2 lg:row-span-2 lg:row-start-1" aside={pro ? <TableroLink /> : undefined} flush>
            <FunnelTile funnel={funnel} pro={pro} owner={owner} />
          </Tile>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-lg border bg-background px-5 py-5">
          <StateDot state="pausado" size={10} decorative className="mt-1.5" />
          <p className="text-[14px] leading-relaxed text-text-2">
            Todavía no hay datos que contar. Cuando llegue el primer mensaje de un cliente, aquí ves cuántos escriben, cuántos son
            leads y quién les contesta.
          </p>
        </div>
      )}
    </section>
  );
}

function PeriodToggle({ active }: { active: PeriodKey }) {
  return (
    <nav aria-label="Periodo" className="inline-flex rounded-[10px] border bg-background p-0.5">
      {PERIOD_KEYS.map((key) => (
        <Link
          key={key}
          href={`/overview?p=${key}`}
          replace
          scroll={false}
          aria-current={key === active ? "true" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-[8px] px-3 text-[13px] font-medium transition-colors md:min-h-9 md:px-3.5",
            key === active ? "bg-foreground text-background" : "text-text-2 hover:text-foreground",
          )}
        >
          {PERIOD_LABEL[key]}
        </Link>
      ))}
    </nav>
  );
}

function Tile({
  label,
  aside,
  children,
  className,
  flush = false,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** El contenido llega hasta el borde (el embudo dibuja con su propio aire). */
  flush?: boolean;
}) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border bg-background", className)}>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h3 className="kicker">{label}</h3>
        {aside}
      </div>
      <div className={cn("flex flex-1 flex-col", flush ? "pt-1" : "px-5 pb-5 pt-3")}>{children}</div>
    </div>
  );
}

const BigNumber = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-baseline gap-2 text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums">{children}</p>
);

function ConversationsTile({ metricas }: { metricas: CentroMetricas }) {
  const { total, series } = metricas.conversations;
  if (total === 0) {
    return <p className="text-[14px] leading-relaxed text-text-2">Nadie escribió {metricas.period === "hoy" ? "hoy" : "en este periodo"}.</p>;
  }
  const hourly = metricas.granularity === "hour";
  const max = Math.max(...series.map((p) => p.count), 1);
  const first = series[0]?.label ?? "";
  const last = series.at(-1)?.label ?? "";
  const summary = hourly
    ? `Conversaciones por hora: ${series.filter((p) => p.count > 0).map((p) => `${p.label} h ${p.count}`).join(", ")}`
    : `Conversaciones por día: ${series.length} días, ${total} en total`;
  return (
    <>
      <BigNumber>
        <Cifra value={fmtNumber(total)} />
        <span className="text-[14px] font-medium tracking-normal text-text-3">con mensajes del cliente</span>
      </BigNumber>
      <div role="img" aria-label={summary} className="mt-5 flex h-14 items-end gap-[2px]">
        {series.map((p, i) => (
          <span
            key={p.label}
            title={hourly ? `${p.label} h: ${p.count}` : `${dayLabel(p.label)}: ${p.count}`}
            className={cn("ak-grow-y min-w-[2px] flex-1 rounded-[2px]", p.label === metricas.current ? "bg-foreground" : p.count > 0 ? "bg-[var(--ground-4)]" : "bg-[var(--ground-3)]")}
            style={{ height: `${Math.max(p.count > 0 ? 10 : 4, (p.count / max) * 100)}%`, "--i": Math.min(i, 20) } as React.CSSProperties}
          />
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-between font-mono text-[10.5px] text-text-3">
        <span>{hourly ? `${first} h` : dayLabel(first)}</span>
        {hourly && <span>12 h</span>}
        <span>{hourly ? `${last} h` : "hoy"}</span>
      </div>
    </>
  );
}

function LeadsTile({ metricas }: { metricas: CentroMetricas }) {
  const n = metricas.leads.total;
  return n === 0 ? (
    <p className="text-[14px] leading-relaxed text-text-2">Sin leads nuevos {metricas.period === "hoy" ? "hoy" : "en este periodo"}.</p>
  ) : (
    <>
      <BigNumber>
        <Cifra value={fmtNumber(n)} />
      </BigNumber>
      <p className="mt-2 text-[13px] text-text-3">{n === 1 ? "persona nueva" : "personas nuevas"} en tu embudo</p>
    </>
  );
}

function RepliesTile({ replies }: { replies: CentroMetricas["replies"] }) {
  const total = replies.ai + replies.owner;
  if (total === 0) return <p className="text-[14px] leading-relaxed text-text-2">Todavía no hay respuestas en este periodo.</p>;
  const pct = (replies.ai / total) * 100;
  return (
    <>
      <BigNumber>
        <Cifra value={pct > 0 && pct < 1 ? "<1" : Math.round(pct)} />
        <span className="text-[18px] font-semibold tracking-normal text-text-3">%</span>
      </BigNumber>
      <div
        role="img"
        aria-label={`Respondió la IA ${fmtNumber(replies.ai)} y respondiste tú ${fmtNumber(replies.owner)}`}
        className="mt-4 flex h-2 overflow-hidden rounded-full bg-[var(--ground-3)]"
      >
        <span data-state="activo" className="ak-grow-x block h-full bg-[var(--st)]" style={{ width: `${pct}%`, transformOrigin: "0 50%" }} />
        <span className="block h-full flex-1 bg-foreground" />
      </div>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] tabular-nums">
        <StateDot state="activo" size={7} decorative />
        <span>IA {fmtNumber(replies.ai)}</span>
        <span aria-hidden className="text-text-4">
          ·
        </span>
        <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-foreground" />
        <span>tú {fmtNumber(replies.owner)}</span>
      </p>
    </>
  );
}

function TableroLink() {
  return (
    <Link href="/pipeline" className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-medium text-text-2 hover:text-foreground md:min-h-0">
      Ver tablero <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** Las etapas de siempre, para dibujar la forma del embudo cuando todavía no hay tablero. */
const GHOST_STAGES: StageCount[] = ["Nuevo", "En conversación", "Interesado", "Cliente"].map((name, i, all) => ({
  id: name,
  name,
  kind: i === all.length - 1 ? ("won" as const) : ("open" as const),
  count: 0,
}));

function FunnelTile({ funnel, pro, owner }: { funnel: StageCount[]; pro: boolean; owner: boolean }) {
  if (!pro) {
    return (
      <>
        <FunnelChart stages={GHOST_STAGES} ghost />
        <div className="px-5 pb-5 pt-4">
          <p className="text-[14px] leading-relaxed text-text-2">
            Con Completo cada conversación entra a un tablero de ventas, el agente agenda citas y tu equipo atiende desde la misma bandeja.
          </p>
          {owner && (
            <Link
              href="/settings/billing"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-border-strong px-4 text-sm font-semibold transition-[border-color,transform] hover:border-foreground active:scale-[0.97]"
            >
              Ver planes <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </>
    );
  }
  const total = funnel.reduce((n, s) => n + s.count, 0);
  return (
    <>
      <FunnelChart stages={funnel} />
      {total === 0 && <p className="px-5 pb-5 pt-1 text-[14px] leading-relaxed text-text-2">Cuando llegue el primer lead, lo ves bajar por el embudo.</p>}
    </>
  );
}
