// Worker sync v2 client — maps IndexedDB queue entries to the exact server
// contract: {attemptId, deviceId, moduleId, moduleVersion, startedAt, completedAt,
// clientScore, events[{sequence, stepId, kind, targetId}]}.
// Server resolves workerId from the verified bearer; workerId is local
// bookkeeping only and is never sent: the v2 endpoint rejects payloads that
// carry one.
import {
  applySyncResult,
  getAttempt,
  listQueue,
  markSyncing,
  type AttemptPayload,
} from "../offline/attemptQueue.js";

export type SyncV2Result = {
  attemptId: string;
  accepted: boolean;
  certificateCode?: string | null;
  certificateReason?: string | null;
  serverScore: number;
  passed: boolean;
  criticalFailure: boolean;
};

export function describeQueueState(state: string, serverResult?: unknown): string {
  if (state === "CONFIRMED") {
    const r = serverResult as Partial<SyncV2Result> | undefined;
    if (typeof r?.serverScore === "number") {
      return `SERVER CONFIRMED — score ${r.serverScore}, ${r.passed ? "passed" : r.criticalFailure ? "critical failure" : "failed"}`;
    }
    return "SERVER CONFIRMED";
  }
  if (state === "SYNCING") return "SYNCING — waiting for backend acceptance";
  if (state === "CONFLICT") return "CONFLICT — backend holds a different result for this attempt";
  if (state === "BLOCKED") return "BLOCKED — fix sign-in or permissions, then retry";
  return "SAVED ON THIS PHONE — pending sync";
}

export async function syncOneAttempt(
  supabaseUrl: string,
  accessToken: string,
  payload: AttemptPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: unknown }> {
  const { workerId: _localOnly, ...serverPayload } = payload;
  void _localOnly;
  const response = await fetchImpl(`${supabaseUrl}/functions/v1/sync-attempt`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(serverPayload),
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  return { status: response.status, body };
}

export type SyncContext = {
  supabaseUrl: string;
  accessToken: string;
  workerId: string;
};

export type DrainResult = {
  attempted: number;
  confirmed: number;
  conflicts: number;
  blocked: number;
  pending: number;
};

/** Drain due PENDING entries for one worker. Terminal CONFLICT/BLOCKED/
 * CONFIRMED entries are never retried. Entries whose retry time has not
 * arrived are left alone so reloads cannot reset the backoff schedule. */
export async function drainSyncQueue(
  context: SyncContext,
  fetchImpl: typeof fetch = fetch,
): Promise<DrainResult> {
  const result: DrainResult = { attempted: 0, confirmed: 0, conflicts: 0, blocked: 0, pending: 0 };
  const now = Date.now();
  const entries = await listQueue(context.workerId);
  for (const entry of entries) {
    if (entry.state !== "PENDING") continue;
    if (entry.nextRetryAt > now) {
      result.pending += 1;
      continue;
    }
    const payload = await getAttempt(entry.attemptId);
    if (!payload || payload.workerId !== context.workerId) {
      result.pending += 1;
      continue;
    }
    result.attempted += 1;
    await markSyncing(entry.attemptId);
    let status = 0;
    let responseBody: unknown;
    let errorMessage: string | undefined;
    try {
      const response = await syncOneAttempt(context.supabaseUrl, context.accessToken, payload, fetchImpl);
      status = response.status;
      responseBody = response.body;
      if (status !== 200) {
        errorMessage = (response.body as { error?: string } | null)?.error ?? `sync failed (${status})`;
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "network failure";
    }
    const next = await applySyncResult(entry.attemptId, status, responseBody, errorMessage);
    if (next?.state === "CONFIRMED") result.confirmed += 1;
    else if (next?.state === "CONFLICT") result.conflicts += 1;
    else if (next?.state === "BLOCKED") result.blocked += 1;
    else result.pending += 1;
  }
  return result;
}

export type SyncScheduler = {
  stop: () => void;
  drainNow: () => Promise<DrainResult | null>;
};

export function startSyncScheduler(
  getContext: () => Promise<SyncContext | null>,
  fetchImpl: typeof fetch = fetch,
): SyncScheduler {
  let stopped = false;
  let draining = false;

  const drainNow = async (): Promise<DrainResult | null> => {
    if (stopped || draining) return null;
    draining = true;
    try {
      const context = await getContext();
      if (!context) return null;
      return await drainSyncQueue(context, fetchImpl);
    } catch {
      return null;
    } finally {
      draining = false;
    }
  };

  const onTrigger = () => { void drainNow(); };
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") onTrigger();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", onTrigger);
    window.addEventListener("focus", onTrigger);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  }
  void drainNow();

  return {
    stop: () => {
      stopped = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onTrigger);
        window.removeEventListener("focus", onTrigger);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      }
    },
    drainNow,
  };
}
