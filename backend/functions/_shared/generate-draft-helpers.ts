// Shared helpers for generate-training-draft (testable under Node/vitest).
// Contract: strict TrainingDraft JSON only; no JS/HTML/executable/asset URLs.

export type DraftRequest = {
  draftId: string;
  templateId: string;
  templateVersion: number;
  workplaceName: string;
  media: Array<{ storagePath: string; mimeType: string; frameTimeMs?: number }>;
  trainerInstructions: string;
  locale: string;
  expectedRevision?: number;
  expectedHash?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateDraftRequest(body: unknown): { ok: true; value: DraftRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request" };
  const b = body as Partial<DraftRequest>;
  if (typeof b.draftId !== "string" || !UUID_RE.test(b.draftId)) return { ok: false, error: "Invalid draftId" };
  if (typeof b.templateId !== "string" || !b.templateId) return { ok: false, error: "Invalid templateId" };
  if (!Number.isInteger(b.templateVersion) || (b.templateVersion ?? 0) < 1)
    return { ok: false, error: "Invalid templateVersion" };
  if (typeof b.workplaceName !== "string" || !b.workplaceName) return { ok: false, error: "Invalid workplaceName" };
  if (!Array.isArray(b.media)) return { ok: false, error: "Invalid media" };
  for (const m of b.media) {
    if (typeof m?.storagePath !== "string" || typeof m?.mimeType !== "string")
      return { ok: false, error: "Invalid media entry" };
  }
  if (typeof b.trainerInstructions !== "string") return { ok: false, error: "Invalid trainerInstructions" };
  if (typeof b.locale !== "string" || !b.locale) return { ok: false, error: "Invalid locale" };
  if (b.expectedRevision !== undefined && (!Number.isInteger(b.expectedRevision) || b.expectedRevision < 1))
    return { ok: false, error: "Invalid expectedRevision" };
  if (b.expectedHash !== undefined && (typeof b.expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(b.expectedHash)))
    return { ok: false, error: "Invalid expectedHash" };
  return { ok: true, value: b as DraftRequest };
}

const SUSPICIOUS = [/<script/i, /javascript:/i, /onerror\s*=/i, /<html/i, /eval\s*\(/i];

export function validateDraftJson(draft: unknown): string[] {
  const errors: string[] = [];
  if (!draft || typeof draft !== "object") return ["Draft must be an object."];
  const d = draft as Record<string, unknown>;
  for (const key of ["draftId", "templateId", "sceneSummary", "workplaceType"]) {
    if (typeof d[key] !== "string" || !(d[key] as string)) errors.push(`${key} is required.`);
  }
  if (!Number.isInteger(d["templateVersion"]) || Number(d["templateVersion"]) < 1)
    errors.push("templateVersion must be a positive integer.");
  if (!Array.isArray(d["trainingSteps"]) || (d["trainingSteps"] as unknown[]).length === 0)
    errors.push("trainingSteps must contain at least one step.");
  if (!Array.isArray(d["arObjects"])) errors.push("arObjects must be an array.");
  if (!Array.isArray(d["assessmentQuestions"])) errors.push("assessmentQuestions must be an array.");
  const blob = JSON.stringify(draft);
  for (const re of SUSPICIOUS) {
    if (re.test(blob)) {
      errors.push("Draft contains executable code or HTML; rejected.");
      break;
    }
  }
  const urlRe = /https?:\/\/[^\s"']+/gi;
  const urls = blob.match(urlRe) ?? [];
  const allowedHosts = ["openrouter.ai"];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname;
      if (!allowedHosts.includes(host)) {
        errors.push(`External asset URL rejected: ${u.slice(0, 80)}`);
        break;
      }
    } catch {
      errors.push("Unparseable URL in draft; rejected.");
      break;
    }
  }
  return errors;
}

export function validateDraftIdentity(draft: unknown, request: DraftRequest): string[] {
  if (!draft || typeof draft !== "object") return ["Draft identity is missing."];
  const d = draft as Record<string, unknown>;
  const errors: string[] = [];
  if (d["draftId"] !== request.draftId) errors.push("draftId does not match the requested draft.");
  if (d["templateId"] !== request.templateId) errors.push("templateId does not match the requested template.");
  if (d["templateVersion"] !== request.templateVersion) errors.push("templateVersion does not match the requested template version.");
  return errors;
}

export function mediaBelongsToDraft(
  media: DraftRequest["media"],
  organizationId: string,
  draftId: string,
): boolean {
  const prefix = `${organizationId}/${draftId}/`;
  return media.every((item) => item.storagePath.startsWith(prefix) && !item.storagePath.slice(prefix.length).includes("/../"));
}

export function cacheKey(req: DraftRequest, templateHash: string): string {
  return JSON.stringify({
    templateId: req.templateId,
    templateVersion: req.templateVersion,
    workplaceName: req.workplaceName,
    media: req.media,
    trainerInstructions: req.trainerInstructions,
    locale: req.locale,
    templateHash,
  });
}

export const ALLOWED_MEDIA_MIME = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
export const MAX_MEDIA_FILES = 10;
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export function validateMediaRefs(
  media: DraftRequest["media"],
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(media) || media.length === 0) return { ok: false, error: "At least one media ref is required" };
  if (media.length > MAX_MEDIA_FILES) return { ok: false, error: `At most ${MAX_MEDIA_FILES} media refs are supported` };
  for (const m of media) {
    if (!m.storagePath || typeof m.storagePath !== "string") return { ok: false, error: "Media ref is missing storagePath" };
    if (!ALLOWED_MEDIA_MIME.includes(m.mimeType)) return { ok: false, error: `Media MIME ${m.mimeType} is not allowed` };
    if (m.storagePath.startsWith("http://") || m.storagePath.startsWith("https://")) {
      return { ok: false, error: "Media storagePath must be a scoped storage path, not a URL" };
    }
  }
  return { ok: true };
}

