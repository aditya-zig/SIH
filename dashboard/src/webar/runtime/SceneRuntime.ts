// Single data-driven A-Frame runtime. Used by trainer preview AND worker AR.
// E01: A-Frame is a local npm dependency (dashboard/package.json), loaded via
// dynamic import so Node unit tests keep running. Fire fixture renders with
// built-in primitives for P0; trusted asset-key validation stays intact and
// model loading is a later enhancement, not an E01 blocker.
import type { SceneDefinition, SceneObject, TrainingPackage } from "../contracts.js";
import { isTrustedAssetKey } from "../schema/validateTrainingPackage.js";

export type RuntimeAction = { kind: string; targetId: string };
export type OnAction = (action: RuntimeAction) => void;

export type EntitySpec = {
  objectId: string;
  tag: string;
  attrs: Record<string, string>;
};

export const TRUSTED_GLB: Record<string, string> = {
  fire_extinguisher: "/models/fire_extinguisher.glb",
  gas_valve: "/models/gas_valve.glb",
  exit_arrow: "/models/exit_arrow.glb",
  warning_marker: "/models/warning_marker.glb",
  electrical_panel: "/models/electrical_panel.glb",
  ppe_helmet: "/models/ppe_helmet.glb",
  danger_zone: "/models/danger_zone.glb",
};

export function resolveAssetUrl(assetKey: string): string {
  const url = TRUSTED_GLB[assetKey];
  if (!url) throw new Error(`Untrusted assetKey rejected: ${assetKey}`);
  return url;
}

// P0 primitive mapping: one built-in A-Frame primitive per trusted asset key.
// No GLB download is required to run the Fire fixture.
const PRIMITIVE_FOR_ASSET: Record<string, { primitive: string; color: string }> = {
  electrical_panel: { primitive: "a-box", color: "#ff695c" },
  warning_marker: { primitive: "a-cylinder", color: "#e6f23a" },
  fire_extinguisher: { primitive: "a-cylinder", color: "#c0392b" },
  exit_arrow: { primitive: "a-cone", color: "#2ecc71" },
  gas_valve: { primitive: "a-sphere", color: "#e67e22" },
  ppe_helmet: { primitive: "a-sphere", color: "#f1c40f" },
  danger_zone: { primitive: "a-cylinder", color: "#e74c3c" },
};

/** Deterministic package → entity compiler. One-to-one object count/IDs. */
export function compileEntities(pkg: TrainingPackage): EntitySpec[] {
  const scene: SceneDefinition = pkg.scene;
  return scene.objects.map((o: SceneObject) => {
    if (!isTrustedAssetKey(o.assetKey)) {
      throw new Error(`Untrusted assetKey rejected: ${o.assetKey}`);
    }
    const visual = PRIMITIVE_FOR_ASSET[o.assetKey];
    if (!visual) throw new Error(`No P0 primitive for assetKey: ${o.assetKey}`);
    const [x, y, z] = o.position;
    const attrs: Record<string, string> = {
      "data-object-id": o.id,
      "data-asset-key": o.assetKey,
      "data-kind": o.interactionType,
      "data-target": o.id,
      position: `${x} ${y} ${z}`,
      color: visual.color,
      class: "training-object clickable",
    };
    if (o.rotation) attrs.rotation = o.rotation.join(" ");
    if (o.scale) attrs.scale = o.scale.join(" ");
    if (o.relatedStepId) attrs["data-step-id"] = o.relatedStepId;
    return { objectId: o.id, tag: visual.primitive, attrs };
  });
}

// Runtime states: UNMOUNTED -> READY -> XR_ENTERING -> PLACING -> ACTIVE -> COMPLETE.
// Preview may go READY -> ACTIVE via deterministic placement. XR failure reports
// UNSUPPORTED_XR / XR_FAILED and never claims AR mode while falling back.
export type RuntimeStatus =
  | "UNMOUNTED"
  | "READY"
  | "XR_ENTERING"
  | "PLACING"
  | "ACTIVE"
  | "COMPLETE"
  | "UNSUPPORTED_XR"
  | "XR_FAILED";

