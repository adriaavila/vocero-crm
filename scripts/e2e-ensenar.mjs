/**
 * Self-test E2E de comportamiento — «Enséñaselo a tu agente».
 * Guion tests/e2e/us-ensenar.md.
 *
 * El cliente pregunta algo que el agente no sabía, el dueño contesta desde la
 * bandeja y, con un toque, esa respuesta queda como pregunta y respuesta del
 * conocimiento: la próxima vez el agente la contesta solo.
 *
 * Uso: node scripts/e2e-ensenar.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y Playwright.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-ENSENAR-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const req = ctx.request;

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
await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-ENSENAR", phoneNumberId: PN, token: "tok-e" },
});

const NAME = `Pregunta${S}`;
const PREGUNTA = `¿tienen estacionamiento ${S}?`;
const RESPUESTA = `Sí, estacionamiento gratis en el sótano ${S}.`;
await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  data: {
    phoneNumberId: PN,
    from: `521478${Math.floor(Math.random() * 9e6) + 1e6}`,
    name: NAME,
    text: PREGUNTA,
    waMessageId: `wamid.ensenar.${S}`,
  },
});
await new Promise((res) => setTimeout(res, 2000));

const convs = (await (await req.get(`${BASE}/api/conversations`)).json()).conversations;
const conv = convs.find((c) => c.contact.name === NAME);
ok("conversación creada", !!conv);
if (!conv) {
  await browser.close();
  process.exit(1);
}

console.log("\n== El dueño contesta desde la bandeja ==");
const page = await ctx.newPage();
await page.goto(`${BASE}/inbox?contact=${conv.contact.id}`, { waitUntil: "load" });
await page.getByText(PREGUNTA).last().waitFor({ timeout: 20000 });
await page.getByPlaceholder(/Escribe una respuesta/).fill(RESPUESTA);
await page.getByRole("button", { name: "Enviar", exact: true }).click();
await page.getByText(RESPUESTA).last().waitFor({ timeout: 15000 });

const boton = page.getByRole("button", { name: "Enséñaselo a tu agente" });
await boton.first().waitFor({ timeout: 10000 }).catch(() => {});
ok("ofrece «Enséñaselo a tu agente» bajo su respuesta", (await boton.count()) === 1);

console.log("\n== Lo guarda con un toque ==");
await boton.first().click();
const dialogo = page.getByRole("dialog", { name: "Enséñaselo a tu agente" });
await dialogo.waitFor({ timeout: 5000 });
ok("la pregunta viene puesta", (await dialogo.getByLabel("Cuando un cliente pregunte").inputValue()) === PREGUNTA);
ok("la respuesta viene puesta", (await dialogo.getByLabel("Tu agente responde").inputValue()) === RESPUESTA);
await dialogo.getByRole("button", { name: "Guardar" }).click();
await page.getByText("tu agente ya lo sabe").waitFor({ timeout: 10000 }).catch(() => {});

const kb = (await (await req.get(`${BASE}/api/kb`)).json()).entries ?? [];
const guardada = kb.find((e) => e.kind === "qa" && e.question === PREGUNTA);
ok("quedó en el conocimiento del agente", guardada?.answer === RESPUESTA, JSON.stringify(guardada));
ok("el botón ya no se ofrece", (await boton.count()) === 0);

await page.reload({ waitUntil: "load" });
await page.getByText(RESPUESTA).last().waitFor({ timeout: 20000 });
ok("ni al recargar", (await boton.count()) === 0);

await browser.close();
console.log(`\n${failures === 0 ? "TODO VERDE" : `${failures} FALLO(S)`}`);
process.exit(failures ? 1 : 0);
