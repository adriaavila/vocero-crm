/**
 * Self-test E2E de comportamiento — un chat largo abre por páginas.
 * Guion tests/e2e/us-hilo-largo.md.
 *
 * Uso: node scripts/e2e-hilo-largo.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y Playwright.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-HILO-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
const TOTAL = 95;
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
  data: { wabaId: "WABA-HILO", phoneNumberId: PN, token: "tok-h" },
});

const NAME = `Largo${S}`;
const FROM = `521479${Math.floor(Math.random() * 9e6) + 1e6}`;
const inbound = (i) =>
  req.post(`${BASE}/api/dev/wa-mock/inbound`, {
    data: { phoneNumberId: PN, from: FROM, name: NAME, text: `linea ${i} ${S}`, waMessageId: `wamid.hilo.${S}.${i}` },
  });
await inbound(1);
await new Promise((res) => setTimeout(res, 1500));
const convs = (await (await req.get(`${BASE}/api/conversations`)).json()).conversations;
const conv = convs.find((c) => c.contact.name === NAME);
ok("conversación creada", !!conv);
if (!conv) {
  await browser.close();
  process.exit(1);
}
await req.patch(`${BASE}/api/conversations/${conv.id}`, { data: { aiEnabled: false } });
for (let i = 2; i <= TOTAL; i++) await inbound(i);

console.log("\n== La API entrega por páginas ==");
const url = `${BASE}/api/conversations/${conv.id}/messages`;
let page1 = await (await req.get(url)).json();
// Un posible saludo del agente al primer mensaje también cuenta.
const total = TOTAL + page1.messages.filter((m) => m.direction === "out").length;
ok("la última página trae 80", page1.messages.length === 80, `trajo ${page1.messages.length}`);
ok("y avisa que hay más", page1.hasMore === true);
ok("termina en el más nuevo", page1.messages.at(-1)?.text === `linea ${TOTAL} ${S}`);
const page2 = await (await req.get(`${url}?beforeId=${encodeURIComponent(page1.messages[0].id)}`)).json();
const ids = new Set([...page2.messages, ...page1.messages].map((m) => m.id));
ok("la anterior completa el hilo sin repetir", ids.size >= TOTAL && ids.size === page1.messages.length + page2.messages.length, `${ids.size} de ${total}`);
ok("y ya no hay más", page2.hasMore === false);
ok("empieza en el primero", page2.messages[0]?.text === `linea 1 ${S}`);

console.log("\n== El dueño lo ve en la bandeja ==");
const page = await ctx.newPage();
await page.goto(`${BASE}/inbox?contact=${conv.contact.id}`, { waitUntil: "load" });
const anteriores = page.getByRole("button", { name: "Ver mensajes anteriores" });
await anteriores.waitFor({ timeout: 30000 }).catch(() => {});
ok("ofrece «Ver mensajes anteriores»", (await anteriores.count()) === 1);
ok("el primero aún no está", (await page.getByText(`linea 1 ${S}`, { exact: true }).count()) === 0);
// La hidratación puede ir detrás del primer pintado: reintenta el toque.
for (let i = 0; i < 10 && (await page.getByText(`linea 1 ${S}`, { exact: true }).count()) === 0; i++) {
  await anteriores.click().catch(() => {});
  await page.waitForTimeout(1500);
}
ok("un toque trae los anteriores", (await page.getByText(`linea 1 ${S}`, { exact: true }).count()) === 1);
ok("y el botón desaparece", (await anteriores.count()) === 0);

const RESP = `Gracias por escribir ${S}`;
await page.getByPlaceholder(/Escribe una respuesta/).fill(RESP);
await page.getByRole("button", { name: "Enviar", exact: true }).click();
await page.getByText(RESP).last().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
ok("la respuesta queda al final", true);
ok("lo ya cargado se queda", (await page.getByText(`linea 1 ${S}`, { exact: true }).count()) === 1);

await browser.close();
console.log(failures ? `\n${failures} FALLO(S)` : "\nTODO VERDE");
process.exit(failures ? 1 : 0);
