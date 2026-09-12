import { chromium } from "playwright";

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
}

const failed = checks.filter((value) => !value).length;
console.log(`\n===== SaaS isolation: ${checks.length - failed}/${checks.length} checks OK =====`);
process.exitCode = failed ? 1 : 0;
