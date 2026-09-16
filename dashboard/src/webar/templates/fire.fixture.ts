// DEMO FIXTURE ONLY — NOT approved safety procedure.
// Blocker B-SAFETY-01: no named approved Fire procedure source / qualified
// trainer confirmation set is identified. Do not market this as approved safety
// instruction. Do not add new real-world safety steps from model knowledge.
// Donor: WebSurAR src/fireSafety.js (copied as fixture, relabeled honestly).
import type { TrainingPackage } from "../contracts.js";

export const FIRE_FIXTURE_LABEL = "DEMO FIXTURE — NOT APPROVED SAFETY PROCEDURE";

const knowledgeQuestions = [
  {
    id: "q1",
    prompt: "When should you evacuate instead of continuing the response?",
    options: ["When conditions are unsafe or worsening", "Always continue", "Move closer first"],
    correctOption: "When conditions are unsafe or worsening",
    explanation: "In this demo, worsening conditions mean stop the response and evacuate.",
  },
  {
    id: "q2",
    prompt: "Which word starts the PASS sequence?",
    options: ["Pull", "Push", "Pause"],
    correctOption: "Pull",
    explanation: "The demo sequence is Pull, Aim, Squeeze, Sweep.",
  },
  {
    id: "q3",
    prompt: "What does the Aim step use in this browser demo?",
    options: ["The marked target zone", "Any object", "The exit sign"],
    correctOption: "The marked target zone",
    explanation: "The browser measures selection of the marked aim target; it does not claim to measure physical technique.",
  },
  {
    id: "q4",
    prompt: "How is Sweep measured in this browser demo?",
    options: ["Cross the ordered left and right target zones", "Shake the phone", "Move as fast as possible"],
    correctOption: "Cross the ordered left and right target zones",
    explanation: "The runtime records the ordered target-zone interactions only.",
  },
  {
    id: "q5",
    prompt: "Smoke increases and the exit becomes harder to see. What should the worker choose in this demo?",
    options: ["Raise the alarm and evacuate", "Keep fighting", "Move closer"],
    correctOption: "Raise the alarm and evacuate",
    explanation: "The flagship scenario tests the decision to stop and evacuate when conditions worsen.",
  },
] as const;

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
      { id: "electrical_fire", assetKey: "electrical_panel", position: [0, 1.2, -2.4], interactionType: "observe", label: "Electrical fire source" },
      { id: "water", assetKey: "warning_marker", position: [1.2, 1, -2], interactionType: "select", relatedStepId: "select-extinguisher", label: "Water (wrong for fixture electrical scenario)" },
      { id: "co2", assetKey: "fire_extinguisher", position: [-1.2, 1, -2], interactionType: "select", relatedStepId: "select-extinguisher", label: "CO2 extinguisher" },
      { id: "pin", assetKey: "fire_extinguisher", position: [-0.8, 0.75, -1.8], interactionType: "interact", relatedStepId: "pull", label: "Extinguisher pin" },
      { id: "aim_zone", assetKey: "danger_zone", position: [0, 0.35, -2.1], interactionType: "select", relatedStepId: "aim", label: "Aim target zone" },
      { id: "trigger", assetKey: "fire_extinguisher", position: [-0.45, 1.0, -1.8], interactionType: "hold", relatedStepId: "squeeze", label: "Trigger control" },
      { id: "sweep_left", assetKey: "warning_marker", position: [-0.65, 0.35, -2.1], interactionType: "select", relatedStepId: "sweep-left", label: "Sweep left target" },
      { id: "sweep_right", assetKey: "warning_marker", position: [0.65, 0.35, -2.1], interactionType: "select", relatedStepId: "sweep-right", label: "Sweep right target" },
    ],
    zones: [{ id: "training-zone", label: "Compact training zone", center: [0, 0, -2], size: [4, 2.5, 4] }],
    lighting: { ambient: 0.8, directional: 1.0 },
  },
  assets: [
    { assetKey: "fire_extinguisher", url: "/models/fire_extinguisher.glb" },
    { assetKey: "electrical_panel", url: "/models/electrical_panel.glb" },
    { assetKey: "warning_marker", url: "/models/warning_marker.glb" },
    { assetKey: "danger_zone", url: "/models/danger_zone.glb" },
  ],
  hazards: [{ id: "h1", label: "Electrical fire", severity: "high", reason: "Fixture hazard", trainerMustConfirm: true }],
  learningObjectives: [
    "Recognize fire, smoke and heat danger",
    "Know when not to continue firefighting",
    "Select the demo equipment",
    "Understand Pull, Aim, Squeeze, Sweep",
    "Alarm, exit and escalation",
  ],
  lessons: [
    {
      id: "danger",
      title: "Recognize danger",
      visualLabel: "FIRE · SMOKE · HEAT",
      concept: "Treat visible fire, smoke and heat as danger signals in this demo.",
      interactionPrompt: "Scan the three danger labels before answering.",
      checkPrompt: "Which set matches the danger signals shown?",
      checkOptions: ["Fire, smoke and heat", "Only noise", "Only equipment colour"],
      checkAnswer: "Fire, smoke and heat",
      feedback: "Correct. The lesson is about recognizing the changing hazard before acting.",
    },
    {
      id: "when-not-to-fight",
      title: "Know when to stop",
      visualLabel: "CONDITIONS CAN CHANGE",
      concept: "The demo treats worsening or unsafe conditions as a reason to stop and evacuate.",
      interactionPrompt: "Compare a stable scene with a worsening-smoke scene.",
      checkPrompt: "What should happen when conditions worsen?",
      checkOptions: ["Stop and evacuate", "Move closer", "Ignore the change"],
      checkAnswer: "Stop and evacuate",
      feedback: "Correct. Judgment matters as much as the procedure in this demo.",
    },
    {
      id: "equipment",
      title: "Select equipment",
      visualLabel: "DEMO ELECTRICAL SCENARIO",
      concept: "For this existing fixture, select the marked CO2 extinguisher and do not select water.",
      interactionPrompt: "Compare the two fixture equipment choices.",
      checkPrompt: "Which object is the expected demo choice?",
      checkOptions: ["CO2 extinguisher", "Water", "Exit marker"],
      checkAnswer: "CO2 extinguisher",
      feedback: "Correct for this demo fixture. This content is still not safety-approved.",
    },
    {
      id: "pass",
      title: "Learn PASS",
      visualLabel: "P → A → S → S",
      concept: "The practical records Pull, Aim, Squeeze and Sweep as ordered browser interactions.",
      interactionPrompt: "Read the four-step sequence from left to right.",
      checkPrompt: "Which sequence will the practical measure?",
      checkOptions: ["Pull, Aim, Squeeze, Sweep", "Aim, Pull, Sweep, Squeeze", "Sweep only"],
      checkAnswer: "Pull, Aim, Squeeze, Sweep",
      feedback: "Correct. The browser records only the interactions it can actually measure.",
    },
    {
      id: "alarm-exit",
      title: "Alarm and exit",
      visualLabel: "STOP · ALARM · EVACUATE",
      concept: "The final scenario asks the worker to stop the response and evacuate when conditions worsen.",
      interactionPrompt: "Notice that the safest demo choice can change after the practical starts.",
      checkPrompt: "What does the scenario test after conditions worsen?",
      checkOptions: ["Judgment to stop and evacuate", "Fastest tapping", "A higher score at any cost"],
      checkAnswer: "Judgment to stop and evacuate",
      feedback: "Correct. The scenario tests judgment, not speed.",
    },
  ],
  trainingSteps: [
    { id: "select-extinguisher", order: 1, instruction: "Select the marked CO2 extinguisher for this demo scenario.", voiceText: "Select the marked CO2 extinguisher.", expectedAction: "select:co2", successFeedback: "Equipment selected.", failureFeedback: "Wrong demo choice.", remediation: "Select the marked CO2 extinguisher. The fixture remains not safety-approved." },
    { id: "pull", order: 2, instruction: "Pull: interact with the highlighted pin target.", voiceText: "Pull the pin target.", expectedAction: "interact:pin", successFeedback: "Pull recorded.", failureFeedback: "Try the pin target.", remediation: "Use the highlighted pin control." },
    { id: "aim", order: 3, instruction: "Aim: select the marked target zone.", voiceText: "Aim at the marked target zone.", expectedAction: "select:aim_zone", successFeedback: "Aim target recorded.", failureFeedback: "Aim at the marked target.", remediation: "Select the target zone near the simulated fire." },
    { id: "squeeze", order: 4, instruction: "Squeeze: press and hold the trigger target.", voiceText: "Press and hold the trigger target.", expectedAction: "hold:trigger", successFeedback: "Hold interaction recorded.", failureFeedback: "Hold the trigger target longer.", remediation: "The browser measures a bounded hold only; it does not measure physical force." },
    { id: "sweep-left", order: 5, instruction: "Sweep: cross the left target first.", voiceText: "Sweep to the left target.", expectedAction: "select:sweep_left", successFeedback: "Left sweep target recorded.", failureFeedback: "Start with the left target.", remediation: "Select the left sweep zone first." },
    { id: "sweep-right", order: 6, instruction: "Sweep: now cross the right target.", voiceText: "Sweep to the right target.", expectedAction: "select:sweep_right", successFeedback: "PASS practical complete.", failureFeedback: "Finish on the right target.", remediation: "Select the right sweep zone after the left zone." },
    { id: "judgment", order: 7, instruction: "Conditions worsen. Choose the safest next action in the scenario.", voiceText: "Conditions are worsening. Choose what to do next.", expectedAction: "decision:evacuate", successFeedback: "Judgment recorded.", failureFeedback: "Unsafe demo decision.", remediation: "In this scenario, raise the alarm and evacuate." },
  ],
  assessment: {
    questions: knowledgeQuestions.map((q) => ({ ...q, options: [...q.options] })),
    passThresholdPercent: 80,
  },
  arObjects: [
    { id: "co2", type: "tool", assetKey: "fire_extinguisher", label: "CO2 extinguisher", interactionType: "select", relatedStep: "select-extinguisher" },
    { id: "pin", type: "part", assetKey: "fire_extinguisher", label: "Pin", interactionType: "interact", relatedStep: "pull" },
    { id: "aim_zone", type: "target", assetKey: "danger_zone", label: "Aim target", interactionType: "select", relatedStep: "aim" },
    { id: "trigger", type: "part", assetKey: "fire_extinguisher", label: "Trigger", interactionType: "hold", relatedStep: "squeeze" },
    { id: "sweep_left", type: "target", assetKey: "warning_marker", label: "Sweep left", interactionType: "select", relatedStep: "sweep-left" },
    { id: "sweep_right", type: "target", assetKey: "warning_marker", label: "Sweep right", interactionType: "select", relatedStep: "sweep-right" },
  ],
  evaluationRules: {
    requiredStepIds: ["select-extinguisher", "pull", "aim", "squeeze", "sweep-left", "sweep-right", "judgment"],
    forbiddenActions: ["select:water"],
    quizThresholdPercent: 80,
  },
  voiceContent: {
    locale: "en-IN",
    lines: [
      { stepId: "select-extinguisher", text: "Select the marked CO2 extinguisher." },
      { stepId: "pull", text: "Pull the pin target." },
      { stepId: "aim", text: "Aim at the marked target zone." },
      { stepId: "squeeze", text: "Press and hold the trigger target." },
      { stepId: "sweep-left", text: "Sweep to the left target." },
      { stepId: "sweep-right", text: "Sweep to the right target." },
      { stepId: "judgment", text: "Conditions are worsening. Choose what to do next." },
    ],
  },
  createdAt: "2026-09-15T00:00:00.000Z",
};

