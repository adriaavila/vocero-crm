import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { missingReiConfigVars } from "@/lib/brand";
import { isAllokSaaSMode } from "@/lib/tenant-host";

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
  const saasMode = isAllokSaaSMode();
  if (saasMode) {
    const { startAgentWorker } = await import("@/server/ai/worker");
    startAgentWorker();
  }
  const missing = missingReiConfigVars(saasMode);
  if (missing.length > 0) {
    console.warn(
      `[boot] Rei SaaS sin configurar: falta(n) ${missing.join(", ")}. El sitio público cae a valores genéricos (demo, "[pendiente: ...]" en los legales) hasta que se definan.`
    );
  }
}