export type RuntimeEvent =
  | "MOUNTED"
  | "ENTER_AR"
  | "AR_READY"
  | "AR_UNSUPPORTED"
  | "AR_FAILED"
  | "PLACED"
  | "FINISHED"
  | "RESET";

export function transitionRuntimeStatus(current: RuntimeStatus, event: RuntimeEvent): RuntimeStatus {
  if (event === "RESET") return "UNMOUNTED";
  switch (current) {
    case "UNMOUNTED":
      return event === "MOUNTED" ? "READY" : current;
    case "READY":
      if (event === "ENTER_AR") return "XR_ENTERING";
      if (event === "PLACED") return "ACTIVE";
      return current;
    case "XR_ENTERING":
      if (event === "AR_READY") return "PLACING";
      if (event === "AR_UNSUPPORTED") return "UNSUPPORTED_XR";
      if (event === "AR_FAILED") return "XR_FAILED";
      return current;
    case "PLACING":
      return event === "PLACED" ? "ACTIVE" : current;
    case "ACTIVE":
      return event === "FINISHED" ? "COMPLETE" : current;
    default:
      return current;
  }
}

// Deterministic preview root so desktop browser tests never depend on AR.
export const DEFAULT_ROOT_POSITION: [number, number, number] = [0, 0, 0];

export function formatVec3(v: [number, number, number]): string {
  return `${v[0]} ${v[1]} ${v[2]}`;
}

export type MountedScene = {
  scene: HTMLElement;
  root: HTMLElement;
  reticle: HTMLElement;
};

// A-Frame ships without bundled TypeScript types; load it lazily in browsers
// only so Node unit tests never execute browser-only custom-element code.
async function ensureAFrame(): Promise<void> {
  if (typeof window === "undefined") return;
  if ((window as unknown as { AFRAME?: unknown }).AFRAME) return;
  try {
    // @ts-expect-error - aframe has no bundled types
    await import("aframe");
  } catch {
    // Entities still mount as unknown elements; A-Frame upgrades them on load.
  }
}

export type MountOptions = {
  onAction?: OnAction;
};

export function mountTrainingScene(
  container: HTMLElement,
  pkg: TrainingPackage,
  opts: MountOptions = {},
): MountedScene {
  if (!container) throw new Error("AR container is required");
  if (!pkg?.trainingSteps?.length) throw new Error("TrainingPackage has no steps");
  void ensureAFrame();
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const scene = doc.createElement("a-scene");
  scene.setAttribute("embedded", "");
  scene.setAttribute("renderer", "colorManagement: true");
  scene.setAttribute("xr-mode-ui", "enabled: true");
  scene.setAttribute("cursor", "rayOrigin: mouse");
  scene.setAttribute("raycaster", "objects: .training-object");

  const ambient = doc.createElement("a-light");
  ambient.setAttribute("type", "ambient");
  ambient.setAttribute("intensity", "0.9");
  scene.appendChild(ambient);
  const sun = doc.createElement("a-light");
  sun.setAttribute("type", "directional");
  sun.setAttribute("position", "2 4 2");
  sun.setAttribute("intensity", "0.8");
  scene.appendChild(sun);
  const ground = doc.createElement("a-plane");
  ground.setAttribute("position", "0 0 -2");
  ground.setAttribute("rotation", "-90 0 0");
  ground.setAttribute("width", "12");
  ground.setAttribute("height", "12");
  ground.setAttribute("color", "#1a241c");
  scene.appendChild(ground);

  const camera = doc.createElement("a-camera");
  camera.setAttribute("position", "0 1.6 0");
  scene.appendChild(camera);

  const root = doc.createElement("a-entity");
  root.setAttribute("id", "training-root");
  root.setAttribute("position", formatVec3(DEFAULT_ROOT_POSITION));
  for (const spec of compileEntities(pkg)) {
    const entity = doc.createElement(spec.tag);
    for (const [k, v] of Object.entries(spec.attrs)) {
      if (k === "data-object-id") (entity as HTMLElement).dataset.arObjectId = v;
      else if (k === "data-step-id") (entity as HTMLElement).dataset.stepId = v;
      else entity.setAttribute(k, v);
    }
    // One entity interaction emits exactly one package-defined action.
    entity.addEventListener("click", () => {
      const kind = entity.getAttribute("data-kind") ?? spec.attrs["data-kind"] ?? "";
      const targetId = entity.getAttribute("data-target") ?? spec.objectId;
      opts.onAction?.({ kind, targetId });
    });
    root.appendChild(entity);
  }
  scene.appendChild(root);

  // Placement reticle: hidden until AR hit-test data arrives.
  const reticle = doc.createElement("a-ring");
  reticle.setAttribute("id", "placement-reticle");
  reticle.setAttribute("radius-inner", "0.08");
  reticle.setAttribute("radius-outer", "0.12");
  reticle.setAttribute("rotation", "-90 0 0");
  reticle.setAttribute("color", "#e6f23a");
  reticle.setAttribute("visible", "false");
  scene.appendChild(reticle);

  container.appendChild(scene);
  return { scene: scene as unknown as HTMLElement, root: root as unknown as HTMLElement, reticle: reticle as unknown as HTMLElement };
}

