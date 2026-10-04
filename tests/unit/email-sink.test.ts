import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/server/agencia/email";
import { DELETE, GET, POST } from "@/app/api/dev/email-sink/route";

const MESSAGE = { to: "ana@ejemplo.com", subject: "Hola", text: "texto", html: "<p>html</p>" };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "allok <no-reply@allok.fun>");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("EMAIL_API_URL override", () => {
  it("sends to the override instead of Resend", async () => {
    vi.stubEnv("EMAIL_API_URL", "http://localhost:3000/api/dev/email-sink");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "sink_1" }), { status: 200 }));
    await expect(sendEmail(MESSAGE)).resolves.toEqual({ ok: true, id: "sink_1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3000/api/dev/email-sink");
  });

  it("defaults to Resend when unset or blank", async () => {
    vi.stubEnv("EMAIL_API_URL", "  ");
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await sendEmail(MESSAGE);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
  });
});

describe("/api/dev/email-sink", () => {
  const json = (body: unknown) =>
    new Request("http://localhost/api/dev/email-sink", { method: "POST", body: JSON.stringify(body) });

  it("is a 404 without the mock flag, and in production", async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    expect((await POST(json({}))).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/dev/email-sink"))).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(json({}))).status).toBe(404);
  });

  it("records, lists (filtered by recipient) and clears", async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    await DELETE();
    const created = await (await POST(json({ from: "x", to: ["ana@ejemplo.com"], subject: "Uno", text: "t", html: "h" }))).json();
    expect(created.id).toMatch(/^sink_/);
    await POST(json({ to: ["otra@ejemplo.com"], subject: "Dos" }));

    const all = await (await GET(new Request("http://localhost/api/dev/email-sink"))).json();
    expect(all.emails).toHaveLength(2);
    const filtered = await (await GET(new Request("http://localhost/api/dev/email-sink?to=ana@ejemplo.com"))).json();
    expect(filtered.emails).toEqual([expect.objectContaining({ subject: "Uno", to: ["ana@ejemplo.com"] })]);

    await DELETE();
    expect((await (await GET(new Request("http://localhost/api/dev/email-sink"))).json()).emails).toEqual([]);
  });
});
