import { requireOwnerSession } from "@/lib/auth/session";
import { getAnalitica, isRango, type Rango } from "@/server/agencia/analitica";
import { AnalyticsClient } from "@/components/agencia/analytics-client";

export const dynamic = "force-dynamic";

const DEFAULT_RANGO: Rango = 7;

/**
 * Analítica: capa de agencia, pantalla propia (no toca `overview.ts`, que es
 * el tablero de puesta en marcha). Solo el propietario la ve — muestra
 * ingresos, igual que Agente y Laboratorio.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string }>;
}) {
  const session = await requireOwnerSession();
  const params = await searchParams;
  const parsed = Number(params.rango);
  const rango = isRango(parsed) ? parsed : DEFAULT_RANGO;
  const data = await getAnalitica(session.organizationId, rango);
  return <AnalyticsClient data={data} />;
}
