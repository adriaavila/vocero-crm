import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { RECUPERAR_RECOMENDADO } from "@/lib/recuperar";
import {
  crearPlantillaRecuperar,
  cuantosPorRecuperar,
  getRecuperar,
  plantillasParaRecuperar,
  resultadosRecuperar,
  saveRecuperar,
} from "@/server/agencia/recuperar";
import { TemplateError, templateErrorStatus } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Fork — recuperar clientes que no volvieron. GET: el ajuste, las plantillas
 * que sirven, cuántos clientes esperan hoy y lo que pasó en 30 días.
 */
export const GET = withOwner(async (session) => {
  const orgId = session.organizationId;
  const ajuste = await getRecuperar(orgId);
  const [plantillas, esperando, resultados] = await Promise.all([
    plantillasParaRecuperar(orgId),
    cuantosPorRecuperar(orgId, ajuste.dias ?? RECUPERAR_RECOMENDADO),
    resultadosRecuperar(orgId),
  ]);
  return Response.json({ dias: ajuste.dias ?? 0, templateId: ajuste.templateId, plantillas, esperando, resultados });
});

const putSchema = z.object({
  dias: z.number().int().min(0).max(365),
  templateId: z.string().min(1).max(100).nullable(),
});

export const PUT = withOwner(async (session, request: Request) => {
  const body = await parseBody(request, putSchema);
  if (!body.ok) return body.response;
  const { dias, templateId } = body.data;
  if (templateId) {
    const ok = (await plantillasParaRecuperar(session.organizationId)).some((t) => t.id === templateId);
    if (!ok) return apiError(422, "invalid_template", "Esa plantilla no existe o pide más datos de los que sabemos llenar");
  }
  if (dias > 0 && !templateId) {
    return apiError(422, "template_required", "Elige el mensaje que se les manda");
  }
  const saved = await saveRecuperar(session.organizationId, { dias, templateId });
  const esperando = await cuantosPorRecuperar(session.organizationId, saved.dias ?? RECUPERAR_RECOMENDADO);
  return Response.json({ dias: saved.dias ?? 0, templateId: saved.templateId, esperando });
});

/** Crea en Meta el mensaje propuesto; queda pendiente hasta que Meta lo apruebe. */
export const POST = withOwner(async (session) => {
  try {
    const plantilla = await crearPlantillaRecuperar(session.organizationId);
    return Response.json({ plantilla });
  } catch (error) {
    if (error instanceof TemplateError) return apiError(templateErrorStatus(error), error.code, error.message);
    throw error;
  }
});
