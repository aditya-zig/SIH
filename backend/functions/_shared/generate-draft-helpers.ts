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
  // Arbitrary external asset URLs are rejected (trusted catalog only).
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

export function buildPrompt(req: DraftRequest, templateJson: unknown): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content:
        "You adapt an approved safety template to a workplace. Return STRICT JSON only matching TrainingDraft. " +
        "Do not invent or alter safety invariants, pass rules, or critical-failure rules. " +
        "No JavaScript, HTML, executable scripts, or arbitrary asset URLs. Unknown fire type, route safety, or geometry requires trainer confirmation fields.",
    },
    {
      role: "user",
      content: JSON.stringify({ template: templateJson, workplaceName: req.workplaceName, media: req.media, trainerInstructions: req.trainerInstructions, locale: req.locale }),
    },
  ];
}
