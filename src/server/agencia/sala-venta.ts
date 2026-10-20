import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { derivedTitle } from "@/lib/realty/catalog";
import { calcularCuotas, validarPlan, type PasoPlan, type PlanPago } from "@/lib/sala-cuotas";
import { palabrasProhibidas } from "@/lib/sala-palabras";
import { llamarHoy, puntuarSala } from "@/lib/sala-senal";
import { getBranding } from "@/server/branding";
import { matchesForLead } from "@/server/realty/matches";
import { isR2Configured } from "@/lib/env";
import { publicUrl } from "@/server/storage/r2";

/**
 * Sala de venta personal: un link por comprador con las casas que le caben,
 * el cálculo de su plan de pago y un botón para pedir visita.
 *
 * Detrás de la bandera de despliegue `SALA_VENTA` (apagada: toda la superficie
 * da 404) y, además, solo para organizaciones con el vertical inmobiliario
 * (`withRealty`). allok.fun no la ve.
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function salaVentaEnabled(): boolean {
  return ON_VALUES.has((process.env.SALA_VENTA ?? "").trim().toLowerCase());
}

/** Cuántas casas como máximo muestra una sala: más que eso ya es un catálogo. */
export const MAX_CASAS_POR_SALA = 4;

export class SalaError extends Error {
  constructor(
    readonly code: "plan_invalido" | "palabra_prohibida" | "no_encontrado" | "sin_casas",
    message: string
  ) {
    super(message);
    this.name = "SalaError";
  }
}

/** Un texto que verá el comprador no puede llevar palabras prohibidas. */
function exigirSinPalabrasProhibidas(campo: string, texto: string | null | undefined) {
  if (!texto) return;
  const encontradas = palabrasProhibidas(texto);
  if (encontradas.length > 0) {
    throw new SalaError(
      "palabra_prohibida",
      `${campo} usa ${encontradas.map((p) => `«${p}»`).join(", ")}, que la constructora no puede decir sin aprobación legal`
    );
  }
}

/* ---------- Planes de pago ---------- */

const PasoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("unico"),
    etiqueta: z.string().trim().min(1).max(60),
    porcentaje: z.number().positive().max(100),
    mes: z.number().int().min(0).max(120),
  }),
  z.object({
    tipo: z.literal("mensual"),
    etiqueta: z.string().trim().min(1).max(60),
    porcentaje: z.number().positive().max(100),
    desdeMes: z.number().int().min(0).max(120),
    hastaMes: z.number().int().min(0).max(120),
  }),
]);

export const PlanInputSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  reserva: z.number().min(0),
  mesEntrega: z.number().int().min(0).max(120),
  pasos: z.array(PasoSchema).min(1).max(12),
  aprobadoPor: z.string().trim().min(2).max(120),
});

type PlanRow = typeof schema.planPago.$inferSelect;

export function planDeFila(row: PlanRow): PlanPago {
  return {
    nombre: row.nombre,
    reserva: Number(row.reserva),
    mesEntrega: row.mesEntrega,
    pasos: row.pasos as PasoPlan[],
  };
}

