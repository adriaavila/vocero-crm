import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «Pregúntale a allok»: el resumen que llega al modelo es de la organización de
 * la SESIÓN y de nadie más, hay tope de 20 al día y ni la pregunta ni la
 * respuesta se escriben en un log.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  chatJson: vi.fn(),
  getCentroMetricas: vi.fn(),
  pipelineNow: vi.fn(),
  getPrioridades: vi.fn(),
  listDecisions: vi.fn(),
  getBranding: vi.fn(),
  getAiRuntimeConfig: vi.fn(),
  agentOn: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/ai", () => ({ chatJson: mocks.chatJson }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ aiProvider: "openrouter" }] }) }) }),
  }),
}));
vi.mock("@/server/agencia/centro-metricas", () => ({
  getCentroMetricas: mocks.getCentroMetricas,
  pipelineNow: mocks.pipelineNow,
}));
vi.mock("@/server/agencia/prioridades", () => ({ getPrioridades: mocks.getPrioridades }));
vi.mock("@/server/agencia/decisions-read", () => ({ listDecisions: mocks.listDecisions }));
vi.mock("@/server/branding", () => ({ getBranding: mocks.getBranding }));
vi.mock("@/server/ai/credentials", () => ({ getAiRuntimeConfig: mocks.getAiRuntimeConfig }));
vi.mock("@/server/agencia/estado", () => ({ agentOn: mocks.agentOn }));

import { UnauthorizedError } from "@/lib/auth/session";
import { resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/centro/ask/route";
import { ASK_DAILY_LIMIT, buildSnapshot } from "@/server/agencia/centro-ask";
import { ASK_MARKER } from "@/server/agencia/centro-ask-prompt";

const NOW = new Date("2026-10-03T18:00:00Z");
const SECRET_QUESTION = "¿qué le digo a Zoraida Pimentel sobre su pedido secreto-4417?";
const SECRET_ANSWER = "Respuesta confidencial-9931 para el negocio.";

const metrics = (n: number) => ({
  timezone: "America/Caracas",
  conversations: { total: n },
  leads: { total: n + 1 },
  replies: { ai: n + 2, owner: n + 3 },
});

const post = (body: unknown, org = "org_A") => {
  mocks.requireSession.mockResolvedValue({ userId: "usr_1", organizationId: org, role: "owner" });
  return POST(new Request("http://x/api/centro/ask", { method: "POST", body: JSON.stringify(body) }));
};

let logged: string[];

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimit();
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  mocks.agentOn.mockResolvedValue({ on: true, timezone: "America/Caracas" });
  mocks.getBranding.mockImplementation(async (org: string) => ({ name: `Negocio de ${org}` }));
  mocks.getCentroMetricas.mockImplementation(async (_org: string, key: string) => metrics(key === "hoy" ? 3 : 20));
  mocks.pipelineNow.mockImplementation(async (org: string) => [{ id: "s1", name: `Nuevo ${org}`, kind: "open", count: 5 }]);
  mocks.getPrioridades.mockImplementation(async (org: string) => ({
    cards: [
      {
        name: `Cliente de ${org}`,
        reasonLabel: "Preguntó el precio",
        reasonDetail: null,
        windowLabel: "Quedan 3 h",
        handler: "persona",
        preview: "¿cuánto cuesta?",
      },
    ],
    total: 1,
    needsYou: 1,
    live: 0,
    closed: 0,
  }));
  mocks.listDecisions.mockImplementation(async (org: string) => ({
    decisions: [
      { createdAt: "2026-10-03T17:00:00.000Z", action: "replied", handoffReason: null, verdict: "fallo", verdictNote: `nota de ${org}`, triggerPreview: "NO DEBE SALIR", replyPreview: "NO DEBE SALIR" },
    ],
    nextCursor: null,
  }));
  mocks.getAiRuntimeConfig.mockResolvedValue({ providers: {} });
  mocks.chatJson.mockResolvedValue({ ok: true, data: { answer: SECRET_ANSWER } });
});

describe("el resumen", () => {
  it("se arma solo con la organización que se pide", async () => {
    await buildSnapshot("org_A", NOW);
    for (const fn of [mocks.getCentroMetricas, mocks.pipelineNow, mocks.getPrioridades, mocks.listDecisions, mocks.getBranding]) {
      expect(fn).toHaveBeenCalled();
      for (const call of fn.mock.calls) expect(call[0]).toBe("org_A");
    }
  });

  it("lleva cifras, tarjetas, embudo y decisiones con su veredicto, y nada más", async () => {
    const snap = await buildSnapshot("org_A", NOW);
    expect(snap).toMatchObject({
      negocio: "Negocio de org_A",
      hoy: { conversaciones: 3 },
      ultimos7Dias: { conversaciones: 20 },
      porAtender: { teNecesitan: 1, total: 1, principales: [{ contacto: "Cliente de org_A", razon: "Preguntó el precio", lasAtiende: "una persona" }] },
      embudoAhora: [{ etapa: "Nuevo org_A", leads: 5 }],
      ultimasDecisiones: [{ accion: "replied", veredicto: "fallo", nota: "nota de org_A" }],
    });
    // Ni los textos de las decisiones, ni ids, ni teléfonos.
    const json = JSON.stringify(snap);
    expect(json).not.toContain("NO DEBE SALIR");
    expect(Object.keys(snap).sort()).toEqual(
      ["ahora", "embudoAhora", "hoy", "negocio", "porAtender", "ultimasDecisiones", "ultimos7Dias", "zona"].sort(),
    );
  });
});

