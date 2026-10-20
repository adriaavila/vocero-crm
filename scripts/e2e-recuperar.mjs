/**
 * Self-test E2E de comportamiento — «Clientes que no volvieron».
 * Guion tests/e2e/us-recuperar.md.
 *
 * El dueño manda a Meta el mensaje propuesto, Meta lo aprueba, lo enciende
 * en «Tu negocio» y el agente le escribe UNA vez, con la plantilla, al cliente
 * que vino hace meses y no volvió; no al que solo preguntó, ni al que tiene
 * cita por delante. Si el cliente contesta, cuenta como «volvió».
 *
 * Uso: node --env-file=.env scripts/e2e-recuperar.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true, BD migrada y
 * Playwright. Re-ejecutable: deja el ajuste apagado como lo encontró.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-RECUPERAR-1";
const WABA = "WABA-RECUPERAR";
// Solo letras: el nombre del cliente tiene que parecer nombre para ir en la plantilla.
const S = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
const D = 86_400_000;
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const req = ctx.request;
const json = async (r) => r.json().catch(() => null);

console.log("== Setup ==");
let r = await req.post(`${BASE}/api/auth/sign-up/email`, {
  headers: { origin: BASE },
  data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
});
if (!r.ok())
  r = await req.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@vocero.test", password: "password-e2e-123" },
  });
ok("login", r.ok());
await req.put(`${BASE}/api/settings/whatsapp`, { data: { wabaId: WABA, phoneNumberId: PN, token: "tok-rec" } });

async function cliente(nombre) {
  const from = `521479${Math.floor(Math.random() * 9e6) + 1e6}`;
  await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
    data: { phoneNumberId: PN, from, name: nombre, text: `hola, soy ${nombre}`, waMessageId: `wamid.rec.${nombre}` },
  });
  for (let i = 0; i < 20; i++) {
    const convs = (await json(await req.get(`${BASE}/api/conversations`)))?.conversations ?? [];
    const conv = convs.find((c) => c.contact.name === nombre);
    if (conv) return conv;
    await new Promise((res) => setTimeout(res, 300));
  }
  return null;
}

const vino = await cliente(`Ana${S}`);
const pregunto = await cliente(`Beto${S}`);
const conCita = await cliente(`Caro${S}`);
ok("tres clientes en la bandeja", !!(vino && pregunto && conCita));
if (!vino || !pregunto || !conCita) {
  await browser.close();
  await sql.end();
  process.exit(1);
}
const org = vino.organizationId ?? (await sql`SELECT organization_id FROM conversation WHERE id = ${vino.id}`)[0].organization_id;
const [perfil] = await sql`SELECT enabled, allowlist_enabled FROM agent_profile WHERE organization_id = ${org}`;
await sql`UPDATE agent_profile SET enabled = true, allowlist_enabled = false WHERE organization_id = ${org}`;

// Llevamos a los tres al pasado: hace 120 días que no se sabe de ellos.
const hace = new Date(Date.now() - 120 * D);
for (const c of [vino, pregunto, conCita]) {
  await sql`UPDATE conversation SET last_inbound_at = ${hace}, last_message_at = ${hace}, ai_enabled = true, handoff_at = NULL WHERE id = ${c.id}`;
}
await sql`DELETE FROM agent_decision WHERE conversation_id IN ${sql([vino.id, pregunto.id, conCita.id])}`;
const nueva = (contacto, convId, cuando, status) => sql`
  INSERT INTO booking (id, organization_id, contact_id, conversation_id, status, scheduled_at, duration_minutes)
  VALUES (${`bk_rec_${S}_${status}_${convId.slice(-4)}`}, ${org}, ${contacto}, ${convId}, ${status}, ${cuando}, 30)`;
await nueva(vino.contact.id, vino.id, new Date(Date.now() - 125 * D), "realizada");
await nueva(conCita.contact.id, conCita.id, new Date(Date.now() - 125 * D), "realizada");
await nueva(conCita.contact.id, conCita.id, new Date(Date.now() + 5 * D), "agendada");

console.log("\n== El mensaje va primero a Meta ==");
await sql`UPDATE agent_profile SET recuperar_dias = NULL, recuperar_template_id = NULL WHERE organization_id = ${org}`;
await sql`DELETE FROM template WHERE organization_id = ${org} AND name = 'recuperar_clientes'`;
let estado = await json(await req.get(`${BASE}/api/agent/recuperar`));
ok("apagado por defecto", estado?.dias === 0, JSON.stringify(estado));
ok("cuenta solo al cliente que vino y no tiene cita", estado?.esperando >= 1, JSON.stringify(estado?.esperando));
r = await req.put(`${BASE}/api/agent/recuperar`, { data: { dias: 90, templateId: null } });
ok("encender sin mensaje → 422", r.status() === 422, String(r.status()));

const page = await ctx.newPage();
await page.goto(`${BASE}/agent`, { waitUntil: "load" });
const tarjeta = page.getByText("Clientes que no volvieron");
await tarjeta.first().waitFor({ timeout: 20000 }).catch(() => {});
ok("«Tu negocio» muestra «Clientes que no volvieron»", (await tarjeta.count()) > 0);
await page.getByRole("button", { name: "Mandar el mensaje a Meta" }).click();
await page.getByText("esperando la aprobación de Meta").waitFor({ timeout: 15000 }).catch(() => {});
ok("queda esperando a Meta", (await page.getByText("esperando la aprobación de Meta").count()) > 0);
const remota = await json(await req.get(`${BASE}/api/dev/wa-mock/graph/${WABA}/message_templates`));
const enMeta = (remota?.data ?? []).find((t) => t.name === "recuperar_clientes");
ok("Meta la recibió como MARKETING", enMeta?.category === "MARKETING", JSON.stringify(enMeta));

await req.post(`${BASE}/api/dev/wa-mock/template-status`, {
  data: { wabaId: WABA, name: "recuperar_clientes", language: "es", event: "APPROVED", notify: false },
});
await req.post(`${BASE}/api/templates/sync`);

console.log("\n== El dueño lo enciende ==");
await page.reload({ waitUntil: "load" });
const selector = page.locator("#recuperar");
await selector.waitFor({ timeout: 20000 });
await selector.click();
await page.getByRole("option", { name: /90 días/ }).click();
await page.getByText("Guardado").first().waitFor({ timeout: 10000 }).catch(() => {});
estado = await json(await req.get(`${BASE}/api/agent/recuperar`));
ok("quedó en 90 días con la plantilla aprobada", estado?.dias === 90 && !!estado?.templateId, JSON.stringify(estado));
await page.screenshot({ path: "scratch/recuperar-ajuste.png", fullPage: false }).catch(() => {});

console.log("\n== El agente les escribe ==");
// A las 15:00 de la zona del negocio: la franja permitida es de 10:00 a 19:00.
const [{ business_timezone: tz }] = await sql`SELECT business_timezone FROM agent_profile WHERE organization_id = ${org}`;
const hoy = new Date();
hoy.setUTCHours(0, 0, 0, 0);
let alas15 = hoy;
for (let h = 0; h < 48; h++) {
  const t = new Date(hoy.getTime() + h * 3_600_000);
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(t));
  if (hora === 15 && t.getTime() > Date.now() - D) {
    alas15 = t;
    break;
  }
}
const noche = new Date(alas15.getTime() + 8 * 3_600_000);
r = await req.post(`${BASE}/api/dev/recuperar`, { data: { now: noche.toISOString() } });
ok("de noche no escribe", (await json(r))?.enviados === 0, JSON.stringify(await json(r)));
r = await req.post(`${BASE}/api/dev/recuperar`, { data: { now: alas15.toISOString() } });
ok("de día corre la pasada", r.ok(), String(r.status()));

const decisiones = await sql`SELECT conversation_id, action FROM agent_decision WHERE conversation_id IN ${sql([vino.id, pregunto.id, conCita.id])}`;
const a = (id) => decisiones.filter((d) => d.conversation_id === id).map((d) => d.action);
ok("al que vino y no volvió, sí", a(vino.id).includes("recuperar"), JSON.stringify(decisiones));
ok("al que solo preguntó, no", a(pregunto.id).length === 0);
ok("al que tiene cita por delante, no", a(conCita.id).length === 0);

const outbox = (await json(await req.get(`${BASE}/api/dev/wa-mock/outbox`)))?.outbox ?? [];
const salio = outbox.filter((o) => o.body?.type === "template" && o.body?.template?.name === "recuperar_clientes").pop();
const params = salio?.body?.template?.components?.[0]?.parameters?.map((p) => p.text) ?? [];
ok("salió la plantilla con su nombre", params[0] === `Ana${S}`, `${JSON.stringify(params)} vs Ana${S}`);
ok("y el del negocio", typeof params[1] === "string" && params[1].length > 0, JSON.stringify(params));

r = await req.post(`${BASE}/api/dev/recuperar`, { data: { now: new Date(alas15.getTime() + 600_000).toISOString() } });
const otra = await sql`SELECT count(*)::int AS n FROM agent_decision WHERE conversation_id = ${vino.id} AND action = 'recuperar'`;
ok("una sola vez por silencio", otra[0].n === 1, JSON.stringify(otra));

console.log("\n== El cliente contesta ==");
await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  data: {
    phoneNumberId: PN,
    from: vino.contact.phone ?? vino.contact.waIdentity,
    name: `Ana${S}`,
    text: "¡Hola! Sí, quiero volver",
    waMessageId: `wamid.rec.vuelve.${S}`,
  },
});
await new Promise((res) => setTimeout(res, 1500));
estado = await json(await req.get(`${BASE}/api/agent/recuperar`));
ok("cuenta que volvió", estado?.resultados?.volvieron >= 1, JSON.stringify(estado?.resultados));

console.log("\n== Caminos infelices ==");
r = await req.put(`${BASE}/api/agent/recuperar`, { data: { dias: 90, templateId: "tpl_no_existe" } });
ok("plantilla ajena o inexistente → 422", r.status() === 422, String(r.status()));
r = await req.put(`${BASE}/api/agent/recuperar`, { data: { dias: -5, templateId: null } });
ok("días inválidos → 422", r.status() === 422, String(r.status()));

// Lo dejamos como estaba: apagado.
await req.put(`${BASE}/api/agent/recuperar`, { data: { dias: 0, templateId: null } });
await sql`UPDATE agent_profile SET enabled = ${perfil.enabled}, allowlist_enabled = ${perfil.allowlist_enabled} WHERE organization_id = ${org}`;

await browser.close();
await sql.end();
console.log(`\n${failures === 0 ? "TODO VERDE" : `${failures} FALLO(S)`}`);
process.exit(failures ? 1 : 0);
