/**
 * Self-test E2E de comportamiento — marca neutra
 * (guion tests/e2e/marca-neutra.md).
 *
 * De-branding: ninguna pantalla pública o autenticada debe enseñar la marca
 * de otro producto (Vocero/vocerocrm.com), sin importar el nombre que tenga
 * configurado ESTA instancia — es una comprobación de caja negra sobre el
 * HTML/SVG servido, no del código fuente.
 *
 * Uso: node --env-file=.env scripts/e2e-marca-neutra.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

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

/** Nada de "Vocero" en lo que de verdad se sirve, sea cual sea el nombre configurado. */
const sinVocero = (texto) => !/vocero/i.test(texto);

console.log("== Setup ==");
const email = "e2e@vocero.test";
const password = "password-e2e-123";
let su = await api("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email, password, name: "Operador E2E" }),
});
if (!su.res.ok) {
  su = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
ok("registro o login del propietario", su.res.ok);

console.log("\n== Superficies públicas (sin sesión) ==");
const login = await (await fetch(`${BASE}/login`)).text();
ok("el login no menciona Vocero", sinVocero(login), "el HTML contiene 'vocero'");
ok(
  "el login no dibuja la 'v' caligráfica (path de la marca ajena)",
  !login.includes("M0 32 Q2.08"),
  "apareció el trazo de la v"
);

const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).text();
ok("el manifiesto no menciona Vocero", sinVocero(manifest));

const iconSvg = await (await fetch(`${BASE}/icon.svg`)).text();
ok(
  "el icono estático ya no es la onda lima de Vocero",
  !iconSvg.includes("c5f04a") && !iconSvg.includes("M0 32 Q2.08"),
  "sigue el trazo viejo"
);

const og = await fetch(`${BASE}/opengraph-image`);
ok(
  "la imagen de compartir responde y es un PNG",
  og.ok && og.headers.get("content-type") === "image/png",
  `${og.status} ${og.headers.get("content-type")}`
);

console.log("\n== Blanco/negro: CUALQUIER nombre configurado se refleja igual ==");
const nombrePrueba = `Ferretería ${S}`;
const marcaPut = await api("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({ name: nombrePrueba, accent: "#3f6b66", currency: "MXN" }),
});
ok("PUT de marca → 200", marcaPut.res.ok);

const loginTrasCambio = await (await fetch(`${BASE}/login`)).text();
ok(
  "el login público YA dice el nombre nuevo",
  loginTrasCambio.includes(nombrePrueba),
  "no aparece el nombre configurado"
);
ok(
  "y sigue sin mencionar Vocero",
  sinVocero(loginTrasCambio),
  "reapareció 'vocero' tras cambiar el nombre"
);

const favicon = await fetch(`${BASE}/api/branding/favicon`);
const faviconSvg = await favicon.text();
ok(
  "el favicon generado dibuja la inicial del nombre nuevo, no un logo especial",
  faviconSvg.includes(">F<") && !faviconSvg.includes("M0 32 Q2.08"),
  faviconSvg.slice(0, 120)
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
process.exit(failures === 0 ? 0 : 1);
