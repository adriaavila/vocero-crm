/**
 * E2E del respaldo («Si en tu horario nadie le contesta a un cliente: contesta
 * el agente a los N minutos»), contra la app viva en modo SaaS con los mocks.
 *
 * El equipo atiende las 24 h en «Cuando no atiendes tú»: sin respaldo el
 * agente no contestaría nunca, así que todo lo que conteste es del respaldo.
 * Para no esperar 5 minutos de verdad, la espera del cliente se ATRASA en la
 * base (sus mensajes y `last_inbound_at`) y se deja que el barrido del worker
 * (cada minuto) haga su trabajo como en producción.
 *
 * Cubre:
 *  - sin Completo, el respaldo se rechaza (402);
 *  - la pantalla Tu negocio ofrece el selector;
 *  - un cliente recién llegado: el agente calla (es el turno del equipo);
 *  - el mismo cliente con 6 min esperando: contesta el agente;
 *  - ese cliente vuelve a escribir: el agente sigue la charla sin esperar;
 *  - un chat que el dueño contestó desde el teléfono: el agente no se mete;
 *  - con el respaldo apagado, el cliente espera al equipo.
 *
 * Uso: pnpm test:e2e:respaldo
 * Requiere: la app viva en modo SaaS con los mocks (WA_MOCK_ENABLED, META_GRAPH_BASE_URL y
 * OPENAI_BASE_URL → mocks), la base migrada y DATABASE_URL. Re-ejecutable: correos y
 * teléfonos propios por corrida.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const port = new URL(base).port;
const host = (sub) => `${sub}.localhost${port ? `:${port}` : ""}`;
const RUN = String(Date.now()).slice(-7);
const password = "password-e2e-123";

let failures = 0;
function check(label, ok, extra = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? ` — ${extra}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 20000, paso = 1000) {
  const fin = Date.now() + ms;
  for (;;) {
    try {
      if (await cond()) return true;
    } catch {
      /* reintenta */
    }
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}
const headers = (h, ip = "203.0.113.41") => ({
  origin: `http://${h}`,
  "x-forwarded-host": h,
  "x-forwarded-proto": "http",
  "x-forwarded-for": ip,
  "content-type": "application/json",
});

async function adopt(context, response, tenantHost) {
  const raw = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
  const value = raw.match(/better-auth\.session_token=([^;]+)/)?.[1];
  if (value) await context.addCookies([{ name: "better-auth.session_token", value, url: `http://${tenantHost}`, httpOnly: true }]);
}

// Solo para lo que el producto no deja hacer sin Stripe ni reloj: conceder el plan,
// encender el agente sin pasar por la prueba, y atrasar la espera del cliente.
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const browser = await chromium.launch();

const TODO_EL_DIA = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "00:00" }]])
);

