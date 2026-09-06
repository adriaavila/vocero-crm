import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { APP_VERSION, resolveBuildCommit } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  // Una instancia de producción sin META_APP_SECRET acepta webhooks que no
  // puede verificar. En el modelo de agencia eso se despliega y se entrega sin
  // que nadie lo note, así que la instancia se declara NO saludable: el
  // healthcheck de la plataforma frena el despliegue en vez de dejar corriendo
  // una recepción abierta.
  const env = getEnv();
  if (env.NODE_ENV === "production" && !env.META_APP_SECRET) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "webhook_unconfigured",
          message: "Recepción de WhatsApp no configurada",
        },
      },
      { status: 503 }
    );
  }

  try {
    await getDb().execute(sql`select 1`);
    // La versión viaja aquí a propósito: confirmar un despliegue tiene que
    // poder hacerse con un `curl`, desde un script o desde la plataforma de
    // hosting, sin abrir la app ni iniciar sesión. Es la única forma de que un
    // pipeline pueda comprobar que el build que subió es el que corre.
    const commit = resolveBuildCommit();
    return Response.json({
      ok: true,
      version: APP_VERSION,
      ...(commit ? { commit } : {}),
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
