/**
 * Self-test E2E de comportamiento — reporte de ventas para Hermes.
 * Guion tests/e2e/us-hermes-ventas.md.
 *
 * Hermes (el agente personal del operador) no tiene sesión: entra con
 * `HERMES_API_KEY`. Este guion hace que un cliente escriba y comprueba que el
 * reporte lo cuenta, en los dos formatos, y que sin llave no se ve nada.
 *
 * Uso: node --env-file=.env scripts/e2e-hermes-ventas.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y HERMES_API_KEY.
 */
import { request } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const KEY = process.env.HERMES_API_KEY ?? "";
const PN = "PN-HERMES-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

if (KEY.length < 16) {
  console.log("✗ Falta HERMES_API_KEY (16+ caracteres) en el entorno del guion y del servidor.");
  process.exit(1);
}

// Solo HTTP: el reporte no tiene pantalla, así que no hace falta navegador.
const req = await request.newContext();

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
await req.put(`${BASE}/api/settings/whatsapp`, { data: { wabaId: "WABA-HERMES", phoneNumberId: PN, token: "tok-h" } });

const hermes = (qs, key = KEY) => fetch(`${BASE}/api/hermes/ventas${qs}`, { headers: key ? { "x-api-key": key } : {} });
const antes = (await (await hermes("")).json())?.datos?.periodo?.conversaciones ?? 0;

const NAME = `Comprador${S}`;
r = await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  data: {
    phoneNumberId: PN,
    from: `5917${Date.now().toString().slice(-7)}`,
    name: NAME,
    text: `Quiero hablar con una persona sobre la casa ${S}`,
  },
});
ok("llega el mensaje del cliente", r.ok(), String(r.status()));

console.log("== Camino infeliz ==");
ok("sin llave: 401", (await hermes("", "")).status === 401);
ok("otra llave: 401", (await hermes("", `${KEY}x`)).status === 401);
ok("periodo que no existe: 400", (await hermes("?periodo=1y")).status === 400);
ok("negocio que no existe: 404", (await hermes(`?negocio=no-existe-${S}`)).status === 404);

console.log("== El reporte ==");
// El ingest es asíncrono: unos segundos para que el mensaje cuente.
let body = null;
for (let i = 0; i < 20; i++) {
  const res = await hermes("");
  body = res.ok ? await res.json() : null;
  if ((body?.datos?.periodo?.conversaciones ?? 0) > antes) break;
  await new Promise((s) => setTimeout(s, 500));
}
ok("200 con texto, sugerencias y datos", Boolean(body?.texto && Array.isArray(body?.sugerencias) && body?.datos), JSON.stringify(body)?.slice(0, 200));
ok("WhatsApp: negrita con asteriscos", body?.texto?.startsWith("*"));
const n = body?.datos?.periodo?.conversaciones ?? 0;
ok("cuenta al cliente que escribió", n === antes + 1, `${antes} → ${n}`);
ok("el texto dice esa cifra", body?.texto?.includes(`${n} clientes escribieron`) || (n === 1 && body?.texto?.includes("1 cliente escribió")), body?.texto);
ok("no trae teléfonos", !/5917\d{7}/.test(JSON.stringify(body)));

const tg = await (await hermes("?formato=telegram")).json();
ok("Telegram: HTML", tg.texto?.startsWith("<b>"));

await req.dispose();
console.log(failures === 0 ? "\n✓ Hermes · ventas: todo verde" : `\n✗ ${failures} fallos`);
process.exit(failures === 0 ? 0 : 1);
