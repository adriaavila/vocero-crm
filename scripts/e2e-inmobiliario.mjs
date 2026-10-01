/**
 * Self-test E2E — vertical inmobiliario (parte 1): catálogo de propiedades.
 *
 * Cubre: una agencia nueva nace con el vertical activo (DEFAULT_VERTICAL),
 * alta/edición/archivado de una propiedad, fotos por el camino sin
 * dependencia externa (disco local — sin R2 configurado), portada, reorden,
 * borrado, y que una organización SIN el vertical recibe 404
 * `vertical_disabled` en vez de ver el catálogo de otra agencia.
 *
 * Uso: node --env-file=.env scripts/e2e-inmobiliario.mjs
 * Requiere: app corriendo (pnpm dev) con DEFAULT_VERTICAL=inmobiliario y BD
 * migrada. Re-ejecutable: el correo del negocio lleva un sufijo aleatorio.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const S = Math.random().toString(36).slice(2, 8).toUpperCase();

/**
 * Mismo operador que `e2e-selftest.mjs` (que corre primero y registra la
 * ÚNICA organización de una instancia legacy) y `e2e-alta-manual.mjs`:
 * sign-up-o-sign-in con las MISMAS credenciales, para operar dentro de esa
 * misma organización en vez de intentar crear una segunda (una instancia sin
 * ALLOK_SAAS_MODE solo tiene una organización — la primera — y un registro
 * posterior con otro correo se queda sin membresía).
 */
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

/**
 * Un JPEG mínimo pero válido para quien solo lee el encabezado (SOF0): SOI +
 * SOF0 (declara 64×32) + EOI. No hace falta un archivo de verdad — ni la API
 * ni `getImageDimensions` decodifican píxeles — y mantiene el guion
 * autocontenido, sin depender de un archivo externo al repo.
 */
function tinyJpegBase64(width, height) {
  const bytes = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // longitud = 11
    0x08, // precisión
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9, // EOI
  ]);
  return bytes.toString("base64");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

console.log("== Setup: el operador compartido del arnés E2E ==");
let su = await api("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD, name: "Operador E2E" }),
});
const signedUp = su.res.ok;
if (!su.res.ok) {
  su = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }),
  });
}
ok("registro o inicio de sesión del operador", su.res.ok, JSON.stringify(su.json));

const orgRows = await sql`
  select o.id, o.metadata from organization o
  join member m on m.organization_id = o.id
  join "user" u on u.id = m.user_id
  where u.email = ${OPERATOR_EMAIL}
  limit 1`;
const orgId = orgRows[0]?.id;
ok("el operador tiene una organización", Boolean(orgId));

console.log("\n== El vertical se activó solo, por DEFAULT_VERTICAL (sin tocarlo a mano) ==");
let metadata = {};
try {
  metadata = JSON.parse(orgRows[0]?.metadata ?? "{}");
} catch {}
// Solo se puede exigir si este guion creó la organización con la variable
// puesta. En CI el servidor corre sin DEFAULT_VERTICAL y otro guion ya
// registró al operador.
if (signedUp && process.env.DEFAULT_VERTICAL?.trim() === "inmobiliario") {
  ok(
    "organization.metadata.vertical = inmobiliario",
    metadata.vertical === "inmobiliario",
    orgRows[0]?.metadata
  );
} else {
  console.log("  --  sin DEFAULT_VERTICAL o con organización previa: se omite esta comprobación");
}
// Red de seguridad: si esta base ya traía una organización SIN el vertical
// (de una corrida anterior sin DEFAULT_VERTICAL, o de otro guion E2E que
// registra su propio operador), se fija aquí para que el resto del guion
// tenga algo que probar — igual que hace el seed demo.
if (metadata.vertical !== "inmobiliario") {
  await sql`update organization set metadata = ${JSON.stringify({ ...metadata, vertical: "inmobiliario" })} where id = ${orgId}`;
  console.log("  (nota: esta base no tenía el vertical activo; se fijó a mano para poder seguir)");
}

console.log("\n== Alta, listado con filtros, edición ==");
const created = await api("/api/properties", {
  method: "POST",
  body: JSON.stringify({
    operation: "venta",
    kind: "departamento",
    price: 135000,
    currency: "USD",
    neighborhood: "Equipetrol",
    city: "Santa Cruz",
    bedrooms: 2,
    bathrooms: 2,
    amenities: ["seguridad", "elevador"],
  }),
});
ok("POST /api/properties → 201", created.res.status === 201, JSON.stringify(created.json));
const propertyId = created.json?.property?.id;
ok("el precio viaja formateable ($135.000 USD)", created.json?.property?.price === "135000.00", created.json?.property?.price);
ok("nace sin fotos", created.json?.property?.photoCount === 0);

