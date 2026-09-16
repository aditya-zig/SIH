// Static safety contract for the WebAR migrations (E06).
// No local Postgres exists in this environment (no psql/supabase CLI, docker
// daemon down), so live replay runs under B-LIVE-SUPABASE. These tests lock the
// reviewed safety properties of the SQL/function text so future edits cannot
// silently weaken locking, grants, isolation, immutability, or worker identity.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(backendDir, "supabase", "migrations");

function sql(name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function source(...parts: string[]): string {
  return readFileSync(join(backendDir, ...parts), "utf8");
}

const m1 = () => sql("202609150001_webar_authoring_ownership.sql");
const m2 = () => sql("202609150002_publish_training_draft.sql");
const m3 = () => sql("202609150003_worker_sync_v2.sql");
const m5 = () => sql("202609160001_preserve_legacy_shared_module_reads.sql");
const syncAttempt = () => source("functions", "sync-attempt", "index.ts");

describe("migration safety contract", () => {
  it("authoring migration scopes drafts and modules by organization", () => {
    const s = m1();
    expect(s).toContain("enable row level security");
    expect(s).toContain("current_organization_id()");
    expect(s).toContain("current_profile_role()");
    expect(s).toMatch(/for select to authenticated/);
    expect(s).toMatch(/for insert to authenticated/);
    expect(s).toMatch(/for update to authenticated/);
    const draftPolicies = s.split("on public.training_drafts").slice(1).join(" ");
    expect(draftPolicies).not.toMatch(/'worker'/);
    expect(s).toContain('drop policy if exists "published modules are readable"');
    expect(s).toContain("org members read own org modules");
    expect(s).toContain("org members read own org module versions");
  });

  it("forward compatibility migration preserves legacy shared modules only", () => {
    const s = m5();
    expect(s).toContain('drop policy if exists "org members read own org modules"');
    expect(s).toContain('drop policy if exists "org members read own org module versions"');
    expect(s).toMatch(/organization_id\s+is\s+null/i);
    expect(s).toMatch(/module\.organization_id\s+is\s+null/i);
    expect(s).toContain("organization_id = public.current_organization_id()");
    expect(s).toContain("module.organization_id = public.current_organization_id()");
  });

  it("authoring migration stays legacy-safe and never mutates versions", () => {
    const s = m1();
    expect(s).toContain("add column if not exists organization_id");
    expect(s).not.toMatch(/training_modules[^;]*set not null/i);
    for (const migration of [m1(), m2(), m3(), m5()]) {
      expect(migration).not.toMatch(/update\s+(public\.)?module_versions/i);
      expect(migration).not.toMatch(/delete\s+from\s+(public\.)?module_versions/i);
    }
  });

  it("publish RPC allocates versions under a lineage row lock", () => {
    const s = m2();
    expect(s).toMatch(/on conflict \(slug\) do nothing/i);
    expect(s).toMatch(/for update/i);
    expect(s).toContain("coalesce(max(version), 0) + 1");
    expect(s).toContain("Trainer role required");
    expect(s).toContain("Cross-organization draft access denied");
    expect(s).toContain("approved_hash");
    expect(s).toContain("status <> 'REVIEWED'");
  });

  it("definer functions pin search_path and minimal grants", () => {
    for (const s of [m2(), m3()]) {
      expect(s).toContain("security definer");
      expect(s).toMatch(/set search_path = public, extensions/);
      expect(s).toMatch(/revoke all on function/);
    }
    expect(m2()).toMatch(/grant execute on function public\.publish_training_draft\(uuid\) to authenticated/);
    expect(m3()).not.toMatch(
      /grant execute on function public\.persist_worker_evaluated_attempt[\s\S]*?\)\s+to authenticated;/i,
    );
    expect(m3()).toMatch(
      /grant execute on function public\.persist_worker_evaluated_attempt[\s\S]*?\)\s+to service_role;/i,
    );
  });

  it("worker sync derives identity from the verified bearer, never the request", () => {
    const migration = m3();
    const edge = syncAttempt();
    expect(edge).toContain("supabase.auth.getUser(token)");
    expect(edge).toContain('if ("workerId" in (value as object)) return false;');
    expect(edge).toContain("p_worker_id: userData.user.id");
    expect(migration).not.toContain("auth.uid()");
    expect(migration).toContain("Worker role required");
    expect(migration).toContain("Cross-organization module access denied");
    expect(migration).toContain("v_module_org is null");
  });

  it("worker sync keeps idempotent retry and conflict semantics", () => {
    const s = m3();
    expect(s).toContain("Attempt id was submitted with different evidence");
    expect(s).toContain("Attempt id belongs to another worker");
    expect(s).toMatch(/on conflict \(id\) do nothing/i);
    expect(s).toContain("where attempt_id = p_attempt_id");
  });
});
