import { count } from "drizzle-orm";
import { brand } from "@/lib/brand";
import { isSuggestedHandoff } from "@/lib/negocio";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { canAutomate, hasSaaSPlan } from "@/server/agencia/entitlements";
import { describeAgentSchedule, type ScheduleDescription } from "@/server/agencia/horario-texto";
import type { SetupStepKey } from "@/lib/setup-steps";
import { isAgentAvailableForOrganization } from "@/server/ai/credentials";
import { getBusinessHours, hasConfiguredBusinessHours } from "@/server/business-hours";
import {
  getReadiness,
  saasActivationBlockers,
  type ReadinessResponse,
  type ReadinessStep,
} from "@/server/readiness";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * Capa de agencia: qué le impide al agente encenderse, en un solo lugar.
 *
 * La ruta que enciende (`PUT /api/agent/profile`) y la pantalla «Activar»
 * necesitan la MISMA lista: si cada una armara la suya, la pantalla prometería
 * una activación que el servidor rechaza. Cada bloqueo trae dos voces: el
 * `message` de siempre (contrato de la API, no cambia) y, para el dueño,
 * `title`/`detail`/`cta` en palabras llanas con a dónde ir a arreglarlo.
 */

export type ActivationBlockerCode =
  | "billing_inactive"
  | "ai_not_configured"
  | "whatsapp_required"
  | "pro_required"
  | "business_hours_required"
  | "onboarding_incomplete";

export type ActivationBlocker = {
  code: ActivationBlockerCode;
  /** HTTP que devuelve la ruta que enciende. */
  status: number;
  /** El texto de la API (contrato). */
  message: string;
  step: SetupStepKey;
  title: string;
  detail: string;
  href: string | null;
  cta: string | null;
};

/** Lo que el dueño ve de un bloqueo. */
export type PublicBlocker = Pick<ActivationBlocker, "code" | "step" | "title" | "detail" | "href" | "cta">;

type StepCopy = { title: string; detail: string; href: string | null; cta: string | null; step: SetupStepKey };

/** Los pasos de preparación en palabras de dueño. */
function readinessCopy(step: ReadinessStep): StepCopy {
  switch (step.id) {
    case "whatsapp":
      return {
        step: "whatsapp",
        title: "Conecta tu WhatsApp",
        detail: "Sin un número conectado no hay a quién responder.",
        href: "/settings/whatsapp",
        cta: "Conectar",
      };
    case "business_hours":
      return {
        step: "negocio",
        title: "Elige cuándo responde tu agente",
        detail: "Falta marcar los días y las horas de tu equipo.",
        href: "/agent#horario",
        cta: "Elegir horario",
      };
    case "agent_profile":
      return {
        step: "negocio",
        title: "Completa los datos del agente",
        detail: "Falta su nombre, tono, saludo, instrucciones o la regla para pasar con una persona.",
        href: "/agent#avanzado",
        cta: "Revisar",
      };
    case "knowledge":
      return {
        step: "negocio",
        title: "Cuéntanos de tu negocio",
        detail: "Tu agente solo responde con lo que escribas aquí. Todavía no hay nada.",
        href: "/agent#negocio",
        cta: "Completar",
      };
    case "simulation":
      return step.status === "stale"
        ? {
            step: "probar",
            title: "Vuelve a probar tu agente",
            detail: "Cambiaste la información después de la última prueba.",
            href: "/lab",
            cta: "Probar de nuevo",
          }
        : {
            step: "probar",
            title: "Prueba tu agente",
            detail: "Necesita pasar la prueba antes de hablar con tus clientes.",
            href: "/lab",
            cta: "Probar",
          };
    case "ai_provider":
      return {
        step: "activar",
        title: "La IA no está lista en tu cuenta",
        detail: "Escríbenos y lo resolvemos.",
        href: null,
        cta: null,
      };
    default:
      return {
        step: "activar",
        title: step.label,
        detail: step.detail,
        href: step.href,
        cta: "Abrir",
      };
  }
}

const name = () => brand().Name;

