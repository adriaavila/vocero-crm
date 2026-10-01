import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fork — Embedded Signup en la app: un mensaje importado por `history`
 * (origin: "history") NUNCA debe hacer que `worker.ts` reprograme un turno
 * de agente, aunque su `createdAt` cayera dentro de la ventana de
 * `claimedAt` (ver `server/agencia/whatsapp-signup/history-sync.ts`).
 *
 * El harness de mocks existente para `worker.ts`
 * (tests/unit/worker-*.test.ts) mockea `getDb()` con un `select` que IGNORA
 * el contenido real de `.where(...)` — siempre devuelve lo que el test puso
 * en la cola, sin filtrar por columna. Eso hace imposible probar el filtro
 * de verdad sin una base de datos real (fuera del alcance de un unit test).
 * Esta prueba es la guardia mínima honesta: confirma que la exclusión sigue
 * en el código fuente, para que no desaparezca en un refactor sin que algo
 * falle. La cobertura de comportamiento real vive en
 * `scripts/e2e-embedded-signup.mjs` + el guion manual (`tests/e2e/`).
 */
describe("worker.ts — exclusión de mensajes importados del chequeo de reprogramación", () => {
  it("el WHERE de freshInbound excluye origin = 'history'", () => {
    const source = readFileSync(
      new URL("../../src/server/ai/worker.ts", import.meta.url),
      "utf8"
    );
    const freshInboundBlock = source.slice(source.indexOf("const freshInbound"));
    expect(freshInboundBlock).toMatch(/ne\(\s*schema\.message\.origin,\s*"history"\s*\)/);
  });
});
