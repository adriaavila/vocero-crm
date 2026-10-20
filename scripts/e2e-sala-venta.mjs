/**
 * Self-test E2E — sala de venta personal (fork, vertical inmobiliario).
 *
 * Cubre: plan de pago aprobado (y el rechazo de uno con palabras prohibidas o
 * que no suma 100), sala armada sola con las casas del catálogo, página
 * pública por token con la calculadora, fotos servidas solo para las casas de
 * esa sala, señales del comprador (abrir, calculadora, pedir visita) y que
 * "llámalos hoy" lo pone primero con su motivo en palabras.
 *
 * Uso: node --env-file=.env scripts/e2e-sala-venta.mjs
 * Requiere: app corriendo con SALA_VENTA=on y BD migrada. Re-ejecutable: el
 * contacto lleva un sufijo aleatorio. Sin la bandera, comprueba el 404 y sale.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const S = Math.random().toString(36).slice(2, 8).toUpperCase();
const OPERATOR_EMAIL = "e2e@vocero.test";
const OPERATOR_PASSWORD = "password-e2e-123";

let cookie = "";
let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

async function api(path, opts = {}, { anonimo = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie && !anonimo ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length && !anonimo) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

function tinyJpegBase64(width, height) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]).toString("base64");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

console.log("== Setup: operador y vertical inmobiliario ==");
let su = await api("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD, name: "Operador E2E" }),
});
if (!su.res.ok) {
  su = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }),
  });
}
ok("registro o inicio de sesión del operador", su.res.ok, JSON.stringify(su.json));

if (!["on", "1", "true", "si", "sí", "yes"].includes((process.env.SALA_VENTA ?? "").toLowerCase())) {
  const apagada = await api("/api/salas");
  ok("sin SALA_VENTA la API de salas no existe (404)", apagada.res.status === 404);
  await sql.end();
  console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
  process.exit(failures === 0 ? 0 : 1);
}

const [org] = await sql`
  select o.id, o.metadata from organization o
  join member m on m.organization_id = o.id
  join "user" u on u.id = m.user_id
  where u.email = ${OPERATOR_EMAIL} limit 1`;
let metadata = {};
try {
  metadata = JSON.parse(org?.metadata ?? "{}");
} catch {}
if (metadata.vertical !== "inmobiliario") {
  await sql`update organization set metadata = ${JSON.stringify({ ...metadata, vertical: "inmobiliario" })} where id = ${org.id}`;
}

console.log("\n== Catálogo y contacto ==");
const casa = await api("/api/properties", {
  method: "POST",
  body: JSON.stringify({
    operation: "venta",
    kind: "casa",
    title: `Vivienda ${S}`,
    price: 120000,
    currency: "USD",
    city: "Tarija",
    bedrooms: 3,
    bathrooms: 2.5,
    builtArea: 148.1,
    description: "Dos plantas, patio propio y terreno individual.",
  }),
});
ok("alta de la casa → 201", casa.res.status === 201, JSON.stringify(casa.json));
const casaId = casa.json?.property?.id;
const foto = await api(`/api/properties/${casaId}/photos`, {
  method: "POST",
  body: JSON.stringify({ mimeType: "image/jpeg", data: tinyJpegBase64(64, 48) }),
});
ok("foto de la casa → 201", foto.res.status === 201);

const otra = await api("/api/properties", {
  method: "POST",
  body: JSON.stringify({ operation: "venta", kind: "casa", title: `Fuera ${S}`, price: 99000, currency: "USD" }),
});
const fotoOtra = await api(`/api/properties/${otra.json?.property?.id}/photos`, {
  method: "POST",
  body: JSON.stringify({ mimeType: "image/jpeg", data: tinyJpegBase64(64, 48) }),
});

const PN = "PN-E2E-1";
const conn = await api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
});
ok("WhatsApp conectado (wa-mock)", conn.res.ok, JSON.stringify(conn.json));

const telefono = `5917${Math.floor(1000000 + Math.random() * 8999999)}`;
const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
const alta = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Ana Comprador${S}`,
    phone: telefono,
    source: "otro",
    stageId: stages.find((s) => s.kind === "open")?.id,
  }),
});
ok("alta del contacto → 201", alta.res.status === 201, JSON.stringify(alta.json));
const contactId = alta.json?.lead?.contactId ?? alta.json?.contact?.id;
ok("el alta devuelve el id del contacto", Boolean(contactId), JSON.stringify(alta.json));

console.log("\n== Planes de pago: solo los que suman 100 y sin palabras prohibidas ==");
const prohibido = await api("/api/salas/planes", {
  method: "POST",
  body: JSON.stringify({
    nombre: "Plan inversión",
    reserva: 3000,
    mesEntrega: 2,
    aprobadoPor: "Sergio",
    pasos: [{ tipo: "unico", etiqueta: "Todo", porcentaje: 100, mes: 0 }],
  }),
});
ok("un plan que dice «inversión» se rechaza (422)", prohibido.res.status === 422, JSON.stringify(prohibido.json));
const noSuma = await api("/api/salas/planes", {
  method: "POST",
  body: JSON.stringify({
    nombre: "Incompleto",
    reserva: 3000,
    mesEntrega: 2,
    aprobadoPor: "Sergio",
    pasos: [{ tipo: "unico", etiqueta: "Cuota inicial", porcentaje: 30, mes: 0 }],
  }),
});
ok("un plan que no suma 100 se rechaza (422)", noSuma.res.status === 422);
const plan = await api("/api/salas/planes", {
  method: "POST",
  body: JSON.stringify({
    nombre: `Estándar ${S}`,
    reserva: 3000,
    mesEntrega: 2,
    aprobadoPor: "Sergio, SAMER",
    pasos: [
      { tipo: "unico", etiqueta: "Cuota inicial", porcentaje: 30, mes: 0 },
      { tipo: "unico", etiqueta: "Saldo contra entrega", porcentaje: 70, mes: 2 },
    ],
  }),
});
ok("plan aprobado → 201", plan.res.status === 201, JSON.stringify(plan.json));

console.log("\n== Sala: se arma con un clic y el link no cambia al editarla ==");
const sala = await api("/api/salas", {
  method: "POST",
  body: JSON.stringify({ contactId, propertyIds: [casaId], planPagoId: plan.json?.plan?.id }),
});
ok("POST /api/salas → 200", sala.res.ok, JSON.stringify(sala.json));
const url = sala.json?.sala?.url ?? "";
const token = url.split("/s/")[1];
ok("la sala tiene un link /s/<token> largo", typeof token === "string" && token.length >= 20, url);
const saludoMalo = await api("/api/salas", {
  method: "POST",
  body: JSON.stringify({ contactId, saludo: "Una gran inversión para ti" }),
});
ok("un saludo con palabra prohibida se rechaza (422)", saludoMalo.res.status === 422);
const editada = await api("/api/salas", {
  method: "POST",
  body: JSON.stringify({ contactId, alquilerActual: 500 }),
});
ok("editarla conserva el mismo link", editada.json?.sala?.url === url);

console.log("\n== Página pública ==");
const pagina = await fetch(`${BASE}/s/${token}`);
const html = await pagina.text();
ok("la sala abre sin sesión → 200", pagina.status === 200);
ok("saluda por el nombre", html.includes("Hola, Ana."));
ok("muestra la casa y su precio", html.includes(`Vivienda ${S}`) && html.includes("US$ 120.000"));
ok("muestra la frase del alquiler", html.includes("Hasta la entrega pagarías"));
ok("no se indexa", /noindex/.test(html));
ok("no muestra la casa que no está en la sala", !html.includes(`Fuera ${S}`));
const malo = await fetch(`${BASE}/s/no-existe-este-token-de-sala`);
ok("un token que no existe → 404", malo.status === 404);

const fotoSala = await fetch(`${BASE}/api/s/${token}/foto/${foto.json?.photo?.id}`);
ok("la foto de una casa de la sala se sirve sin sesión", fotoSala.status === 200 && fotoSala.headers.get("content-type") === "image/jpeg");
const fotoAjena = await fetch(`${BASE}/api/s/${token}/foto/${fotoOtra.json?.photo?.id}`);
ok("una foto de otra casa del catálogo → 404", fotoAjena.status === 404);

console.log("\n== Señales del comprador y «llámalos hoy» ==");
for (const tipo of ["apertura", "apertura", "calculadora", "visita"]) {
  const r = await api(`/api/s/${token}`, { method: "POST", body: JSON.stringify({ tipo }) }, { anonimo: true });
  ok(`señal «${tipo}» → 204`, r.res.status === 204);
}
const raro = await api(`/api/s/${token}`, { method: "POST", body: JSON.stringify({ tipo: "comprar" }) }, { anonimo: true });
ok("una señal desconocida se rechaza (422)", raro.res.status === 422);
const lista = await api("/api/salas");
const primero = lista.json?.llamarHoy?.find((s) => s.contactId === contactId);
ok("aparece en «llámalos hoy»", Boolean(primero), JSON.stringify(lista.json?.llamarHoy));
ok(
  "con el motivo en palabras",
  primero?.motivo === "Pidió visitar, usó la calculadora y abrió su sala 2 veces",
  primero?.motivo
);

console.log("\n== Dentro de WhatsApp: tarjetas, cálculo y visita con botones ==");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outbox = async () => (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
const nuevos = async (desde) => (await outbox()).filter((m) => m.n > desde && m.to.endsWith(telefono.slice(-7)));
const ultimoN = async () => Math.max(0, ...(await outbox()).map((m) => m.n));
const entra = async (body) => {
  const r = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from: telefono, name: `Ana Comprador${S}`, ...body }),
  });
  await sleep(1500);
  return r;
};
const ids = (m) => (m?.body?.interactive?.action?.buttons ?? []).map((b) => b.reply.id);
const cuerpo = (m) => m?.body?.interactive?.body?.text ?? m?.body?.text?.body ?? "";

// Que todavía no sepa su alquiler, para que la sala se lo pregunte.
await api("/api/salas", { method: "POST", body: JSON.stringify({ contactId, alquilerActual: null }) });
const hola = await entra({ text: "Hola, ¿siguen teniendo casas?" });
ok("el comprador escribe (abre la ventana de 24 h)", hola.res.ok, JSON.stringify(hola.json));

let marca = await ultimoN();
const envio = await api("/api/salas/whatsapp", { method: "POST", body: JSON.stringify({ contactId }) });
ok("mandar la sala por WhatsApp → 200", envio.res.ok, JSON.stringify(envio.json));
let salida = await nuevos(marca);
ok("salen saludo, una tarjeta por casa y el link (3 mensajes)", salida.length === 3, JSON.stringify(salida.map((m) => m.type)));
ok("el saludo lo llama por su nombre", cuerpo(salida[0]).startsWith("Hola, Ana."), cuerpo(salida[0]));
const tarjeta = salida.find((m) => m.type === "interactive" && m.body.interactive.type === "button");
ok("la tarjeta lleva la foto de la casa", String(tarjeta?.body?.interactive?.header?.image?.link ?? "").includes(`/api/s/${token}/foto/`));
ok("y el precio", cuerpo(tarjeta).includes("US$ 120.000"), cuerpo(tarjeta));
ok("con «Quiero visitar» y «Ver lo que pagaría»", JSON.stringify(ids(tarjeta)) === JSON.stringify([`sala:visita:${casaId}`, `sala:cuota:${casaId}`]), JSON.stringify(ids(tarjeta)));
const link = salida.find((m) => m.body?.interactive?.type === "cta_url");
ok("cierra con «Ver tu sala completa» y el link", link?.body?.interactive?.action?.parameters?.url === url, JSON.stringify(link?.body?.interactive));

marca = await ultimoN();
await entra({ type: "interactive", text: "Ver lo que pagaría", buttonId: `sala:cuota:${casaId}` });
salida = await nuevos(marca);
const cuota = salida[0];
ok("tocar «Ver lo que pagaría» contesta con su cálculo", salida.length === 1 && cuerpo(cuota).includes(`Vivienda ${S}`) && cuerpo(cuota).includes("Los montos se confirman"), JSON.stringify(salida.map(cuerpo)));
ok("y le pregunta cuánto paga de alquiler", cuerpo(cuota).includes("¿Cuánto pagas hoy de alquiler al mes, en dólares?"));
const imagen = cuota?.body?.interactive?.header?.image?.link ?? "";
ok("con la imagen del cálculo", imagen.includes(`/api/s/${token}/cuota/${casaId}`), imagen);
const png = await fetch(imagen.replace(/^https?:\/\/[^/]+/, BASE));
ok("la imagen del cálculo se sirve sin sesión (PNG)", png.status === 200 && png.headers.get("content-type") === "image/png", String(png.status));

marca = await ultimoN();
await entra({ text: "3.000 Bs" });
salida = await nuevos(marca);
ok("si lo dice en bolivianos, se lo pide en dólares", cuerpo(salida[0]).includes("en dólares"), JSON.stringify(salida.map(cuerpo)));

marca = await ultimoN();
await entra({ text: "pago 2.500" });
salida = await nuevos(marca);
ok("con su alquiler, el cálculo dice lo que pagaría de alquiler hasta la entrega", cuerpo(salida[0]).includes("Hasta la entrega pagarías US$ 5.000 de alquiler"), JSON.stringify(salida.map(cuerpo)));
const [filaSala] = await sql`select alquiler_actual, espera_alquiler_de, calculadora_at from sala_venta where contact_id = ${contactId}`;
ok("guarda su alquiler y deja de esperarlo", Number(filaSala?.alquiler_actual) === 2500 && filaSala?.espera_alquiler_de === null, JSON.stringify(filaSala));

marca = await ultimoN();
await entra({ type: "interactive", text: "Quiero visitar", buttonId: `sala:visita:${casaId}` });
salida = await nuevos(marca);
ok("«Quiero visitar» pregunta cuándo, con tres botones", ids(salida[0]).length === 3 && ids(salida[0]).every((id) => id.startsWith(`sala:cuando:${casaId}:`)), JSON.stringify(ids(salida[0])));

marca = await ultimoN();
await entra({ type: "interactive", text: "El fin de semana", buttonId: `sala:cuando:${casaId}:finde` });
salida = await nuevos(marca);
ok("elegir cuándo confirma que el equipo le escribe", cuerpo(salida[0]).startsWith("Listo."), JSON.stringify(salida.map(cuerpo)));
const [conv] = await sql`select c.id, c.handoff_at, c.handoff_reason from conversation c where c.contact_id = ${contactId} and c.channel = 'whatsapp'`;
ok("y pasa la conversación a una persona", conv?.handoff_at !== null && conv?.handoff_reason === "cliente", JSON.stringify(conv));
const llamar = (await api("/api/salas")).json?.llamarHoy?.find((s) => s.contactId === contactId);
ok("queda arriba en «llámalos hoy»", Boolean(llamar?.motivo?.startsWith("Pidió visitar")), llamar?.motivo);

marca = await ultimoN();
await entra({ type: "interactive", text: "Quiero visitar", buttonId: "sala:visita:prop_de_otra_sala" });
ok("un botón con una casa que no es de su sala no responde nada", (await nuevos(marca)).length === 0);

await sql`update conversation set last_inbound_at = now() - interval '2 days' where id = ${conv.id}`;
const fuera = await api("/api/salas/whatsapp", { method: "POST", body: JSON.stringify({ contactId }) });
ok("pasadas las 24 h no se manda (409, hace falta plantilla)", fuera.res.status === 409 && fuera.json?.error?.code === "window_closed", JSON.stringify(fuera.json));

await sql.end();
console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
process.exit(failures === 0 ? 0 : 1);
