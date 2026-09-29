import { describe, expect, it } from "vitest";
import {
  completeSignupSchema,
  isDuplicatePhoneNumberError,
} from "@/server/agencia/whatsapp-signup/payload";

describe("completeSignupSchema", () => {
  const valid = { code: "a-code", state: "a-state", mode: "coexistence" as const };

  it("acepta el body mínimo (code + state + mode)", () => {
    const r = completeSignupSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("acepta los campos opcionales del evento del SDK", () => {
    const r = completeSignupSchema.safeParse({
      ...valid,
      wabaId: "waba_1",
      phoneNumberId: "phone_1",
      businessId: "biz_1",
      event: { event: "FINISH", session_id: "sess_1" },
    });
    expect(r.success).toBe(true);
  });

  it("exige code, state y mode", () => {
    expect(completeSignupSchema.safeParse({ state: "s", mode: "coexistence" }).success).toBe(false);
    expect(completeSignupSchema.safeParse({ code: "c", mode: "coexistence" }).success).toBe(false);
    expect(completeSignupSchema.safeParse({ code: "c", state: "s" }).success).toBe(false);
  });

  it("rechaza un mode fuera del enum", () => {
    expect(completeSignupSchema.safeParse({ ...valid, mode: "otro" }).success).toBe(false);
  });

  it("rechaza code/state vacíos", () => {
    expect(completeSignupSchema.safeParse({ ...valid, code: "" }).success).toBe(false);
    expect(completeSignupSchema.safeParse({ ...valid, state: "" }).success).toBe(false);
  });
});

describe("isDuplicatePhoneNumberError", () => {
  it("reconoce la violación del índice único de teléfono", () => {
    expect(isDuplicatePhoneNumberError({ code: "23505", constraint_name: "meta_credentials_phone_uq" })).toBe(true);
  });

  it("no confunde OTRA violación de unicidad con esta", () => {
    expect(isDuplicatePhoneNumberError({ code: "23505", constraint_name: "template_org_name_lang_uq" })).toBe(false);
  });

  it("ignora errores sin ese código", () => {
    expect(isDuplicatePhoneNumberError({ code: "23503", constraint_name: "meta_credentials_phone_uq" })).toBe(false);
    expect(isDuplicatePhoneNumberError(new Error("algo más"))).toBe(false);
    expect(isDuplicatePhoneNumberError(null)).toBe(false);
    expect(isDuplicatePhoneNumberError("un string")).toBe(false);
  });
});
