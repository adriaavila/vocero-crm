/**
 * Self-test E2E — Laboratorio de una inmobiliaria.
 *
 * Cubre: sin propiedades disponibles el Laboratorio AVISA (409 lab_not_ready)
 * en vez de correr y dar rojo; con una propiedad cargada corre 7 personas
 * armadas con ESE catálogo (zona, precio y título reales, nada de la tienda
 * genérica); el cliente simulado contesta lo que el agente pregunta; y la
 * corrida termina con puntaje.
 *
 * Uso: node --env-file=.env scripts/e2e-laboratorio-inmobiliario.mjs
 * Requiere: app corriendo con los mocks (OPENAI_BASE_URL → ai-mock) y BD
 * migrada. Re-ejecutable: deja el catálogo como lo encontró, más la
 * propiedad de prueba archivada.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const OPERATOR_EMAIL = "e2e@vocero.test";
const OPERATOR_PASSWORD = "password-e2e-123";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

let cookie = "";
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

console.log("== Setup: el operador compartido del arnés E2E, con el vertical activo ==");
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
const [org] = await sql`
  select o.id, o.metadata from organization o
  join member m on m.organization_id = o.id
  join "user" u on u.id = m.user_id
  where u.email = ${OPERATOR_EMAIL}
  limit 1`;
const orgId = org?.id;
let metadata = {};
try {
  metadata = JSON.parse(org?.metadata ?? "{}");
} catch {}
if (metadata.vertical !== "inmobiliario") {
  await sql`update organization set metadata = ${JSON.stringify({ ...metadata, vertical: "inmobiliario" })} where id = ${orgId}`;
}
// Una corrida de otro guion que quedó colgada bloquearía esta (máx. 1 por org).
await sql`update agent_test_run set status = 'failed', error = 'e2e: limpieza' where organization_id = ${orgId} and status = 'running'`;

console.log("\n== Sin propiedades disponibles: avisa antes de correr ==");
// El resto del arnés deja propiedades en esta org: se ocultan un momento y se
// devuelven tal cual (archivar no toca el estatus).
const hidden = await sql`
  update property set archived_at = now()
  where organization_id = ${orgId} and archived_at is null
  returning id`;
const empty = await api("/api/lab/runs", { method: "POST" });
await sql`update property set archived_at = null where id in ${sql(hidden.map((r) => r.id).concat("__ninguna__"))}`;
ok("POST /api/lab/runs → 409 lab_not_ready", empty.res.status === 409 && empty.json?.error?.code === "lab_not_ready", JSON.stringify(empty.json));
ok("el aviso dice qué hacer (cargar una propiedad)", /propiedad/i.test(empty.json?.error?.message ?? ""));

console.log("\n== Con una casa cargada: 7 personas armadas con ESA casa ==");
const title = `Santorini · Vivienda ${S}`;
const created = await api("/api/properties", {
  method: "POST",
  body: JSON.stringify({
    title,
    operation: "venta",
    kind: "casa",
    price: 132000,
    currency: "USD",
    neighborhood: "Santorini",
    city: "Tarija",
    bedrooms: 3,
    acceptedPayments: ["contado", "credito_bancario"],
  }),
});
ok("POST /api/properties → 201", created.res.status === 201, JSON.stringify(created.json));
const propertyId = created.json?.property?.id;

const launched = await api("/api/lab/runs", { method: "POST" });
ok("POST /api/lab/runs → 202", launched.res.status === 202, JSON.stringify(launched.json));
ok("la corrida trae 7 personas", launched.json?.total === 7, String(launched.json?.total));
const runId = launched.json?.runId;

let detail = null;
for (let i = 0; i < 180; i++) {
  detail = (await api(`/api/lab/runs/${runId}`)).json;
  if (detail?.run?.status && detail.run.status !== "running") break;
  await new Promise((r) => setTimeout(r, 1000));
}
ok("la corrida termina 'done' con puntaje", detail?.run?.status === "done" && typeof detail?.run?.score === "number", JSON.stringify(detail?.run));

const cases = detail?.cases ?? [];
const byKey = Object.fromEntries(cases.map((c) => [c.persona, c]));
ok("7 casos, todos con veredicto", cases.length === 7 && cases.every((c) => c.status === "done"), JSON.stringify(cases.map((c) => [c.persona, c.status])));
ok("con nombre visible de inmobiliaria", byKey.busca_lo_que_tienes?.personaLabel === "Busca justo lo que tienes");

const clientLines = cases.flatMap((c) => c.transcript.filter((t) => t.role === "cliente").map((t) => t.text));
ok("nada de la tienda genérica (taladros, garantías, «¿qué venden?»)", !clientLines.some((t) => /taladro|garant[ií]a|qu[eé] venden|devoluci/i.test(t)));
ok(
  "el cliente busca en la zona real de la casa",
  byKey.busca_lo_que_tienes?.transcript[0]?.text === "Hola, buenas. Busco casa en venta por Santorini",
  byKey.busca_lo_que_tienes?.transcript[0]?.text
);
ok("pregunta por la casa por su nombre", clientLines.some((t) => t.includes(title)));
ok(
  "el cliente simulado CONTESTA al agente (no recita el guion)",
  clientLines.some((t) => t.startsWith("(cliente simulado)")),
  JSON.stringify(byKey.busca_lo_que_tienes?.transcript)
);
ok(
  "pero nunca pasa del guion más un turno",
  cases.every((c) => c.transcript.filter((t) => t.role === "cliente").length <= 5)
);

if (propertyId) {
  await api(`/api/properties/${propertyId}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
  await sql`update property set archived_at = now() where id = ${propertyId}`;
}
await sql.end();

console.log(failures ? `\n✗ ${failures} comprobación(es) fallaron` : "\n✓ Laboratorio inmobiliario OK");
process.exit(failures ? 1 : 0);
