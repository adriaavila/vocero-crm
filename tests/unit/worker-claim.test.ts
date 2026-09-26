import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({ execute }),
  schema: { agentJob: {}, message: {} },
}));
vi.mock("@/server/ai/pipeline", () => ({
  applyHandoff: vi.fn(),
  runAgentTurn: vi.fn(),
  scheduleAgentTurn: vi.fn(),
}));

import { claimNextJob } from "@/server/ai/worker";

describe("durable agent worker claim", () => {
  beforeEach(() => execute.mockReset());

  it("claims one row atomically and returns lockedAt as a Date", async () => {
    // El driver devuelve `timestamp` del SQL crudo como TEXTO; el worker no
    // puede depender de eso (con texto, `gt(createdAt, claimedAt)` revienta).
    execute.mockResolvedValue([
      { id: "job_1", conversationId: "conversation_1", lockedAt: "2026-09-25 22:28:17.075351" },
    ]);

    const before = Date.now();
    const job = await claimNextJob("worker_1");
    expect(job).toMatchObject({ id: "job_1", conversationId: "conversation_1" });
    expect(job?.lockedAt).toBeInstanceOf(Date);
    expect(job!.lockedAt!.getTime()).toBeGreaterThanOrEqual(before - 1);

    const query = execute.mock.calls[0]?.[0] as { queryChunks: unknown } | undefined;
    expect(query).toBeDefined();
    expect(JSON.stringify(query?.queryChunks)).toContain("for update skip locked");
  });
});
