/**
 * E2E del Inicio del SaaS (centro de mando): las tarjetas de «Por dónde
 * arrancar», «Pregúntale a allok» contra el ai-mock (rama ASK_MARKER), el tope
 * de 20 al día, y que un miembro no pueda calificar decisiones (PATCH → 403).
 *
 * Como saas-isolation-check, crea sus negocios por el registro público: en
 * modo SaaS eso solo pasa con WA_MOCK_ENABLED=true en `next dev`. Cada corrida
 * usa correos y teléfonos propios, así que se puede repetir.
 *
 * Uso: pnpm test:e2e:centro  (= ALLOK_SAAS_MODE=true node --env-file=.env scripts/saas-centro-check.mjs)
 * Requiere: la app viva en modo SaaS con los mocks (WA_MOCK_ENABLED, META_GRAPH_BASE_URL y
 * OPENAI_BASE_URL → mocks), la base migrada y DATABASE_URL.
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
async function hasta(cond, ms = 20000, paso = 400) {
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
const headers = (h, ip = "203.0.113.31") => ({
  origin: `http://${h}`,
  "x-forwarded-host": h,
  "x-forwarded-proto": "http",
  "x-forwarded-for": ip,
  "content-type": "application/json",
});

/**
 * La cookie de sesión llega con `Domain=.localhost`; Chromium no la manda a
 * `<negocio>.localhost`, así que a la PÁGINA se la ponemos por URL. Las
 * llamadas por `request` ya la usan tal cual.
 */
async function adopt(context, response, tenantHost) {
  const raw = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
  const value = raw.match(/better-auth\.session_token=([^;]+)/)?.[1];
  if (value) await context.addCookies([{ name: "better-auth.session_token", value, url: `http://${tenantHost}`, httpOnly: true }]);
}

// Solo para lo que el producto no deja hacer sin Stripe o sin un agente real: conceder el plan y apagar el agente.
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const browser = await chromium.launch();

