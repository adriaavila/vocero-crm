/**
 * Self-test E2E de comportamiento — la bandeja muestra lo que el agente oyó y
 * vio en los adjuntos del cliente. Guion tests/e2e/us-oir-y-ver.md.
 *
 * El turno que transcribe (Rei) se prueba contra Postgres real en
 * tests/unit/oir-y-ver-realdb.test.ts; aquí la transcripción se escribe por
 * la misma ruta que usa Nea, y se mira lo que ve el dueño.
 *
 * Uso: node scripts/e2e-oir-y-ver.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true, BOT_API_KEY y Playwright.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;
const PN = "PN-OIR-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

if (!BOT_KEY || BOT_KEY.length < 16) {
  console.log("BOT_API_KEY ausente: este guion escribe la transcripción por /api/bot/*; se salta.");
  process.exit(0);
}

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
  data: { wabaId: "WABA-OIR", phoneNumberId: PN, token: "tok-oir" },
});

const NAME = `Oye${S}`;
const FROM = `521558${Math.floor(Math.random() * 9e6) + 1e6}`;
const inbound = (data) =>
  req.post(`${BASE}/api/dev/wa-mock/inbound`, { data: { phoneNumberId: PN, from: FROM, name: NAME, ...data } });

await inbound({ text: `hola ${S}`, waMessageId: `wamid.oir.${S}.1` });
await new Promise((res) => setTimeout(res, 1500));
const convs = (await (await req.get(`${BASE}/api/conversations`)).json()).conversations;
const conv = convs.find((c) => c.contact.name === NAME);
ok("conversación creada", !!conv);
if (!conv) {
  await browser.close();
  process.exit(1);
}
await req.patch(`${BASE}/api/conversations/${conv.id}`, { data: { aiEnabled: false } });
await inbound({ type: "image", mediaId: `media-oir-img-${S}`, mimeType: "image/jpeg", caption: `ya pagué ${S}`, waMessageId: `wamid.oir.${S}.2` });
await inbound({ type: "audio", mediaId: `media-oir-aud-${S}`, mimeType: "audio/ogg", waMessageId: `wamid.oir.${S}.3` });

const msgs = (await (await req.get(`${BASE}/api/conversations/${conv.id}/messages`)).json()).messages;
const foto = msgs.find((m) => m.type === "image");
const nota = msgs.find((m) => m.type === "audio");
ok("llegan la foto y la nota de voz", !!foto && !!nota, JSON.stringify(msgs.map((m) => m.type)));

console.log("\n== Lo que oyó y vio queda guardado una vez ==");
const transcribe = (id, text) =>
  req.post(`${BASE}/api/bot/messages/${id}/transcript`, { headers: { "x-api-key": BOT_KEY }, data: { text } });
const VISTA = `Comprobante de transferencia por $450 ${S}`;
const OIDO = `quería saber si atienden el sábado ${S}`;
r = await transcribe(foto.id, VISTA);
ok("se guarda lo que se vio en la foto", r.ok() && (await r.json()).transcript === VISTA);
r = await transcribe(nota.id, OIDO);
ok("se guarda lo que dijo la nota", r.ok() && (await r.json()).transcript === OIDO);
r = await transcribe(foto.id, "otra cosa");
ok("la primera escritura gana", r.ok() && (await r.json()).transcript === VISTA);

console.log("\n== El dueño lo ve en la bandeja ==");
const page = await ctx.newPage();
await page.goto(`${BASE}/inbox?contact=${conv.contact.id}`, { waitUntil: "load" });
const vio = page.getByText(`El agente vio: ${VISTA}`);
await vio.waitFor({ timeout: 30000 }).catch(() => {});
ok("bajo la foto: «El agente vio: …»", (await vio.count()) === 1);
ok("el pie de foto sigue a la vista", (await page.getByText(`ya pagué ${S}`).count()) >= 1);
ok("bajo la nota: «Transcripción: …»", (await page.getByText(`Transcripción: ${OIDO}`).count()) === 1);
await page.screenshot({ path: ".tmp/e2e-oir-y-ver.png" }).catch(() => {});

await browser.close();
console.log(`\n${failures === 0 ? "TODO VERDE" : `${failures} FALLO(S)`}`);
process.exit(failures ? 1 : 0);
