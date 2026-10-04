import { sql } from "drizzle-orm";
import { brand } from "@/lib/brand";
import { getDb } from "@/lib/db";
import { derivePlanState, planDate, TRIAL_ENDING_MS } from "@/lib/plan-estado";
import { PLAN_CATALOG } from "@/lib/saas-plans";
import { isAllokSaaSMode, resolvedRootDomain } from "@/lib/tenant-host";
import { isSaaSSelfServe } from "@/server/auth/registration";
import { sendEmail, isEmailConfigured, type EmailMessage } from "./email";
import { billingFromMetadata } from "@/server/saas/billing";

/**
 * Correos del ciclo de la prueba (capa de agencia): «tu prueba termina en 2
 * días» y «tu prueba terminó, tu agente está en pausa». Salen por el conector
 * de correo (apagado sin `RESEND_API_KEY` + `EMAIL_FROM`: entonces no se
 * reclama ni se manda nada).
 *
 * Sin infraestructura nueva: un temporizador en el mismo proceso que el worker
 * del agente. Cada correo sale UNA vez por negocio: antes de mandar se
 * «reclama» con una marca en el metadata de la organización (`allok.lifecycle`)
 * mediante un UPDATE condicional, así dos procesos o dos pasadas seguidas no
 * mandan el mismo. Si el envío falla, la marca se quita y la próxima pasada lo
 * reintenta.
 * ponytail: la marca vive en el mismo JSON que facturación; un webhook que
 * escriba justo entre el reclamo y su lectura podría borrarla y repetir un
 * correo. Si algún día pasa, va en su propia tabla.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Un «tu prueba terminó» de hace más de esto no se manda: al encender el conector no se escribe a quien se fue hace semanas. */
export const ENDED_MAIL_WINDOW_MS = 7 * DAY_MS;
const POLL_MS = 15 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;

export type LifecycleKey = "trialEnding" | "trialEnded";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** El subdominio del negocio, donde vive Facturación. En local, `<slug>.localhost:<puerto>`. */
export function tenantBaseUrl(slug: string): string {
  const base = new URL(process.env.APP_BASE_URL?.trim() || "http://localhost:3000");
  if (base.hostname === "localhost") return `${base.protocol}//${slug}.localhost${base.port ? `:${base.port}` : ""}`;
  return `https://${slug}.${resolvedRootDomain()}`;
}

type MailInput = { to: string; billingUrl: string; endsAt: string; timeZone?: string; brandName?: string; now?: number };

function layout(paragraphs: string[], billingUrl: string, button: string, footnote: string): string {
  const href = escapeHtml(billingUrl);
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#0b0d0e;max-width:480px;margin:0 auto;padding:24px;line-height:1.5">',
    "<p>Hola,</p>",
    ...paragraphs.map((p) => `<p>${p}</p>`),
    `<p style="margin:24px 0"><a href="${href}" style="background:#0b0d0e;color:#f7f8f8;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">${button}</a></p>`,
    `<p style="font-size:13px;color:#5b6167">¿No abre el botón? Copia este enlace en tu navegador:<br><a href="${href}" style="color:#5b6167;word-break:break-all">${href}</a></p>`,
    `<p style="font-size:13px;color:#5b6167">${footnote}</p>`,
    "</div>",
  ].join("");
}

const planLines = () =>
  `${PLAN_CATALOG.basic.name} (US$${PLAN_CATALOG.basic.priceUsd} al mes): ${PLAN_CATALOG.basic.answers} ${PLAN_CATALOG.pro.name} (US$${PLAN_CATALOG.pro.priceUsd} al mes): ${PLAN_CATALOG.pro.answers}`;

/** «Tu prueba termina en 2 días». */
export function buildTrialEndingEmail(input: MailInput): EmailMessage {
  const name = input.brandName ?? brand().name;
  const date = planDate(input.endsAt, input.timeZone) ?? "pronto";
  const left = Math.max(0, Date.parse(input.endsAt) - (input.now ?? Date.now()));
  const when = left <= DAY_MS ? "mañana" : "en 2 días";
  const subject = `Tu prueba de ${name} termina ${when}`;
  const text = [
    "Hola,",
    "",
    `Tu prueba gratis de ${name} termina el ${date}.`,
    "",
    "Si eliges un plan antes, tu agente sigue contestando sin pausa. Si no, se pone en pausa ese día. Tus conversaciones y tu configuración se quedan donde están.",
    "",
    `Elegir mi plan: ${input.billingUrl}`,
    "",
    planLines(),
    "",
    name,
  ].join("\n");
  const html = layout(
    [
      `Tu prueba gratis de ${escapeHtml(name)} termina el <strong>${escapeHtml(date)}</strong>.`,
      "Si eliges un plan antes, tu agente sigue contestando sin pausa. Si no, se pone en pausa ese día. Tus conversaciones y tu configuración se quedan donde están.",
    ],
    input.billingUrl,
    "Elegir mi plan",
    escapeHtml(planLines()),
  );
  return { to: input.to, subject, text, html };
}

