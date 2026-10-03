import { and, count, desc, eq, inArray } from "drizzle-orm";
import { apiError, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { RunConflictError, startRun } from "@/server/lab/runner";
import { isAgentAvailableForOrganization } from "@/server/ai/credentials";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withOwner(async (session) => {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  // Cuántos casos graves tuvo cada corrida: un 83/100 con un caso en rojo NO
  // pasó, y el color del puntaje tiene que decirlo.
  const redRows = runs.length
    ? await db
        .select({ runId: schema.agentTestCase.runId, n: count() })
        .from(schema.agentTestCase)
        .where(
          and(
            eq(schema.agentTestCase.organizationId, session.organizationId),
            inArray(schema.agentTestCase.runId, runs.map((run) => run.id)),
            eq(schema.agentTestCase.veredicto, "rojo"),
          ),
        )
        .groupBy(schema.agentTestCase.runId)
    : [];
  const redByRun = new Map(redRows.map((row) => [row.runId, row.n]));

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      redCount: redByRun.get(run.id) ?? 0,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      delta:
        run.status === "done" && run.score !== null && prev?.score != null
          ? run.score - prev.score
          : null,
    };
  });
  return Response.json({
    runs: withDelta,
    aiConfigured: await isAgentAvailableForOrganization(session.organizationId),
  });
});

export const POST = withOwner(async (session) => {
  if (!(await isAgentAvailableForOrganization(session.organizationId))) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para correr el Laboratorio"
    );
  }
  try {
    const runId = await startRun(session.organizationId);
    return Response.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una corrida en curso; espera a que termine"
      );
    }
    throw err;
  }
});
