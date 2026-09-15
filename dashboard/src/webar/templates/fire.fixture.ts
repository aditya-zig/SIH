// DEMO FIXTURE ONLY — NOT approved safety procedure.
// Blocker B-SAFETY-01: no named approved Fire procedure source / qualified
// trainer confirmation set is identified. Do not market this as approved safety
// instruction. Do not add new real-world safety steps from model knowledge.
// Donor: WebSurAR src/fireSafety.js (copied as fixture, relabeled honestly).
import type { TrainingPackage } from "../contracts.js";

export const FIRE_FIXTURE_LABEL = "DEMO FIXTURE — NOT APPROVED SAFETY PROCEDURE";

export const fireFixturePackage: TrainingPackage = {
  packageId: "fire-fixture-001",
  version: 1,
  templateId: "fire-safety-induction",
  templateVersion: 1,
  title: "Fire Safety Induction (Demo Fixture)",
  workplaceId: "workplace-fixture-001",
  approvedBy: "trainer-fixture",
  approvedAt: "2026-09-15T00:00:00.000Z",
  contentHash: "fixture-hash-not-sha256",
  sourceMediaRefs: [],
  scene: {
    schemaVersion: 1,
    sceneTemplateId: "industrial-room",
    sceneTemplateVersion: 1,
    units: "m",
    coordinateConvention: "y-up-right-handed",
    trainingRoot: "training-root",
    objects: [
      { id: "electrical_fire", assetKey: "electrical_panel", position: [0, 1.2, -2], interactionType: "select", relatedStepId: "identify", label: "Electrical fire source" },
      { id: "water", assetKey: "warning_marker", position: [1, 1, -2], interactionType: "select", relatedStepId: "extinguisher", label: "Water (wrong for electrical)" },
      { id: "co2", assetKey: "fire_extinguisher", position: [-1, 1, -2], interactionType: "select", relatedStepId: "extinguisher", label: "CO2 extinguisher" },
      { id: "pin", assetKey: "fire_extinguisher", position: [-1, 0.8, -1.8], interactionType: "interact", relatedStepId: "pin", label: "Extinguisher pin" },
      { id: "exit_a", assetKey: "exit_arrow", position: [0, 1.5, -3], interactionType: "waypoint", relatedStepId: "exit", label: "Exit A" },
    ],
    zones: [
      { id: "training-zone", label: "Compact training zone", center: [0, 0, -2], size: [4, 2.5, 4] },
    ],
    lighting: { ambient: 0.8, directional: 1.0 },
  },
  assets: [
    { assetKey: "fire_extinguisher", url: "/models/fire_extinguisher.glb" },
    { assetKey: "electrical_panel", url: "/models/electrical_panel.glb" },
    { assetKey: "exit_arrow", url: "/models/exit_arrow.glb" },
    { assetKey: "warning_marker", url: "/models/warning_marker.glb" },
  ],
  hazards: [
    { id: "h1", label: "Electrical fire", severity: "high", reason: "Fixture hazard", trainerMustConfirm: true },
  ],
  learningObjectives: ["Recognize fire hazards", "Locate the nearest safe exit"],
  trainingSteps: [
    { id: "identify", order: 1, instruction: "Identify the electrical fire.", voiceText: "Identify the electrical fire.", expectedAction: "select:electrical_fire", successFeedback: "Correct.", failureFeedback: "Try again.", remediation: "Look for the electrical panel marker." },
    { id: "extinguisher", order: 2, instruction: "Select the CO2 extinguisher. Do NOT use water on electrical fire.", voiceText: "Select the CO2 extinguisher.", expectedAction: "select:co2", successFeedback: "Correct.", failureFeedback: "Wrong choice.", remediation: "Water on electrical fire is a critical failure in this fixture." },
    { id: "pin", order: 3, instruction: "Pull the pin.", voiceText: "Pull the pin.", expectedAction: "interact:pin", successFeedback: "Correct.", failureFeedback: "Try again.", remediation: "Interact with the pin." },
    { id: "exit", order: 4, instruction: "Proceed to exit A.", voiceText: "Proceed to exit A.", expectedAction: "waypoint:exit_a", successFeedback: "Complete.", failureFeedback: "Try again.", remediation: "Follow the exit arrow." },
  ],
  assessment: {
    questions: [
      { id: "q1", prompt: "When should you evacuate instead of fighting a fire?", options: ["When conditions are unsafe or the fire is spreading", "Always fight regardless"], correctOption: "When conditions are unsafe or the fire is spreading" },
    ],
    passThresholdPercent: 70,
  },
  arObjects: [
    { id: "electrical_fire", type: "hazard", assetKey: "electrical_panel", label: "Electrical fire", interactionType: "select", relatedStep: "identify" },
    { id: "co2", type: "tool", assetKey: "fire_extinguisher", label: "CO2 extinguisher", interactionType: "select", relatedStep: "extinguisher" },
    { id: "pin", type: "part", assetKey: "fire_extinguisher", label: "Pin", interactionType: "interact", relatedStep: "pin" },
    { id: "exit_a", type: "waypoint", assetKey: "exit_arrow", label: "Exit A", interactionType: "waypoint", relatedStep: "exit" },
  ],
  evaluationRules: {
    requiredStepIds: ["identify", "extinguisher", "pin", "exit"],
    forbiddenActions: ["select:water"],
    quizThresholdPercent: 70,
  },
  voiceContent: {
    locale: "en-IN",
    lines: [
      { stepId: "identify", text: "Identify the electrical fire." },
      { stepId: "extinguisher", text: "Select the CO2 extinguisher." },
      { stepId: "pin", text: "Pull the pin." },
      { stepId: "exit", text: "Proceed to exit A." },
    ],
  },
  createdAt: "2026-09-15T00:00:00.000Z",
};

// Server Scenario projection required by backend/functions/_shared/evaluate-attempt.ts.
// Fixture sequence electrical_fire → water(wrong critical) → co2 → pin → exit_a
// must score 75, passed=false, criticalFailure=true (vector 4).
export const fireFixtureScenario = {
  id: "fire_001",
  version: 1,
  passScore: 70,
  steps: [
    { id: "identify", score: 15, accept: [{ kind: "select", targetId: "electrical_fire" }] },
    {
      id: "extinguisher",
      score: 20,
      accept: [{ kind: "select", targetId: "co2" }],
      wrongActions: [{ kind: "select", targetId: "water", penalty: 25, critical: true }],
    },
    { id: "pin", score: 25, accept: [{ kind: "interact", targetId: "pin" }] },
    { id: "exit", score: 40, accept: [{ kind: "waypoint", targetId: "exit_a" }] },
  ],
} as const;
