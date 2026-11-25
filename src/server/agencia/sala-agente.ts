import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { derivedTitle } from "@/lib/realty/catalog";
import { casasNombradas, tarjetaYaEnviada } from "@/lib/sala-agente";
import { tarjetaCasa } from "@/lib/sala-whatsapp";
import { SendError, sendInteractive } from "@/server/inbox/send";
import { getOrgVertical } from "@/server/agencia/vertical";
import {
  MAX_CASAS_POR_SALA,
  getSalaDeContacto,
  getSalaPublica,
  guardarSala,
  salaVentaEnabled,
} from "@/server/agencia/sala-venta";

/**
 * El agente también muestra la casa: cuando su respuesta nombra una o dos
 * casas del catálogo, Rei manda la tarjeta de cada una (foto, precio, rasgos,
 * «Quiero visitar» y, si hay plan de pago, «Ver lo que pagaría») justo después
 * del texto. Vale igual para Nea (`/api/bot/messages`) que para el agente
 * interno: el que decide es el CRM, mirando lo que se mandó.
 *
 * La casa entra a la sala del contacto (se crea si no tenía), así que los
 * botones caen en el flujo de la sala de siempre (`atenderSalaEnWhatsapp`) y
 * el toque cuenta para «llámalos hoy».
 *
 * Detrás de `SALA_VENTA`, solo con el vertical inmobiliario, nunca en el
 * Laboratorio ni en un chat que tomó una persona. Mejor esfuerzo: si algo
 * falla, el texto del agente ya salió y el cliente no ve nada roto.
 */
export async function tarjetasTrasRespuesta(input: {
  organizationId: string;
  conversationId: string;
  texto: string;
}): Promise<number> {
  if (!salaVentaEnabled()) return 0;
  const { organizationId, conversationId } = input;
  if ((await getOrgVertical(organizationId)) !== "inmobiliario") return 0;

  const db = getDb();
  const [conv] = await db
    .select({
      contactId: schema.conversation.contactId,
      isTest: schema.conversation.isTest,
      channel: schema.conversation.channel,
      handoffAt: schema.conversation.handoffAt,
      aiEnabled: schema.conversation.aiEnabled,
    })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conv || conv.isTest || conv.channel !== "whatsapp" || conv.handoffAt || !conv.aiEnabled) return 0;

  const catalogo = (
    await db
      .select({
        id: schema.property.id,
        title: schema.property.title,
        kind: schema.property.kind,
        city: schema.property.city,
      })
      .from(schema.property)
      .where(
        scoped(
          schema.property.organizationId,
          organizationId,
          isNull(schema.property.archivedAt),
          ne(schema.property.status, "cerrada")
        )
      )
  ).map((p) => ({ id: p.id, titulo: p.title ?? derivedTitle(p.kind, p.city) }));
  if (catalogo.length === 0) return 0;

  // Tarjetas ya mandadas en este chat: la bandeja guarda el texto de cada una.
  const previas = await db
    .select({ text: schema.message.text })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        eq(schema.message.type, "interactive")
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(50);
  const textos = previas.map((m) => m.text ?? "");
  const yaEnviadas = new Set(catalogo.filter((c) => tarjetaYaEnviada(textos, c.titulo)).map((c) => c.id));

  const casas = casasNombradas(input.texto, catalogo, yaEnviadas);
  if (casas.length === 0) return 0;

  // Las casas nombradas entran a la sala (al frente; la sala tiene tope).
  const existente = await getSalaDeContacto(organizationId, conv.contactId);
  const ids = casas.map((c) => c.id);
  const propertyIds = [...ids, ...(existente?.propertyIds ?? []).filter((id) => !ids.includes(id))].slice(
    0,
    MAX_CASAS_POR_SALA
  );
  const sala = await guardarSala(organizationId, null, { contactId: conv.contactId, propertyIds });
  const datos = await getSalaPublica(sala.token);
  if (!datos) return 0;

  const base = getEnv().APP_BASE_URL.replace(/\/+$/, "");
  const absoluta = (url: string) => (url.startsWith("/") ? `${base}${url}` : url);
  let enviadas = 0;
  for (const id of ids) {
    const casa = datos.casas.find((c) => c.id === id);
    if (!casa) continue;
    const tarjeta = tarjetaCasa(
      {
        id: casa.id,
        titulo: casa.titulo,
        precio: casa.precio,
        moneda: casa.moneda,
        dormitorios: casa.dormitorios,
        banos: casa.banos,
        superficie: casa.superficie,
        estado: casa.estado,
      },
      { fotoUrl: casa.fotos[0] ? absoluta(casa.fotos[0]) : null, conCalculo: casa.calculo !== null, negocio: datos.negocio.nombre }
    );
    try {
      await sendInteractive({ conversationId, organizationId, ...tarjeta, automatico: true });
      enviadas++;
    } catch (err) {
      if (!(err instanceof SendError)) throw err;
      console.warn(`[sala-agente] tarjeta no enviada (${err.code}): ${err.message}`);
      break;
    }
  }
  return enviadas;
}

/** Para las rutas: dispara y no espera; un fallo solo queda en el log. */
export function tarjetasTrasRespuestaEnFondo(input: { organizationId: string; conversationId: string; texto: string }) {
  void tarjetasTrasRespuesta(input).catch((err) => console.warn(`[sala-agente] ${err}`));
}

