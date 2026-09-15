import { createClient } from "npm:@supabase/supabase-js@2";
import {
  evaluateAttempt,
  type Scenario,
  type SubmittedEvent,
} from "../_shared/evaluate-attempt.ts";

type LegacyPayload = {
  attemptId: string;
  workerId: string;
  deviceId: string;
  moduleId: string;
  moduleVersion: number;
  startedAt: string;
  completedAt: string;
  clientScore: number;
  events: SubmittedEvent[];
};

// Worker sync v2: same shape minus workerId. Server resolves workerId = auth.uid().
type WorkerPayload = {
  attemptId: string;
  deviceId: string;
  moduleId: string;
  moduleVersion: number;
  startedAt: string;
  completedAt: string;
  clientScore: number;
  events: SubmittedEvent[];
};

const jsonHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function isLegacyPayload(value: unknown): value is LegacyPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<LegacyPayload>;
  return (
    typeof p.attemptId === "string" &&
    typeof p.workerId === "string" &&
    typeof p.deviceId === "string" &&
    typeof p.moduleId === "string" &&
    Number.isInteger(p.moduleVersion) &&
    typeof p.startedAt === "string" &&
    typeof p.completedAt === "string" &&
    Number.isInteger(p.clientScore) &&
    Array.isArray(p.events)
  );
}

function isWorkerPayload(value: unknown): value is WorkerPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<WorkerPayload & { workerId?: unknown }>;
  if ("workerId" in (value as object)) return false;
  return (
    typeof p.attemptId === "string" &&
    typeof p.deviceId === "string" &&
    typeof p.moduleId === "string" &&
    Number.isInteger(p.moduleVersion) &&
    typeof p.startedAt === "string" &&
    typeof p.completedAt === "string" &&
    Number.isInteger(p.clientScore) &&
    Array.isArray(p.events)
  );
}

async function evidenceHash(moduleId: string, moduleVersion: number, events: SubmittedEvent[]): Promise<string> {
  const canonical = JSON.stringify({
    moduleId,
    moduleVersion,
    events: [...events].sort((left, right) => left.sequence - right.sequence),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mapRpcError(error: { code?: string; message?: string }): { status: number; error: string } {
  const msg = error.message ?? "";
  if (error.code === "42501") return { status: 403, error: msg || "Not authorized for this worker" };
  if (msg.includes("different evidence") || msg.includes("belongs to another worker"))
    return { status: 409, error: msg };
  if (msg.includes("Unknown") || msg.includes("Cross-organization"))
    return { status: 403, error: msg };
  return { status: 500, error: "Attempt could not be stored" };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("authorization");
  if (!authorization) return response({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return response({ error: "Server is not configured" }, 500);

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

  const legacy = isLegacyPayload(body);
  const worker = !legacy && isWorkerPayload(body);
  if (!legacy && !worker) return response({ error: "Invalid attempt payload" }, 400);
  const payload = body as LegacyPayload | WorkerPayload;
  const workerId = legacy ? (body as LegacyPayload).workerId : userData.user.id;

  const { data: module, error: moduleError } = await supabase
    .from("training_modules")
    .select("id, module_versions!inner(version, scenario_json)")
    .eq("slug", payload.moduleId)
    .eq("module_versions.version", payload.moduleVersion)
    .single();
  if (moduleError || !module) return response({ error: "Unknown module version" }, 422);

  const version = (module as unknown as { module_versions: Array<{ scenario_json: unknown }> }).module_versions[0];
  if (!version) return response({ error: "Unknown module version" }, 422);

  let evaluation;
  try {
    evaluation = evaluateAttempt(version.scenario_json as Scenario, payload.events);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Invalid event stream" }, 422);
  }

  const hash = await evidenceHash(payload.moduleId, payload.moduleVersion, payload.events);

  if (legacy) {
    const { data, error } = await supabase.rpc("persist_evaluated_attempt", {
      p_attempt_id: payload.attemptId,
      p_trainer_id: userData.user.id,
      p_worker_id: workerId,
      p_module_id: (module as unknown as { id: string }).id,
      p_module_version: payload.moduleVersion,
      p_device_id: payload.deviceId,
      p_started_at: payload.startedAt,
      p_completed_at: payload.completedAt,
      p_client_score: payload.clientScore,
      p_server_score: evaluation.score,
      p_passed: evaluation.passed,
      p_critical_failure: evaluation.criticalFailure,
      p_evidence_hash: hash,
      p_events: evaluation.events,
    });
    if (error) {
      const mapped = mapRpcError(error);
      // Legacy 403 message preserved for historical clients.
      if (mapped.status === 403 && error.code === "42501")
        return response({ error: "Trainer is not authorized for this worker" }, 403);
      return response({ error: mapped.error }, mapped.status);
    }
    return response(data);
  }

  // Worker v2 path: auth.uid() is the worker; workerId never trusted from request.
  const { data, error } = await supabase.rpc("persist_worker_evaluated_attempt", {
    p_attempt_id: payload.attemptId,
    p_worker_id: userData.user.id,
    p_module_id: (module as unknown as { id: string }).id,
    p_module_version: payload.moduleVersion,
    p_device_id: payload.deviceId,
    p_started_at: payload.startedAt,
    p_completed_at: payload.completedAt,
    p_client_score: payload.clientScore,
    p_server_score: evaluation.score,
    p_passed: evaluation.passed,
    p_critical_failure: evaluation.criticalFailure,
    p_evidence_hash: hash,
    p_events: evaluation.events,
  });
  if (error) {
    const mapped = mapRpcError(error);
    return response({ error: mapped.error }, mapped.status);
  }
  return response(data);
});
