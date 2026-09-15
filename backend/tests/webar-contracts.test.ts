import { describe, expect, it } from "vitest";
import { evaluateAttempt, type Scenario } from "../functions/_shared/evaluate-attempt.js";
import {
  cacheKey,
  validateDraftJson,
  validateDraftRequest,
} from "../functions/_shared/generate-draft-helpers.js";

const fireScenario: Scenario = {
  id: "fire_001",
  version: 1,
  passScore: 70,
  steps: [
    { id: "identify", score: 15, accept: [{ kind: "select", targetId: "electrical_fire" }] },
    {
      id: "extinguisher",
      score: 20,
      accept: [{ kind: "select", targetId: "co2" }],
      wrongActions: [{ kind: "select", targetId: "water", penalty: 25, critical: true }],
    },
    { id: "pin", score: 25, accept: [{ kind: "interact", targetId: "pin" }] },
    { id: "exit", score: 40, accept: [{ kind: "waypoint", targetId: "exit_a" }] },
  ],
};

const ev = (sequence: number, stepId: string, kind: string, targetId: string) => ({
  sequence,
  stepId,
  kind,
  targetId,
});

describe("server evaluator extra vectors (T02)", () => {
  it("reordered input evaluates deterministically", () => {
    const ordered = evaluateAttempt(fireScenario, [
      ev(1, "identify", "select", "electrical_fire"),
      ev(2, "extinguisher", "select", "co2"),
      ev(3, "pin", "interact", "pin"),
      ev(4, "exit", "waypoint", "exit_a"),
    ]);
    const shuffled = evaluateAttempt(fireScenario, [
      ev(4, "exit", "waypoint", "exit_a"),
      ev(1, "identify", "select", "electrical_fire"),
      ev(3, "pin", "interact", "pin"),
      ev(2, "extinguisher", "select", "co2"),
    ]);
    expect(shuffled).toEqual(ordered);
  });

  it("unknown action and wrong step are rejected with zero delta", () => {
    const result = evaluateAttempt(fireScenario, [
      ev(1, "identify", "select", "nope"),
      ev(2, "pin", "interact", "pin"),
      ev(3, "identify", "select", "electrical_fire"),
    ]);
    expect(result.events[0]).toMatchObject({ outcome: "rejected", scoreDelta: 0 });
    expect(result.events[1]).toMatchObject({ outcome: "rejected", scoreDelta: 0 });
    expect(result.score).toBe(15);
    expect(result.passed).toBe(false);
  });
});

describe("generate-draft helpers (T07 fixture parser)", () => {
  it("rejects invalid request shapes with 400 semantics", () => {
    expect(validateDraftRequest(null).ok).toBe(false);
    expect(
      validateDraftRequest({
        draftId: "not-a-uuid",
        templateId: "fire-safety-induction",
        templateVersion: 1,
        workplaceName: "w",
        media: [],
        trainerInstructions: "",
        locale: "en-IN",
      }).ok,
    ).toBe(false);
  });

  it("accepts a well-formed P0 request", () => {
    const r = validateDraftRequest({
      draftId: "00000000-0000-4000-8000-000000000001",
      templateId: "fire-safety-induction",
      templateVersion: 1,
      workplaceName: "Mine A",
      media: [{ storagePath: "org/a.jpg", mimeType: "image/jpeg" }],
      trainerInstructions: "",
      locale: "en-IN",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects executable code and external URLs in draft JSON", () => {
    const base = {
      draftId: "d",
      templateId: "fire-safety-induction",
      sceneSummary: "s",
      workplaceType: "mine",
      trainingSteps: [{ id: "a" }],
      arObjects: [],
      assessmentQuestions: [],
    };
    expect(validateDraftJson({ ...base, trainingSteps: [{ id: "a", evil: "<script>alert(1)</script>" }] }).length).toBeGreaterThan(0);
    expect(
      validateDraftJson({ ...base, sceneSummary: "see https://evil.example/x.glb" }).length,
    ).toBeGreaterThan(0);
  });

  it("cache key is stable for identical inputs", () => {
    const req = {
      draftId: "00000000-0000-4000-8000-000000000001",
      templateId: "fire-safety-induction",
      templateVersion: 1,
      workplaceName: "Mine A",
      media: [],
      trainerInstructions: "",
      locale: "en-IN",
    };
    expect(cacheKey(req, "t@1")).toBe(cacheKey(req, "t@1"));
  });
});
