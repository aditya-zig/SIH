import { useEffect, useRef, useState } from "react";
import { getSyncContext } from "../../data.js";
import {
  FIRE_FIXTURE_LABEL,
  fireFixturePackage,
  fireFixtureScenario,
} from "../templates/fire.fixture.js";
import { evaluateAttempt } from "../evaluation/evaluateAttempt.js";
import {
  clearProgress,
  completeAttemptAtomically,
  getPackage,
  loadProgress,
  saveProgress,
  storeCompletePackage,
} from "../offline/attemptQueue.js";
import {
  ARPlacementTracker,
  DEFAULT_ROOT_POSITION,
  isImmersiveArSupported,
  mountTrainingScene,
  placeRootAt,
  speakInstruction,
  type MountedScene,
  type RuntimeStatus,
} from "../runtime/SceneRuntime.js";

type Phase = "brief" | "downloading" | "ready" | "running" | "assessment" | "result";
type RunMode = "preview" | "ar";

type AttemptEvent = { sequence: number; stepId: string; kind: string; targetId: string };

// Worker identity is the authenticated user when signed in, otherwise a
// stable per-browser demo id. Either way it scopes progress/attempts/queue so
// two workers on one device never share state. Demo ids are never synced as
// worker identities: server sync resolves identity from auth server-side.
export async function resolveWorkerId(): Promise<{ workerId: string; demo: boolean }> {
  const context = await getSyncContext().catch(() => null);
  if (context) return { workerId: context.workerId, demo: false };
  const KEY = "surakshaar-demo-worker-id";
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(KEY);
    if (!id) {
      id = `demo-${crypto.randomUUID()}`;
      window.localStorage.setItem(KEY, id);
    }
  } catch {
    id = `demo-ephemeral-${Date.now()}`;
  }
  return { workerId: id ?? `demo-ephemeral-${Date.now()}`, demo: true };
}

