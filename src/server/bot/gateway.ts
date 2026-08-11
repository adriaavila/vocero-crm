import { and, asc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeMx } from "@/lib/meta/client";
import { renderKb } from "@/server/ai/prompts";
import { applyHandoff } from "@/server/ai/pipeline";
import { publish } from "@/server/events/bus";
import { getUpcomingBooking } from "@/server/calendar";
import { isWindowOpen } from "@/server/inbox/window";

export type HandoffReason =
  | "cliente"
  | "modelo"
  | "error"
  | "ventana"
  | "hostilidad";

export async function getBotProfile(organizationId: string) {
  const db = getDb();
  const [profiles, kb] = await Promise.all([
    db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    db
      .select()
      .from(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, organizationId))
      .orderBy(asc(schema.kbEntry.createdAt)),
  ]);
  const profile = profiles[0];
  if (!profile) return null;
  return {
    profile: {
      name: profile.name,
      tone: profile.tone,
      instructions: profile.instructions,
      escalationRules: profile.escalationRules,
      greeting: profile.greeting,
      presetOnly: profile.presetOnly,
      presetReplies: profile.presetReplies,
    },
    kb: renderKb(kb),
    resources: [],
  };
}

export async function getBotContext(
  organizationId: string,
  rawIdentity: string
) {
  const waIdentity = rawIdentity.startsWith("bsuid:")
    ? rawIdentity
    : normalizeMx(rawIdentity);
  const db = getDb();
  const rows = await db
    .select({ contact: schema.contact, conversation: schema.conversation })
    .from(schema.contact)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.conversation.isTest, false),
        or(
          eq(schema.contact.waIdentity, waIdentity),
          eq(schema.contact.phone, waIdentity),
          rawIdentity.startsWith("bsuid:")
            ? eq(schema.contact.waUserId, rawIdentity.slice("bsuid:".length))
            : undefined
        )
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const [leadRows, booking] = await Promise.all([
    db
      .select({ lead: schema.lead, stage: schema.pipelineStage })
      .from(schema.lead)
      .innerJoin(
        schema.pipelineStage,
        eq(schema.lead.stageId, schema.pipelineStage.id)
      )
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, row.contact.id)
        )
      )
      .limit(1),
    getUpcomingBooking(organizationId, row.contact.id),
  ]);
  const lead = leadRows[0];
  return {
    contact: {
      id: row.contact.id,
      name: row.contact.name,
      phone: row.contact.phone,
      ficha: row.contact.ficha,
    },
    lead: lead
      ? { id: lead.lead.id, stageName: lead.stage.name }
      : null,
    conversation: {
      id: row.conversation.id,
      aiEnabled:
        row.conversation.aiEnabled && !Boolean(row.conversation.handoffAt),
      windowOpen: isWindowOpen(row.conversation.lastInboundAt),
      handoffReason: row.conversation.handoffReason,
    },
    adOrigen: null,
    booking: { next: booking },
  };
}

export async function mergeFicha(input: {
  organizationId: string;
  conversationId: string;
  patch: Record<string, unknown>;
}) {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const ficha = { ...(row.contact.ficha ?? {}), ...input.patch };
  await db
    .update(schema.contact)
    .set({ ficha, updatedAt: new Date() })
    .where(eq(schema.contact.id, row.contact.id));

  const [leadRows, stages] = await Promise.all([
    db
      .select()
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, input.organizationId),
          eq(schema.lead.contactId, row.contact.id)
        )
      )
      .limit(1),
    db
      .select()
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, input.organizationId))
      .orderBy(asc(schema.pipelineStage.position)),
  ]);
  const lead = leadRows[0];
  let targetStageId: string | null = null;
  const open = stages.filter((stage) => stage.kind === "open");
  if (input.patch.resultado === "dio_diy") {
    targetStageId = stages.find((stage) => stage.kind === "lost")?.id ?? null;
  } else if (
    input.patch.calificado === true ||
    input.patch.resultado === "agendo"
  ) {
    targetStageId = open.at(-1)?.id ?? null;
  } else if (lead?.stageId === open[0]?.id && open[1]) {
    targetStageId = open[1].id;
  }

  const stageMoved = Boolean(
    lead && targetStageId && targetStageId !== lead.stageId
  );
  if (lead && stageMoved) {
    await db
      .update(schema.lead)
      .set({
        stageId: targetStageId!,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.lead.id, lead.id));
  }

  publish(input.organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: input.conversationId } },
  });
  return { ficha, stageMoved };
}

export async function handoffConversation(input: {
  organizationId: string;
  conversationId: string;
  reason: HandoffReason;
}): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  if (!rows[0]) return false;
  await applyHandoff(
    input.conversationId,
    input.organizationId,
    input.reason
  );
  return true;
}
