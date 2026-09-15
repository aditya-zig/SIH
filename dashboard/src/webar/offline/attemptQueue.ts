// Offline contract — exact state machine from the execution spec.
// IndexedDB database: surakshaar-webar, version 1.
// Stores: packages [packageId, version], progress [workerId, packageId, version],
// attempts attemptId, syncQueue attemptId {PENDING|SYNCING|CONFIRMED|CONFLICT|BLOCKED}.
// E04: real IndexedDB only. Tests run against fake-indexeddb, a
// standards-compatible implementation. There is no memory fallback: without
// IndexedDB the queue throws an honest error instead of pretending to persist.
// Worker identity is part of progress/attempt/queue keys so two workers sharing
// one device can never resume each other, and v1 progress never leaks into v2.
export type SyncState = "PENDING" | "SYNCING" | "CONFIRMED" | "CONFLICT" | "BLOCKED";

export type QueueEntry = {
  attemptId: string;
  workerId: string;
  state: SyncState;
  retryCount: number;
  nextRetryAt: number;
  payloadHash: string;
  lastError?: string;
  serverResult?: unknown;
};

export type AttemptEvent = {
  sequence: number;
  stepId: string;
  kind: string;
  targetId: string;
};

export type AttemptPayload = {
  attemptId: string;
  workerId: string;
  deviceId: string;
  moduleId: string;
  moduleVersion: number;
  startedAt: string;
  completedAt: string;
  clientScore: number;
  events: AttemptEvent[];
};

export type AttemptProgress = {
  key: string;
  workerId: string;
  packageId: string;
  version: number;
  attemptId: string;
  stepIndex: number;
  events: AttemptEvent[];
  startedAt: string;
  updatedAt: string;
  completed: boolean;
  clientScore: number;
};

export const DB_NAME = "surakshaar-webar";
export const DB_VERSION = 1;

export function backoffMs(retryCount: number): number {
  const schedule = [2000, 5000, 15000, 30000];
  if (retryCount < 0) return schedule[0] ?? 2000;
  return schedule[retryCount] ?? 60000;
}

export function nextStateForHttp(status: number): SyncState | "RETRY" {
  if (status === 200) return "CONFIRMED";
  if (status === 409) return "CONFLICT";
  if (status === 400 || status === 403 || status === 422) return "BLOCKED";
  if (status === 401) return "BLOCKED"; // pause until correct identity returns
  return "RETRY"; // network / 429 / 5xx
}

export function progressKey(workerId: string, packageId: string, version: number): string {
  return [workerId, packageId, version].map((p) => String(p)).join("::");
}

function packageKey(packageId: string, version: number): string {
  return [packageId, version].map((p) => String(p)).join("::");
}

function requireIndexedDB(): IDBFactory {
  const factory =
    typeof indexedDB !== "undefined"
      ? indexedDB
      : (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) {
    throw new Error("IndexedDB is unavailable; offline persistence cannot run without it");
  }
  return factory;
}

function openDb(factory: IDBFactory = requireIndexedDB()): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("packages"))
        db.createObjectStore("packages", { keyPath: "key" });
      if (!db.objectStoreNames.contains("progress"))
        db.createObjectStore("progress", { keyPath: "key" });
      if (!db.objectStoreNames.contains("attempts"))
        db.createObjectStore("attempts", { keyPath: "attemptId" });
      if (!db.objectStoreNames.contains("syncQueue"))
        db.createObjectStore("syncQueue", { keyPath: "attemptId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value as never);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`put to ${store} failed`));
    });
  } finally {
    db.close();
  }
}

async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error ?? new Error(`read of ${store} failed`));
    });
  } finally {
    db.close();
  }
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error ?? new Error(`read of ${store} failed`));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`delete from ${store} failed`));
    });
  } finally {
    db.close();
  }
}

