import { describe, expect, it } from "vitest";
import { activeNavigationHref } from "../../src/components/agencia/allok-ui/navigation";

describe("Allok navigation", () => {
  it("selects the specific team section instead of two active entries", () => {
    expect(activeNavigationHref("/settings/team", ["/settings", "/settings/team"])).toBe("/settings/team");
  });
  it("keeps settings active on deeper routes and avoids prefix collisions", () => {
    expect(activeNavigationHref("/settings/whatsapp", ["/settings", "/settings/team"])).toBe("/settings");
    expect(activeNavigationHref("/agent-other", ["/agent"])).toBeUndefined();
  });
});
