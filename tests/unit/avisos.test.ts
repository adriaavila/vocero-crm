import { createECDH } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { endpointPermitido, textoAviso } from "@/lib/avisos";

vi.mock("@/lib/env", async (orig) => {
  const real = await orig<typeof import("@/lib/env")>();
  return {
    ...real,
    getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), APP_BASE_URL: "https://app.allok.fun" }),
  };
});

describe("avisos al celular — el texto", () => {
  it("el cliente que pide una persona: quién y qué dijo", () => {
    const t = textoAviso({ kind: "traspaso", reason: "cliente", nombre: "Lucía Pérez", ultimoMensaje: "quiero hablar con alguien" });
    expect(t.title).toBe("Lucía Pérez quiere hablar contigo");
    expect(t.body).toBe("«quiero hablar con alguien»");
  });

  it("el agente no supo: lo dice con la pregunta, recortada para la pantalla bloqueada", () => {
    const t = textoAviso({ kind: "traspaso", reason: "modelo", nombre: null, ultimoMensaje: "x".repeat(400) });
    expect(t.title).toBe("Un cliente necesita una respuesta tuya");
    expect(t.body.startsWith("El agente no supo contestar: «x")).toBe(true);
    expect(t.body.length).toBeLessThan(200);
  });

  it("hostilidad no repite el insulto", () => {
    const t = textoAviso({ kind: "traspaso", reason: "hostilidad", nombre: "Juan", ultimoMensaje: "groserías" });
    expect(t.body).not.toContain("groserías");
  });

  it("cita nueva", () => {
    expect(textoAviso({ kind: "cita", nombre: "Ana", cuando: "jueves 9 de octubre, 10:00" })).toEqual({
      title: "Nueva cita: Ana",
      body: "Agendada para jueves 9 de octubre, 10:00.",
    });
  });
});

describe("avisos al celular — a dónde puede llamar el servidor", () => {
  it("solo servicios de push de navegadores, por https", () => {
    expect(endpointPermitido("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(endpointPermitido("https://web.push.apple.com/QO")).toBe(true);
    expect(endpointPermitido("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(endpointPermitido("https://wns2-bl2p.notify.windows.com/w/?token=1")).toBe(true);
    expect(endpointPermitido("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(endpointPermitido("https://169.254.169.254/latest")).toBe(false);
    expect(endpointPermitido("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(endpointPermitido("no es url")).toBe(false);
  });

  it("localhost solo con el entorno de pruebas", () => {
    expect(endpointPermitido("https://localhost:9911/push")).toBe(false);
    expect(endpointPermitido("https://localhost:9911/push", { local: true })).toBe(true);
  });
});

describe("avisos al celular — llaves VAPID derivadas", () => {
  it("son estables y forman un par P-256 válido", async () => {
    const { vapidKeys } = await import("@/server/agencia/avisos");
    const a = vapidKeys();
    expect(vapidKeys()).toEqual(a);
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(a.privateKey, "base64url"));
    expect(ecdh.getPublicKey().toString("base64url")).toBe(a.publicKey);
    expect(Buffer.from(a.publicKey, "base64url")).toHaveLength(65);
  });
});
