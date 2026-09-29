import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMarketingHost, plans, productName } from "@/lib/marketing";

/**
 * La superficie pública de Rei lleva su marca; el panel de un negocio, no.
 * Ninguna pantalla que vea el cliente de una agencia puede decir "Rei CRM" —
 * el portero está en `(marketing)/layout.tsx` (vía `isMarketingHost`); esta
 * prueba vigila que el nombre no se cuele fuera de ese grupo por un copiar y
 * pegar, igual que en el fork de origen.
 */

const SRC = join(process.cwd(), "src");
const PUBLIC_GROUP = join(SRC, "app", "(marketing)");
// Las dos fuentes legítimas del nombre: `brand.ts` lo define, `marketing.ts`
// lo reexpone para la superficie pública. Ninguna otra debería escribirlo.
const ALLOWED_SOURCES = new Set([join(SRC, "lib", "marketing.ts"), join(SRC, "lib", "brand.ts")]);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("marca blanca: el nombre de Rei no sale del grupo público", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ningún archivo fuera de (marketing) escribe 'Rei CRM' a mano", () => {
    vi.stubEnv("BRAND", "rei");
    const name = productName();
    expect(name).toBe("Rei CRM");
    const offenders = filesUnder(SRC)
      .filter((f) => !f.startsWith(PUBLIC_GROUP) && !ALLOWED_SOURCES.has(f))
      .filter((f) => readFileSync(f, "utf8").includes(name));
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
