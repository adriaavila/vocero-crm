import { createHash } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { neaMessageId, newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { NeaResponseBody } from "@/server/ai/nea-dispatch";
import { toHandoffReason } from "@/server/bot/handoff";

/**
 * Data spine — enriquecimiento. Una fila `agent_decision` por turno real del
 * agente (Nea o Rei): qué hizo, con qué modelo y prompt, a qué mensajes
 * respondió y qué contestó. Es lo que una persona califica (bien | fallo).
 *
 * TODO lo de aquí es de mejor esfuerzo: registrar una decisión jamás puede
 * tumbar ni retrasar un turno, así que nada lanza. Y ningún campo lleva
 * contenido de mensajes (los ids apuntan a `message`).
 */

export const MAX_STEPS = 20;
export const MAX_STEP_SUMMARY = 200;
const MAX_TRIGGER_IDS = 50;
const MAX_REPLY_IDS = 20;
/** Cuántos mensajes (`seq`) de un mismo despacho se buscan al enlazar la respuesta de Nea. */
const MAX_NEA_REPLY_SEQ = 10;

export type DecisionStep = { tool: string; summary: string; ok: boolean };
export type DecisionTokens = { input: number; output: number };

/**
 * Lo que Nea puede mandar OPCIONALMENTE en `decision` (un PR paralelo en
 * nea-agent lo agrega): su ausencia, o cualquier campo mal formado, nunca
 * afecta el turno.
 */
export type NeaDecision = {
  model?: string;
  promptVersion?: string;
  steps?: DecisionStep[];
  latencyMs?: number;
  tokens?: DecisionTokens;
};

/* ---------- Validación de lo que manda Nea ---------- */

const stepSchema = z.object({
  tool: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, 80)),
  summary: z
    .string()
    .default("")
    .transform((s) => s.slice(0, MAX_STEP_SUMMARY)),
  ok: z.boolean(),
});

const nonNegativeInt = z.number().int().min(0).max(2_000_000_000);
const shortText = z.string().trim().min(1).max(100).optional().catch(undefined);

/** Cada campo falla por su cuenta: uno malo no descarta el resto. */
const neaDecisionSchema = z.object({
  model: shortText,
  promptVersion: shortText,
  steps: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((raw) =>
      raw
        ?.slice(0, MAX_STEPS * 5)
        .map((item) => stepSchema.safeParse(item))
        .flatMap((r) => (r.success ? [r.data] : []))
        .slice(0, MAX_STEPS)
    ),
  latencyMs: nonNegativeInt.optional().catch(undefined),
  tokens: z
    .object({ input: nonNegativeInt, output: nonNegativeInt })
    .optional()
    .catch(undefined),
});

/** `null` si no hay un objeto `decision` utilizable. */
export function parseNeaDecision(raw: unknown): NeaDecision | null {
  const parsed = neaDecisionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { model, promptVersion, steps, latencyMs, tokens } = parsed.data;
  return {
    ...(model ? { model } : {}),
    ...(promptVersion ? { promptVersion } : {}),
    ...(steps ? { steps } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(tokens ? { tokens } : {}),
  };
}

/* ---------- Ayudas puras ---------- */

/** Versión del prompt de Rei: los primeros 12 hex del sha256 del prompt ya compilado. */
export function promptVersionOf(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt).digest("hex").slice(0, 12);
}

/** Los entrantes que el turno contesta: los posteriores al último saliente. */
export function inboundSinceLastReply(
  history: { id: string; direction: "in" | "out" }[]
): string[] {
  const ids: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.direction === "out") break;
    ids.unshift(m.id);
  }
  return ids;
}

/* ---------- Registro ---------- */

export type DecisionInput = {
  organizationId: string;
  conversationId: string;
  /** Los turnos del Laboratorio no se registran. */
  isTest: boolean;
  brain: "nea" | "rei";
  dispatchId?: string | null;
  action: string;
  handoffReason?: string | null;
  steps?: DecisionStep[];
  model?: string | null;
  promptVersion?: string | null;
  latencyMs?: number | null;
  tokens?: DecisionTokens | null;
  triggerMessageIds?: string[];
  replyMessageIds?: string[];
};

/**
 * Devuelve el id de la decisión, o null si no se registró (prueba, fallo ya
 * anotado en el log, o ya había una para ese despacho). Un despacho = una
 * decisión: el índice único (conversación, dispatch_id) más `ON CONFLICT DO
 * NOTHING` hacen que un reintento nunca la duplique.
 */