export function checkStale(
  current: { revision: number; contentHash: string },
  expected?: { revision?: number; contentHash?: string },
): "ok" | "stale" {
  if (!expected || (expected.revision === undefined && expected.contentHash === undefined)) return "ok";
  if (expected.revision !== undefined && expected.revision !== current.revision) return "stale";
  if (expected.contentHash !== undefined && expected.contentHash !== current.contentHash) return "stale";
  return "ok";
}

export type VisionMedia = { mimeType: string; base64: string };
export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildVisionContent(
  req: DraftRequest,
  templateJson: unknown,
  images: VisionMedia[],
): Array<{ role: string; content: string | PromptPart[] }> {
  const brief: PromptPart[] = [
    {
      type: "text",
      text: JSON.stringify({
        draftId: req.draftId,
        template: templateJson,
        workplaceName: req.workplaceName,
        trainerInstructions: req.trainerInstructions,
        locale: req.locale,
      }),
    },
  ];
  for (const img of images) {
    brief.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
  }
  return [
    {
      role: "system",
      content:
        "You adapt an approved safety template to a workplace. Return STRICT JSON only matching TrainingDraft. " +
        "Preserve the supplied draftId, templateId and templateVersion exactly. " +
        "Do not invent or alter safety invariants, pass rules, or critical-failure rules. " +
        "No JavaScript, HTML, executable scripts, or arbitrary asset URLs. Unknown fire type, route safety, or geometry requires trainer confirmation fields.",
    },
    { role: "user", content: brief },
  ];
}

export function buildPrompt(req: DraftRequest, templateJson: unknown): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content:
        "You adapt an approved safety template to a workplace. Return STRICT JSON only matching TrainingDraft. " +
        "Preserve the supplied draftId, templateId and templateVersion exactly. " +
        "Do not invent or alter safety invariants, pass rules, or critical-failure rules. " +
        "No JavaScript, HTML, executable scripts, or arbitrary asset URLs. Unknown fire type, route safety, or geometry requires trainer confirmation fields.",
    },
    {
      role: "user",
      content: JSON.stringify({ draftId: req.draftId, template: templateJson, workplaceName: req.workplaceName, media: req.media, trainerInstructions: req.trainerInstructions, locale: req.locale }),
    },
  ];
}
