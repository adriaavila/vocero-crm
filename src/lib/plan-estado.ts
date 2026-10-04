import type { SaaSBillingState, SaaSPlan } from "@/server/saas/billing";

/**
 * Capa de agencia (fork) — en qué punto del plan está un negocio, dicho para el
 * dueño. UNA sola lectura que comparten Inicio, Facturación, la barra lateral,
 * el correo de la prueba y el estado del agente: si cada pantalla armara la
 * suya, una diría «te quedan 2 días» mientras otra dice «tu plan no está
 * activo».
 *
 * Puro y sin servidor (solo importa el TIPO del estado de facturación, que se
 * borra al compilar): lo importa también un componente de cliente.
 */

/** Espejo de `SELF_SERVE_TRIAL_*` en `server/saas/billing` (hay una prueba que los compara). */
export const TRIAL_SOURCE = "self_serve_trial";
export const TRIAL_AI_REPLIES = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Avisar que la prueba termina cuando quedan 48 h o menos, o se usó el 80 % de las respuestas. */
export const TRIAL_ENDING_MS = 2 * DAY_MS;
export const TRIAL_ENDING_REPLIES = Math.floor(TRIAL_AI_REPLIES * 0.8);

export type PlanKind =
  /** Prueba de autoservicio vigente, con tiempo y respuestas de sobra. */
  | "trial"
  /** Prueba vigente a punto de acabarse (por días o por respuestas). */
  | "trial_ending"
  /** Se usaron las 300 respuestas de la prueba: el agente se pausó antes de tiempo. */
  | "trial_cap"
  /** La prueba venció sin que el dueño eligiera un plan. */
  | "trial_ended"
  /** Stripe no pudo cobrar (`past_due` o `unpaid`). */
  | "payment_failed"
  /** La suscripción se canceló. */
  | "canceled"
  /** Activo, pero programado para cancelarse al final del periodo. */
  | "cancelling"
  /** Plan pago al día (o concedido a mano). */
  | "paid"
  /** Nunca tuvo plan. */
  | "none";

export type PlanState = {
  kind: PlanKind;
  /** El plan deja que el agente conteste (no mira el horario ni si el dueño lo encendió). */
  agentAllowed: boolean;
  plan: SaaSPlan | null;
  /** ISO: fin de la prueba o del periodo pagado, si se conoce. */
  endsAt: string | null;
  /** Días que quedan (hacia arriba), solo en prueba vigente o plan por cancelarse. */
  daysLeft: number | null;
  /** Respuestas de IA gastadas de la prueba; solo mientras la prueba corre o se topó. */
  replies: { used: number; cap: number } | null;
  /** Hay una suscripción de Stripe a la que el portal puede entrar. */
  hasSubscription: boolean;
};

type BillingInput = Pick<
  SaaSBillingState,
  "plan" | "status" | "source" | "subscriptionId" | "customerId" | "currentPeriodEnd" | "cancelAtPeriodEnd"
>;

export const AGENT_ALLOWED: Record<PlanKind, boolean> = {
  trial: true,
  trial_ending: true,
  trial_cap: false,
  trial_ended: false,
  payment_failed: false,
  canceled: false,
  cancelling: true,
  paid: true,
  none: false,
};

/**
 * `aiReplies`: respuestas de IA de la prueba (solo hace falta mientras la
 * prueba corre; con `null` no se conoce y no se avisa del tope).
 */
