import { describe, expect, it } from "vitest";
import {
  isAuthorized,
  parseProvisionPayload,
  resolveTargetOrg,
} from "@/server/provision/payload";

/** Contrato de `POST /api/provision`: allok entrega un número ya conectado. */

const SECRET = "un-secreto-suficientemente-largo";

const valid = {
  organization_id: null,
  client: "acme",
  business_id: "biz_1",
  waba_id: "waba_1",
  phone_number_id: "phone_1",
  token: "EAA-token",
  display_phone_number: "+58 422-0023684",
  verified_name: "Acme",
  connection_mode: "META_COEXISTENCE",
  status: "subscribed",
  is_coexistence: true,
};

describe("autorización", () => {
  it("acepta el bearer correcto", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rechaza secreto incorrecto, esquema ausente y cabecera vacía", () => {
    expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
    expect(isAuthorized(null, SECRET)).toBe(false);
  });

  it("sin clave configurada, o demasiado corta, nadie entra", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isAuthorized("Bearer corto", "corto")).toBe(false);
  });
});

describe("payload", () => {
  it("acepta el cuerpo que manda allok", () => {
    const r = parseProvisionPayload(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.phoneNumberId).toBe("phone_1");
    expect(r.payload.connectionMode).toBe("META_COEXISTENCE");
    expect(r.payload.organizationId).toBeNull();
  });

  it("exige las credenciales sin las que el número no sirve", () => {
    for (const field of ["waba_id", "phone_number_id", "token"]) {
      const r = parseProvisionPayload({ ...valid, [field]: "" });
      expect(r.ok, `${field} vacío debería fallar`).toBe(false);
    }
  });

  it("rechaza un connection_mode desconocido en vez de asumir uno", () => {
    expect(parseProvisionPayload({ ...valid, connection_mode: "WAHA" }).ok).toBe(false);
  });

  it("no confunde el status de allok con el enum de vocero", () => {
    const r = parseProvisionPayload({ ...valid, status: "reconnect_required" });
    expect(r.ok).toBe(true);
    expect(r.ok && "status" in r.payload).toBe(false);
  });

  it("rechaza cuerpos que no son objetos", () => {
    expect(parseProvisionPayload(null).ok).toBe(false);
    expect(parseProvisionPayload([valid]).ok).toBe(false);
  });
});

describe("organización destino", () => {
  it("sin organization_id usa la organización de la instancia", () => {
    const r = resolveTargetOrg(null, "org_abc");
    expect(r.ok && r.organizationId).toBe("org_abc");
  });

  it("con el organization_id correcto, pasa", () => {
    const r = resolveTargetOrg("org_abc", "org_abc");
    expect(r.ok && r.organizationId).toBe("org_abc");
  });

  it("el id de OTRA instancia se rechaza — entregaría mensajes al negocio equivocado", () => {
    expect(resolveTargetOrg("org_otro", "org_abc").ok).toBe(false);
  });

  it("instancia sin organización todavía no puede recibir un número", () => {
    expect(resolveTargetOrg(null, null).ok).toBe(false);
  });
});
