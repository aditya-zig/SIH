import { describe, expect, it } from "vitest";
import { evaluateAttempt } from "./evaluation/evaluateAttempt.js";
import { fireFixtureScenario } from "./templates/fire.fixture.js";

function ev(sequence: number, stepId: string, kind: string, targetId: string) {
  return { sequence, stepId, kind, targetId };
}

const scenario = fireFixtureScenario as unknown as Parameters<typeof evaluateAttempt>[0];

describe("browser provisional evaluator matches server semantics", () => {
  it("vector 4: sticky hard failure fixture scores 75, fails, critical", () => {
    const result = evaluateAttempt(scenario, [
      ev(1, "identify", "select", "electrical_fire"),
      ev(2, "extinguisher", "select", "water"),
      ev(3, "extinguisher", "select", "co2"),
      ev(4, "pin", "interact", "pin"),
      ev(5, "exit", "waypoint", "exit_a"),
    ]);
    expect(result).toMatchObject({ score: 75, passed: false, criticalFailure: true });
  });

  it("vector 3: missing required final step fails", () => {
    const result = evaluateAttempt(scenario, [
      ev(1, "identify", "select", "electrical_fire"),
      ev(2, "extinguisher", "select", "co2"),
      ev(3, "pin", "interact", "pin"),
    ]);
    expect(result.passed).toBe(false);
  });

  it("vector 5: reordered input evaluates deterministically by sequence", () => {
    const ordered = evaluateAttempt(scenario, [
      ev(1, "identify", "select", "electrical_fire"),
      ev(2, "extinguisher", "select", "co2"),
      ev(3, "pin", "interact", "pin"),
      ev(4, "exit", "waypoint", "exit_a"),
    ]);
    const shuffled = evaluateAttempt(scenario, [
      ev(4, "exit", "waypoint", "exit_a"),
      ev(2, "extinguisher", "select", "co2"),
      ev(1, "identify", "select", "electrical_fire"),
      ev(3, "pin", "interact", "pin"),
    ]);
    expect(shuffled).toEqual(ordered);
    expect(shuffled.passed).toBe(true);
  });

  it("vector 6: sequence gap rejects", () => {
    expect(() =>
      evaluateAttempt(scenario, [ev(2, "identify", "select", "electrical_fire")]),
    ).toThrow("contiguous");
  });

  it("vector 6: duplicate sequence rejects", () => {
    expect(() =>
      evaluateAttempt(scenario, [
        ev(1, "identify", "select", "electrical_fire"),
        ev(1, "extinguisher", "select", "co2"),
      ]),
    ).toThrow("contiguous");
  });

  it("vector 7: unknown action and wrong step are rejected with zero delta", () => {
    const result = evaluateAttempt(scenario, [
      ev(1, "identify", "select", "unknown_object"),
      ev(2, "pin", "interact", "pin"),
      ev(3, "identify", "select", "electrical_fire"),
    ]);
    expect(result.events[0]).toMatchObject({ outcome: "rejected", scoreDelta: 0 });
    expect(result.events[1]).toMatchObject({ outcome: "rejected", scoreDelta: 0 });
    expect(result.events[2]).toMatchObject({ outcome: "accepted" });
    expect(result.score).toBe(15);
    expect(result.passed).toBe(false);
  });
});
