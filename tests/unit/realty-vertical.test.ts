import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultVerticalFromEnv, verticalFromMetadata } from "@/server/agencia/vertical";

/**
 * Vertical de negocio por organización (fork de agencia). Solo las funciones
 * PURAS se prueban aquí, como `entitlements.test.ts` con
 * `hasPaidSaaSPlanFromMetadata`: `getOrgVertical`/`isRealtyOrg`/
 * `setOrgVertical` tocan la base y los ejercita el arnés E2E
 * (`scripts/e2e-inmobiliario.mjs`) contra la app viva.
 */

describe("defaultVerticalFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sin DEFAULT_VERTICAL, ninguna organización nueva nace con vertical (caso allok)", () => {
    vi.stubEnv("DEFAULT_VERTICAL", "");
    expect(defaultVerticalFromEnv()).toBeUndefined();
  });

  it("DEFAULT_VERTICAL=inmobiliario activa el vertical de Rei CRM", () => {
    vi.stubEnv("DEFAULT_VERTICAL", "inmobiliario");
    expect(defaultVerticalFromEnv()).toBe("inmobiliario");
  });

  it("un valor desconocido se ignora en vez de activar algo a medias", () => {
    vi.stubEnv("DEFAULT_VERTICAL", "otro-vertical-inventado");
    expect(defaultVerticalFromEnv()).toBeUndefined();
  });
});

describe("verticalFromMetadata", () => {
  it("organización sin metadata → sin vertical", () => {
    expect(verticalFromMetadata(null)).toBeNull();
    expect(verticalFromMetadata(undefined)).toBeNull();
  });

  it("lee el vertical guardado por setOrgVertical", () => {
    expect(verticalFromMetadata(JSON.stringify({ vertical: "inmobiliario" }))).toBe(
      "inmobiliario"
    );
  });

  it("no pisa ni se confunde con OTRA metadata de la organización (marca, facturación)", () => {
    const raw = JSON.stringify({
      branding: { name: "Acme" },
      allok: { billing: { plan: "pro", status: "active" } },
      vertical: "inmobiliario",
    });
    expect(verticalFromMetadata(raw)).toBe("inmobiliario");
  });

  it("metadata inválida o un vertical desconocido degradan a null, nunca lanzan", () => {
    expect(verticalFromMetadata("no-es-json")).toBeNull();
    expect(verticalFromMetadata(JSON.stringify({ vertical: "ferreteria" }))).toBeNull();
    expect(verticalFromMetadata(JSON.stringify(["no", "es", "un", "objeto"]))).toBeNull();
  });
});
