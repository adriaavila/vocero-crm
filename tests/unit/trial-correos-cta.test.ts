import { describe, expect, it } from "vitest";
import { buildSetupNudgeEmail } from "@/server/agencia/trial-correos";
import { SETUP_STEP_META, SETUP_STEP_ORDER, type SetupProgress } from "@/lib/setup-steps";

function progress(current: SetupProgress["current"]): SetupProgress {
  const at = current ? SETUP_STEP_ORDER.indexOf(current) : SETUP_STEP_ORDER.length;
  return {
    steps: SETUP_STEP_ORDER.map((key, i) => ({ key, ...SETUP_STEP_META[key], done: i < at })),
    current,
    active: true,
  };
}

describe("correo «te falta un paso»: el texto del botón no cambia", () => {
  const mail = (current: SetupProgress["current"]) =>
    buildSetupNudgeEmail({ to: "a@b.co", baseUrl: "https://x.allok.fun", progress: progress(current), daysLeft: 3, second: false, brandName: "allok" });

  it("WhatsApp: «Conectar WhatsApp: enlace», sin doble dos puntos", () => {
    const { text, html } = mail("whatsapp");
    expect(text).toContain("Conectar WhatsApp: https://x.allok.fun/settings/whatsapp");
    expect(text).not.toMatch(/Seguir: conectar tu WhatsApp/);
    expect(html).not.toMatch(/Seguir: conectar tu WhatsApp/);
  });

  it("los otros pasos conservan su «Seguir: …»", () => {
    expect(mail("negocio").text).toContain("Seguir: cuéntanos de tu negocio: https://x.allok.fun/agent");
    expect(mail("probar").text).toContain("Seguir: probar tu agente: https://x.allok.fun/lab");
    expect(mail("activar").text).toContain("Seguir: activar tu agente: https://x.allok.fun/agent#activar");
  });
});
