import { apiError, withOwner } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isDomainEmpty, seedDemo } from "@/server/seed/demo";
import { seedRealtyDemo } from "@/server/seed/realty-demo";
import { defaultVerticalFromEnv, setOrgVertical } from "@/server/agencia/vertical";

export const dynamic = "force-dynamic";

/**
 * Carga el negocio demo (FR-075). Solo con la BD de dominio vacía — la
 * versión por script (`pnpm seed:demo`) permite recargar con --force.
 *
 * Vertical inmobiliario (parte 1): con `DEFAULT_VERTICAL=inmobiliario` carga
 * "Inmobiliaria Cordillera" en vez de la ferretería, y de paso FIJA el
 * vertical de la organización — red de seguridad para una organización que
 * ya existía antes de que se configurara la variable (sin esto, el catálogo
 * recién sembrado quedaría detrás de un 404 `vertical_disabled`).
 */
export const POST = withOwner(async (session) => {
  const db = getDb();
  const empty = await isDomainEmpty(db, session.organizationId);
  if (!empty) {
    return apiError(
      409,
      "not_empty",
      "Ya hay datos en la organización; la demo solo se carga con la base vacía"
    );
  }
  const vertical = defaultVerticalFromEnv();
  if (vertical === "inmobiliario") {
    await setOrgVertical(session.organizationId, vertical);
    const result = await seedRealtyDemo(db, session.organizationId);
    return Response.json({ ok: true, ...result });
  }
  const result = await seedDemo(db, session.organizationId);
  return Response.json({ ok: true, ...result });
});
