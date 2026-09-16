import { describe, expect, it } from "vitest";
import { validateTrainingPackage, validateSceneDefinition } from "./schema/validateTrainingPackage.js";
import { compileEntities, resolveAssetUrl } from "./runtime/SceneRuntime.js";
import { FIRE_FIXTURE_LABEL, fireFixturePackage } from "./templates/fire.fixture.js";

describe("TrainingPackage validator (vectors 1, 2, 13)", () => {
  it("vector 1: valid Fire flagship fixture passes", () => {
    expect(fireFixturePackage.title).toContain("Fixture");
    expect(FIRE_FIXTURE_LABEL).toContain("NOT APPROVED");
    expect(fireFixturePackage.lessons).toHaveLength(5);
    expect(fireFixturePackage.assessment.questions).toHaveLength(5);
    expect(validateTrainingPackage(structuredClone(fireFixturePackage))).toEqual([]);
  });

  it("vector 2: duplicate object id is rejected", () => {
    const bad = structuredClone(fireFixturePackage);
    bad.arObjects.push({ ...bad.arObjects[0]! });
    expect(validateTrainingPackage(bad).some((e) => e.includes("Duplicate AR object id"))).toBe(true);
  });

  it("vector 2: missing referenced step is rejected", () => {
    const bad = structuredClone(fireFixturePackage);
    bad.arObjects[0] = { ...bad.arObjects[0]!, relatedStep: "nope" };
    expect(validateTrainingPackage(bad).some((e) => e.includes("unknown step"))).toBe(true);
  });

  it("vector 2: external asset URL is rejected", () => {
    const bad = structuredClone(fireFixturePackage);
    bad.assets[0] = { ...bad.assets[0]!, url: "https://evil.example/x.glb" };
    expect(validateTrainingPackage(bad).some((e) => e.includes("external URL"))).toBe(true);
  });

  it("vector 2: NaN transform is rejected", () => {
    const bad = structuredClone(fireFixturePackage);
    bad.scene.objects[0] = { ...bad.scene.objects[0]!, position: [NaN, 0, 0] };
    expect(validateTrainingPackage(bad).some((e) => e.includes("finite"))).toBe(true);
  });

  it("vector 2: missing mandatory Fire step is rejected", () => {
    const bad = structuredClone(fireFixturePackage);
    bad.trainingSteps = bad.trainingSteps.filter((s) => s.id !== "judgment");
    bad.evaluationRules = { ...bad.evaluationRules, requiredStepIds: bad.evaluationRules.requiredStepIds.filter((id) => id !== "judgment") };
    expect(validateTrainingPackage(bad).some((e) => e.includes("mandatory step"))).toBe(true);
  });

  it("vector 13: package objects map one-to-one to entities", () => {
    const entities = compileEntities(structuredClone(fireFixturePackage));
    expect(entities).toHaveLength(fireFixturePackage.scene.objects.length);
    expect(new Set(entities.map((e) => e.objectId))).toEqual(new Set(fireFixturePackage.scene.objects.map((o) => o.id)));
  });

  it("vector 13: untrusted asset key is rejected", () => {
    expect(() => resolveAssetUrl("https://evil.example/x.glb")).toThrow("Untrusted");
    expect(validateSceneDefinition({} as never).length).toBeGreaterThan(0);
  });
});
