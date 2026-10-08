// Corre todos los guiones E2E (`scripts/e2e-*.mjs`): primero el selftest, que
// registra la organización y conecta WhatsApp (si falla, para ahí), y después
// el resto en orden alfabético. Sale distinto de cero si alguno falla.
//
// `next dev` se reinicia solo cuando su memoria pasa del 80% del límite («Server
// is approaching the used memory threshold, restarting...»), y tira lo que
// estaba en vuelo; y al volver, cada pantalla se compila de nuevo y tarda más
// que la espera de los guiones. Las dos cosas se leen como un fallo del
// producto. Por eso, antes de cada guion se espera a que la app conteste, y un
// guion que falló con un reinicio reciente (durante él o durante el anterior)
// se corre una vez más, ya con las rutas compiladas. Para saberlo hace falta el
// log del servidor (`E2E_NEXT_LOG`); sin él no se repite nada.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const LOG = process.env.E2E_NEXT_LOG;
const REINICIO = "approaching the used memory threshold";

function reinicios() {
  if (!LOG || !existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8").split(REINICIO).length - 1;
}

async function esperarApp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`la app no contesta en ${BASE}/api/health`);
}

function correr(f) {
  const args = existsSync(".env") ? ["--env-file=.env", f] : [f];
  return spawnSync(process.execPath, args, { stdio: "inherit" }).status === 0;
}

// Reinicios contados al empezar el guion anterior.
let desde = 0;

async function guion(f) {
  console.log(`== ${f}`);
  await esperarApp();
  const antes = desde;
  desde = reinicios();
  if (correr(f)) return true;
  if (reinicios() === antes) return false;
  console.log(`== ${f}: el servidor de desarrollo se reinició hace poco; se repite una vez`);
  await esperarApp();
  return correr(f);
}

const resto = readdirSync("scripts")
  .filter((f) => /^e2e-.*\.mjs$/.test(f) && f !== "e2e-selftest.mjs")
  .sort()
  .map((f) => `scripts/${f}`);

if (!(await guion("scripts/e2e-selftest.mjs"))) process.exit(1);
const fallaron = [];
for (const f of resto) if (!(await guion(f))) fallaron.push(f);
if (LOG) console.log(`\nReinicios de next dev por memoria: ${reinicios()}`);
if (fallaron.length) {
  console.log(`\nFallaron: ${fallaron.join(", ")}`);
  process.exit(1);
}
