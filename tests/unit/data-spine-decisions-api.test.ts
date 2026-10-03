import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Data spine — la API de decisiones: validación de entrada con Zod, 404 para lo
 * que no es de tu organización y el contrato de cada ruta. El aislamiento de
 * tenant contra Postgres de verdad: data-spine-realdb.test.ts.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  setVerdict: vi.fn(),
  listDecisions: vi.fn(),
  listConversationDecisions: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.requireSession,
}));
vi.mock("@/server/agencia/decisions-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/agencia/decisions-read")>()),
  setVerdict: mocks.setVerdict,
  listDecisions: mocks.listDecisions,
  listConversationDecisions: mocks.listConversationDecisions,
}));
vi.mock("@/server/inbox/queries", () => ({ getConversation: mocks.getConversation }));

const SESSION = { userId: "usr_1", organizationId: "org_A", role: "member" };

const patch = async (body: unknown, id = "dec_1") => {
  const { PATCH } = await import("@/app/api/decisions/[id]/route");
  return PATCH(
    new Request(`http://x/api/decisions/${id}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
};
const getList = async (query = "") => {
  const { GET } = await import("@/app/api/decisions/route");
  return GET(new Request(`http://x/api/decisions${query}`));
};
const getConv = async (query = "", id = "cv_1") => {
  const { GET } = await import("@/app/api/conversations/[id]/decisions/route");
  return GET(new Request(`http://x/api/conversations/${id}/decisions${query}`), {
    params: Promise.resolve({ id }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.requireSession.mockResolvedValue(SESSION);
  mocks.setVerdict.mockResolvedValue({
    id: "dec_1",
    verdict: "fallo",
    verdictNote: null,
    verdictBy: "usr_1",
    verdictAt: "2026-10-03T12:00:00.000Z",
  });
  mocks.listDecisions.mockResolvedValue({ decisions: [], nextCursor: null });
  mocks.listConversationDecisions.mockResolvedValue({ decisions: [], nextCursor: null });
  mocks.getConversation.mockResolvedValue({ conversation: { id: "cv_1" } });
});

describe("PATCH /api/decisions/[id]", () => {
  it("califica con la organización y el usuario de la SESIÓN, nunca del body", async () => {
    const res = await patch({ verdict: "fallo", note: "no pidió la dirección" });

    expect(res.status).toBe(200);
    expect(mocks.setVerdict).toHaveBeenCalledWith("org_A", "usr_1", "dec_1", {
      verdict: "fallo",
      note: "no pidió la dirección",
    });
    expect((await res.json()).decision).toMatchObject({ id: "dec_1", verdict: "fallo" });
  });

  it("acepta null para borrar el veredicto", async () => {
    expect((await patch({ verdict: null })).status).toBe(200);
    expect(mocks.setVerdict).toHaveBeenCalledWith("org_A", "usr_1", "dec_1", { verdict: null });
  });

  it.each([
    ["un veredicto fuera de catálogo", { verdict: "regular" }],
    ["sin veredicto", {}],
    ["una nota de más de 500 caracteres", { verdict: "bien", note: "x".repeat(501) }],
    ["una nota que no es texto", { verdict: "bien", note: 5 }],
    ["campos de más (no se puede colar organizationId ni verdictBy)", { verdict: "bien", verdictBy: "otro" }],
  ])("422 con %s", async (_name, body) => {
    const res = await patch(body);
    expect(res.status).toBe(422);
    expect(mocks.setVerdict).not.toHaveBeenCalled();
  });

  it("422 con un body que no es JSON", async () => {
    expect((await patch("{no")).status).toBe(422);
  });

  it("una nota de exactamente 500 caracteres pasa", async () => {
    expect((await patch({ verdict: "bien", note: "x".repeat(500) })).status).toBe(200);
  });

  it("404 si la decisión no es de esta organización (o no existe)", async () => {
    mocks.setVerdict.mockResolvedValue(null);
    const res = await patch({ verdict: "bien" }, "dec_de_la_org_B");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("401 sin sesión", async () => {
    const { UnauthorizedError } = await import("@/lib/auth/session");
    mocks.requireSession.mockRejectedValue(new UnauthorizedError());
    expect((await patch({ verdict: "bien" })).status).toBe(401);
    expect(mocks.setVerdict).not.toHaveBeenCalled();
  });
});

describe("GET /api/decisions", () => {
  it("lista con la organización de la sesión y los defaults", async () => {
    const res = await getList();
    expect(res.status).toBe(200);
    expect(mocks.listDecisions).toHaveBeenCalledWith("org_A", { limit: 25 });
  });

  it("pasa limit, cursor y verdict ya validados", async () => {
    await getList("?limit=10&verdict=none&cursor=abc_DEF-123");
    expect(mocks.listDecisions).toHaveBeenCalledWith("org_A", {
      limit: 10,
      verdict: "none",
      cursor: "abc_DEF-123",
    });
  });

  it.each(["?limit=0", "?limit=101", "?limit=abc", "?verdict=regular", "?cursor=con espacios!"])(
    "422 con %s",
    async (query) => {
      expect((await getList(query)).status).toBe(422);
      expect(mocks.listDecisions).not.toHaveBeenCalled();
    }
  );

  it("422 con un cursor que nosotros no emitimos", async () => {
    mocks.listDecisions.mockResolvedValue("invalid_cursor");
    const res = await getList("?cursor=AAAA");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_cursor");
  });
});

describe("GET /api/conversations/[id]/decisions", () => {
  it("404 si la conversación no es de la organización: ni siquiera consulta decisiones", async () => {
    mocks.getConversation.mockResolvedValue(null);
    const res = await getConv("", "cv_de_la_org_B");
    expect(res.status).toBe(404);
    expect(mocks.getConversation).toHaveBeenCalledWith("org_A", "cv_de_la_org_B");
    expect(mocks.listConversationDecisions).not.toHaveBeenCalled();
  });

  it("lista las de la conversación con la organización de la sesión", async () => {
    const res = await getConv("?limit=5");
    expect(res.status).toBe(200);
    expect(mocks.listConversationDecisions).toHaveBeenCalledWith("org_A", "cv_1", { limit: 5 });
  });

  it("422 con un limit inválido", async () => {
    expect((await getConv("?limit=500")).status).toBe(422);
  });
});
