import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import {
  horaDeRecuperar,
  normalizarRecuperar,
  RECUPERAR_MAX_VARIABLES,
  RECUPERAR_PLANTILLA,
  RECUPERAR_TOPE_DIA,
  variablesRecuperar,
} from "@/lib/recuperar";
import { horaLocal } from "@/lib/seguimiento";
import { recordAgentDecision } from "@/server/agencia/decisions";
import { canAutomate } from "@/server/agencia/entitlements";
import { getBusinessHours } from "@/server/business-hours";
import { createTemplate, sendTemplate, TemplateError } from "@/server/whatsapp/templates";

/**
 * Fork — recuperar clientes que no volvieron.
 *
 * Si el dueño lo enciende (`agent_profile.recuperar_dias` + una plantilla
 * aprobada en `recuperar_template_id`), el barrido del worker busca CLIENTES
 * (ya vinieron a una cita o ya compraron: un trato ganado) de los que no se
 * sabe nada hace esos días y que no tienen cita por delante, y les manda la
 * plantilla UNA vez. Si contestan, la conversación sigue con el agente como
 * cualquier otra. Las reglas puras viven en `lib/recuperar.ts`.
 *
 * Una vez por silencio: la decisión queda en `agent_decision` (`recuperar`
 * si salió, `recuperar_skip` si Meta o la facturación lo frenaron) y no hay
 * otra mientras el cliente no vuelva a escribir. A lo más
 * `RECUPERAR_TOPE_DIA` por negocio en 24 h, solo de 10:00 a 19:00 locales.
 */

export type RecuperarAjuste = { dias: number | null; templateId: string | null };

export async function getRecuperar(organizationId: string): Promise<RecuperarAjuste> {
  const rows = await getDb()
    .select({ dias: schema.agentProfile.recuperarDias, templateId: schema.agentProfile.recuperarTemplateId })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return { dias: normalizarRecuperar(rows[0]?.dias), templateId: rows[0]?.templateId ?? null };
}

export async function saveRecuperar(organizationId: string, input: RecuperarAjuste): Promise<RecuperarAjuste> {
  const dias = normalizarRecuperar(input.dias);
  // Sin `updatedAt`: no cambia lo que el agente sabe (ver contenido-perfil.ts).
  await getDb()
    .update(schema.agentProfile)
    .set({ recuperarDias: dias, recuperarTemplateId: input.templateId })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
  return { dias, templateId: input.templateId };
}

/** Las plantillas que sirven: de cualquier estado (se muestra cuál falta aprobar), con ≤2 variables. */
export async function plantillasParaRecuperar(organizationId: string) {
  const rows = await getDb()
    .select({
      id: schema.template.id,
      name: schema.template.name,
      body: schema.template.body,
      status: schema.template.status,
    })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));
  return rows.filter((t) => countVariables(t.body) <= RECUPERAR_MAX_VARIABLES);
}

/** Manda a Meta la plantilla propuesta (queda pendiente de aprobación). */
export async function crearPlantillaRecuperar(organizationId: string) {
  const existentes = await plantillasParaRecuperar(organizationId);
  const ya = existentes.find((t) => t.name === RECUPERAR_PLANTILLA.name);
  if (ya) return ya;
  const creada = await createTemplate(organizationId, { ...RECUPERAR_PLANTILLA });
  return { id: creada.id, name: creada.name, body: creada.body, status: creada.status };
}

type Fila = {
  conversation_id: string;
  organization_id: string;
  contact_name: string | null;
  template_id: string;
};

/**
 * Clientes que no volvieron. `organizationId` acota a un negocio (la pantalla
 * de Ajustes cuenta los suyos); sin él, el barrido mira todos.
 */
