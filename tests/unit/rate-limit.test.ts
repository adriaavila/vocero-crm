import { beforeEach, describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT, CLIENT_IP_HEADERS, checkRateLimit, clientIp, peekRateLimit, refundRateLimit, resetRateLimit } from "@/lib/rate-limit";

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

describe("IP con la que se cuentan los intentos (Cloudflare → Traefik)", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("prefiere CF-Connecting-IP: la primera entrada de X-Forwarded-For suele ser un borde de Cloudflare", () => {
    expect(
      clientIp(h({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "172.70.1.2, 10.0.0.3" })),
    ).toBe("198.51.100.7");
  });

  it("sin Cloudflare cae a la primera entrada de X-Forwarded-For, luego a X-Real-IP, luego a 'local'", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.3" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-real-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(clientIp(h({}))).toBe("local");
    expect(clientIp(undefined)).toBe("local");
  });

  it("ignora un CF-Connecting-IP vacío", () => {
    expect(clientIp(h({ "cf-connecting-ip": "  ", "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("el limitador propio de Better Auth lee las mismas cabeceras, en el mismo orden", () => {
    expect(CLIENT_IP_HEADERS).toEqual(["cf-connecting-ip", "x-forwarded-for"]);
  });
});
