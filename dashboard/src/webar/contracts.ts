// Canonical WebAR contracts — mirrors ACTIVE MECHANICAL EXECUTION SPEC.
// Identifier rules: DB entity IDs are UUID strings; templateId is kebab-case;
// templateVersion/version/revision/sequence are positive integers;
// contentHash/approvalHash are lowercase SHA-256 hex; timestamps are UTC ISO-8601;
// step/object/rule IDs are package-local stable strings, unique inside package.

export type TrainingStepBlueprint = {
  id: string;
  instruction: string;
  voiceText?: string;
  objectReference?: string;
  expectedAction: string;
  successFeedback?: string;
  failureFeedback?: string;
  remediation?: string;
  safetyRuleReference?: string;
};

export type AssessmentBlueprint = {
  id: string;
  prompt: string;
  options?: string[];
  correctOption?: string;
};

export type ARObjectBlueprint = {
  id: string;
  assetKey: string;
  label: string;
  interactionType: string;
  relatedStep?: string;
};

export type SafetyRule = {
  id: string;
  text: string;
};

export type TrainingTemplate = {
  templateId: string;
  version: number;
  name: string;
  description: string;
  category: string;
  thumbnail: string;
  supportedWorkplaceTypes: string[];
  defaultLearningObjectives: string[];
  requiredHazardTypes: string[];
  optionalHazardTypes: string[];
  trainingStepBlueprints: TrainingStepBlueprint[];
  assessmentBlueprints: AssessmentBlueprint[];
  arObjectBlueprints: ARObjectBlueprint[];
  voiceStyle: string;
  difficulty: "easy" | "medium" | "hard";
  estimatedDuration: number;
  safetyRules: SafetyRule[];
  requiredTrainerConfirmations: string[];
};

export type SourceMediaRef = {
  storagePath: string;
  mimeType: string;
  frameTimeMs?: number;
};

export type DetectedObject = {
  id: string;
  label: string;
  confidence?: number;
  sourceFrame?: string;
};

export type Hazard = {
  id: string;
  label: string;
  severity: string;
  reason: string;
  sourceFrame?: string;
  region?: unknown;
  trainerMustConfirm: boolean;
};

export type TrainingStep = {
  id: string;
  order: number;
  instruction: string;
  voiceText: string;
  objectReference?: string;
  expectedAction: string;
  successFeedback: string;
  failureFeedback: string;
  remediation?: string;
  safetyRuleReference?: string;
};

export type AssessmentQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctOption: string;
};

export type ARObject = {
  id: string;
  type: string;
  assetKey: string;
  label: string;
  positionHint?: [number, number, number];
  interactionType: string;
  relatedStep?: string;
};

export type TrainingDraft = {
  draftId: string;
  templateId: string;
  templateVersion: number;
  sourceMedia: SourceMediaRef[];
  sceneSummary: string;
  workplaceType: string;
  detectedObjects: DetectedObject[];
  hazards: Hazard[];
  learningObjectives: string[];
  trainingSteps: TrainingStep[];
  assessmentQuestions: AssessmentQuestion[];
  arObjects: ARObject[];
  warnings: string[];
  reviewStatus: "AI_DRAFT" | "REVIEWED";
};

export type SceneObject = {
  id: string;
  assetKey: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  interactionType: string;
  relatedStepId?: string;
  label?: string;
};

export type SceneZone = {
  id: string;
  label?: string;
  center: [number, number, number];
  size: [number, number, number];
};

export type SceneDefinition = {
  schemaVersion: number;
  sceneTemplateId: string;
  sceneTemplateVersion: number;
  units: "m";
  coordinateConvention: string;
  trainingRoot: string;
  objects: SceneObject[];
  zones: SceneZone[];
  lighting: Record<string, unknown>;
};

export type AssetRef = {
  assetKey: string;
  url: string;
  hash?: string;
  bytes?: number;
};

export type AssessmentDefinition = {
  questions: AssessmentQuestion[];
  passThresholdPercent: number;
};

export type EvaluationRules = {
  requiredStepIds: string[];
  forbiddenActions: string[];
  quizThresholdPercent: number;
};

export type VoiceContent = {
  locale: string;
  lines: Array<{ stepId: string; text: string }>;
};

export type TrainingPackage = {
  packageId: string;
  version: number;
  templateId: string;
  templateVersion: number;
  title: string;
  workplaceId: string;
  approvedBy: string;
  approvedAt: string;
  contentHash: string;
  sourceMediaRefs: SourceMediaRef[];
  scene: SceneDefinition;
  assets: AssetRef[];
  hazards: Hazard[];
  learningObjectives: string[];
  trainingSteps: TrainingStep[];
  assessment: AssessmentDefinition;
  arObjects: ARObject[];
  evaluationRules: EvaluationRules;
  voiceContent: VoiceContent;
  createdAt: string;
};

// Server evaluator projection (backend/functions/_shared/evaluate-attempt.ts).
export type ScenarioAction = { kind: string; targetId: string };
export type WrongScenarioAction = ScenarioAction & { penalty: number; critical: boolean };
export type ScenarioStep = {
  id: string;
  score: number;
  accept: ScenarioAction[];
  wrongActions?: WrongScenarioAction[];
};
export type Scenario = {
  id: string;
  version: number;
  passScore: number;
  steps: ScenarioStep[];
};
export type SubmittedEvent = {
  sequence: number;
  stepId: string;
  kind: string;
  targetId: string;
};
