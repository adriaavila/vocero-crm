import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import {
  confirmacionVisita,
  leerAlquiler,
  leerBoton,
  linkSalaCompleta,
  mensajeCuota,
  pedirEnMonedaDeLaCasa,
  preguntaCuando,
  saludoWhatsapp,
  tarjetaCasa,
  type CasaWhatsapp,
} from "@/lib/sala-whatsapp";
import { applyHandoff } from "@/server/ai/pipeline";
import { SendError, sendInteractive, sendText } from "@/server/inbox/send";
import {
  SalaError,
  getSalaDeContacto,
  getSalaPublica,
  guardarSala,
  registrarSenalDeSala,
  salaVentaEnabled,
  type SalaPublica,
} from "@/server/agencia/sala-venta";

/**
 * La sala de venta DENTRO de WhatsApp: las casas como tarjetas con foto y
 * botones, el cálculo como imagen en la misma conversación, y la visita en
 * tres toques. El link de la sala sigue ahí, al final, para quien quiera ver
 * todo.
 *
 * Dos entradas:
 *  - `enviarSalaPorWhatsapp`: el asesor la manda desde el panel del contacto.
 *    Solo dentro de las 24 h (fuera de ellas Meta exige plantilla: ver
 *    `lib/sala-plantilla.ts`, que es un borrador sin enviar a Meta).
 *  - `atenderSalaEnWhatsapp`: el comprador tocó un botón de la sala o
 *    contestó cuánto paga de alquiler. Lo contesta la sala, no el agente.
 *
 * Detrás de `SALA_VENTA`, como el resto de la sala. Las conversaciones de
 * prueba siguen sin tocar Meta: el guard de `prepareSend` lo garantiza.
 */

/** Más tarjetas que esto en un chat ya es spam; las demás están en el link. */
const MAX_TARJETAS = 3;
/** Cuánto tiempo esperamos su respuesta al «¿cuánto pagas de alquiler?». */
const ESPERA_ALQUILER_MS = 24 * 60 * 60 * 1000;

type CasaSala = SalaPublica["casas"][number];

function absoluta(url: string, base: string): string {
  return url.startsWith("/") ? `${base.replace(/\/+$/, "")}${url}` : url;
}

function casaWhatsapp(casa: CasaSala): CasaWhatsapp {
  return {
    id: casa.id,
    titulo: casa.titulo,
    precio: casa.precio,
    moneda: casa.moneda,
    dormitorios: casa.dormitorios,
    banos: casa.banos,
    superficie: casa.superficie,
    estado: casa.estado,
  };
}

async function conversacionDeWhatsapp(organizationId: string, contactId: string) {
  const [row] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.channel, "whatsapp"),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  return row?.id ?? null;
}

/** El asesor manda la sala por WhatsApp: saludo, una tarjeta por casa y el link. */
export async function enviarSalaPorWhatsapp(input: {
  organizationId: string;
  contactId: string;
  userId: string | null;
  baseUrl: string;
}): Promise<{ mensajes: number }> {
  const { organizationId, contactId } = input;
  const conversationId = await conversacionDeWhatsapp(organizationId, contactId);
  if (!conversationId) {
    throw new SalaError("no_encontrado", "Este contacto todavía no te escribió por WhatsApp");
  }
  const sala =
    (await getSalaDeContacto(organizationId, contactId)) ??
    (await guardarSala(organizationId, input.userId, { contactId }));
  const datos = await getSalaPublica(sala.token);
  if (!datos || datos.casas.length === 0) {
    throw new SalaError("sin_casas", "La sala no tiene casas para mostrar");
  }

  const casas = datos.casas.filter((c) => c.estado !== "cerrada").slice(0, MAX_TARJETAS);
  const negocio = datos.negocio.nombre;
  const base = { conversationId, organizationId, senderUserId: input.userId ?? undefined };

  // El saludo primero: es el que falla con la ventana cerrada, antes de
  // dejar media sala mandada.
  await sendText({ ...base, text: saludoWhatsapp(datos.nombre, casas.length, negocio) });
  let mensajes = 1;
  for (const casa of casas) {
    const tarjeta = tarjetaCasa(casaWhatsapp(casa), {
      fotoUrl: casa.fotos[0] ? absoluta(casa.fotos[0], input.baseUrl) : null,
      conCalculo: casa.calculo !== null,
      negocio,
    });
    await sendInteractive({ ...base, ...tarjeta, automatico: false });
    mensajes++;
  }
  const link = linkSalaCompleta(`${input.baseUrl.replace(/\/+$/, "")}/s/${sala.token}`, negocio);
  await sendInteractive({ ...base, ...link, automatico: false });
  mensajes++;

  await getDb()
    .update(schema.salaVenta)
    .set({ enviadaWhatsappAt: new Date() })
    .where(scoped(schema.salaVenta.organizationId, organizationId, eq(schema.salaVenta.id, sala.id)));
  return { mensajes };
}

