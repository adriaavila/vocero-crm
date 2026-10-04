import { beforeEach, describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT, checkRateLimit, peekRateLimit, refundRateLimit, resetRateLimit } from "@/lib/rate-limit";

describe("rate limit por IP (FR-062: 10 / 10 min → 429)", () => {
  beforeEach(() => resetRateLimit());

  it("permite hasta el máximo y bloquea el siguiente", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect(
        checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + i).allowed
      ).toBe(true);
    }
    expect(
      checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(false);
  });

  it("la ventana desliza: pasados 10 minutos vuelve a permitir", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("k", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(checkRateLimit("k", AUTH_RATE_LIMIT, t0 + 1000).allowed).toBe(false);
    expect(
      checkRateLimit("k", AUTH_RATE_LIMIT, t0 + AUTH_RATE_LIMIT.windowMs + 500)
        .allowed
    ).toBe(true);
  });

  it("claves distintas (IPs) no se afectan entre sí", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("login:1.1.1.1", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(
      checkRateLimit("login:1.1.1.1", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(false);
    expect(
      checkRateLimit("login:2.2.2.2", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(true);
  });
});

describe("mirar y devolver cupo", () => {
  beforeEach(() => resetRateLimit());
  const opts = { windowMs: 1000, max: 2 };

  it("peek cuenta lo que queda sin gastar nada", () => {
    expect(peekRateLimit("k", opts, 0)).toBe(2);
    checkRateLimit("k", opts, 0);
    expect(peekRateLimit("k", opts, 1)).toBe(1);
    expect(peekRateLimit("k", opts, 1)).toBe(1);
    expect(peekRateLimit("k", opts, 5000)).toBe(2);
  });

  it("refund devuelve el último intento (una llamada que falló no cuenta)", () => {
    checkRateLimit("k", opts, 0);
    checkRateLimit("k", opts, 1);
    expect(checkRateLimit("k", opts, 2).allowed).toBe(false);
    refundRateLimit("k");
    expect(checkRateLimit("k", opts, 3).allowed).toBe(true);
    refundRateLimit("nunca-usada");
  });
});
