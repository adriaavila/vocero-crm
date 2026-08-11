import { describe, expect, it } from "vitest";
import { phoneToChatId, WahaError } from "@/server/lab/waha";

describe("WAHA live test", () => {
  it("convierte el número visible de Meta al chat de WAHA", () => {
    expect(phoneToChatId("+58 412-555-0199")).toBe("584125550199@c.us");
    expect(() => phoneToChatId("---")).toThrow(WahaError);
  });
});
