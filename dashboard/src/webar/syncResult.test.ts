import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearAllForTests, completeAttemptAtomically, listQueue } from "./offline/attemptQueue.js";
import { drainSyncQueue } from "./api/syncAttempt.js";

const workerId = "00000000-0000-4000-8000-0000000000a1";

beforeEach(async () => {
  await __clearAllForTests();
});

describe("confirmed sync evidence", () => {
  it("stores the authoritative server result on a 200 response", async () => {
    await completeAttemptAtomically({
      attemptId: "00000000-0000-4000-8000-000000000001",
      workerId,
      deviceId: "browser-test",
      moduleId: "webar-fire-safety-induction-org",
      moduleVersion: 2,
      startedAt: "2026-09-15T10:00:00.000Z",
      completedAt: "2026-09-15T10:05:00.000Z",
      clientScore: 75,
      events: [{ sequence: 1, stepId: "identify", kind: "select", targetId: "electrical_fire" }],
    });
    const serverResult = {
      attemptId: "00000000-0000-4000-8000-000000000001",
      accepted: true,
      serverScore: 75,
      passed: false,
      criticalFailure: true,
      certificateCode: null,
    };
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, json: async () => serverResult });
    await drainSyncQueue({ supabaseUrl: "https://example.supabase.co", accessToken: "token", workerId }, fetchImpl as never);
    const entry = (await listQueue(workerId)).find((item) => item.attemptId === serverResult.attemptId);
    expect(entry?.state).toBe("CONFIRMED");
    expect(entry?.serverResult).toEqual(serverResult);
  });
});