try {
  const owner = await browser.newContext();
  const su = await owner.request.post(`${base}/api/auth/sign-up/email`, {
    timeout: 90000,
    headers: headers(host("app")),
    data: { email: `respaldo-${RUN}@vocero.test`, password, name: `Inmobiliaria Respaldo ${RUN}` },
  });
  check("el negocio crea su cuenta", su.ok(), String(su.status()));
  const tenant = await (await owner.request.get(`${base}/api/saas/tenant`, { timeout: 90000, headers: headers(host("app")) })).json();
  const tenantHost = new URL(tenant.url).host.replace(/:\d+$/, "") + (port ? `:${port}` : "");
  const slug = tenantHost.split(".")[0];
  await adopt(owner, su, tenantHost);
  const H = headers(tenantHost);
  const api = (path, init = {}) => owner.request.fetch(`${base}${path}`, { timeout: 90000, ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const [org] = await sql`select id from organization where slug = ${slug}`;

  const horario = (backupMinutes) => ({
    weeklyHours: TODO_EL_DIA,
    timezone: "America/La_Paz",
    responseMode: "outside_hours",
    handoffResumeHours: null,
    backupMinutes,
  });

  // ---- Es de Completo
  const sinPlan = await api("/api/settings/business-hours", { method: "PUT", data: horario(5) });
  check("sin Completo, el respaldo se rechaza (402)", sinPlan.status() === 402, String(sinPlan.status()));

  await sql`update organization set metadata = ${JSON.stringify({ allok: { billing: { plan: "pro", status: "active" } } })} where id = ${org.id}`;
  const conPlan = await api("/api/settings/business-hours", { method: "PUT", data: horario(5) });
  const guardado = await conPlan.json().catch(() => ({}));
  check("con Completo se guarda a los 5 minutos", conPlan.ok() && guardado.settings?.backupMinutes === 5, JSON.stringify(guardado));
  const raro = await api("/api/settings/business-hours", { method: "PUT", data: horario(999) });
  check("un valor fuera de rango se rechaza", raro.status() === 422 || raro.status() === 400, String(raro.status()));

  // ---- La pantalla
  const page = await owner.newPage();
  await page.goto(`http://${tenantHost}/agent#horario`, { waitUntil: "load", timeout: 90000 });
  const label = page.getByText("Si en tu horario nadie le contesta a un cliente");
  const visible = await hasta(async () => (await label.count()) > 0 && (await label.first().isVisible()), 30000);
  check("Tu negocio ofrece «Si en tu horario nadie le contesta a un cliente»", visible);
  const selector = page.locator("#backup-minutes");
  check("y muestra lo guardado: «Contesta … a los 5 minutos»", /a los 5 minutos/.test((await selector.innerText().catch(() => "")) ?? ""), await selector.innerText().catch(() => "?"));

  // ---- WhatsApp y agente
  const PN = `PN-RESP-${RUN}`;
  const conn = await api("/api/settings/whatsapp", { method: "PUT", data: { wabaId: `WABA-RESP-${RUN}`, phoneNumberId: PN, token: "tok-respaldo" } });
  check("conecta WhatsApp (mock)", conn.ok(), String(conn.status()));
  await sql`update agent_profile set enabled = true where organization_id = ${org.id}`;

  let n = 0;
  const telefono = (k) => `5917${RUN}${k}`;
  const inbound = (k, text) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      data: { phoneNumberId: PN, from: telefono(k), name: `Comprador ${k}`, text, waMessageId: `wamid.resp.${RUN}.${n++}` },
    });
  const conversacion = async (k) =>
    (
      await sql`select c.id from conversation c join contact ct on ct.id = c.contact_id
        where c.organization_id = ${org.id} and ct.wa_identity = ${telefono(k)} limit 1`
    )[0]?.id ?? null;
  const respuestasIa = async (convId) =>
    (await sql`select count(*)::int n from message where conversation_id = ${convId} and direction = 'out' and origin = 'ai'`)[0].n;
  const sinTrabajo = (convId) =>
    hasta(async () => (await sql`select count(*)::int n from agent_job where conversation_id = ${convId} and status in ('queued','running')`)[0].n === 0, 30000);
  /** El cliente lleva `min` minutos esperando: se atrasan sus mensajes y la conversación. */
  const atrasar = async (convId, min) => {
    const hace = sql`now() - make_interval(mins => ${min})`;
    await sql`update message set created_at = ${hace} where conversation_id = ${convId} and direction = 'in'
      and created_at > coalesce((select max(created_at) from message where conversation_id = ${convId} and direction = 'out'), '-infinity'::timestamp)`;
    await sql`update conversation set last_inbound_at = ${hace}, last_message_at = ${hace} where id = ${convId}`;
  };

  // ---- 1. Recién llegado: es el turno del equipo
  await inbound(1, "Hola, ¿cuánto cuesta la Vivienda 2?");
  const c1 = await hasta(async () => Boolean(await conversacion(1)));
  const conv1 = await conversacion(1);
  check("el mensaje entra por el webhook", c1);
  await sinTrabajo(conv1);
  await sleep(5000);
  check("recién llegado: el agente calla, es el turno del equipo", (await respuestasIa(conv1)) === 0);

  // ---- 2. Seis minutos sin respuesta: contesta el agente (el barrido corre cada minuto)
  await atrasar(conv1, 6);
  const contesto = await hasta(async () => (await respuestasIa(conv1)) >= 1, 150000, 2000);
  check("con 6 min esperando, contesta el agente", contesto);

  // ---- 3. El cliente sigue: el agente sigue la charla sin volver a esperar
  const antes = await respuestasIa(conv1);
  await inbound(1, "¿Y tiene garaje?");
  const sigue = await hasta(async () => (await respuestasIa(conv1)) > antes, 45000, 1000);
  check("el cliente vuelve a escribir: el agente contesta sin esperar otros 5 min", sigue);

  // ---- 4. Un chat que el dueño contestó desde el teléfono
  await inbound(2, "Hola, quiero visitar");
  await hasta(async () => Boolean(await conversacion(2)));
  const conv2 = await conversacion(2);
  await sinTrabajo(conv2);
  const eco = await api("/api/dev/wa-mock/echo", { method: "POST", data: { phoneNumberId: PN, to: telefono(2), text: "¡Hola! Soy Marcelo, ¿cuándo te queda?" } });
  check("el dueño contesta desde el teléfono (eco)", eco.ok(), String(eco.status()));
  await hasta(async () => (await sql`select count(*)::int n from message where conversation_id = ${conv2} and origin = 'manual'`)[0].n > 0);
  await inbound(2, "El sábado puede ser");
  await sinTrabajo(conv2);
  await atrasar(conv2, 6);

  // ---- 5. Respaldo apagado: el cliente espera al equipo
  await inbound(3, "Hola, info por favor");
  await hasta(async () => Boolean(await conversacion(3)));
  const conv3 = await conversacion(3);
  await sinTrabajo(conv3);
  const apagado = await api("/api/settings/business-hours", { method: "PUT", data: horario(null) });
  check("se apaga el respaldo", apagado.ok(), String(apagado.status()));
  await atrasar(conv3, 6);

  // Dos barridos completos para los dos casos que deben quedarse callados.
  await sleep(130000);
  check("en el chat que lleva el dueño, el agente no se mete", (await respuestasIa(conv2)) === 0);
  check("con el respaldo apagado, el cliente espera al equipo", (await respuestasIa(conv3)) === 0);
} finally {
  await browser.close();
  await sql.end();
}

console.log(failures ? `\n${failures} FALLO(S)` : "\nTODO VERDE");
process.exit(failures ? 1 : 0);
