import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { WebhookReferral } from "@/server/inbox/webhook";

/**
 * 016 — Captura del origen del anuncio.
 *
 * El `referral` solo llega cuando el mensaje viene de un anuncio
 * Click-to-WhatsApp, y normalmente solo en el PRIMER mensaje de la
 * conversación. Su `ctwa_clid` es la llave de todo lo demás: sin él no hay nada
 * que reportarle a Meta después.
 */

export async function recordAttribution(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  referral: WebhookReferral;
}): Promise<void> {
  const db = getDb();
  const r = input.referral;
  await db
    .insert(schema.adAttribution)
    .values({
      id: newId("adAttribution"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      ctwaClid: r.ctwa_clid ?? null,
      sourceId: r.source_id ?? null,
      sourceType: r.source_type ?? null,
      sourceUrl: r.source_url ?? null,
      headline: r.headline ?? null,
      body: r.body ?? null,
      mediaType: r.media_type ?? null,
      raw: r,
    })
    // El primer referral gana. `ON CONFLICT DO NOTHING` sobre el UNIQUE de
    // (org, conversación) —y no un "consulta y luego inserta"— porque Meta
    // reintenta el webhook y dos entregas simultáneas ganarían la carrera las
    // dos (Constitución IV).
    .onConflictDoNothing({
      target: [
        schema.adAttribution.organizationId,
        schema.adAttribution.conversationId,
      ],
    });
}

export async function getAttributionForConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, organizationId),
        eq(schema.adAttribution.conversationId, conversationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