export async function sha256HexBrowser(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function payloadHash(payload: AttemptPayload): string {
  // Synchronous fallback hash for queue bookkeeping (not evidence hash).
  // Evidence hash is SHA-256 over module/version + sorted events (server).
  const canonical = JSON.stringify({
    moduleId: payload.moduleId,
    moduleVersion: payload.moduleVersion,
    events: [...payload.events].sort((a, b) => a.sequence - b.sequence),
  });
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16)}`;
}

// Package download is complete only after package + every required asset are
// verified and stored. Partial downloads are not launchable and must not delete
// the last complete version.
export async function storeCompletePackage(
  packageId: string,
  version: number,
  pkg: unknown,
  assetManifest: string[],
): Promise<void> {
  const key = packageKey(packageId, version);
  const record = {
    key,
    packageId,
    version,
    package: pkg,
    assetManifest,
    downloadState: "COMPLETE" as const,
    downloadedAt: new Date().toISOString(),
  };
  await idbPut("packages", record);
}

export async function getPackage(packageId: string, version: number): Promise<unknown | undefined> {
  const rec = await idbGet<{ package: unknown; downloadState: string }>(
    "packages",
    packageKey(packageId, version),
  );
  if (!rec || rec.downloadState !== "COMPLETE") return undefined;
  return rec.package;
}

// Active attempt progress, scoped to worker + package + version. Restored after
// reload so a worker resumes exactly their own attempt, never another's.
export async function saveProgress(progress: Omit<AttemptProgress, "key" | "updatedAt">): Promise<AttemptProgress> {
  const record: AttemptProgress = {
    ...progress,
    key: progressKey(progress.workerId, progress.packageId, progress.version),
    updatedAt: new Date().toISOString(),
  };
  await idbPut("progress", record);
  return record;
}

export async function loadProgress(
  workerId: string,
  packageId: string,
  version: number,
): Promise<AttemptProgress | undefined> {
  const rec = await idbGet<AttemptProgress>("progress", progressKey(workerId, packageId, version));
  if (!rec || rec.workerId !== workerId) return undefined;
  return rec;
}

export async function clearProgress(workerId: string, packageId: string, version: number): Promise<void> {
  await idbDelete("progress", progressKey(workerId, packageId, version));
}

// Atomic completion transaction: attempts + syncQueue PENDING (+ completed
// progress flag) commit together before showing SAVED ON THIS PHONE.
export async function completeAttemptAtomically(payload: AttemptPayload): Promise<QueueEntry> {
  if (!payload.workerId) throw new Error("workerId is required to complete an attempt");
  const entry: QueueEntry = {
    attemptId: payload.attemptId,
    workerId: payload.workerId,
    state: "PENDING",
    retryCount: 0,
    nextRetryAt: Date.now(),
    payloadHash: payloadHash(payload),
  };
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["attempts", "syncQueue", "progress"], "readwrite");
      tx.objectStore("attempts").put({ ...payload, payloadHash: entry.payloadHash });
      const existing = tx.objectStore("syncQueue").get(payload.attemptId);
      existing.onsuccess = () => {
        // Never reset an existing queue entry: reloads and double taps must
        // not wipe retry state or resurrect terminal entries.
        if (!existing.result) tx.objectStore("syncQueue").put(entry);
      };
      const progressKeyValue = progressKey(payload.workerId, payload.moduleId, payload.moduleVersion);
      const progress = tx.objectStore("progress").get(progressKeyValue);
      progress.onsuccess = () => {
        if (progress.result) {
          tx.objectStore("progress").put({ ...progress.result, completed: true, updatedAt: new Date().toISOString() });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("completion transaction failed"));
    });
  } finally {
    db.close();
  }
  const stored = await idbGet<QueueEntry>("syncQueue", payload.attemptId);
  return stored ?? entry;
}

export async function getAttempt(attemptId: string): Promise<AttemptPayload | undefined> {
  return idbGet<AttemptPayload>("attempts", attemptId);
}

/** Legacy donor-compatible helper: queue attempt as LOCAL_DURABLE. */
export async function queueAttempt(attempt: AttemptPayload): Promise<void> {
  await completeAttemptAtomically(attempt);
}

/** Pending attempts for one worker; SYNCING entries are included so a reload
 *  can recover them, and the caller re-marks them PENDING via recoverOnReload. */
export async function listPendingAttempts(workerId?: string): Promise<QueueEntry[]> {
  const all = await idbGetAll<QueueEntry>("syncQueue");
  return all.filter(
    (e) =>
      (e.state === "PENDING" || e.state === "SYNCING") &&
      (workerId === undefined || e.workerId === workerId),
  );
}

export async function listQueue(workerId?: string): Promise<QueueEntry[]> {
  const all = await idbGetAll<QueueEntry>("syncQueue");
  return workerId === undefined ? all : all.filter((e) => e.workerId === workerId);
}

export async function markSyncing(attemptId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("syncQueue", "readwrite");
      const store = tx.objectStore("syncQueue");
      const req = store.get(attemptId);
      req.onsuccess = () => {
        if (req.result) store.put({ ...req.result, state: "SYNCING" });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("markSyncing failed"));
    });
  } finally {
    db.close();
  }
}

export async function applySyncResult(
  attemptId: string,
  status: number,
  serverResult?: unknown,
  errorMessage?: string,
): Promise<QueueEntry | undefined> {
  const decision = nextStateForHttp(status);
  const now = Date.now();
  const update = (prev: QueueEntry): QueueEntry => {
    if (decision === "CONFIRMED")
      return { ...prev, state: "CONFIRMED", serverResult, lastError: undefined };
    if (decision === "CONFLICT" || decision === "BLOCKED")
      return { ...prev, state: decision, serverResult, lastError: errorMessage };
    const retryCount = prev.retryCount + 1;
    return {
      ...prev,
      state: "PENDING",
      retryCount,
      nextRetryAt: now + backoffMs(retryCount),
      lastError: errorMessage,
    };
  };
  const db = await openDb();
  try {
    let next: QueueEntry | undefined;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("syncQueue", "readwrite");
      const store = tx.objectStore("syncQueue");
      const req = store.get(attemptId);
      req.onsuccess = () => {
        if (req.result) {
          next = update(req.result as QueueEntry);
          store.put(next);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("applySyncResult failed"));
    });
    return next;
  } finally {
    db.close();
  }
}

/** Page reload must recover PENDING/SYNCING as PENDING. */
export function recoverOnReload(entries: QueueEntry[]): QueueEntry[] {
  return entries.map((e) => (e.state === "SYNCING" ? { ...e, state: "PENDING" as const } : e));
}

/** Test-only: wipe all four stores in the fake-indexeddb database. */
export async function __clearAllForTests(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["packages", "progress", "attempts", "syncQueue"], "readwrite");
      for (const store of ["packages", "progress", "attempts", "syncQueue"] as const) {
        tx.objectStore(store).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("test clear failed"));
    });
  } finally {
    db.close();
  }
}
