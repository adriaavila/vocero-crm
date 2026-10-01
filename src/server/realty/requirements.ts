import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  AMENITIES,
  CURRENCIES,
  OPERATIONS,
  PAYMENT_METHODS,
  PROPERTY_KINDS,
  URGENCIES,
} from "@/lib/realty/catalog";

/**
 * Requerimiento de búsqueda del lead (parte 2). 1:1 con `lead`, igual que
 * `lead` es 1:1 con `contact`.
 *
 * Dos reglas duras:
 *
 *  1. **Precedencia manual > IA.** Un campo que un asesor corrigió a mano
 *     queda marcado en `manualFields` y la extracción del agente ya no lo
 *     pisa (`applyRequirementPatch` con `source: "ai"`).
 *  2. **Se puede BORRAR un campo.** `null` explícito borra: si el cliente
 *     dice "olvida el presupuesto", el presupuesto se vacía, no se queda
 *     para siempre.
 *
 * Portado de `vocero-inmobiliario-main` (`src/server/realty/requirements.ts`)
 * sin cambios de lógica — este repo ya define `requirement` con la misma
 * forma (`leadId`, `manualFields`, `version`).
 */

export const REQUIREMENT_FIELDS = [
  "operation",
  "budgetMin",
  "budgetMax",
  "currency",
  "zones",
  "kind",
  "minBedrooms",
  "minBathrooms",
  "amenities",
  "paymentMethod",
  "needsGuarantor",
  "urgency",
  "notes",
] as const;

export type RequirementField = (typeof REQUIREMENT_FIELDS)[number];

const numericString = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => Number.isFinite(Number(v)), "Debe ser un número");

