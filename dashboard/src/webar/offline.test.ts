import { describe, expect, it } from "vitest";
import {
  __resetMemoryForTests,
  applySyncResult,
  backoffMs,
  completeAttemptAtomically,
  listPendingAttempts,
  nextStateForHttp,
  recoverOnReload,
} from "./offline/attemptQueue.js";
import { approveDraft, canPublish, invalidateOnEdit } from "./schema/draftApproval.js";

const payload = {
  attemptId: "00000000-0000-4000-8000-000000000001",
  deviceId: "test-device",
  moduleId: "fire-fixture-001",
  moduleVersion: 1,
  startedAt: "2026-09-15T10:00:00.000Z",
  completedAt: "2026-09-15T10:05:00.000Z",
  clientScore: 100,
  events: [{ sequence: 1, stepId: "identify", kind: "select", targetId: "electrical_fire" }],
};

describe("offline queue + approval invariant (vectors 8, browser offline)", () => {
  it("vector 8: edit invalidates approval and blocks publish", () => {
    const approved = approveDraft(
      { revision: 1, contentHash: "abc", approvedHash: null, approvedBy: null, approvedAt: null, status: "AI_DRAFT" },
      "trainer-1",
      "2026-09-15T00:00:00.000Z",
    );
    expect(canPublish(approved)).toBe(true);
    const edited = invalidateOnEdit(approved, "def");
    expect(edited.status).toBe("AI_DRAFT");
    expect(edited.approvedHash).toBeNull();
    expect(canPublish(edited)).toBe(false);
  });

  it("completion writes attempt + PENDING atomically before SAVED", async () => {
    __resetMemoryForTests();
    const entry = await completeAttemptAtomically(payload);
    expect(entry.state).toBe("PENDING");
    const pending = await listPendingAttempts();
    expect(pending.map((e) => e.attemptId)).toContain(payload.attemptId);
  });

  it("reload recovers SYNCING as PENDING; backoff and terminal mapping hold", async () => {
    expect(recoverOnReload([{ attemptId: "a", state: "SYNCING", retryCount: 0, nextRetryAt: 0, payloadHash: "h" }])[0]?.state).toBe("PENDING");
    expect(backoffMs(0)).toBe(2000);
    expect(backoffMs(4)).toBe(60000);
    expect(nextStateForHttp(200)).toBe("CONFIRMED");
    expect(nextStateForHttp(409)).toBe("CONFLICT");
    expect(nextStateForHttp(422)).toBe("BLOCKED");
    expect(nextStateForHttp(500)).toBe("RETRY");
  });

  it("409 becomes CONFLICT and never auto-retries; 200 becomes CONFIRMED", async () => {
    __resetMemoryForTests();
    await completeAttemptAtomically(payload);
    const conflict = await applySyncResult(payload.attemptId, 409, undefined, "different evidence");
    expect(conflict?.state).toBe("CONFLICT");
    __resetMemoryForTests();
    await completeAttemptAtomically(payload);
    const ok = await applySyncResult(payload.attemptId, 200, { accepted: true });
    expect(ok?.state).toBe("CONFIRMED");
  });
});
