import { describe, expect, it } from "vitest";
import { evaluateAttempt } from "./evaluation/evaluateAttempt.js";
import { validateTrainingPackage } from "./schema/validateTrainingPackage.js";
import { LocalDraftStore, StaleDraftError, canPublishStored } from "./authoring/draftStore.js";
import { demoDraftFromFixture, projectDraftToPackage, projectDraftToScenario } from "./authoring/projectDraft.js";
import { fireFixtureScenario } from "./templates/fire.fixture.js";
import { stageMedia, validateMediaFiles } from "./authoring/media.js";

const scenario = fireFixtureScenario as unknown as Parameters<typeof evaluateAttempt>[0];

function shellDraft(draftId: string) {
  return demoDraftFromFixture({
    draftId,
    workplaceName: "Mine A",
    trainerInstructions: "induction",
    mediaNames: ["a.jpg"],
    locale: "en-IN",
  });
}

describe("authoring media validation", () => {
  it("rejects empty, oversized, wrong-type, and over-count selections", () => {
    expect(validateMediaFiles([]).length).toBeGreaterThan(0);
    expect(validateMediaFiles([{ name: "x.pdf", type: "application/pdf", size: 10 }]).length).toBeGreaterThan(0);
    expect(validateMediaFiles([{ name: "x.jpg", type: "image/jpeg", size: 60 * 1024 * 1024 }]).length).toBeGreaterThan(0);
    expect(validateMediaFiles(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.jpg`, type: "image/jpeg", size: 10 }))).length).toBeGreaterThan(0);
    expect(validateMediaFiles([{ name: "a.jpg", type: "image/jpeg", size: 100 }])).toEqual([]);
  });

  it("stages file metadata without uploading", () => {
    const file = new File(["bytes"], "a.jpg", { type: "image/jpeg" });
    expect(stageMedia([file])).toEqual([{ name: "a.jpg", mimeType: "image/jpeg", bytes: 5, file }]);
  });
});

describe("draft store revision + approval", () => {
  it("creates AI_DRAFT with a content hash, approves the exact revision", async () => {
    const store = new LocalDraftStore();
    const created = await store.create({ draftId: "d1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("d1") });
    expect(created.status).toBe("AI_DRAFT");
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(canPublishStored(created)).toBe(false);
    const approved = await store.approve("d1", "t1");
    expect(approved.status).toBe("REVIEWED");
    expect(canPublishStored(approved)).toBe(true);
  });

  it("any edit bumps revision, rehashes, and clears approval", async () => {
    const store = new LocalDraftStore();
    const created = await store.create({ draftId: "d1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("d1") });
    await store.approve("d1", "t1");
    const edited = await store.edit("d1", (d) => ({
      ...d,
      trainingSteps: d.trainingSteps.map((s, i) => i === 0 ? { ...s, instruction: "Changed instruction." } : s),
    }));
    expect(edited.revision).toBe(created.revision + 1);
    expect(edited.status).toBe("AI_DRAFT");
    expect(edited.approvedHash).toBeNull();
    expect(edited.contentHash).not.toBe(created.contentHash);
    expect(canPublishStored(edited)).toBe(false);
  });

  it("survives full-page navigation through browser storage", async () => {
    const backing = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
      },
    };
    try {
      const first = new LocalDraftStore();
      await first.create({ draftId: "nav1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("nav1") });
      const second = new LocalDraftStore();
      expect(second.get("nav1")).toMatchObject({ revision: 1, status: "AI_DRAFT" });
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});

describe("stale generation guard", () => {
  it("rejects stale generation results that predate trainer edits", async () => {
    const store = new LocalDraftStore();
    const created = await store.create({ draftId: "d1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("d1") });
    const pinned = { revision: created.revision, contentHash: created.contentHash };
    await store.edit("d1", (d) => ({ ...d, sceneSummary: "trainer edited while AI ran" }));
    await expect(store.applyGeneration("d1", shellDraft("d1"), pinned)).rejects.toBeInstanceOf(StaleDraftError);
    const current = store.get("d1")!;
    const applied = await store.applyGeneration("d1", shellDraft("d1"), { revision: current.revision, contentHash: current.contentHash });
    expect(applied.revision).toBe(current.revision + 1);
  });
});

describe("draft projection", () => {
  it("projects the same scenario the evaluator fixture proves", async () => {
    const store = new LocalDraftStore();
    const created = await store.create({ draftId: "d1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("d1") });
    const projected = projectDraftToScenario(created.draft);
    expect(projected).toEqual(JSON.parse(JSON.stringify(scenario)));
  });

  it("projects a valid package whose entities match the draft objects", async () => {
    const store = new LocalDraftStore();
    const created = await store.create({ draftId: "d1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("d1") });
    const pkg = projectDraftToPackage(created, { workplaceId: "w1", title: "T" });
    expect(validateTrainingPackage(pkg)).toEqual([]);
    expect(pkg.scene.objects.map((o) => o.id).sort()).toEqual(created.draft.arObjects.map((o) => o.id).sort());
    expect(pkg.lessons).toHaveLength(5);
    expect(pkg.assessment.questions).toHaveLength(5);
  });

  it("edited drafts re-project deterministically", async () => {
    const store = new LocalDraftStore();
    await store.create({ draftId: "d1", organizationId: "o1", trainerId: "t1", templateId: "fire-safety-induction", templateVersion: 1, draft: shellDraft("d1") });
    const edited = await store.edit("d1", (d) => ({
      ...d,
      trainingSteps: d.trainingSteps.map((s) => s.id === "select-extinguisher" ? { ...s, voiceText: "Select the demo extinguisher now." } : s),
    }));
    const pkg = projectDraftToPackage(edited, { workplaceId: "w1", title: "T" });
    expect(pkg.voiceContent.lines.find((l) => l.stepId === "select-extinguisher")?.text).toBe("Select the demo extinguisher now.");
  });
});
