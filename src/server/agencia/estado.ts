import { count, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  conversationNote,
  conversationState,
  systemState,
  WINDOW_MS,
  type SystemSnapshot,
  type SystemState,
  type WhatsAppLink,
} from "@/lib/estado";
import { canAutomate } from "@/server/agencia/entitlements";
import { cerebroExternoAtiende } from "@/server/agencia/cerebro-externo";
import type { ConversationDto } from "@/lib/types";

/**
 * Capa de agencia (fork) — el estado de la operación con datos reales: el
 * punto del logotipo, la barra lateral, el icono de la pestaña e Inicio.
 * Las reglas viven en `lib/estado` (puras y probadas); acá solo se leen.
 */

async function agentOn(organizationId: string): Promise<{ on: boolean; timezone: string }> {
  const rows = await getDb()
    .select({ enabled: schema.agentProfile.enabled, timezone: schema.agentProfile.businessTimezone })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  // Un cerebro externo (BOT_API_KEY) también contesta: no es «apagado».
  return {
    on: Boolean(rows[0]?.enabled) || (await cerebroExternoAtiende(organizationId)),
    timezone: rows[0]?.timezone ?? "UTC",
  };
}

export async function getSystemState(organizationId: string, owner: boolean): Promise<SystemSnapshot> {
  const db = getDb();
  // Solo puede no estar en `activo` lo que tuvo un entrante dentro de la
  // ventana (traspasos incluidos): el resto ni se trae.
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const [creds, agent, rows, jobs, billingActive] = await Promise.all([
    db
      .select({ status: schema.metaCredentials.status, phone: schema.metaCredentials.displayPhoneNumber })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .limit(1),
    agentOn(organizationId),
    db
      .select({
        aiEnabled: schema.conversation.aiEnabled,
        handoffAt: schema.conversation.handoffAt,
        lastInboundAt: schema.conversation.lastInboundAt,
        lastMessageAt: schema.conversation.lastMessageAt,
        unreadCount: schema.conversation.unreadCount,
      })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.isTest, false),
          gte(schema.conversation.lastInboundAt, windowStart),
        ),
      ),
    db
      .select({ n: count() })
      .from(schema.agentJob)
      .where(
        scoped(
          schema.agentJob.organizationId,
          organizationId,
          inArray(schema.agentJob.status, ["queued", "running"]),
        ),
      ),
    canAutomate(organizationId),
  ]);

  const now = Date.now();
  let waiting = 0;
  let live = 0;
  for (const row of rows) {
    const state = conversationState(row, agent.on, now);
    if (state === "atencion") waiting++;
    else if (state === "atendiendo") live++;
  }
  // Un turno en cola es de una conversación que ya puede estar contada como
  // viva: se toma el mayor, no la suma, para no contar dos veces la misma.
  const working = Math.max(live, jobs[0]?.n ?? 0);
  const whatsapp: WhatsAppLink = creds[0] ? creds[0].status : "missing";

  return {
    ...systemState({ whatsapp, billingActive, agentOn: agent.on, waiting, working, owner }),
    whatsapp: { status: whatsapp, phone: creds[0]?.phone ?? null },
    waiting,
    working,
  };
}

const HANDOFF_NOTE: Record<string, string> = {
  cliente: "Pidió hablar con una persona",
  modelo: "El agente prefirió pasártela",
  error: "La respuesta automática falló",
  ventana: "Se cerró la ventana de 24 h",
  hostilidad: "Conversación delicada: tómala tú",
  manual_reply: "Respondiste desde el teléfono",
};

export type FeedRow = {
  id: string;
  contactId: string;
  name: string;
  /** Lo último que se dijo, tal cual. */
  preview: string | null;
  /** Qué pasa con esta conversación, en palabras. */
  note: string;
  state: SystemState;
  at: string | null;
};

export type Centro = {
  today: { conversations: number; solo: number; nuevos: number };
  waiting: number;
  feed: FeedRow[];
  timezone: string;
};

function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Inicio del SaaS: lo que pasó hoy (en la zona del negocio) y quién espera.
 * Mismas reglas que el punto, así que la tarjeta y el logotipo nunca se
 * contradicen.
 */
export async function getCentro(organizationId: string, conversations: ConversationDto[]): Promise<Centro> {
  const agent = await agentOn(organizationId);
  const tz = safeTimeZone(agent.timezone);
  // `created_at` guarda la hora UTC sin zona: la medianoche del negocio se
  // pasa a esa misma forma para compararla.
  const totals = await getDb().execute(sql`
      with bounds as (
        select ((date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) at time zone 'UTC') as start
      ),
      today_out as (
        select m.conversation_id,
               bool_or(m.origin = 'ai') as by_ai,
               bool_or(m.origin in ('operator', 'manual')) as by_person
        from message m
        join conversation c on c.id = m.conversation_id
        cross join bounds b
        where m.organization_id = ${organizationId} and c.is_test = false
          and c.handoff_at is null and m.direction = 'out' and m.created_at >= b.start
        group by m.conversation_id
      )
      select
        (select count(distinct m.conversation_id)
           from message m
           join conversation c on c.id = m.conversation_id
           cross join bounds b
          where m.organization_id = ${organizationId} and c.is_test = false
            and m.direction = 'in' and m.created_at >= b.start)::int as conversations,
        (select count(*) from today_out where by_ai and not by_person)::int as solo,
        (select count(*)
           from conversation c
           cross join bounds b
          where c.organization_id = ${organizationId} and c.is_test = false
            and c.created_at >= b.start)::int as nuevos
    `);

  const now = Date.now();
  const rows = conversations.map((c) => ({ c, state: conversationState(c, agent.on, now) }));
  // Primero lo que espera por una persona, después lo que el agente atiende
  // ahora, después lo más reciente (listConversations ya viene por recencia).
  const rank = { atencion: 0, atendiendo: 1, activo: 2, pausado: 2 } as const;
  const feed = [...rows]
    .sort((a, b) => rank[a.state] - rank[b.state])
    .slice(0, 7)
    .map(({ c, state }): FeedRow => ({
      id: c.id,
      contactId: c.contact.id,
      name: c.contact.name,
      preview: c.preview,
      note: c.handoffAt && state === "atencion"
        ? HANDOFF_NOTE[c.handoffReason ?? ""] ?? "Espera por ti"
        : conversationNote(c, state, now),
      state,
      at: c.lastMessageAt,
    }));
  const row = (totals as unknown as { conversations: number; solo: number; nuevos: number }[])[0];

  return {
    today: {
      conversations: row?.conversations ?? 0,
      solo: row?.solo ?? 0,
      nuevos: row?.nuevos ?? 0,
    },
    waiting: rows.filter((r) => r.state === "atencion").length,
    feed,
    timezone: tz,
  };
}