export function serializarPlan(row: PlanRow) {
  return {
    id: row.id,
    ...planDeFila(row),
    aprobadoPor: row.aprobadoPor,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listarPlanes(organizationId: string): Promise<PlanRow[]> {
  return getDb()
    .select()
    .from(schema.planPago)
    .where(scoped(schema.planPago.organizationId, organizationId, isNull(schema.planPago.archivedAt)))
    .orderBy(asc(schema.planPago.createdAt));
}

export async function crearPlan(
  organizationId: string,
  input: z.infer<typeof PlanInputSchema>
): Promise<PlanRow> {
  const plan: PlanPago = {
    nombre: input.nombre,
    reserva: input.reserva,
    mesEntrega: input.mesEntrega,
    pasos: input.pasos,
  };
  const errores = validarPlan(plan);
  if (errores.length > 0) throw new SalaError("plan_invalido", errores.join(". "));
  exigirSinPalabrasProhibidas("El nombre del plan", input.nombre);
  for (const paso of input.pasos) exigirSinPalabrasProhibidas("Un paso del plan", paso.etiqueta);

  const [row] = await getDb()
    .insert(schema.planPago)
    .values({
      id: newId("planPago"),
      organizationId,
      nombre: input.nombre,
      reserva: String(input.reserva),
      mesEntrega: input.mesEntrega,
      pasos: input.pasos,
      aprobadoPor: input.aprobadoPor,
    })
    .returning();
  return row!;
}

/** Cambiar montos es crear otro plan: archivar no borra lo que ya vio un cliente. */
export async function archivarPlan(organizationId: string, planId: string): Promise<boolean> {
  const rows = await getDb()
    .update(schema.planPago)
    .set({ archivedAt: new Date() })
    .where(scoped(schema.planPago.organizationId, organizationId, eq(schema.planPago.id, planId)))
    .returning({ id: schema.planPago.id });
  return rows.length > 0;
}

/* ---------- Salas ---------- */

type SalaRow = typeof schema.salaVenta.$inferSelect;

export const SalaInputSchema = z.object({
  contactId: z.string().min(1),
  propertyIds: z.array(z.string().min(1)).max(MAX_CASAS_POR_SALA).optional(),
  planPagoId: z.string().min(1).nullable().optional(),
  alquilerActual: z.number().min(0).max(1_000_000).nullable().optional(),
  saludo: z.string().trim().max(400).nullable().optional(),
});

function nuevoToken(): string {
  return randomBytes(18).toString("base64url");
}

export function serializarSala(row: SalaRow, baseUrl: string) {
  const { puntos, motivo } = puntuarSala(row, new Date());
  return {
    id: row.id,
    contactId: row.contactId,
    url: `${baseUrl.replace(/\/+$/, "")}/s/${row.token}`,
    propertyIds: row.propertyIds,
    planPagoId: row.planPagoId,
    alquilerActual: row.alquilerActual === null ? null : Number(row.alquilerActual),
    saludo: row.saludo,
    aperturas: row.aperturas,
    ultimaAperturaAt: row.ultimaAperturaAt?.toISOString() ?? null,
    calculadoraAt: row.calculadoraAt?.toISOString() ?? null,
    visitaPedidaAt: row.visitaPedidaAt?.toISOString() ?? null,
    puntos,
    motivo,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getSalaDeContacto(
  organizationId: string,
  contactId: string
): Promise<SalaRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.salaVenta)
    .where(scoped(schema.salaVenta.organizationId, organizationId, eq(schema.salaVenta.contactId, contactId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Las casas que se ponen solas: las mejores del matching si el contacto tiene
 * lead con requerimiento, si no las disponibles más nuevas. El dueño las
 * cambia después; lo importante es que el primer link no salga vacío.
 */
async function casasPorDefecto(organizationId: string, contactId: string): Promise<string[]> {
  const db = getDb();
  const [lead] = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId)))
    .limit(1);
  if (lead) {
    const matches = await matchesForLead({ organizationId, leadId: lead.id, limit: 3 });
    if (matches.length > 0) return matches.map((m) => m.property.id);
  }
  const rows = await db
    .select({ id: schema.property.id })
    .from(schema.property)
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        isNull(schema.property.archivedAt),
        eq(schema.property.status, "disponible"),
        eq(schema.property.operation, "venta")
      )
    )
    .orderBy(desc(schema.property.createdAt))
    .limit(3);
  return rows.map((r) => r.id);
}

/** Solo ids de propiedades de ESTA organización y no archivadas. */
async function filtrarCasas(organizationId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ id: schema.property.id })
    .from(schema.property)
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        inArray(schema.property.id, ids),
        isNull(schema.property.archivedAt)
      )
    );
  const validos = new Set(rows.map((r) => r.id));
  return ids.filter((id) => validos.has(id));
}

async function exigirContacto(organizationId: string, contactId: string) {
  const [row] = await getDb()
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  if (!row) throw new SalaError("no_encontrado", "El contacto no existe");
}

async function exigirPlan(organizationId: string, planId: string) {
  const [row] = await getDb()
    .select({ id: schema.planPago.id })
    .from(schema.planPago)
    .where(
      scoped(
        schema.planPago.organizationId,
        organizationId,
        eq(schema.planPago.id, planId),
        isNull(schema.planPago.archivedAt)
      )
    )
    .limit(1);
  if (!row) throw new SalaError("no_encontrado", "El plan de pago no existe");
}