/**
 * Los bloqueos del servidor, en el orden en que la ruta los reporta: el primero
 * es el que ve el cliente de la API. Fuera del SaaS solo cuenta el cobro (que
 * ahí siempre pasa): los demás pasos son consejos, no candados.
 */
export async function activationBlockers(
  organizationId: string,
  readiness?: ReadinessResponse,
): Promise<ActivationBlocker[]> {
  const blockers: ActivationBlocker[] = [];

  if (!(await canAutomate(organizationId))) {
    blockers.push({
      code: "billing_inactive",
      status: 402,
      message: `Activa o recupera tu suscripción para encender ${name()}.`,
      step: "activar",
      title: "Activa tu plan",
      detail: "Tu prueba terminó o no hay un plan activo.",
      href: "/settings/billing",
      cta: "Ver planes",
    });
  }
  if (!isAllokSaaSMode()) return blockers;

  if (!(await isAgentAvailableForOrganization(organizationId))) {
    blockers.push({
      code: "ai_not_configured",
      status: 503,
      message: "La IA todavía no está configurada en esta instancia.",
      step: "activar",
      title: "La IA no está lista en tu cuenta",
      detail: "Escríbenos y lo resolvemos.",
      href: null,
      cta: null,
    });
  }

  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials || credentials.status !== "connected") {
    const reconnect = credentials?.status === "reconnect_required";
    blockers.push({
      code: "whatsapp_required",
      status: 409,
      message: `Conecta y verifica tu número de WhatsApp antes de activar ${name()}.`,
      step: "whatsapp",
      title: reconnect ? "Reconecta tu WhatsApp" : "Conecta tu WhatsApp",
      detail: reconnect
        ? "La conexión venció. Mientras tanto no se envían respuestas."
        : "Sin un número conectado no hay a quién responder.",
      href: "/settings/whatsapp",
      cta: reconnect ? "Reconectar" : "Conectar",
    });
  }

  const hours = await getBusinessHours(organizationId);
  if (hours.responseMode === "all_day" && !(await hasSaaSPlan(organizationId, "pro"))) {
    blockers.push({
      code: "pro_required",
      status: 402,
      message: "La atención todo el día está disponible en Completo.",
      step: "negocio",
      title: "Atender todo el día es del plan Completo",
      detail: "Elige «Fuera de horario» o cambia de plan.",
      href: "/agent#horario",
      cta: "Cambiar horario",
    });
  }
  if (!hasConfiguredBusinessHours(hours)) {
    blockers.push({
      code: "business_hours_required",
      status: 409,
      message: `Define al menos un horario de respuesta antes de activar ${name()}.`,
      step: "negocio",
      title: "Elige cuándo responde tu agente",
      detail: "Falta marcar los días y las horas de tu equipo.",
      href: "/agent#horario",
      cta: "Elegir horario",
    });
  }

  const pending = saasActivationBlockers(readiness ?? (await getReadiness(organizationId))).filter(
    (step) => step.id !== "whatsapp" && step.id !== "business_hours",
  );
  for (const step of pending) {
    const copy = readinessCopy(step);
    blockers.push({
      code: "onboarding_incomplete",
      status: 409,
      // Una por paso: la ruta las junta en el mismo mensaje de siempre.
      message: step.label,
      step: copy.step,
      title: copy.title,
      detail: copy.detail,
      href: copy.href,
      cta: copy.cta,
    });
  }
  return blockers;
}

/** El error que devuelve la ruta que enciende: el primer bloqueo, con el mensaje de siempre. */
export function activationError(
  blockers: ActivationBlocker[],
): { status: number; code: ActivationBlockerCode; message: string } | null {
  const first = blockers[0];
  if (!first) return null;
  if (first.code !== "onboarding_incomplete") {
    return { status: first.status, code: first.code, message: first.message };
  }
  const labels = blockers.filter((b) => b.code === "onboarding_incomplete").map((b) => b.message);
  return {
    status: first.status,
    code: first.code,
    message: `Completa antes de activar: ${labels.join(", ")}.`,
  };
}

