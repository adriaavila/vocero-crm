/**
 * E2E: cuando el agente le pasa una visita a una persona, el lead avanza solo
 * en el embudo. Contra la app viva en modo SaaS con los mocks.
 *
 * El dueño escribió en sus reglas que las visitas las lleva Marcelo (como
 * SAMER en Rei). Un cliente pide visitar: el agente lo pasa a una persona y
 * el lead sale de «Nuevo». Otro cliente solo pregunta el precio: el agente
 * contesta y el lead no se mueve. Con una etapa «Visita por coordinar», el
 * lead va ahí.
 *
 * Uso: pnpm test:e2e:visita
 * Requiere: la app viva en modo SaaS con los mocks (WA_MOCK_ENABLED, META_GRAPH_BASE_URL y
 * OPENAI_BASE_URL → mocks), la base migrada y DATABASE_URL. Re-ejecutable: correos y
 * teléfonos propios por corrida.
 */
import postgres from "postgres";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const port = new URL(base).port;
const host = (sub) => `${sub}.localhost${port ? `:${port}` : ""}`;
const RUN = String(Date.now()).slice(-7);

let failures = 0;
function check(label, ok, extra = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? ` — ${extra}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 30000, paso = 1000) {
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
const headers = (h) => ({
  origin: `http://${h}`,
  "x-forwarded-host": h,
  "x-forwarded-proto": "http",
  "x-forwarded-for": "203.0.113.42",
  "content-type": "application/json",
});

// Solo para lo que el producto no deja hacer sin Stripe: conceder el plan y
// encender el agente sin pasar por la prueba.
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  const su = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: headers(host("app")),
    body: JSON.stringify({ email: `visita-${RUN}@vocero.test`, password: "password-e2e-123", name: `Constructora Visita ${RUN}` }),
  });
  check("el negocio crea su cuenta", su.ok, String(su.status));
  const cookie = (su.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=[^;]+/)?.[0] ?? "";
  const tenant = await (await fetch(`${base}/api/saas/tenant`, { headers: { ...headers(host("app")), cookie } })).json();
  const tenantHost = new URL(tenant.url).host.replace(/:\d+$/, "") + (port ? `:${port}` : "");
  const slug = tenantHost.split(".")[0];
  const api = (path, init = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { ...headers(tenantHost), cookie, ...(init.headers ?? {}) } });
  const [org] = await sql`select id from organization where slug = ${slug}`;

  await sql`update organization set metadata = ${JSON.stringify({ allok: { billing: { plan: "pro", status: "active" } } })} where id = ${org.id}`;
  const TODO_EL_DIA = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "00:00" }]])
  );
  const horas = await api("/api/settings/business-hours", {
    method: "PUT",
    body: JSON.stringify({ weeklyHours: TODO_EL_DIA, timezone: "America/La_Paz", responseMode: "all_day", handoffResumeHours: null }),
  });
  check("el agente contesta todo el día", horas.ok, String(horas.status));

  const reglas = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ escalationRules: "Si el cliente quiere visitar una casa, pásalo a Marcelo." }),
  });
  check("las reglas del dueño pasan las visitas a Marcelo", reglas.ok, String(reglas.status));

  const PN = `PN-VIS-${RUN}`;
  const conn = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: `WABA-VIS-${RUN}`, phoneNumberId: PN, token: "tok-visita" }) });
  check("conecta WhatsApp (mock)", conn.ok, String(conn.status));
  await sql`update agent_profile set enabled = true where organization_id = ${org.id}`;

  let n = 0;
  const telefono = (k) => `5917${RUN}${k}`;
  const inbound = (k, text) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: PN, from: telefono(k), name: `Comprador ${k}`, text, waMessageId: `wamid.vis.${RUN}.${n++}` }),
    });
  const conversacion = async (k) =>
    (
      await sql`select c.id, c.handoff_at from conversation c join contact ct on ct.id = c.contact_id
        where c.organization_id = ${org.id} and ct.wa_identity = ${telefono(k)} limit 1`
    )[0] ?? null;
  const etapa = async (k) =>
    (
      await sql`select s.name from lead l join contact ct on ct.id = l.contact_id join pipeline_stage s on s.id = l.stage_id
        where l.organization_id = ${org.id} and ct.wa_identity = ${telefono(k)} limit 1`
    )[0]?.name ?? null;
  const respuestas = async (k) => {
    const c = await conversacion(k);
    if (!c) return 0;
    return (await sql`select count(*)::int n from message where conversation_id = ${c.id} and direction = 'out'`)[0].n;
  };

  // ---- 1. Pregunta el precio: contesta el agente, el lead no se mueve
  await inbound(1, "Hola, ¿cuánto cuesta la Vivienda 2?");
  const contesto = await hasta(async () => (await respuestas(1)) >= 1);
  check("pregunta el precio: el agente contesta", contesto);
  check("y el lead sigue en «Nuevo»", (await etapa(1)) === "Nuevo", String(await etapa(1)));

  // ---- 2. Pide visitar: pasa a una persona y el lead avanza
  await inbound(2, "Hola, quiero visitar la Vivienda 2 el sábado");
  const paso = await hasta(async () => Boolean((await conversacion(2))?.handoff_at));
  check("pide visitar: el agente lo pasa a una persona", paso);
  const avanzo = await hasta(async () => (await etapa(2)) === "Interesado", 15000, 500);
  check("y el lead avanza solo a la última etapa abierta («Interesado»)", avanzo, String(await etapa(2)));
  const [ev] = await sql`select e.source, e.to_stage_name from lead_stage_event e join contact ct on ct.id = e.contact_id
    where e.organization_id = ${org.id} and ct.wa_identity = ${telefono(2)} and e.from_stage_id is not null`;
  check("el movimiento queda en la bitácora como del agente", ev?.source === "bot" && ev?.to_stage_name === "Interesado", JSON.stringify(ev));

  // ---- 3. Con una etapa «Visita por coordinar», va ahí
  const crear = await api("/api/pipeline/stages", { method: "POST", body: JSON.stringify({ name: "Visita por coordinar" }) });
  check("el dueño agrega la etapa «Visita por coordinar»", crear.ok, String(crear.status));
  await inbound(3, "¿Puedo ir a ver la casa modelo mañana?");
  const aVisita = await hasta(async () => (await etapa(3)) === "Visita por coordinar", 30000, 500);
  check("otro cliente pide visita: su lead va a «Visita por coordinar»", aVisita, String(await etapa(3)));
} finally {
  await sql.end();
}

console.log(failures ? `\n${failures} FALLO(S)` : "\nTODO VERDE");
process.exit(failures ? 1 : 0);
