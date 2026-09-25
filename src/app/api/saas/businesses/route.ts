import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode, isSaaSAdminEmail } from "@/lib/tenant-host";
import { tenantOrigin } from "@/server/saas/billing";

export const dynamic = "force-dynamic";

/**
 * `POST /api/saas/businesses`: un admin de allok da de alta un negocio durante
 * la puesta en marcha. La cuenta se crea del lado del servidor para que la
 * cookie del cliente nunca llegue al navegador del admin (su sesión sigue
 * siendo suya) y sin abrir el checkout: el cobro se conversa aparte.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = getAuth();
  const session = isAllokSaaSMode()
    ? await auth.api.getSession({ headers: req.headers }).catch(() => null)
    : null;
  if (!isSaaSAdminEmail(session?.user.email)) {
    return Response.json({ message: "No encontrado" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    { name?: unknown; email?: unknown; password?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name || !email || password.length < 8) {
    return Response.json(
      { message: "Falta el nombre, el correo o una contraseña de 8 caracteres." },
      { status: 400 }
    );
  }

  try {
    // Con los headers del admin: el gate de registro reconoce su sesión.
    const created = await auth.api.signUpEmail({ body: { name, email, password }, headers: req.headers });
    const [org] = await getDb()
      .select({ slug: schema.organization.slug })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, created.user.id))
      .limit(1);
    return Response.json({ url: org?.slug ? tenantOrigin(org.slug, req) : null });
  } catch (error) {
    // El APIError de better-auth llega de otra copia del módulo: `instanceof`
    // falla, así que se reconoce por su forma.
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = status === 422
        ? "Ese correo ya tiene una cuenta."
        : (error as Error).message || "No se pudo crear el negocio.";
      return Response.json({ message }, { status });
    }
    throw error;
  }
}
