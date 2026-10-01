/**
 * Self-test E2E de comportamiento — Embedded Signup EN la app (fork, sin
 * pasar por allok.fun): `/api/whatsapp/embedded-signup/config` +
 * `/complete` contra el wa-mock. Cubre credenciales guardadas, override del
 * webhook confirmado, sync de coexistencia pedido una sola vez, y los
 * caminos infelices (403 permisos, 502 token inválido, 403 estado vencido).
 *
 * Uso: node --env-file=.env scripts/e2e-embedded-signup.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → el
 * wa-mock, META_APP_ID/META_ES_CONFIG_ID configurados, y BD migrada.
 *
 * Reusa el operador de `e2e-selftest.mjs` (instancia mono-organización fuera
 * de SaaS: solo el PRIMER usuario de la BD recibe organización — un usuario
 * nuevo aquí se quedaría sin ella). Igual que el resto de los guiones,
 * sobrescribe la conexión de WhatsApp del negocio compartido; nadie depende
 * de que sobreviva la de otro guion (cada uno pone la suya al empezar).
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

// Cookie jar por nombre: a diferencia de los demás guiones, aquí hay DOS
// cookies en juego (sesión de Better Auth + estado de Embedded Signup).
// Sobrescribir con el último Set-Cookie —como hacen los otros— perdería la
// sesión en cuanto /config pusiera la suya.
const jar = new Map();
function applySetCookie(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
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

// Instancia mono-organización fuera de SaaS: el primer usuario nace con el
// slug fijo "principal" (server/auth/on-signup.ts).
const ORG_SLUG = "principal";
const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function connectOnce(wabaId, phoneNumberId, code, mode = "coexistence") {
  const cfg = await api(`/api/whatsapp/embedded-signup/config?org=${ORG_SLUG}&mode=${mode}`);
  if (!cfg.res.ok) return { cfg, complete: { res: cfg.res, json: cfg.json } };
  const complete = await api("/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    body: JSON.stringify({ code, state: cfg.json?.state, wabaId, phoneNumberId, mode }),
  });
  return { cfg, complete };
}

async function main() {
  console.log("== Setup: sesión del operador (comparte el negocio de e2e-selftest) ==");
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
  ok("sesión del operador", su.res.ok, JSON.stringify(su.json));

  await api("/api/dev/wa-mock/smb-app-data", { method: "DELETE" });

  console.log("\n== config: mint del estado firmado + descubrimiento de la app ==");
  const cfg = await api(`/api/whatsapp/embedded-signup/config?org=${ORG_SLUG}&mode=coexistence`);
  ok("config 200", cfg.res.ok, JSON.stringify(cfg.json));
  ok(
    "trae appId + configId de coexistencia + state",
    Boolean(cfg.json?.appId && cfg.json?.configId && cfg.json?.state),
    JSON.stringify(cfg.json)
  );

  console.log("\n== complete: code del mock → conexión completa (coexistencia) ==");
  const wabaId = `e2ewaba_${stamp}`;
  const phoneNumberId = `esphone_${wabaId}`; // el mock deriva el id así (GET {waba}/phone_numbers)
  const complete = await api("/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    body: JSON.stringify({ code: "mock-es-code", state: cfg.json?.state, wabaId, phoneNumberId, mode: "coexistence" }),
  });
  ok("complete 200", complete.res.ok, JSON.stringify(complete.json));
  ok(
    "responde ok:true con el número conectado",
    complete.json?.ok === true && Boolean(complete.json?.displayPhoneNumber),
    JSON.stringify(complete.json)
  );
  ok("mode devuelto es coexistence", complete.json?.mode === "coexistence");
  ok(
    "redirectTo vuelve a settings/whatsapp?connected=1",
    (complete.json?.redirectTo ?? "").includes("/settings/whatsapp?connected=1"),
    complete.json?.redirectTo
  );

  console.log("\n== credenciales guardadas (antes que nada más) ==");
  const conn = await api("/api/settings/whatsapp");
  ok("GET conexión 200", conn.res.ok);
  ok("wabaId guardado coincide", conn.json?.connection?.wabaId === wabaId, conn.json?.connection?.wabaId);
  ok(
    "phoneNumberId guardado coincide",
    conn.json?.connection?.phoneNumberId === phoneNumberId,
    conn.json?.connection?.phoneNumberId
  );
  ok("status connected", conn.json?.connection?.status === "connected");

  console.log("\n== override del webhook confirmado contra Meta (mock) ==");
  const sub = await api(`/api/dev/wa-mock/graph/${wabaId}/subscribed_apps`);
  const override = sub.json?.data?.[0];
  ok("Meta ve el override guardado", Boolean(override?.override_callback_uri), JSON.stringify(sub.json));
  ok(
    "apunta al webhook de ESTA instancia (mismo que /api/provision)",
    (override?.override_callback_uri ?? "").endsWith(`/api/webhooks/wa/${process.env.META_WEBHOOK_VERIFY_TOKEN}`),
    override?.override_callback_uri
  );

  console.log("\n== sync de coexistencia: se pidió, cada tipo una sola vez ==");
  const syncReqs = (await api("/api/dev/wa-mock/smb-app-data")).json?.smbAppDataRequests ?? [];
  const forThisPhone = syncReqs.filter((r) => r.phoneNumberId === phoneNumberId);
  ok("pidió smb_app_state_sync", forThisPhone.some((r) => r.syncType === "smb_app_state_sync"));
  ok("pidió history", forThisPhone.some((r) => r.syncType === "history"));
  ok("cada tipo exactamente una vez", forThisPhone.length === 2, JSON.stringify(forThisPhone));

  console.log("\n== reconectar el MISMO número no repite el sync (guard en organization.metadata) ==");
  const second = await connectOnce(wabaId, phoneNumberId, "mock-es-code");
  ok("la reconexión también resuelve ok", second.complete.json?.ok === true, JSON.stringify(second.complete.json));
  const syncReqsAfter = (await api("/api/dev/wa-mock/smb-app-data")).json?.smbAppDataRequests ?? [];
  ok(
    "el conteo de sync sigue en 2 (no se repitió)",
    syncReqsAfter.filter((r) => r.phoneNumberId === phoneNumberId).length === 2,
    JSON.stringify(syncReqsAfter)
  );

  console.log("\n== camino infeliz: faltan permisos en el token → 403 con la lista ==");
  const noPermWaba = `e2ewaba_noperm_${stamp}`;
  const noPerm = await connectOnce(noPermWaba, `esphone_${noPermWaba}`, "mock-es-code-noperm");
  ok("403 por permisos faltantes", noPerm.complete.res.status === 403, JSON.stringify(noPerm.complete.json));
  ok(
    "reporta cuáles permisos faltan",
    Array.isArray(noPerm.complete.json?.missingPermissions) && noPerm.complete.json.missingPermissions.length > 0,
    JSON.stringify(noPerm.complete.json)
  );

  console.log("\n== camino infeliz: Meta invalida el token de negocio → 502 ==");
  const badWaba = `e2ewaba_bad_${stamp}`;
  const badToken = await connectOnce(badWaba, `esphone_${badWaba}`, "mock-es-code-invalid");
  ok("502 por token inválido", badToken.complete.res.status === 502, JSON.stringify(badToken.complete.json));

  console.log("\n== camino infeliz: estado que no coincide con la cookie vigente → 403 ==");
  const cfgStale = await api(`/api/whatsapp/embedded-signup/config?org=${ORG_SLUG}&mode=coexistence`);
  ok("config para el intento de estado viejo, 200", cfgStale.res.ok);
  const stale = await api("/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    body: JSON.stringify({
      code: "mock-es-code",
      state: "un-estado-que-nunca-existio",
      wabaId,
      phoneNumberId,
      mode: "coexistence",
    }),
  });
  ok("403: la sesión de conexión no coincide", stale.res.status === 403, JSON.stringify(stale.json));

  console.log(
    `\n${failures === 0 ? "TODO VERDE" : "CON FALLOS"} — ${checks - failures}/${checks} checks`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
