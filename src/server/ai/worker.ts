import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { applyHandoff, runAgentTurn, scheduleAgentTurn } from "@/server/ai/pipeline";

const POLL_MS = 1_000;
const STALE_AFTER_MS = 10 * 60_000;

const globalForWorker = globalThis as unknown as {
  __voceroAgentWorker?: { started: boolean; id: string };
};

function workerState() {
  if (!globalForWorker.__voceroAgentWorker) {
    globalForWorker.__voceroAgentWorker = {
      started: false,
      id: `agent-worker-${process.pid}-${crypto.randomUUID()}`,
    };
  }
  return globalForWorker.__voceroAgentWorker;
}

/** Arranca una sola vez por proceso; Coolify mantiene este proceso vivo. */
export function startAgentWorker(): void {
  if (!isAllokSaaSMode() || process.env.NEXT_PHASE === "phase-production-build") return;
  const state = workerState();
  if (state.started) return;
  state.started = true;
  void poll(state.id);
}

/** La inserción de un trabajo despierta el worker sin crear otro intervalo. */
export function kickAgentWorker(): void {
  startAgentWorker();
}

async function poll(workerId: string): Promise<void> {
  try {
    await markStaleJobs();
    const job = await claimNextJob(workerId);
    if (job) await processJob(job, workerId);
  } catch (error) {
    console.error("[agent-worker] poll falló:", error);
  }

  const timer = setTimeout(() => void poll(workerId), POLL_MS);
  timer.unref?.();
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
    returning id, conversation_id as "conversationId", locked_at as "lockedAt"
  `);
  return (rows[0] as {
    id: string;
    conversationId: string;
    lockedAt: Date | null;
  } | undefined) ?? null;
}

async function processJob(
  job: { id: string; conversationId: string; lockedAt: Date | null },
  workerId: string,
): Promise<void> {
  const claimedAt = job.lockedAt ?? new Date();
  try {
    await runAgentTurn(job.conversationId);
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
