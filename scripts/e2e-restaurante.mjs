/**
 * Self-test E2E — vertical restaurante: de la conversación al pedido.
 * Guion: tests/e2e/us-restaurante.md.
 *
 * El agente (Rei, por «Escríbele como cliente») arma el pedido con los precios
 * del menú y lo deja por confirmar; una persona lo confirma y cada paso le
 * avisa al cliente. Lo que no está en el menú o está agotado no entra.
 *
 * Uso: node --env-file=.env scripts/e2e-restaurante.mjs
 * Requiere: app corriendo (pnpm dev) con los mocks y Playwright.
 * Re-ejecutable: enciende el vertical del negocio y lo deja como estaba.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
const PN = "PN-REST-1";
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
const post = (path, data) => req.post(`${BASE}${path}`, { headers: { origin: BASE }, data });
const patch = (path, data) => req.patch(`${BASE}${path}`, { headers: { origin: BASE }, data });
const get = (path) => req.get(`${BASE}${path}`);

console.log("== Setup ==");
let r = await post("/api/auth/sign-up/email", {
  email: "e2e@vocero.test",
  password: "password-e2e-123",
  name: "Operador E2E",
});
if (!r.ok()) r = await post("/api/auth/sign-in/email", { email: "e2e@vocero.test", password: "password-e2e-123" });
ok("login", r.ok());
const [org] = await sql`
  select o.id, o.metadata from organization o
  join member m on m.organization_id = o.id
  join "user" u on u.id = m.user_id
  where u.email = 'e2e@vocero.test' limit 1`;
ok("el operador tiene una organización", Boolean(org?.id));
const metadataOriginal = org?.metadata ?? null;
let meta = {};
try {
  meta = JSON.parse(metadataOriginal ?? "{}") ?? {};
} catch {}
const ponerVertical = (vertical) =>
  sql`update organization set metadata = ${JSON.stringify({ ...meta, vertical })} where id = ${org.id}`;

try {
  console.log("\n== Sin el vertical, la superficie no existe ==");
  await ponerVertical(null);
  r = await get("/api/restaurante/menu");
  ok("GET /api/restaurante/menu → 404 vertical_disabled", r.status() === 404 && (await json(r))?.error?.code === "vertical_disabled");
  r = await get("/api/restaurante/pedidos");
  ok("GET /api/restaurante/pedidos → 404", r.status() === 404);
  r = await ctx.request.get(`${BASE}/pedidos`);
  ok("la pantalla /pedidos → 404", r.status() === 404);

  console.log("\n== Menú ==");
  await ponerVertical("restaurante");
  r = await post("/api/restaurante/menu/demo", {});
  ok("menú de ejemplo cargado (o ya había menú)", r.status() === 201 || r.status() === 409, String(r.status()));
  let menu = (await json(await get("/api/restaurante/menu")))?.menu;
  const doble = menu?.items.find((i) => i.name === "Doble queso");
  const flan = menu?.items.find((i) => i.name === "Flan casero");
  ok("el menú trae Doble queso con sus extras", doble?.priceCents === 4200 && doble.extras.some((e) => e.name === "Sin cebolla"));
  ok("el menú trae el flan", Boolean(flan));
  await patch(`/api/restaurante/menu/${flan.id}`, { agotadoHoy: false, available: true });

  const NUEVO = `Empanada ${S}`;
  r = await post("/api/restaurante/menu", {
    name: NUEVO,
    priceCents: 900,
    category: "Entradas",
    extras: [{ name: "Llajua", priceCents: 0 }],
  });
  const nuevoId = (await json(r))?.id;
  ok("alta de un producto con extra → 201", r.status() === 201 && Boolean(nuevoId));
  r = await post("/api/restaurante/menu", { name: "Mal", priceCents: -5 });
  ok("precio negativo → 422", r.status() === 422);
  r = await patch("/api/restaurante/menu/mit_noexiste", { available: false });
  ok("producto que no es del negocio → 404", r.status() === 404);

  console.log("\n== El agente arma el pedido (conversación de prueba) ==");
  await post("/api/lab/chat/reset", {});
  r = await post("/api/lab/chat", {
    text: "Hola, quiero 2 doble queso sin cebolla, unas papas fritas y 2 coca-cola. Es para envío a la calle Sucre 450",
  });
  let chat = await json(r);
  const respuesta = chat?.lines?.at(-1);
  ok("el agente contesta", r.ok() && respuesta?.from === "agente", JSON.stringify(chat));
  ok("la respuesta lleva los precios del menú", /2 Doble queso \(sin cebolla\) · \S+ 84/.test(respuesta?.text ?? ""), respuesta?.text);
  ok("y el subtotal exacto (84 + 15 + 16)", /Subtotal \S+ 115\./.test(respuesta?.text ?? ""), respuesta?.text);
  ok("no dice «confirmado»: lo confirma una persona", !/confirmado/i.test(respuesta?.text ?? "") && /persona del local/.test(respuesta?.text ?? ""));

  let pedidos = (await json(await get("/api/restaurante/pedidos")))?.pedidos ?? [];
  let pedido = pedidos.find((p) => p.isTest && p.status === "por_confirmar");
  ok("queda un pedido por confirmar, de prueba, armado por el agente", pedido?.createdBy === "agente", JSON.stringify(pedidos.map((p) => [p.number, p.status, p.isTest])));
  ok("subtotal 115 y total sin envío todavía", pedido?.subtotalCents === 11500 && pedido?.totalCents === 11500);
  ok("modalidad envío con su dirección", pedido?.mode === "envio" && /Sucre 450/.test(pedido?.address ?? ""), pedido?.address);
  ok("3 líneas con el precio unitario del menú", pedido?.items.length === 3 && pedido.items[0].unitPriceCents === 4200);

  console.log("\n== Lo que no está en el menú no entra ==");
  r = await post("/api/lab/chat", { text: "mejor quiero una pizza hawaiana" });
  chat = await json(r);
  ok("el cliente lee que no está en el menú", /«Pizza hawaiana» no está en nuestro menú/.test(chat?.lines?.at(-1)?.text ?? ""), chat?.lines?.at(-1)?.text);
  let otra = (await json(await get(`/api/restaurante/pedidos/${pedido.id}`)))?.pedido;
  ok("el pedido no cambió", otra?.subtotalCents === 11500 && otra.items.length === 3);

  console.log("\n== Agotado por hoy ==");
  r = await patch(`/api/restaurante/menu/${flan.id}`, { agotadoHoy: true });
  menu = (await json(r))?.menu;
  ok("el flan queda fuera de venta hasta mañana", menu?.items.find((i) => i.id === flan.id)?.enVenta === false);
  r = await post("/api/lab/chat", { text: "quiero un flan casero" });
  chat = await json(r);
  ok("el agente dice que hoy no queda", /hoy no nos queda Flan casero/.test(chat?.lines?.at(-1)?.text ?? ""), chat?.lines?.at(-1)?.text);
  otra = (await json(await get(`/api/restaurante/pedidos/${pedido.id}`)))?.pedido;
  ok("y no lo agrega al pedido", otra?.items.length === 3);

  console.log("\n== Solo una persona confirma ==");
  r = await patch(`/api/restaurante/pedidos/${pedido.id}`, { mode: null });
  r = await post(`/api/restaurante/pedidos/${pedido.id}/estado`, { hacia: "en_cocina" });
  ok("sin envío o retiro no se confirma → 409", r.status() === 409 && (await json(r))?.error?.code === "falta_modalidad");
  r = await patch(`/api/restaurante/pedidos/${pedido.id}`, { mode: "envio", deliveryFeeCents: 800 });
  ok("con el envío, total = subtotal + envío", (await json(r))?.pedido?.totalCents === 12300);
  r = await post(`/api/restaurante/pedidos/${pedido.id}/estado`, { hacia: "en_cocina" });
  const confirmado = await json(r);
  ok("confirmar → en cocina", confirmado?.pedido?.status === "en_cocina" && confirmado.avisado === true, JSON.stringify(confirmado));
  chat = await json(await get("/api/lab/chat"));
  ok(
    "el cliente de prueba lee «Confirmado … Total 123»",
    new RegExp(`Confirmado tu pedido #${pedido.number}\\. Total \\S+ 123, con el envío`).test(chat?.lines?.at(-1)?.text ?? ""),
    chat?.lines?.at(-1)?.text
  );

  console.log("\n== Estados que solo avanzan ==");
  r = await post(`/api/restaurante/pedidos/${pedido.id}/estado`, { hacia: "entregado" });
  ok("de cocina no se salta a entregado → 409", r.status() === 409);
  r = await patch(`/api/restaurante/pedidos/${pedido.id}`, { deliveryFeeCents: 0 });
  ok("en cocina ya no se edita → 409", r.status() === 409);
  r = await post(`/api/restaurante/pedidos/${pedido.id}/estado`, { hacia: "volando" });
  ok("un estado que no existe → 422", r.status() === 422);

  console.log("\n== Conversación real: una persona arma el pedido y el cliente recibe los avisos ==");
  await req.put(`${BASE}/api/settings/whatsapp`, {
    headers: { origin: BASE },
    data: { wabaId: "WABA-REST", phoneNumberId: PN, token: "tok-rest" },
  });
  const NAME = `Carla ${S}`;
  const FROM = `591700${Math.floor(Math.random() * 9e4) + 1e4}`;
  await post("/api/dev/wa-mock/inbound", {
    phoneNumberId: PN,
    from: FROM,
    name: NAME,
    text: `hola, un medio pollo para retirar ${S}`,
    waMessageId: `wamid.rest.${S}.1`,
  });
  let conv;
  for (let i = 0; i < 10 && !conv; i++) {
    await new Promise((res) => setTimeout(res, 500));
    conv = ((await json(await get("/api/conversations")))?.conversations ?? []).find((c) => c.contact.name === NAME);
  }
  ok("conversación creada", Boolean(conv));
  r = await post("/api/restaurante/pedidos", {
    conversationId: conv.id,
    lineas: [{ name: "Medio pollo", quantity: 1 }, { name: NUEVO, quantity: 2, extras: ["Llajua"] }],
    mode: "retiro",
  });
  const real = (await json(r))?.pedido;
  ok("pedido a mano → 201, por confirmar, con precios del menú", r.status() === 201 && real?.status === "por_confirmar" && real.totalCents === 5200 + 1800, JSON.stringify(real));
  ok("no es de prueba y lo armó una persona", real?.isTest === false && real.createdBy === "persona");
  r = await post("/api/restaurante/pedidos", { conversationId: conv.id, lineas: [{ name: "Sushi", quantity: 1 }] });
  ok("a mano tampoco entra lo que no está en el menú → 422", r.status() === 422);
  r = await post("/api/restaurante/pedidos", { conversationId: "cv_deotro", lineas: [{ name: "Medio pollo", quantity: 1 }] });
  ok("conversación que no es del negocio → 404", r.status() === 404);

  r = await post(`/api/restaurante/pedidos/${real.id}/estado`, { hacia: "en_cocina" });
  ok("confirmar avisa al cliente", (await json(r))?.avisado === true);
  r = await post(`/api/restaurante/pedidos/${real.id}/estado`, { hacia: "listo" });
  ok("marcar listo avisa (es retiro)", (await json(r))?.avisado === true);
  const msgs = (await json(await get(`/api/conversations/${conv.id}/messages`)))?.messages ?? [];
  const salientes = msgs.filter((m) => m.direction === "out").map((m) => m.text);
  ok("el cliente recibió «Confirmado tu pedido»", salientes.some((t) => t?.startsWith(`Confirmado tu pedido #${real.number}. Total`)), JSON.stringify(salientes));
  ok("y «está listo para retirar»", salientes.some((t) => t === `Tu pedido #${real.number} está listo para retirar.`), JSON.stringify(salientes));
  r = await post(`/api/restaurante/pedidos/${real.id}/pago`, { status: "cobrado", method: "efectivo" });
  ok("se registra el cobro en efectivo", (await json(r))?.pedido?.paymentStatus === "cobrado");

  console.log("\n== Pantallas ==");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/inbox?contact=${conv.contact.id}`, { waitUntil: "load" });
  const panel = page.locator(`[data-pedido="listo"]`);
  await panel.waitFor({ timeout: 45000 }).catch(() => {});
  ok("el pedido aparece en la conversación", (await panel.getByText(`Pedido #${real.number}`).count()) === 1);
  ok("con sus líneas y el siguiente paso", (await panel.getByText("Medio pollo").count()) === 1 && (await panel.getByRole("button", { name: "Entregado y cobrado" }).count()) === 1);
  await panel.getByRole("button", { name: "Entregado y cobrado" }).click();
  await page.getByRole("button", { name: "Armar otro pedido" }).waitFor({ timeout: 15000 }).catch(() => {});
  ok("un toque lo cierra como entregado", (await json(await get(`/api/restaurante/pedidos/${real.id}`)))?.pedido?.status === "entregado");
  await page.screenshot({ path: ".tmp/e2e-restaurante-conversacion.png" }).catch(() => {});

  await page.goto(`${BASE}/pedidos`, { waitUntil: "load" });
  const tarjeta = page.locator(`[data-pedido-numero="${pedido.number}"]`);
  await tarjeta.waitFor({ timeout: 45000 }).catch(() => {});
  ok("el tablero muestra el pedido de prueba, marcado «Prueba»", (await tarjeta.getByText("Prueba", { exact: true }).count()) === 1);
  await tarjeta.getByRole("button", { name: "Marcar listo" }).click();
  await page.locator(`section[aria-label="Listo"] [data-pedido-numero="${pedido.number}"]`).waitFor({ timeout: 15000 }).catch(() => {});
  ok("«Marcar listo» lo mueve de columna", (await json(await get(`/api/restaurante/pedidos/${pedido.id}`)))?.pedido?.status === "listo");
  await page.screenshot({ path: ".tmp/e2e-restaurante-pedidos.png" }).catch(() => {});

  await page.goto(`${BASE}/menu`, { waitUntil: "load" });
  const fila = page.locator(`[data-producto="Flan casero"]`);
  await fila.waitFor({ timeout: 45000 }).catch(() => {});
  ok("el menú muestra el flan agotado por hoy", (await fila.getByRole("button", { name: "Agotado hoy · ya hay" }).count()) === 1);
  await fila.getByRole("button", { name: "Agotado hoy · ya hay" }).click();
  await fila.getByRole("button", { name: "Se agotó por hoy" }).waitFor({ timeout: 15000 }).catch(() => {});
  ok("un toque lo vuelve a ofrecer", (await json(await get("/api/restaurante/menu")))?.menu?.items.find((i) => i.id === flan.id)?.enVenta === true);
  ok("Pedidos y Menú están en el menú lateral", (await page.getByRole("link", { name: "Pedidos" }).count()) >= 1 && (await page.getByRole("link", { name: "Menú" }).count()) >= 1);

  // Limpieza: el pedido de prueba se cierra y el producto del guion se quita.
  await post(`/api/restaurante/pedidos/${pedido.id}/estado`, { hacia: "cancelado" });
  await patch(`/api/restaurante/menu/${nuevoId}`, { archived: true });

  console.log("\n== Apagado, vuelve a no existir ==");
  await ponerVertical(null);
  r = await get(`/api/restaurante/pedidos/${pedido.id}`);
  ok("GET de un pedido → 404", r.status() === 404);
  r = await post("/api/lab/chat", { text: "quiero 2 doble queso" });
  ok("sin el vertical el agente contesta sin armar pedidos", r.ok() && !/Subtotal/.test((await json(r))?.lines?.at(-1)?.text ?? ""));
} finally {
  // El negocio queda como estaba: los demás guiones no ven un restaurante.
  await sql`update organization set metadata = ${metadataOriginal} where id = ${org.id}`;
  await sql.end();
  await browser.close();
}

console.log(`\n${failures === 0 ? "TODO VERDE" : `${failures} FALLO(S)`}`);
process.exit(failures ? 1 : 0);
