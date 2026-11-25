import { and, count, desc, eq, max } from "drizzle-orm";
import { brand } from "@/lib/brand";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWahaConfigured } from "@/lib/env";
import { getBranding } from "@/server/branding";
import { pasoAgenda, type PasoAgenda } from "@/server/agencia/readiness-agenda";
import { businessHoursFromProfile, hasConfiguredBusinessHours } from "@/server/business-hours";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { isAgentAvailableForOrganization } from "@/server/ai/credentials";
import { looksGood } from "@/lib/probar";
import { hasEverActivated } from "@/server/agencia/activado";

export type ReadinessStepId =
  | "whatsapp"
  | "business_hours"
  | "ai_provider"
  | "agent_profile"
  | "knowledge"
  | "simulation"
  | "live_test"
  // Capa de agencia: solo aparece con la bandera AGENDA encendida.
  | "agenda";
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
  /** Ya encendió al agente alguna vez (ver `lib/activado`): la puesta en marcha es solo para quien no. */
  everActivated: boolean;
  steps: ReadinessStep[];
  latestLab: { score: number; redCount: number; finishedAt: string } | null;
  optional: { brandingCustomized: boolean; teamMemberCount: number };
};

const SAAS_ACTIVATION_STEP_IDS = new Set<ReadinessStepId>([
  "whatsapp",
  "business_hours",
  "agent_profile",
  "knowledge",
  "simulation",
]);

export function saasActivationBlockers(readiness: ReadinessResponse): ReadinessStep[] {
  return readiness.steps.filter(
    (step) => SAAS_ACTIVATION_STEP_IDS.has(step.id) && step.status !== "complete",
  );
}

type Input = {
  profile: {
    enabled: boolean;
    name: string;
    tone: string | null;
    greeting: string | null;
    instructions: string | null;
    escalationRules: string | null;
    lastLiveTestAt: Date | null;
    lastLiveTestPassed: boolean | null;
    updatedAt: Date;
    businessHours?: unknown;
    businessTimezone?: string;
    responseMode?: string;
  };
  whatsappConnected: boolean;
  /** `reconnect_required` cuando el token murió: hay conexión, pero no sirve. */
  whatsappStatus?: "connected" | "reconnect_required" | null;
  aiConfigured: boolean;
  liveTestAvailable: boolean;
  knowledgeCount: number;
  knowledgeUpdatedAt: Date | null;
  latestRun: typeof schema.agentTestRun.$inferSelect | null;
  redCount: number;
  brandingCustomized: boolean;
  teamMemberCount: number;
  businessHoursConfigured?: boolean;
  saasMode?: boolean;
  /** Capa de agencia: el paso de la agenda, o null si esta instancia no agenda. */
  agendaStep: PasoAgenda | null;
  /** Ya encendió al agente alguna vez; sin dato, solo cuenta que esté encendido ahora. */
  everActivated?: boolean;
};

export function evaluateReadiness(input: Input): ReadinessResponse {
  const { profile, latestRun } = input;
  // `profile.updatedAt` es la versión del CONTENIDO del agente (solo se mueve
  // si cambia lo que dice, ver `server/agencia/contenido-perfil.ts`): pausar o
  // encender no vuelve vieja la prueba.
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
    // SaaS: el dueño decide cuándo le gusta cómo responde su agente; basta con
    // haber probado DESPUÉS del último cambio, sea cual sea el puntaje (el
    // puntaje y los casos rojos son consejo, `looksGood` en `lib/probar`).
    // Instancias dedicadas: la regla de siempre, 80 y ningún caso rojo.
    // Frescura por el INICIO de la corrida: una que seguía corriendo mientras
    // el dueño editaba probó el contenido anterior.
    simulationStatus = latestRun.startedAt < contentUpdatedAt
      ? "stale"
      : input.saasMode || looksGood(latestRun.score, input.redCount)
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
      // Un token revocado deja la conexión guardada pero muerta. Decir
      // "conecta tu número" ahí le oculta que ya hizo el alta y que lo que
      // falta es volver a autorizarla. Sin jerga: el dueño no sabe qué es un
      // token, solo que su WhatsApp dejó de funcionar.
      detail: input.whatsappConnected
        ? "Número conectado y vigente."
        : input.whatsappStatus === "reconnect_required"
          ? "La conexión con tu WhatsApp venció: los envíos están pausados hasta que la reconectes."
          : "Conecta el número que atenderá a tus clientes.",
      href: "/settings/whatsapp",
    },
    ...(input.saasMode
      ? [{
          id: "business_hours" as const,
          status: input.businessHoursConfigured ? "complete" as const : "pending" as const,
          label: "Define el horario de respuesta",
          detail: input.businessHoursConfigured
            ? `${brand().Name} sabe cuándo responder por ti.`
            : "Elige los días, las horas y la zona horaria del negocio.",
          href: "/agent",
        }]
      : []),
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
        ? looksGood(latestRun!.score, input.redCount)
          ? `${latestRun!.score} de 100 y sin problemas graves.`
          : `${latestRun!.score} de 100. Revisa los casos y actívalo cuando te guste cómo responde.`
        : simulationStatus === "stale"
          ? "El agente cambió desde la última evaluación. Vuelve a probarlo."
          : latestRun?.finishedAt
            ? "Necesitas 80 de 100 o más y cero casos graves."
            : "Pruébalo una vez antes de hablar con tus clientes.",
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
      href: "/lab",
    },
  ];

  // Capa de agencia: solo si esta instancia agenda. Va antes de las pruebas
  // porque probar un agente que no tiene horarios que ofrecer no prueba nada.
  // Llega resuelto desde fuera para que esta función siga siendo PURA.
  if (input.agendaStep) steps.splice(4, 0, input.agendaStep);

  const blockingSteps = steps.filter(
    (step) => step.status !== "complete" &&
      !(input.saasMode && step.id === "live_test" && step.status === "unavailable"),
  );

  return {
    overall: blockingSteps.length === 0 ? "ready" : "needs_attention",
    agentEnabled: profile.enabled,
    everActivated: profile.enabled || Boolean(input.everActivated),
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
  const businessHours = businessHoursFromProfile(profile);
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
    whatsappStatus: credentials[0]?.status ?? null,
    aiConfigured: await isAgentAvailableForOrganization(organizationId),
    liveTestAvailable: isWahaConfigured(),
    knowledgeCount: knowledge[0]?.count ?? 0,
    knowledgeUpdatedAt: knowledge[0]?.updatedAt ?? null,
    latestRun,
    redCount: redRows[0]?.count ?? 0,
    brandingCustomized: branding.name !== DEFAULT_BRANDING.name || branding.accent !== DEFAULT_BRANDING.accent,
    teamMemberCount: members[0]?.count ?? 0,
    businessHoursConfigured: hasConfiguredBusinessHours(businessHours),
    saasMode: isAllokSaaSMode(),
    agendaStep: await pasoAgenda(organizationId),
    everActivated: await hasEverActivated(organizationId, profile.enabled),
  });
}
