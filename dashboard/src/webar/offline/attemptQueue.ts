// Offline contract — exact state machine from ACTIVE MECHANICAL EXECUTION SPEC.
// IndexedDB database: surakshaar-webar, version 1.
// Stores: packages [packageId, version], progress [workerId, packageId, version],
// attempts attemptId, syncQueue attemptId {PENDING|SYNCING|CONFIRMED|CONFLICT|BLOCKED}.
// Donor: WebSurAR src/attemptQueue.js (DB surakshaar-offline, single store) was
// minimal; this implements the full spec while keeping queueAttempt/listPending
// behavior compatible. No rewrite from scratch: same put/getAll shape extended.
export type SyncState = "PENDING" | "SYNCING" | "CONFIRMED" | "CONFLICT" | "BLOCKED";

export type QueueEntry = {
  attemptId: string;
  state: SyncState;
  retryCount: number;
  nextRetryAt: number;
  payloadHash: string;
  lastError?: string;
  serverResult?: unknown;
};

export type AttemptPayload = {
  attemptId: string;
  deviceId: string;
  moduleId: string;
  moduleVersion: number;
  startedAt: string;
  completedAt: string;
  clientScore: number;
  events: Array<{ sequence: number; stepId: string; kind: string; targetId: string }>;
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

function compoundKey(parts: Array<string | number>): string {
  return parts.map((p) => String(p)).join("::");
}

type MemoryStores = {
  packages: Map<string, unknown>;
  progress: Map<string, unknown>;
  attempts: Map<string, unknown>;
  syncQueue: Map<string, QueueEntry>;
};

// In-memory fallback for tests / non-browser environments. Browser path uses IndexedDB.
const memory: MemoryStores = {
  packages: new Map(),
  progress: new Map(),
  attempts: new Map(),
  syncQueue: new Map(),
};

function isBrowser(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  const out = await new Promise<T[]>((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  const out = await new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
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
  const key = compoundKey([packageId, version]);
  const record = { key, packageId, version, package: pkg, assetManifest, downloadState: "COMPLETE" as const, downloadedAt: new Date().toISOString() };
  if (!isBrowser()) {
    memory.packages.set(key, record);
    return;
  }
  await idbPut("packages", record);
}

export async function getPackage(packageId: string, version: number): Promise<unknown | undefined> {
  const key = compoundKey([packageId, version]);
  if (!isBrowser()) return memory.packages.get(key);
  const rec = await idbGet<{ package: unknown; downloadState: string }>("packages", key);
  if (!rec || rec.downloadState !== "COMPLETE") return undefined;
  return rec.package;
}

// Atomic completion transaction: write attempts + syncQueue PENDING in the same
// transaction before showing SAVED ON THIS PHONE.
export async function completeAttemptAtomically(payload: AttemptPayload): Promise<QueueEntry> {
  const entry: QueueEntry = {
    attemptId: payload.attemptId,
    state: "PENDING",
    retryCount: 0,
    nextRetryAt: Date.now(),
    payloadHash: payloadHash(payload),
  };
  if (!isBrowser()) {
    memory.attempts.set(payload.attemptId, { ...payload, payloadHash: entry.payloadHash });
    memory.syncQueue.set(payload.attemptId, entry);
    return entry;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["attempts", "syncQueue"], "readwrite");
    tx.objectStore("attempts").put({ ...payload, payloadHash: entry.payloadHash });
    tx.objectStore("syncQueue").put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return entry;
}

/** Legacy donor-compatible helper: queue attempt as LOCAL_DURABLE. */
export async function queueAttempt(attempt: AttemptPayload): Promise<void> {
  await completeAttemptAtomically(attempt);
}

/** Legacy donor-compatible helper: list all queued attempts. */
export async function listPendingAttempts(): Promise<QueueEntry[]> {
  if (!isBrowser()) return [...memory.syncQueue.values()].filter((e) => e.state === "PENDING" || e.state === "SYNCING");
  const all = await idbGetAll<QueueEntry>("syncQueue");
  return all.filter((e) => e.state === "PENDING" || e.state === "SYNCING");
}

export async function listQueue(): Promise<QueueEntry[]> {
  if (!isBrowser()) return [...memory.syncQueue.values()];
  return idbGetAll<QueueEntry>("syncQueue");
}

export async function markSyncing(attemptId: string): Promise<void> {
  if (!isBrowser()) {
    const e = memory.syncQueue.get(attemptId);
    if (e) memory.syncQueue.set(attemptId, { ...e, state: "SYNCING" });
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const req = store.get(attemptId);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, state: "SYNCING" });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
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
  if (!isBrowser()) {
    const prev = memory.syncQueue.get(attemptId);
    if (!prev) return undefined;
    const next = update(prev);
    memory.syncQueue.set(attemptId, next);
    return next;
  }
  const db = await openDb();
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
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return next;
}

/** Page reload must recover PENDING/SYNCING as PENDING. */
export function recoverOnReload(entries: QueueEntry[]): QueueEntry[] {
  return entries.map((e) => (e.state === "SYNCING" ? { ...e, state: "PENDING" as const } : e));
}

export function __resetMemoryForTests(): void {
  memory.packages.clear();
  memory.progress.clear();
  memory.attempts.clear();
  memory.syncQueue.clear();
}
