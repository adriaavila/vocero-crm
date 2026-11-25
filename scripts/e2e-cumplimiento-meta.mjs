/**
 * Self-test E2E — webhooks de cumplimiento de Meta (fork): desautorizar y
 * solicitud de eliminación de datos, con `signed_request` firmado con
 * `META_APP_SECRET` como lo firma Meta.
 *
 * Camino feliz: el negocio conecta WhatsApp (Embedded Signup contra el
 * wa-mock, que dice quién autorizó), Meta avisa que esa persona quitó la app
 * → la conexión queda en «reconectar»; Meta pide borrar datos → responde
 * `{ url, confirmation_code }` y la página de estado lo muestra.
 * Camino infeliz: firma de otro secreto, cuerpo vacío y código inexistente.
 *
 * Uso: node --env-file=.env scripts/e2e-cumplimiento-meta.mjs
 */
import { createHmac } from "node:crypto";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.META_APP_SECRET ?? "";

const jar = new Map();
function applySetCookie(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      ...(opts.headers ?? {}),
    },
  });
  applySetCookie(res);
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signed(userId, secret = SECRET) {
  const body = b64url(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: Math.floor(Date.now() / 1000) }));
  return `${b64url(createHmac("sha256", secret).update(body).digest())}.${body}`;
}
// Meta manda formulario, sin cookies ni origin.
const metaPost = (path, signedRequest) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: signedRequest == null ? "" : `signed_request=${encodeURIComponent(signedRequest)}`,
  });

const ORG_SLUG = "principal";
const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function main() {
  if (!SECRET) {
    console.log("  FAIL META_APP_SECRET no está en el entorno");
    process.exit(1);
  }
  console.log("== Setup: sesión del operador y WhatsApp conectado por Embedded Signup ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name: "Operador E2E" }),
    });
  }
  ok("sesión del operador", su.res.ok, JSON.stringify(su.json));

  const code = `mock-es-cumpl-${stamp}`;
  const fbUserId = `fbu_${code}`; // el wa-mock deriva así el user_id de debug_token
  const wabaId = `e2ewaba_cumpl_${stamp}`;
  const cfg = await api(`/api/whatsapp/embedded-signup/config?org=${ORG_SLUG}&mode=coexistence`);
  ok("config 200", cfg.res.ok, JSON.stringify(cfg.json));
  const complete = await api("/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    body: JSON.stringify({ code, state: cfg.json?.state, wabaId, phoneNumberId: `esphone_${wabaId}`, mode: "coexistence" }),
  });
  ok("conectado", complete.json?.ok === true, JSON.stringify(complete.json));
  let conn = await api("/api/settings/whatsapp");
  ok("status connected", conn.json?.connection?.status === "connected", JSON.stringify(conn.json?.connection));

  console.log("\n== Desautorizar: firma válida → la conexión pide reconectar ==");
  const des = await metaPost("/api/meta/desautorizar", signed(fbUserId));
  const desJson = await des.json().catch(() => null);
  ok("200 con confirmation_code", des.status === 200 && Boolean(desJson?.confirmation_code), JSON.stringify(desJson));
  conn = await api("/api/settings/whatsapp");
  ok(
    "la conexión de ese negocio quedó en reconnect_required",
    conn.json?.connection?.status === "reconnect_required",
    JSON.stringify(conn.json?.connection)
  );

  console.log("\n== Desautorizar: caminos infelices ==");
  const bad = await metaPost("/api/meta/desautorizar", signed(fbUserId, "otro-secreto"));
  ok("firma de otro secreto → 400", bad.status === 400, String(bad.status));
  const empty = await metaPost("/api/meta/desautorizar", null);
  ok("sin signed_request → 400", empty.status === 400, String(empty.status));

  console.log("\n== Eliminar datos: firma válida → { url, confirmation_code } y página de estado ==");
  const del = await metaPost("/api/meta/eliminar-datos", signed(fbUserId));
  const delJson = await del.json().catch(() => null);
  ok("200", del.status === 200, `${del.status} ${JSON.stringify(delJson)}`);
  ok("trae confirmation_code", typeof delJson?.confirmation_code === "string" && delJson.confirmation_code.length >= 6);
  ok(
    "la url apunta a la página de estado con ese código",
    typeof delJson?.url === "string" && delJson.url.includes(`/solicitud-datos?codigo=${delJson.confirmation_code}`),
    delJson?.url
  );
  const page = await fetch(`${BASE}/solicitud-datos?codigo=${delJson?.confirmation_code}`);
  const html = await page.text();
  ok("la página de estado responde 200", page.status === 200, String(page.status));
  ok("muestra el código y «en proceso»", html.includes(delJson?.confirmation_code ?? "@@") && html.includes("en proceso"));

  const unknown = await metaPost("/api/meta/eliminar-datos", signed(`fbu_nadie_${stamp}`));
  ok("una persona sin negocios también recibe su código (Meta lo exige)", unknown.status === 200);

  const badDel = await metaPost("/api/meta/eliminar-datos", signed(fbUserId, "otro-secreto"));
  ok("eliminar con firma de otro secreto → 400", badDel.status === 400, String(badDel.status));

  const missing = await (await fetch(`${BASE}/solicitud-datos?codigo=NOEXISTE99`)).text();
  ok("un código que no existe lo dice", missing.includes("No encontramos"));

  console.log("\n== Dejar la conexión como estaba para los demás guiones ==");
  const cfg2 = await api(`/api/whatsapp/embedded-signup/config?org=${ORG_SLUG}&mode=coexistence`);
  const again = await api("/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    body: JSON.stringify({ code, state: cfg2.json?.state, wabaId, phoneNumberId: `esphone_${wabaId}`, mode: "coexistence" }),
  });
  ok("reconectar vuelve a connected", again.json?.ok === true, JSON.stringify(again.json));

  console.log(`\n${failures === 0 ? "TODO VERDE" : "CON FALLOS"} — ${checks - failures}/${checks} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
