import { describe, expect, it, vi } from "vitest";
import {
  AR_SESSION_INIT,
  ARPlacementTracker,
  configureARFeatures,
  extractHitPose,
  type HitPose,
  type XRFrameLike,
  type XRHitTestSourceLike,
  type XRReferenceSpaceLike,
  type XRSessionLike,
} from "./SceneRuntime.js";

class FakeElement {
  attrs = new Map<string, string>();
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
}

function fakePose(px: number, py: number, pz: number) {
  return {
    transform: {
      position: { x: px, y: py, z: pz },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

function fakeFrame(results: Array<{ pose: unknown }>): XRFrameLike {
  return {
    getHitTestResults: () => results.map((r) => ({ getPose: () => r.pose }) as never),
  };
}

const SPACE = {} as XRReferenceSpaceLike;
const SOURCE = { cancel: vi.fn() } as XRHitTestSourceLike;

type SessionOpts = {
  enterFails?: boolean;
  spaces?: { viewer?: boolean; localFloor?: boolean };
  hitSourceFails?: boolean;
};

function fakeSession(opts: SessionOpts = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const frames: Array<(t: number, f: XRFrameLike) => void> = [];
  const session: XRSessionLike & {
    listeners: typeof listeners;
    frames: typeof frames;
    emit: (t: string) => void;
    ended: boolean;
    canceled: boolean;
  } = {
    listeners,
    frames,
    emit: (t: string) => {
      for (const fn of listeners.get(t) ?? []) fn();
    },
    ended: false,
    canceled: false,
    requestReferenceSpace: async (type: string) => {
      if (type === "viewer" && opts.spaces?.viewer === false) throw new Error("no viewer");
      if (type === "local-floor" && opts.spaces?.localFloor === false) throw new Error("no floor");
      return SPACE;
    },
    requestHitTestSource: async () => {
      if (opts.hitSourceFails) throw new Error("no hit source");
      return { cancel: () => { session.canceled = true; } };
    },
    requestAnimationFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    addEventListener: (t: string, cb: () => void) => {
      listeners.set(t, [...(listeners.get(t) ?? []), cb]);
    },
    removeEventListener: (t: string, cb: () => void) => {
      listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== cb));
    },
    end: async () => {
      session.ended = true;
    },
  };
  return session;
}

function fakeScene(session: XRSessionLike | null, opts: SessionOpts = {}) {
  return {
    attrs: new Map<string, string>(),
    setAttribute(k: string, v: string): void {
      this.attrs.set(k, v);
    },
    renderer: { xr: { getSession: () => session } },
    enterAR: async () => {
      if (opts.enterFails) throw new Error("enter failed");
    },
  };
}

describe("WebXR hit-test placement (E03)", () => {
  it("requests immersive-ar with hit-test and a floor space", () => {
    expect(AR_SESSION_INIT.requiredFeatures).toContain("hit-test");
    expect(AR_SESSION_INIT.optionalFeatures).toContain("local-floor");
    const el = new FakeElement();
    configureARFeatures(el as never);
    expect(el.getAttribute("webxr")).toContain("hit-test");
  });

  it("unsupported XR reports UNSUPPORTED_XR without touching a session", async () => {
    const tracker = new ARPlacementTracker(new FakeElement() as never, new FakeElement() as never, {
      isSupported: async () => false,
    });
    const status = await tracker.start(fakeScene(null) as never);
    expect(status).toBe("UNSUPPORTED_XR");
    expect(tracker.isTracking).toBe(false);
  });

  it("requestSession/enter failure reports XR_FAILED", async () => {
    const tracker = new ARPlacementTracker(new FakeElement() as never, new FakeElement() as never, {
      isSupported: async () => true,
    });
    const status = await tracker.start(fakeScene(fakeSession(), { enterFails: true }) as never);
    expect(status).toBe("XR_FAILED");
  });

  it("initializes viewer space, hit source, and floor space on start", async () => {
    const session = fakeSession();
    const onStatus = vi.fn();
    const tracker = new ARPlacementTracker(new FakeElement() as never, new FakeElement() as never, {
      isSupported: async () => true,
      onStatus,
    });
    const status = await tracker.start(fakeScene(session) as never);
    expect(status).toBe("PLACING");
    expect(tracker.isTracking).toBe(true);
    expect(session.frames).toHaveLength(1);
  });

  it("valid hit pose shows the reticle at the hit position", async () => {
    const session = fakeSession();
    const root = new FakeElement();
    const reticle = new FakeElement();
    const tracker = new ARPlacementTracker(root as never, reticle as never, {
      isSupported: async () => true,
    });
    await tracker.start(fakeScene(session) as never);
    session.frames[0]?.(16, fakeFrame([{ pose: fakePose(1, 0, -2) }]));
    expect(reticle.getAttribute("visible")).toBe("true");
    expect(reticle.getAttribute("position")).toBe("1 0 -2");
    expect(tracker.latestPose).toEqual({ position: [1, 0, -2], orientation: [0, 0, 0, 1] });
  });

  it("no hit hides the reticle and clears the pose", async () => {
    const session = fakeSession();
    const reticle = new FakeElement();
    const tracker = new ARPlacementTracker(new FakeElement() as never, reticle as never, {
      isSupported: async () => true,
    });
    await tracker.start(fakeScene(session) as never);
    session.frames[0]?.(16, fakeFrame([{ pose: fakePose(1, 0, -2) }]));
    expect(tracker.latestPose).not.toBeNull();
    session.frames[1]?.(32, fakeFrame([]));
    expect(reticle.getAttribute("visible")).toBe("false");
    expect(tracker.latestPose).toBeNull();
  });

  it("select before a valid hit is ignored and places nothing", async () => {
    const session = fakeSession();
    const root = new FakeElement();
    const onPlaced = vi.fn();
    const tracker = new ARPlacementTracker(root as never, new FakeElement() as never, {
      isSupported: async () => true,
      onPlaced,
    });
    await tracker.start(fakeScene(session) as never);
    session.emit("select");
    expect(onPlaced).not.toHaveBeenCalled();
    expect(root.getAttribute("position")).toBeNull();
    expect(tracker.isTracking).toBe(true);
  });

  it("select after a valid hit locks the root and stops tracking", async () => {
    const session = fakeSession();
    const root = new FakeElement();
    const reticle = new FakeElement();
    const onPlaced = vi.fn();
    const tracker = new ARPlacementTracker(root as never, reticle as never, {
      isSupported: async () => true,
      onPlaced,
    });
    await tracker.start(fakeScene(session) as never);
    session.frames[0]?.(16, fakeFrame([{ pose: fakePose(0.5, 0, -1.5) }]));
    session.emit("select");
    expect(root.getAttribute("position")).toBe("0.5 0 -1.5");
    expect(reticle.getAttribute("visible")).toBe("false");
    expect(onPlaced).toHaveBeenCalledWith([0.5, 0, -1.5]);
    expect(tracker.isTracking).toBe(false);
  });

  it("stop and session end clean up source plus listeners", async () => {
    const session = fakeSession();
    const tracker = new ARPlacementTracker(new FakeElement() as never, new FakeElement() as never, {
      isSupported: async () => true,
    });
    await tracker.start(fakeScene(session) as never);
    expect(session.listeners.get("select")).toHaveLength(1);
    tracker.stop();
    expect(session.canceled).toBe(true);
    expect(session.listeners.get("select")).toHaveLength(0);
    expect(session.listeners.get("end")).toHaveLength(0);
    expect(session.ended).toBe(true);
    expect(tracker.isTracking).toBe(false);
  });

  it("extractHitPose rejects empty, null, and non-finite hits", () => {
    expect(extractHitPose(fakeFrame([]), SOURCE, SPACE)).toBeNull();
    expect(extractHitPose(fakeFrame([{ pose: null }]), SOURCE, SPACE)).toBeNull();
    expect(extractHitPose(fakeFrame([{ pose: fakePose(NaN, 0, 0) }]), SOURCE, SPACE)).toBeNull();
    const pose: HitPose | null = extractHitPose(fakeFrame([{ pose: fakePose(1, 2, 3) }]), SOURCE, SPACE);
    expect(pose?.position).toEqual([1, 2, 3]);
  });
});
