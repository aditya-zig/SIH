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
    // Workers get no draft access: no draft policy mentions the worker role.
    const draftPolicies = s.split("on public.training_drafts").slice(1).join(" ");
    expect(draftPolicies).not.toMatch(/'worker'/);
    // Legacy open read policies are replaced with org-scoped ones.
    expect(s).toContain('drop policy if exists "published modules are readable"');
    expect(s).toContain("org members read own org modules");
    expect(s).toContain("org members read own org module versions");
  });

  it("authoring migration stays legacy-safe and never mutates versions", () => {
    const s = m1();
    expect(s).toContain("add column if not exists organization_id");
    expect(s).not.toMatch(/training_modules[^;]*set not null/i);
    for (const migration of [m1(), m2(), m3()]) {
      expect(migration).not.toMatch(/update\s+(public\.)?module_versions/i);
      expect(migration).not.toMatch(/delete\s+from\s+(public\.)?module_versions/i);
    }
  });

  it("publish RPC allocates versions under a lineage row lock", () => {
    const s = m2();
    expect(s).toMatch(/on conflict \(slug\) do nothing/i);
    expect(s).toMatch(/for update/i);
    expect(s).toContain("coalesce(max(version), 0) + 1");
    // Approval and authorization gates.
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
    // Worker persistence accepts trusted server-evaluated fields, so it must
    // remain service_role-only and must never be directly callable by workers.
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

    // The Edge Function verifies the caller's bearer token using Supabase Auth.
    expect(edge).toContain("supabase.auth.getUser(token)");
    // Worker-v2 payloads explicitly reject a client-supplied workerId.
    expect(edge).toContain('if ("workerId" in (value as object)) return false;');
    // The service-role RPC receives only the verified Auth user id.
    expect(edge).toContain("p_worker_id: userData.user.id");

    // A service-role PostgREST call does not carry the worker's auth.uid().
    // Therefore the persistence RPC must not pretend auth.uid() is the worker;
    // it re-validates the server-provided worker id against profiles/workers.
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
    // Certificates are looked up before insert: no duplicates on retry.
    expect(s).toContain("where attempt_id = p_attempt_id");
  });
});
