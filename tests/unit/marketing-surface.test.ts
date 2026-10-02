import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMarketingHost, plans, productName } from "@/lib/marketing";

/**
 * La superficie pública de Rei lleva su marca; el panel de un negocio, no.
 * El portero está en `(marketing)/layout.tsx` (vía `isMarketingHost`). La
 * marca se llama "Rei" en todas partes (decisión de Adrian, 2026-10-01); esta
 * prueba vigila que el nombre viejo "Rei CRM" no vuelva por un copiar y pegar.
 */

const SRC = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("marca blanca: el nombre de Rei no sale del grupo público", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("la marca es 'Rei' y el nombre viejo 'Rei CRM' no aparece en ninguna parte", () => {
    vi.stubEnv("BRAND", "rei");
    expect(productName()).toBe("Rei");
    const offenders = filesUnder(SRC).filter((f) => readFileSync(f, "utf8").includes("Rei CRM"));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});

describe("precios de Rei", () => {
  it("un solo plan de autoservicio, con precio real; el resto se conversa", () => {
    const priced = plans().filter((p) => p.price !== null);
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ id: "agencia", price: 299 });
  });

  it("todos los planes tienen algo que hacer y algo que ofrecer", () => {
    for (const plan of plans()) {
      expect(plan.cta.length).toBeGreaterThan(0);
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });
});

describe("isMarketingHost: la matriz de 404", () => {
  afterEach(() => vi.unstubAllEnvs());
  const APP_HOST = "crm.reiprop.tech";

  it("BRAND=allok: nunca, aunque el resto coincida", () => {
    vi.stubEnv("BRAND", "allok");
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_SAAS_APP_URL", `https://${APP_HOST}`);
    expect(isMarketingHost(APP_HOST)).toBe(false);
  });

  it("BRAND=rei fuera del modo SaaS (instancia dedicada): nunca", () => {
    vi.stubEnv("BRAND", "rei");
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    expect(isMarketingHost(APP_HOST)).toBe(false);
  });

  it("BRAND=rei, SaaS, host de un negocio (tiene tenant slug): nunca — ahí va el panel, no la portada", () => {
    vi.stubEnv("BRAND", "rei");
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_SAAS_APP_URL", `https://${APP_HOST}`);
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "reiprop.tech");
    expect(isMarketingHost("miagencia.reiprop.tech")).toBe(false);
  });

  it("BRAND=rei, SaaS, host de alta sin tenant: sí — ahí vive /inicio, /precios y los legales", () => {
    vi.stubEnv("BRAND", "rei");
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_SAAS_APP_URL", `https://${APP_HOST}`);
    expect(isMarketingHost(APP_HOST)).toBe(true);
  });

  it("host desconocido: nunca", () => {
    vi.stubEnv("BRAND", "rei");
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_SAAS_APP_URL", `https://${APP_HOST}`);
    expect(isMarketingHost("otra-cosa.example.com")).toBe(false);
  });
});
