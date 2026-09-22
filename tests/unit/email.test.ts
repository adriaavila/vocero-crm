import { afterEach, describe, expect, it, vi } from "vitest";
import { emailEnabled, resetPasswordEmail, sendEmail } from "@/server/agencia/email";

describe("conector de correo (opcional)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("apagado sin clave: no toca la red y devuelve false", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "Allok <hola@allok.fun>");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(emailEnabled()).toBe(false);
    expect(await sendEmail(resetPasswordEmail("a@b.co", "https://x/y"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encendido: un POST a Resend con remitente, destinatario y enlace", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Allok <hola@allok.fun>");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendEmail(resetPasswordEmail("a@b.co", "https://x/reset/tok"))).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "Allok <hola@allok.fun>", to: ["a@b.co"] });
    expect(body.text).toContain("https://x/reset/tok");
  });

  it("Resend caído: no propaga, devuelve false", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "hola@allok.fun");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("red")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendEmail(resetPasswordEmail("a@b.co", "https://x"))).toBe(false);
  });
});
