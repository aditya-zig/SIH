import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const sql = (name: string) => readFileSync(join(migrations, name), "utf8");

describe("WebAR publish/storage migration contracts", () => {
  it("stores deterministic projections separately from the reviewed draft", () => {
    const authoring = sql("202609150001_webar_authoring_ownership.sql");
    expect(authoring).toContain("package_json jsonb");
    expect(authoring).toContain("scenario_json jsonb");
    expect(authoring).toContain("module_versions_source_draft_revision_unique");
  });

  it("publishes the exact projection once per reviewed revision", () => {
    const publish = sql("202609150002_publish_training_draft.sql");
    expect(publish).toContain("v_draft.package_json");
    expect(publish).toContain("v_draft.scenario_json");
    expect(publish).toContain("source_draft_id = v_draft.id");
    expect(publish).toContain("source_draft_revision = v_draft.revision");
    expect(publish).toContain("'idempotent', true");
    expect(publish).toContain("jsonb_set(v_package, '{version}'");
  });

  it("keeps trainer media private and organization scoped", () => {
    const storage = sql("202609150004_training_media_storage.sql");
    expect(storage).toContain("'training-media'");
    expect(storage).toContain("false");
    expect(storage).toContain("for insert to authenticated");
    expect(storage).toContain("for select to authenticated");
    expect(storage).toContain("current_profile_role()");
    expect(storage).toContain("current_organization_id()::text");
    expect(storage).not.toMatch(/for update to authenticated/i);
  });
});
