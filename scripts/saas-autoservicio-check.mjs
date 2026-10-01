/**
 * Alta 100 % de autoservicio, de punta a punta (modo SaaS, contra el wa-mock):
 * registro → negocio con prueba de 7 días → Embedded Signup (config + complete)
 * → webhook confirmado → primer mensaje → onboarding cerrado. Y los caminos que
 * el dueño va a vivir: cancelar el popup a mitad y retomar, reintentar sin
 * duplicar nada, un número que ya es de otro negocio, y la prueba vencida.
 *
 * Uso (servidor en modo SaaS con el autoservicio encendido):
 *   ALLOK_SAAS_MODE=true SAAS_SELF_SERVE=true node --env-file=.env scripts/saas-autoservicio-check.mjs
 * Requiere: WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 * META_APP_ID/META_ES_CONFIG_ID, BD migrada. Sale con 0 solo si todo pasa.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PORT = new URL(BASE).port;
const hostFor = (sub) => `${sub}.localhost${PORT ? `:${PORT}` : ""}`;
const APP_HOST = hostFor("app");

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

/** Un navegador por negocio: su propio tarro de cookies. */
function client() {
  const jar = new Map();
  return async function api(host, path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        origin: `http://${host}`,
        "x-forwarded-host": host,
        "x-forwarded-proto": "http",
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(opts.headers ?? {}),
      },
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0] ?? "";
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  };
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function signUp(api, name, email) {
  const r = await api(APP_HOST, "/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: "password-e2e-123" }),
  });
  const tenant = await api(APP_HOST, "/api/saas/tenant");
  const slug = tenant.json?.url ? new URL(tenant.json.url).hostname.split(".")[0] : null;
  return { r, slug };
}

async function connect(api, slug, { wabaId, phoneNumberId, code = "mock-es-code", mode = "coexistence" }) {
  const cfg = await api(APP_HOST, `/api/whatsapp/embedded-signup/config?org=${slug}&mode=${mode}`);
  if (!cfg.res.ok) return { cfg, complete: null };
  const complete = await api(APP_HOST, "/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    body: JSON.stringify({ code, state: cfg.json.state, wabaId, phoneNumberId, mode }),
  });
  return { cfg, complete };
}

async function onboardingRow(orgSlug) {
  const rows = await sql`
    select o.* from whatsapp_onboarding o join organization g on g.id = o.organization_id
    where g.slug = ${orgSlug}`;
  return rows[0] ?? null;
}

