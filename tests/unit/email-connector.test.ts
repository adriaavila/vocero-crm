import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, sendEmail } from "@/server/agencia/email";

/**
 * El conector de correo (Resend) es opcional (constitución II): apagado por
 * defecto, sin red cuando está apagado, y su fallo nunca lanza ni deja rastro
 * de secretos en los logs.
 */

const KEY = "re_test_SECRET_1234567890";
const FROM = "allok <no-reply@allok.fun>";
const MESSAGE = {
  to: "ana@ejemplo.com",
  subject: "Asunto de prueba",
  text: "Texto con https://app.test/reset?token=TOKEN-SECRETO",
  html: "<p>HTML con https://app.test/reset?token=TOKEN-SECRETO</p>",
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function enable() {
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("EMAIL_FROM", FROM);
}

describe("isEmailConfigured", () => {
  it("is off without the variables", () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it("needs both RESEND_API_KEY and EMAIL_FROM", () => {
    vi.stubEnv("RESEND_API_KEY", KEY);
    expect(isEmailConfigured()).toBe(false);
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", FROM);
    expect(isEmailConfigured()).toBe(false);
    vi.stubEnv("RESEND_API_KEY", "   ");
    expect(isEmailConfigured()).toBe(false);
  });

  it("is on with both", () => {
    enable();
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("sendEmail", () => {
  it("does nothing, and makes no request, when the connector is off", async () => {
    await expect(sendEmail(MESSAGE)).resolves.toEqual({ ok: false, reason: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the exact Resend request when enabled", async () => {
    enable();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }));

    await expect(sendEmail(MESSAGE)).resolves.toEqual({ ok: true, id: "msg_123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: FROM,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
    // Un proveedor colgado no puede retener la petición para siempre.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a provider rejection without throwing or logging secrets", async () => {
    enable();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ name: "validation_error", message: `The to field ${MESSAGE.to} is invalid` }),
        { status: 422 },
      ),
    );

    await expect(sendEmail(MESSAGE)).resolves.toEqual({ ok: false, reason: "rejected", status: 422 });

    const logged = [error, log, warn].flatMap((spy) => spy.mock.calls).flat().join(" ");
    expect(logged).toContain("422");
    for (const secret of [KEY, MESSAGE.to, "TOKEN-SECRETO", MESSAGE.subject, FROM]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("reports an unreachable provider without throwing or logging secrets", async () => {
    enable();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error(`connect ECONNREFUSED while sending ${MESSAGE.to} with ${KEY}`));

    await expect(sendEmail(MESSAGE)).resolves.toEqual({ ok: false, reason: "unreachable" });

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(MESSAGE.to);
  });

  it("tolerates a success body that is not JSON", async () => {
    enable();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(sendEmail(MESSAGE)).resolves.toEqual({ ok: true, id: null });
  });
});
