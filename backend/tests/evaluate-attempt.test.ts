import { describe, expect, it } from "vitest";
import { evaluateAttempt, type Scenario, type SubmittedEvent } from "../functions/_shared/evaluate-attempt.js";

const fireScenario: Scenario = {
  id: "fire_001",
  version: 1,
  passScore: 95,
  steps: [
    { id: "q1", score: 5, dimension: "knowledge", accept: [{ kind: "answer", targetId: "safe-1" }], wrongActions: [{ kind: "answer", targetId: "wrong-1", penalty: 0, critical: false } as never] },
    { id: "q2", score: 5, dimension: "knowledge", accept: [{ kind: "answer", targetId: "safe-2" }] },
    { id: "q3", score: 5, dimension: "knowledge", accept: [{ kind: "answer", targetId: "safe-3" }] },
    { id: "q4", score: 5, dimension: "knowledge", accept: [{ kind: "answer", targetId: "safe-4" }] },
    { id: "q5", score: 5, dimension: "knowledge", accept: [{ kind: "answer", targetId: "safe-5" }] },
    {
      id: "select-extinguisher",
      score: 5,
      dimension: "practical",
      accept: [{ kind: "select", targetId: "co2" }],
      wrongActions: [{ kind: "select", targetId: "water", penalty: 25, critical: true }],
    },
    { id: "pull", score: 5, dimension: "practical", accept: [{ kind: "interact", targetId: "pin" }] },
    { id: "aim", score: 10, dimension: "practical", accept: [{ kind: "select", targetId: "aim_zone" }] },
    { id: "squeeze", score: 10, dimension: "practical", accept: [{ kind: "hold", targetId: "trigger" }] },
    { id: "sweep-left", score: 7, dimension: "practical", accept: [{ kind: "select", targetId: "sweep_left" }] },
    { id: "sweep-right", score: 8, dimension: "practical", accept: [{ kind: "select", targetId: "sweep_right" }] },
    {
      id: "judgment",
      score: 30,
      dimension: "judgment",
      accept: [{ kind: "decision", targetId: "evacuate" }],
      wrongActions: [{ kind: "decision", targetId: "keep-fighting", penalty: 30, critical: false }],
    },
  ],
};

// Keep this cast local so the RED test can express the intended evaluator behavior
// before the shared contract gains the `advance` flag.
(fireScenario.steps[0]!.wrongActions![0] as unknown as { advance: boolean }).advance = true;

function event(sequence: number, stepId: string, kind: string, targetId: string): SubmittedEvent {
  return { sequence, stepId, kind, targetId };
}

function correctEvents(): SubmittedEvent[] {
  return [
    event(1, "q1", "answer", "safe-1"),
    event(2, "q2", "answer", "safe-2"),
    event(3, "q3", "answer", "safe-3"),
    event(4, "q4", "answer", "safe-4"),
    event(5, "q5", "answer", "safe-5"),
    event(6, "select-extinguisher", "select", "co2"),
    event(7, "pull", "interact", "pin"),
    event(8, "aim", "select", "aim_zone"),
    event(9, "squeeze", "hold", "trigger"),
    event(10, "sweep-left", "select", "sweep_left"),
    event(11, "sweep-right", "select", "sweep_right"),
    event(12, "judgment", "decision", "evacuate"),
  ];
}

describe("evaluateAttempt", () => {
  it("passes the complete Fire flagship event stream", () => {
    expect(evaluateAttempt(fireScenario, correctEvents())).toMatchObject({ score: 100, passed: true, criticalFailure: false });
  });

  it("advances after one wrong knowledge answer without awarding points", () => {
    const events = [
      event(1, "q1", "answer", "wrong-1"),
      event(2, "q2", "answer", "safe-2"),
      event(3, "q3", "answer", "safe-3"),
      event(4, "q4", "answer", "safe-4"),
      event(5, "q5", "answer", "safe-5"),
      ...correctEvents().slice(5),
    ];
    expect(evaluateAttempt(fireScenario, events)).toMatchObject({ score: 95, passed: true, criticalFailure: false });
  });

  it("keeps a critical practical failure sticky after all later steps finish", () => {
    const correct = correctEvents();
    const withWater = [
      ...correct.slice(0, 5),
      event(6, "select-extinguisher", "select", "water"),
      ...correct.slice(5).map((item) => ({ ...item, sequence: item.sequence + 1 })),
    ];
    expect(evaluateAttempt(fireScenario, withWater)).toMatchObject({ score: 75, passed: false, criticalFailure: true });
  });

  it("does not advance after an unsafe judgment choice", () => {
    const beforeJudgment = correctEvents().slice(0, -1);
    const result = evaluateAttempt(fireScenario, [...beforeJudgment, event(12, "judgment", "decision", "keep-fighting")]);
    expect(result.events.at(-1)).toMatchObject({ outcome: "penalized", scoreDelta: -30, critical: false });
    expect(result.passed).toBe(false);
  });

  it("rejects a non-contiguous event stream", () => {
    expect(() => evaluateAttempt(fireScenario, [event(2, "q1", "answer", "safe-1")])).toThrow("contiguous");
  });
});