const filtered = await api("/api/properties?operation=venta&q=Equipetrol");
ok(
  "aparece en el listado filtrado por operación y búsqueda",
  (filtered.json?.properties ?? []).some((p) => p.id === propertyId),
  JSON.stringify(filtered.json?.properties?.map((p) => p.id))
);
const filteredOut = await api("/api/properties?operation=renta");
ok(
  "no aparece en un filtro que no aplica (es venta, no alquiler)",
  !(filteredOut.json?.properties ?? []).some((p) => p.id === propertyId)
);

const patched = await api(`/api/properties/${propertyId}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "apartada" }),
});
ok("PATCH cambia el estatus comercial", patched.json?.property?.status === "apartada");

console.log("\n== Fotos: alta, portada, reorden y borrado — sin R2, cae a disco local ==");
const photo1 = await api(`/api/properties/${propertyId}/photos`, {
  method: "POST",
  body: JSON.stringify({ mimeType: "image/jpeg", data: tinyJpegBase64(32, 64) }),
});
ok("sube la primera foto → 201", photo1.res.status === 201, JSON.stringify(photo1.json));
ok("la primera foto nace de portada (posición 0)", photo1.json?.photo?.isCover === true);
ok(
  "la URL de la foto es la ruta autenticada local (sin R2 configurado)",
  typeof photo1.json?.photo?.url === "string" && photo1.json.photo.url.startsWith("/api/storage/org/"),
  photo1.json?.photo?.url
);

const fileRes = await api(photo1.json.photo.url);
ok("el archivo servido por la ruta local responde 200", fileRes.res.status === 200);
ok(
  "con el content-type de una imagen JPEG",
  fileRes.res.headers.get("content-type") === "image/jpeg",
  fileRes.res.headers.get("content-type")
);

const photo2 = await api(`/api/properties/${propertyId}/photos`, {
  method: "POST",
  body: JSON.stringify({ mimeType: "image/jpeg", data: tinyJpegBase64(32, 64) }),
});
ok("sube una segunda foto → 201", photo2.res.status === 201);
const photo2Id = photo2.json?.photo?.id;

const moved = await api(`/api/properties/${propertyId}/photos/${photo2Id}`, {
  method: "PATCH",
  body: JSON.stringify({ position: 0 }),
});
ok(
  "mover la segunda foto a la posición 0 la vuelve portada",
  moved.json?.photos?.find((p) => p.id === photo2Id)?.isCover === true,
  JSON.stringify(moved.json?.photos)
);
ok(
  "la que era portada baja a la posición 1, sin huecos",
  moved.json?.photos?.find((p) => p.id === photo1.json.photo.id)?.position === 1
);

const afterDelete = await api(`/api/properties/${propertyId}/photos/${photo2Id}`, {
  method: "DELETE",
});
ok("borrar la portada la quita de la lista", afterDelete.res.ok && !afterDelete.json?.photos?.some((p) => p.id === photo2Id));
ok(
  "la restante SUBE a portada automáticamente (renumerado sin huecos)",
  afterDelete.json?.photos?.[0]?.id === photo1.json.photo.id && afterDelete.json.photos[0].isCover === true,
  JSON.stringify(afterDelete.json?.photos)
);

console.log("\n== Archivar y desarchivar ==");
const archived = await api(`/api/properties/${propertyId}`, { method: "DELETE" });
ok("DELETE archiva (no borra)", archived.res.ok && archived.json?.property?.archivedAt !== null);
const stillThere = await sql`select id from property where id = ${propertyId}`;
ok("la fila sigue existiendo en la base (soft-delete)", stillThere.length === 1);
const restored = await api(`/api/properties/${propertyId}`, { method: "PUT" });
ok(
  "PUT desarchiva y vuelve con el estatus que tenía (apartada)",
  restored.json?.property?.archivedAt === null && restored.json?.property?.status === "apartada"
);

console.log("\n== Una organización SIN el vertical recibe 404, nunca el catálogo de otra ==");
await sql`update organization set metadata = '{}' where id = ${orgId}`;
const disabled = await api("/api/properties");
ok(
  "GET /api/properties → 404 vertical_disabled",
  disabled.res.status === 404 && disabled.json?.error?.code === "vertical_disabled",
  JSON.stringify(disabled.json)
);
const disabledDetail = await api(`/api/properties/${propertyId}`);
ok(
  "GET de una propiedad puntual también 404 sin el vertical",
  disabledDetail.res.status === 404 && disabledDetail.json?.error?.code === "vertical_disabled"
);
// Se restaura: el guion queda re-ejecutable y la organización, consistente.
await sql`update organization set metadata = ${JSON.stringify({ vertical: "inmobiliario" })} where id = ${orgId}`;
const reenabled = await api("/api/properties");
ok("al restaurar el flag, el catálogo vuelve a verse", reenabled.res.ok);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
