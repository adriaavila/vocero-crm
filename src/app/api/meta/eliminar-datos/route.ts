import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseSignedRequest, readSignedRequest, solicitarBorrado } from "@/server/agencia/meta-cumplimiento";

export const dynamic = "force-dynamic";

/**
 * Fork — "URL de devolución de llamada de solicitud de eliminación de datos"
 * de la app de Meta. Meta hace un POST con `signed_request` y espera
 * `{ url, confirmation_code }`: el enlace donde la persona ve el estado y el
 * código que se le enseña. Ver `server/agencia/meta-cumplimiento.ts`.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = getEnv().META_APP_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  if (!checkRateLimit(`meta-eliminar:${ip}`, { windowMs: 60_000, max: 60 }).allowed) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const raw = await readSignedRequest(request);
  const data = raw ? parseSignedRequest(raw, secret) : null;
  if (!data) return Response.json({ error: "invalid_signed_request" }, { status: 400 });
  const { url, codigo } = await solicitarBorrado(data);
  return Response.json({ url, confirmation_code: codigo });
}
