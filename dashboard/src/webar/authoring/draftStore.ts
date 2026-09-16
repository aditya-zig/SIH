// Local revision-tracked draft store. Same approval invariant as the database
// migration: content_hash = SHA-256(canonical draft_json); approval pins the
// hash; every edit/regeneration bumps revision, recomputes the hash, and clears
// approval back to AI_DRAFT. A generation result carrying a stale
// expectedRevision/expectedHash is rejected so late AI output can never
// overwrite newer trainer edits.
import { canonicalize, sha256Hex } from "../schema/draftApproval.js";
import type { TrainingDraft } from "../contracts.js";

export type StoredDraft = {
  draftId: string;
  organizationId: string;
  trainerId: string;
  templateId: string;
  templateVersion: number;
  revision: number;
  status: "AI_DRAFT" | "REVIEWED";
  draft: TrainingDraft;
  contentHash: string;
  approvedHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
};

export class StaleDraftError extends Error {
  constructor() {
    super("Draft changed since generation started; discarding stale result");
    this.name = "StaleDraftError";
  }
}

async function hashOf(draft: TrainingDraft): Promise<string> {
  return sha256Hex(canonicalize(draft));
}

export function canPublishStored(d: StoredDraft): boolean {
  return d.status === "REVIEWED" && !!d.approvedHash && d.approvedHash === d.contentHash;
}

export class LocalDraftStore {
  private readonly drafts = new Map<string, StoredDraft>();
  private readonly storageKey = "surakshaar-drafts-v1";

  constructor() {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (raw) {
        const list = JSON.parse(raw) as StoredDraft[];
        for (const d of list) {
          if (d && typeof d.draftId === "string") this.drafts.set(d.draftId, d);
        }
      }
    } catch {
      // No browser storage: memory map only.
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify([...this.drafts.values()]));
    } catch {
      // Storage full or unavailable: memory map still serves this page.
    }
  }

  async create(input: {
    draftId: string;
    organizationId: string;
    trainerId: string;
    templateId: string;
    templateVersion: number;
    draft: TrainingDraft;
  }): Promise<StoredDraft> {
    const contentHash = await hashOf(input.draft);
    const stored: StoredDraft = {
      ...input,
      revision: 1,
      status: "AI_DRAFT",
      contentHash,
      approvedHash: null,
      approvedBy: null,
      approvedAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.drafts.set(input.draftId, stored);
    this.persist();
    return stored;
  }

  get(draftId: string): StoredDraft | undefined {
    return this.drafts.get(draftId);
  }

  list(): StoredDraft[] {
    return [...this.drafts.values()];
  }

  // Used by the live authoring adapter to roll back an optimistic local change
  // when the matching Supabase revision/hash update loses a race or the network
  // write fails. This prevents localStorage from drifting ahead of the server.
  restore(snapshot: StoredDraft): StoredDraft {
    const copy = structuredClone(snapshot);
    this.drafts.set(copy.draftId, copy);
    this.persist();
    return copy;
  }

  async edit(
    draftId: string,
    mutate: (draft: TrainingDraft) => TrainingDraft,
  ): Promise<StoredDraft> {
    const current = this.drafts.get(draftId);
    if (!current) throw new Error("Unknown draft");
    const next: StoredDraft = {
      ...current,
      draft: mutate(structuredClone(current.draft)),
      revision: current.revision + 1,
      status: "AI_DRAFT",
      approvedHash: null,
      approvedBy: null,
      approvedAt: null,
      updatedAt: new Date().toISOString(),
    };
    next.contentHash = await hashOf(next.draft);
    this.drafts.set(draftId, next);
    this.persist();
    return next;
  }

  async applyGeneration(
    draftId: string,
    generated: TrainingDraft,
    expected: { revision: number; contentHash: string },
  ): Promise<StoredDraft> {
    const current = this.drafts.get(draftId);
    if (!current) throw new Error("Unknown draft");
    if (current.revision !== expected.revision || current.contentHash !== expected.contentHash) {
      throw new StaleDraftError();
    }
    const next: StoredDraft = {
      ...current,
      draft: generated,
      revision: current.revision + 1,
      status: "AI_DRAFT",
      approvedHash: null,
      approvedBy: null,
      approvedAt: null,
      updatedAt: new Date().toISOString(),
    };
    next.contentHash = await hashOf(next.draft);
    this.drafts.set(draftId, next);
    this.persist();
    return next;
  }

  async approve(draftId: string, approverId: string): Promise<StoredDraft> {
    const current = this.drafts.get(draftId);
    if (!current) throw new Error("Unknown draft");
    if (!current.contentHash) throw new Error("Draft has no content hash");
    const next: StoredDraft = {
      ...current,
      status: "REVIEWED",
      approvedHash: current.contentHash,
      approvedBy: approverId,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.drafts.set(draftId, next);
    this.persist();
    return next;
  }
}

export const localDraftStore = new LocalDraftStore();