describe("POST /api/centro/ask", () => {
  it("contesta con la organización de la SESIÓN y le manda al modelo solo su resumen", async () => {
    const res = await post({ question: SECRET_QUESTION }, "org_A");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: SECRET_ANSWER, remaining: ASK_DAILY_LIMIT - 1 });

    const [schemaArg, messages, opts] = mocks.chatJson.mock.calls[0]!;
    expect(schemaArg).toBeTruthy();
    expect(messages[0].content).toContain(ASK_MARKER);
    expect(messages[0].content).toContain("Negocio de org_A");
    expect(messages[1].content).toContain("Cliente de org_A");
    expect(messages[1].content).not.toContain("org_B");
    expect(opts).toMatchObject({ provider: "openrouter" });
    for (const fn of [mocks.getCentroMetricas, mocks.getPrioridades, mocks.listDecisions]) {
      for (const call of fn.mock.calls) expect(call[0]).toBe("org_A");
    }
  });

  it("otro negocio recibe SU resumen, no el de A", async () => {
    await post({ question: "¿cómo vamos?" }, "org_A");
    await post({ question: "¿cómo vamos?" }, "org_B");
    const second = mocks.chatJson.mock.calls[1]![1][1].content as string;
    expect(second).toContain("Cliente de org_B");
    expect(second).not.toContain("org_A");
  });

  it("una organización en el body no cambia de negocio: el body es estricto", async () => {
    const res = await post({ question: "¿cómo vamos?", organizationId: "org_B" }, "org_A");
    expect(res.status).toBe(422);
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });

  it("valida la pregunta", async () => {
    expect((await post({ question: "" })).status).toBe(422);
    expect((await post({ question: "x" })).status).toBe(422);
    expect((await post({ question: "a".repeat(301) })).status).toBe(422);
    expect((await post({})).status).toBe(422);
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });

  it("sin sesión es 401", async () => {
    mocks.requireSession.mockRejectedValue(new UnauthorizedError());
    const res = await POST(new Request("http://x/api/centro/ask", { method: "POST", body: JSON.stringify({ question: "hola" }) }));
    expect(res.status).toBe(401);
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });

  it("a la pregunta 21 del día responde 429 y ya no llama al modelo", async () => {
    for (let i = 0; i < ASK_DAILY_LIMIT; i++) expect((await post({ question: "¿cómo vamos?" })).status).toBe(200);
    expect(mocks.chatJson).toHaveBeenCalledTimes(ASK_DAILY_LIMIT);
    const res = await post({ question: "¿cómo vamos?" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(mocks.chatJson).toHaveBeenCalledTimes(ASK_DAILY_LIMIT);
  });

  it("el tope es por negocio: B sigue teniendo las suyas", async () => {
    for (let i = 0; i < ASK_DAILY_LIMIT; i++) await post({ question: "¿cómo vamos?" }, "org_A");
    expect((await post({ question: "¿cómo vamos?" }, "org_A")).status).toBe(429);
    expect((await post({ question: "¿cómo vamos?" }, "org_B")).status).toBe(200);
  });

  it("sin IA configurada es 409; si el proveedor falla, 503 con un mensaje que se puede mostrar", async () => {
    mocks.chatJson.mockResolvedValueOnce({ ok: false, error: "not_configured", detail: `x ${SECRET_ANSWER}` });
    const a = await post({ question: SECRET_QUESTION });
    expect(a.status).toBe(409);
    mocks.chatJson.mockResolvedValueOnce({ ok: false, error: "invalid_output", detail: `raw=${SECRET_ANSWER}` });
    const b = await post({ question: SECRET_QUESTION });
    expect(b.status).toBe(503);
    expect((await b.json()).error.message).toMatch(/Prueba de nuevo/);
  });

  it("no escribe la pregunta ni la respuesta en ningún log, ni en el camino feliz ni en el de error", async () => {
    await post({ question: SECRET_QUESTION });
    mocks.chatJson.mockResolvedValueOnce({ ok: false, error: "provider_error", detail: `raw=${SECRET_ANSWER}` });
    await post({ question: SECRET_QUESTION });
    mocks.chatJson.mockRejectedValueOnce(new Error(`boom ${SECRET_QUESTION}`));
    await post({ question: SECRET_QUESTION });
    const all = logged.join("\n");
    expect(all).not.toContain("secreto-4417");
    expect(all).not.toContain("confidencial-9931");
  });
});
