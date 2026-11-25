/**
 * Self-test E2E de comportamiento — la pantalla de conectar WhatsApp cuando
 * la ventana de Meta se cierra antes de «Finalizar», en un navegador de
 * verdad. Guion: tests/e2e/embedded-signup.md, sección de la ventana de Meta
 * cerrada antes de «Finalizar».
 *
 * En coexistencia, WhatsApp Business dice «conectado» apenas el dueño
 * confirma en el teléfono, pero el número solo nos llega cuando toca
 * «Finalizar» en la ventana de Meta. Quien la cerró ahí veía «Cerraste la
 * ventana de Meta» y la app le seguía pidiendo conectar. Este guion prueba que:
 *
 * - antes de abrir Meta, la pantalla avisa que hay que volver y tocar
 *   «Finalizar» (solo en coexistencia), y en un teléfono sugiere la
 *   computadora;
 * - al cerrarse sin código, dice cómo salir del número a medias y anota la
 *   cancelación con el modo correcto.
 *
 * El SDK de Meta es uno de mentira servido en la misma URL: su `FB.login`
 * devuelve sin código, como cuando se cierra la ventana. La anotación de la
 * cancelación se intercepta (se revisa lo que el navegador manda), así el
 * guion no toca el alta del negocio compartido con los demás guiones.
 *
 * Uso: node --env-file=.env scripts/e2e-conectar-whatsapp-ui.mjs
 * Requiere: app corriendo (pnpm dev) con META_APP_ID/META_ES_CONFIG_ID
 * configurados (como en verify.yml) y Playwright. Capturas en CAPTURAS_DIR
 * (por defecto scratch/conectar-whatsapp).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
// Instancia mono-organización fuera de SaaS: el primer usuario nace con el
// slug fijo "principal" (server/auth/on-signup.ts), igual que en e2e-embedded-signup.
const ORG_SLUG = "principal";
const SALIDA = process.env.CAPTURAS_DIR ?? "scratch/conectar-whatsapp";
const NUBE = Boolean(process.env.META_ES_CONFIG_ID_CLOUD_API?.trim());

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

// La ventana de Meta se cierra antes de «Finalizar»: FB.login vuelve sin código.
const SDK_DE_MENTIRA = `
  window.FB = {
    init: function () {},
    login: function (cb, opts) {
      window.__fbLogin = opts;
      setTimeout(function () { cb({ status: "unknown", authResponse: null }); }, 30);
    },
  };
  if (typeof window.fbAsyncInit === "function") window.fbAsyncInit();
`;

let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

// Playwright trae su Chromium; si en esta máquina no está, se usa el del sistema.
const candidatos = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
let browser;
try {
  browser = await chromium.launch();
} catch {
  const executablePath = candidatos.find((p) => existsSync(p));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
}
mkdirSync(SALIDA, { recursive: true });

/** Un contexto con el SDK de mentira y la anotación de la cancelación interceptada. */
async function contexto(opciones, eventos) {
  const ctx = await browser.newContext(opciones);
  ctx.setDefaultNavigationTimeout(120000);
  ctx.setDefaultTimeout(30000);
  await ctx.route("https://connect.facebook.net/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      // El puente pide el SDK con crossOrigin="anonymous".
      headers: { "access-control-allow-origin": "*" },
      body: SDK_DE_MENTIRA,
    })
  );
  await ctx.route("**/api/whatsapp/embedded-signup/event", async (route) => {
    eventos.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, errorKey: "cancelled" }) });
  });
  return ctx;
}

const GUIA = /síguela hasta «Finalizar»/;
const COMPU = /Mejor hazlo desde una computadora/;
const TITULO = "Falta terminar en la ventana de Meta";

