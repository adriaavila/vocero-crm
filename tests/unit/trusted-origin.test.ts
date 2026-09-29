import { afterEach, describe, expect, it } from "vitest";
import { trustedSaaSOrigin } from "@/lib/tenant-host";

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