async function main() {
  const owner = client();
  const name = `Panadería Auto ${stamp}`;

  console.log("== 1. Registro: el negocio nace solo, con prueba de 7 días ==");
  const { r: signup, slug } = await signUp(owner, name, `auto-${stamp}@vocero.test`);
  ok("registro público 200", signup.res.ok, JSON.stringify(signup.json));
  ok("recibe su subdominio", Boolean(slug), String(slug));
  const [org] = await sql`select id, metadata from organization where slug = ${slug}`;
  const billing = JSON.parse(org?.metadata ?? "{}")?.allok?.billing ?? {};
  ok("prueba de autoservicio: Completo en trialing", billing.plan === "pro" && billing.status === "trialing" && billing.source === "self_serve_trial", JSON.stringify(billing));
  const days = (Date.parse(billing.currentPeriodEnd) - Date.now()) / 86400000;
  ok("vence en ~7 días", days > 6.9 && days <= 7.01, String(days));
  ok("onboarding en pendiente", (await onboardingRow(slug))?.status === "pendiente");
  const [profile] = await sql`select enabled from agent_profile where organization_id = ${org.id}`;
  ok("el agente nace apagado (no contesta a clientes reales sin configurar)", profile?.enabled === false);

  const tenantHost = hostFor(slug);
  const view0 = await owner(tenantHost, "/api/onboarding/whatsapp");
  ok("el dueño ve su alta en pendiente", view0.json?.status === "pendiente", JSON.stringify(view0.json));

  console.log("\n== 2. Cancela el popup a mitad: queda anotado y puede retomar ==");
  const cfg = await owner(APP_HOST, `/api/whatsapp/embedded-signup/config?org=${slug}&mode=coexistence`);
  ok("config 200 durante la prueba (sin pagar)", cfg.res.ok, JSON.stringify(cfg.json));
  const cancel = await owner(APP_HOST, "/api/whatsapp/embedded-signup/event", {
    method: "POST",
    body: JSON.stringify({ state: cfg.json?.state, mode: "coexistence", event: "CANCEL", currentStep: "PHONE_NUMBER_VERIFICATION" }),
  });
  ok("la cancelación se registra", cancel.json?.ok === true && cancel.json?.errorKey === "cancelled", JSON.stringify(cancel.json));
  const afterCancel = await owner(tenantHost, "/api/onboarding/whatsapp");
  ok("el panel la muestra con dónde quedó", afterCancel.json?.status === "error" && afterCancel.json?.cancelledAtStep === "PHONE_NUMBER_VERIFICATION", JSON.stringify(afterCancel.json));
  const otherProvider = await owner(APP_HOST, "/api/whatsapp/embedded-signup/event", {
    method: "POST",
    body: JSON.stringify({ state: cfg.json?.state, mode: "coexistence", event: "CANCEL", errorCode: 2655093 }),
  });
  ok("un error de Meta dentro de la ventana sale en lenguaje humano", otherProvider.json?.errorKey === "other_provider", JSON.stringify(otherProvider.json));
  const forged = await owner(APP_HOST, "/api/whatsapp/embedded-signup/event", {
    method: "POST",
    body: JSON.stringify({ state: "estado-inventado", mode: "coexistence", event: "CANCEL" }),
  });
  ok("sin el estado firmado no se anota nada (403)", forged.res.status === 403);

  console.log("\n== 3. Retoma y conecta: conectado → webhook_ok ==");
  const wabaId = `autowaba_${stamp}`;
  const phoneNumberId = `esphone_${wabaId}`;
  const first = await connect(owner, slug, { wabaId, phoneNumberId });
  ok("complete 200", first.complete?.res.ok, JSON.stringify(first.complete?.json ?? first.cfg.json));
  ok("vuelve a la pantalla final en su subdominio", (first.complete?.json?.redirectTo ?? "").startsWith(`http://${tenantHost}/settings/whatsapp`), first.complete?.json?.redirectTo);
  let row = await onboardingRow(slug);
  ok("onboarding webhook_ok, sin error", row?.status === "webhook_ok" && row?.error_step === null, JSON.stringify(row));
  ok("guarda modo, WABA y número", row?.mode === "coexistence" && row?.waba_id === wabaId && row?.phone_number_id === phoneNumberId);
  const [cred] = await sql`select token_cipher, organization_id from meta_credentials where phone_number_id = ${phoneNumberId}`;
  ok("token cifrado en reposo (no es el token del mock)", Boolean(cred?.token_cipher) && !String(cred.token_cipher).includes("mock"), "");

  console.log("\n== 4. Reintentar no duplica nada ==");
  const again = await connect(owner, slug, { wabaId, phoneNumberId });
  ok("reintento ok", again.complete?.json?.ok === true, JSON.stringify(again.complete?.json));
  const creds = await sql`select count(*)::int as n from meta_credentials where organization_id = ${org.id}`;
  ok("sigue habiendo una sola conexión", creds[0].n === 1);
  row = await onboardingRow(slug);
  ok("sigue en webhook_ok y cuenta los intentos", row?.status === "webhook_ok" && row?.attempts >= 2, JSON.stringify(row));
  const retry = await owner(tenantHost, "/api/onboarding/whatsapp/retry", { method: "POST" });
  ok("'terminar de activar' con el token guardado funciona sin abrir Meta", retry.json?.ok === true, JSON.stringify(retry.json));
  const cfg2 = await owner(APP_HOST, `/api/whatsapp/embedded-signup/config?org=${slug}&mode=coexistence`);
  await owner(APP_HOST, "/api/whatsapp/embedded-signup/event", {
    method: "POST",
    body: JSON.stringify({ state: cfg2.json?.state, mode: "coexistence", event: "CANCEL" }),
  });
  row = await onboardingRow(slug);
  ok("reabrir Meta y cerrar no baja un número ya activo", row?.status === "webhook_ok" && row?.error_step !== null, JSON.stringify(row));

  console.log("\n== 5. Primer mensaje: llega al inbox y cierra el onboarding ==");
  const inbound = await owner(APP_HOST, "/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId, from: "5215500000001", name: "Cliente Prueba", text: `hola ${stamp}` }),
  });
  ok("el webhook firmado entra", inbound.res.ok, JSON.stringify(inbound.json));
  row = await onboardingRow(slug);
  ok("onboarding primer_mensaje", row?.status === "primer_mensaje" && row?.first_message_at !== null, JSON.stringify(row));
  const [msg] = await sql`select text from message where organization_id = ${org.id} and direction = 'in' order by created_at desc limit 1`;
  ok("el mensaje está en su bandeja", msg?.text === `hola ${stamp}`, JSON.stringify(msg));
  const finalView = await owner(tenantHost, "/api/onboarding/whatsapp");
  ok("el panel muestra primer_mensaje", finalView.json?.status === "primer_mensaje", JSON.stringify(finalView.json));
  const [ai] = await sql`select count(*)::int as n from message where organization_id = ${org.id} and direction = 'out' and origin = 'ai'`;
  ok("el agente apagado no le contestó al cliente", ai.n === 0);

  console.log("\n== 6. Un número que ya es de otro negocio: bloquea y manda a soporte ==");
  const intruder = client();
  const { slug: intruderSlug } = await signUp(intruder, `Otro Negocio ${stamp}`, `otro-${stamp}@vocero.test`);
  ok("el segundo negocio se registra", Boolean(intruderSlug));
  const samePhone = await connect(intruder, intruderSlug, { wabaId, phoneNumberId });
  ok("mismo número → 409 number_in_use", samePhone.complete?.res.status === 409 && samePhone.complete?.json?.errorKey === "number_in_use", JSON.stringify(samePhone.complete?.json));
  const [still] = await sql`select organization_id from meta_credentials where phone_number_id = ${phoneNumberId}`;
  ok("el número sigue en el negocio original", still?.organization_id === org.id);
  const intruderRow = await onboardingRow(intruderSlug);
  ok("soporte lo ve como error number_in_use", intruderRow?.status === "error" && ["phone_in_use", "waba_in_use"].includes(intruderRow?.error_step), JSON.stringify(intruderRow));

  console.log("\n== 7. Prueba vencida: no se conecta ni contesta el agente ==");
  await sql`
    update organization
    set metadata = jsonb_set(metadata::jsonb, '{allok,billing,currentPeriodEnd}', to_jsonb(${new Date(Date.now() - 60000).toISOString()}::text))::text
    where id = ${org.id}`;
  const expired = await owner(APP_HOST, `/api/whatsapp/embedded-signup/config?org=${slug}&mode=coexistence`);
  ok("config 402 con la prueba vencida", expired.res.status === 402, `${expired.res.status} ${JSON.stringify(expired.json)}`);

  console.log(`\n${failures === 0 ? "TODO VERDE" : "CON FALLOS"} — ${checks - failures}/${checks} checks`);
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(async () => {
    await sql.end();
    process.exit(failures === 0 ? 0 : 1);
  });
