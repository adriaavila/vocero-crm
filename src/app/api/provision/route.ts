import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveInstanceOrg } from "@/server/bot/auth";
import { saveCredentials } from "@/server/whatsapp/credentials";
import {
  isAuthorized,
  parseProvisionPayload,
  resolveTargetOrg,
} from "@/server/provision/payload";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * `POST /api/provision` — allok entrega aquí un número conectado.
 *
 * Cierra el hueco manual del alta: antes había que crear la conexión a mano,
 * copiar el token de WhatsApp y pegar la URL del webhook. Ahora allok empuja las
 * credenciales y recibe de vuelta a qué URL mandar los webhooks; sólo entonces
 * mueve la suscripción en Meta.
 *
 * El formato de error es `{ message }` a nivel raíz, no el `{ error: {...} }` de
 * la API interna: es lo que allok lee para mostrarle algo útil al operador.
 */
export const dynamic = "force-dynamic";

function fail(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const rl = checkRateLimit("provision", { windowMs: 60_000, max: 30 });
  if (!rl.allowed) return fail(429, "Demasiadas solicitudes de provisión.");

  if (!isAuthorized(req.headers.get("authorization"), process.env.PROVISION_API_KEY)) {
    return fail(401, "No autorizado.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "El cuerpo no es JSON válido.");
  }

  const parsed = parseProvisionPayload(body);
  if (!parsed.ok) return fail(400, parsed.message);

  const target = resolveTargetOrg(parsed.payload.organizationId, await resolveInstanceOrg());
  if (!target.ok) return fail(409, target.message);

  // El índice `meta_credentials_phone_uq` es de instancia: si ese número ya está
  // atado a otra organización, el upsert por organization_id no lo detectaría y
  // reventaría con un error de Postgres sin explicación para el operador.
  const db = getDb();
  const clash = await db
    .select({ organizationId: schema.metaCredentials.organizationId })
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, parsed.payload.phoneNumberId))
    .limit(1);
  if (clash[0] && clash[0].organizationId !== target.organizationId) {
    return fail(409, "Ese número ya está conectado a otra organización de esta instancia.");
  }

  try {
    await saveCredentials({
      organizationId: target.organizationId,
      wabaId: parsed.payload.wabaId,
      phoneNumberId: parsed.payload.phoneNumberId,
      token: parsed.payload.token,
      displayPhoneNumber: parsed.payload.displayPhoneNumber,
      verifiedName: parsed.payload.verifiedName,
    });
  } catch (err) {
    console.error("[provision] no se pudieron guardar las credenciales:", err);
    return fail(500, "No se pudieron guardar las credenciales.");
  }

  const env = getEnv();
  const organization = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, target.organizationId))
    .limit(1);

  return Response.json({
    organization_name: organization[0]?.name ?? null,
    // El segmento del path ES el verify token (ver webhooks/wa/[webhookToken]).
    webhook_url: new URL(
      `/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`,
      env.APP_BASE_URL
    ).toString(),
  });
}
