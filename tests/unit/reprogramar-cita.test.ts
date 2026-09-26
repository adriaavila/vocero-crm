import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Reprogramar desde el cerebro externo (PATCH /api/bot/bookings, la
 * herramienta `reschedule_session` de Nea) frente a las citas del Laboratorio.
 *
 * La cita a mover se elige por contacto, y el contacto sintético de cada
 * persona se reutiliza entre corridas: las citas de prueba de corridas viejas
 * siguen `agendada` para siempre y, como no ocupan la agenda, a cada corrida se
 * le ofrecen los mismos huecos. Sin la regla de la conversación, una corrida
 * movía la cita de otra, `booking.next` seguía mostrando la suya con la hora
 * vieja y el agente se contradecía. Y una conversación real jamás debe mover
 * una cita de prueba.
 *
 * `pnpm test` corre sin base de datos: se captura el WHERE con el que se elige
 * la cita y se lee como SQL, igual que en proxima-cita.test.ts.
 */

const SLOT = "2026-08-05T16:00:00.000Z";

vi.mock("@/server/agenda/settings", () => ({
  getSettings: async () => ({ timezone: "America/Mexico_City" }),
}));

vi.mock("@/server/agenda/availability", () => ({
  findSlot: async () => ({ startUtc: SLOT, endUtc: "…", label: "mié 5 ago, 10:00" }),
}));

vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: async () => [{ startUtc: SLOT, label: "mié 5 ago, 10:00" }],
    clearOffers: async () => {},
  };
});

/** Filas de cada `select`, en orden: la conversación, la cita a mover y su relectura. */
const selectRows: unknown[][] = [];
/** El WHERE de cada `select`, en el mismo orden. */
const wheres: SQL[] = [];
let cita: Record<string, unknown> = {};

function select() {
  const rows = selectRows.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "orderBy"]) chain[k] = () => chain;
  chain.where = (condition: SQL) => {
    wheres.push(condition);
    return chain;
  };
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => select(),
      update: () => ({
        set: (v: object) => ({
          where: () => ({ returning: async () => [{ ...cita, ...v }] }),
        }),
      }),
    }),
  };
});

import { rescheduleForConversation } from "@/server/agenda/service";

function prepara(conv: { contactId: string; isTest: boolean }) {
  cita = {
    id: "bk_1",
    organizationId: "org_1",
    status: "agendada",
    scheduledAt: new Date("2026-08-05T15:00:00.000Z"),
    durationMinutes: 30,
    isTest: conv.isTest,
    connector: "enlace-fijo",
    externalRef: null,
    meetingLink: null,
    linkPending: false,
  };
  selectRows.push([conv], [cita], [cita]);
}

/** El WHERE que eligió la cita a mover, con los parámetros en su sitio. */
function sqlDeLaCitaElegida(): string {
  const { sql, params } = new PgDialect().sqlToQuery(wheres[1]!);
  return sql.replace(/\$(\d+)/g, (_, n: string) => {
    const p = params[Number(n) - 1];
    return typeof p === "string" ? `'${p}'` : String(p);
  });
}

function veces(texto: string, trozo: string): number {
  return texto.split(trozo).length - 1;
}

describe("rescheduleForConversation: qué cita se mueve", () => {
  beforeEach(() => {
    selectRows.length = 0;
    wheres.length = 0;
  });

  it("una conversación real jamás mueve una cita de prueba", async () => {
    prepara({ contactId: "ct_1", isTest: false });
    await rescheduleForConversation({
      organizationId: "org_1",
      conversationId: "cv_real",
      startUtc: SLOT,
    });
    const sql = sqlDeLaCitaElegida();

    expect(sql).toContain(`"booking"."contact_id" = 'ct_1'`);
    expect(sql).toContain(`"booking"."is_test" = false`);
    expect(sql).not.toContain(`"booking"."conversation_id"`);
  });

  it("una del Laboratorio mueve SU cita, no la de otra corrida del mismo contacto", async () => {
    prepara({ contactId: "ct_lab", isTest: true });
    await rescheduleForConversation({
      organizationId: "org_1",
      conversationId: "cv_lab",
      startUtc: SLOT,
    });
    const sql = sqlDeLaCitaElegida();

    expect(sql).toContain(`"booking"."contact_id" = 'ct_lab'`);
    // La misma regla que `booking.next` (proxima-cita.test.ts): si el agente
    // moviera otra cita que la que lee, al turno siguiente vería la hora vieja.
    expect(sql).toContain(
      `("booking"."is_test" = false or "booking"."conversation_id" = 'cv_lab')`
    );
    expect(veces(sql, `"booking"."is_test"`)).toBe(1);
  });
});