// Explicit AR entry path. Returns the status the caller must display; callers
// must not label UNSUPPORTED_XR / XR_FAILED outcomes as AR success.
export async function enterAR(sceneEl: HTMLElement): Promise<RuntimeStatus> {
  const supported = await isImmersiveArSupported();
  if (!supported) return "UNSUPPORTED_XR";
  const el = sceneEl as HTMLElement & {
    enterAR?: () => Promise<void>;
    enterVR?: () => Promise<void>;
  };
  try {
    if (typeof el.enterAR === "function") await el.enterAR();
    else if (typeof el.enterVR === "function") await el.enterVR();
    else return "XR_FAILED";
    return "PLACING";
  } catch {
    return "XR_FAILED";
  }
}

// Single package-root placement. Before placement the reticle shows only when
// XR hit-test data exists; on select/tap the root locks to the hit result.
export function setReticleVisible(reticleEl: HTMLElement, visible: boolean): void {
  reticleEl.setAttribute("visible", visible ? "true" : "false");
}

export function placeRootAt(rootEl: HTMLElement, position: [number, number, number]): string {
  if (!position.every((n) => Number.isFinite(n))) throw new Error("Anchor point must be finite");
  const formatted = formatVec3(position);
  rootEl.setAttribute("position", formatted);
  return formatted;
}

export function applyHitPose(
  rootEl: HTMLElement,
  reticleEl: HTMLElement,
  position: [number, number, number],
): string {
  const placed = placeRootAt(rootEl, position);
  setReticleVisible(reticleEl, false);
  return placed;
}

// Voice provider boundary. Text instruction always visible; voice failure never blocks.
export type VoiceProvider = {
  speak: (text: string) => boolean;
};

export const browserSpeechProvider: VoiceProvider = {
  speak(text: string): boolean {
    try {
      const w = window as unknown as {
        speechSynthesis?: SpeechSynthesis;
        SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
      };
      if (!w.speechSynthesis || !w.SpeechSynthesisUtterance) return false;
      w.speechSynthesis.cancel();
      w.speechSynthesis.speak(new w.SpeechSynthesisUtterance(text));
      return true;
    } catch {
      return false;
    }
  },
};

export function speakInstruction(text: string, provider: VoiceProvider = browserSpeechProvider): boolean {
  return provider.speak(text);
}

export async function isImmersiveArSupported(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & {
      xr?: { isSessionSupported?: (mode: string) => Promise<boolean> };
    };
    if (!nav.xr?.isSessionSupported) return false;
    return await nav.xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}
