import { afterEach, describe, expect, it } from "vitest";
import { trustedOriginForRequest, trustedSaaSOrigin } from "@/lib/tenant-host";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("trustedSaaSOrigin", () => {
  it("accepts the deployment's own hosts over https", () => {
    process.env.ALLOK_SAAS_APP_URL = "https://whatsapp.allok.fun";
    expect(trustedSaaSOrigin("https://santorini.allok.fun", "allok.fun")).toBe("https://santorini.allok.fun");
    expect(trustedSaaSOrigin("https://whatsapp.allok.fun", "allok.fun")).toBe("https://whatsapp.allok.fun");
    expect(trustedSaaSOrigin("https://admin.allok.fun", "allok.fun")).toBe("https://admin.allok.fun");
    expect(trustedSaaSOrigin("https://crm.allok.fun", "allok.fun")).toBe("https://crm.allok.fun");
  });

  it("rejects foreign, reserved, root and non-https origins", () => {
    process.env.ALLOK_SAAS_APP_URL = "https://whatsapp.allok.fun";
    expect(trustedSaaSOrigin("https://evil.example", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin("https://allok.fun.evil.example", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin("https://a.b.allok.fun", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin("https://n8n.allok.fun", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin("https://allok.fun", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin("http://santorini.allok.fun", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin("null", "allok.fun")).toBeNull();
    expect(trustedSaaSOrigin(undefined, "allok.fun")).toBeNull();
  });

  it("allows http only on localhost for development", () => {
    expect(trustedSaaSOrigin("http://santorini.localhost:3000", "allok.fun")).toBe("http://santorini.localhost:3000");
  });

  it("follows another root domain", () => {
    process.env.ALLOK_SAAS_APP_URL = "https://crm.reiprop.tech";
    expect(trustedSaaSOrigin("https://cordillera.reiprop.tech", "reiprop.tech")).toBe("https://cordillera.reiprop.tech");
    expect(trustedSaaSOrigin("https://santorini.allok.fun", "reiprop.tech")).toBeNull();
  });
});

describe("trustedOriginForRequest (bound to the request host)", () => {
  it("trusts a known origin only when it is the host the request went to", () => {
    process.env.ALLOK_SAAS_APP_URL = "https://whatsapp.allok.fun";
    expect(trustedOriginForRequest("https://santorini.allok.fun", "santorini.allok.fun", "allok.fun")).toBe("https://santorini.allok.fun");
    expect(trustedOriginForRequest("https://admin.allok.fun", "admin.allok.fun", "allok.fun")).toBe("https://admin.allok.fun");
    expect(trustedOriginForRequest("https://SANTORINI.allok.fun", "santorini.allok.fun", "allok.fun")).toBe("https://santorini.allok.fun");
  });

  it("rejects a sibling subdomain, another port, loopback and look-alikes", () => {
    process.env.ALLOK_SAAS_APP_URL = "https://whatsapp.allok.fun";
    expect(trustedOriginForRequest("https://deploy-hooks.allok.fun", "crm.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("https://otro.allok.fun", "santorini.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("https://santorini.allok.fun:8443", "santorini.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("http://evil.localhost:1234", "crm.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("https://evilallok.fun", "evilallok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("https://www.allok.fun", "www.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("http://crm.allok.fun", "crm.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("https://santorini.allok.fun", null, "allok.fun")).toBeNull();
  });

  it("treats reserved infra subdomains as never-tenants", () => {
    expect(trustedOriginForRequest("https://deploy-hooks.allok.fun", "deploy-hooks.allok.fun", "allok.fun")).toBeNull();
    expect(trustedOriginForRequest("https://medidor.allok.fun", "medidor.allok.fun", "allok.fun")).toBeNull();
  });
});
