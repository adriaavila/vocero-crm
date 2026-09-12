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

  it("claims one row atomically and preserves the mapped fields", async () => {
    const lockedAt = new Date();
    execute.mockResolvedValue([
      { id: "job_1", conversationId: "conversation_1", lockedAt },
    ]);

    await expect(claimNextJob("worker_1")).resolves.toEqual({
      id: "job_1",
      conversationId: "conversation_1",
      lockedAt,
    });

    const query = execute.mock.calls[0]?.[0] as { queryChunks: unknown } | undefined;
    expect(query).toBeDefined();
    expect(JSON.stringify(query?.queryChunks)).toContain("for update skip locked");
  });
});
