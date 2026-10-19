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

const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
const alta = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Ana Comprador${S}`,
    phone: `5917${Math.floor(1000000 + Math.random() * 8999999)}`,
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

await sql.end();
console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
process.exit(failures === 0 ? 0 : 1);
