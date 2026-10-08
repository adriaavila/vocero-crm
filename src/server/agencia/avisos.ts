import { createECDH, hkdfSync } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { textoAviso, type Aviso } from "@/lib/avisos";

/**
 * Fork — avisos al celular (Web Push).
 *
 * Un empleado que pasa un cliente al jefe y el jefe no se entera no sirve: el
 * cliente que pidió una persona se queda esperando y el negocio lo pierde.
 * Hasta aquí la única forma de enterarse era tener la bandeja abierta. Con
 * esto, cada persona del negocio que dijo «avísame» en su teléfono recibe una
 * notificación cuando el agente traspasa una conversación o agenda una cita.
 *
 * Sin dependencia de terceros con cuenta: Web Push es un estándar del
 * navegador. Las llaves VAPID (las que firman los avisos) se DERIVAN de
 * `ENCRYPTION_KEY`, así no hay variable nueva que poner en producción ni
 * secreto que guardar. Todo aquí es mejor esfuerzo: un aviso que falla jamás
 * tumba el turno del agente ni la respuesta de la ruta que lo disparó.
 */

type Vapid = { publicKey: string; privateKey: string };

const ORDEN_P256 = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

let cachedVapid: { key: string; vapid: Vapid } | null = null;

/** Par de llaves P-256 estable para esta instancia, derivado de ENCRYPTION_KEY. */
export function vapidKeys(): Vapid {
  const secret = getEnv().ENCRYPTION_KEY;
  if (cachedVapid?.key === secret) return cachedVapid.vapid;
  const ikm = Buffer.from(secret, "base64");
  // Casi siempre el primer intento cae dentro del orden de la curva; el
  // contador solo existe para el caso (≈2⁻³²) en que no.
  for (let i = 0; i < 16; i++) {
    const priv = Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), `allok-vapid-${i}`, 32));
    const n = BigInt(`0x${priv.toString("hex")}`);
    if (n === BigInt(0) || n >= ORDEN_P256) continue;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    const vapid = {
      publicKey: ecdh.getPublicKey().toString("base64url"),
      privateKey: priv.toString("base64url"),
    };
    cachedVapid = { key: secret, vapid };
    return vapid;
  }
  throw new Error("No se pudo derivar la llave VAPID");
}

export function vapidPublicKey(): string {
  return vapidKeys().publicKey;
}

/** Quién firma los avisos (lo exige el estándar; los servicios de push lo usan para contactar). */
function vapidSubject(): string {
  try {
    const url = new URL(getEnv().APP_BASE_URL);
    // Apple rechaza `localhost` como sujeto: en local se usa un mailto neutro.
    return url.protocol === "https:" ? url.origin : "mailto:avisos@allok.fun";
  } catch {
    return "mailto:avisos@allok.fun";
  }
}

export type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Guarda (o re-asigna) la suscripción de este navegador a esta persona y negocio. */
export async function guardarSuscripcion(input: {
  organizationId: string;
  userId: string;
  subscription: SubscriptionInput;
  userAgent: string | null;
  id: string;
}): Promise<void> {
  await getDb()
    .insert(schema.pushSubscription)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: schema.pushSubscription.endpoint,
      set: {
        organizationId: input.organizationId,
        userId: input.userId,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
}

export async function borrarSuscripcion(organizationId: string, endpoint: string): Promise<void> {
  await getDb()
    .delete(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        eq(schema.pushSubscription.endpoint, endpoint)
      )
    );
}

