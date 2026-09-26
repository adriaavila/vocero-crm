import { afterEach, describe, expect, it, vi } from "vitest";
import { graphRequest, MetaApiError, normalizeMx, normalizeRecipient } from "@/lib/meta/client";

describe("normalizeRecipient", () => {
  it("México móvil legado: 521 + 10 dígitos → 52 + 10 dígitos", () => {
    expect(normalizeRecipient("5215512345678")).toBe("525512345678");
  });

  it("México ya normalizado queda intacto", () => {
    expect(normalizeRecipient("525512345678")).toBe("525512345678");
  });

  it("Argentina móvil: 549 + 10 dígitos → 54 + 10 dígitos (issue #35)", () => {
    // Meta reporta `549…` pero la lista de destinatarios de prueba solo
    // acepta el número sin el 9: con el 9 responde 131030 y el panel muestra
    // el número como habilitado, así que el error manda a revisar donde no es.
    expect(normalizeRecipient("5491122334455")).toBe("541122334455");
  });

  it("Argentina ya normalizada queda intacta", () => {
    expect(normalizeRecipient("541122334455")).toBe("541122334455");
  });

  it("otros países quedan intactos", () => {
    expect(normalizeRecipient("14155552671")).toBe("14155552671");
    expect(normalizeRecipient("50761234567")).toBe("50761234567");
  });

  it("no confunde números que empiezan en el troncal pero con otra longitud", () => {
    expect(normalizeRecipient("521123")).toBe("521123");
    expect(normalizeRecipient("549123")).toBe("549123");
    // 549 + 11 dígitos no es un móvil argentino: no se toca.
    expect(normalizeRecipient("54911223344556")).toBe("54911223344556");
  });

  it("la identidad NO se toca: normalizar al enviar es asimétrico a propósito", () => {
    // Si la ingesta reescribiera `549…`, la identidad guardada dejaría de
    // coincidir con el `wa_id` de cada webhook y el contacto se partiría.
    expect(normalizeMx("5491122334455")).toBe("5491122334455");
  });
});

describe("MetaApiError.isAuthError", () => {
  it("status 401 es error de auth", () => {
    expect(new MetaApiError("x", { status: 401 }).isAuthError).toBe(true);
  });

  it("code 190 es error de auth (token vencido)", () => {
    expect(new MetaApiError("x", { status: 400, code: 190 }).isAuthError).toBe(
      true
    );
  });

  it("OAuthException solo NO basta (Meta la usa en errores transitorios)", () => {
    // Incidente 2026-08-03: un 500 con type OAuthException (código 2,
    // "service temporarily unavailable") marcaba el token como vencido y
    // bloqueaba TODO envío. El type por sí solo jamás decide.
    expect(
      new MetaApiError("x", { status: 400, type: "OAuthException" }).isAuthError
    ).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 2, type: "OAuthException" })
        .isAuthError
    ).toBe(false);
  });

  it("OAuthException con código 190 sí es error de auth", () => {
    expect(
      new MetaApiError("x", { status: 400, code: 190, type: "OAuthException" })
        .isAuthError
    ).toBe(true);
  });

  it("un 5xx JAMÁS es error de auth, ni con código 190", () => {
    expect(new MetaApiError("x", { status: 500 }).isAuthError).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 190 }).isAuthError
    ).toBe(false);
  });
});

describe("graphRequest — timeout ante un Graph colgado (item 4d)", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("aborta y lanza MetaApiError a los ~30s si Meta nunca responde — no retiene la reserva 300s", async () => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3999");
    vi.stubEnv("DATABASE_URL", "postgres://x@127.0.0.1/y");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verifytoken");
    vi.useFakeTimers();

    // Un `fetch` que jamás resuelve por su cuenta — solo reacciona al abort,
    // exactamente lo que hace `node-fetch`/undici cuando se les pasa `signal`.
    global.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const call = graphRequest("me", { token: "t" });
    const assertion = expect(call).rejects.toThrow(/no respondió/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