/** «Tu prueba terminó, tu agente está en pausa». */
export function buildTrialEndedEmail(input: MailInput): EmailMessage {
  const name = input.brandName ?? brand().name;
  const date = planDate(input.endsAt, input.timeZone) ?? "hace poco";
  const subject = `Tu prueba de ${name} terminó: tu agente está en pausa`;
  const text = [
    "Hola,",
    "",
    `Tu prueba gratis de ${name} terminó el ${date} y tu agente dejó de contestar.`,
    "",
    "Tus conversaciones, tus contactos y tu configuración siguen en tu cuenta. Elige un plan y tu agente vuelve a contestar al momento:",
    "",
    input.billingUrl,
    "",
    planLines(),
    "",
    name,
  ].join("\n");
  const html = layout(
    [
      `Tu prueba gratis de ${escapeHtml(name)} terminó el <strong>${escapeHtml(date)}</strong> y tu agente dejó de contestar.`,
      "Tus conversaciones, tus contactos y tu configuración siguen en tu cuenta. Elige un plan y tu agente vuelve a contestar al momento.",
    ],
    input.billingUrl,
    "Elegir mi plan",
    escapeHtml(planLines()),
  );
  return { to: input.to, subject, text, html };
}

type Row = { id: string; slug: string | null; metadata: string | null; email: string; timezone: string | null };

/** Negocios con prueba de autoservicio (el filtro fino lo hace `derivePlanState`) y el correo de su dueño. */
async function trialCandidates(): Promise<Row[]> {
  const rows = await getDb().execute(sql`
    select distinct on (o.id) o.id, o.slug, o.metadata, u.email, p.business_timezone as timezone
    from organization o
    join member m on m.organization_id = o.id and m.role = 'owner'
    join "user" u on u.id = m.user_id
    left join agent_profile p on p.organization_id = o.id
    where o.metadata like '%self_serve_trial%' and o.slug is not null
    order by o.id, m.created_at asc`);
  return rows as unknown as Row[];
}

/** Marca el correo como enviado solo si nadie lo marcó antes: true = este proceso lo manda. */
async function claim(organizationId: string, key: LifecycleKey, at: Date): Promise<boolean> {
  const claimed = await getDb().execute(sql`
    update organization
    set metadata = jsonb_set(
      metadata::jsonb,
      '{allok,lifecycle}',
      coalesce(metadata::jsonb #> '{allok,lifecycle}', '{}'::jsonb) || jsonb_build_object(${key}::text, ${at.toISOString()}::text),
      true
    )::text
    where id = ${organizationId}
      and (metadata::jsonb #>> array['allok', 'lifecycle', ${key}::text]) is null
    returning id`);
  return (claimed as unknown as unknown[]).length > 0;
}

async function release(organizationId: string, key: LifecycleKey): Promise<void> {
  await getDb().execute(sql`
    update organization
    set metadata = (metadata::jsonb #- array['allok', 'lifecycle', ${key}::text])::text
    where id = ${organizationId}`);
}

export type LifecycleResult = { ending: number; ended: number; failed: number };

/**
 * Una pasada: manda lo que toca y no se haya mandado. Seguro de repetir. Con el
 * conector de correo apagado (o fuera del autoservicio) no hace nada.
 */
export async function runTrialLifecycleOnce(now = new Date()): Promise<LifecycleResult> {
  const result: LifecycleResult = { ending: 0, ended: 0, failed: 0 };
  if (!isAllokSaaSMode() || !isSaaSSelfServe() || !isEmailConfigured()) return result;

  for (const row of await trialCandidates()) {
    if (!row.slug) continue;
    // Sin respuestas: el correo se decide por fecha; el tope no lo dispara.
    const plan = derivePlanState(billingFromMetadata(row.metadata), null, now.getTime());
    let key: LifecycleKey | null = null;
    if (plan.kind === "trial_ending" && plan.endsAt && Date.parse(plan.endsAt) - now.getTime() <= TRIAL_ENDING_MS) {
      key = "trialEnding";
    } else if (plan.kind === "trial_ended" && plan.endsAt && now.getTime() - Date.parse(plan.endsAt) <= ENDED_MAIL_WINDOW_MS) {
      key = "trialEnded";
    }
    if (!key || !plan.endsAt) continue;
    if (!(await claim(row.id, key, now))) continue;

    const input: MailInput = {
      to: row.email,
      billingUrl: `${tenantBaseUrl(row.slug)}/settings/billing`,
      endsAt: plan.endsAt,
      timeZone: row.timezone ?? undefined,
      now: now.getTime(),
    };
    const sent = await sendEmail(key === "trialEnding" ? buildTrialEndingEmail(input) : buildTrialEndedEmail(input));
    if (sent.ok) {
      if (key === "trialEnding") result.ending++;
      else result.ended++;
    } else {
      // Que la próxima pasada lo reintente: un fallo del proveedor no pierde el aviso.
      result.failed++;
      await release(row.id, key).catch(() => {});
    }
  }
  return result;
}

const globalForLifecycle = globalThis as unknown as { __voceroTrialLifecycle?: boolean };

/** Arranca una sola vez por proceso, junto al worker del agente. */
export function startTrialLifecycle(): void {
  if (!isAllokSaaSMode() || process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalForLifecycle.__voceroTrialLifecycle) return;
  globalForLifecycle.__voceroTrialLifecycle = true;
  const tick = async () => {
    try {
      await runTrialLifecycleOnce();
    } catch (error) {
      console.error("[trial-lifecycle] pasada falló:", error);
    }
    const next = setTimeout(() => void tick(), POLL_MS);
    next.unref?.();
  };
  const first = setTimeout(() => void tick(), FIRST_RUN_MS);
  first.unref?.();
}
