import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DecisionStep } from "@/server/agencia/decisions";

/**
 * Data spine — lectura de `agent_decision` para el equipo del negocio. Todo
 * pasa por `scoped()`: una organización jamás ve ni califica las decisiones de
 * otra. Los previews de texto son de mensajes de ESTA organización y se cortan
 * a 140 caracteres; el payload crudo del webhook (`raw_event`) no se expone.
 */

const PREVIEW_MAX = 140;
export const DECISIONS_DEFAULT_LIMIT = 25;
export const DECISIONS_MAX_LIMIT = 100;

export const VerdictInput = z
  .object({
    verdict: z.enum(["bien", "fallo"]).nullable(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** `none` = todavía sin calificar. */
export const DecisionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(DECISIONS_MAX_LIMIT).default(DECISIONS_DEFAULT_LIMIT),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .optional(),
  verdict: z.enum(["bien", "fallo", "none"]).optional(),
});

export type DecisionDto = {
  id: string;
  conversationId: string;
  contactName: string | null;
  brain: "nea" | "rei";
  action: string;
  handoffReason: string | null;
  steps: DecisionStep[];
  model: string | null;
  promptVersion: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  triggerMessageIds: string[];
  replyMessageIds: string[];
  /** Texto (o tipo) del último entrante al que respondió, ≤140 caracteres. */
  triggerPreview: string | null;
  /** Texto (o tipo) de lo primero que contestó, ≤140 caracteres. */
  replyPreview: string | null;
  verdict: "bien" | "fallo" | null;
  verdictNote: string | null;
  verdictBy: string | null;
  verdictAt: string | null;
  createdAt: string;
};

export type DecisionsPage = { decisions: DecisionDto[]; nextCursor: string | null };

/* ---------- Cursor (created_at con microsegundos + id) ---------- */

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
const CURSOR_ID = /^dec_[a-z0-9]+$/;

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`).toString("base64url");
}

/** null si el cursor no es uno que nosotros emitimos. */
export function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const [ts, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (rest.length || !ts || !id || !CURSOR_TS.test(ts) || !CURSOR_ID.test(id)) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export function preview(text: string | null, type: string): string {
  const base = (text ?? type).replace(/\s+/g, " ").trim();
  return base.length > PREVIEW_MAX ? `${base.slice(0, PREVIEW_MAX - 1)}…` : base;
}

/* ---------- Listado ---------- */

// El cursor lleva el created_at con microsegundos (un Date de JS los trunca).
const createdAtExact = sql<string>`to_char(${schema.agentDecision.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function listPage(
  organizationId: string,
  opts: {
    limit: number;
    cursor?: { ts: string; id: string };
    verdict?: "bien" | "fallo" | "none";
    conversationId?: string;
  }
): Promise<DecisionsPage> {
  const db = getDb();
  const d = schema.agentDecision;
  const conditions: (SQL | undefined)[] = [
    opts.conversationId ? eq(d.conversationId, opts.conversationId) : undefined,
    opts.verdict === "none"
      ? sql`${d.verdict} is null`
      : opts.verdict
        ? eq(d.verdict, opts.verdict)
        : undefined,
    opts.cursor
      ? sql`(${d.createdAt}, ${d.id}) < (${opts.cursor.ts}::timestamp, ${opts.cursor.id})`
      : undefined,
  ];

  const rows = await db
    .select({
      decision: d,
      cursorTs: createdAtExact,
      contactName: schema.contact.name,
    })
    .from(d)
    .innerJoin(schema.conversation, eq(schema.conversation.id, d.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(d.organizationId, organizationId, ...conditions))
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;

  // Un solo viaje por los textos de todos los mensajes de la página.
  const wanted = new Set<string>();
  for (const r of page) {
    const trigger = asStringArray(r.decision.triggerMessageIds);
    const reply = asStringArray(r.decision.replyMessageIds);
    const lastTrigger = trigger[trigger.length - 1];
    if (lastTrigger) wanted.add(lastTrigger);
    if (reply[0]) wanted.add(reply[0]);
  }
  const texts = new Map<string, string>();
  if (wanted.size > 0) {
    const messages = await db
      .select({ id: schema.message.id, text: schema.message.text, type: schema.message.type })
      .from(schema.message)
      .where(scoped(schema.message.organizationId, organizationId, inArray(schema.message.id, [...wanted])));
    for (const m of messages) texts.set(m.id, preview(m.text, m.type));
  }

  const decisions: DecisionDto[] = page.map((r) => {
    const trigger = asStringArray(r.decision.triggerMessageIds);
    const reply = asStringArray(r.decision.replyMessageIds);
    const lastTrigger = trigger[trigger.length - 1];
    return {
      id: r.decision.id,
      conversationId: r.decision.conversationId,
      contactName: r.contactName,
      brain: r.decision.brain,
      action: r.decision.action,
      handoffReason: r.decision.handoffReason,
      steps: Array.isArray(r.decision.steps) ? (r.decision.steps as DecisionStep[]) : [],
      model: r.decision.model,
      promptVersion: r.decision.promptVersion,
      latencyMs: r.decision.latencyMs,
      inputTokens: r.decision.inputTokens,
      outputTokens: r.decision.outputTokens,
      triggerMessageIds: trigger,
      replyMessageIds: reply,
      triggerPreview: lastTrigger ? (texts.get(lastTrigger) ?? null) : null,
      replyPreview: reply[0] ? (texts.get(reply[0]) ?? null) : null,
      verdict: r.decision.verdict,
      verdictNote: r.decision.verdictNote,
      verdictBy: r.decision.verdictBy,
      verdictAt: r.decision.verdictAt?.toISOString() ?? null,
      createdAt: r.decision.createdAt.toISOString(),
    };
  });

  const last = hasMore ? page[page.length - 1] : undefined;
  return { decisions, nextCursor: last ? encodeCursor(last.cursorTs, last.decision.id) : null };
}

/** Decisiones de toda la organización, las más nuevas primero. */
export function listDecisions(
  organizationId: string,
  opts: { limit: number; cursor?: string; verdict?: "bien" | "fallo" | "none" }
): Promise<DecisionsPage | "invalid_cursor"> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  if (opts.cursor && !cursor) return Promise.resolve("invalid_cursor");
  return listPage(organizationId, { limit: opts.limit, cursor: cursor ?? undefined, verdict: opts.verdict });
}

/** Decisiones de una conversación (el llamador ya verificó que es de la organización). */
export function listConversationDecisions(
  organizationId: string,
  conversationId: string,
  opts: { limit: number; cursor?: string }
): Promise<DecisionsPage | "invalid_cursor"> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  if (opts.cursor && !cursor) return Promise.resolve("invalid_cursor");
  return listPage(organizationId, { limit: opts.limit, cursor: cursor ?? undefined, conversationId });
}

/* ---------- Veredicto ---------- */

export type VerdictResult = {
  id: string;
  verdict: "bien" | "fallo" | null;
  verdictNote: string | null;
  verdictBy: string | null;
  verdictAt: string | null;
};

/**
 * Califica una decisión. `verdict: null` borra el veredicto entero. La nota es
 * parte del veredicto: sin `note`, queda vacía (una nota vieja no sobrevive a
 * un veredicto distinto). null si la decisión no es de esta organización.
 */
export async function setVerdict(
  organizationId: string,
  userId: string,
  decisionId: string,
  input: z.infer<typeof VerdictInput>
): Promise<VerdictResult | null> {
  const d = schema.agentDecision;
  const cleared = input.verdict === null;
  const rows = await getDb()
    .update(d)
    .set({
      verdict: input.verdict,
      verdictNote: cleared ? null : input.note || null,
      verdictBy: cleared ? null : userId,
      verdictAt: cleared ? null : new Date(),
    })
    .where(scoped(d.organizationId, organizationId, eq(d.id, decisionId)))
    .returning({
      id: d.id,
      verdict: d.verdict,
      verdictNote: d.verdictNote,
      verdictBy: d.verdictBy,
      verdictAt: d.verdictAt,
    });
  const row = rows[0];
  if (!row) return null;
  return { ...row, verdictAt: row.verdictAt?.toISOString() ?? null };
}
