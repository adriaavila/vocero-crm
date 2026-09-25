import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * `booking.next` de `/api/bot/context` frente a las citas del Laboratorio.
 *
 * El Laboratorio agenda de verdad (cita `is_test`). Si su conversación no ve
 * esa cita, al turno siguiente el agente cree que no agendó nada, la vuelve a
 * ofrecer, y el juez le baja la nota por un fallo del contexto. Al revés, una
 * conversación real que viera citas de prueba le hablaría al cliente de una
 * cita que no existe.
 *
 * `pnpm test` corre sin base de datos: se captura el WHERE que arma
 * `proximaCita` y se lee como SQL, igual que en tenant.test.ts.
 */

let where: SQL | undefined;

/** Cadena `select().from().where().orderBy().limit()` que guarda el WHERE. */
function query() {
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "orderBy", "limit"]) chain[k] = () => chain;
  chain.where = (condition: SQL) => {
    where = condition;
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown) => resolve([]);
  return chain;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => ({ select: () => query() }) };
});

import { proximaCita } from "@/server/agencia/bot-perfil";

/** El WHERE con los parámetros en su sitio, para leerlo como SQL. */
function sqlDelWhere(): string {
  const { sql, params } = new PgDialect().sqlToQuery(where!);
  return sql.replace(/\$(\d+)/g, (_, n: string) => {
    const p = params[Number(n) - 1];
    return typeof p === "string" ? `'${p}'` : String(p);
  });
}

function veces(texto: string, trozo: string): number {
  return texto.split(trozo).length - 1;
}

describe("proximaCita: citas de prueba según la conversación", () => {
  beforeEach(() => {
    // CI corre también con la agenda apagada, y ahí no hay query que leer.
    vi.stubEnv("AGENDA", "on");
    where = undefined;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("una conversación real sigue sin ver citas de prueba", async () => {
    await proximaCita("org_1", {
      id: "cv_real",
      contactId: "ct_1",
      isTest: false,
    });
    const sql = sqlDelWhere();

    expect(sql).toContain(`"booking"."contact_id" = 'ct_1'`);
    expect(sql).toContain(`"booking"."is_test" = false`);
    // Sin excepción por conversación: ninguna cita de prueba se cuela.
    expect(sql).not.toContain(`"booking"."conversation_id"`);
  });

  it("una del Laboratorio ve además las SUYAS, no las de otras corridas", async () => {
    await proximaCita("org_1", {
      id: "cv_lab",
      contactId: "ct_lab",
      isTest: true,
    });
    const sql = sqlDelWhere();

    expect(sql).toContain(`"booking"."contact_id" = 'ct_lab'`);
    // El contacto sintético se reutiliza entre corridas: la llave es la
    // conversación, no el contacto.
    expect(sql).toContain(
      `("booking"."is_test" = false or "booking"."conversation_id" = 'cv_lab')`
    );
    // Y el filtro viejo no sigue puesto aparte: con `is_test = false` en AND,
    // el OR no dejaría pasar nada.
    expect(veces(sql, `"booking"."is_test"`)).toBe(1);
  });
});
