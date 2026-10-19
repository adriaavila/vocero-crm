import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { soldSaaSPlans } from "@/lib/saas-plans";
import { isAllokSaaSMode, isSaaSAdminEmail } from "@/lib/tenant-host";
import { grantSaaSPlan } from "@/server/saas/admin";
import { tenantOrigin } from "@/server/saas/billing";
import { mensajeParaElDueno, normalizarDireccion, validarDireccion } from "@/server/agencia/alta-negocio";

export const dynamic = "force-dynamic";

/**
 * `POST /api/saas/businesses`: un admin de allok da de alta un negocio durante
 * la puesta en marcha. La cuenta se crea del lado del servidor para que la
 * cookie del cliente nunca llegue al navegador del admin (su sesión sigue
 * siendo suya) y sin abrir el checkout: el cobro se conversa aparte.
 *
 * Fork (agencia): el admin elige la dirección (`slug`) y puede dejar el plan
 * activo en el mismo paso (`activarPlan`), en vez de ir después al panel
 * admin. Ver `server/agencia/alta-negocio.ts`.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = getAuth();
  const session = isAllokSaaSMode()
    ? await auth.api.getSession({ headers: req.headers }).catch(() => null)
    : null;
  if (!session || !isSaaSAdminEmail(session.user.email)) {
    return Response.json({ message: "No encontrado" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    { name?: unknown; email?: unknown; password?: unknown; slug?: unknown; activarPlan?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const slug = typeof body?.slug === "string" ? normalizarDireccion(body.slug) : "";
  if (!name || !email || password.length < 8) {
    return Response.json(
      { message: "Falta el nombre, el correo o una contraseña de 8 caracteres." },
      { status: 400 }
    );
  }

  // La dirección se valida ANTES de crear la cuenta: un choque no puede dejar
  // un negocio a medias ni una dirección con sufijo que nadie pidió.
  if (slug) {
    const valid = validarDireccion(slug);
    if (!valid.ok) return Response.json({ message: valid.message, field: "slug" }, { status: 422 });
    if (await slugTaken(slug)) {
      return Response.json({ message: "Esa dirección ya la usa otro negocio.", field: "slug" }, { status: 409 });
    }
  }

  let organizationId: string | null = null;
  let finalSlug: string | null = null;
  try {
    // Con los headers del admin: el gate de registro reconoce su sesión.
    const created = await auth.api.signUpEmail({ body: { name, email, password }, headers: req.headers });
    const [org] = await getDb()
      .select({ id: schema.organization.id, slug: schema.organization.slug })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, created.user.id))
      .limit(1);
    organizationId = org?.id ?? null;
    finalSlug = org?.slug ?? null;
  } catch (error) {
    // El APIError de better-auth llega de otra copia del módulo: `instanceof`
    // falla, así que se reconoce por su forma.
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = status === 422
        ? "Ese correo ya tiene una cuenta."
        : (error as Error).message || "No se pudo crear el negocio.";
      return Response.json({ message, field: status === 422 ? "email" : undefined }, { status });
    }
    throw error;
  }

  if (organizationId && slug && slug !== finalSlug) {
    try {
      await getDb()
        .update(schema.organization)
        .set({ slug })
        .where(eq(schema.organization.id, organizationId));
      finalSlug = slug;
    } catch {
      // Otro alta tomó la dirección entre la consulta y aquí (slug es UNIQUE):
      // el negocio queda con la que le dio el alta y la pantalla la muestra.
    }
  }

  let plan: string | null = null;
  if (organizationId && body?.activarPlan === true) {
    const toGrant = soldSaaSPlans(process.env.SAAS_PLANS)[0];
    if (toGrant) {
      const result = await grantSaaSPlan({
        organizationId,
        plan: toGrant,
        adminEmail: session.user.email,
        adminUserId: session.user.id,
        confirmOverrideStripe: false,
      });
      if (result.ok) plan = toGrant;
    }
  }

  const url = finalSlug ? tenantOrigin(finalSlug, req) : null;
  return Response.json({ url, plan, mensaje: url ? mensajeParaElDueno({ nombre: name, url, email }) : null });
}

async function slugTaken(slug: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return rows.length > 0;
}
