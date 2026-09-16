// Draft approval invariant: content_hash = SHA-256(canonical draft_json).
// Approval sets approved_hash/content. Any edit/regeneration increments revision,
// recomputes content_hash, clears approval, returns status to AI_DRAFT.
// Publication allowed only when status is REVIEWED and approved_hash == content_hash.
export type ReviewStatus = "AI_DRAFT" | "REVIEWED";

export type DraftMeta = {
  revision: number;
  contentHash: string;
  approvedHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  status: ReviewStatus;
};

export async function sha256Hex(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canPublish(meta: DraftMeta): boolean {
  return meta.status === "REVIEWED" && !!meta.approvedHash && meta.approvedHash === meta.contentHash;
}

export function approveDraft(
  meta: DraftMeta,
  approverId: string,
  approvedAt: string,
): DraftMeta {
  if (!meta.contentHash) throw new Error("Draft has no content hash");
  return {
    ...meta,
    status: "REVIEWED",
    approvedHash: meta.contentHash,
    approvedBy: approverId,
    approvedAt,
  };
}

export function invalidateOnEdit(meta: DraftMeta, nextContentHash: string): DraftMeta {
  return {
    revision: meta.revision + 1,
    contentHash: nextContentHash,
    approvedHash: null,
    approvedBy: null,
    approvedAt: null,
    status: "AI_DRAFT",
  };
}
