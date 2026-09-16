import type { CompetencyDimension, Scenario } from "../contracts.js";
import type { AttemptEvaluation } from "./evaluateAttempt.js";

export type CompetencyResult = Record<CompetencyDimension, number>;

const DIMENSIONS: CompetencyDimension[] = ["knowledge", "practical", "judgment"];

export function deriveCompetencyResult(scenario: Scenario, evaluation: AttemptEvaluation): CompetencyResult {
  const possible: Record<CompetencyDimension, number> = { knowledge: 0, practical: 0, judgment: 0 };
  const earned: Record<CompetencyDimension, number> = { knowledge: 0, practical: 0, judgment: 0 };
  const stepById = new Map(scenario.steps.map((step) => [step.id, step]));

  for (const step of scenario.steps) {
    if (step.dimension) possible[step.dimension] += step.score;
  }
  for (const event of evaluation.events) {
    const dimension = stepById.get(event.stepId)?.dimension;
    if (dimension) earned[dimension] += event.scoreDelta;
  }

  return DIMENSIONS.reduce<CompetencyResult>((result, dimension) => {
    const max = possible[dimension];
    const value = max > 0 ? Math.round((Math.max(0, earned[dimension]) / max) * 100) : 0;
    result[dimension] = Math.min(100, value);
    return result;
  }, { knowledge: 0, practical: 0, judgment: 0 });
}
