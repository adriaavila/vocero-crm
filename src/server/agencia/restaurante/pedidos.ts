import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  avisoDeEstado,
  isModalidad,
  puedePasar,
  resolverPedido,
  type EstadoPedido,
  type LineaPedida,
  type Modalidad,
  type Rechazo,
} from "@/lib/restaurante/pedido";
import { persistTestOutbound } from "@/server/ai/pipeline";
import { enviarAviso } from "@/server/agencia/avisos";
import { getBranding } from "@/server/branding";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { productosDelMenu } from "./menu";

/**
 * Fork — vertical restaurante: los pedidos.
 *
 * Tres reglas que no dependen de quién llame:
 * - Todo pedido nace «por_confirmar», lo arme el agente o una persona. A
 *   cocina solo lo pasa una persona (`cambiarEstado`, detrás de sesión).
 * - Los precios salen del menú al armar; el pedido guarda la foto.
 * - Un pedido de una conversación de prueba jamás sale a WhatsApp.
 */

export type PedidoVista = {
  id: string;
  number: number;
  status: EstadoPedido;
  mode: Modalidad | null;
  address: string | null;
  notes: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentStatus: "pendiente" | "cobrado";
  paymentMethod: "qr" | "efectivo" | "otro" | null;
  createdBy: "agente" | "persona";
  isTest: boolean;
  currency: string;
  conversationId: string | null;
  contactId: string | null;
  contactName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  items: {
    id: string;
    menuItemId: string | null;
    name: string;
    quantity: number;
    unitPriceCents: number;
    extras: { name: string; priceCents: number }[];
    note: string | null;
    lineTotalCents: number;
  }[];
};

type OrderRow = typeof schema.customerOrder.$inferSelect;

async function vistas(organizationId: string, rows: OrderRow[]): Promise<PedidoVista[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const [items, contacts, branding] = await Promise.all([
    db
      .select()
      .from(schema.customerOrderItem)
      .where(
        scoped(schema.customerOrderItem.organizationId, organizationId, inArray(schema.customerOrderItem.orderId, ids))
      )
      .orderBy(schema.customerOrderItem.position),
    contactIds.length
      ? db
          .select({ id: schema.contact.id, name: schema.contact.name })
          .from(schema.contact)
          .where(scoped(schema.contact.organizationId, organizationId, inArray(schema.contact.id, contactIds)))
      : Promise.resolve([]),
    getBranding(organizationId),
  ]);
  const nombre = new Map(contacts.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    mode: r.mode,
    address: r.address,
    notes: r.notes,
    subtotalCents: r.subtotalCents,
    deliveryFeeCents: r.deliveryFeeCents,
    totalCents: r.totalCents,
    paymentStatus: r.paymentStatus,
    paymentMethod: r.paymentMethod,
    createdBy: r.createdBy,
    isTest: r.isTest,
    currency: branding.currency,
    conversationId: r.conversationId,
    contactId: r.contactId,
    contactName: r.contactId ? (nombre.get(r.contactId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    items: items
      .filter((i) => i.orderId === r.id)
      .map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.name,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        extras: i.extras,
        note: i.note,
        lineTotalCents: i.lineTotalCents,
      })),
  }));
}

