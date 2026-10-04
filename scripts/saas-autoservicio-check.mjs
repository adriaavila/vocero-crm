/**
 * Alta 100 % de autoservicio, de punta a punta (modo SaaS, contra el wa-mock):
 * registro → negocio con prueba de 7 días → Embedded Signup (config + complete)
 * → webhook confirmado → primer mensaje → onboarding cerrado. Y los caminos que
 * el dueño va a vivir: cancelar el popup a mitad y retomar, reintentar sin
 * duplicar nada, un número que ya es de otro negocio, y la prueba vencida.
 *
 * Uso (servidor en modo SaaS con el autoservicio encendido):
 *   ALLOK_SAAS_MODE=true SAAS_SELF_SERVE=true node --env-file=.env scripts/saas-autoservicio-check.mjs
 * Requiere: WA_MOCK_ENABLED=true, EMAIL_API_URL=<APP_BASE_URL>/api/dev/email-sink
 * (el correo cae en un sumidero en memoria, no en Resend), META_GRAPH_BASE_URL → wa-mock,
 * META_APP_ID/META_ES_CONFIG_ID, BD migrada. Sale con 0 solo si todo pasa.
 *
 * Tramos 9 a 11: equipo, estados del plan (prueba, tope, vencida, cobro fallido,
 * cancelada, vuelve a suscribirse) con eventos de Stripe firmados con el secreto
 * local y los correos de la prueba (una vez por negocio). El tramo 0 FALLA si
 * falta una pieza del encendido (Stripe, Meta, correo): este guion es también
 * la lista de comprobación de `docs/autoservicio.md`.
 *
 * El último tramo (8) recupera la contraseña desde el subdominio del negocio y
 * solo corre con el conector de correo encendido (RESEND_API_KEY + EMAIL_FROM);
 * apagado, lo anuncia y lo salta. Nunca manda correo de verdad (va al sumidero local): lee el token de
 * la tabla `verification`, que es el mismo que viaja en el enlace.
 */
import postgres from "postgres";
import { createHmac } from "node:crypto";

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

/** Lo que tiene que existir para que el autoservicio cobre y avise de punta a punta. */
const REQUIRED_ENV = [
  ["SAAS_SELF_SERVE", (v) => v === "true", "SAAS_SELF_SERVE=true: abre el registro"],
  ["ALLOK_SAAS_MODE", (v) => v === "true", "ALLOK_SAAS_MODE=true"],
  ["ALLOK_SAAS_STRIPE_SECRET_KEY", (v) => /^(sk|rk)_(test|live)_/.test(v ?? ""), "clave de Stripe (sk_/rk_)"],
  ["ALLOK_SAAS_STRIPE_WEBHOOK_SECRET", (v) => /^whsec_/.test(v ?? ""), "secreto del webhook (whsec_)"],
  ["ALLOK_SAAS_STRIPE_BASIC_PRICE_ID", (v) => /^price_/.test(v ?? ""), "precio de Esencial"],
  ["ALLOK_SAAS_STRIPE_PRO_PRICE_ID", (v) => /^price_/.test(v ?? ""), "precio de Completo"],
  ["META_APP_ID", (v) => Boolean(v), "app de Meta (Embedded Signup)"],
  ["META_ES_CONFIG_ID", (v) => Boolean(v), "configuración de Embedded Signup"],
  ["RESEND_API_KEY", (v) => Boolean(v), "correo: recuperar contraseña y avisos de la prueba"],
  ["EMAIL_FROM", (v) => Boolean(v), "correo: remitente verificado"],
  // El guion crea negocios y pide recuperaciones de contraseña de verdad: el
  // correo tiene que caer en el sumidero local, nunca en Resend.
  ["EMAIL_API_URL", isLocalEmailSink, "correo: sumidero local (EMAIL_API_URL=<APP_BASE_URL>/api/dev/email-sink), nunca Resend"],
];

