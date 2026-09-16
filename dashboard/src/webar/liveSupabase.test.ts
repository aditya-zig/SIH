import { describe, expect, it } from "vitest";
import { LocalDraftStore } from "./authoring/draftStore.js";
import { demoDraftFromFixture } from "./authoring/projectDraft.js";
import { buildRemoteDraftRow, parsePublishedTrainingRow } from "./api/liveSupabase.js";

async function storedDraft() {
  const store = new LocalDraftStore();
  return store.create({
    draftId: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000010",
    trainerId: "00000000-0000-4000-8000-000000000020",
    templateId: "fire-safety-induction",
    templateVersion: 1,
    draft: demoDraftFromFixture({
      draftId: "00000000-0000-4000-8000-000000000001",
      workplaceName: "Mine A",
      trainerInstructions: "induction",
      mediaNames: ["a.jpg"],
      locale: "en-IN",
    }),
  });
}

describe("live Supabase WebAR contracts", () => {
  it("persists the reviewed draft separately from publish projections", async () => {
    const stored = await storedDraft();
    const row = buildRemoteDraftRow(stored);
    expect(row.draft_json).toEqual(stored.draft);
    expect(row.content_hash).toBe(stored.contentHash);
    expect(row.package_json.packageId).toBe(stored.draftId);
    expect(row.scenario_json.id).toBe("fire_001");
    expect(row.status).toBe("AI_DRAFT");
  });

  it("parses an exact published package/version and rejects mismatches", async () => {
    const row = buildRemoteDraftRow(await storedDraft());
    const publishedPackage = { ...row.package_json, version: 3 };
    const liveRow = {
      id: "00000000-0000-4000-8000-000000000030",
      slug: "webar-fire-safety-induction-org",
      module_versions: [{ version: 3, package_json: publishedPackage, scenario_json: row.scenario_json }],
    };
    const bundle = parsePublishedTrainingRow(liveRow, 3);
    expect(bundle.moduleSlug).toBe(liveRow.slug);
    expect(bundle.package.version).toBe(3);
    expect(bundle.scenario.id).toBe("fire_001");
    expect(() => parsePublishedTrainingRow(liveRow, 2)).toThrow("not found");
  });
});
