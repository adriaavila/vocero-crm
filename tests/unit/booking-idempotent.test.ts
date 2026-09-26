import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dispatch v2 — bookings idempotentes por llave natural, SIN migración: un
 * reintento del mismo turno (la respuesta a Nea se perdió, pero la reserva ya
 * se había hecho) no debe fallar con `slot_not_offered` solo porque la
 * primera reserva ya limpió la oferta de la conversación. Se detecta por
 * (conversación, `startUtc`, `agendada`) y se devuelve la cita existente tal
 * cual, sin volver a llamar al conector ni a la validación de oferta.
 */

const settings = {
  weeklyHours: { wed: [{ start: "09:00", end: "18:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "enlace-fijo" as const,
  meetingLink: "https://meet.ejemplo.com/sala",
};

const SLOT = "2026-08-05T15:00:00.000Z";

const createMeeting = vi.fn(async () => ({ externalId: null, joinUrl: settings.meetingLink }));
const updateMeeting = vi.fn(async () => {});
const bindConnector = vi.fn(async () => ({
  id: "enlace-fijo",
  createMeeting,
  updateMeeting,
  deleteMeeting: async () => {},
  testConnection: async () => ({ ok: true }),
}));
const findSlot = vi.fn(async () => ({ startUtc: SLOT, endUtc: "…", label: "mié 5 ago, 09:00" }));
const getOffers = vi.fn(async () => [{ startUtc: SLOT, label: "mié 5 ago, 09:00" }]);
const clearOffers = vi.fn(async () => {});
const replaceOffers = vi.fn(async () => {});

vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => settings }));
vi.mock("@/server/agenda/availability", () => ({
  findSlot: (...args: unknown[]) => findSlot(...(args as [])),
  computeAvailability: async () => [],
}));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: (...args: unknown[]) => getOffers(...(args as [])),
    replaceOffers,
    clearOffers,
  };
});
vi.mock("@/server/agenda/connectors", () => ({
  bindConnector,
  markConnectorAuthError: async () => {},
}));
vi.mock("@/server/leads/stage-history", () => ({ moveLeadToStage: async () => ({ ok: true }) }));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));

const selectRows: unknown[][] = [];
const inserted: unknown[] = [];

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin", "innerJoin", "limit"]) {
    c[m] = () => c;
  }
  // Terminal: awaiting the chain directly resolves to `rows` (como el driver
  // real de drizzle, que es "thenable" sin necesitar un `.limit()` final).
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return c;
}

/** La fila "actual" que un UPDATE().returning() debe reflejar — la pone al
 * día tanto un INSERT recién hecho como el test, cuando arranca de una fila
 * ya existente (reprogramar) en vez de crear una nueva. */
let currentRow: Record<string, unknown> = {};
/** Item 6: simula la violación única del índice de horario en el INSERT. */
let nextInsertViolatesUnique = false;

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectRows.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          if (nextInsertViolatesUnique) {
            nextInsertViolatesUnique = false;
            const err = new Error("duplicate key value violates unique constraint") as Error & {
              code: string;
            };
            err.code = "23505";
            throw err;
          }
          inserted.push(v);
          currentRow = { ...v, scheduledAt: new Date(SLOT), externalRef: null, linkPending: false };
          return Promise.resolve([currentRow]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            currentRow = { ...currentRow, ...v };
            return Promise.resolve([currentRow]);
          },
        }),
      }),
    }),
  }),
  schema: {
    booking: {},
    conversation: { organizationId: "organizationId", id: "id" },
    contact: { organizationId: "organizationId", id: "id", name: "name" },
    lead: { organizationId: "organizationId", contactId: "contactId" },
    pipelineStage: { organizationId: "organizationId" },
    offeredSlot: {},
  },
}));