/** Crea la sala del contacto o actualiza la que ya tiene (el link no cambia). */
export async function guardarSala(
  organizationId: string,
  userId: string | null,
  input: z.infer<typeof SalaInputSchema>
): Promise<SalaRow> {
  await exigirContacto(organizationId, input.contactId);
  exigirSinPalabrasProhibidas("El saludo", input.saludo);
  if (input.planPagoId) await exigirPlan(organizationId, input.planPagoId);

  const existente = await getSalaDeContacto(organizationId, input.contactId);
  const propertyIds =
    input.propertyIds !== undefined
      ? await filtrarCasas(organizationId, input.propertyIds)
      : existente?.propertyIds ?? (await casasPorDefecto(organizationId, input.contactId));
  if (propertyIds.length === 0) {
    throw new SalaError("sin_casas", "Carga al menos una propiedad disponible para armar la sala");
  }

  const cambios = {
    propertyIds,
    ...(input.planPagoId !== undefined ? { planPagoId: input.planPagoId } : {}),
    ...(input.alquilerActual !== undefined
      ? { alquilerActual: input.alquilerActual === null ? null : String(input.alquilerActual) }
      : {}),
    ...(input.saludo !== undefined ? { saludo: input.saludo || null } : {}),
    updatedAt: new Date(),
  };

  const db = getDb();
  if (existente) {
    const [row] = await db
      .update(schema.salaVenta)
      .set(cambios)
      .where(scoped(schema.salaVenta.organizationId, organizationId, eq(schema.salaVenta.id, existente.id)))
      .returning();
    return row!;
  }

  // Sin plan elegido, el primero aprobado: la calculadora es la mitad del valor.
  let planPagoId = input.planPagoId ?? null;
  if (planPagoId === null && input.planPagoId === undefined) {
    planPagoId = (await listarPlanes(organizationId))[0]?.id ?? null;
  }

  const [row] = await db
    .insert(schema.salaVenta)
    .values({
      id: newId("salaVenta"),
      organizationId,
      contactId: input.contactId,
      token: nuevoToken(),
      createdBy: userId,
      ...cambios,
      planPagoId,
    })
    .onConflictDoNothing({ target: [schema.salaVenta.organizationId, schema.salaVenta.contactId] })
    .returning();
  // Dos clics a la vez: gana el primero y el segundo recibe esa misma sala.
  return row ?? (await getSalaDeContacto(organizationId, input.contactId))!;
}

/** Todas las salas del negocio, con nombre del contacto y su señal; la más caliente primero. */
export async function listarSalas(organizationId: string) {
  const rows = await getDb()
    .select({ sala: schema.salaVenta, nombre: schema.contact.name })
    .from(schema.salaVenta)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.salaVenta.contactId))
    .where(scoped(schema.salaVenta.organizationId, organizationId))
    .orderBy(desc(schema.salaVenta.createdAt));
  const ahora = new Date();
  const lista = rows.map((r) => ({ ...r.sala, nombre: r.nombre }));
  return { salas: lista, llamarHoy: llamarHoy(lista, ahora) };
}

/* ---------- Página pública ---------- */