export const RequirementPatchSchema = z
  .object({
    operation: z.enum(OPERATIONS).nullable(),
    budgetMin: numericString.nullable(),
    budgetMax: numericString.nullable(),
    currency: z.enum(CURRENCIES),
    zones: z.string().trim().max(200).nullable(),
    kind: z.enum(PROPERTY_KINDS).nullable(),
    minBedrooms: z.number().int().min(0).nullable(),
    minBathrooms: numericString.nullable(),
    amenities: z.array(z.enum(AMENITIES)),
    paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
    needsGuarantor: z.boolean().nullable(),
    urgency: z.enum(URGENCIES).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial();

export type RequirementPatch = z.infer<typeof RequirementPatchSchema>;
export type RequirementRow = typeof schema.requirement.$inferSelect;

export async function getRequirement(
  organizationId: string,
  leadId: string
): Promise<RequirementRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.requirement)
    .where(
      scoped(
        schema.requirement.organizationId,
        organizationId,
        eq(schema.requirement.leadId, leadId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function ensureRequirement(
  organizationId: string,
  leadId: string
): Promise<RequirementRow> {
  const existing = await getRequirement(organizationId, leadId);
  if (existing) return existing;

  const inserted = await getDb()
    .insert(schema.requirement)
    .values({ id: newId("requirement"), organizationId, leadId })
    .onConflictDoNothing({ target: schema.requirement.leadId })
    .returning();
  if (inserted[0]) return inserted[0];

  // Carrera: otro turno lo creó entre el SELECT y el INSERT.
  const after = await getRequirement(organizationId, leadId);
  if (!after) throw new Error("no se pudo crear el requerimiento");
  return after;
}

/** Campos `numeric`: Postgres los devuelve con escala ("4500000.00"). */
const NUMERIC_FIELDS = new Set<string>([
  "budgetMin",
  "budgetMax",
  "minBathrooms",
]);

/**
 * ¿Cambió de verdad?
 *
 * Los `numeric` se comparan como NÚMEROS: Postgres devuelve "4500000.00" y el
 * patch manda "4500000". Comparándolos como texto, cada guardado subiría la
 * versión aunque nada hubiera cambiado — y la versión es justo lo que
 * invalida la caché de matches.
 */
function isDifferent(
  field: string,
  current: unknown,
  next: unknown
): boolean {
  if (Array.isArray(current) || Array.isArray(next)) {
    return JSON.stringify(current ?? []) !== JSON.stringify(next ?? []);
  }
  if (NUMERIC_FIELDS.has(field)) {
    const a =
      current === null || current === undefined ? null : Number(current);
    const b = next === null || next === undefined ? null : Number(next);
    return a !== b;
  }
  return (current ?? null) !== (next ?? null);
}

/**
 * Aplica un patch al requerimiento.
 *
 * @param source `manual` marca los campos tocados para blindarlos de la IA;
 *               `ai` respeta lo ya blindado y no lo sobrescribe — el dueño
 *               NUNCA pierde una corrección propia por una extracción
 *               posterior del agente.
 *
 * La versión sube SOLO si algún campo cambió de verdad: es lo que invalida la
 * caché de matches, y versionar de más la invalidaría en vano.
 */
export async function applyRequirementPatch(input: {
  organizationId: string;
  leadId: string;
  patch: RequirementPatch;
  source: "manual" | "ai";
}): Promise<{ requirement: RequirementRow; changed: boolean }> {
  const current = await ensureRequirement(input.organizationId, input.leadId);
  const protectedFields = new Set(current.manualFields);

  const values: Record<string, unknown> = {};
  const touched: RequirementField[] = [];

  for (const field of REQUIREMENT_FIELDS) {
    if (!(field in input.patch)) continue;
    // La IA no pisa lo que un humano fijó a mano.
    if (input.source === "ai" && protectedFields.has(field)) continue;

    const next = (input.patch as Record<string, unknown>)[field] ?? null;
    const before = (current as unknown as Record<string, unknown>)[field];
    if (!isDifferent(field, before, next)) continue;
    values[field] = next;
    touched.push(field);
  }

  if (touched.length === 0) return { requirement: current, changed: false };

  const manualFields =
    input.source === "manual"
      ? [...new Set([...current.manualFields, ...touched])]
      : current.manualFields;

  const updated = await getDb()
    .update(schema.requirement)
    .set({
      ...values,
      manualFields,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.requirement.id, current.id))
    .returning();

  return { requirement: updated[0]!, changed: true };
}

/**
 * Libera campos del blindaje manual: el asesor decide que la IA vuelva a
 * mantenerlos al día.
 */
export async function releaseManualFields(input: {
  organizationId: string;
  leadId: string;
  fields: RequirementField[];
}): Promise<RequirementRow | null> {
  const current = await getRequirement(input.organizationId, input.leadId);
  if (!current) return null;
  const release = new Set<string>(input.fields);
  const manualFields = current.manualFields.filter((f) => !release.has(f));

  const updated = await getDb()
    .update(schema.requirement)
    .set({ manualFields, updatedAt: new Date() })
    .where(eq(schema.requirement.id, current.id))
    .returning();
  return updated[0] ?? null;
}

export function serializeRequirement(row: RequirementRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    leadId: row.leadId,
    operation: row.operation,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    currency: row.currency,
    zones: row.zones,
    kind: row.kind,
    minBedrooms: row.minBedrooms,
    minBathrooms: row.minBathrooms,
    amenities: row.amenities,
    paymentMethod: row.paymentMethod,
    needsGuarantor: row.needsGuarantor,
    urgency: row.urgency,
    notes: row.notes,
    manualFields: row.manualFields,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resumen legible para inyectar al agente en el prompt / contexto del bot. */
export function describeRequirement(row: RequirementRow | null): string {
  if (!row) return "(sin requerimiento capturado)";
  const parts: string[] = [];
  if (row.operation) parts.push(`operación: ${row.operation}`);
  if (row.kind) parts.push(`tipo: ${row.kind}`);
  if (row.budgetMin || row.budgetMax) {
    const min = row.budgetMin ? `desde ${row.budgetMin}` : "";
    const max = row.budgetMax ? `hasta ${row.budgetMax}` : "";
    parts.push(
      `presupuesto: ${[min, max].filter(Boolean).join(" ")} ${row.currency}`
    );
  }
  if (row.zones.length > 0) parts.push(`zonas: ${row.zones.join(", ")}`);
  if (row.minBedrooms !== null)
    parts.push(`mínimo ${row.minBedrooms} dormitorios`);
  if (row.minBathrooms !== null) parts.push(`mínimo ${row.minBathrooms} baños`);
  if (row.amenities.length > 0)
    parts.push(`amenidades: ${row.amenities.join(", ")}`);
  if (row.paymentMethod) parts.push(`forma de pago: ${row.paymentMethod}`);
  if (row.needsGuarantor !== null) {
    parts.push(row.needsGuarantor ? "requiere fiador" : "sin fiador");
  }
  if (row.urgency) parts.push(`urgencia: ${row.urgency}`);
  if (row.notes) parts.push(`notas: ${row.notes}`);
  return parts.length > 0 ? parts.join(" · ") : "(sin requerimiento capturado)";
}

/** Campos que faltan para considerar el requerimiento "completo" (contrato Nea). */
const REQUIRED_FOR_COMPLETE: RequirementField[] = ["operation", "kind"];

export function missingRequirementFields(
  row: RequirementRow | null
): RequirementField[] {
  if (!row) return [...REQUIRED_FOR_COMPLETE, "budgetMax"];
  const missing: RequirementField[] = [];
  for (const field of REQUIRED_FOR_COMPLETE) {
    if (!(row as unknown as Record<string, unknown>)[field]) missing.push(field);
  }
  if (!row.budgetMin && !row.budgetMax) missing.push("budgetMax");
  return missing;
}

export function isRequirementComplete(row: RequirementRow | null): boolean {
  return missingRequirementFields(row).length === 0;
}
