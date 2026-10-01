import { parseBody } from "@/lib/api";
import { withRealty } from "@/server/realty/guard";
import { publicUrl } from "@/server/storage/r2";
import {
  PropertyInputSchema,
  createProperty,
  listProperties,
  photoSummaries,
  serializeProperty,
} from "@/server/realty/properties";

export const dynamic = "force-dynamic";

/**
 * Listado con buscador, filtros y paginación REAL (nunca truncado en
 * silencio). `withRealty`: 404 para quien no tiene el vertical, 403 sin plan
 * Completo.
 */
export const GET = withRealty(async (session, req: Request) => {
  const url = new URL(req.url);
  const number = (key: string): number | undefined => {
    const raw = url.searchParams.get(key);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const { properties, total, page, pageSize } = await listProperties(
    session.organizationId,
    {
      search: url.searchParams.get("q") ?? undefined,
      operation: url.searchParams.get("operation") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      archived: url.searchParams.get("archived") === "true",
      priceMin: number("priceMin"),
      priceMax: number("priceMax"),
      page: number("page"),
      pageSize: number("pageSize"),
    }
  );

  const summaries = await photoSummaries(
    session.organizationId,
    properties.map((p) => p.id)
  );

  return Response.json({
    properties: properties.map((p) => {
      const summary = summaries.get(p.id);
      return serializeProperty(p, {
        photoCount: summary?.count ?? 0,
        coverPhotoUrl: summary?.coverStorageKey
          ? publicUrl(summary.coverStorageKey)
          : null,
      });
    }),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
});

export const POST = withRealty(async (session, req: Request) => {
  const parsed = await parseBody(req, PropertyInputSchema);
  if (!parsed.ok) return parsed.response;

  const property = await createProperty(
    session.organizationId,
    parsed.data,
    session.userId
  );
  return Response.json({ property: serializeProperty(property) }, { status: 201 });
});