const EXISTENTE = {
  id: "bk_existente",
  organizationId: "org_1",
  kind: "session" as const,
  status: "agendada" as const,
  source: "ai" as const,
  contactId: "ct_1",
  conversationId: "cv_1",
  scheduledAt: new Date(SLOT),
  durationMinutes: 30,
  connector: "enlace-fijo",
  externalRef: null,
  meetingLink: settings.meetingLink,
  linkPending: false,
  isTest: false,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("bookings idempotentes por llave natural (dispatch v2)", () => {
  beforeEach(() => {
    selectRows.length = 0;
    inserted.length = 0;
    currentRow = {};
    nextInsertViolatesUnique = false;
    createMeeting.mockClear();
    updateMeeting.mockClear();
    bindConnector.mockClear();
    findSlot.mockClear();
    getOffers.mockClear();
    clearOffers.mockClear();
    replaceOffers.mockClear();
  });

  describe("POST (createSessionBooking)", () => {
    it("ya existe una cita agendada en esa conversación para ese instante → la devuelve (201), sin insertar ni validar la oferta", async () => {
      const { createSessionBooking } = await import("@/server/agenda/service");
      selectRows.push([EXISTENTE]); // idempotencia: hay una coincidencia exacta

      const result = await createSessionBooking({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
        source: "ai",
        requireOffer: true,
      });

      expect(result.booking.id).toBe("bk_existente");
      expect(result.meetingLink).toBe(settings.meetingLink);
      expect(inserted).toHaveLength(0);
      // No hizo falta la oferta: la cita ya existía de un intento anterior.
      expect(getOffers).not.toHaveBeenCalled();
      expect(bindConnector).not.toHaveBeenCalled();
      expect(createMeeting).not.toHaveBeenCalled();
    });

    it("una cita agendada existente A OTRA HORA no dispara el atajo (sigue el camino normal)", async () => {
      const { createSessionBooking } = await import("@/server/agenda/service");
      const otraHora = { ...EXISTENTE, scheduledAt: new Date("2026-08-05T16:00:00.000Z") };
      selectRows.push([otraHora]); // idempotencia: no coincide el instante
      selectRows.push([{ contactId: "ct_1", isTest: false }]); // la conversación
      selectRows.push([{ name: "Ana" }]); // el contacto
      selectRows.push([]); // sin lead

      const result = await createSessionBooking({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
        source: "ai",
        requireOffer: true,
      });

      expect(getOffers).toHaveBeenCalledOnce();
      expect(inserted).toHaveLength(1);
      expect(result.booking.id).not.toBe("bk_existente");
    });

    it("item 6: el insert choca con una violación única, pero el ganador de la carrera fue el MISMO reintento → devuelve esa cita en vez de slot_taken", async () => {
      const { createSessionBooking } = await import("@/server/agenda/service");
      selectRows.push([]); // idempotencia de ENTRADA: todavía no hay coincidencia
      selectRows.push([{ contactId: "ct_1", isTest: false }]); // la conversación
      selectRows.push([{ name: "Ana" }]); // el contacto
      selectRows.push([]); // sin lead
      nextInsertViolatesUnique = true; // otro proceso ganó la carrera del insert justo antes
      selectRows.push([EXISTENTE]); // re-chequeo por llave natural DENTRO del catch: SÍ hay coincidencia ahora

      const result = await createSessionBooking({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
        source: "ai",
        requireOffer: true,
      });

      expect(result.booking.id).toBe("bk_existente");
      expect(inserted).toHaveLength(0); // nunca se completó un insert propio
    });

    it("item 6: violación única SIN que la llave natural coincida (una carrera de verdad) → sigue devolviendo slot_taken", async () => {
      const { createSessionBooking, BookingError } = await import("@/server/agenda/service");
      selectRows.push([]); // idempotencia de ENTRADA
      selectRows.push([{ contactId: "ct_1", isTest: false }]); // la conversación
      selectRows.push([{ name: "Ana" }]); // el contacto
      selectRows.push([]); // sin lead
      nextInsertViolatesUnique = true;
      selectRows.push([]); // re-chequeo DENTRO del catch: nadie de ESTE turno lo ganó

      await expect(
        createSessionBooking({
          organizationId: "org_1",
          conversationId: "cv_1",
          startUtc: SLOT,
          source: "ai",
          requireOffer: true,
        })
      ).rejects.toMatchObject({ code: "slot_taken" } satisfies Partial<InstanceType<typeof BookingError>>);
    });

    it("sin conversationId (camino manual con contactId) no consulta idempotencia", async () => {
      const { createSessionBooking } = await import("@/server/agenda/service");
      selectRows.push([{ name: "Ana" }]); // el contacto (sin conversación que resolver)
      selectRows.push([]); // sin lead

      await createSessionBooking({
        organizationId: "org_1",
        contactId: "ct_1",
        startUtc: SLOT,
        source: "manual",
        requireOffer: false,
      });

      expect(inserted).toHaveLength(1);
    });
  });

  describe("PATCH (rescheduleForConversation)", () => {
    it("la próxima cita activa YA está en ese instante → la devuelve (200), sin mover nada ni exigir oferta", async () => {
      const { rescheduleForConversation } = await import("@/server/agenda/service");
      selectRows.push([{ contactId: "ct_1" }]); // la conversación
      selectRows.push([EXISTENTE]); // próxima cita activa, ya en ese instante

      const result = await rescheduleForConversation({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
      });

      expect(result.booking.id).toBe("bk_existente");
      expect(getOffers).not.toHaveBeenCalled();
      expect(findSlot).not.toHaveBeenCalled();
      expect(clearOffers).not.toHaveBeenCalled();
    });

    it("la próxima cita activa está en OTRO instante → sigue el camino normal (exige oferta y mueve)", async () => {
      const { rescheduleForConversation } = await import("@/server/agenda/service");
      const otraHora = { ...EXISTENTE, scheduledAt: new Date("2026-08-05T16:00:00.000Z") };
      currentRow = otraHora; // la fila que el UPDATE de rescheduleBooking va a tocar
      selectRows.push([{ contactId: "ct_1" }]); // la conversación
      selectRows.push([otraHora]); // próxima cita activa, a otra hora
      selectRows.push([otraHora]); // getOwnBooking (rescheduleBooking)

      const result = await rescheduleForConversation({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
      });

      expect(getOffers).toHaveBeenCalledOnce();
      expect(findSlot).toHaveBeenCalledOnce();
      expect(clearOffers).toHaveBeenCalledOnce();
      expect(result.booking.scheduledAt.toISOString()).toBe(new Date(SLOT).toISOString());
    });

    it("item 7: hay DOS citas activas — una más temprana sin relación, y la que este reintento movió ya está en el instante pedido → la devuelve, sin tocar la otra", async () => {
      const { rescheduleForConversation } = await import("@/server/agenda/service");
      const otraCitaMasTemprana = {
        ...EXISTENTE,
        id: "bk_otra_sin_relacion",
        scheduledAt: new Date("2026-08-05T13:00:00.000Z"), // antes que SLOT — sería rows[0]
      };
      const yaMovida = { ...EXISTENTE, id: "bk_ya_movida", scheduledAt: new Date(SLOT) };
      selectRows.push([{ contactId: "ct_1" }]); // la conversación
      // orden ascendente real: la más temprana primero — SI el código solo
      // mirara rows[0] (la convención anterior), compararía la temprana
      // contra SLOT, no encontraría coincidencia, e intentaría mover la
      // equivocada.
      selectRows.push([otraCitaMasTemprana, yaMovida]);

      const result = await rescheduleForConversation({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
      });

      expect(result.booking.id).toBe("bk_ya_movida");
      expect(getOffers).not.toHaveBeenCalled();
      expect(findSlot).not.toHaveBeenCalled();
      expect(clearOffers).not.toHaveBeenCalled();
    });

    it("sin cita activa y sin oferta → sigue rechazando con slot_not_offered (comportamiento previo intacto)", async () => {
      const { rescheduleForConversation, BookingError } = await import("@/server/agenda/service");
      getOffers.mockResolvedValueOnce([]);
      selectRows.push([{ contactId: "ct_1" }]); // la conversación
      selectRows.push([]); // sin cita activa

      await expect(
        rescheduleForConversation({
          organizationId: "org_1",
          conversationId: "cv_1",
          startUtc: SLOT,
        })
      ).rejects.toBeInstanceOf(BookingError);
    });
  });
});