async function filasRecuperar(now: Date, opts: { organizationId?: string; dias?: number; limit: number }) {
  const ahora = now.toISOString();
  const dias = opts.dias ? sql`${opts.dias}` : sql`p.recuperar_dias`;
  const soloOrg = opts.organizationId ? sql`AND c.organization_id = ${opts.organizationId}` : sql``;
  const conPlantilla = opts.organizationId
    ? sql``
    : sql`AND EXISTS (
        SELECT 1 FROM template t
        WHERE t.id = p.recuperar_template_id AND t.organization_id = c.organization_id AND t.status = 'approved'
      )`;
  const encendido = opts.dias ? sql`` : sql`AND p.enabled = true AND p.recuperar_dias > 0`;
  return (await getDb().execute(sql`
    SELECT c.id AS conversation_id, c.organization_id, ct.name AS contact_name,
           p.recuperar_template_id AS template_id
    FROM conversation c
    JOIN contact ct ON ct.id = c.contact_id AND ct.organization_id = c.organization_id
    JOIN agent_profile p ON p.organization_id = c.organization_id
    WHERE c.is_test = false
      ${encendido}
      ${soloOrg}
      ${conPlantilla}
      AND c.ai_enabled = true
      AND c.handoff_at IS NULL
      AND ct.archived_at IS NULL
      AND ct.channel = 'whatsapp'
      AND (p.allowlist_enabled = false OR p.allowed_wa_ids ? ct.wa_identity)
      AND c.last_inbound_at IS NOT NULL
      -- Nadie habló con él en todo ese tiempo, ni él ni el negocio.
      AND c.last_inbound_at <= ${ahora}::timestamp - make_interval(days => ${dias})
      AND c.last_message_at <= ${ahora}::timestamp - make_interval(days => ${dias})
      -- Su conversación más reciente: un contacto, un solo mensaje.
      AND NOT EXISTS (
        SELECT 1 FROM conversation c2
        WHERE c2.contact_id = c.contact_id AND c2.organization_id = c.organization_id
          AND c2.is_test = false AND c2.id <> c.id AND c2.last_message_at > c.last_message_at
      )
      -- Es cliente: vino a una cita o ya compró.
      AND (
        EXISTS (
          SELECT 1 FROM booking b
          WHERE b.contact_id = ct.id AND b.organization_id = c.organization_id
            AND b.kind = 'session' AND b.is_test = false
            AND (b.status = 'realizada' OR (b.status = 'agendada' AND b.scheduled_at < ${ahora}::timestamp))
        )
        OR EXISTS (
          SELECT 1 FROM lead l JOIN pipeline_stage s ON s.id = l.stage_id
          WHERE l.contact_id = ct.id AND l.organization_id = c.organization_id AND s.kind = 'won'
        )
      )
      -- Con una cita por delante no hace falta recuperarlo.
      AND NOT EXISTS (
        SELECT 1 FROM booking b
        WHERE b.contact_id = ct.id AND b.organization_id = c.organization_id
          AND b.status = 'agendada' AND b.scheduled_at >= ${ahora}::timestamp
      )
      -- Una vez por silencio.
      AND NOT EXISTS (
        SELECT 1 FROM agent_decision d
        WHERE d.conversation_id = c.id
          AND d.action IN ('recuperar', 'recuperar_skip')
          AND d.created_at >= c.last_inbound_at
      )
    -- Primero los que se fueron hace menos: son los que más vuelven.
    ORDER BY c.last_inbound_at DESC
    LIMIT ${opts.limit}
  `)) as unknown as Fila[];
}

/** Cuántos clientes no vuelven hace `dias` (para mostrarlo en Ajustes). */
export async function cuantosPorRecuperar(organizationId: string, dias: number, now: Date = new Date()): Promise<number> {
  return (await filasRecuperar(now, { organizationId, dias, limit: 500 })).length;
}

/** A cuántos les escribió en los últimos `dias` y cuántos contestaron después. */
export async function resultadosRecuperar(organizationId: string, dias = 30, now: Date = new Date()) {
  const desde = new Date(now.getTime() - dias * 86_400_000).toISOString();
  const rows = (await getDb().execute(sql`
    SELECT count(*)::int AS escritos,
           count(*) FILTER (WHERE c.last_inbound_at > d.created_at)::int AS volvieron
    FROM agent_decision d
    JOIN conversation c ON c.id = d.conversation_id
    WHERE d.organization_id = ${organizationId}
      AND d.action = 'recuperar'
      AND d.created_at >= ${desde}::timestamp
  `)) as unknown as { escritos: number; volvieron: number }[];
  return { escritos: Number(rows[0]?.escritos ?? 0), volvieron: Number(rows[0]?.volvieron ?? 0) };
}

export type Candidato = {
  conversationId: string;
  organizationId: string;
  contactName: string | null;
  templateId: string;
};

