import { describe, expect, it } from "vitest";
import { evaluateAttempt } from "./evaluation/evaluateAttempt.js";
import { fireFixturePackage, fireFixtureScenario } from "./templates/fire.fixture.js";

function ev(sequence: number, stepId: string, kind: string, targetId: string) {
  return { sequence, stepId, kind, targetId };
}

const scenario = fireFixtureScenario as unknown as Parameters<typeof evaluateAttempt>[0];

function correctStream() {
  const events = fireFixturePackage.assessment.questions.map((q, index) => ev(index + 1, q.id, "answer", q.correctOption));
  return [
    ...events,
    ev(6, "select-extinguisher", "select", "co2"),
    ev(7, "pull", "interact", "pin"),
    ev(8, "aim", "select", "aim_zone"),
    ev(9, "squeeze", "hold", "trigger"),
    ev(10, "sweep-left", "select", "sweep_left"),
    ev(11, "sweep-right", "select", "sweep_right"),
    ev(12, "judgment", "decision", "evacuate"),
  ];
}

describe("browser provisional evaluator matches server semantics", () => {
  it("complete flagship journey scores 100 and passes", () => {
    expect(evaluateAttempt(scenario, correctStream())).toMatchObject({ score: 100, passed: true, criticalFailure: false });
  });

  it("one wrong knowledge answer still advances and permits a 4/5 pass", () => {
    const questions = fireFixturePackage.assessment.questions;
    const wrong = questions[0]!.options.find((option) => option !== questions[0]!.correctOption)!;
    const events = [
      ev(1, "q1", "answer", wrong),
      ...questions.slice(1).map((q, index) => ev(index + 2, q.id, "answer", q.correctOption)),
      ...correctStream().slice(5).map((event) => ({ ...event, sequence: event.sequence })),
    ];
    expect(evaluateAttempt(scenario, events)).toMatchObject({ score: 95, passed: true, criticalFailure: false });
  });

  it("two wrong knowledge answers complete the quiz but remain below the 4/5 gate", () => {
    const questions = fireFixturePackage.assessment.questions;
    const wrong1 = questions[0]!.options.find((option) => option !== questions[0]!.correctOption)!;
    const wrong2 = questions[1]!.options.find((option) => option !== questions[1]!.correctOption)!;
    const events = [
      ev(1, "q1", "answer", wrong1),
      ev(2, "q2", "answer", wrong2),
      ...questions.slice(2).map((q, index) => ev(index + 3, q.id, "answer", q.correctOption)),
    ];
    const result = evaluateAttempt(scenario, events);
    expect(result.events).toHaveLength(5);
    expect(result.score).toBe(15);
    expect(result.events.every((event) => event.outcome !== "rejected")).toBe(true);
  });

  it("sticky fixture critical failure remains sticky after completion", () => {
    const events = correctStream();
    const withWater = [
      ...events.slice(0, 5),
      ev(6, "select-extinguisher", "select", "water"),
      ...events.slice(5).map((event) => ({ ...event, sequence: event.sequence + 1 })),
    ];
    const result = evaluateAttempt(scenario, withWater);
    expect(result).toMatchObject({ score: 75, passed: false, criticalFailure: true });
  });

  it("missing judgment step fails even after knowledge and practical complete", () => {
    const result = evaluateAttempt(scenario, correctStream().slice(0, -1));
    expect(result.passed).toBe(false);
  });

  it("reordered input evaluates deterministically by sequence", () => {
    const orderedEvents = correctStream();
    const ordered = evaluateAttempt(scenario, orderedEvents);
    const shuffled = evaluateAttempt(scenario, [...orderedEvents].reverse());
    expect(shuffled).toEqual(ordered);
    expect(shuffled.passed).toBe(true);
  });

  it("sequence gap rejects", () => {
    expect(() => evaluateAttempt(scenario, [ev(2, "q1", "answer", fireFixturePackage.assessment.questions[0]!.correctOption)])).toThrow("contiguous");
  });

  it("duplicate sequence rejects", () => {
    expect(() => evaluateAttempt(scenario, [
      ev(1, "q1", "answer", fireFixturePackage.assessment.questions[0]!.correctOption),
      ev(1, "q2", "answer", fireFixturePackage.assessment.questions[1]!.correctOption),
    ])).toThrow("contiguous");
  });

  it("unknown action is rejected without advancing the first knowledge step", () => {
    const correct = fireFixturePackage.assessment.questions[0]!.correctOption;
    const result = evaluateAttempt(scenario, [
      ev(1, "q1", "unknown", "unknown"),
      ev(2, "q1", "answer", correct),
    ]);
    expect(result.events[0]).toMatchObject({ outcome: "rejected", scoreDelta: 0 });
    expect(result.events[1]).toMatchObject({ outcome: "accepted", scoreDelta: 5 });
    expect(result.score).toBe(5);
    expect(result.passed).toBe(false);
  });
});
