import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearAllForTests,
  applySyncResult,
  backoffMs,
  clearProgress,
  completeAttemptAtomically,
  getAttempt,
  getPackage,
  listAttempts,
  listPendingAttempts,
  loadProgress,
  nextStateForHttp,
  recoverOnReload,
  saveProgress,
  storeCompletePackage,
  type AttemptPayload,
} from "./offline/attemptQueue.js";
import { approveDraft, canPublish, invalidateOnEdit } from "./schema/draftApproval.js";
import {
  describeQueueState,
  drainSyncQueue,
  startSyncScheduler,
  syncOneAttempt,
} from "./api/syncAttempt.js";

const workerA = "00000000-0000-4000-8000-0000000000a1";
const workerB = "00000000-0000-4000-8000-0000000000b2";

function payload(overrides: Partial<AttemptPayload> = {}): AttemptPayload {
  return {
    attemptId: "00000000-0000-4000-8000-000000000001",
    workerId: workerA,
    deviceId: "test-device",
    moduleId: "fire-fixture-001",
    moduleVersion: 1,
    startedAt: "2026-09-15T10:00:00.000Z",
    completedAt: "2026-09-15T10:05:00.000Z",
    clientScore: 100,
    events: [{ sequence: 1, stepId: "identify", kind: "select", targetId: "electrical_fire" }],
    ...overrides,
  };
}

function okFetch(body: unknown = { accepted: true }, status = 200) {
  return vi.fn().mockResolvedValue({ status, json: async () => body });
}

beforeEach(async () => {
  await __clearAllForTests();
});

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

  it("completion writes attempt + PENDING atomically through real IndexedDB", async () => {
    const entry = await completeAttemptAtomically(payload());
    expect(entry.state).toBe("PENDING");
    expect(entry.workerId).toBe(workerA);
    expect(await getAttempt(payload().attemptId)).toMatchObject({ workerId: workerA });
    const pending = await listPendingAttempts(workerA);
    expect(pending.map((e) => e.attemptId)).toContain(payload().attemptId);
  });

  it("requires workerId to complete an attempt", async () => {
    await expect(
      completeAttemptAtomically({ ...payload(), workerId: "" }),
    ).rejects.toThrow("workerId");
  });

  it("reload recovers SYNCING as PENDING; backoff and terminal mapping hold", async () => {
    expect(
      recoverOnReload([{ attemptId: "a", workerId: workerA, state: "SYNCING", retryCount: 0, nextRetryAt: 0, payloadHash: "h" }])[0]?.state,
    ).toBe("PENDING");
    expect(backoffMs(0)).toBe(2000);
    expect(backoffMs(4)).toBe(60000);
    expect(nextStateForHttp(200)).toBe("CONFIRMED");
    expect(nextStateForHttp(409)).toBe("CONFLICT");
    expect(nextStateForHttp(422)).toBe("BLOCKED");
    expect(nextStateForHttp(500)).toBe("RETRY");
  });

  it("409 becomes CONFLICT and never auto-retries; 200 becomes CONFIRMED", async () => {
    await completeAttemptAtomically(payload());
    const conflict = await applySyncResult(payload().attemptId, 409, undefined, "different evidence");
    expect(conflict?.state).toBe("CONFLICT");
    await __clearAllForTests();
    await completeAttemptAtomically(payload());
    const ok = await applySyncResult(payload().attemptId, 200, { accepted: true });
    expect(ok?.state).toBe("CONFIRMED");
  });

  it("repeat completion never resets queue retry state or terminal entries", async () => {
    await completeAttemptAtomically(payload());
    await applySyncResult(payload().attemptId, 500, undefined, "boom");
    const before = (await listPendingAttempts(workerA))[0];
    expect(before?.retryCount).toBe(1);
    await completeAttemptAtomically(payload());
    const after = (await listPendingAttempts(workerA))[0];
    expect(after?.retryCount).toBe(1);
    expect(after?.nextRetryAt).toBe(before?.nextRetryAt);
  });

  it("isolates workers: A never sees B attempts or progress", async () => {
    await completeAttemptAtomically(payload({ workerId: workerB }));
    await saveProgress({
      workerId: workerB, packageId: "fire-fixture-001", version: 1,
      attemptId: payload().attemptId, stepIndex: 2, events: payload().events,
      startedAt: payload().startedAt, completed: false, clientScore: 0,
    });
    expect(await listPendingAttempts(workerA)).toHaveLength(0);
    expect(await loadProgress(workerA, "fire-fixture-001", 1)).toBeUndefined();
    expect(await loadProgress(workerB, "fire-fixture-001", 1)).toMatchObject({ stepIndex: 2 });
  });

  it("isolates package versions: v1 progress never resumes into v2", async () => {
    await saveProgress({
      workerId: workerA, packageId: "fire-fixture-001", version: 1,
      attemptId: "a1", stepIndex: 3, events: [], startedAt: payload().startedAt,
      completed: false, clientScore: 0,
    });
    expect(await loadProgress(workerA, "fire-fixture-001", 2)).toBeUndefined();
    expect(await loadProgress(workerA, "fire-fixture-001", 1)).toMatchObject({ stepIndex: 3 });
  });

  it("progress round-trips and clears per worker/package/version", async () => {
    await saveProgress({
      workerId: workerA, packageId: "fire-fixture-001", version: 1,
      attemptId: "a1", stepIndex: 1, events: payload().events,
      startedAt: payload().startedAt, completed: false, clientScore: 15,
    });
    expect(await loadProgress(workerA, "fire-fixture-001", 1)).toMatchObject({ clientScore: 15 });
    await clearProgress(workerA, "fire-fixture-001", 1);
    expect(await loadProgress(workerA, "fire-fixture-001", 1)).toBeUndefined();
  });

  it("downloaded package persists and incomplete packages stay unlaunchable", async () => {
    await storeCompletePackage("fire-fixture-001", 1, { title: "t" }, ["fire_extinguisher"]);
    expect(await getPackage("fire-fixture-001", 1)).toEqual({ title: "t" });
    expect(await getPackage("fire-fixture-001", 2)).toBeUndefined();
  });
});

