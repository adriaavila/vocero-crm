import { chromium } from "playwright";
import postgres from "postgres";
// Crea sus negocios por el registro público: en modo SaaS eso sólo pasa con
// WA_MOCK_ENABLED=true en `next dev` (el autoservicio está apagado).

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const port = new URL(base).port;
const host = (subdomain) => `${subdomain}.localhost${port ? `:${port}` : ""}`;
const headers = (forwardedHost, ip = "203.0.113.10") => ({
  origin: base,
  "x-forwarded-host": forwardedHost,
  "x-forwarded-proto": "http",
  "x-forwarded-for": ip,
});

const checks = [];
function check(label, condition) {
  checks.push(condition);
  console.log(`  ${condition ? "OK" : "FAIL"}  ${label}`);
}

async function json(response) {
  return response.json().catch(() => null);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Igual que en los demás guiones: espera a que algo ocurra en vez de dormir a ciegas. */
async function hasta(cond, ms = 20000, paso = 500) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

/**
 * Solo para lo que un webhook no puede fabricar: conceder un plan (aquí, no
 * hay Stripe de mentiras que lo confirme). Mismo trato que
 * scripts/e2e-resultados.mjs para lo suyo.
 */
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const browser = await chromium.launch();
try {
  const alpha = await browser.newContext();
  const beta = await browser.newContext();
  const password = "password-e2e-123";

  for (const [context, email, name, ip] of [
    [alpha, "alpha-saas-e2e@vocero.test", "Negocio Alfa", "203.0.113.11"],
    [beta, "beta-saas-e2e@vocero.test", "Negocio Beta", "203.0.113.12"],
  ]) {
    const response = await context.request.post(`${base}/api/auth/sign-up/email`, {
      headers: headers(host("app"), ip),
      data: { email, password, name },
    });
    const resumed = response.ok()
      ? true
      : (await context.request.post(`${base}/api/auth/sign-in/email`, {
          headers: headers(host("app"), ip),
          data: { email, password, rememberMe: true },
        })).ok();
    check(`${name} crea o reanuda su cuenta`, resumed);
  }

  const alphaTenant = await json(await alpha.request.get(`${base}/api/saas/tenant`, { headers: headers(host("app")) }));
  const betaTenant = await json(await beta.request.get(`${base}/api/saas/tenant`, { headers: headers(host("app")) }));
  const alphaHost = new URL(alphaTenant.url).host;
  const betaHost = new URL(betaTenant.url).host;
  check("cada cuenta recibe un subdominio distinto", alphaHost !== betaHost);

  const tenantSignup = await alpha.request.post(`${base}/api/auth/sign-up/email`, {
    headers: headers(alphaHost, "203.0.113.13"),
    data: { email: "blocked-tenant-signup@vocero.test", password, name: "No debe crearse" },
  });
  check("el registro público solo empieza en app", tenantSignup.status() === 403);

  const publicContext = await browser.newContext();
  const legacySignup = await publicContext.request.post(`${base}/api/auth/sign-up/email`, {
    headers: headers(host("crm"), "203.0.113.14"),
    data: { email: "blocked-legacy-signup@vocero.test", password, name: "No debe crearse" },
  });
  const legacySignupStatus = legacySignup.status();
  await publicContext.close();
  check("el host legacy no abre un segundo registro SaaS", legacySignupStatus === 403);

  for (const [context, tenantHost, name, accent] of [
    [alpha, alphaHost, "Alfa visible", "#169c72"],
    [beta, betaHost, "Beta visible", "#7657e8"],
  ]) {
    const response = await context.request.put(`${base}/api/settings/branding`, {
      headers: { ...headers(tenantHost), "content-type": "application/json" },
      data: { name, accent, currency: "USD" },
    });
    check(`${name} solo escribe en su organización`, response.ok());
  }

  const alphaBranding = await json(await alpha.request.get(`${base}/api/settings/branding`, { headers: headers(alphaHost) }));
  const betaBranding = await json(await beta.request.get(`${base}/api/settings/branding`, { headers: headers(betaHost) }));
  check("Alfa lee su propia marca", alphaBranding?.branding?.name === "Alfa visible");
  check("Beta lee su propia marca", betaBranding?.branding?.name === "Beta visible");

  const activation = await alpha.request.put(`${base}/api/agent/profile`, {
    headers: { ...headers(alphaHost), "content-type": "application/json" },
    data: { enabled: true },
  });
  check("Allok no activa automatización sin suscripción confirmada", activation.status() === 402);

  // Un número conectado sin plan igual consume la app de Meta de Allok, así que
  // las DOS puertas del alta —la guiada y el respaldo manual— piden pago.
  const guiada = await alpha.request.post(`${base}/api/saas/whatsapp/onboarding-link`, {
    headers: headers(alphaHost),
  });
  check("el alta guiada de WhatsApp pide plan activo", guiada.status() === 402);
  const manual = await alpha.request.put(`${base}/api/settings/whatsapp`, {
    headers: { ...headers(alphaHost), "content-type": "application/json" },
    data: { wabaId: "WABA-SIN-PLAN", phoneNumberId: "PN-SIN-PLAN", token: "token-sin-plan" },
  });
  check("el respaldo manual tampoco conecta sin plan", manual.status() === 402);
  const rescate = await alpha.request.post(`${base}/api/saas/whatsapp/retry-connection`, {
    headers: headers(alphaHost),
  });
  check("recuperar la conexión tampoco esquiva el plan", rescate.status() === 402);

  // 018/028 — El `source_id` de Meta no es del CRM: dos negocios sin ninguna
  // relación pueden compartir el mismo (o inventarlo igual en una prueba). La
  // fila y la imagen del creativo son de quien la capturó — nunca de la otra
  // organización, aunque las dos pidan la misma. Aquí sí hace falta un plan
  // activo (para conectar WhatsApp), así que se concede a mano — ningún
  // webhook de Stripe de mentiras lo va a confirmar.
  await sql`
    update organization
    set metadata = (coalesce(metadata::jsonb, '{}'::jsonb) || '{"allok":{"billing":{"status":"active"}}}'::jsonb)::text
    where name in ('Negocio Alfa', 'Negocio Beta')
  `;
  for (const [context, tenantHost, pn, wabaId] of [
    [alpha, alphaHost, "PN-ISO-ALFA", "WABA-ISO-ALFA"],
    [beta, betaHost, "PN-ISO-BETA", "WABA-ISO-BETA"],
  ]) {
    const conn = await context.request.put(`${base}/api/settings/whatsapp`, {
      headers: { ...headers(tenantHost), "content-type": "application/json" },
      data: { wabaId, phoneNumberId: pn, token: `token-${pn}` },
    });
    check(`${wabaId} conecta su WhatsApp para la prueba de aislamiento`, conn.ok());
  }

  const metaMockOrigin = process.env.META_GRAPH_BASE_URL
    ? new URL(process.env.META_GRAPH_BASE_URL).origin
    : base;
  const isoSourceId = "iso-shared-source-1";
  const isoReferral = {
    source_id: isoSourceId,
    source_type: "ad",
    headline: "Mismo anuncio, dos negocios",
    media_type: "image",
    // A PROPÓSITO la misma ruta de creativo para las dos: si `imagenExistente`
    // no filtrara por organización, la segunda encontraría (y reusaría) el
    // adjunto de la primera en vez de bajar el suyo.
    image_url: `${metaMockOrigin}/api/dev/wa-mock/media-file/iso-creativo-compartido`,
  };
  for (const [pn, from] of [
    ["PN-ISO-ALFA", "50000000001"],
    ["PN-ISO-BETA", "50000000002"],
  ]) {
    const inbound = await alpha.request.post(`${base}/api/dev/wa-mock/inbound`, {
      data: {
        phoneNumberId: pn,
        from,
        name: "Prospecto aislamiento",
        text: "Hola, vi su anuncio",
        waMessageId: `wamid.iso.${pn}`,
        referral: isoReferral,
      },
    });
    check(`el webhook acepta el inbound compartido (${pn})`, inbound.ok());
  }

  async function anuncioDe(context, tenantHost, phone) {
    let detalle = null;
    await hasta(async () => {
      const convs = await json(
        await context.request.get(`${base}/api/conversations`, { headers: headers(tenantHost) })
      );
      const conv = convs?.conversations?.find((c) => c.contact.phone === phone);
      if (!conv) return false;
      detalle = await json(
        await context.request.get(`${base}/api/contacts/${conv.contact.id}`, {
          headers: headers(tenantHost),
        })
      );
      return !!detalle?.anuncio?.imageAssetId;
    });
    return detalle?.anuncio ?? null;
  }
  const alphaAnuncio = await anuncioDe(alpha, alphaHost, "50000000001");
  const betaAnuncio = await anuncioDe(beta, betaHost, "50000000002");
  check(
    "las dos organizaciones capturan el mismo source_id",
    alphaAnuncio?.sourceId === isoSourceId && betaAnuncio?.sourceId === isoSourceId
  );
  check(
    "cada una bajó y guardó SU PROPIA imagen, no la de la otra",
    !!alphaAnuncio?.imageAssetId &&
      !!betaAnuncio?.imageAssetId &&
      alphaAnuncio.imageAssetId !== betaAnuncio.imageAssetId
  );
  const crossAssetFetch = await beta.request.get(`${base}/api/media/${alphaAnuncio?.imageAssetId}`, {
    headers: headers(betaHost),
    maxRedirects: 0,
  });
  check(
    "y Beta no puede pedir el adjunto de Alfa aunque sepa su id",
    crossAssetFetch.status() === 401 || crossAssetFetch.status() === 404
  );

  const crossTenant = await alpha.request.get(`${base}/api/overview`, {
    headers: headers(betaHost),
    maxRedirects: 0,
  });
  check("una sesión no puede leer el dashboard de otro tenant", crossTenant.status() === 401);

  const crossPage = await alpha.request.get(`${base}/inbox`, {
    headers: headers(betaHost),
    maxRedirects: 0,
  });
  check("una sesión no puede abrir la página de otro tenant", crossPage.status() === 404);

  const crossEvents = await alpha.request.get(`${base}/api/events`, {
    headers: headers(betaHost),
    maxRedirects: 0,
  });
  check("los eventos SSE respetan la membresía del tenant", crossEvents.status() === 401);

  const crossFile = await alpha.request.get(`${base}/api/media/asset_not_owned`, {
    headers: headers(betaHost),
    maxRedirects: 0,
  });
  check("la API de archivos no cruza tenants", crossFile.status() === 401);

  const crossBranding = await json(await alpha.request.get(`${base}/api/settings/branding`, { headers: headers(betaHost) }));
  check("la marca pública se resuelve por hostname, no por primera organización", crossBranding?.branding?.name === "Beta visible");

  const unknownTenant = await alpha.request.get(`${base}/login`, {
    headers: headers(host("missing-tenant")),
    maxRedirects: 0,
  });
  check("un tenant inexistente devuelve 404", unknownTenant.status() === 404);

  const ambiguousHost = await alpha.request.get(`${base}/login`, {
    headers: headers(`a.b.localhost${port ? `:${port}` : ""}`),
    maxRedirects: 0,
  });
  check("un host ambiguo devuelve 404", ambiguousHost.status() === 404);

  const unknownApi = await alpha.request.get(`${base}/api/overview`, {
    headers: headers(host("unknown-api")),
    maxRedirects: 0,
  });
  check("una API autenticada en un host desconocido devuelve 404", unknownApi.status() === 404);

  const unknownHealth = await alpha.request.get(`${base}/api/health`, {
    headers: headers(host("unknown-health")),
    maxRedirects: 0,
  });
  check("el healthcheck también rechaza un host desconocido", unknownHealth.status() === 404);

  const unknownAuth = await alpha.request.post(`${base}/api/auth/sign-in/email`, {
    headers: headers(host("unknown-auth"), "203.0.113.15"),
    data: { email: "nobody@vocero.test", password },
  });
  check("la autenticación también rechaza un host desconocido", unknownAuth.status() === 404);

  const legacy = await alpha.request.get(`${base}/overview`, {
    headers: headers(host("crm")),
    maxRedirects: 0,
  });
  check("el host legacy sigue accesible", legacy.status() === 200);
} finally {
  await browser.close();
  await sql.end();
}

const failed = checks.filter((value) => !value).length;
console.log(`\n===== SaaS isolation: ${checks.length - failed}/${checks.length} checks OK =====`);
process.exitCode = failed ? 1 : 0;