export default function WorkerLearn({ packageId, version }: { packageId: string; version: number }) {
  const [phase, setPhase] = useState<Phase>("brief");
  const [runMode, setRunMode] = useState<RunMode | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("UNMOUNTED");
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [events, setEvents] = useState<AttemptEvent[]>([]);
  const [placed, setPlaced] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [saveState, setSaveState] = useState<string>("");
  const [score, setScore] = useState<number | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<MountedScene | null>(null);
  const trackerRef = useRef<ARPlacementTracker | null>(null);
  const attemptRef = useRef<{ attemptId: string; startedAt: string; workerId: string } | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const pkg = fireFixturePackage;
  const isFixture = packageId === pkg.packageId && version === pkg.version;

  useEffect(() => {
    isImmersiveArSupported().then(setArSupported);
    resolveWorkerId().then(({ workerId: id }) => setWorkerId(id)).catch(() => undefined);
  }, []);

  const steps = pkg.trainingSteps;
  const current = steps[stepIndex];

  // Evaluator is the only progression authority: an entity interaction builds
  // one sequenced event for the current step; accepted advances, penalized
  // shows remediation, rejected changes nothing. Every step persists progress
  // scoped to this worker + package version for reload recovery.
  const interact = (kind: string, targetId: string) => {
    const step = steps[stepIndex];
    const attempt = attemptRef.current;
    if (!step || phase !== "running" || !placed || !attempt) return;
    const next = [...events, { sequence: events.length + 1, stepId: step.id, kind, targetId }];
    setEvents(next);
    const advanced = tryAdvance(step.id, next);
    void saveProgress({
      workerId: attempt.workerId,
      packageId: pkg.packageId,
      version: pkg.version,
      attemptId: attempt.attemptId,
      stepIndex: advanced,
      events: next,
      startedAt: attempt.startedAt,
      completed: false,
      clientScore: 0,
    }).catch(() => undefined);
  };

  // Pure evaluator fold reused by interact; returns the next step index.
  const tryAdvance = (stepId: string, next: AttemptEvent[]): number => {
    try {
      const res = evaluateAttempt(fireFixtureScenario as never, next as never);
      const last = res.events[res.events.length - 1];
      const step = steps.find((s) => s.id === stepId);
      if (last?.outcome === "accepted") {
        setFeedback(step?.successFeedback ?? "Correct.");
        const idx = steps.findIndex((s) => s.id === stepId);
        speakInstruction(steps[idx + 1]?.voiceText ?? "Training complete.");
        if (idx + 1 >= steps.length) {
          setRuntimeStatus("COMPLETE");
          setPhase("assessment");
          return idx + 1;
        }
        setStepIndex(idx + 1);
        return idx + 1;
      }
      if (last?.outcome === "penalized") {
        setFeedback(`${step?.failureFeedback ?? "Wrong choice."} ${step?.remediation ?? ""} (score ${res.score})`);
        return steps.findIndex((s) => s.id === stepId);
      }
      setFeedback("Not recognized for this step — no score change. Try the highlighted object.");
      return steps.findIndex((s) => s.id === stepId);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Invalid event stream");
      return steps.findIndex((s) => s.id === stepId);
    }
  };
  // Entity listeners mount once; always call the latest step/events via ref.
  const interactRef = useRef(interact);
  interactRef.current = interact;

  // Mount once when the run starts. Preview places the root deterministically;
  // AR starts a real hit-test tracked session and waits for a valid surface.
  useEffect(() => {
    if (phase !== "running" || !sceneRef.current || !runMode) return;
    try {
      const mounted = mountTrainingScene(sceneRef.current, pkg, {
        onAction: (a) => interactRef.current(a.kind, a.targetId),
      });
      mountedRef.current = mounted;
      setRuntimeStatus("READY");
      if (runMode === "preview") {
        placeRootAt(mounted.root, DEFAULT_ROOT_POSITION);
        setRuntimeStatus("ACTIVE");
        setPlaced(true);
        speakInstruction(pkg.trainingSteps[0]?.voiceText ?? "");
      } else {
        setRuntimeStatus("XR_ENTERING");
        const tracker = new ARPlacementTracker(mounted.root, mounted.reticle, {
          onStatus: setRuntimeStatus,
          onPlaced: () => {
            setPlaced(true);
            setRuntimeStatus("ACTIVE");
            speakInstruction(pkg.trainingSteps[0]?.voiceText ?? "");
          },
        });
        trackerRef.current = tracker;
        void tracker.start(mounted.scene).then((status) => {
          // PLACING keeps the reticle hidden until a real hit pose arrives;
          // UNSUPPORTED_XR / XR_FAILED render honestly and never claim AR.
          setRuntimeStatus(status);
        });
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Scene failed to mount");
    }
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      mountedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runMode]);

  if (!isFixture) {
    return (
      <main className="shell">
        <p className="eyebrow">Worker training</p>
        <h1>Package not found</h1>
        <p>Unknown package {packageId} v{version}. Fixture build only serves the Fire demo fixture.</p>
        <a href="/">Back</a>
      </main>
    );
  }

  const download = async () => {
    setPhase("downloading");
    await storeCompletePackage(pkg.packageId, pkg.version, pkg, pkg.assets.map((a) => a.assetKey));
    const ok = await getPackage(pkg.packageId, pkg.version);
    if (!ok) {
      setFeedback("Download incomplete — package is not launchable.");
      setPhase("brief");
      return;
    }
    setPhase("ready");
  };

  const startRun = async (mode: RunMode) => {
    const id = workerId ?? (await resolveWorkerId().catch(() => null))?.workerId;
    if (!id) {
      setFeedback("Worker identity unavailable — reload and try again.");
      return;
    }
    setWorkerId(id);
    // Resume this worker's own incomplete progress, never another worker's.
    const saved = await loadProgress(id, pkg.packageId, pkg.version).catch(() => undefined);
    if (saved && !saved.completed && saved.events.length > 0) {
      attemptRef.current = { attemptId: saved.attemptId, startedAt: saved.startedAt, workerId: id };
      setEvents(saved.events);
      setStepIndex(Math.min(saved.stepIndex, steps.length - 1));
      setResumed(true);
    } else {
      attemptRef.current = { attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(), workerId: id };
      setEvents([]);
      setStepIndex(0);
      setResumed(false);
    }
    setRunMode(mode);
    setPlaced(false);
    setRuntimeStatus("UNMOUNTED");
    setPhase("running");
  };

  // On-screen lock shares the real select path: it only places from a
  // currently valid reticle pose, never from a fixed origin.
  const lockPlacement = () => {
    const placedNow = trackerRef.current?.placeFromReticle() ?? false;
    if (!placedNow) setFeedback("No surface detected yet — aim at a surface until the reticle appears.");
  };

  const finish = async (correct: boolean) => {
    const finalEvents = events;
    const attempt = attemptRef.current;
    if (!attempt) {
      setFeedback("Attempt identity missing — restart the run.");
      return;
    }
    let provisional = 0;
    let critical = false;
    try {
      const r = evaluateAttempt(fireFixtureScenario as never, finalEvents as never);
      provisional = r.score;
      critical = r.criticalFailure;
      void critical;
    } catch {
      provisional = 0;
    }
    const payload = {
      attemptId: attempt.attemptId,
      workerId: attempt.workerId,
      deviceId: "browser-fixture",
      moduleId: pkg.packageId,
      moduleVersion: pkg.version,
      startedAt: attempt.startedAt,
      completedAt: new Date().toISOString(),
      clientScore: provisional,
      events: finalEvents,
    };
    await completeAttemptAtomically(payload);
    await clearProgress(attempt.workerId, pkg.packageId, pkg.version).catch(() => undefined);
    setScore(provisional);
    setSaveState("SAVED ON THIS PHONE");
    setPhase("result");
    // Opportunistic drain: scheduler also fires on online/focus/startup.
    const context = await getSyncContext().catch(() => null);
    if (context) {
      const { drainSyncQueue } = await import("../api/syncAttempt.js");
      await drainSyncQueue(context).catch(() => null);
    }
  };

  return (
    <main className="shell">
      <p className="eyebrow">Worker training / Fire fixture</p>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL}</div>
      <h1>{pkg.title}</h1>
      {phase === "brief" && (
        <section className="panel performance">
          <div className="panel-heading"><h2>Training brief</h2><span>offline-capable</span></div>
          <p>4 steps. Voice + text. Click the 3D objects in the scene, follow instructions, answer 1 question.</p>
          <p>WebXR: {arSupported === null ? "checking…" : arSupported ? "immersive-ar supported" : "not supported — interactive 3D fallback"}</p>
          <button className="primary-button" onClick={download}>Download training</button>
          {feedback && <p className="form-error">{feedback}</p>}
        </section>
      )}
      {phase === "downloading" && <p>Downloading package + assets…</p>}
      {phase === "ready" && (
        <section className="panel performance">
          <div className="panel-heading"><h2>Downloaded</h2><span>ready offline</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="primary-button" onClick={() => startRun("preview")}>Start in preview</button>
            <button className="text-button" onClick={() => startRun("ar")}>Enter AR</button>
          </div>
        </section>
      )}
      {phase === "running" && (
        <section className="panel performance">
          <div className="panel-heading">
            <h2>{!placed ? "Place training" : `Step ${stepIndex + 1}/${steps.length}: ${current?.id}`}</h2>
            <span>{runMode === "ar" ? `AR · ${runtimeStatus}` : `preview · ${runtimeStatus}`}</span>
          </div>
          {(runtimeStatus === "UNSUPPORTED_XR" || (runMode === "ar" && arSupported === false && runtimeStatus !== "PLACING" && runtimeStatus !== "ACTIVE")) && (
            <p className="empty">WebXR immersive-ar is not available here — showing explicit interactive 3D fallback, not AR success.</p>
          )}
          {runtimeStatus === "XR_FAILED" && (
            <p className="form-error">AR session failed to start. This is not AR — use preview instead.</p>
          )}
          <div ref={sceneRef} style={{ minHeight: 320, border: "1px solid var(--line)" }} />
          {runMode === "ar" && !placed && runtimeStatus === "PLACING" && (
            <button className="primary-button" onClick={lockPlacement}>Lock placement (tap)</button>
          )}
          {runMode === "ar" && !placed && runtimeStatus === "XR_ENTERING" && <p>Entering immersive AR…</p>}
          {placed && <p>{current?.instruction}</p>}
          {placed && <p className="empty">Click the 3D object for this step. Wrong objects follow penalty rules.</p>}
          {resumed && placed && <p className="empty">Resumed your saved progress for this training version.</p>}
          {feedback && <p>{feedback}</p>}
          <p className="empty">Events recorded: {events.length}</p>
        </section>
      )}
      {phase === "assessment" && (
        <section className="panel performance">
          <div className="panel-heading"><h2>Assessment</h2><span>1 question</span></div>
          <p>{pkg.assessment.questions[0]?.prompt}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary-button" onClick={() => finish(true)}>Correct answer</button>
            <button className="text-button" onClick={() => finish(false)}>Wrong answer</button>
          </div>
        </section>
      )}
      {phase === "result" && (
        <section className="panel performance">
          <div className="panel-heading"><h2>Result</h2><span>provisional — server recomputes</span></div>
          <p>Provisional score: {score}</p>
          <p><strong>{saveState}</strong></p>
          <p className="empty">Reconnect syncs once and reaches SERVER CONFIRMED only after backend 200. Offline queue survives reload.</p>
          <a href="/">Back to dashboard</a>
        </section>
      )}
    </main>
  );
}
