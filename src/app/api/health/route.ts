import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb, getSql } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { APP_VERSION, resolveBuildCommit } from "@/lib/version";
import { isAllokSaaSMode, isKnownAllokHost, tenantSlugFromHost } from "@/lib/tenant-host";
import { resolveOrganizationIdForHost } from "@/server/auth/on-signup";

export const dynamic = "force-dynamic";

/** Job `needs_review` sin resolver en la última hora: el worker contestó mal
 * y nadie lo ha visto todavía. */
const NEEDS_REVIEW_WINDOW_MS = 60 * 60 * 1000;
/** Job `queued` listo desde hace más de 5 minutos: el worker no lo está
 * recogiendo (caído, atorado o sin réplicas). */
const STALE_QUEUED_WINDOW_MS = 5 * 60 * 1000;
/** Cuánto se espera por la consulta antes de rendirse. Es una señal extra
 * para monitoreo, no el propio healthcheck: nunca debe ser lo que lo cuelgue. */
const AGENT_QUEUE_QUERY_TIMEOUT_MS = 750;

type AgentQueueRow = { needsReview: boolean; staleQueued: boolean };

/**
 * Comparte una sola consulta en vuelo por proceso: si algo golpea
 * `/api/health` varias veces seguidas (el propio healthcheck de Coolify, un
 * monitor externo), no hace falta que cada petición dispare su propia ida a
 * `agent_job` — se resuelven todas con la misma.
 */
let inFlightCheck: Promise<"ok" | "degraded" | "n/a"> | null = null;

/**
 * Salud del worker del agente, para monitoreo — nunca para decidir si esta
 * instancia responde. Solo existe en modo SaaS (única variante donde el
 * worker in-process corre de verdad); en Vocero self-hosted la respuesta es
 * `"n/a"` sin tocar la base.
 *
 * Una sola consulta (dos `exists()` en la misma ida a la base), no dos: cada
 * consulta abierta sostiene una conexión del pool, y este chequeo corre en
 * cada healthcheck. El de "queued viejo" sí usa `agent_job_claim_idx`
 * (status, available_at, locked_at) de punta a punta —igualdad en `status`,
 * rango en `available_at`—, igual que `claimNextJob`. El de "needs_review
 * reciente" solo aprovecha `status` (la columna líder del mismo índice) para
 * descartar el resto de la tabla; `updated_at` se filtra fila por fila
 * DESPUÉS de eso, sin índice propio. Barato hoy porque `needs_review` es un
 * estado raro (algo que el worker no logró resolver solo), no porque haya un
 * índice pensado para él — si ese estado deja de ser raro, esto necesita el
 * suyo.
 *
 * La consulta corre por `getSql()` (el cliente `postgres` crudo, no el
 * `.execute()` de drizzle) y se CANCELA de verdad si tarda: un `Promise.race`
 * contra un timeout solo deja de ESPERARLA, pero la consulta sigue viva en el
 * servidor sosteniendo su conexión hasta que termine sola. Bajo un lock largo
 * sobre `agent_job`, unos pocos healthchecks así bastan para agotar el pool
 * (`max: 10`) y colgar hasta el `select 1` de esta misma ruta — reproducido
 * en revisión. `query.cancel()` manda un cancel real a Postgres y libera la
 * conexión de inmediato; cualquier error o cancelación reporta `"degraded"`
 * en vez de un `"ok"` falso.
 */
async function agentQueueStatus(): Promise<"ok" | "degraded" | "n/a"> {
  if (!isAllokSaaSMode()) return "n/a";
  if (inFlightCheck) return inFlightCheck;

  inFlightCheck = runAgentQueueCheck().finally(() => {
    inFlightCheck = null;
  });
  return inFlightCheck;
}

async function runAgentQueueCheck(): Promise<"ok" | "degraded"> {
  const needsReviewCutoff = new Date(Date.now() - NEEDS_REVIEW_WINDOW_MS).toISOString();
  const staleQueuedCutoff = new Date(Date.now() - STALE_QUEUED_WINDOW_MS).toISOString();

  const client = getSql();
  const query = client<AgentQueueRow[]>`
    select
      exists(
        select 1 from agent_job
        where status = 'needs_review' and updated_at >= ${needsReviewCutoff}::timestamp
      ) as "needsReview",
      exists(
        select 1 from agent_job
        where status = 'queued' and available_at <= ${staleQueuedCutoff}::timestamp
      ) as "staleQueued"
  `;

  const timer = setTimeout(() => {
    void query.cancel();
  }, AGENT_QUEUE_QUERY_TIMEOUT_MS);

  try {
    const rows = await query;
    const row = rows[0];
    return row?.needsReview || row?.staleQueued ? "degraded" : "ok";
  } catch {
    return "degraded";
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (isAllokSaaSMode()) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!isKnownAllokHost(host)) return Response.json({ error: "not_found" }, { status: 404 });
    const tenantSlug = tenantSlugFromHost(host);
    if (tenantSlug && !(await resolveOrganizationIdForHost(host))) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
  }
  // Una instancia de producción sin META_APP_SECRET acepta webhooks que no
  // puede verificar. En el modelo de agencia eso se despliega y se entrega sin
  // que nadie lo note, así que la instancia se declara NO saludable: el
  // healthcheck de la plataforma frena el despliegue en vez de dejar corriendo
  // una recepción abierta.
  const env = getEnv();
  if (env.NODE_ENV === "production" && !env.META_APP_SECRET) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "webhook_unconfigured",
          message: "Recepción de WhatsApp no configurada",
        },
      },
      { status: 503 }
    );
  }

  try {
    await getDb().execute(sql`select 1`);
    // La versión viaja aquí a propósito: confirmar un despliegue tiene que
    // poder hacerse con un `curl`, desde un script o desde la plataforma de
    // hosting, sin abrir la app ni iniciar sesión. Es la única forma de que un
    // pipeline pueda comprobar que el build que subió es el que corre.
    const commit = resolveBuildCommit();
    // `agentQueue` es una señal ADICIONAL, no parte del veredicto: un worker
    // atascado no debe tumbar el healthcheck de toda la instancia, que es lo
    // único que decide si Coolify sigue sirviendo tráfico.
    const agentQueue = await agentQueueStatus();
    return Response.json({
      ok: true,
      version: APP_VERSION,
      ...(commit ? { commit } : {}),
      agentQueue,
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
