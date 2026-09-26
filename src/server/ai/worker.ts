import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { applyHandoff, runAgentTurn, scheduleAgentTurn } from "@/server/ai/pipeline";

const POLL_MS = 1_000;
const STALE_AFTER_MS = 10 * 60_000;
const DEFAULT_CONCURRENCY = 4;

type WorkerState = { started: boolean; id: string; inFlight: number };

const globalForWorker = globalThis as unknown as {
  __voceroAgentWorker?: WorkerState;
};

function workerState(): WorkerState {
  if (!globalForWorker.__voceroAgentWorker) {
    globalForWorker.__voceroAgentWorker = {
      started: false,
      id: `agent-worker-${process.pid}-${crypto.randomUUID()}`,
      inFlight: 0,
    };
  }
  return globalForWorker.__voceroAgentWorker;
}

/** Solo para tests: limpia el estado global del worker (cupo, id, arranque). */
export function resetWorkerStateForTests(): void {
  globalForWorker.__voceroAgentWorker = undefined;
}

function workerConcurrency(): number {
  const raw = Number(process.env.AGENT_WORKER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
}

/** Arranca una sola vez por proceso; Coolify mantiene este proceso vivo. */
export function startAgentWorker(): void {
  if (!isAllokSaaSMode() || process.env.NEXT_PHASE === "phase-production-build") return;
  const state = workerState();
  if (state.started) return;
  state.started = true;
  void poll(state);
}

/** La inserción de un trabajo despierta el worker sin crear otro intervalo. */
export function kickAgentWorker(): void {
  startAgentWorker();
}

async function poll(state: WorkerState): Promise<void> {
  try {
    await markStaleJobs();
    await claimUpToCapacity(state);
  } catch (error) {
    console.error("[agent-worker] poll falló:", error);
  }

  const timer = setTimeout(() => void poll(state), POLL_MS);
  timer.unref?.();
}

/**
 * Reclama trabajos hasta llenar el cupo (`AGENT_WORKER_CONCURRENCY`, default
 * 4) SIN esperar a que terminen los que ya están en vuelo — cada uno corre su
 * propio turno en paralelo. El claim ya usa `FOR UPDATE SKIP LOCKED` y hay un
 * índice único de trabajo activo por conversación (`claimNextJob`), así que
 * varios cupos del mismo proceso nunca chocan por el mismo trabajo.
 *
 * Antes, un solo turno lento (un despacho a Nea colgado, o simplemente
 * tardado) bloqueaba a TODOS los demás negocios: `poll` esperaba a que ese
 * turno terminara — `await processJob(...)` — antes de reclamar el
 * siguiente, y el reintento solo se reprogramaba DESPUÉS de esa espera.
 */
export async function claimUpToCapacity(state: WorkerState = workerState()): Promise<void> {
  const capacity = workerConcurrency() - state.inFlight;
  for (let i = 0; i < capacity; i++) {
    const job = await claimNextJob(state.id);
    if (!job) break;
    state.inFlight++;
    // `processJob` ya atrapa el fallo del turno y lo convierte en
    // `needs_review`, pero su PROPIA limpieza (el `update`/`applyHandoff` del
    // catch) puede fallar a su vez — sin este `.catch`, eso se escapa como
    // una promesa rechazada sin nadie que la maneje.
    void processJob(job, state.id)
      .catch((error) => {
        console.error(`[agent-worker] limpieza del trabajo ${job.id} falló:`, error);
      })
      .finally(() => {
        state.inFlight--;
      });
  }
}

async function markStaleJobs(): Promise<void> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const db = getDb();
  const stale = await db
    .update(schema.agentJob)
    .set({
      status: "needs_review",
      lockedAt: null,
      lockedBy: null,
      lastError: "El trabajo quedó interrumpido; no se reintentó para evitar un envío duplicado.",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.agentJob.status, "running"),
        lt(schema.agentJob.lockedAt, staleBefore),
      )
    )
    .returning({
      id: schema.agentJob.id,
      conversationId: schema.agentJob.conversationId,
      organizationId: schema.agentJob.organizationId,
    });
  if (stale.length) {
    console.warn(`[agent-worker] ${stale.length} trabajo(s) requieren revisión`);
    await Promise.allSettled(
      stale.map((job) => applyHandoff(job.conversationId, job.organizationId, "error"))
    );
  }
}

export async function claimNextJob(workerId: string) {
  const now = new Date();
  const timestamp = now.toISOString();
  // El CTE bloquea y toma un solo trabajo aun con varios procesos Coolify.
  // ponytail: una fila por poll; si el volumen exige más throughput, aumentar
  // el número de workers antes de convertirlo en un batch.
  const rows = await getDb().execute(sql`
    with next_job as (
      select id
      from agent_job
      where status = 'queued' and available_at <= ${timestamp}::timestamp
      order by available_at asc, created_at asc
      for update skip locked
      limit 1
    )
    update agent_job
    set status = 'running',
        locked_at = ${timestamp}::timestamp,
        locked_by = ${workerId},
        attempts = attempts + 1,
        updated_at = ${timestamp}::timestamp
    where id in (select id from next_job)
    returning id, conversation_id as "conversationId"
  `);
  const row = rows[0] as { id: string; conversationId: string } | undefined;
  // `locked_at` volvería como TEXTO: el SQL crudo no pasa por el mapeo de
  // drizzle. Ese texto terminaba en `gt(message.createdAt, claimedAt)`, que
  // llama `.toISOString()` y reventaba DESPUÉS de cada turno. Se devuelve el
  // mismo instante que se escribió, ya como Date.
  return row ? { id: row.id, conversationId: row.conversationId, lockedAt: now } : null;
}

async function processJob(
  job: { id: string; conversationId: string; lockedAt: Date | null },
  workerId: string,
): Promise<void> {
  const claimedAt = job.lockedAt ?? new Date();
  try {
    await runAgentTurn(job.conversationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await getDb()
      .update(schema.agentJob)
      .set({
        status: "needs_review",
        lockedAt: null,
        lockedBy: null,
        lastError: message,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.agentJob.id, job.id), eq(schema.agentJob.lockedBy, workerId)));
    const organizationId = await organizationForJob(job.id).catch(() => null);
    if (organizationId) {
      await applyHandoff(job.conversationId, organizationId, "error").catch(() => {});
    }
    console.error(`[agent-worker] trabajo ${job.id} requiere revisión:`, error);
    return;
  }

  // Lo que sigue es contabilidad del worker, no el turno: si falla, se anota y
  // se sigue, pero NUNCA le pausa la conversación al negocio. (Antes vivía en
  // el mismo try que el turno, y un error aquí terminaba en handoff "error"
  // aunque el agente hubiera contestado bien.)
  try {
    await getDb()
      .update(schema.agentJob)
      .set({ status: "done", lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(and(eq(schema.agentJob.id, job.id), eq(schema.agentJob.lockedBy, workerId)));

    const freshInbound = await getDb()
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, job.conversationId),
          eq(schema.message.direction, "in"),
          gt(schema.message.createdAt, claimedAt),
        )
      )
      .limit(1);
    if (freshInbound[0]) await scheduleAgentTurn(job.conversationId);
  } catch (error) {
    console.error(`[agent-worker] cierre del trabajo ${job.id} falló (el turno sí corrió):`, error);
  }
}

async function organizationForJob(jobId: string): Promise<string> {
  const rows = await getDb()
    .select({ organizationId: schema.agentJob.organizationId })
    .from(schema.agentJob)
    .where(eq(schema.agentJob.id, jobId))
    .limit(1);
  return rows[0]?.organizationId ?? "";
}