let paso = "preparación";
let page = null;
try {
  const eventos = [];
  const ctx = await contexto({ viewport: DESKTOP }, eventos);

  console.log("== Setup: sesión del operador (comparte el negocio de e2e-selftest) ==");
  const req = ctx.request;
  let r = await req.post(`${BASE}/api/auth/sign-up/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
  });
  if (!r.ok())
    r = await req.post(`${BASE}/api/auth/sign-in/email`, {
      headers: { origin: BASE },
      data: { email: "e2e@vocero.test", password: "password-e2e-123" },
    });
  ok("login", r.ok());

  paso = "aviso antes de abrir Meta";
  console.log("\n== Antes de abrir Meta (coexistencia, computadora) ==");
  page = await ctx.newPage();
  await page.goto(`${BASE}/conectar-whatsapp?org=${ORG_SLUG}`);
  const boton = page.getByRole("button", { name: /Conectar WhatsApp|Reconectar/ });
  await boton.waitFor();
  ok("avisa que hay que volver a la ventana y tocar «Finalizar»", await page.getByText(GUIA).isVisible());
  ok("en una computadora no sugiere usar una computadora", (await page.getByText(COMPU).count()) === 0);
  await page.screenshot({ path: `${SALIDA}/1-antes-computadora.png`, fullPage: true });

  if (NUBE) {
    await page.getByRole("radio", { name: /Número nuevo/ }).click();
    await page.getByRole("button", { name: /Conectar WhatsApp|Reconectar/ }).waitFor();
    ok("con un número nuevo el aviso de WhatsApp Business no aparece", (await page.getByText(GUIA).count()) === 0);
    await page.getByRole("radio", { name: /Ya uso WhatsApp Business/ }).click();
    await page.getByText(GUIA).waitFor();
  }

  paso = "ventana cerrada sin «Finalizar»";
  console.log("\n== La ventana de Meta se cierra antes de «Finalizar» ==");
  await expectEnabled(page.getByRole("button", { name: /Conectar WhatsApp|Reconectar/ }));
  await page.getByRole("button", { name: /Conectar WhatsApp|Reconectar/ }).click();
  // El titular también va en la región viva para lectores de pantalla: se busca el visible.
  await page.locator("p", { hasText: TITULO }).waitFor();
  const cuerpo = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  ok("dice que falta tocar «Finalizar»", cuerpo.includes("Se cerró antes de tocar «Finalizar»"), cuerpo);
  ok("dice dónde desconectar en WhatsApp Business", cuerpo.includes("Ajustes > Cuenta > Plataforma empresarial"), cuerpo);
  const login = await page.evaluate(() => window.__fbLogin);
  ok("Meta se abrió en coexistencia", login?.extras?.featureType === "whatsapp_business_app_onboarding", JSON.stringify(login));
  await page.waitForTimeout(300);
  ok("anotó UNA cancelación", eventos.length === 1, JSON.stringify(eventos));
  ok(
    "la cancelación va con el modo y sin código de Meta",
    eventos[0]?.event === "CANCEL" && eventos[0]?.mode === "coexistence" && eventos[0]?.errorCode === undefined,
    JSON.stringify(eventos[0])
  );
  await page.screenshot({ path: `${SALIDA}/2-ventana-cerrada.png`, fullPage: true });

  paso = "reintentar";
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByText(GUIA).waitFor();
  ok("«Reintentar» vuelve a la pantalla con el aviso", await page.getByText(GUIA).isVisible());

  paso = "teléfono";
  console.log("\n== En un teléfono ==");
  const estado = await ctx.storageState();
  const ctxTel = await contexto(
    { viewport: PHONE, userAgent: IPHONE_UA, isMobile: true, hasTouch: true, storageState: estado },
    []
  );
  const tel = await ctxTel.newPage();
  await tel.goto(`${BASE}/conectar-whatsapp?org=${ORG_SLUG}`);
  await tel.getByText(GUIA).waitFor();
  ok("en un teléfono sugiere hacerlo desde una computadora", await tel.getByText(COMPU).isVisible());
  const desborde = await tel.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("sin desborde horizontal en el teléfono", desborde <= 0, `${desborde}px`);
  await tel.screenshot({ path: `${SALIDA}/3-antes-telefono.png`, fullPage: true });
  await ctxTel.close();
  await ctx.close();
} catch (err) {
  failures++;
  console.log(`  ✗ se cayó en «${paso}»: ${err?.message ?? err}`);
  if (page) await page.screenshot({ path: `${SALIDA}/fallo.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

/** El botón queda deshabilitado mientras carga el SDK. */
async function expectEnabled(locator) {
  for (let i = 0; i < 100; i++) {
    if (await locator.isEnabled()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("el botón nunca se habilitó (¿cargó el SDK?)");
}

console.log(failures === 0 ? "\nTODO VERDE" : `\nCON FALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
