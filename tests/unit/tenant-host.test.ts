import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllokBrand,
  isKnownAllokHost,
  isLegacyAppHost,
  isSaaSAdminHost,
  isSaaSAppHost,
  isTenantSlug,
  saasAppHost,
  slugifyTenantName,
  tenantSlugFromHost,
} from "../../src/lib/tenant-host";

describe("tenant host resolver", () => {
  it("resuelve el slug desde el subdominio del negocio", () => {
    expect(tenantSlugFromHost("clinicaperez.allok.fun")).toBe("clinicaperez");
    expect(tenantSlugFromHost("ClinicaPerez.Allok.Fun:443")).toBe("clinicaperez");
  });

  it("reserva hosts de plataforma y rechaza hosts ambiguos", () => {
    expect(tenantSlugFromHost("app.allok.fun")).toBeNull();
    expect(tenantSlugFromHost("foo.bar.allok.fun")).toBeNull();
    expect(tenantSlugFromHost("allok.fun")).toBeNull();
    expect(tenantSlugFromHost("otro.example.com")).toBeNull();
    expect(isSaaSAppHost("app.allok.fun")).toBe(true);
    expect(isSaaSAppHost("app.localhost:3000")).toBe(true);
    expect(isSaaSAppHost("clinicaperez.allok.fun")).toBe(false);
    expect(isLegacyAppHost("crm.allok.fun")).toBe(true);
    expect(isLegacyAppHost("crm.localhost:3000")).toBe(true);
    expect(isKnownAllokHost("clinicaperez.allok.fun")).toBe(true);
    expect(isKnownAllokHost("foo.bar.allok.fun")).toBe(false);
    expect(isKnownAllokHost("desconocido.allok.fun")).toBe(true);
    expect(isSaaSAdminHost("admin.allok.fun")).toBe(true);
    expect(isSaaSAdminHost("desconocido.allok.fun")).toBe(false);
    expect(isKnownAllokHost("clinicaperez.localhost:3000")).toBe(true);
    expect(isKnownAllokHost("admin.localhost:3000")).toBe(true);
    expect(isKnownAllokHost("foo.bar.localhost:3000")).toBe(false);
  });

  it("el host del alta sale de la configuración, no de una constante", () => {
    const previo = process.env.ALLOK_SAAS_APP_URL;
    try {
      delete process.env.ALLOK_SAAS_APP_URL;
      expect(saasAppHost()).toBe("app.allok.fun");
      process.env.ALLOK_SAAS_APP_URL = "https://whatsapp.allok.fun";
      expect(saasAppHost()).toBe("whatsapp.allok.fun");
      // Un valor sin esquema no puede dejar el aviso en blanco.
      process.env.ALLOK_SAAS_APP_URL = "whatsapp.allok.fun";
      expect(saasAppHost()).toBe("whatsapp.allok.fun");
    } finally {
      if (previo === undefined) delete process.env.ALLOK_SAAS_APP_URL;
      else process.env.ALLOK_SAAS_APP_URL = previo;
    }
  });

  it("ningún subdominio de producto puede ser un negocio", () => {
    for (const reservado of ["whatsapp", "agent", "inmox", "crm", "admin", "app"]) {
      expect(tenantSlugFromHost(`${reservado}.allok.fun`)).toBeNull();
    }
    expect(slugifyTenantName("WhatsApp")).toBe("negocio");
  });

  it("permite desarrollo local sin relajar producción", () => {
    expect(tenantSlugFromHost("clinica.localhost:3000")).toBe("clinica");
    expect(tenantSlugFromHost("localhost:3000")).toBeNull();
  });

  it("normaliza nombres humanos a slugs seguros", () => {
    expect(slugifyTenantName("Clínica Pérez & Asociados")).toBe(
      "clinica-perez-asociados",
    );
    expect(slugifyTenantName("   ")).toBe("negocio");
    expect(isTenantSlug("a-b-9")).toBe(true);
    expect(isTenantSlug("-bad")).toBe(false);
    expect(slugifyTenantName("App")).toBe("negocio");
    expect(slugifyTenantName("Status")).toBe("negocio");
    expect(slugifyTenantName("CRM")).toBe("negocio");
  });
});

describe("marca allok", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("va también en una dedicada: el SaaS apagado no apaga la marca", () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("ALLOK_BRAND", "");
    expect(isAllokBrand()).toBe(true);
  });

  it("ALLOK_BRAND=off deja la marca Vocero, salvo en el SaaS", () => {
    vi.stubEnv("ALLOK_BRAND", "off");
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    expect(isAllokBrand()).toBe(false);
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    expect(isAllokBrand()).toBe(true);
  });
});
