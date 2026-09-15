import { describe, expect, it, vi } from "vitest";
import { evaluateAttempt } from "../evaluation/evaluateAttempt.js";
import {
  applyHitPose,
  compileEntities,
  DEFAULT_ROOT_POSITION,
  enterAR,
  formatVec3,
  mountTrainingScene,
  placeRootAt,
  setReticleVisible,
  transitionRuntimeStatus,
} from "./SceneRuntime.js";
import { fireFixturePackage, fireFixtureScenario } from "../templates/fire.fixture.js";

// Minimal DOM stub: mountTrainingScene only needs createElement, setAttribute,
// getAttribute, appendChild, addEventListener, dataset, innerHTML, ownerDocument.
type Listener = () => void;

class FakeElement {
  tag: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  innerHTML = "";
  ownerDocument: FakeDocument;

  constructor(tag: string, doc: FakeDocument) {
    this.tag = tag;
    this.ownerDocument = doc;
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn();
  }

  queryByTarget(targetId: string): FakeElement | undefined {
    if (this.attrs.get("data-target") === targetId) return this;
    for (const child of this.children) {
      const found = child.queryByTarget(targetId);
      if (found) return found;
    }
    return undefined;
  }

  countByClass(klass: string): number {
    let n = this.attrs.get("class")?.split(" ").includes(klass) ? 1 : 0;
    for (const child of this.children) n += child.countByClass(klass);
    return n;
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

function fakeContainer(): FakeElement {
  return new FakeElement("div", new FakeDocument());
}

type TestScene = { scene: FakeElement; root: FakeElement; reticle: FakeElement };

function mountForTest(onAction?: (a: { kind: string; targetId: string }) => void): TestScene {
  return mountTrainingScene(fakeContainer() as never, structuredClone(fireFixturePackage), {
    ...(onAction ? { onAction } : {}),
  }) as unknown as TestScene;
}

const scenario = fireFixtureScenario as unknown as Parameters<typeof evaluateAttempt>[0];

describe("SceneRuntime (E01)", () => {
  it("1. package objects compile into entity descriptors with stable targetId mapping", () => {
    const entities = compileEntities(structuredClone(fireFixturePackage));
    expect(entities).toHaveLength(fireFixturePackage.scene.objects.length);
    expect(entities).toHaveLength(5);
    for (const e of entities) {
      expect(e.attrs["data-target"]).toBe(e.objectId);
      expect(typeof e.attrs["data-kind"]).toBe("string");
    }
    const kinds = new Map(entities.map((e) => [e.objectId, e.attrs["data-kind"]]));
    expect(kinds.get("co2")).toBe("select");
    expect(kinds.get("pin")).toBe("interact");
    expect(kinds.get("exit_a")).toBe("waypoint");
  });

  it("2. entity interaction emits exactly one {kind,targetId} action", () => {
    const onAction = vi.fn();
    const mounted = mountForTest(onAction);
    expect(mounted.scene.tag).toBe("a-scene");
    expect(mounted.root.children).toHaveLength(5);
    // Five visible primitives for the Fire fixture.
    expect(mounted.scene.queryByTarget("electrical_fire")).toBeDefined();
    mounted.root.queryByTarget("co2")?.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "select", targetId: "co2" });
  });

  it("3. wrong target goes through evaluator semantics and does not advance", () => {
    const onAction = vi.fn();
    const mounted = mountForTest(onAction);
    // Current step is identify; clicking exit_a (a later step's target) must reject.
    mounted.root.queryByTarget("exit_a")?.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    const [action] = onAction.mock.calls[0] as [{ kind: string; targetId: string }];
    const res = evaluateAttempt(scenario, [{ sequence: 1, stepId: "identify", ...action }]);
    expect(res.events[0]).toMatchObject({ outcome: "rejected", scoreDelta: 0 });
    expect(res.score).toBe(0);
    expect(res.passed).toBe(false);
  });

  it("4. preview placement gives a deterministic transform", () => {
    const mounted = mountForTest();
    expect(formatVec3(DEFAULT_ROOT_POSITION)).toBe("0 0 0");
    expect(placeRootAt(mounted.root as never, DEFAULT_ROOT_POSITION)).toBe("0 0 0");
    expect(mounted.root.getAttribute("position")).toBe("0 0 0");
    // Hit pose applies the same single-root lock and hides the reticle.
    expect(applyHitPose(mounted.root as never, mounted.reticle as never, [1, 0, -2])).toBe("1 0 -2");
    expect(mounted.reticle.getAttribute("visible")).toBe("false");
    setReticleVisible(mounted.reticle as never, true);
    expect(mounted.reticle.getAttribute("visible")).toBe("true");
    expect(() => placeRootAt(mounted.root as never, [NaN, 0, 0])).toThrow("finite");
  });

  it("5. AR unsupported path reports UNSUPPORTED_XR rather than success", async () => {
    // Node has no navigator.xr, matching an unsupported desktop browser.
    const status = await enterAR(new FakeElement("a-scene", new FakeDocument()) as never);
    expect(status).toBe("UNSUPPORTED_XR");
    expect(status).not.toBe("PLACING");
  });

  it("state machine follows UNMOUNTED -> READY -> ACTIVE / XR paths", () => {
    expect(transitionRuntimeStatus("UNMOUNTED", "MOUNTED")).toBe("READY");
    expect(transitionRuntimeStatus("READY", "PLACED")).toBe("ACTIVE");
    expect(transitionRuntimeStatus("READY", "ENTER_AR")).toBe("XR_ENTERING");
    expect(transitionRuntimeStatus("XR_ENTERING", "AR_READY")).toBe("PLACING");
    expect(transitionRuntimeStatus("XR_ENTERING", "AR_UNSUPPORTED")).toBe("UNSUPPORTED_XR");
    expect(transitionRuntimeStatus("XR_ENTERING", "AR_FAILED")).toBe("XR_FAILED");
    expect(transitionRuntimeStatus("PLACING", "PLACED")).toBe("ACTIVE");
    expect(transitionRuntimeStatus("ACTIVE", "FINISHED")).toBe("COMPLETE");
    // XR failure never silently becomes ACTIVE.
    expect(transitionRuntimeStatus("XR_FAILED", "PLACED")).toBe("XR_FAILED");
    expect(transitionRuntimeStatus("UNSUPPORTED_XR", "PLACED")).toBe("UNSUPPORTED_XR");
  });
});
