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

// ---- E03: real WebXR hit-test placement ----
// The session init below is what A-Frame receives through the `webxr`
// component: immersive-ar with hit-test required, local-floor preferred.
// Desktop preview never touches this path; it uses DEFAULT_ROOT_POSITION.
export const AR_SESSION_INIT = {
  requiredFeatures: ["hit-test"],
  optionalFeatures: ["local-floor"],
} as const;

export function configureARFeatures(sceneEl: HTMLElement): void {
  sceneEl.setAttribute(
    "webxr",
    `requiredFeatures: ${AR_SESSION_INIT.requiredFeatures.join(",")}; ` +
      `optionalFeatures: ${AR_SESSION_INIT.optionalFeatures.join(",")}`,
  );
}

// Minimal structural XR types so unit tests can inject doubles. The real
// WebXR objects satisfy these shapes; no DOM XR globals are referenced here.
export type XRPoseLike = {
  transform: {
    position: { x: number; y: number; z: number };
    orientation?: { x: number; y: number; z: number; w: number };
  };
};
export type XRReferenceSpaceLike = object;
export type XRHitTestSourceLike = { cancel: () => void };
export type XRHitResultLike = {
  getPose: (space: XRReferenceSpaceLike) => XRPoseLike | null | undefined;
};
export type XRFrameLike = {
  getHitTestResults: (source: XRHitTestSourceLike) => XRHitResultLike[];
};
export type XRSessionLike = {
  requestReferenceSpace: (type: string) => Promise<XRReferenceSpaceLike>;
  requestHitTestSource: (opts: { space: XRReferenceSpaceLike }) => Promise<XRHitTestSourceLike>;
  requestAnimationFrame: (cb: (time: number, frame: XRFrameLike) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  end?: () => Promise<void>;
};

export type HitPose = {
  position: [number, number, number];
  orientation?: [number, number, number, number];
};

// Pure hit extraction: first valid result wins, anything else is no-hit.
export function extractHitPose(
  frame: XRFrameLike,
  hitSource: XRHitTestSourceLike,
  refSpace: XRReferenceSpaceLike,
): HitPose | null {
  let results: XRHitResultLike[];
  try {
    results = frame.getHitTestResults(hitSource);
  } catch {
    return null;
  }
  const hit = results[0];
  if (!hit) return null;
  let pose: XRPoseLike | null | undefined;
  try {
    pose = hit.getPose(refSpace);
  } catch {
    return null;
  }
  if (!pose) return null;
  const p = pose.transform.position;
  if (![p.x, p.y, p.z].every((n) => Number.isFinite(n))) return null;
  const o = pose.transform.orientation;
  return {
    position: [p.x, p.y, p.z],
    ...(o ? { orientation: [o.x, o.y, o.z, o.w] as [number, number, number, number] } : {}),
  };
}

export type ARTrackerHooks = {
  isSupported?: () => Promise<boolean>;
  onStatus?: (status: RuntimeStatus) => void;
  onPlaced?: (position: [number, number, number]) => void;
};

// Owns one immersive-AR placement episode: session entry, hit-test source,
// per-frame reticle updates, select-to-place, and full cleanup. Preview mode
// never constructs this; it is AR-only.
export class ARPlacementTracker {
  latestPose: HitPose | null = null;
  private session: XRSessionLike | null = null;
  private hitSource: XRHitTestSourceLike | null = null;
  private running = false;
  private rafId = 0;
  private readonly onSelect = (): void => {
    this.placeFromReticle();
  };
  private readonly onEnded = (): void => {
    this.stop();
    this.hooks.onStatus?.("READY");
  };

  constructor(
    private readonly rootEl: HTMLElement,
    private readonly reticleEl: HTMLElement,
    private readonly hooks: ARTrackerHooks = {},
  ) {}

  get isTracking(): boolean {
    return this.running;
  }

  async start(sceneEl: HTMLElement): Promise<RuntimeStatus> {
    const supported = await (this.hooks.isSupported ?? isImmersiveArSupported)();
    if (!supported) return "UNSUPPORTED_XR";
    configureARFeatures(sceneEl);
    const el = sceneEl as HTMLElement & {
      enterAR?: () => Promise<void>;
      enterVR?: () => Promise<void>;
      renderer?: { xr?: { getSession: () => XRSessionLike | null } };
    };
    try {
      if (typeof el.enterAR === "function") await el.enterAR();
      else if (typeof el.enterVR === "function") await el.enterVR();
      else return "XR_FAILED";
    } catch {
      return "XR_FAILED";
    }
    const session = el.renderer?.xr?.getSession() ?? null;
    if (!session) return "XR_FAILED";
    let viewerSpace: XRReferenceSpaceLike;
    try {
      viewerSpace = await session.requestReferenceSpace("viewer");
    } catch {
      return "XR_FAILED";
    }
    try {
      this.hitSource = await session.requestHitTestSource({ space: viewerSpace });
    } catch {
      return "XR_FAILED";
    }
    // local-floor keeps the root at floor height; viewer space still works.
    let refSpace: XRReferenceSpaceLike;
    try {
      refSpace = await session.requestReferenceSpace("local-floor");
    } catch {
      try {
        refSpace = await session.requestReferenceSpace("viewer");
      } catch {
        return "XR_FAILED";
      }
    }
    this.session = session;
    this.refSpace = refSpace;
    this.running = true;
    session.addEventListener("select", this.onSelect);
    session.addEventListener("end", this.onEnded);
    this.rafId = session.requestAnimationFrame(this.onFrame);
    return "PLACING";
  }

  private refSpace: XRReferenceSpaceLike | null = null;

  private readonly onFrame = (time: number, frame: XRFrameLike): void => {
    void time;
    if (!this.running || !this.session || !this.hitSource || !this.refSpace) return;
    const pose = extractHitPose(frame, this.hitSource, this.refSpace);
    if (pose) {
      this.latestPose = pose;
      this.reticleEl.setAttribute("position", formatVec3(pose.position));
      setReticleVisible(this.reticleEl, true);
    } else {
      this.latestPose = null;
      setReticleVisible(this.reticleEl, false);
    }
    this.rafId = this.session.requestAnimationFrame(this.onFrame);
  };

  // Real XR select path and the on-screen lock button share this: placement
  // requires a currently visible, valid reticle pose. Never a fixed origin.
  placeFromReticle(): boolean {
    if (!this.running || !this.latestPose) return false;
    const position = this.latestPose.position;
    applyHitPose(this.rootEl, this.reticleEl, position);
    this.latestPose = null;
    this.running = false;
    this.hooks.onPlaced?.(position);
    return true;
  }

  stop(): void {
    this.running = false;
    this.latestPose = null;
    try {
      this.hitSource?.cancel();
    } catch {
      // Best effort; a dead session must not break unmount.
    }
    this.hitSource = null;
    this.session?.removeEventListener("select", this.onSelect);
    this.session?.removeEventListener("end", this.onEnded);
    const session = this.session;
    this.session = null;
    this.refSpace = null;
    try {
      void session?.end?.();
    } catch {
      // Best effort.
    }
  }
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
