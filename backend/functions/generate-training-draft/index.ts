// POST-only server function: generate-training-draft.
// Auth: bearer Supabase user; 401 unauthenticated; 403 wrong role/org.
// Secret: OPENROUTER_API_KEY server-only. One bounded output repair; no paid fallback.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildVisionContent,
  cacheKey,
  checkStale,
  mediaBelongsToDraft,
  MAX_MEDIA_BYTES,
  validateDraftIdentity,
  validateDraftJson,
  validateDraftRequest,
  validateMediaRefs,
  type DraftRequest,
  type VisionMedia,
} from "../_shared/generate-draft-helpers.ts";

const jsonHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

const cache = new Map<string, { draft: unknown; modelId: string }>();

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function validateCandidate(text: string, request: DraftRequest): { draft?: unknown; errors: string[] } {
  let draft: unknown;
  try {
    draft = JSON.parse(text);
  } catch {
    return { errors: ["malformed JSON"] };
  }
  return {
    draft,
    errors: [...validateDraftJson(draft), ...validateDraftIdentity(draft, request)],
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("authorization");
  if (!authorization) return response({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
  const model = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
  if (!url || !serviceRoleKey) return response({ error: "Server is not configured" }, 500);
  if (!openRouterKey) return response({ error: "AI is not configured" }, 500);

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return response({ error: "Invalid session" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Invalid JSON" }, 400);
  }
  const parsed = validateDraftRequest(body);
  if (!parsed.ok) return response({ error: parsed.error }, 400);
  const req = parsed.value;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", userData.user.id)
    .single();
  if (profileError || !profile) return response({ error: "Profile unavailable" }, 403);
  const role = (profile as { role?: string }).role;
  const callerOrg = (profile as { organization_id?: string }).organization_id;
  if (role !== "trainer" && role !== "admin") return response({ error: "Trainer role required" }, 403);
  if (!callerOrg) return response({ error: "Trainer organization unavailable" }, 403);

  const { data: draft, error: draftError } = await supabase
    .from("training_drafts")
    .select("id, organization_id, revision, content_hash")
    .eq("id", req.draftId)
    .single();
  if (draftError || !draft) return response({ error: "Unknown draft" }, 400);
  const draftRow = draft as { organization_id: string; revision: number; content_hash: string };
  if (draftRow.organization_id !== callerOrg) return response({ error: "Cross-organization access denied" }, 403);

  const observed = { revision: draftRow.revision, contentHash: draftRow.content_hash };
  if (checkStale(observed, { revision: req.expectedRevision, contentHash: req.expectedHash }) === "stale") {
    return response({ error: "Draft changed since generation started" }, 409);
  }

  const mediaCheck = validateMediaRefs(req.media);
  if (!mediaCheck.ok) return response({ error: mediaCheck.error }, 400);
  if (!mediaBelongsToDraft(req.media, callerOrg, req.draftId)) {
    return response({ error: "Media must belong to the caller organization and target draft" }, 403);
  }

  const images: VisionMedia[] = [];
  for (const item of req.media) {
    if (!item.mimeType.startsWith("image/")) continue;
    const { data: blob, error: dlError } = await supabase.storage.from("training-media").download(item.storagePath);
    if (dlError || !blob) {
      const missing = (dlError?.message ?? "").toLowerCase().includes("not found");
      return response(
        { error: missing ? `Media not found: ${item.storagePath}` : "Media storage unavailable" },
        missing ? 400 : 500,
      );
    }
    if (blob.size > MAX_MEDIA_BYTES) return response({ error: `Media larger than the P0 limit: ${item.storagePath}` }, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    images.push({ mimeType: item.mimeType, base64: btoa(binary) });
  }
  if (images.length === 0) return response({ error: "At least one image or extracted video frame is required" }, 400);

  if (req.templateId !== "fire-safety-induction") return response({ error: "Unknown template" }, 400);
  const template = {
    templateId: req.templateId,
    templateVersion: req.templateVersion,
    fixtureStatus: "DEMO FIXTURE — NOT APPROVED SAFETY PROCEDURE",
    invariants: [
      "Do not fight a fire when evacuation is safer.",
      "Never use water on energized electrical equipment.",
    ],
  };

  const exactCacheKey = JSON.stringify({
    base: cacheKey(req, `${req.templateId}@${req.templateVersion}`),
    draftId: req.draftId,
    observedRevision: observed.revision,
    observedHash: observed.contentHash,
  });
  const hit = cache.get(exactCacheKey);
  if (hit) return response({ draft: hit.draft, modelId: hit.modelId, cached: true });

  const messages = buildVisionContent(req, template, images);
  async function callModel(repairHint?: string): Promise<{ text: string; modelId: string }> {
    const payloadMessages = repairHint
      ? [...messages, { role: "user", content: `Previous output was invalid: ${repairHint}. Return STRICT JSON only.` }]
      : messages;
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${openRouterKey}` },
        body: JSON.stringify({ model, messages: payloadMessages, response_format: { type: "json_object" } }),
      });
      if (res.status === 429) throw { status: 429, message: "Provider quota/rate limited" };
      if (res.status === 402) throw { status: 429, message: "Provider requires payment; no paid fallback" };
      if (res.status >= 500) {
        lastError = `Provider failure (${res.status})`;
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw { status: 502, message: `Provider failure: ${text.slice(0, 200)}` };
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
      return { text: data.choices?.[0]?.message?.content ?? "", modelId: data.model ?? model };
    }
    throw { status: 502, message: lastError || "Provider failure" };
  }

  const providerFailure = (error: unknown): Response => {
    const e = error as { status?: number; message?: string };
    if (e.status === 429) return response({ error: e.message ?? "Provider rate limited" }, 429);
    return response({ error: e.message ?? "Provider failure" }, 502);
  };

  let modelResult: { text: string; modelId: string };
  try {
    modelResult = await callModel();
  } catch (error) {
    return providerFailure(error);
  }

  let candidate = validateCandidate(modelResult.text, req);
  if (candidate.errors.length > 0) {
    // Exactly one output-repair request. Transport retries inside callModel do
    // not count as another repair because they never produced model output.
    try {
      modelResult = await callModel(candidate.errors.join(" "));
    } catch (error) {
      return providerFailure(error);
    }
    candidate = validateCandidate(modelResult.text, req);
    if (candidate.errors.length > 0) {
      return response({ error: "Model returned invalid draft after repair", details: candidate.errors }, 422);
    }
  }

  // Re-read after the provider call. A trainer edit that happened while the AI
  // was running invalidates the result even if the original request was current.
  const { data: latest } = await supabase
    .from("training_drafts")
    .select("revision, content_hash")
    .eq("id", req.draftId)
    .single();
  if (
    !latest ||
    Number((latest as { revision?: number }).revision) !== observed.revision ||
    (latest as { content_hash?: string }).content_hash !== observed.contentHash
  ) {
    return response({ error: "Draft changed while generation was running" }, 409);
  }

  cache.set(exactCacheKey, { draft: candidate.draft, modelId: modelResult.modelId });
  return response({ draft: candidate.draft, modelId: modelResult.modelId, cached: false });
});
