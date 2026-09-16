import { describe, expect, it } from "vitest";
import {
  deriveFlagshipResumeState,
  deriveKnowledgeProgress,
  isFlagshipJourneyPackage,
} from "./pages/FlagshipWorkerJourney.js";
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

  it("routes enriched packages through the shared flagship journey", () => {
    expect(isFlagshipJourneyPackage(fireFixturePackage, fireFixtureScenario as never)).toBe(true);
    const legacy = structuredClone(fireFixturePackage);
    delete legacy.lessons;
    expect(isFlagshipJourneyPackage(legacy, fireFixtureScenario as never)).toBe(false);
  });

  it("advances after a wrong quiz answer while preserving the 4/5 gate", () => {
    const questions = fireFixturePackage.assessment.questions;
    const events = questions.map((question, index) => ({
      sequence: index + 1,
      stepId: question.id,
      kind: "answer",
      targetId: index === 0 ? question.options.find((option) => option !== question.correctOption)! : question.correctOption,
    }));
    const progress = deriveKnowledgeProgress(
      fireFixtureScenario as never,
      questions,
      fireFixturePackage.assessment.passThresholdPercent,
      events,
    );
    expect(progress).toMatchObject({ attempted: 5, correct: 4, requiredCorrect: 4, complete: true, passed: true });
  });

  it("blocks practical after 3/5 and resumes at the next unanswered quiz question", () => {
    const questions = fireFixturePackage.assessment.questions;
    const firstThree = questions.slice(0, 3).map((question, index) => ({
      sequence: index + 1,
      stepId: question.id,
      kind: "answer",
      targetId: index === 0 ? question.options.find((option) => option !== question.correctOption)! : question.correctOption,
    }));
    expect(
      deriveFlagshipResumeState(
        fireFixtureScenario as never,
        questions,
        fireFixturePackage.assessment.passThresholdPercent,
        fireFixturePackage.trainingSteps.filter((step) => step.id !== "judgment").map((step) => step.id),
        firstThree,
      ),
    ).toMatchObject({ phase: "quiz", quizIndex: 3, stepIndex: 0, knowledge: { attempted: 3, correct: 2 } });

    const fiveWithOnlyThreeCorrect = questions.map((question, index) => ({
      sequence: index + 1,
      stepId: question.id,
      kind: "answer",
      targetId: index < 2 ? question.options.find((option) => option !== question.correctOption)! : question.correctOption,
    }));
    expect(
      deriveFlagshipResumeState(
        fireFixtureScenario as never,
        questions,
        fireFixturePackage.assessment.passThresholdPercent,
        fireFixturePackage.trainingSteps.filter((step) => step.id !== "judgment").map((step) => step.id),
        fiveWithOnlyThreeCorrect,
      ),
    ).toMatchObject({ phase: "quiz-summary", knowledge: { attempted: 5, correct: 3, passed: false } });
  });
});