function isLocalEmailSink(value) {
  try {
    const url = new URL(value ?? "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.pathname === "/api/dev/email-sink";
  } catch {
    return false;
  }
}

const signWebhook = (payload, secret, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

async function main() {
  console.log("== 0. Piezas del encendido: si falta una, falla ==");
  for (const [name, valid, what] of REQUIRED_ENV) {
    ok(`${name} (${what})`, valid(process.env[name]));
  }
  const stripeKey = process.env.ALLOK_SAAS_STRIPE_SECRET_KEY ?? "";
  console.log(`  ·  Stripe en modo ${stripeKey.includes("_live_") ? "REAL" : "prueba"}`);

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
  // El webhook responde antes de terminar de guardar (en frío, la primera compilación tarda): se espera un poco.
  let msg;
  for (let i = 0; i < 20 && !msg; i++) {
    [msg] = await sql`select text from message where organization_id = ${org.id} and direction = 'in' order by created_at desc limit 1`;
    if (!msg) await new Promise((r) => setTimeout(r, 500));
  }
  ok("el mensaje está en su bandeja", msg?.text === `hola ${stamp}`, JSON.stringify(msg));
  const finalView = await owner(tenantHost, "/api/onboarding/whatsapp");
  ok("el panel muestra primer_mensaje", finalView.json?.status === "primer_mensaje", JSON.stringify(finalView.json));
  const [ai] = await sql`select count(*)::int as n from message where organization_id = ${org.id} and direction = 'out' and origin = 'ai'`;
  ok("el agente apagado no le contestó al cliente", ai.n === 0);

  console.log("\n== 5b. Suma a su equipo desde el subdominio del negocio ==");
  const invited = await owner(tenantHost, "/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "Ana Equipo", email: `equipo-${stamp}@vocero.test`, password: "password-equipo-123" }),
  });
  ok("el dueño invita a un miembro (no 'El registro empieza en app')", invited.res.status === 200 || invited.res.status === 201, `${invited.res.status} ${JSON.stringify(invited.json)}`);
  const team = await owner(tenantHost, "/api/settings/team");
  ok("el miembro queda en su equipo", team.json?.members?.some((m) => m.email === `equipo-${stamp}@vocero.test`), JSON.stringify(team.json?.members?.map((m) => m.email)));
  const publicSignup = await client()(APP_HOST, "/api/auth/sign-up/email", { method: "POST", headers: { origin: `http://${tenantHost}`, "x-forwarded-host": tenantHost }, body: JSON.stringify({ name: "X", email: `x-${stamp}@vocero.test`, password: "password-e2e-123" }) });
  ok("un registro público desde el subdominio sigue cerrado (403)", publicSignup.res.status === 403, String(publicSignup.res.status));

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

  console.log("\n== 9. Estados del plan que ve el dueño ==");
  const kindOf = async (api, host) => (await api(host, "/api/saas/billing/status")).json;
  ok("vencida: 'trial_ended' y el agente no puede contestar", (await kindOf(owner, tenantHost))?.kind === "trial_ended" && (await kindOf(owner, tenantHost))?.agentAllowed === false, JSON.stringify(await kindOf(owner, tenantHost)));
  // Una prueba vigente que agotó las 300 respuestas de IA.
  await sql`update organization set metadata = jsonb_set(metadata::jsonb, '{allok,billing,currentPeriodEnd}', to_jsonb(${new Date(Date.now() + 5 * 86400000).toISOString()}::text))::text where id = ${org.id}`;
  ok("vigente: 'trial'", (await kindOf(owner, tenantHost))?.kind === "trial", JSON.stringify(await kindOf(owner, tenantHost)));
  const [conv] = await sql`select id from conversation where organization_id = ${org.id} and not is_test limit 1`;
  const have = (await sql`select count(*)::int n from message where organization_id = ${org.id} and origin = 'ai' and direction = 'out'`)[0].n;
  await sql`insert into message (id, organization_id, conversation_id, wa_message_id, direction, type, text, status, ai_generated, origin)
            select ${"msg_cap" + stamp} || g, ${org.id}, ${conv.id}, ${"wamid.cap" + stamp} || g, 'out', 'text', 'r', 'sent', true, 'ai' from generate_series(1, ${300 - have}) g`;
  const capped = await kindOf(owner, tenantHost);
  ok("300 respuestas: 'trial_cap' y el agente pausa", capped?.kind === "trial_cap" && capped?.agentAllowed === false, JSON.stringify(capped));
  await sql`delete from message where wa_message_id like ${"wamid.cap" + stamp + "%"}`;

  console.log("\n== 10. Cobro: eventos de Stripe firmados con el secreto local ==");
  const secret = process.env.ALLOK_SAAS_STRIPE_WEBHOOK_SECRET ?? "";
  const proPrice = process.env.ALLOK_SAAS_STRIPE_PRO_PRICE_ID;
  const basicPrice = process.env.ALLOK_SAAS_STRIPE_BASIC_PRICE_ID;
  let evN = 0;
  const hook = async (type, object, { tamper = false, id = `evt_chk_${stamp}_${++evN}`, created = Math.floor(Date.now() / 1000) + evN } = {}) => {
    const payload = JSON.stringify({ id, object: "event", type, created, api_version: "2026-08-26.dahlia", data: { object } });
    const res = await fetch(`${BASE}/api/saas/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signWebhook(payload, tamper ? "whsec_otro" : secret) }, body: payload });
    return { status: res.status, json: await res.json().catch(() => null), id, payload };
  };
  const meta = { organizationId: org.id, plan: "pro" };
  const sub = (id, status, extra = {}) => ({ id, object: "subscription", status, customer: `cus_chk_${stamp}`, metadata: meta, cancel_at_period_end: false, cancel_at: null, items: { data: [{ price: { id: proPrice }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }, ...extra });
  const billingNow = async () => JSON.parse((await sql`select metadata from organization where id = ${org.id}`)[0].metadata).allok.billing;

  ok("firma inválida → 400", (await hook("invoice.paid", {}, { tamper: true })).status === 400);
  await hook("checkout.session.completed", { id: "cs_chk", object: "checkout.session", mode: "subscription", customer: `cus_chk_${stamp}`, subscription: `sub_chk_a_${stamp}`, metadata: meta });
  const created = await hook("customer.subscription.created", sub(`sub_chk_a_${stamp}`, "active"));
  let b = await billingNow();
  ok("paga: plan Completo activo", created.status === 200 && b.status === "active" && b.plan === "pro" && b.subscriptionId === `sub_chk_a_${stamp}`, JSON.stringify(b));
  ok("y el dueño ve 'paid'", (await kindOf(owner, tenantHost))?.kind === "paid");
  ok("el mismo evento dos veces no se aplica dos veces", (await fetch(`${BASE}/api/saas/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signWebhook(created.payload, secret) }, body: created.payload }).then((r) => r.json())).duplicate === true);

  await hook("customer.subscription.updated", sub(`sub_chk_a_${stamp}`, "active", { cancel_at: Math.floor(Date.now() / 1000) + 3 * 86400 }));
  ok("cancelar desde el portal (cancel_at) se lee como 'cancelling', no como renovación", (await billingNow()).cancelAtPeriodEnd === true && (await kindOf(owner, tenantHost))?.kind === "cancelling");
  await hook("customer.subscription.updated", sub(`sub_chk_a_${stamp}`, "active", { items: { data: [{ price: { id: basicPrice }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } }));
  ok("cambiar a Esencial desde el portal cambia el plan", (await billingNow()).plan === "basic");

  await hook("invoice.payment_failed", { id: "in_chk", object: "invoice", customer: `cus_chk_${stamp}`, metadata: meta, parent: { subscription_details: { subscription: `sub_chk_a_${stamp}` } } });
  ok("cobro fallido: 'payment_failed' y el agente pausa", (await kindOf(owner, tenantHost))?.kind === "payment_failed" && (await kindOf(owner, tenantHost))?.agentAllowed === false);
  const twice = await owner(APP_HOST, "/api/saas/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "pro" }) });
  ok("con un cobro fallido no abre un segundo checkout (409)", twice.res.status === 409 && twice.json?.error?.code === "billing_payment_failed", `${twice.res.status} ${JSON.stringify(twice.json)}`);
  const old = await hook("invoice.paid", { id: "in_old", object: "invoice", customer: `cus_chk_${stamp}`, metadata: meta, parent: { subscription_details: { subscription: "sub_vieja" } } });
  ok("una factura de otra suscripción no mueve nada", old.json?.stale_subscription === true && (await kindOf(owner, tenantHost))?.kind === "payment_failed", JSON.stringify(old.json));
  await hook("invoice.paid", { id: "in_ok", object: "invoice", customer: `cus_chk_${stamp}`, metadata: meta, parent: { subscription_details: { subscription: `sub_chk_a_${stamp}` } } });
  ok("pagó de nuevo: vuelve a 'paid' y el agente puede contestar", (await kindOf(owner, tenantHost))?.agentAllowed === true);

  await hook("customer.subscription.deleted", sub(`sub_chk_a_${stamp}`, "canceled"));
  ok("cancelada: 'canceled', los datos siguen", (await kindOf(owner, tenantHost))?.kind === "canceled" && (await sql`select count(*)::int n from message where organization_id = ${org.id}`)[0].n > 0);
  await hook("customer.subscription.updated", sub(`sub_chk_a_${stamp}`, "canceled"));
  const resub = await hook("customer.subscription.created", sub(`sub_chk_b_${stamp}`, "active"));
  b = await billingNow();
  ok("vuelve a suscribirse: la suscripción nueva reemplaza a la cancelada", resub.status === 200 && !resub.json?.ignored && b.subscriptionId === `sub_chk_b_${stamp}` && b.status === "active", JSON.stringify(b));
  const lateOld = await hook("customer.subscription.deleted", sub(`sub_chk_a_${stamp}`, "canceled"));
  ok("el evento tardío de la vieja no la mata", lateOld.json?.stale_subscription === true && (await billingNow()).status === "active");

  console.log("\n== 11. Correos de la prueba: una vez por negocio ==");
  const run = async () => (await owner(APP_HOST, "/api/dev/trial-lifecycle", { method: "POST" })).json;
  const [fresh] = await sql`select o.id from organization o where o.slug = ${intruderSlug}`;
  await sql`update organization set metadata = jsonb_set(metadata::jsonb, '{allok,billing,currentPeriodEnd}', to_jsonb(${new Date(Date.now() + 40 * 3600000).toISOString()}::text))::text where id = ${fresh.id}`;
  const m1 = await run();
  ok("a 2 días del final sale 'termina pronto' (1)", m1?.ending >= 1, JSON.stringify(m1));
  const m2 = await run();
  ok("la segunda pasada no repite", m2?.ending === 0 && m2?.ended === 0, JSON.stringify(m2));
  const [marker] = await sql`select (metadata::jsonb #>> '{allok,lifecycle,trialEnding}') as at from organization where id = ${fresh.id}`;
  ok("queda la marca en el negocio", Boolean(marker?.at));
  await sql`update organization set metadata = jsonb_set(metadata::jsonb, '{allok,billing,currentPeriodEnd}', to_jsonb(${new Date(Date.now() - 3600000).toISOString()}::text))::text where id = ${fresh.id}`;
  const m3 = await run();
  ok("vencida sale 'terminó' (1) y solo una vez", m3?.ended >= 1 && (await run())?.ended === 0, JSON.stringify(m3));

  console.log("\n== 8. Olvidó la contraseña: pide desde el subdominio del negocio, abre el enlace, entra con la nueva ==");
  const ownerEmail = `auto-${stamp}@vocero.test`;
  const requestReset = (who, host, email) =>
    who(host, "/api/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
  const resetRows = async () => (await sql`select count(*)::int as n from verification where identifier like 'reset-password:%'`)[0].n;
  const tokenFor = async (email) =>
    (
      await sql`
        select v.identifier from verification v join "user" u on u.id = v.value
        where u.email = ${email} and v.identifier like 'reset-password:%'
        order by v.created_at desc limit 1`
    )[0]?.identifier.slice("reset-password:".length) ?? null;

  const stranger = client();
  const unknownEmail = `nadie-${stamp}@vocero.test`;
  const before = await resetRows();
  const unknown = await requestReset(stranger, tenantHost, unknownEmail);
  if (unknown.json?.code === "RESET_PASSWORD_DISABLED") {
    ok("el conector de correo está encendido (RESEND_API_KEY + EMAIL_FROM)", false, "apagado: sin recuperación por correo");
  } else {
    ok("un correo sin cuenta recibe la misma respuesta 200", unknown.res.status === 200 && unknown.json?.status === true, JSON.stringify(unknown.json));
    ok("y no deja ningún enlace pendiente", (await resetRows()) === before);

    const asked = await requestReset(stranger, tenantHost, ownerEmail);
    ok("el dueño pide el enlace desde su subdominio: misma respuesta 200", asked.res.status === 200 && asked.json?.status === true, JSON.stringify(asked.json));
    const token = await tokenFor(ownerEmail);
    ok("queda un enlace pendiente a su nombre", Boolean(token));
    const sunk = await fetch(`${process.env.EMAIL_API_URL}?to=${encodeURIComponent(ownerEmail)}`).then((r) => r.json()).catch(() => null);
    ok("y el correo cayó en el sumidero local, no en Resend", (sunk?.emails?.length ?? 0) >= 1, JSON.stringify(sunk));

    const callback = await stranger(tenantHost, `/api/auth/reset-password/${token}?callbackURL=%2Freset-password`);
    const where = callback.res.headers.get("location") ?? "";
    ok("abrir el enlace redirige a la pantalla de contraseña nueva con el token", callback.res.status === 302 && where.includes(`/reset-password?token=${token}`), `${callback.res.status} ${where}`);
    const evil = await stranger(tenantHost, `/api/auth/reset-password/${token}?callbackURL=https%3A%2F%2Fevil.example%2F`);
    ok("un callbackURL ajeno se rechaza", evil.res.status === 403, String(evil.res.status));

    const sessionBefore = await owner(tenantHost, "/api/auth/get-session");
    ok("antes del cambio, su sesión abierta sirve", sessionBefore.json?.user?.email === ownerEmail, JSON.stringify(sessionBefore.json));

    const newPassword = "password-nuevo-456";
    const reset = await stranger(tenantHost, "/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ newPassword, token }),
    });
    ok("cambia la contraseña con el token (200)", reset.res.status === 200 && reset.json?.status === true, JSON.stringify(reset.json));
    const reused = await stranger(tenantHost, "/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ newPassword: "otra-password-789", token }),
    });
    ok("el mismo enlace no sirve dos veces (INVALID_TOKEN)", reused.res.status === 400 && reused.json?.code === "INVALID_TOKEN", JSON.stringify(reused.json));

    const oldLogin = await client()(tenantHost, "/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: ownerEmail, password: "password-e2e-123" }) });
    ok("la contraseña vieja ya no entra (401)", oldLogin.res.status === 401, String(oldLogin.res.status));
    const fresh = client();
    const newLogin = await fresh(tenantHost, "/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: ownerEmail, password: newPassword }) });
    ok("la nueva entra en el subdominio del negocio (200)", newLogin.res.status === 200, `${newLogin.res.status} ${JSON.stringify(newLogin.json)}`);
    const forwarded = await fresh(APP_HOST, "/api/saas/tenant");
    ok("y el login lo reenvía a su negocio", forwarded.json?.url ? new URL(forwarded.json.url).hostname === tenantHost.split(":")[0] : false, JSON.stringify(forwarded.json));
    const sessionAfter = await owner(tenantHost, "/api/auth/get-session");
    ok("la sesión que tenía abierta se cerró", !sessionAfter.json?.user, JSON.stringify(sessionAfter.json));

    await requestReset(stranger, tenantHost, ownerEmail);
    const stale = await tokenFor(ownerEmail);
    await sql`update verification set expires_at = now() - interval '1 minute' where identifier = ${`reset-password:${stale}`}`;
    const expiredLink = await stranger(tenantHost, `/api/auth/reset-password/${stale}?callbackURL=%2Freset-password`);
    ok("un enlace vencido lleva a error=INVALID_TOKEN", (expiredLink.res.headers.get("location") ?? "").includes("error=INVALID_TOKEN"), expiredLink.res.headers.get("location") ?? "");
  }

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
