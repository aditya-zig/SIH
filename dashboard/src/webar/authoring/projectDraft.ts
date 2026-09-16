// Deterministic draft → TrainingPackage + evaluator Scenario projection.
// Trainer preview and the worker runtime consume this same projection, so what
// the trainer approves is exactly what the worker trains on. P0 supports the
// fire-safety-induction template; unknown templates throw instead of guessing.
import type { Scenario, TrainingDraft, TrainingPackage } from "../contracts.js";
import type { StoredDraft } from "./draftStore.js";
import { assertValidTrainingPackage } from "../schema/validateTrainingPackage.js";
import { FIRE_FIXTURE_LABEL, fireFixturePackage } from "../templates/fire.fixture.js";

export { FIRE_FIXTURE_LABEL };

const FIRE_STEP_SCORES: Record<string, number> = {
  identify: 15,
  extinguisher: 20,
  pin: 25,
  exit: 40,
};

export function projectDraftToScenario(draft: StoredDraft["draft"]): Scenario {
  if (draft.templateId !== "fire-safety-induction") {
    throw new Error(`No P0 scenario projection for template ${draft.templateId}`);
  }
  // P0 Fire scenario identity matches the proven evaluator fixture exactly.
  return {
    id: "fire_001",
    version: draft.templateVersion,
    passScore: 70,
    steps: draft.trainingSteps.map((s) => {
      const [kind, targetId] = s.expectedAction.split(":");
      const step: Scenario["steps"][number] = {
        id: s.id,
        score: FIRE_STEP_SCORES[s.id] ?? 10,
        accept: kind && targetId ? [{ kind, targetId }] : [],
      };
      // Fixture-known critical rule preserved through the projection.
      if (s.id === "extinguisher") {
        step.wrongActions = [{ kind: "select", targetId: "water", penalty: 25, critical: true }];
      }
      return step;
    }),
  };
}

export function projectDraftToPackage(
  stored: StoredDraft,
  input: { workplaceId: string; title: string },
): TrainingPackage {
  const d = stored.draft;
  // Preview projections render before approval exists; placeholders keep one
  // validated code path while the UI always shows the draft's real status.
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
    assets: [...new Set(d.arObjects.map((o) => o.assetKey))].map((assetKey) => ({
      assetKey,
      url: `/models/${assetKey}.glb`,
    })),
    hazards: d.hazards,
    learningObjectives: d.learningObjectives,
    trainingSteps: d.trainingSteps,
    assessment: {
      questions: d.assessmentQuestions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        correctOption: q.correctOption,
      })),
      passThresholdPercent: 70,
    },
    arObjects: d.arObjects,
    evaluationRules: {
      requiredStepIds: d.trainingSteps.map((s) => s.id),
      forbiddenActions: ["select:water"],
      quizThresholdPercent: 70,
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

// Labeled demo generation for environments without a live AI backend. Never
// presented as analysis of the uploaded workplace; the review UI always shows
// the DEMO SAMPLE banner alongside this content.
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
    trainingSteps: f.trainingSteps,
    // All five scene objects, including the water marker: the evaluator's
    // critical wrong action needs a visible, clickable target, and preview
    // must show exactly what the worker scene shows.
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
    })),
    warnings: ["Demo generation only; trainer review required."],
    reviewStatus: "AI_DRAFT",
  };
}