describe("sync drain (E04 reconnect)", () => {
  const context = { supabaseUrl: "https://example.supabase.co", accessToken: "token", workerId: workerA };

  it("strips workerId from the server payload", async () => {
    const fetchImpl = okFetch();
    await syncOneAttempt(context.supabaseUrl, context.accessToken, payload(), fetchImpl as never);
    const sent = JSON.parse((fetchImpl.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;
    expect("workerId" in sent).toBe(false);
    expect(sent["attemptId"]).toBe(payload().attemptId);
  });

  it("confirms once and never resubmits a confirmed attempt", async () => {
    await completeAttemptAtomically(payload());
    const first = await drainSyncQueue(context, okFetch() as never);
    expect(first).toMatchObject({ attempted: 1, confirmed: 1 });
    const second = await drainSyncQueue(context, okFetch() as never);
    expect(second.attempted).toBe(0);
    expect(second.confirmed).toBe(0);
  });

  it("maps 409 to CONFLICT without retry and 401 to BLOCKED", async () => {
    await completeAttemptAtomically(payload());
    const conflict = await drainSyncQueue(context, okFetch({ error: "different evidence" }, 409) as never);
    expect(conflict).toMatchObject({ attempted: 1, conflicts: 1 });
    const again = await drainSyncQueue(context, okFetch() as never);
    expect(again.attempted).toBe(0);

    await __clearAllForTests();
    await completeAttemptAtomically(payload({ attemptId: "00000000-0000-4000-8000-000000000002" }));
    const blocked = await drainSyncQueue(context, okFetch({ error: "Invalid session" }, 401) as never);
    expect(blocked).toMatchObject({ attempted: 1, blocked: 1 });
  });

  it("network failure keeps PENDING with backoff instead of duplicating", async () => {
    await completeAttemptAtomically(payload());
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    const first = await drainSyncQueue(context, failing as never);
    expect(first).toMatchObject({ attempted: 1, pending: 1 });
    const entry = (await listPendingAttempts(workerA))[0];
    expect(entry?.retryCount).toBe(1);
    expect(entry?.nextRetryAt).toBeGreaterThan(Date.now());
    // Not yet due: scheduler skips without touching retry state.
    const second = await drainSyncQueue(context, okFetch() as never);
    expect(second.attempted).toBe(0);
  });

  it("drains only the calling worker's entries", async () => {
    await completeAttemptAtomically(payload());
    await completeAttemptAtomically(payload({ attemptId: "00000000-0000-4000-8000-000000000003", workerId: workerB }));
    const result = await drainSyncQueue(context, okFetch() as never);
    expect(result).toMatchObject({ attempted: 1, confirmed: 1 });
    expect(await listPendingAttempts(workerB)).toHaveLength(1);
  });
});

describe("result display honesty (E07)", () => {
  it("never presents provisional state as server-confirmed", () => {
    expect(describeQueueState("PENDING")).toContain("SAVED ON THIS PHONE");
    expect(describeQueueState("SYNCING")).toContain("SYNCING");
    expect(describeQueueState("CONFLICT")).toContain("CONFLICT");
    expect(describeQueueState("BLOCKED")).toContain("BLOCKED");
    expect(describeQueueState("CONFIRMED", { serverScore: 75, passed: false, criticalFailure: true })).toContain(
      "SERVER CONFIRMED",
    );
    expect(describeQueueState("CONFIRMED", { serverScore: 75, passed: false, criticalFailure: true })).toContain(
      "critical failure",
    );
    expect(describeQueueState("PENDING")).not.toContain("SERVER CONFIRMED");
  });

  it("lists stored attempts per worker for trainer device visibility", async () => {
    await completeAttemptAtomically(payload());
    await completeAttemptAtomically(payload({ attemptId: "00000000-0000-4000-8000-000000000005", workerId: workerB }));
    expect((await listAttempts(workerA)).map((a) => a.attemptId)).toEqual([payload().attemptId]);
    expect(await getAttempt("missing")).toBeUndefined();
  });
});

describe("sync scheduler lifecycle", () => {
  function stubWindow() {
    const listeners = new Map<string, Array<() => void>>();
    const win = {
      addEventListener: (t: string, fn: () => void) => {
        listeners.set(t, [...(listeners.get(t) ?? []), fn]);
      },
      removeEventListener: (t: string, fn: () => void) => {
        listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn));
      },
      dispatch: (t: string) => {
        for (const fn of listeners.get(t) ?? []) fn();
      },
      listenerCount: (t: string) => listeners.get(t)?.length ?? 0,
    };
    (globalThis as unknown as { window: unknown }).window = win;
    return win;
  }

  it("drains on startup and on online, and stop removes listeners", async () => {
    const win = stubWindow();
    try {
      await completeAttemptAtomically(payload());
      const fetchImpl = okFetch();
      const scheduler = startSyncScheduler(
        async () => ({ supabaseUrl: "https://example.supabase.co", accessToken: "t", workerId: workerA }),
        fetchImpl as never,
      );
      // Startup drain runs async; poll for the confirm.
      for (let i = 0; i < 50 && (await listPendingAttempts(workerA)).length > 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(await listPendingAttempts(workerA)).toHaveLength(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      await completeAttemptAtomically(payload({ attemptId: "00000000-0000-4000-8000-000000000004" }));
      win.dispatch("online");
      for (let i = 0; i < 50 && (await listPendingAttempts(workerA)).length > 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      scheduler.stop();
      expect(win.listenerCount("online")).toBe(0);
      expect(win.listenerCount("focus")).toBe(0);
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  it("skips draining without a session and keeps listeners armed", async () => {
    const win = stubWindow();
    try {
      await completeAttemptAtomically(payload());
      const fetchImpl = okFetch();
      const scheduler = startSyncScheduler(async () => null, fetchImpl as never);
      await new Promise((r) => setTimeout(r, 50));
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await listPendingAttempts(workerA)).toHaveLength(1);
      expect(win.listenerCount("online")).toBe(1);
      scheduler.stop();
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});
