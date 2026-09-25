import { AgentClient } from "@/components/agent/agent-client";
import { requireOwnerSession } from "@/lib/auth/session";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { cerebroExternoLegadoSiempreOn } from "@/server/agencia/cerebro-externo";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await requireOwnerSession();
  // Mismo ingrediente que `agentOn` en `server/agencia/estado.ts`: un cerebro
  // externo LEGADO (BOT_API_KEY sin despacho) contesta pase lo que pase con
  // el interruptor — el CRM no lo controla, escucha su propio webhook. Sin
  // esto, la línea de estado decía "Agente apagado" mientras ese bot seguía
  // respondiendo de verdad.
  const externalBrainAlwaysOn = await cerebroExternoLegadoSiempreOn(session.organizationId);
  return (
    <AgentClient saasMode={isAllokSaaSMode()} externalBrainAlwaysOn={externalBrainAlwaysOn} />
  );
}
