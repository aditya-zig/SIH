import { describe, expect, it } from "vitest";
import { fireFixturePackage, fireFixtureScenario } from "./templates/fire.fixture.js";

describe("Fire flagship journey contract", () => {
  it("ships five short learning lessons before assessment", () => {
    const pkg = fireFixturePackage as typeof fireFixturePackage & {
      lessons?: ReadonlyArray<{ id: string; title: string; concept: string; checkPrompt: string; checkAnswer: string }>;
    };
    expect(pkg.lessons).toHaveLength(5);
    expect(pkg.lessons?.map((lesson) => lesson.id)).toEqual([
      "danger",
      "when-not-to-fight",
      "equipment",
      "pass",
      "alarm-exit",
    ]);
  });

  it("requires five knowledge questions with a 4/5 provisional threshold", () => {
    expect(fireFixturePackage.assessment.questions).toHaveLength(5);
    expect(fireFixturePackage.assessment.passThresholdPercent).toBe(80);
  });

  it("encodes measurable PASS actions plus a separate judgment decision", () => {
    expect(fireFixturePackage.trainingSteps.map((step) => step.id)).toEqual([
      "select-extinguisher",
      "pull",
      "aim",
      "squeeze",
      "sweep-left",
      "sweep-right",
      "judgment",
    ]);
    expect(fireFixtureScenario.steps.map((step) => step.id)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "select-extinguisher",
      "pull",
      "aim",
      "squeeze",
      "sweep-left",
      "sweep-right",
      "judgment",
    ]);
  });

  it("allocates 25/45/30 points to knowledge, practical and judgment", () => {
    const steps = fireFixtureScenario.steps as unknown as ReadonlyArray<{ score: number; dimension?: string }>;
    const totals = steps.reduce<Record<string, number>>((acc, step) => {
      const key = step.dimension ?? "unknown";
      acc[key] = (acc[key] ?? 0) + step.score;
      return acc;
    }, {});
    expect(totals).toMatchObject({ knowledge: 25, practical: 45, judgment: 30 });
  });
});
