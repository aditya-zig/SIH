// Package + scene validation. Authority: dashboard/src/webar/schema/validateTrainingPackage.ts
// Donor priority: prefer documented trainingPackage.js semantics, merge stricter
// checks from validateDraft.js where contract-compatible. Overlay A (source/web)
// was not present locally — recorded as T00 mismatch — so this is a clean-room
// implementation of the locked spec, not a copy.
// Test vectors covered: 1 (valid), 2 (invalid), 13 (entity mapping guard).
import type { SceneDefinition, TrainingPackage } from "../contracts.js";

export const TRUSTED_ASSET_KEYS = [
  "fire_extinguisher",
  "gas_valve",
  "exit_arrow",
  "warning_marker",
  "electrical_panel",
  "ppe_helmet",
  "danger_zone",
] as const;

export type TrustedAssetKey = (typeof TRUSTED_ASSET_KEYS)[number];

const TRUSTED_SET = new Set<string>(TRUSTED_ASSET_KEYS);

export function isTrustedAssetKey(key: string): boolean {
  return TRUSTED_SET.has(key);
}

function isFiniteVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

const ALLOWED_INTERACTIONS = new Set(["tap", "select", "interact", "hold", "waypoint", "observe"]);

export function validateSceneDefinition(scene: unknown): string[] {
  const errors: string[] = [];
  if (!scene || typeof scene !== "object") return ["SceneDefinition must be an object."];
  const s = scene as Partial<SceneDefinition>;
  if (typeof s.schemaVersion !== "number" || s.schemaVersion < 1) errors.push("scene.schemaVersion must be a positive number.");
  if (!s.sceneTemplateId || typeof s.sceneTemplateId !== "string") errors.push("scene.sceneTemplateId is required.");
  if (typeof s.sceneTemplateVersion !== "number" || (s.sceneTemplateVersion ?? 0) < 1) errors.push("scene.sceneTemplateVersion must be >= 1.");
  if (s.units !== "m") errors.push('scene.units must be "m".');
  if (!s.coordinateConvention || typeof s.coordinateConvention !== "string") errors.push("scene.coordinateConvention is required.");
  if (!s.trainingRoot || typeof s.trainingRoot !== "string") errors.push("scene.trainingRoot is required.");
  if (!Array.isArray(s.objects)) {
    errors.push("scene.objects must be an array.");
    return errors;
  }
  const seen = new Set<string>();
  for (const [i, o] of s.objects.entries()) {
    if (!o || typeof o !== "object") {
      errors.push(`scene.objects[${i}] must be an object.`);
      continue;
    }
    if (!o.id || typeof o.id !== "string") errors.push(`scene.objects[${i}].id is required.`);
    else if (seen.has(o.id)) errors.push(`Duplicate scene object id: ${o.id}`);
    else seen.add(o.id);
    if (!o.assetKey || typeof o.assetKey !== "string") errors.push(`scene.objects[${o.id ?? i}].assetKey is required.`);
    else if (!isTrustedAssetKey(o.assetKey)) errors.push(`Untrusted assetKey rejected: ${o.assetKey}`);
    if (!isFiniteVec3(o.position)) errors.push(`scene.objects[${o.id ?? i}].position must be finite [x,y,z].`);
    if (o.rotation !== undefined && !isFiniteVec3(o.rotation)) errors.push(`scene.objects[${o.id ?? i}].rotation must be finite [x,y,z].`);
    if (o.scale !== undefined && !isFiniteVec3(o.scale)) errors.push(`scene.objects[${o.id ?? i}].scale must be finite [x,y,z].`);
    if (!o.interactionType || !ALLOWED_INTERACTIONS.has(o.interactionType)) {
      errors.push(`scene.objects[${o.id ?? i}].interactionType must be one of ${[...ALLOWED_INTERACTIONS].join(", ")}.`);
    }
  }
  if (!Array.isArray(s.zones)) errors.push("scene.zones must be an array.");
  if (typeof s.lighting !== "object" || s.lighting === null) errors.push("scene.lighting must be an object.");
  return errors;
}