async function salaPorToken(token: string): Promise<SalaRow | null> {
  // El token es la única llave de la página pública: sin sesión ni tenant del
  // que partir. Es largo, aleatorio y único en toda la instancia.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const rows = await getDb()
    .select()
    .from(schema.salaVenta)
    .where(eq(schema.salaVenta.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export type SalaPublica = NonNullable<Awaited<ReturnType<typeof getSalaPublica>>>;

export async function getSalaPublica(token: string) {
  const sala = await salaPorToken(token);
  if (!sala) return null;
  const org = sala.organizationId;
  const db = getDb();

  const [contacto, branding, credenciales, propiedades, fotos, plan] = await Promise.all([
    db
      .select({ name: schema.contact.name })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, org, eq(schema.contact.id, sala.contactId)))
      .limit(1),
    getBranding(org),
    db
      .select({ telefono: schema.metaCredentials.displayPhoneNumber })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, org))
      .limit(1),
    sala.propertyIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(schema.property)
          .where(
            scoped(
              schema.property.organizationId,
              org,
              inArray(schema.property.id, sala.propertyIds),
              isNull(schema.property.archivedAt)
            )
          ),
    sala.propertyIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(schema.propertyPhoto)
          .where(
            scoped(
              schema.propertyPhoto.organizationId,
              org,
              inArray(schema.propertyPhoto.propertyId, sala.propertyIds)
            )
          )
          .orderBy(asc(schema.propertyPhoto.position)),
    sala.planPagoId
      ? db
          .select()
          .from(schema.planPago)
          .where(scoped(schema.planPago.organizationId, org, eq(schema.planPago.id, sala.planPagoId)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const planPago = plan[0] ? planDeFila(plan[0]) : null;
  const alquiler = sala.alquilerActual === null ? null : Number(sala.alquilerActual);
  const urlFoto = (photo: (typeof fotos)[number]) =>
    isR2Configured() ? publicUrl(photo.storageKey) : `/api/s/${token}/foto/${photo.id}`;

  // El orden que eligió el dueño, no el de la base.
  const orden = new Map(sala.propertyIds.map((id, i) => [id, i]));
  const casas = propiedades
    .sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0))
    .map((p) => {
      const precio = Number(p.price);
      let calculo = null;
      if (planPago && p.operation === "venta" && precio > 0) {
        try {
          calculo = calcularCuotas(precio, planPago, alquiler);
        } catch {
          calculo = null;
        }
      }
      return {
        id: p.id,
        titulo: p.title ?? derivedTitle(p.kind, p.city),
        estado: p.status,
        precio,
        moneda: p.currency,
        dormitorios: p.bedrooms,
        banos: p.bathrooms === null ? null : Number(p.bathrooms),
        superficie: p.builtArea === null ? null : Number(p.builtArea),
        terreno: p.lotArea === null ? null : Number(p.lotArea),
        descripcion: p.description,
        operacion: p.operation,
        fotos: fotos.filter((f) => f.propertyId === p.id).slice(0, 8).map(urlFoto),
        calculo,
      };
    });

  const telefono = credenciales[0]?.telefono?.replace(/\D/g, "") || null;
  return {
    negocio: { nombre: branding.name, acento: branding.accent },
    nombre: contacto[0]?.name ?? null,
    saludo: sala.saludo,
    alquilerActual: alquiler,
    plan: planPago,
    planAprobadoPor: plan[0]?.aprobadoPor ?? null,
    casas,
    whatsapp: telefono,
  };
}

export const SenalSchema = z.object({
  tipo: z.enum(["apertura", "calculadora", "visita"]),
});

/** Lo que hizo el comprador en su sala. Idempotente por tipo salvo las aperturas, que suman. */
export async function registrarSenal(
  token: string,
  tipo: z.infer<typeof SenalSchema>["tipo"]
): Promise<boolean> {
  const sala = await salaPorToken(token);
  if (!sala) return false;
  const ahora = new Date();
  const t = schema.salaVenta;
  const cambios =
    tipo === "apertura"
      ? {
          // En SQL y no `sala.aperturas + 1`: dos pestañas a la vez suman dos.
          aperturas: sql`${t.aperturas} + 1`,
          ultimaAperturaAt: ahora,
          primeraAperturaAt: sql`coalesce(${t.primeraAperturaAt}, now())`,
        }
      : tipo === "calculadora"
        ? { calculadoraAt: ahora }
        : { visitaPedidaAt: ahora };
  await getDb()
    .update(schema.salaVenta)
    .set(cambios)
    .where(and(eq(schema.salaVenta.id, sala.id), eq(schema.salaVenta.organizationId, sala.organizationId)));
  return true;
}

/** Lo mismo que `registrarSenal`, desde WhatsApp: ahí la sala se conoce por su fila. */
export async function registrarSenalDeSala(
  sala: { id: string; organizationId: string },
  tipo: "calculadora" | "visita"
): Promise<void> {
  const ahora = new Date();
  await getDb()
    .update(schema.salaVenta)
    .set(tipo === "calculadora" ? { calculadoraAt: ahora } : { visitaPedidaAt: ahora })
    .where(and(eq(schema.salaVenta.id, sala.id), eq(schema.salaVenta.organizationId, sala.organizationId)));
}

/** La llave de una foto, solo si pertenece a una casa de esta sala. */
export async function fotoDeSala(
  token: string,
  photoId: string
): Promise<{ storageKey: string; mime: string } | null> {
  const sala = await salaPorToken(token);
  if (!sala || sala.propertyIds.length === 0) return null;
  const [row] = await getDb()
    .select({ storageKey: schema.propertyPhoto.storageKey, mime: schema.propertyPhoto.mime })
    .from(schema.propertyPhoto)
    .where(
      scoped(
        schema.propertyPhoto.organizationId,
        sala.organizationId,
        eq(schema.propertyPhoto.id, photoId),
        inArray(schema.propertyPhoto.propertyId, sala.propertyIds)
      )
    )
    .limit(1);
  return row ?? null;
}