try {
  const owner = await browser.newContext();
  const mailMember = `centro-member-${RUN}@vocero.test`;
  const ownerEmail = `centro-owner-${RUN}@vocero.test`;
  const su = await owner.request.post(`${base}/api/auth/sign-up/email`, { timeout: 90000,
    headers: headers(host("app")),
    data: { email: ownerEmail, password, name: `Tienda Centro ${RUN}` },
  });
  check("el negocio crea su cuenta", su.ok(), String(su.status()));
  const tenant = await (await owner.request.get(`${base}/api/saas/tenant`, { timeout: 90000, headers: headers(host("app")) })).json();
  const tenantHost = new URL(tenant.url).host.replace(/:\d+$/, "") + (port ? `:${port}` : "");
  const slug = tenantHost.split(".")[0];
  await adopt(owner, su, tenantHost);
  const H = headers(tenantHost);
  const api = (path, init = {}) => owner.request.fetch(`${base}${path}`, { timeout: 90000, ...init, headers: { ...H, ...(init.headers ?? {}) } });

  await sql`update organization set metadata = ${JSON.stringify({ allok: { billing: { plan: "pro", status: "active" } } })} where slug = ${slug}`;
  const PN = `PN-CENTRO-${RUN}`;
  const conn = await api("/api/settings/whatsapp", { method: "PUT", data: { wabaId: `WABA-CENTRO-${RUN}`, phoneNumberId: PN, token: "tok-centro" } });
  check("conecta WhatsApp (mock)", conn.ok(), String(conn.status()));
  // Sin agente: nadie contesta solo, así que lo que entra queda esperando.
  await sql`update agent_profile set enabled = false where organization_id = (select id from organization where slug = ${slug})`;

  // ---- Lo que entra por el ingest real
  const inbound = (n, name, text, extra = {}) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      data: { phoneNumberId: PN, from: `5841${RUN}${n}`, name, text, waMessageId: `wamid.centro.${RUN}.${n}`, ...extra },
    });
  await inbound(1, "Cliente Precio E2E", "Hola, ¿cuánto cuesta el plan mensual?");
  await inbound(2, "Cliente Anuncio E2E", "Vi su anuncio", {
    referral: { source_id: `ad-${RUN}`, source_type: "ad", headline: "Anuncio E2E", ctwa_clid: `clid-${RUN}` },
  });
  const listed = await hasta(async () => {
    const convs = (await (await api("/api/conversations")).json()).conversations ?? [];
    return ["Cliente Precio E2E", "Cliente Anuncio E2E"].every((n) => convs.some((c) => c.contact.name === n && c.preview));
  });
  check("las dos conversaciones entran por el webhook", listed);

  // ---- La pantalla
  const page = await owner.newPage();
  const home = `http://${tenantHost}/overview?p=7d`;
  await page.goto(home, { waitUntil: "load", timeout: 90000 });
  await page.getByText("Por dónde arrancar").first().waitFor({ timeout: 30000 });
  const text = await page.locator("main, body").first().innerText();
  check("el encabezado cuenta las que te necesitan", /2 conversaciones te necesitan ahora/.test(text), text.slice(0, 200));
  check("la tarjeta del precio dice su razón y su ventana", /Cliente Precio E2E/.test(text) && /Preguntó el precio/.test(text) && /Quedan 2[34] h/.test(text));
  check("la del anuncio dice «Llegó por un anuncio»", /Llegó por un anuncio/.test(text));
  const respond = page.getByRole("link", { name: "Responder a Cliente Precio E2E" });
  check("«Responder» abre la conversación", /\/inbox\?contact=ct_/.test((await respond.getAttribute("href")) ?? ""));
  check("sin datos viejos: no hay tarjetas fantasma", (await page.getByRole("link", { name: /^Responder a / }).count()) === 2);

  // ---- Pregúntale a allok
  const chip = await api("/api/centro/ask", { method: "POST", data: { chip: "hoy" } });
  const chipJson = await chip.json();
  check("«¿Qué hago hoy?» se contesta con los datos, sin modelo", chip.ok() && chipJson.source === "datos" && /Cliente (Precio|Anuncio) E2E/.test(chipJson.answer), JSON.stringify(chipJson));
  const free = await api("/api/centro/ask", { method: "POST", data: { question: "¿Cómo va mi día?" } });
  const freeJson = await free.json();
  check("el texto libre pasa por el ai-mock (rama ASK_MARKER) con el resumen de ESTE negocio", free.ok() && freeJson.source === "ia" && freeJson.answer.includes(`Tienda Centro ${RUN}`) && /2 te necesitan/.test(freeJson.answer), JSON.stringify(freeJson));
  check("y descuenta del tope", freeJson.remaining === 19, String(freeJson.remaining));
  const bad = await api("/api/centro/ask", { method: "POST", data: { question: "hola de nuevo", organizationId: "org_otra" } });
  check("una organización en el body se rechaza", bad.status() === 422);

  let last = free;
  for (let i = 0; i < 19; i++) last = await api("/api/centro/ask", { method: "POST", data: { question: `Pregunta ${i}` } });
  check("la pregunta 20 todavía contesta", last.ok());
  const over = await api("/api/centro/ask", { method: "POST", data: { question: "una más" } });
  check("la 21 responde 429", over.status() === 429, String(over.status()));
  const chipAfter = await api("/api/centro/ask", { method: "POST", data: { chip: "semana" } });
  check("las sugeridas siguen contestando con el tope agotado", chipAfter.ok());
  await page.goto(home, { waitUntil: "load", timeout: 90000 });
  await page.getByText("Por dónde arrancar").first().waitFor({ timeout: 30000 });
  check("al recargar, el campo nace deshabilitado", await page.locator("#ask-input").isDisabled());

  // ---- Un miembro lee, pero no califica
  // El alta de equipo (`POST /api/settings/team`) hoy responde 422 en el SaaS ("El registro de Allok empieza en
  // app…": su registro interno cae en el guardia de host). No es de esta pantalla: se crea al miembro por el
  // registro público y se le da su fila de membresía, que es lo que el alta haría.
  const memberSignup = await browser.newContext();
  const ms = await memberSignup.request.post(`${base}/api/auth/sign-up/email`, { timeout: 90000,
    headers: headers(host("app"), "203.0.113.32"),
    data: { email: mailMember, password, name: "Miembro Centro" },
  });
  const [org] = await sql`select id from organization where slug = ${slug}`;
  const [memberUser] = await sql`select id from "user" where email = ${mailMember}`;
  await sql`insert into member (id, organization_id, user_id, role, created_at) values (${"mb_centro_" + RUN}, ${org.id}, ${memberUser.id}, 'member', now()) on conflict do nothing`;
  check("se crea un miembro del equipo (rol member)", ms.ok() && Boolean(memberUser), String(ms.status()));
  await memberSignup.close();
  const member = await browser.newContext();
  const login = await member.request.post(`${base}/api/auth/sign-in/email`, { timeout: 90000, headers: H, data: { email: mailMember, password } });
  check("el miembro entra", login.ok(), String(login.status()));
  await adopt(member, login, tenantHost);
  const mApi = (path, init = {}) => member.request.fetch(`${base}${path}`, { timeout: 90000, ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const readDecisions = await mApi("/api/decisions");
  check("el miembro puede LEER las decisiones", readDecisions.ok(), String(readDecisions.status()));
  const patchMember = await mApi("/api/decisions/dec_inexistente", { method: "PATCH", data: { verdict: "bien" } });
  check("el miembro NO califica: PATCH → 403", patchMember.status() === 403, String(patchMember.status()));
  const patchOwner = await api("/api/decisions/dec_inexistente", { method: "PATCH", data: { verdict: "bien" } });
  check("el propietario pasa la puerta (la decisión no existe → 404)", patchOwner.status() === 404, String(patchOwner.status()));
  const memberPage = await member.newPage();
  await memberPage.goto(`http://${tenantHost}/decisiones`, { waitUntil: "load", timeout: 90000 });
  check("la pantalla de un miembro no ofrece Bien / Falló", (await memberPage.getByRole("button", { name: "Falló" }).count()) === 0);
} finally {
  await browser.close();
  await sql.end();
}

console.log(failures ? `\n${failures} FALLO(S)` : "\nTODO VERDE");
process.exit(failures ? 1 : 0);
