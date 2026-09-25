import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { dayIsoInTz, eachDateInRange, isValidTimeZone, todayInTz } from "@/lib/time/slots";
import { listConversations } from "@/server/inbox/queries";
import type { ConversationDto } from "@/lib/types";

const DAY_MS = 86_400_000;

/**
 * Los 7 días que terminan hoy en la zona del negocio (UTC si no hay una
 * válida), con los entrantes de cada uno. En días UTC, el jueves 21:10 de
 * Caracas ya es viernes: la barra de «hoy» decía «vie» y lo de esa noche
 * contaba para el día siguiente.
 */
export function inboundByDay(rows: { at: Date; count: number }[], timezone: string | undefined, now: Date) {
  const tz = timezone && isValidTimeZone(timezone) ? timezone : "UTC";
  const today = todayInTz(now, tz);
  const first = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  const counts = new Map(eachDateInRange(first, today).map((date) => [date, 0]));
  for (const row of rows) {
    const date = dayIsoInTz(row.at, tz);
    const total = counts.get(date);
    if (total !== undefined) counts.set(date, total + row.count);
  }
  return Array.from(counts, ([date, total]) => ({ date, count: total }));
}

/** `conversationList`: la lista ya cargada, si quien llama también la usa (Inicio del SaaS). */
export async function getOverview(organizationId: string, conversationList?: ConversationDto[]) {
  const db = getDb();
  const now = new Date();
  // Ocho días cubren la semana local en cualquier zona; lo anterior a su
  // primer día se descarta al contar.
  const since = new Date(now.getTime() - 8 * DAY_MS);
  // ponytail: tramos de una hora UTC, exactos en zonas de hora entera (toda
  // LATAM). Una zona de :30 o :45 pediría tramos de 15 min (`date_bin`).
  const hour = sql<Date>`date_trunc('hour', ${schema.message.createdAt})`.mapWith(schema.message.createdAt);

  const [conversations, trendRows, pipelineRows, profileRows, runRows] = await Promise.all([
    conversationList ?? listConversations(organizationId),
    db.select({ at: hour, count: count() })
      .from(schema.message)
      .innerJoin(schema.conversation, eq(schema.message.conversationId, schema.conversation.id))
      .where(scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.direction, "in"),
        eq(schema.conversation.isTest, false),
        gte(schema.message.createdAt, since)
      ))
      .groupBy(hour),
    db.select({
      stageId: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      kind: schema.pipelineStage.kind,
      position: schema.pipelineStage.position,
      count: count(schema.lead.id),
    })
      .from(schema.pipelineStage)
      .leftJoin(schema.lead, and(
        eq(schema.lead.stageId, schema.pipelineStage.id),
        eq(schema.lead.organizationId, organizationId)
      ))
      .where(eq(schema.pipelineStage.organizationId, organizationId))
      .groupBy(schema.pipelineStage.id)
      .orderBy(schema.pipelineStage.position),
    db.select({ enabled: schema.agentProfile.enabled, timezone: schema.agentProfile.businessTimezone }).from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId)).limit(1),
    db.select().from(schema.agentTestRun)
      .where(and(eq(schema.agentTestRun.organizationId, organizationId), eq(schema.agentTestRun.status, "done")))
      .orderBy(desc(schema.agentTestRun.startedAt)).limit(2),
  ]);

  const latest = runRows[0] ?? null;
  const redRows = latest
    ? await db.select({ count: count() }).from(schema.agentTestCase).where(and(
        eq(schema.agentTestCase.organizationId, organizationId),
        eq(schema.agentTestCase.runId, latest.id),
        eq(schema.agentTestCase.veredicto, "rojo")
      ))
    : [{ count: 0 }];
  const previous = runRows[1] ?? null;

  const priorities = conversations
    .filter((conversation) => conversation.handoffAt || conversation.unreadCount > 0)
    .sort((a, b) => {
      const handoff = Number(Boolean(b.handoffAt)) - Number(Boolean(a.handoffAt));
      if (handoff) return handoff;
      return new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime();
    })
    .slice(0, 8);

  return {
    summary: {
      unreadConversations: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
      pendingHandoffs: conversations.filter((item) => item.handoffAt).length,
      activeWindows: conversations.filter((item) => item.windowOpen).length,
      agentEnabled: Boolean(profileRows[0]?.enabled),
    },
    inboundTrend: inboundByDay(trendRows, profileRows[0]?.timezone, now),
    pipeline: pipelineRows.map(({ stageId, name, kind, count: total }) => ({ stageId, name, kind, count: total })),
    priorities,
    latestLab: latest?.finishedAt && latest.score !== null
      ? {
          score: latest.score,
          delta: previous?.score !== null && previous?.score !== undefined ? latest.score - previous.score : null,
          redCount: redRows[0]?.count ?? 0,
          finishedAt: latest.finishedAt.toISOString(),
        }
      : null,
  };
}
