import { withAuth } from "@/lib/api";
import { enviarAviso } from "@/server/agencia/avisos";

export const dynamic = "force-dynamic";

/** «Mándame uno de prueba»: el dueño ve cómo se ve antes de que pase de verdad. */
export const POST = withAuth(async (session) => {
  const enviados = await enviarAviso(session.organizationId, {
    title: "Así te avisaremos",
    body: "Cuando un cliente pida hablar contigo o tu agente agende una cita, te llega un aviso como este.",
    url: "/inbox",
    tag: "prueba",
  });
  return Response.json({ ok: enviados > 0, enviados });
});