async function filaDe(organizationId: string, id: string): Promise<OrderRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.customerOrder)
    .where(and(scoped(schema.customerOrder.organizationId, organizationId), eq(schema.customerOrder.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function leerPedido(organizationId: string, id: string): Promise<PedidoVista | null> {
  const row = await filaDe(organizationId, id);
  return row ? ((await vistas(organizationId, [row]))[0] ?? null) : null;
}

/** Los pedidos de una conversación, el más nuevo primero. */
export async function pedidosDeConversacion(
  organizationId: string,
  conversationId: string,
  limit = 5
): Promise<PedidoVista[]> {
  const rows = await getDb()
    .select()
    .from(schema.customerOrder)
    .where(
      scoped(schema.customerOrder.organizationId, organizationId, eq(schema.customerOrder.conversationId, conversationId))
    )
    .orderBy(desc(schema.customerOrder.createdAt))
    .limit(limit);
  return vistas(organizationId, rows);
}

const ABIERTOS: EstadoPedido[] = ["por_confirmar", "en_cocina", "listo", "en_camino"];

/**
 * El tablero: todo lo que sigue abierto más lo cerrado en las últimas 18
 * horas (la noche de hoy). Los pedidos de prueba van aparte, marcados.
 */
export async function listarPedidos(organizationId: string, now = new Date()): Promise<PedidoVista[]> {
  const desde = new Date(now.getTime() - 18 * 3600 * 1000);
  const rows = await getDb()
    .select()
    .from(schema.customerOrder)
    .where(
      scoped(
        schema.customerOrder.organizationId,
        organizationId,
        or(inArray(schema.customerOrder.status, ABIERTOS), gte(schema.customerOrder.updatedAt, desde))
      )
    )
    .orderBy(desc(schema.customerOrder.createdAt))
    .limit(200);
  // Un pedido de prueba que nadie cerró deja de estorbar a las dos horas.
  const viejo = now.getTime() - 2 * 3600 * 1000;
  return vistas(
    organizationId,
    rows.filter((r) => !r.isTest || r.updatedAt.getTime() >= viejo)
  );
}

function total(subtotalCents: number, mode: Modalidad | null, deliveryFeeCents: number): number {
  return subtotalCents + (mode === "envio" ? deliveryFeeCents : 0);
}

function avisarCambio(organizationId: string, conversationId: string | null): void {
  if (!conversationId) return;
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
}

export type ArmarInput = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  isTest: boolean;
  lineas: LineaPedida[];
  mode?: string | null;
  address?: string | null;
  createdBy: "agente" | "persona";
  userId?: string | null;
};

export type ArmarResultado = {
  /** null cuando nada de lo pedido se pudo armar. */
  pedido: PedidoVista | null;
  rechazos: Rechazo[];
};

/**
 * Arma (o rearma) el pedido «por confirmar» de una conversación con los
 * precios del menú. Si la conversación ya tiene uno por confirmar, se
 * reemplazan sus líneas: el agente manda siempre el pedido completo.
 */
export async function armarPedido(input: ArmarInput, now = new Date()): Promise<ArmarResultado> {
  const db = getDb();
  const menu = await productosDelMenu(input.organizationId);
  const resuelto = resolverPedido(menu, input.lineas, now);
  if (resuelto.lineas.length === 0) return { pedido: null, rechazos: resuelto.rechazos };

  const mode = isModalidad(input.mode) ? input.mode : null;
  const address = input.address?.trim().slice(0, 300) || null;

  const id = await db.transaction(async (tx) => {
    const abiertos = await tx
      .select()
      .from(schema.customerOrder)
      .where(
        scoped(
          schema.customerOrder.organizationId,
          input.organizationId,
          eq(schema.customerOrder.conversationId, input.conversationId),
          eq(schema.customerOrder.status, "por_confirmar")
        )
      )
      .orderBy(desc(schema.customerOrder.createdAt))
      .limit(1);
    const abierto = abiertos[0];
    let orderId: string;
    if (abierto) {
      orderId = abierto.id;
      const nuevoModo = mode ?? abierto.mode;
      await tx
        .update(schema.customerOrder)
        .set({
          mode: nuevoModo,
          address: address ?? abierto.address,
          subtotalCents: resuelto.subtotalCents,
          totalCents: total(resuelto.subtotalCents, nuevoModo, abierto.deliveryFeeCents),
          updatedAt: now,
        })
        .where(eq(schema.customerOrder.id, orderId));
      await tx.delete(schema.customerOrderItem).where(eq(schema.customerOrderItem.orderId, orderId));
    } else {
      orderId = newId("customerOrder");
      // El consecutivo del negocio. El índice único lo protege de dos pedidos
      // simultáneos: el segundo falla y el turno degrada, no se duplica.
      const max = await tx
        .select({ n: sql<number>`coalesce(max(${schema.customerOrder.number}), 1000)` })
        .from(schema.customerOrder)
        .where(scoped(schema.customerOrder.organizationId, input.organizationId));
      await tx.insert(schema.customerOrder).values({
        id: orderId,
        organizationId: input.organizationId,
        number: Number(max[0]?.n ?? 1000) + 1,
        conversationId: input.conversationId,
        contactId: input.contactId,
        status: "por_confirmar",
        mode,
        address,
        subtotalCents: resuelto.subtotalCents,
        totalCents: resuelto.subtotalCents,
        createdBy: input.createdBy,
        createdByUserId: input.userId ?? null,
        isTest: input.isTest,
      });
    }
    await tx.insert(schema.customerOrderItem).values(
      resuelto.lineas.map((l, position) => ({
        id: newId("customerOrderItem"),
        organizationId: input.organizationId,
        orderId,
        menuItemId: l.menuItemId,
        name: l.name,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        extras: l.extras,
        note: l.note,
        lineTotalCents: l.lineTotalCents,
        position,
      }))
    );
    return orderId;
  });

  avisarCambio(input.organizationId, input.conversationId);
  const pedido = await leerPedido(input.organizationId, id);
  if (pedido && input.createdBy === "agente" && !input.isTest) {
    void enviarAviso(input.organizationId, {
      title: `Pedido #${pedido.number} por confirmar`,
      body: pedido.contactName ? `${pedido.contactName} espera tu confirmación.` : "Un cliente espera tu confirmación.",
      url: `/inbox?contact=${encodeURIComponent(input.contactId)}`,
      tag: `pedido-${pedido.id}`,
    }).catch((err) => console.warn("[avisos] pedido:", err instanceof Error ? err.message : err));
  }
  return { pedido, rechazos: resuelto.rechazos };
}

export type EditarInput = {
  mode?: Modalidad | null;
  address?: string | null;
  notes?: string | null;
  deliveryFeeCents?: number;
  /** Rearma las líneas desde el menú (mismos precios que si lo pidiera el agente). */
  lineas?: LineaPedida[];
};

export type Fallo = { ok: false; code: "no_existe" | "ya_no_se_edita" | "sin_lineas" | "falta_modalidad" | "transicion"; rechazos?: Rechazo[] };

/** Solo se edita mientras está por confirmar: después ya está en cocina. */
export async function editarPedido(
  organizationId: string,
  id: string,
  cambio: EditarInput,
  now = new Date()
): Promise<{ ok: true; pedido: PedidoVista } | Fallo> {
  const row = await filaDe(organizationId, id);
  if (!row) return { ok: false, code: "no_existe" };
  if (row.status !== "por_confirmar") return { ok: false, code: "ya_no_se_edita" };
  const db = getDb();

  let subtotal = row.subtotalCents;
  if (cambio.lineas) {
    const resuelto = resolverPedido(await productosDelMenu(organizationId), cambio.lineas, now);
    if (resuelto.lineas.length === 0 || resuelto.rechazos.length > 0) {
      return { ok: false, code: "sin_lineas", rechazos: resuelto.rechazos };
    }
    subtotal = resuelto.subtotalCents;
    await db.transaction(async (tx) => {
      await tx.delete(schema.customerOrderItem).where(eq(schema.customerOrderItem.orderId, id));
      await tx.insert(schema.customerOrderItem).values(
        resuelto.lineas.map((l, position) => ({
          id: newId("customerOrderItem"),
          organizationId,
          orderId: id,
          menuItemId: l.menuItemId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          extras: l.extras,
          note: l.note,
          lineTotalCents: l.lineTotalCents,
          position,
        }))
      );
    });
  }
  const mode = cambio.mode !== undefined ? cambio.mode : row.mode;
  const fee =
    cambio.deliveryFeeCents !== undefined
      ? Math.min(10_000_000, Math.max(0, Math.round(cambio.deliveryFeeCents)))
      : row.deliveryFeeCents;
  await db
    .update(schema.customerOrder)
    .set({
      mode,
      address: cambio.address !== undefined ? cambio.address?.trim().slice(0, 300) || null : row.address,
      notes: cambio.notes !== undefined ? cambio.notes?.trim().slice(0, 500) || null : row.notes,
      deliveryFeeCents: fee,
      subtotalCents: subtotal,
      totalCents: total(subtotal, mode, fee),
      updatedAt: now,
    })
    .where(eq(schema.customerOrder.id, id));
  avisarCambio(organizationId, row.conversationId);
  const pedido = await leerPedido(organizationId, id);
  return pedido ? { ok: true, pedido } : { ok: false, code: "no_existe" };
}

/** Le escribe al cliente. Devuelve false si no se pudo (ventana cerrada…). */
async function escribirAlCliente(row: OrderRow, text: string, userId: string | null): Promise<boolean> {
  if (!row.conversationId) return false;
  try {
    if (row.isTest) {
      await persistTestOutbound({ id: row.conversationId, organizationId: row.organizationId }, text);
    } else {
      await sendText({
        conversationId: row.conversationId,
        organizationId: row.organizationId,
        text,
        ...(userId ? { senderUserId: userId } : {}),
      });
    }
    return true;
  } catch (err) {
    console.warn("[pedidos] no se pudo avisar al cliente:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Mueve el pedido de estado, solo por una transición válida, y le avisa al
 * cliente lo que corresponde a ese paso (con el total real). Lo llama una
 * PERSONA con sesión: el agente no tiene este camino.
 */
export async function cambiarEstado(
  organizationId: string,
  id: string,
  hacia: EstadoPedido,
  userId: string | null,
  now = new Date()
): Promise<{ ok: true; pedido: PedidoVista; avisado: boolean | null } | Fallo> {
  const row = await filaDe(organizationId, id);
  if (!row) return { ok: false, code: "no_existe" };
  if (hacia !== "cancelado" && !row.mode) return { ok: false, code: "falta_modalidad" };
  const modalidad: Modalidad = row.mode ?? "retiro";
  if (!puedePasar(row.status, hacia, modalidad)) return { ok: false, code: "transicion" };

  // La condición sobre el estado anterior evita que dos toques simultáneos
  // manden dos avisos: el segundo no actualiza nada.
  const movidos = await getDb()
    .update(schema.customerOrder)
    .set({
      status: hacia,
      updatedAt: now,
      ...(hacia === "en_cocina" ? { confirmedAt: now } : {}),
      ...(hacia === "entregado" ? { deliveredAt: now } : {}),
      ...(hacia === "cancelado" ? { cancelledAt: now } : {}),
    })
    .where(
      and(
        scoped(schema.customerOrder.organizationId, organizationId),
        eq(schema.customerOrder.id, id),
        eq(schema.customerOrder.status, row.status)
      )
    )
    .returning({ id: schema.customerOrder.id });
  if (movidos.length === 0) return { ok: false, code: "transicion" };

  const branding = await getBranding(organizationId);
  const texto = avisoDeEstado({
    estado: hacia,
    modalidad,
    totalCents: row.totalCents,
    currency: branding.currency,
    number: row.number,
  });
  const avisado = texto ? await escribirAlCliente(row, texto, userId) : null;
  avisarCambio(organizationId, row.conversationId);
  const pedido = await leerPedido(organizationId, id);
  return pedido ? { ok: true, pedido, avisado } : { ok: false, code: "no_existe" };
}

/** allok REGISTRA el pago que el local ya recibió; no cobra. */
export async function registrarPago(
  organizationId: string,
  id: string,
  pago: { status: "pendiente" | "cobrado"; method?: "qr" | "efectivo" | "otro" | null }
): Promise<PedidoVista | null> {
  const rows = await getDb()
    .update(schema.customerOrder)
    .set({
      paymentStatus: pago.status,
      paymentMethod: pago.status === "cobrado" ? (pago.method ?? null) : null,
      updatedAt: new Date(),
    })
    .where(and(scoped(schema.customerOrder.organizationId, organizationId), eq(schema.customerOrder.id, id)))
    .returning();
  const row = rows[0];
  if (!row) return null;
  avisarCambio(organizationId, row.conversationId);
  return (await vistas(organizationId, [row]))[0] ?? null;
}
