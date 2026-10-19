import { describe, expect, it } from "vitest";
import { errorKeyForCancel, errorKeyForStep, onboardingErrorCopy } from "@/lib/onboarding-errors";

describe("errores del alta en lenguaje humano", () => {
  it("cerrar la ventana sin código es una cancelación que se puede retomar", () => {
    expect(errorKeyForCancel(undefined)).toBe("cancelled");
    expect(errorKeyForCancel("")).toBe("cancelled");
    expect(onboardingErrorCopy("cancelled").retry).toBe(true);
  });

  it("traduce los códigos que Meta manda dentro de su ventana", () => {
    expect(errorKeyForCancel(3441030)).toBe("number_on_whatsapp");
    expect(errorKeyForCancel("2655093")).toBe("other_provider");
    expect(errorKeyForCancel("3441049")).toBe("other_provider");
    expect(errorKeyForCancel("2494028")).toBe("waba_shared");
    expect(errorKeyForCancel("3441042")).toBe("coexistence_region");
    expect(errorKeyForCancel("999")).toBe("meta_unavailable");
  });

  it("un número de otro negocio manda al soporte de la marca y no ofrece reintentar", () => {
    const rei = { brandName: "Rei", supportHref: "https://wa.me/59170000000?text=hola" };
    for (const step of ["phone_in_use", "waba_in_use"]) {
      const copy = onboardingErrorCopy(errorKeyForStep(step), rei);
      expect(copy.retry).toBe(false);
      expect(copy.title).toBe("Ese número ya está conectado a otra cuenta de Rei");
      expect(copy.action?.href).toBe(rei.supportHref);
    }
  });

  it("sin marca no nombra a nadie ni ofrece un soporte que no conoce", () => {
    const copy = onboardingErrorCopy("number_in_use");
    expect(copy.title).toBe("Ese número ya está conectado a otra cuenta");
    expect(copy.action).toBeUndefined();
    expect(onboardingErrorCopy("coexistence_region").body).not.toMatch(/allok/i);
  });

  it("los pasos del servidor y las claves guardadas vuelven a su copia", () => {
    expect(errorKeyForStep("webhook_verify")).toBe("webhook");
    expect(errorKeyForStep("register_pin_mismatch")).toBe("register_pin_mismatch");
    expect(errorKeyForStep("resolve")).toBe("no_number_selected");
    expect(errorKeyForStep("other_provider")).toBe("other_provider");
    expect(errorKeyForStep("algo_raro")).toBe("meta_unavailable");
    expect(onboardingErrorCopy(null).title).toBeTruthy();
  });

  it("ninguna copia usa guiones largos ni texto crudo de Meta", () => {
    const keys = ["cancelled", "number_on_whatsapp", "other_provider", "waba_shared", "number_in_use", "webhook", "register_pin_mismatch"];
    for (const key of keys) {
      const copy = onboardingErrorCopy(key);
      expect(copy.title + copy.body).not.toContain("—");
    }
  });
});