export async function candidatosRecuperar(now: Date = new Date()): Promise<Candidato[]> {
  return (await filasRecuperar(now, { limit: 200 })).map((r) => ({
    conversationId: r.conversation_id,
    organizationId: r.organization_id,
    contactName: r.contact_name,
    templateId: r.template_id,
  }));
}

async function enviadosHoy(organizationId: string, now: Date): Promise<number> {
  const desde = new Date(now.getTime() - 86_400_000);
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.agentDecision)
    .where(
      and(
        eq(schema.agentDecision.organizationId, organizationId),
        eq(schema.agentDecision.action, "recuperar"),
        sql`${schema.agentDecision.createdAt} >= ${desde.toISOString()}::timestamp`
      )
    );
  return Number(rows[0]?.n ?? 0);
}

export type ResultadoRecuperar = "sent" | "skipped";

/** Manda la plantilla a UN cliente y deja su decisión. */
export async function recuperarCliente(c: Candidato, negocio: string): Promise<ResultadoRecuperar> {
  const decide = (action: "recuperar" | "recuperar_skip", summary: string, replyMessageIds: string[] = []) =>
    recordAgentDecision({
      organizationId: c.organizationId,
      conversationId: c.conversationId,
      isTest: false,
      brain: "rei",
      action,
      steps: [{ tool: "recuperar", summary, ok: action === "recuperar" }],
      triggerMessageIds: [],
      replyMessageIds,
    });

  const template = await getDb()
    .select({ body: schema.template.body })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, c.organizationId, eq(schema.template.id, c.templateId)))
    .limit(1);
  const variables = variablesRecuperar(countVariables(template[0]?.body ?? ""), c.contactName, negocio);
  if (!variables) {
    await decide("recuperar_skip", "la plantilla pide más datos de los que sabemos llenar");
    return "skipped";
  }
  try {
    const { messageId } = await sendTemplate({
      organizationId: c.organizationId,
      conversationId: c.conversationId,
      templateId: c.templateId,
      variables,
    });
    await decide("recuperar", "cliente que no volvía: le escribió para retomar", [messageId]);
    return "sent";
  } catch (error) {
    const motivo = error instanceof Error ? error.message : "rechazado";
    await decide("recuperar_skip", `no se pudo enviar: ${motivo}`.slice(0, 200));
    // Un número desconectado o vencido no mejora en este barrido.
    if (error instanceof TemplateError && (error.code === "not_connected" || error.code === "reconnect_required")) {
      throw error;
    }
    return "skipped";
  }
}

/** El barrido recorre todos los negocios: cada 10 minutos alcanza. */
const CADA_MS = 10 * 60_000;
const globalForRecuperar = globalThis as unknown as { __voceroRecuperarEn?: number };

/** Barrido del worker. Secuencial y con tope por negocio. */
export async function barrerRecuperar(now: Date = new Date(), opts: { forzar?: boolean } = {}): Promise<number> {
  if (!opts.forzar && now.getTime() - (globalForRecuperar.__voceroRecuperarEn ?? 0) < CADA_MS) return 0;
  globalForRecuperar.__voceroRecuperarEn = now.getTime();
  const candidatos = await candidatosRecuperar(now);
  const porOrg = new Map<string, Candidato[]>();
  for (const c of candidatos) porOrg.set(c.organizationId, [...(porOrg.get(c.organizationId) ?? []), c]);

  let enviados = 0;
  for (const [organizationId, lista] of porOrg) {
    const { timezone } = await getBusinessHours(organizationId);
    if (!horaDeRecuperar(horaLocal(now, timezone))) continue;
    if (!(await canAutomate(organizationId))) continue;
    const cupo = RECUPERAR_TOPE_DIA - (await enviadosHoy(organizationId, now));
    if (cupo <= 0) continue;
    const org = await getDb()
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    const negocio = org[0]?.name ?? "";
    for (const c of lista.slice(0, cupo)) {
      try {
        if ((await recuperarCliente(c, negocio)) === "sent") enviados++;
      } catch (error) {
        console.error(`[recuperar] ${organizationId} se detiene por hoy:`, error instanceof Error ? error.message : error);
        break;
      }
    }
  }
  if (enviados > 0) console.log(`[recuperar] el agente le escribió a ${enviados} cliente(s) que no volvían`);
  return enviados;
}
