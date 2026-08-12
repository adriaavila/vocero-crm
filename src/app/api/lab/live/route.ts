import { and, asc, eq, gt, gte } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWahaConfigured } from "@/lib/env";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  getWahaQr,
  getWahaSession,
  sendWahaText,
  startWahaSession,
  WahaError,
} from "@/server/lab/waha";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["start", "run"]) });

export const GET = withOwner(async (_session, req: Request) => {
  if (!isWahaConfigured()) return Response.json({ configured: false });
  try {
    if (new URL(req.url).searchParams.has("qr")) {
      const qr = await getWahaQr();
      return new Response(qr.data, {
        headers: { "Content-Type": qr.type, "Cache-Control": "no-store" },
      });
    }
    const waha = await getWahaSession();
    return Response.json({
      configured: true,
      status: waha?.status ?? "STOPPED",
      phone: waha?.me?.id?.replace(/@.+$/, "") ?? null,
      name: waha?.me?.pushName ?? null,
    });
  } catch (error) {
    return wahaError(error);
  }
});

export const POST = withOwner(async (session, req: Request) => {
  if (!isWahaConfigured()) {
    return apiError(409, "waha_not_configured", "WAHA no está configurado");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    if (body.data.action === "start") {
      const waha = await startWahaSession();
      return Response.json({ status: waha?.status ?? "STARTING" });
    }

    const waha = await getWahaSession();
    if (waha?.status !== "WORKING") {
      return apiError(409, "waha_not_ready", "Vincula tu WhatsApp personal primero");
    }

    const [profile] = await getDb()
      .select({
        enabled: schema.agentProfile.activationEnabled,
        messages: schema.agentProfile.activationMessages,
      })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, session.organizationId))
      .limit(1);
    const trigger = profile?.enabled ? profile.messages[0]?.trim() : null;
    if (!trigger) {
      return apiError(409, "trigger_missing", "Configura un mensaje activador en Agente");
    }

    const credentials = await getCredentialsByOrg(session.organizationId);
    if (!credentials?.displayPhoneNumber) {
      return apiError(409, "whatsapp_missing", "Conecta el WhatsApp empresarial primero");
    }

    const startedAt = new Date();
    try {
      await sendWahaText(credentials.displayPhoneNumber, trigger);
      const result = await waitForReply(session.organizationId, trigger, startedAt);
      const elapsedMs = Date.now() - startedAt.getTime();
      await recordLiveTest(session.organizationId, Boolean(result), elapsedMs);
      if (!result) {
        return apiError(504, "live_test_timeout", "El mensaje salió, pero el agente no respondió en 90 segundos");
      }
      return Response.json({ trigger, reply: result.text, elapsedMs });
    } catch (error) {
      await recordLiveTest(session.organizationId, false, Date.now() - startedAt.getTime());
      throw error;
    }
  } catch (error) {
    return wahaError(error);
  }
});

async function recordLiveTest(organizationId: string, passed: boolean, elapsedMs: number) {
  await getDb()
    .update(schema.agentProfile)
    .set({
      lastLiveTestAt: new Date(),
      lastLiveTestPassed: passed,
      lastLiveTestElapsedMs: elapsedMs,
    })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
}

async function waitForReply(organizationId: string, trigger: string, startedAt: Date) {
  const db = getDb();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const [inbound] = await db
      .select({ conversationId: schema.message.conversationId, createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.direction, "in"),
          eq(schema.message.text, trigger),
          gte(schema.message.createdAt, startedAt)
        )
      )
      .orderBy(asc(schema.message.createdAt))
      .limit(1);
    if (inbound) {
      const [reply] = await db
        .select({ text: schema.message.text })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.organizationId, organizationId),
            eq(schema.message.conversationId, inbound.conversationId),
            eq(schema.message.direction, "out"),
            eq(schema.message.aiGenerated, true),
            gt(schema.message.createdAt, inbound.createdAt)
          )
        )
        .orderBy(asc(schema.message.createdAt))
        .limit(1);
      if (reply?.text) return reply;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

function wahaError(error: unknown): Response {
  if (error instanceof WahaError) {
    return apiError(error.status >= 400 && error.status < 600 ? error.status : 502, "waha_error", error.message);
  }
  throw error;
}
