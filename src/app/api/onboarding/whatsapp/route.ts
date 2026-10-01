import { withOwner } from "@/lib/api";
import { getOnboardingView } from "@/server/onboarding/status";

export const dynamic = "force-dynamic";

/**
 * `GET /api/onboarding/whatsapp` — dónde quedó el alta de WhatsApp de este
 * negocio. `?meta=1` agrega el estado del nombre visible (consulta a Meta; la
 * pantalla final lo pide una vez, el sondeo no).
 */
export const GET = withOwner(async (session, request: Request) => {
  const withMeta = new URL(request.url).searchParams.get("meta") === "1";
  return Response.json(await getOnboardingView(session.organizationId, { withMeta }));
});
