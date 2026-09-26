import { z } from "zod";
import { apiError, parseBody, withProOwner } from "@/lib/api";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import {
  adSpendSummary,
  createAdSpend,
  deleteAdSpend,
  listAdSpend,
} from "@/server/analytics/ad-spend";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Un gasto anual grande en la moneda fuerte más cara: tope amplio, no
 * arbitrario — evita que un dedo de más en la captura mande un monto que ni
 * el propio dueño reconocería, sin acercarse a lo que `bigint` sí soporta. */
const MAX_AMOUNT_CENTS = 100_000_000_00; // $100,000,000.00

/** `Date` acepta "2026-02-31" y la corrige en silencio al 3 de marzo; una
 * fecha de calendario real no rueda. */
function esFechaDeCalendarioReal(iso: string): boolean {
  const partes = iso.split("-").map(Number);
  const [y, m, d] = partes;
  if (y === undefined || m === undefined || d === undefined) return false;
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return (
    fecha.getUTCFullYear() === y && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d
  );
}

const fechaSchema = z
  .string()
  .regex(ISO_DATE, "Fecha inválida (AAAA-MM-DD)")
  .refine(esFechaDeCalendarioReal, "Esa fecha no existe");

const createSchema = z
  .object({
    source: z.enum(["anuncio", "organico", "referido", "conocido", "otro"]),
    periodStart: fechaSchema,
    periodEnd: fechaSchema,
    amountCents: z
      .number()
      .int()
      .min(0, "El monto no puede ser negativo")
      .max(MAX_AMOUNT_CENTS, "Ese monto es demasiado grande"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "La fecha final va antes que la inicial",
    path: ["periodEnd"],
  });

/**
 * Fork — gasto de anuncios (Cloud lo tiene, upstream no). Mismo acceso que el
 * resto de Resultados: propietario, y Pro en SaaS (`withProOwner`).
 */
async function withPeriod(organizationId: string, url: URL) {
  try {
    return { period: await periodFromRequest(organizationId, url), error: null };
  } catch (err) {
    if (err instanceof PeriodError) {
      return { period: null, error: apiError(422, "invalid_period", err.message) };
    }
    throw err;
  }
}

export const GET = withProOwner(async (session, req: Request) => {
  const url = new URL(req.url);
  const { period, error } = await withPeriod(session.organizationId, url);
  if (error) return error;

  const [entries, branding] = await Promise.all([
    listAdSpend(session.organizationId),
    getBranding(session.organizationId),
  ]);
  const summary = await adSpendSummary(session.organizationId, period!, branding.currency);
  return Response.json({ entries, summary });
});

export const POST = withProOwner(async (session, req: Request) => {
  const url = new URL(req.url);
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const { period, error } = await withPeriod(session.organizationId, url);
  if (error) return error;

  const branding = await getBranding(session.organizationId);
  await createAdSpend({
    organizationId: session.organizationId,
    source: body.data.source,
    periodStart: body.data.periodStart,
    periodEnd: body.data.periodEnd,
    amountCents: body.data.amountCents,
    currency: branding.currency,
    note: body.data.note?.trim() || null,
    createdBy: session.userId,
  });

  const [entries, summary] = await Promise.all([
    listAdSpend(session.organizationId),
    adSpendSummary(session.organizationId, period!, branding.currency),
  ]);
  return Response.json({ ok: true, entries, summary });
});

export const DELETE = withProOwner(async (session, req: Request) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return apiError(422, "invalid_id", "Falta el id de la carga");

  const { period, error } = await withPeriod(session.organizationId, url);
  if (error) return error;

  const borrado = await deleteAdSpend(session.organizationId, id);
  if (!borrado) return apiError(404, "not_found", "Esa carga ya no existe");

  const branding = await getBranding(session.organizationId);
  const [entries, summary] = await Promise.all([
    listAdSpend(session.organizationId),
    adSpendSummary(session.organizationId, period!, branding.currency),
  ]);
  return Response.json({ ok: true, entries, summary });
});
