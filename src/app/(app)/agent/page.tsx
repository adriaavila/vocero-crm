import { AgentClient } from "@/components/agent/agent-client";
import { requireOwnerSession } from "@/lib/auth/session";
import { brand } from "@/lib/brand";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { cerebroExternoLegadoSiempreOn } from "@/server/agencia/cerebro-externo";
import { getSetupProgress } from "@/server/agencia/setup-progress";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await requireOwnerSession();
  // Mismo ingrediente que `agentOn` en `server/agencia/estado.ts`: un cerebro
  // externo LEGADO (BOT_API_KEY sin despacho) contesta pase lo que pase con
  // el interruptor — el CRM no lo controla, escucha su propio webhook. Sin
  // esto, la línea de estado decía "Agente apagado" mientras ese bot seguía
  // respondiendo de verdad.
  const [externalBrainAlwaysOn, progress] = await Promise.all([
    cerebroExternoLegadoSiempreOn(session.organizationId),
    // El avance de la puesta en marcha llega ya resuelto: sin saltos al cargar.
    getSetupProgress(session.organizationId).catch(() => null),
  ]);
  return (
    <AgentClient
      saasMode={isAllokSaaSMode()}
      externalBrainAlwaysOn={externalBrainAlwaysOn}
      brandNameLower={brand().name}
      initialProgress={progress}
    />
  );
}