export async function tieneSuscripcion(organizationId: string, endpoint: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.pushSubscription.id })
    .from(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        eq(schema.pushSubscription.endpoint, endpoint)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Manda el aviso a todos los teléfonos del negocio. Devuelve cuántos lo
 * aceptaron. Las suscripciones que el servicio de push da por muertas (404 /
 * 410: el dueño revocó el permiso o desinstaló) se borran solas.
 */
export async function enviarAviso(
  organizationId: string,
  aviso: { title: string; body: string; url: string; tag: string }
): Promise<number> {
  const db = getDb();
  const subs = await db
    .select()
    .from(schema.pushSubscription)
    .where(scoped(schema.pushSubscription.organizationId, organizationId));
  if (subs.length === 0) return 0;

  const vapid = vapidKeys();
  const payload = JSON.stringify(aviso);
  const muertas: string[] = [];
  const entregadas: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          {
            vapidDetails: { subject: vapidSubject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey },
            // Un aviso de "te necesitan" que llega mañana ya no sirve.
            TTL: 4 * 60 * 60,
            urgency: "high",
            timeout: 8_000,
          }
        );
        entregadas.push(s.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) muertas.push(s.id);
        else console.warn(`[avisos] no se pudo avisar (${status ?? "red"})`);
      }
    })
  );
  if (muertas.length > 0) {
    await db.delete(schema.pushSubscription).where(inArray(schema.pushSubscription.id, muertas));
  }
  if (entregadas.length > 0) {
    await db
      .update(schema.pushSubscription)
      .set({ lastSentAt: new Date() })
      .where(inArray(schema.pushSubscription.id, entregadas));
  }
  return entregadas.length;
}

/** Un traspaso por conversación cada tanto: reintentos y ecos no repiten el aviso. */
const REPETIR_TRAS_MS = 30 * 60_000;
const globalForAvisos = globalThis as unknown as { __voceroAvisados?: Map<string, number> };

function yaAvisado(clave: string): boolean {
  if (!globalForAvisos.__voceroAvisados) globalForAvisos.__voceroAvisados = new Map();
  const mapa = globalForAvisos.__voceroAvisados;
  const ahora = Date.now();
  const antes = mapa.get(clave);
  if (antes && ahora - antes < REPETIR_TRAS_MS) return true;
  mapa.set(clave, ahora);
  if (mapa.size > 5_000) {
    for (const [k, t] of mapa) if (ahora - t >= REPETIR_TRAS_MS) mapa.delete(k);
  }
  return false;
}

/**
 * El agente pasó la conversación a una persona. Se dispara y se olvida: quien
 * llama no espera la red de los servicios de push.
 */
export function avisarTraspaso(organizationId: string, conversationId: string, reason: string): void {
  void avisarTraspasoAhora(organizationId, conversationId, reason).catch((err) => {
    console.warn("[avisos] traspaso:", err instanceof Error ? err.message : err);
  });
}

export async function avisarTraspasoAhora(
  organizationId: string,
  conversationId: string,
  reason: string
): Promise<number> {
  // La pausa porque el dueño contestó desde el teléfono no es un pedido: él ya está ahí.
  if (reason === "manual_reply" || reason === "ventana") return 0;
  if (yaAvisado(`traspaso:${conversationId}`)) return 0;
  const db = getDb();
  const rows = await db
    .select({
      isTest: schema.conversation.isTest,
      contactId: schema.contact.id,
      name: schema.contact.name,
      phone: schema.contact.phone,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  const conv = rows[0];
  if (!conv || conv.isTest) return 0;
  const last = await db
    .select({ text: schema.message.text })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "in")
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const aviso: Aviso = {
    kind: "traspaso",
    reason,
    nombre: conv.name || conv.phone || null,
    ultimoMensaje: last[0]?.text ?? null,
  };
  return enviarAviso(organizationId, {
    ...textoAviso(aviso),
    url: `/inbox?contact=${encodeURIComponent(conv.contactId)}`,
    tag: `traspaso-${conversationId}`,
  });
}

/** El agente agendó una cita. */
export function avisarCita(input: {
  organizationId: string;
  contactId: string;
  nombre: string | null;
  cuando: string;
  isTest: boolean;
  bookingId: string;
}): void {
  if (input.isTest) return;
  void enviarAviso(input.organizationId, {
    ...textoAviso({ kind: "cita", nombre: input.nombre, cuando: input.cuando }),
    url: `/inbox?contact=${encodeURIComponent(input.contactId)}`,
    tag: `cita-${input.bookingId}`,
  }).catch((err) => {
    console.warn("[avisos] cita:", err instanceof Error ? err.message : err);
  });
}