export function derivePlanState(
  billing: BillingInput,
  aiReplies: number | null,
  now = Date.now(),
): PlanState {
  const endMs = billing.currentPeriodEnd ? Date.parse(billing.currentPeriodEnd) : NaN;
  const endsAt = Number.isFinite(endMs) && billing.currentPeriodEnd ? billing.currentPeriodEnd : null;
  const hasSubscription = billing.subscriptionId !== null;
  const base = { plan: billing.plan, endsAt, hasSubscription, replies: null, daysLeft: null };
  const make = (kind: PlanKind, extra: Partial<PlanState> = {}): PlanState => ({
    ...base,
    kind,
    agentAllowed: AGENT_ALLOWED[kind],
    ...extra,
  });

  const onFreeTrial = billing.source === TRIAL_SOURCE && !hasSubscription;

  if (onFreeTrial && billing.status === "trialing") {
    const left = Number.isFinite(endMs) ? endMs - now : -1;
    // `billingFromMetadata` ya lee una prueba vencida como "inactive", pero
    // quien llame con el estado crudo también queda cubierto.
    if (left <= 0) return make("trial_ended");
    const used = aiReplies === null ? null : Math.min(aiReplies, TRIAL_AI_REPLIES);
    const replies = used === null ? null : { used, cap: TRIAL_AI_REPLIES };
    const daysLeft = Math.max(1, Math.ceil(left / DAY_MS));
    if (used !== null && used >= TRIAL_AI_REPLIES) return make("trial_cap", { replies, daysLeft });
    const ending = left <= TRIAL_ENDING_MS || (used !== null && used >= TRIAL_ENDING_REPLIES);
    return make(ending ? "trial_ending" : "trial", { replies, daysLeft });
  }
  // Prueba vencida (o con un checkout a medias que nunca confirmó): sigue
  // siendo «tu prueba terminó», no «incompleto».
  if (onFreeTrial && (billing.status === "inactive" || billing.status === "incomplete")) {
    return make("trial_ended");
  }

  if (billing.status === "past_due" || billing.status === "unpaid") return make("payment_failed");
  if (billing.status === "canceled") return make("canceled");
  if (billing.status === "active" || billing.status === "trialing") {
    if (billing.cancelAtPeriodEnd) {
      const daysLeft = Number.isFinite(endMs) ? Math.max(0, Math.ceil((endMs - now) / DAY_MS)) : null;
      return make("cancelling", { daysLeft });
    }
    return make("paid");
  }
  return make("none");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «3 de octubre», en la zona dada. */
export function planDate(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone }).format(date);
}

/** Una frase de por qué el agente contesta o no, y qué hacer. Sin jerga. */
export function planHeadline(state: PlanState, timeZone?: string): string {
  switch (state.kind) {
    case "trial": {
      const days = plural(state.daysLeft ?? 0, "día", "días");
      return `Prueba gratis de Completo: te quedan ${days}.`;
    }
    case "trial_ending": {
      const when = (state.daysLeft ?? 1) <= 1 ? "en menos de un día" : `en ${state.daysLeft} días`;
      return `Tu prueba termina ${when}. Elige un plan para que tu agente siga contestando.`;
    }
    case "trial_cap":
      return `Usaste las ${state.replies?.cap ?? TRIAL_AI_REPLIES} respuestas de la prueba. Tu agente está en pausa hasta que elijas un plan.`;
    case "trial_ended":
      return "Tu prueba terminó. Tu agente está en pausa hasta que elijas un plan.";
    case "payment_failed":
      return "No pudimos cobrar tu plan. Tu agente está en pausa hasta que actualices el pago.";
    case "canceled":
      return "Tu plan está cancelado. Tu agente está en pausa y tus conversaciones siguen aquí.";
    case "cancelling": {
      const date = planDate(state.endsAt, timeZone);
      return date
        ? `Tu plan termina el ${date}. Hasta entonces tu agente sigue contestando.`
        : "Tu plan está por terminar. Hasta entonces tu agente sigue contestando.";
    }
    case "paid":
      return "Tu plan está al día.";
    case "none":
      return "Elige un plan para que tu agente conteste.";
  }
}

/** El texto de la única acción que corresponde, o null si no hay nada que hacer. */
export function planActionLabel(state: PlanState): string | null {
  switch (state.kind) {
    case "payment_failed":
      return "Actualizar pago";
    case "cancelling":
      return "Gestionar plan";
    case "paid":
      return null;
    default:
      return "Elegir plan";
  }
}

/**
 * ¿Esta persona puede abrir un checkout nuevo? Con un cobro fallido el camino es
 * el portal (es la misma suscripción: otra la cobraría dos veces), salvo que no
 * haya ninguna a la que volver.
 */
export function planCanCheckout(state: PlanState): boolean {
  if (state.kind === "payment_failed") return !state.hasSubscription;
  return state.kind !== "paid" && state.kind !== "cancelling";
}
