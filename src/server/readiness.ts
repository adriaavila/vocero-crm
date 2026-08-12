import { and, count, desc, eq, max } from "drizzle-orm";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAgentConfigured, isWahaConfigured } from "@/lib/env";
import { getBranding } from "@/server/branding";

export type ReadinessStepId =
  | "whatsapp"
  | "ai_provider"
  | "agent_profile"
  | "knowledge"
  | "simulation"
  | "live_test";
export type ReadinessStepStatus = "complete" | "pending" | "stale" | "unavailable";
export type ReadinessStep = {
  id: ReadinessStepId;
  status: ReadinessStepStatus;
  label: string;
  detail: string;
  href: string;
};
export type ReadinessResponse = {
  overall: "ready" | "needs_attention";
  agentEnabled: boolean;
  steps: ReadinessStep[];
  latestLab: { score: number; redCount: number; finishedAt: string } | null;
  optional: { brandingCustomized: boolean; teamMemberCount: number };
};

type Input = {
  profile: typeof schema.agentProfile.$inferSelect;
  whatsappConnected: boolean;
  aiConfigured: boolean;
  liveTestAvailable: boolean;
  knowledgeCount: number;
  knowledgeUpdatedAt: Date | null;
  latestRun: typeof schema.agentTestRun.$inferSelect | null;
  redCount: number;
  brandingCustomized: boolean;
  teamMemberCount: number;
};

export function evaluateReadiness(input: Input): ReadinessResponse {
  const { profile, latestRun } = input;
  const contentUpdatedAt = input.knowledgeUpdatedAt && input.knowledgeUpdatedAt > profile.updatedAt
    ? input.knowledgeUpdatedAt
    : profile.updatedAt;
  const profileComplete = [
    profile.name,
    profile.tone,
    profile.greeting,
    profile.instructions,
    profile.escalationRules,
  ].every((value) => Boolean(value?.trim()));

  let simulationStatus: ReadinessStepStatus = "pending";
  if (latestRun?.finishedAt && latestRun.score !== null) {
    simulationStatus = latestRun.finishedAt < contentUpdatedAt
      ? "stale"
      : latestRun.score >= 80 && input.redCount === 0
        ? "complete"
        : "pending";
  }

  let liveStatus: ReadinessStepStatus = input.liveTestAvailable ? "pending" : "unavailable";
  if (input.liveTestAvailable && profile.lastLiveTestAt) {
    const currentAfter = latestRun?.finishedAt ?? contentUpdatedAt;
    liveStatus = simulationStatus !== "complete" || profile.lastLiveTestAt < currentAfter
      ? "stale"
      : profile.lastLiveTestPassed
        ? "complete"
        : "pending";
  }

  const steps: ReadinessStep[] = [
    {
      id: "whatsapp",
      status: input.whatsappConnected ? "complete" : "pending",
      label: "Conecta WhatsApp",
      detail: input.whatsappConnected ? "Número conectado y vigente." : "Conecta el número que atenderá a tus clientes.",
      href: "/settings/whatsapp",
    },
    {
      id: "ai_provider",
      status: input.aiConfigured ? "complete" : "unavailable",
      label: "Habilita el servicio de IA",
      detail: input.aiConfigured ? "Proveedor de IA disponible." : "Contacta a quien administra tu instancia.",
      href: "/agent",
    },
    {
      id: "agent_profile",
      status: profileComplete ? "complete" : "pending",
      label: "Define cómo atiende tu agente",
      detail: profileComplete ? "Comportamiento completo." : "Completa nombre, tono, saludo, instrucciones y escalado.",
      href: "/agent",
    },
    {
      id: "knowledge",
      status: input.knowledgeCount > 0 ? "complete" : "pending",
      label: "Añade información del negocio",
      detail: input.knowledgeCount > 0 ? `${input.knowledgeCount} entrada(s) disponible(s).` : "Enseña productos, horarios y políticas.",
      href: "/agent",
    },
    {
      id: "simulation",
      status: simulationStatus,
      label: "Prueba tu agente",
      detail: simulationStatus === "complete"
        ? `${latestRun!.score}/100 y sin hallazgos críticos.`
        : simulationStatus === "stale"
          ? "El agente cambió desde la última evaluación. Vuelve a probarlo."
          : "Necesitas 80/100 o más y cero casos rojos.",
      href: "/lab",
    },
    {
      id: "live_test",
      status: liveStatus,
      label: "Haz una prueba real",
      detail: liveStatus === "complete"
        ? "Respuesta real verificada de extremo a extremo."
        : liveStatus === "stale"
          ? "La configuración cambió desde la última prueba real."
          : liveStatus === "unavailable"
            ? "La prueba real no está habilitada en esta instancia."
            : "Comprueba la experiencia desde un WhatsApp real.",
      href: "/lab?mode=live",
    },
  ];

  return {
    overall: steps.every((step) => step.status === "complete") ? "ready" : "needs_attention",
    agentEnabled: profile.enabled,
    steps,
    latestLab: latestRun?.finishedAt && latestRun.score !== null
      ? { score: latestRun.score, redCount: input.redCount, finishedAt: latestRun.finishedAt.toISOString() }
      : null,
    optional: {
      brandingCustomized: input.brandingCustomized,
      teamMemberCount: input.teamMemberCount,
    },
  };
}

export async function getReadiness(organizationId: string): Promise<ReadinessResponse> {
  const db = getDb();
  const [profiles, credentials, knowledge, runs, members, branding] = await Promise.all([
    db.select().from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId)).limit(1),
    db.select({ status: schema.metaCredentials.status }).from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId)).limit(1),
    db.select({ count: count(), updatedAt: max(schema.kbEntry.updatedAt) }).from(schema.kbEntry)
      .where(scoped(schema.kbEntry.organizationId, organizationId)),
    db.select().from(schema.agentTestRun)
      .where(and(eq(schema.agentTestRun.organizationId, organizationId), eq(schema.agentTestRun.status, "done")))
      .orderBy(desc(schema.agentTestRun.finishedAt)).limit(1),
    db.select({ count: count() }).from(schema.member)
      .where(eq(schema.member.organizationId, organizationId)),
    getBranding(organizationId),
  ]);
  const profile = profiles[0];
  if (!profile) throw new Error("Perfil del agente no encontrado");
  const latestRun = runs[0] ?? null;
  const redRows = latestRun
    ? await db.select({ count: count() }).from(schema.agentTestCase).where(and(
        eq(schema.agentTestCase.organizationId, organizationId),
        eq(schema.agentTestCase.runId, latestRun.id),
        eq(schema.agentTestCase.veredicto, "rojo")
      ))
    : [{ count: 0 }];
  return evaluateReadiness({
    profile,
    whatsappConnected: credentials[0]?.status === "connected",
    aiConfigured: isAgentConfigured(),
    liveTestAvailable: isWahaConfigured(),
    knowledgeCount: knowledge[0]?.count ?? 0,
    knowledgeUpdatedAt: knowledge[0]?.updatedAt ?? null,
    latestRun,
    redCount: redRows[0]?.count ?? 0,
    brandingCustomized: branding.name !== DEFAULT_BRANDING.name || branding.accent !== DEFAULT_BRANDING.accent,
    teamMemberCount: members[0]?.count ?? 0,
  });
}
