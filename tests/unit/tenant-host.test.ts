import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllokBrand,
  isKnownAllokHost,
  isLegacyAppHost,
  isReservedSubdomain,
  isSaaSAdminHost,
  isSaaSAppHost,
  isTenantSlug,
  resolvedRootDomain,
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

describe("gotcha: ALLOK_ROOT_DOMAIN vacío (docker-compose ${VAR:-})", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("una cadena vacía se trata como no configurada, no como dominio ''", () => {
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "");
    expect(resolvedRootDomain()).toBe("allok.fun");
    expect(saasAppHost()).toBe("app.allok.fun");
    expect(isSaaSAppHost("app.allok.fun")).toBe(true);
  });

  it("solo espacios cuenta igual que vacío", () => {
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "   ");
    expect(resolvedRootDomain()).toBe("allok.fun");
  });

  it("un valor real sigue ganando, limpio de mayúsculas y puntos sueltos", () => {
    vi.stubEnv("ALLOK_ROOT_DOMAIN", " Reiprop.Tech. ");
    expect(resolvedRootDomain()).toBe("reiprop.tech");
    expect(saasAppHost()).toBe("app.reiprop.tech");
  });
});

describe("ALLOK_LEGACY_HOST=none (Rei no tiene organización heredada)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("apaga el mapeo entero: crm.<root> deja de ser el host legacy", () => {
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "reiprop.tech");
    vi.stubEnv("ALLOK_LEGACY_HOST", "none");
    expect(isLegacyAppHost("crm.reiprop.tech")).toBe(false);
    expect(isLegacyAppHost("crm.localhost:3000")).toBe(false);
  });

  it("sin ALLOK_LEGACY_HOST=none, crm.<root> sigue siendo el legacy de siempre", () => {
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "");
    vi.stubEnv("ALLOK_LEGACY_HOST", "");
    expect(isLegacyAppHost("crm.allok.fun")).toBe(true);
  });
});

describe("ALLOK_RESERVED_SUBDOMAINS suma sin tocar código", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("un subdominio extra queda reservado, además de los de fábrica", () => {
    vi.stubEnv("ALLOK_RESERVED_SUBDOMAINS", "inmo,portal,smtp,dev,test");
    for (const extra of ["inmo", "portal", "smtp", "dev", "test"]) {
      expect(isReservedSubdomain(extra)).toBe(true);
    }
    // Los de fábrica siguen reservados.
    expect(isReservedSubdomain("crm")).toBe(true);
  });

  it("demo NO es reservado: sigue disponible como slug de negocio (allok y Rei)", () => {
    vi.stubEnv("ALLOK_RESERVED_SUBDOMAINS", "inmo,portal,smtp,dev,test");
    expect(isReservedSubdomain("demo")).toBe(false);
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "reiprop.tech");
    expect(tenantSlugFromHost("demo.reiprop.tech")).toBe("demo");
  });

  it("sin la variable, ningún extra queda reservado", () => {
    vi.stubEnv("ALLOK_RESERVED_SUBDOMAINS", "");
    expect(isReservedSubdomain("inmo")).toBe(false);
  });
});
