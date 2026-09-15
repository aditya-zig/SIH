// POST-only server function: generate-training-draft (P0 exact contract).
// Auth: bearer Supabase user; 401 unauthenticated; 403 wrong role/org.
// Secret: OPENROUTER_API_KEY server-only. Model: OPENROUTER_MODEL (free routing).
// One bounded repair on invalid JSON/schema. No silent paid fallback.
// Late results are discarded by the caller via revision/hash check (client sends
// draftId; server returns draft; client discards if its draft changed).
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildPrompt,
  cacheKey,
  validateDraftJson,
  validateDraftRequest,
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
  await new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("authorization");
  if (!authorization) return response({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
  const model = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
  if (!url || !serviceRoleKey) return response({ error: "Server is not configured" }, 500);
  if (!openRouterKey) return response({ error: "AI is not configured" }, 500);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

  // Role + org check against target draft.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", userData.user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role;
  const callerOrg = (profile as { organization_id?: string } | null)?.organization_id;
  if (role !== "trainer" && role !== "admin") return response({ error: "Trainer role required" }, 403);

  const { data: draft } = await supabase
    .from("training_drafts")
    .select("id, organization_id, revision, content_hash")
    .eq("id", req.draftId)
    .single();
  const draftOrg = (draft as { organization_id?: string } | null)?.organization_id;
  if (!draft) return response({ error: "Unknown draft" }, 400);
  if (draftOrg !== callerOrg) return response({ error: "Cross-organization access denied" }, 403);

  const key = cacheKey(req, `${req.templateId}@${req.templateVersion}`);
  const hit = cache.get(key);
  if (hit) return response({ draft: hit.draft, modelId: hit.modelId, cached: true });

  // Minimal approved-template invariants for P0 Fire. Full template library
  // lookup is a follow-up; unknown templates are rejected explicitly.
  if (req.templateId !== "fire-safety-induction") {
    return response({ error: "Unknown template" }, 400);
  }
  const template = {
    templateId: req.templateId,
    templateVersion: req.templateVersion,
    invariants: [
      "Do not fight a fire when evacuation is safer.",
      "Never use water on energized electrical equipment.",
    ],
  };

  const messages = buildPrompt(req, template);
  async function callModel(extraRepairHint?: string): Promise<{ text: string; modelId: string }> {
    const payloadMessages = extraRepairHint
      ? [...messages, { role: "user", content: `Previous output was invalid: ${extraRepairHint}. Return STRICT JSON only.` }]
      : messages;
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${openRouterKey}`,
        },
        body: JSON.stringify({
          model,
          messages: payloadMessages,
          response_format: { type: "json_object" },
        }),
      });
      if (res.status === 429) return Promise.reject({ status: 429, message: "Provider quota/rate limited" });
      if (res.status === 402) return Promise.reject({ status: 429, message: "Provider requires payment; no paid fallback" });
      if (res.status >= 500) {
        lastError = `Provider failure (${res.status})`;
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Promise.reject({ status: 502, message: `Provider failure: ${t.slice(0, 200)}` });
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, modelId: data.model ?? model };
    }
    return Promise.reject({ status: 502, message: lastError || "Provider failure" });
  }

  try {
    let first: { text: string; modelId: string };
    try {
      first = await callModel();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err.status === 429) return response({ error: err.message }, 429);
      return response({ error: err.message ?? "Provider failure" }, 502);
    }
    let parsedDraft: unknown;
    try {
      parsedDraft = JSON.parse(first.text);
    } catch {
      // One bounded repair for malformed JSON.
      try {
        const repaired = await callModel("malformed JSON");
        parsedDraft = JSON.parse(repaired.text);
        first = repaired;
      } catch {
        return response({ error: "Model returned invalid draft after repair" }, 422);
      }
    }
    let errors = validateDraftJson(parsedDraft);
    if (errors.length > 0) {
      try {
        const repaired = await callModel(errors.join(" "));
        parsedDraft = JSON.parse(repaired.text);
        first = repaired;
      } catch {
        return response({ error: "Model returned invalid draft after repair" }, 422);
      }
      errors = validateDraftJson(parsedDraft);
      if (errors.length > 0) return response({ error: "Model returned invalid draft after repair" }, 422);
    }
    cache.set(key, { draft: parsedDraft, modelId: first.modelId });
    return response({ draft: parsedDraft, modelId: first.modelId, cached: false });
  } catch {
    return response({ error: "Draft generation failed" }, 500);
  }
});