/** El cálculo con ESTA casa: imagen + el mismo cálculo en texto + botones. */
async function enviarCuota(
  sala: { id: string; token: string; organizationId: string },
  datos: SalaPublica,
  casa: CasaSala,
  conversationId: string
) {
  if (!casa.calculo || !datos.plan) return;
  const base = getEnv().APP_BASE_URL;
  const sabeAlquiler = datos.alquilerActual !== null;
  // `v` cambia con el alquiler: WhatsApp guarda la imagen por URL.
  const imagenUrl = `${base.replace(/\/+$/, "")}/api/s/${sala.token}/cuota/${casa.id}?v=${datos.alquilerActual ?? 0}`;
  const mensaje = mensajeCuota({
    casa: casaWhatsapp(casa),
    calculo: casa.calculo,
    plan: { nombre: datos.plan.nombre, aprobadoPor: datos.planAprobadoPor },
    imagenUrl,
    sabeAlquiler,
    negocio: datos.negocio.nombre,
  });
  await sendInteractive({ conversationId, organizationId: sala.organizationId, ...mensaje, automatico: true });
  await getDb()
    .update(schema.salaVenta)
    .set(
      sabeAlquiler
        ? { esperaAlquilerDe: null, esperaAlquilerAt: null }
        : { esperaAlquilerDe: casa.id, esperaAlquilerAt: new Date() }
    )
    .where(and(eq(schema.salaVenta.id, sala.id), eq(schema.salaVenta.organizationId, sala.organizationId)));
}

/**
 * Un mensaje del comprador que quizá es para la sala. true = lo contestó la
 * sala y el agente no debe hablar encima; false = sigue el camino de siempre.
 */
export async function atenderSalaEnWhatsapp(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  replyId: string | null;
  text: string | null;
}): Promise<boolean> {
  if (!salaVentaEnabled()) return false;
  const boton = leerBoton(input.replyId);
  const sala = await getSalaDeContacto(input.organizationId, input.contactId);
  if (!sala) return false;

  const esperando =
    !boton &&
    sala.esperaAlquilerDe !== null &&
    sala.esperaAlquilerAt !== null &&
    Date.now() - sala.esperaAlquilerAt.getTime() < ESPERA_ALQUILER_MS;
  if (!boton && !esperando) return false;

  const casaId = boton?.casaId ?? sala.esperaAlquilerDe!;
  if (!sala.propertyIds.includes(casaId)) return false;
  const datos = await getSalaPublica(sala.token);
  const casa = datos?.casas.find((c) => c.id === casaId);
  if (!datos || !casa) return false;
  const negocio = datos.negocio.nombre;
  const { conversationId, organizationId } = input;

  // Si una persona ya tomó la conversación, la sala no contesta por ella: la
  // señal se guarda igual (abajo) y el asesor ve el toque en la bandeja.
  const [conv] = await getDb()
    .select({ handoffAt: schema.conversation.handoffAt })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  const tomada = Boolean(conv?.handoffAt);
  const responder = (mensaje: { interactive: Record<string, unknown>; texto: string }) =>
    sendInteractive({ conversationId, organizationId, ...mensaje, automatico: true });

  if (esperando) {
    const leido = leerAlquiler(input.text ?? "", casa.moneda);
    // No es un monto: es otra pregunta, y esa la contesta el agente.
    if (!leido) return false;
    return conRespuesta(async () => {
      if ("otraMoneda" in leido) {
        await responder(pedirEnMonedaDeLaCasa(casaWhatsapp(casa), negocio));
        return;
      }
      await getDb()
        .update(schema.salaVenta)
        .set({ alquilerActual: String(leido.monto), updatedAt: new Date() })
        .where(and(eq(schema.salaVenta.id, sala.id), eq(schema.salaVenta.organizationId, organizationId)));
      const actualizada = await getSalaPublica(sala.token);
      const casaActualizada = actualizada?.casas.find((c) => c.id === casaId);
      if (actualizada && casaActualizada) await enviarCuota(sala, actualizada, casaActualizada, conversationId);
    }, tomada);
  }

  switch (boton!.accion) {
    case "cuota":
      await registrarSenalDeSala(sala, "calculadora");
      return conRespuesta(() => enviarCuota(sala, datos, casa, conversationId), tomada);
    case "sinalquiler":
      await getDb()
        .update(schema.salaVenta)
        .set({ esperaAlquilerDe: null, esperaAlquilerAt: null })
        .where(and(eq(schema.salaVenta.id, sala.id), eq(schema.salaVenta.organizationId, organizationId)));
      return conRespuesta(() => responder(preguntaCuando(casaWhatsapp(casa), negocio)), tomada);
    case "visita":
      await registrarSenalDeSala(sala, "visita");
      return conRespuesta(() => responder(preguntaCuando(casaWhatsapp(casa), negocio)), tomada);
    case "cuando":
      await registrarSenalDeSala(sala, "visita");
      if (tomada) return true;
      await conRespuesta(() => {
        const urlSala = `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/s/${sala.token}`;
        return responder(confirmacionVisita(boton!.cuando, negocio, urlSala));
      });
      // La visita la hace una persona: el agente se aparta y el dueño recibe el
      // aviso en su celular, aunque la confirmación no haya salido.
      await applyHandoff(conversationId, organizationId, "cliente");
      return true;
  }
}

/**
 * La señal ya quedó guardada. Si una persona tomó la conversación, la sala no
 * habla por ella; si el envío falla (Meta cae, ventana cerrada), el agente
 * tampoco improvisa encima: el asesor ve el toque en la bandeja y "llámalos
 * hoy" lo sube igual.
 */
async function conRespuesta(enviar: () => Promise<unknown>, tomada = false): Promise<true> {
  if (tomada) return true;
  try {
    await enviar();
  } catch (err) {
    if (!(err instanceof SendError)) throw err;
    console.warn(`[sala] no se contestó por WhatsApp (${err.code}): ${err.message}`);
  }
  return true;
}
