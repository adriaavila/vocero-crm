import { describe, expect, it } from "vitest";
import {
  agentProfilePutSchema,
  compatibleActivation,
} from "@/lib/agent-profile-compat";

describe("agent profile deployment compatibility", () => {
  it("normalizes and deduplicates allowed numbers", () => {
    expect(
      agentProfilePutSchema.parse({
        allowlistEnabled: true,
        allowedWaIds: ["+12057071653", "12057071653"],
      })
    ).toMatchObject({
      allowlistEnabled: true,
      allowedWaIds: ["12057071653"],
    });
  });

  it("rejects an enabled empty allowlist", () => {
    expect(() =>
      agentProfilePutSchema.parse({ allowlistEnabled: true, allowedWaIds: [] })
    ).toThrow();
  });

  it("serves and accepts the previous preset profile shape", () => {
    expect(compatibleActivation([{ message: "hola", response: "Hola" }])).toEqual({
      activationMessages: ["hola"],
      presetReplies: [{ message: "hola", response: "Hola" }],
    });
    expect(
      agentProfilePutSchema.parse({
        presetOnly: true,
        presetReplies: [{ message: "hola", response: "Hola" }],
      })
    ).toEqual({ activationEnabled: true, activationMessages: ["hola"] });
  });
});
