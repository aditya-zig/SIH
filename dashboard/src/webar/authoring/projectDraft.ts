// Deterministic draft → TrainingPackage + evaluator Scenario projection.
// Trainer preview and the worker runtime consume this same projection, so what
// the trainer approves is exactly what the worker trains on. P0 supports the
// fire-safety-induction template; unknown templates throw instead of guessing.
import type { CompetencyDimension, Scenario, TrainingDraft, TrainingPackage } from "../contracts.js";
import type { StoredDraft } from "./draftStore.js";
import { assertValidTrainingPackage } from "../schema/validateTrainingPackage.js";
import { FIRE_FIXTURE_LABEL, fireFixturePackage } from "../templates/fire.fixture.js";

export { FIRE_FIXTURE_LABEL };

const FIRE_STEP_SCORES: Record<string, number> = {
  "select-extinguisher": 5,
  pull: 5,
  aim: 10,
  squeeze: 10,
  "sweep-left": 7,
  "sweep-right": 8,
  judgment: 30,
};

function dimensionForStep(id: string): CompetencyDimension {
  return id === "judgment" ? "judgment" : "practical";
}

export function projectDraftToScenario(draft: StoredDraft["draft"]): Scenario {
  if (draft.templateId !== "fire-safety-induction") {
    throw new Error(`No P0 scenario projection for template ${draft.templateId}`);
  }
  const knowledgeSteps: Scenario["steps"] = draft.assessmentQuestions.map((question) => ({
    id: question.id,
    score: 5,
    dimension: "knowledge",
    accept: [{ kind: "answer", targetId: question.correctOption }],
    wrongActions: question.options
      .filter((option) => option !== question.correctOption)
      .map((targetId) => ({ kind: "answer", targetId, penalty: 5, critical: false })),
  }));
  const practicalSteps: Scenario["steps"] = draft.trainingSteps.map((step) => {
    const [kind, targetId] = step.expectedAction.split(":");
    const projected: Scenario["steps"][number] = {
      id: step.id,
      score: FIRE_STEP_SCORES[step.id] ?? 10,
      dimension: dimensionForStep(step.id),
      accept: kind && targetId ? [{ kind, targetId }] : [],
    };
    if (step.id === "select-extinguisher") {
      projected.wrongActions = [{ kind: "select", targetId: "water", penalty: 25, critical: true }];
    }
    if (step.id === "judgment") {
      projected.wrongActions = [
        { kind: "decision", targetId: "keep-fighting", penalty: 30, critical: false },
        { kind: "decision", targetId: "move-closer", penalty: 30, critical: false },
      ];
    }
    return projected;
  });
  return {
    id: "fire_001",
    version: draft.templateVersion,
    passScore: 95,
    steps: [...knowledgeSteps, ...practicalSteps],
  };
}

export function projectDraftToPackage(
  stored: StoredDraft,
  input: { workplaceId: string; title: string },
): TrainingPackage {
  const d = stored.draft;
  const pkg: TrainingPackage = {
    packageId: stored.draftId,
    version: 1,
    templateId: stored.templateId,
    templateVersion: stored.templateVersion,
    title: input.title,
    workplaceId: input.workplaceId,
    approvedBy: stored.approvedBy ?? "unapproved-draft",
    approvedAt: stored.approvedAt ?? new Date(0).toISOString(),
    contentHash: stored.contentHash,
    sourceMediaRefs: d.sourceMedia,
    scene: {
      schemaVersion: 1,
      sceneTemplateId: "industrial-room",
      sceneTemplateVersion: 1,
      units: "m",
      coordinateConvention: "y-up-right-handed",
      trainingRoot: "training-root",
      objects: d.arObjects.map((o, i) => ({
        id: o.id,
        assetKey: o.assetKey,
        position: o.positionHint ?? ([(i - 2) * 1.2, 1.2, -2] as [number, number, number]),
        interactionType: o.interactionType,
        relatedStepId: o.relatedStep,
        label: o.label,
      })),
      zones: [{ id: "training-zone", label: "Compact training zone", center: [0, 0, -2], size: [4, 2.5, 4] }],
      lighting: { ambient: 0.8, directional: 1.0 },
    },
    assets: [...new Set(d.arObjects.map((o) => o.assetKey))].map((assetKey) => ({ assetKey, url: `/models/${assetKey}.glb` })),
    hazards: d.hazards,
    learningObjectives: d.learningObjectives,
    ...(d.lessons ? { lessons: d.lessons } : {}),
    trainingSteps: d.trainingSteps,
    assessment: {
      questions: d.assessmentQuestions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        correctOption: q.correctOption,
        ...(q.explanation ? { explanation: q.explanation } : {}),
      })),
      passThresholdPercent: d.assessmentQuestions.length >= 5 ? 80 : 70,
    },
    arObjects: d.arObjects,
    evaluationRules: {
      requiredStepIds: d.trainingSteps.map((s) => s.id),
      forbiddenActions: ["select:water"],
      quizThresholdPercent: d.assessmentQuestions.length >= 5 ? 80 : 70,
    },
    voiceContent: {
      locale: "en-IN",
      lines: d.trainingSteps.map((s) => ({ stepId: s.id, text: s.voiceText })),
    },
    createdAt: new Date().toISOString(),
  };
  assertValidTrainingPackage(pkg);
  return pkg;
}

export function demoDraftFromFixture(input: {
  draftId: string;
  workplaceName: string;
  trainerInstructions: string;
  mediaNames: string[];
  locale: string;
}): TrainingDraft {
  const f = fireFixturePackage;
  void input.locale;
  return {
    draftId: input.draftId,
    templateId: "fire-safety-induction",
    templateVersion: 1,
    sourceMedia: input.mediaNames.map((name) => ({ storagePath: `local/${name}`, mimeType: "image/jpeg" })),
    sceneSummary: `Demo workplace: ${input.workplaceName}. Trainer note: ${input.trainerInstructions || "none"}`,
    workplaceType: input.workplaceName,
    detectedObjects: f.arObjects.map((o) => ({ id: o.id, label: o.label })),
    hazards: f.hazards,
    learningObjectives: f.learningObjectives,
    ...(f.lessons ? { lessons: f.lessons } : {}),
    trainingSteps: f.trainingSteps,
    arObjects: f.scene.objects.map((o) => ({
      id: o.id,
      type: "hazard",
      assetKey: o.assetKey,
      label: o.label ?? o.id,
      positionHint: o.position,
      interactionType: o.interactionType,
      relatedStep: o.relatedStepId,
    })),
    assessmentQuestions: f.assessment.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: q.options,
      correctOption: q.correctOption,
      ...(q.explanation ? { explanation: q.explanation } : {}),
    })),
    warnings: ["Demo generation only; trainer review required."],
    reviewStatus: "AI_DRAFT",
  };
}
