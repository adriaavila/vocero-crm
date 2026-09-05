/** Visual/service acceptance checks. Run after e2e-selftest.mjs. */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const ownerEmail = "e2e@vocero.test";
const ownerPassword = "password-e2e-123";
/**
 * Correo NUEVO en cada corrida. El guion termina cambiándole la contraseña al
 * miembro, así que con un correo fijo la segunda corrida arranca desde un
 * estado distinto al que asume y falla sola — un test que solo pasa la
 * primera vez no es un test.
 */
const runId = Math.random().toString(36).slice(2, 8);
const memberEmail = `member-e2e-${runId}@vocero.test`;
const memberPassword = "member-e2e-old-123";
let failures = 0;

function check(name, condition) {
  console.log(`  ${condition ? "OK" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

async function signIn(request, email, password) {
  return request.post(`${base}/api/auth/sign-in/email`, {
    headers: { origin: base },
    data: { email, password },
  });
}

await mkdir(".tmp/e2e-service", { recursive: true });
const browser = await chromium.launch();

try {
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  check("login de propietario", (await signIn(owner.request, ownerEmail, ownerPassword)).ok());
  const page = await owner.newPage();


  await page.goto(`${base}/overview`);
  await page.getByRole("heading", { name: "Panel operativo" }).waitFor();
  check("propietario aterriza en Inicio", page.url().includes("/overview"));
  check("checklist de puesta en marcha visible", await page.getByText("Puesta en marcha", { exact: true }).isVisible());

  for (const [name, path] of [
    ["inicio", "/overview"],
    ["bandeja", "/inbox"],
    ["pipeline", "/pipeline"],
    ["agente", "/agent"],
    ["laboratorio", "/lab"],
    ["ajustes", "/settings/whatsapp"],
  ]) {
    await page.goto(`${base}${path}`);
    await settle(page);
    await page.screenshot({ path: `.tmp/e2e-service/${name}-1440.png`, fullPage: true });
  }

  /**
   * La responsividad de la bandeja y del Pipeline ya la conduce
   * `scripts/e2e-responsive.mjs`, que es de upstream y va al día con su
   * rediseño. Este guion se queda con lo que solo existe en el fork —
   * puesta en marcha, la advertencia al activar el agente y el ciclo de
   * acceso del equipo — en vez de mantener dos versiones de la misma
   * prueba, una de ellas apuntando a una interfaz que ya no existe.
   */

  await owner.request.put(`${base}/api/agent/profile`, { data: { enabled: false, greeting: "" } });
  await page.goto(`${base}/agent`);
  await page.getByRole("switch", { name: "Agente encendido" }).click();
  // El freno consulta /api/readiness antes de abrir: hay que esperarlo, no
  // preguntar en el mismo tick.
  const advertencia = page.getByRole("dialog");
  await advertencia.waitFor({ timeout: 10000 }).catch(() => {});
  check("activar incompleto abre advertencia", await advertencia.isVisible());
  await page.getByRole("button", { name: "Activar de todas formas" }).click();

  let members = (await (await owner.request.get(`${base}/api/settings/team`)).json()).members;
  let member = members.find((item) => item.email === memberEmail);
  if (!member) {
    await owner.request.post(`${base}/api/settings/team`, { data: { name: "Miembro E2E", email: memberEmail, password: memberPassword } });
    members = (await (await owner.request.get(`${base}/api/settings/team`)).json()).members;
    member = members.find((item) => item.email === memberEmail);
  }
  check("cuenta de miembro disponible", Boolean(member));
  if (!member) throw new Error("No se pudo crear la cuenta de miembro E2E");
  const reset = await owner.request.post(`${base}/api/settings/team/${member.id}/password-reset`);
  const temporaryPassword = (await reset.json()).temporaryPassword;
  check("propietario restablece acceso una vez", reset.ok() && temporaryPassword?.length === 16);

  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  check("contraseña anterior deja de funcionar", !(await signIn(memberContext.request, memberEmail, memberPassword)).ok());
  check("contraseña temporal funciona", (await signIn(memberContext.request, memberEmail, temporaryPassword)).ok());
  const memberPage = await memberContext.newPage();
  await memberPage.goto(`${base}/agent`);
  await memberPage.waitForURL("**/overview");
  check("miembro no abre superficies administrativas", memberPage.url().endsWith("/overview"));
  check("miembro no ve navegación administrativa", await memberPage.getByText("Laboratorio", { exact: true }).count() === 0);
  check("API administrativa devuelve 403 al miembro", (await memberContext.request.get(`${base}/api/agent/profile`)).status() === 403);
  check("miembro conserva lectura operativa", (await memberContext.request.get(`${base}/api/pipeline/stages`)).ok());

  await memberPage.goto(`${base}/account`);
  await memberPage.getByLabel("Contraseña actual").fill(temporaryPassword);
  await memberPage.getByLabel("Nueva contraseña").fill("member-e2e-final-123");
  await memberPage.getByLabel("Confirmar contraseña").fill("member-e2e-final-123");
  await memberPage.getByRole("button", { name: "Cambiar contraseña" }).click();
  await memberPage.getByText("Contraseña actualizada", { exact: false }).waitFor();
  check("miembro cambia su propia contraseña", true);

  await memberContext.close();
  await owner.close();
} finally {
  await browser.close();
}

console.log(`\n===== UI servicio: ${failures ? `${failures} fallos` : "todo OK"} =====`);
process.exit(failures ? 1 : 0);

/**
 * "networkidle" no sirve en esta app: la bandeja mantiene un SSE abierto
 * (`/api/events`) desde el shell, así que la red NUNCA queda inactiva y la
 * espera se agota a los 30 s. Se espera a que el documento cargue y se le da
 * un respiro al layout, que es lo que de verdad hace falta antes de una
 * captura.
 */
async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
}
