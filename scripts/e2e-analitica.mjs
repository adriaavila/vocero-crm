/**
 * Self-test E2E de comportamiento — Analítica
 * (guion tests/e2e/analitica.md).
 *
 * Capa de agencia (`src/server/agencia/analitica.ts` + `/analytics`): cierra
 * un trato ganado y uno perdido por el camino real del producto (mover la
 * tarjeta del pipeline, igual que haría el dueño) y comprueba que la pantalla
 * de analítica cuadra con lo que se acaba de crear. Re-ejecutable: cada
 * corrida usa contactos con un sufijo aleatorio, así que no colisiona con la
 * anterior ni infla los totales de ventanas previas de forma que rompa la
 * aserción (se compara contra lo recién creado, no contra un total absoluto).
 *
 * Uso: node --env-file=.env scripts/e2e-analitica.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const S = Math.random().toString(36).slice(2, 8).toUpperCase();

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

/** La pantalla es un Server Component: se comprueba sobre el HTML que sirve. */
async function paginaAnalitica(rango) {
  const res = await fetch(`${BASE}/analytics?rango=${rango}`, {
    headers: { cookie },
  });
  const html = await res.text();
  return { res, html };
}

/**
 * El total de "Ingreso ganado" en dólares, leído del HTML. Es una instancia
 * mono-organización COMPARTIDA con el resto de la suite (`e2e-selftest.mjs`
 * ya cierra un trato propio en 016): nunca se compara contra un total
 * absoluto, solo contra el ANTES/DESPUÉS de esta corrida.
 */
function ingresoGanadoDe(html) {
  const m = html.match(/Ingreso ganado<\/h3><\/div><div[^>]*><div[^>]*><span[^>]*>\$([\d,]+\.\d{2})/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ""));
}

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

const { json: board } = await api("/api/pipeline/board");
const stageWon = board?.stages?.find((s) => s.kind === "won");
const stageLost = board?.stages?.find((s) => s.kind === "lost");
ok("el tablero trae una etapa ganada y una perdida", Boolean(stageWon && stageLost));

const { html: htmlAntes } = await paginaAnalitica(7);
const ingresoAntes = ingresoGanadoDe(htmlAntes);
ok("se puede leer el ingreso ganado ANTES de esta corrida", ingresoAntes !== null);

console.log("\n== Cerrar un trato GANADO por el camino real ==");
const altaGanado = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Analitica Ganado ${S}`,
    phone: `52156100${Math.floor(1000 + Math.random() * 8999)}`,
  }),
});
const leadGanadoId = altaGanado.json?.lead?.id;
ok("lead de prueba (ganado) creado", Boolean(leadGanadoId));

const moverGanado = await api(`/api/pipeline/leads/${leadGanadoId}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: stageWon.id, amountCents: 250000 }),
});
ok("se mueve a la etapa ganada con monto", moverGanado.res.ok, JSON.stringify(moverGanado.json));

console.log("\n== Cerrar un trato PERDIDO por el camino real ==");
const altaPerdido = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Analitica Perdido ${S}`,
    phone: `52156200${Math.floor(1000 + Math.random() * 8999)}`,
  }),
});
const leadPerdidoId = altaPerdido.json?.lead?.id;
ok("lead de prueba (perdido) creado", Boolean(leadPerdidoId));

// Sin motivo: la puerta del dominio lo rechaza (regla ya probada en otro
// guion; aquí solo se confirma que analítica no puede sortearla por detrás).
const sinMotivo = await api(`/api/pipeline/leads/${leadPerdidoId}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: stageLost.id }),
});
ok(
  "perder sin motivo se rechaza (422)",
  sinMotivo.res.status === 422,
  String(sinMotivo.res.status)
);

const moverPerdido = await api(`/api/pipeline/leads/${leadPerdidoId}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: stageLost.id, lossReason: "precio" }),
});
ok("se mueve a la etapa perdida con motivo", moverPerdido.res.ok);

console.log("\n== La pantalla de analítica ve lo que se acaba de cerrar ==");
const { res: res7, html: html7 } = await paginaAnalitica(7);
ok("GET /analytics?rango=7 → 200", res7.status === 200, String(res7.status));
const ingresoDespues = ingresoGanadoDe(html7);
ok(
  "el ingreso ganado sube EXACTAMENTE los $2,500.00 recién capturados",
  ingresoAntes !== null &&
    ingresoDespues !== null &&
    Math.abs(ingresoDespues - ingresoAntes - 2500) < 0.001,
  `antes=${ingresoAntes} después=${ingresoDespues}`
);
ok(
  "el motivo de pérdida capturado aparece en la lista",
  html7.includes("Precio"),
  "no aparece el motivo 'Precio'"
);

console.log("\n== Los otros rangos no truenan y traen la comparativa ==");
for (const rango of [30, 90]) {
  const { res } = await paginaAnalitica(rango);
  ok(`GET /analytics?rango=${rango} → 200`, res.status === 200, String(res.status));
}

console.log("\n== Sin sesión, no se filtran datos de la organización ==");
const sinCookie = await fetch(`${BASE}/analytics`, { redirect: "follow" });
const bodySinCookie = await sinCookie.text();
ok(
  "sin sesión termina en el login, no en la analítica",
  sinCookie.url.includes("/login") || bodySinCookie.includes("Iniciar sesión"),
  sinCookie.url
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
process.exit(failures === 0 ? 0 : 1);
