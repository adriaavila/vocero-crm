import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `buildBotContext` (dispatch v2) — el constructor ÚNICO detrás de
 * `GET /api/bot/context` y del campo `context` del payload de despacho.
 *
 * Cubre lo que un revisor independiente señaló como riesgo: `booking.next`
 * (viene de `proximaCita`, SIN CAMBIOS) tiene que seguir presente para una
 * conversación real con una cita futura — Nea la usa para no volver a
 * ofrecer horarios a quien ya tiene una — y los dos campos nuevos
 * (`agentHasSpoken`, `adOrigen`).
 */

type ProximaCitaResult = {
  id: string;
  scheduledAtUtc: string;
  label: string;
  meetingLink: string | null;
} | null;

const { accesoDeAgencia, proximaCita, hasSaaSPlan } = vi.hoisted(() => ({
  accesoDeAgencia: vi.fn(async () => ({ allowlistEnabled: false, allowedWaIds: [] })),
  proximaCita: vi.fn(async (): Promise<ProximaCitaResult> => null),
  hasSaaSPlan: vi.fn(async () => true),
}));
vi.mock("@/server/agencia/bot-perfil", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agencia/bot-perfil")>();
  return { ...actual, accesoDeAgencia, proximaCita };
});
vi.mock("@/server/agencia/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agencia/entitlements")>();
  return { ...actual, hasSaaSPlan };
});

const selectQueue: unknown[][] = [];
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain(selectQueue.shift() ?? []) }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

import { buildBotContext } from "@/server/bot/context";

const CONV = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  aiEnabled: true,
  handoffAt: null as Date | null,
  handoffReason: null,
  lastInboundAt: new Date(),
  memoryResetAt: null as Date | null,
};
const CONTACT = {
  id: "ct_1",
  name: "Ana",
  waIdentity: "5215512345678",
  channel: "whatsapp",
  phone: "5215512345678",
  ficha: {},
};

/** Empuja las filas en el ORDEN exacto de `buildBotContext`: conv+contacto,
 * [lead+etapa si proEnabled], agentHasSpoken, adAttribution. */
function pushRows(opts: {
  leadStage?: unknown[];
  agentSpoken?: unknown[];
  adAttribution?: unknown[];
} = {}) {
  selectQueue.push([{ conversation: CONV, contact: CONTACT }]);
  if (opts.leadStage !== undefined) selectQueue.push(opts.leadStage);
  selectQueue.push(opts.agentSpoken ?? []);
  selectQueue.push(opts.adAttribution ?? []);
}

describe("buildBotContext", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    accesoDeAgencia.mockClear();
    proximaCita.mockReset().mockResolvedValue(null);
    hasSaaSPlan.mockReset().mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("conversación no encontrada → null", async () => {
    selectQueue.push([]);
    const result = await buildBotContext("org_1", "cv_missing");
    expect(result).toBeNull();
  });

  it("booking.next viene de proximaCita SIN CAMBIOS — presente para una conversación real con cita futura", async () => {
    const cita = {
      id: "bk_1",
      scheduledAtUtc: "2026-10-01T15:00:00.000Z",
      label: "jue 1 oct a las 09:00",
      meetingLink: "https://meet.ejemplo.com/x",
    };
    proximaCita.mockResolvedValue(cita);
    pushRows({ leadStage: [] }); // proEnabled=true (default del mock) → sí consulta lead+etapa

    const result = await buildBotContext("org_1", "cv_1");

    expect(proximaCita).toHaveBeenCalledWith("org_1", "ct_1");
    expect(result?.booking).toEqual({ next: cita });
  });

  it("sin plan Pro → no llama a proximaCita ni a la consulta de lead; booking.next es null", async () => {
    hasSaaSPlan.mockResolvedValue(false);
    pushRows(); // sin leadStage: no debería consultarse

    const result = await buildBotContext("org_1", "cv_1");

    expect(proximaCita).not.toHaveBeenCalled();
    expect(result?.booking).toEqual({ next: null });
    expect(result?.lead).toBeNull();
  });

  it("agentHasSpoken: true si hay un saliente `ai` no fallido", async () => {
    pushRows({ leadStage: [], agentSpoken: [{ id: "msg_1" }] });
    const result = await buildBotContext("org_1", "cv_1");
    expect(result?.conversation.agentHasSpoken).toBe(true);
  });

  it("agentHasSpoken: false sin ninguno", async () => {
    pushRows({ leadStage: [], agentSpoken: [] });
    const result = await buildBotContext("org_1", "cv_1");
    expect(result?.conversation.agentHasSpoken).toBe(false);
  });

  it("adOrigen: null sin fila en ad_attribution", async () => {
    pushRows({ leadStage: [], adAttribution: [] });
    const result = await buildBotContext("org_1", "cv_1");
    expect(result?.adOrigen).toBeNull();
  });

  it("adOrigen: presente tal cual cuando existe", async () => {
    const anuncio = {
      headline: "Ortodoncia sin dolor",
      body: "Primera consulta gratis",
      sourceId: "120210000000000",
      sourceType: "ad",
      sourceUrl: "https://facebook.com/ads/x",
    };
    pushRows({ leadStage: [], adAttribution: [anuncio] });
    const result = await buildBotContext("org_1", "cv_1");
    expect(result?.adOrigen).toEqual(anuncio);
  });

  it("aiEnabled del contexto es false si hay handoff, aunque la columna diga true (una sola verdad)", async () => {
    pushRows({ leadStage: [] });
    const withHandoff = { ...CONV, handoffAt: new Date() };
    selectQueue.length = 0;
    selectQueue.push([{ conversation: withHandoff, contact: CONTACT }], [], [], []);

    const result = await buildBotContext("org_1", "cv_1");
    expect(result?.conversation.aiEnabled).toBe(false);
  });
});
