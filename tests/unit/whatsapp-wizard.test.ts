import { describe, expect, it } from "vitest";
import { shouldShowHandoverRecovery } from "@/components/settings/whatsapp-wizard";

const connection = {
  wabaId: "waba_1",
  phoneNumberId: "phone_1",
  displayPhoneNumber: null,
  verifiedName: null,
  tokenLast4: "1234",
};

describe("recuperación de entrega de WhatsApp", () => {
  it("se ofrece en SaaS cuando faltan credenciales o la conexión figura activa", () => {
    expect(shouldShowHandoverRecovery(true, null)).toBe(true);
    expect(shouldShowHandoverRecovery(true, { ...connection, status: "connected" })).toBe(true);
  });

  it("no se ofrece fuera de SaaS ni cuando el token requiere reconexión", () => {
    expect(shouldShowHandoverRecovery(false, null)).toBe(false);
    expect(shouldShowHandoverRecovery(true, { ...connection, status: "reconnect_required" })).toBe(false);
  });
});