function wrongAnswers(correct: string, options: readonly string[]) {
  return options
    .filter((option) => option !== correct)
    .map((targetId) => ({ kind: "answer", targetId, penalty: 0, critical: false, advance: true }));
}

export const fireFixtureScenario = {
  id: "fire_001",
  version: 1,
  passScore: 95,
  steps: [
    ...knowledgeQuestions.map((q) => ({
      id: q.id,
      score: 5,
      dimension: "knowledge" as const,
      accept: [{ kind: "answer", targetId: q.correctOption }],
      wrongActions: wrongAnswers(q.correctOption, q.options),
    })),
    {
      id: "select-extinguisher",
      score: 5,
      dimension: "practical" as const,
      accept: [{ kind: "select", targetId: "co2" }],
      wrongActions: [{ kind: "select", targetId: "water", penalty: 25, critical: true }],
    },
    { id: "pull", score: 5, dimension: "practical" as const, accept: [{ kind: "interact", targetId: "pin" }] },
    { id: "aim", score: 10, dimension: "practical" as const, accept: [{ kind: "select", targetId: "aim_zone" }] },
    { id: "squeeze", score: 10, dimension: "practical" as const, accept: [{ kind: "hold", targetId: "trigger" }] },
    { id: "sweep-left", score: 7, dimension: "practical" as const, accept: [{ kind: "select", targetId: "sweep_left" }] },
    { id: "sweep-right", score: 8, dimension: "practical" as const, accept: [{ kind: "select", targetId: "sweep_right" }] },
    {
      id: "judgment",
      score: 30,
      dimension: "judgment" as const,
      accept: [{ kind: "decision", targetId: "evacuate" }],
      wrongActions: [
        { kind: "decision", targetId: "keep-fighting", penalty: 30, critical: false },
        { kind: "decision", targetId: "move-closer", penalty: 30, critical: false },
      ],
    },
  ],
} as const;
