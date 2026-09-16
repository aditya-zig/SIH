import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSyncContext, isUsableSupabaseEnvValue } from "../../data.js";
import type { Scenario, TrainingPackage } from "../contracts.js";
import type { StoredDraft } from "../authoring/draftStore.js";
import { projectDraftToPackage, projectDraftToScenario } from "../authoring/projectDraft.js";
import { assertValidTrainingPackage } from "../schema/validateTrainingPackage.js";

export type LiveSupabaseSession = {
  client: SupabaseClient;
  userId: string;
  supabaseUrl: string;
  accessToken: string;
};

export type TrainerIdentity = LiveSupabaseSession & {
  organizationId: string;
  role: "trainer" | "admin";
};

export type PublishedTrainingBundle = {
  moduleId: string;
  moduleSlug: string;
  package: TrainingPackage;
  scenario: Scenario;
};

export class RemoteDraftConflictError extends Error {
  constructor() {
    super("Remote draft changed; reload before saving this edit");
    this.name = "RemoteDraftConflictError";
  }
}

function anonKey(): string | undefined {
  const value = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!isUsableSupabaseEnvValue(value)) return undefined;
  return value!.trim();
}

export async function getLiveSupabaseSession(): Promise<LiveSupabaseSession | null> {
  const context = await getSyncContext().catch(() => null);
  const key = anonKey();
  if (!context || !key) return null;
  const client = createClient(context.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { authorization: `Bearer ${context.accessToken}` } },
  });
  return {
    client,
    userId: context.workerId,
    supabaseUrl: context.supabaseUrl,
    accessToken: context.accessToken,
  };
}

export async function requireTrainerIdentity(): Promise<TrainerIdentity> {
  const session = await getLiveSupabaseSession();
  if (!session) throw new Error("Authenticated Supabase session required");
  const { data, error } = await session.client
    .from("profiles")
    .select("role, organization_id")
    .eq("id", session.userId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Trainer profile unavailable");
  const role = data.role as string;
  if (role !== "trainer" && role !== "admin") throw new Error("Trainer role required");
  if (!data.organization_id) throw new Error("Trainer organization unavailable");
  return { ...session, role, organizationId: data.organization_id as string };
}

export function buildRemoteDraftProjection(stored: StoredDraft) {
  const pkg = projectDraftToPackage(stored, {
    workplaceId: stored.organizationId,
    title: stored.draft.workplaceType || stored.templateId,
  });
  const scenario = projectDraftToScenario(stored.draft);
  return { packageJson: pkg, scenarioJson: scenario };
}

export function buildRemoteDraftRow(stored: StoredDraft) {
  const projection = buildRemoteDraftProjection(stored);
  return {
    id: stored.draftId,
    organization_id: stored.organizationId,
    trainer_id: stored.trainerId,
    template_id: stored.templateId,
    template_version: stored.templateVersion,
    revision: stored.revision,
    status: stored.status,
    draft_json: stored.draft,
    package_json: projection.packageJson,
    scenario_json: projection.scenarioJson,
    content_hash: stored.contentHash,
    approved_hash: stored.approvedHash,
    approved_by: stored.approvedBy,
    approved_at: stored.approvedAt,
    updated_at: stored.updatedAt,
  };
}

export async function createRemoteDraft(identity: TrainerIdentity, stored: StoredDraft): Promise<void> {
  if (stored.organizationId !== identity.organizationId || stored.trainerId !== identity.userId) {
    throw new Error("Draft identity does not match authenticated trainer");
  }
  const { error } = await identity.client.from("training_drafts").insert(buildRemoteDraftRow(stored));
  if (error) throw new Error(`Remote draft create failed: ${error.message}`);
}

export async function updateRemoteDraft(
  identity: TrainerIdentity,
  stored: StoredDraft,
  expected: { revision: number; contentHash: string },
): Promise<void> {
  if (stored.organizationId !== identity.organizationId || stored.trainerId !== identity.userId) {
    throw new Error("Draft identity does not match authenticated trainer");
  }
  const row = buildRemoteDraftRow(stored);
  const { id: _id, organization_id: _org, trainer_id: _trainer, ...changes } = row;
  const { data, error } = await identity.client
    .from("training_drafts")
    .update(changes)
    .eq("id", stored.draftId)
    .eq("revision", expected.revision)
    .eq("content_hash", expected.contentHash)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Remote draft update failed: ${error.message}`);
  if (!data) throw new RemoteDraftConflictError();
}

export async function publishRemoteDraft(
  identity: TrainerIdentity,
  draftId: string,
): Promise<{ moduleId: string; slug: string; version: number; contentHash: string; idempotent?: boolean }> {
  const { data, error } = await identity.client.rpc("publish_training_draft", { p_draft_id: draftId });
  if (error) throw new Error(`Publish failed: ${error.message}`);
  if (!data || typeof data !== "object") throw new Error("Publish returned no result");
  return data as { moduleId: string; slug: string; version: number; contentHash: string; idempotent?: boolean };
}

function parseScenario(value: unknown): Scenario {
  if (!value || typeof value !== "object") throw new Error("Published scenario is missing");
  const s = value as Partial<Scenario>;
  if (typeof s.id !== "string" || !Number.isInteger(s.version) || typeof s.passScore !== "number" || !Array.isArray(s.steps)) {
    throw new Error("Published scenario is invalid");
  }
  return value as Scenario;
}

export function parsePublishedTrainingRow(row: unknown, expectedVersion: number): PublishedTrainingBundle {
  if (!row || typeof row !== "object") throw new Error("Published training not found");
  const r = row as { id?: unknown; slug?: unknown; module_versions?: unknown };
  const versions = Array.isArray(r.module_versions) ? r.module_versions : [r.module_versions];
  const versionRow = versions.find(
    (item) => item && typeof item === "object" && Number((item as { version?: unknown }).version) === expectedVersion,
  ) as { version?: number; package_json?: unknown; scenario_json?: unknown } | undefined;
  if (typeof r.id !== "string" || typeof r.slug !== "string" || !versionRow) {
    throw new Error("Published training not found");
  }
  const pkg = versionRow.package_json as TrainingPackage;
  assertValidTrainingPackage(pkg);
  if (pkg.version !== expectedVersion) throw new Error("Published package version mismatch");
  return {
    moduleId: r.id,
    moduleSlug: r.slug,
    package: pkg,
    scenario: parseScenario(versionRow.scenario_json),
  };
}

export async function loadPublishedTraining(moduleSlug: string, version: number): Promise<PublishedTrainingBundle> {
  const session = await getLiveSupabaseSession();
  if (!session) throw new Error("Sign in once before downloading this training");
  const { data, error } = await session.client
    .from("training_modules")
    .select("id, slug, module_versions!inner(version, package_json, scenario_json)")
    .eq("slug", moduleSlug)
    .eq("active", true)
    .eq("module_versions.version", version)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Published training not found");
  return parsePublishedTrainingRow(data, version);
}