export async function recordAgentDecision(input: DecisionInput): Promise<string | null> {
  if (input.isTest) return null;
  try {
    const id = newId("agentDecision");
    const inserted = await getDb()
      .insert(schema.agentDecision)
      .values({
        id,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        brain: input.brain,
        dispatchId: input.dispatchId ?? null,
        action: input.action.slice(0, 60),
        handoffReason: input.handoffReason ?? null,
        steps: (input.steps ?? []).slice(0, MAX_STEPS),
        model: input.model?.slice(0, 100) ?? null,
        promptVersion: input.promptVersion?.slice(0, 100) ?? null,
        latencyMs: input.latencyMs ?? null,
        inputTokens: input.tokens?.input ?? null,
        outputTokens: input.tokens?.output ?? null,
        triggerMessageIds: (input.triggerMessageIds ?? []).slice(0, MAX_TRIGGER_IDS),
        replyMessageIds: (input.replyMessageIds ?? []).slice(0, MAX_REPLY_IDS),
      })
      .onConflictDoNothing()
      .returning({ id: schema.agentDecision.id });
    if (inserted.length === 0) {
      console.log(
        `[spine] decision_duplicate conv=${input.conversationId} dispatch=${input.dispatchId ?? "-"}`
      );
      return null;
    }
    console.log(
      `[spine] decision id=${id} brain=${input.brain} action=${input.action} conv=${input.conversationId}`
    );
    return id;
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    console.warn(`[spine] decision_failed conv=${input.conversationId} err=${name}`);
    return null;
  }
}

/**
 * Los mensajes con que Nea contestó un despacho. Nea responde por
 * `/api/bot/messages` con ids DETERMINISTAS (`neaMessageId`), así que se
 * reconstruyen y se confirma cuáles existen; no hay que preguntarle a Nea.
 */
async function findNeaReplyIds(
  organizationId: string,
  conversationId: string,
  dispatchId: string
): Promise<string[]> {
  const candidates = Array.from({ length: MAX_NEA_REPLY_SEQ }, (_, seq) =>
    neaMessageId(organizationId, conversationId, dispatchId, seq)
  );
  const rows = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        // OR de igualdades y no IN: son 10 ids fijos.
        or(...candidates.map((id) => eq(schema.message.id, id)))
      )
    );
  const found = new Set(rows.map((r) => r.id));
  return candidates.filter((id) => found.has(id));
}

/**
 * Registra el turno que Nea acaba de responder (2xx). `body.decision` es
 * opcional y se valida aparte; sin él, la fila queda con la acción y el handoff.
 */
export async function recordNeaDecision(input: {
  organizationId: string;
  conversationId: string;
  isTest: boolean;
  dispatchId: string;
  body: NeaResponseBody;
  triggerMessageIds: string[];
  /**
   * Un reintento encontró que Nea YA había contestado este despacho y el 2xx se
   * perdió: el cuerpo (acción, handoff, `decision`) no se conoce. Se registra lo
   * que sí consta (contestó, y a qué) con un paso `recovered` que lo delata; el
   * modelo, los pasos y los tokens del turno se pierden con el 2xx.
   */
  recovered?: boolean;
}): Promise<string | null> {
  if (input.isTest) return null;
  try {
    const recovered = input.recovered === true;
    const body: NeaResponseBody = recovered ? { ok: true, action: "replied" } : input.body;
    const decision = recovered ? null : parseNeaDecision(body.decision);
    let replyMessageIds: string[] = [];
    if (body.action === "replied") {
      replyMessageIds = await findNeaReplyIds(
        input.organizationId,
        input.conversationId,
        input.dispatchId
      ).catch(() => []);
    }
    return await recordAgentDecision({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      isTest: false,
      brain: "nea",
      dispatchId: input.dispatchId,
      action: typeof body.action === "string" && body.action ? body.action : "noop",
      handoffReason: body.handoff ? toHandoffReason(body.handoff.reason) : null,
      steps: recovered
        ? [{ tool: "recovered", summary: "respuesta ya enviada; se perdió el 2xx de Nea", ok: true }]
        : decision?.steps,
      model: decision?.model,
      promptVersion: decision?.promptVersion,
      latencyMs: decision?.latencyMs,
      tokens: decision?.tokens,
      triggerMessageIds: input.triggerMessageIds,
      replyMessageIds,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    console.warn(`[spine] decision_failed conv=${input.conversationId} err=${name}`);
    return null;
  }
}
