import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { listConversations } from "@/server/inbox/queries";

export async function getOverview(organizationId: string) {
  const db = getDb();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 6);

  const [conversations, trendRows, pipelineRows, profileRows, runRows] = await Promise.all([
    listConversations(organizationId),
    db.select({
      date: sql<string>`to_char(date_trunc('day', ${schema.message.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      count: count(),
    })
      .from(schema.message)
      .innerJoin(schema.conversation, eq(schema.message.conversationId, schema.conversation.id))
      .where(scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.direction, "in"),
        eq(schema.conversation.isTest, false),
        gte(schema.message.createdAt, since)
      ))
      .groupBy(sql`date_trunc('day', ${schema.message.createdAt} at time zone 'UTC')`),
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
    db.select({ enabled: schema.agentProfile.enabled }).from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId)).limit(1),
    db.select().from(schema.agentTestRun)
      .where(and(eq(schema.agentTestRun.organizationId, organizationId), eq(schema.agentTestRun.status, "done")))
      .orderBy(desc(schema.agentTestRun.startedAt)).limit(2),
  ]);

  const trend = new Map(trendRows.map((row) => [row.date, row.count]));
  const inboundTrend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(since);
    date.setUTCDate(since.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: trend.get(key) ?? 0 };
  });

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
    inboundTrend,
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
