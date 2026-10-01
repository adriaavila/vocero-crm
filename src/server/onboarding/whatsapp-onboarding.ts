import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Estado del alta de WhatsApp de cada negocio (tabla `whatsapp_onboarding`).
 *
 * pendiente → conectado → webhook_ok → primer_mensaje, y `error` en cualquier
 * punto. Un error no borra el avance (connected_at / webhook_ok_at quedan), así
 * el dueño retoma desde donde quedó y soporte ve en qué paso se trabó.
 */

export type OnboardingStatus = "pendiente" | "conectado" | "webhook_ok" | "primer_mensaje" | "error";
export type OnboardingMode = "coexistence" | "cloud_api";
export type OnboardingRow = typeof schema.whatsappOnboarding.$inferSelect;

/** Crea la fila en `pendiente` si no existe (registro o primera visita). */
export async function ensureOnboarding(organizationId: string): Promise<void> {
  await getDb()
    .insert(schema.whatsappOnboarding)
    .values({ organizationId })
    .onConflictDoNothing();
}

export async function getOnboarding(organizationId: string): Promise<OnboardingRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.whatsappOnboarding)
    .where(eq(schema.whatsappOnboarding.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Credenciales guardadas. Un número distinto al anterior reinicia el avance
 * de ese número (webhook y primer mensaje se vuelven a probar).
 */
export async function markConnected(
  organizationId: string,
  input: { mode: OnboardingMode; wabaId: string; phoneNumberId: string },
): Promise<void> {
  const now = new Date();
  const t = schema.whatsappOnboarding;
  const samePhone = sql`${t.phoneNumberId} = ${input.phoneNumberId}`;
  await getDb()
    .insert(t)
    .values({
      organizationId,
      status: "conectado",
      mode: input.mode,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      attempts: 1,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: t.organizationId,
      set: {
        // Reintento del mismo número que ya recibió su primer mensaje: no se
        // retrocede. Cualquier otro caso queda en "conectado".
        status: sql`case when ${samePhone} and ${t.firstMessageAt} is not null then 'primer_mensaje' else 'conectado' end`,
        mode: input.mode,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        errorStep: null,
        errorCode: null,
        errorDetail: null,
        cancelledAtStep: null,
        attempts: sql`${t.attempts} + 1`,
        connectedAt: now,
        webhookOkAt: sql`case when ${samePhone} then ${t.webhookOkAt} else null end`,
        firstMessageAt: sql`case when ${samePhone} then ${t.firstMessageAt} else null end`,
        updatedAt: now,
      },
    });
}

/** Override del webhook confirmado (y el número registrado, si es número nuevo). */
export async function markWebhookOk(organizationId: string): Promise<void> {
  const t = schema.whatsappOnboarding;
  const now = new Date();
  await getDb()
    .update(t)
    .set({
      status: sql`case when ${t.firstMessageAt} is not null then 'primer_mensaje' else 'webhook_ok' end`,
      errorStep: null,
      errorCode: null,
      errorDetail: null,
      webhookOkAt: now,
      updatedAt: now,
    })
    .where(eq(t.organizationId, organizationId));
}

/**
 * Error en un paso. Conserva el avance. `cancelledAtStep` es el paso del popup
 * de Meta donde el dueño cerró (solo para cancelaciones).
 */
export async function markError(
  organizationId: string,
  input: {
    step: string;
    code?: string | number | null;
    detail?: string | null;
    cancelledAtStep?: string | null;
  },
): Promise<void> {
  const t = schema.whatsappOnboarding;
  const now = new Date();
  const values = {
    status: "error" as const,
    errorStep: input.step,
    errorCode: input.code == null ? null : String(input.code).slice(0, 32),
    errorDetail: input.detail ? input.detail.slice(0, 500) : null,
    cancelledAtStep: input.cancelledAtStep ? input.cancelledAtStep.slice(0, 64) : null,
    updatedAt: now,
  };
  await getDb()
    .insert(t)
    .values({ organizationId, ...values, attempts: 1 })
    .onConflictDoUpdate({
      target: t.organizationId,
      set: {
        ...values,
        // Un número que ya recibió mensajes no "se rompe" por un reintento
        // fallido de otro paso: el error queda anotado, el estado no baja.
        status: sql`case when ${t.firstMessageAt} is not null then 'primer_mensaje' else 'error' end`,
        attempts: sql`${t.attempts} + 1`,
      },
    });
}

/**
 * Primer mensaje entrante del negocio. Una sola escritura por negocio: las
 * siguientes no tocan nada (`first_message_at is null`).
 */
export async function markFirstMessage(organizationId: string): Promise<boolean> {
  const t = schema.whatsappOnboarding;
  const now = new Date();
  const rows = await getDb()
    .update(t)
    .set({ status: "primer_mensaje", firstMessageAt: now, errorStep: null, errorCode: null, errorDetail: null, updatedAt: now })
    .where(and(eq(t.organizationId, organizationId), isNull(t.firstMessageAt)))
    .returning({ organizationId: t.organizationId });
  return rows.length > 0;
}

/** Soporte: vuelve a pendiente para que el dueño conecte otra vez desde cero. */
export async function resetOnboarding(organizationId: string): Promise<void> {
  const t = schema.whatsappOnboarding;
  await getDb()
    .update(t)
    .set({
      status: "pendiente",
      errorStep: null,
      errorCode: null,
      errorDetail: null,
      cancelledAtStep: null,
      updatedAt: new Date(),
    })
    .where(eq(t.organizationId, organizationId));
}
