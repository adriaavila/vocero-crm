import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
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
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
