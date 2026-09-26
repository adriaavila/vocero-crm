import { and, eq, gte, lte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb, schema } from "@/lib/db";
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("agent_queue_check_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Salud del worker del agente, para monitoreo — nunca para decidir si esta
 * instancia responde. Solo existe en modo SaaS (única variante donde el
 * worker in-process corre de verdad); en Vocero self-hosted la respuesta es
 * `"n/a"` sin tocar la base.
 *
 * Ambas consultas reusan `agent_job_claim_idx` (status, available_at,
 * locked_at) — el mismo índice que usa `claimNextJob` — así que son tan
 * baratas como esa: igualdad en `status`, rango en la segunda, `limit(1)`
 * para no contar más de lo necesario. El endpoint es público: solo sale el
 * enum, nunca ids, conteos ni datos de la organización.
 */
async function agentQueueStatus(): Promise<"ok" | "degraded" | "n/a"> {
  if (!isAllokSaaSMode()) return "n/a";

  try {
    const db = getDb();
    const needsReviewCutoff = new Date(Date.now() - NEEDS_REVIEW_WINDOW_MS);
    const staleQueuedCutoff = new Date(Date.now() - STALE_QUEUED_WINDOW_MS);

    const [needsReview, staleQueued] = await withTimeout(
      Promise.all([
        db
          .select({ id: schema.agentJob.id })
          .from(schema.agentJob)
          .where(
            and(
              eq(schema.agentJob.status, "needs_review"),
              gte(schema.agentJob.updatedAt, needsReviewCutoff)
            )
          )
          .limit(1),
        db
          .select({ id: schema.agentJob.id })
          .from(schema.agentJob)
          .where(
            and(
              eq(schema.agentJob.status, "queued"),
              lte(schema.agentJob.availableAt, staleQueuedCutoff)
            )
          )
          .limit(1),
      ]),
      AGENT_QUEUE_QUERY_TIMEOUT_MS
    );

    return needsReview.length > 0 || staleQueued.length > 0 ? "degraded" : "ok";
  } catch {
    // Sin poder consultarlo (timeout o error de BD) no se afirma "ok": mejor
    // una señal de más en monitoreo que un verde falso.
    return "degraded";
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