export type ActivationSummary = {
  /** El servidor rechaza la activación mientras haya bloqueos (SaaS). Si no, son consejos. */
  enforced: boolean;
  blockers: PublicBlocker[];
  /** El número que va a contestar. */
  number: { display: string | null; name: string | null } | null;
  schedule: ScheduleDescription | null;
  /** Cuándo el agente pasa la conversación a una persona. */
  handoff: string | null;
  /** Sigue siendo el texto sugerido con el que nació el negocio: no es todavía «su regla». */
  handoffSuggested: boolean;
  /**
   * Límites que el dueño dejó puestos en Avanzado y que cambian a quién le
   * contesta el agente: encender no los quita, y no decirlo sería prometer más
   * de lo que va a pasar.
   */
  restrictions: string[];
  /** Cuántos datos del negocio tiene el agente para responder. */
  knowledgeCount: number;
};

function publicBlocker(blocker: ActivationBlocker): PublicBlocker {
  const { code, step, title, detail, href, cta } = blocker;
  return { code, step, title, detail, href, cta };
}

export function restrictionsOf(
  profile: { allowlistEnabled: boolean; allowedWaIds: string[]; activationEnabled: boolean } | undefined,
): string[] {
  if (!profile) return [];
  const restrictions: string[] = [];
  if (profile.allowlistEnabled) {
    const n = profile.allowedWaIds.length;
    restrictions.push(
      n === 1 ? "Por ahora solo responde a 1 número autorizado." : `Por ahora solo responde a ${n} números autorizados.`,
    );
  }
  if (profile.activationEnabled) {
    restrictions.push("Solo empieza a responder cuando el cliente escribe uno de tus mensajes de activación.");
  }
  return restrictions;
}

/** Lo que muestra «Activar»: el número, el horario, qué hará el agente y qué falta. */
export async function getActivationSummary(
  organizationId: string,
  readiness?: ReadinessResponse,
  now: Date = new Date(),
): Promise<ActivationSummary> {
  const db = getDb();
  const current = readiness ?? (await getReadiness(organizationId));
  const enforced = isAllokSaaSMode();
  const [blockers, credentials, hours, profiles, kb] = await Promise.all([
    activationBlockers(organizationId, current),
    getCredentialsByOrg(organizationId),
    getBusinessHours(organizationId),
    db
      .select({
        escalationRules: schema.agentProfile.escalationRules,
        allowlistEnabled: schema.agentProfile.allowlistEnabled,
        allowedWaIds: schema.agentProfile.allowedWaIds,
        activationEnabled: schema.agentProfile.activationEnabled,
      })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    db
      .select({ n: count() })
      .from(schema.kbEntry)
      .where(scoped(schema.kbEntry.organizationId, organizationId)),
  ]);

  // Fuera del SaaS el servidor no bloquea: los pasos pendientes se muestran
  // como consejo, igual que antes de este cambio.
  const advisory: PublicBlocker[] = enforced
    ? []
    : current.steps
        .filter((step) => step.status === "pending" || step.status === "stale")
        .map((step) => {
          const copy = readinessCopy(step);
          return {
            code: "onboarding_incomplete" as const,
            step: copy.step,
            title: copy.title,
            detail: copy.detail,
            href: copy.href,
            cta: copy.cta,
          };
        });

  return {
    enforced,
    blockers: [...blockers.map(publicBlocker), ...advisory],
    number: credentials
      ? { display: credentials.displayPhoneNumber ?? null, name: credentials.verifiedName ?? null }
      : null,
    // Fuera del SaaS no hay horario de respuesta: contesta apenas llega el
    // mensaje, y decir «sin horario» sería un aviso falso.
    schedule: enforced ? describeAgentSchedule(hours, now) : null,
    handoff: profiles[0]?.escalationRules?.trim() || null,
    handoffSuggested: isSuggestedHandoff(profiles[0]?.escalationRules),
    restrictions: restrictionsOf(profiles[0]),
    knowledgeCount: kb[0]?.n ?? 0,
  };
}
