import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession,
}));

import { withOwner } from "@/lib/api";

describe("withOwner", () => {
  beforeEach(() => requireSession.mockReset());

  it("returns 403 without invoking an administrative mutation for members", async () => {
    requireSession.mockResolvedValue({ userId: "member", organizationId: "org", role: "member" });
    const mutation = vi.fn(async () => Response.json({ ok: true }));
    const response = await withOwner(mutation)();
    expect(response.status).toBe(403);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("allows the organization owner", async () => {
    requireSession.mockResolvedValue({ userId: "owner", organizationId: "org", role: "owner" });
    const response = await withOwner(async () => Response.json({ ok: true }))();
    expect(response.status).toBe(200);
  });
});
