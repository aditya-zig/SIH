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
    return stored;
  }

  get(draftId: string): StoredDraft | undefined {
    return this.drafts.get(draftId);
  }

  list(): StoredDraft[] {
    return [...this.drafts.values()];
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
    return next;
  }
}

// One shared in-memory store for the fixture-mode authoring flow.
export const localDraftStore = new LocalDraftStore();