export function validateTrainingPackage(pkg: unknown): string[] {
  const errors: string[] = [];
  if (!pkg || typeof pkg !== "object") return ["TrainingPackage must be an object."];
  const p = pkg as Partial<TrainingPackage>;
  for (const key of ["packageId", "title", "workplaceId", "approvedBy", "approvedAt", "contentHash", "createdAt"] as const) {
    if (!p[key] || typeof p[key] !== "string") errors.push(`${key} is required.`);
  }
  if (typeof p.version !== "number" || (p.version ?? 0) < 1) errors.push("version must be >= 1.");
  if (!p.templateId || typeof p.templateId !== "string") errors.push("templateId is required.");
  if (typeof p.templateVersion !== "number" || (p.templateVersion ?? 0) < 1) errors.push("templateVersion must be >= 1.");
  if (!Array.isArray(p.sourceMediaRefs)) errors.push("sourceMediaRefs must be an array.");
  if (!Array.isArray(p.trainingSteps) || p.trainingSteps.length === 0) errors.push("trainingSteps must contain at least one step.");
  if (!Array.isArray(p.arObjects)) errors.push("arObjects must be an array.");
  if (!p.assessment || typeof p.assessment !== "object") errors.push("assessment is required.");
  if (!p.evaluationRules || typeof p.evaluationRules !== "object") errors.push("evaluationRules is required.");
  if (!p.voiceContent || typeof p.voiceContent !== "object") errors.push("voiceContent is required.");

  const stepIds = new Set<string>();
  for (const [i, s] of (p.trainingSteps ?? []).entries()) {
    if (!s?.id) {
      errors.push(`trainingSteps[${i}].id is required.`);
      continue;
    }
    if (stepIds.has(s.id)) errors.push(`Duplicate training step id: ${s.id}`);
    else stepIds.add(s.id);
    if (!s.instruction) errors.push(`trainingSteps[${s.id}].instruction is required.`);
    if (!s.expectedAction) errors.push(`trainingSteps[${s.id}].expectedAction is required.`);
  }

  if (p.lessons !== undefined) {
    const lessonIds = new Set<string>();
    for (const [i, lesson] of p.lessons.entries()) {
      if (!lesson.id) errors.push(`lessons[${i}].id is required.`);
      else if (lessonIds.has(lesson.id)) errors.push(`Duplicate lesson id: ${lesson.id}`);
      else lessonIds.add(lesson.id);
      if (!lesson.title || !lesson.concept || !lesson.checkPrompt || !lesson.checkAnswer) errors.push(`lessons[${lesson.id ?? i}] is incomplete.`);
      if (!Array.isArray(lesson.checkOptions) || lesson.checkOptions.length < 2) errors.push(`lessons[${lesson.id ?? i}].checkOptions must contain choices.`);
    }
  }

  const objIds = new Set<string>();
  for (const [i, o] of (p.arObjects ?? []).entries()) {
    if (!o?.id) {
      errors.push(`arObjects[${i}].id is required.`);
      continue;
    }
    if (objIds.has(o.id)) errors.push(`Duplicate AR object id: ${o.id}`);
    else objIds.add(o.id);
    if (!isTrustedAssetKey(o.assetKey ?? "")) errors.push(`Untrusted assetKey rejected: ${o.assetKey}`);
    if (o.positionHint !== undefined && !isFiniteVec3(o.positionHint)) errors.push(`arObjects[${o.id}].positionHint must be finite [x,y,z].`);
    if (o.relatedStep && !stepIds.has(o.relatedStep)) errors.push(`arObjects[${o.id}] references unknown step: ${o.relatedStep}`);
  }

  if (p.scene) {
    errors.push(...validateSceneDefinition(p.scene));
    const scene = p.scene as SceneDefinition;
    if (Array.isArray(scene.objects)) {
      for (const o of scene.objects) {
        if (o.relatedStepId && !stepIds.has(o.relatedStepId)) errors.push(`scene.objects[${o.id}] references unknown step: ${o.relatedStepId}`);
      }
    }
  } else {
    errors.push("scene is required.");
  }

  for (const [i, a] of (p.assets ?? []).entries()) {
    if (!a?.assetKey || !isTrustedAssetKey(a.assetKey)) errors.push(`assets[${i}] has untrusted assetKey: ${a?.assetKey}`);
    if (typeof a?.url !== "string" || /^https?:\/\//i.test(a.url)) errors.push(`assets[${a?.assetKey ?? i}].url must be a local/catalog path, not an external URL.`);
  }

  const rules = p.evaluationRules;
  if (rules) {
    for (const id of rules.requiredStepIds ?? []) {
      if (!stepIds.has(id)) errors.push(`evaluationRules references unknown step: ${id}`);
    }
    if (typeof rules.quizThresholdPercent !== "number" || rules.quizThresholdPercent < 0 || rules.quizThresholdPercent > 100) {
      errors.push("evaluationRules.quizThresholdPercent must be between 0 and 100.");
    }
  }

  // The richer flagship contract is opt-in through lessons so already-published
  // Fire packages without lessons remain readable and immutable.
  if (p.templateId === "fire-safety-induction" && Array.isArray(p.lessons)) {
    for (const id of ["select-extinguisher", "pull", "aim", "squeeze", "sweep-left", "sweep-right", "judgment"]) {
      if (!stepIds.has(id)) errors.push(`Fire flagship package is missing mandatory step: ${id}`);
    }
    if (p.lessons.length !== 5) errors.push("Fire flagship package must contain five learning lessons.");
    if (!Array.isArray(p.assessment?.questions) || p.assessment.questions.length !== 5) errors.push("Fire flagship package must contain five assessment questions.");
  }
  return errors;
}

export function assertValidTrainingPackage(pkg: unknown): asserts pkg is TrainingPackage {
  const errors = validateTrainingPackage(pkg);
  if (errors.length > 0) throw new Error(`Invalid TrainingPackage: ${errors.join(" ")}`);
}
