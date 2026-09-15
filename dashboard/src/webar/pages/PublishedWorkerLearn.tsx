import { useEffect, useRef, useState } from "react";
import { getSyncContext } from "../../data.js";
import { describeQueueState, drainSyncQueue } from "../api/syncAttempt.js";
import { loadPublishedTraining, type PublishedTrainingBundle } from "../api/liveSupabase.js";
import { evaluateAttempt } from "../evaluation/evaluateAttempt.js";
import {
  clearProgress,
  completeAttemptAtomically,
  getPackage,
  listQueue,
  loadProgress,
  saveProgress,
  storeCompletePackage,
  type QueueEntry,
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
import { resolveWorkerId } from "./WorkerLearn.js";

type Phase = "loading" | "brief" | "ready" | "running" | "assessment" | "result";
type RunMode = "preview" | "ar";
type AttemptEvent = { sequence: number; stepId: string; kind: string; targetId: string };

function isBundle(value: unknown): value is PublishedTrainingBundle {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PublishedTrainingBundle>;
  return typeof v.moduleSlug === "string" && !!v.package && !!v.scenario;
}

export default function PublishedWorkerLearn({ moduleSlug, version }: { moduleSlug: string; version: number }) {
  const [bundle, setBundle] = useState<PublishedTrainingBundle | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [runMode, setRunMode] = useState<RunMode | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("UNMOUNTED");
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [events, setEvents] = useState<AttemptEvent[]>([]);
  const [placed, setPlaced] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [queueEntry, setQueueEntry] = useState<QueueEntry | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<ARPlacementTracker | null>(null);
  const mountedRef = useRef<MountedScene | null>(null);
  const attemptRef = useRef<{ attemptId: string; startedAt: string; workerId: string } | null>(null);
  const interactRef = useRef<(kind: string, targetId: string) => void>(() => undefined);

  useEffect(() => {
    isImmersiveArSupported().then(setArSupported).catch(() => setArSupported(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError("");
      try {
        const cached = await getPackage(moduleSlug, version).catch(() => undefined);
        if (isBundle(cached)) {
          if (!cancelled) {
            setBundle(cached);
            setDownloaded(true);
            setPhase("brief");
          }
          return;
        }
        const live = await loadPublishedTraining(moduleSlug, version);
        if (!cancelled) {
          setBundle(live);
          setPhase("brief");
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Training could not be loaded");
          setPhase("brief");
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [moduleSlug, version]);

  const pkg = bundle?.package;
  const scenario = bundle?.scenario;
  const steps = pkg?.trainingSteps ?? [];
  const current = steps[stepIndex];

  const tryAdvance = (stepId: string, next: AttemptEvent[]): number => {
    if (!scenario) return stepIndex;
    try {
      const result = evaluateAttempt(scenario, next);
      const last = result.events[result.events.length - 1];
      const index = steps.findIndex((step) => step.id === stepId);
      const step = steps[index];
      if (last?.outcome === "accepted") {
        setFeedback(step?.successFeedback ?? "Correct.");
        if (index + 1 >= steps.length) {
          setRuntimeStatus("COMPLETE");
          setPhase("assessment");
          return index + 1;
        }
        setStepIndex(index + 1);
        speakInstruction(steps[index + 1]?.voiceText ?? "");
        return index + 1;
      }
      if (last?.outcome === "penalized") {
        setFeedback(`${step?.failureFeedback ?? "Wrong choice."} ${step?.remediation ?? ""} (score ${result.score})`);
        return Math.max(index, 0);
      }
      setFeedback("That action is not accepted for this step. Try the instructed object.");
      return Math.max(index, 0);
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "Invalid event stream");
      return stepIndex;
    }
  };

  const interact = (kind: string, targetId: string) => {
    const step = steps[stepIndex];
    const attempt = attemptRef.current;
    if (!bundle || !step || phase !== "running" || !placed || !attempt) return;
    const next = [...events, { sequence: events.length + 1, stepId: step.id, kind, targetId }];
    setEvents(next);
    const nextIndex = tryAdvance(step.id, next);
    void saveProgress({
      workerId: attempt.workerId,
      packageId: moduleSlug,
      version,
      attemptId: attempt.attemptId,
      stepIndex: nextIndex,
      events: next,
      startedAt: attempt.startedAt,
      completed: false,
      clientScore: 0,
    }).catch(() => undefined);
  };
  interactRef.current = interact;

  useEffect(() => {
    if (!pkg || phase !== "running" || !sceneRef.current || !runMode) return;
    try {
      const mounted = mountTrainingScene(sceneRef.current, pkg, { onAction: (action) => interactRef.current(action.kind, action.targetId) });
      mountedRef.current = mounted;
      setRuntimeStatus("READY");
      if (runMode === "preview") {
        placeRootAt(mounted.root, DEFAULT_ROOT_POSITION);
        setPlaced(true);
        setRuntimeStatus("ACTIVE");
        speakInstruction(steps[0]?.voiceText ?? "");
      } else {
        setRuntimeStatus("XR_ENTERING");
        const tracker = new ARPlacementTracker(mounted.root, mounted.reticle, {
          onStatus: setRuntimeStatus,
          onPlaced: () => {
            setPlaced(true);
            setRuntimeStatus("ACTIVE");
            speakInstruction(steps[0]?.voiceText ?? "");
          },
        });
        trackerRef.current = tracker;
        void tracker.start(mounted.scene).then(setRuntimeStatus);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Scene failed to mount");
    }
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      mountedRef.current = null;
    };
  }, [pkg, phase, runMode]);

  const download = async () => {
    if (!bundle) return;
    try {
      await storeCompletePackage(moduleSlug, version, bundle, bundle.package.assets.map((asset) => asset.assetKey));
      setDownloaded(true);
      setPhase("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Offline download failed");
    }
  };

  const startRun = async (mode: RunMode) => {
    if (!bundle) return;
    const identity = await resolveWorkerId().catch(() => null);
    if (!identity) {
      setError("Worker identity unavailable");
      return;
    }
    const saved = await loadProgress(identity.workerId, moduleSlug, version).catch(() => undefined);
    if (saved && !saved.completed && saved.events.length > 0) {
      attemptRef.current = { attemptId: saved.attemptId, startedAt: saved.startedAt, workerId: identity.workerId };
      setEvents(saved.events);
      setStepIndex(Math.min(saved.stepIndex, Math.max(0, steps.length - 1)));
    } else {
      attemptRef.current = { attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(), workerId: identity.workerId };
      setEvents([]);
      setStepIndex(0);
    }
    setRunMode(mode);
    setPlaced(false);
    setRuntimeStatus("UNMOUNTED");
    setPhase("running");
  };

  const finish = async () => {
    if (!bundle || !scenario || !attemptRef.current) return;
    const attempt = attemptRef.current;
    let provisional = 0;
    try { provisional = evaluateAttempt(scenario, events).score; } catch { provisional = 0; }
    await completeAttemptAtomically({
      attemptId: attempt.attemptId,
      workerId: attempt.workerId,
      deviceId: "browser-webar",
      moduleId: moduleSlug,
      moduleVersion: version,
      startedAt: attempt.startedAt,
      completedAt: new Date().toISOString(),
      clientScore: provisional,
      events,
    });
    await clearProgress(attempt.workerId, moduleSlug, version).catch(() => undefined);
    setScore(provisional);
    const syncContext = await getSyncContext().catch(() => null);
    if (syncContext) await drainSyncQueue(syncContext).catch(() => null);
    const queue = await listQueue(attempt.workerId).catch(() => []);
    setQueueEntry(queue.find((entry) => entry.attemptId === attempt.attemptId) ?? null);
    setPhase("result");
  };

  if (phase === "loading") return <main className="shell"><h1>Loading training…</h1></main>;
  if (!bundle || !pkg || !scenario) return <main className="shell"><h1>Training unavailable</h1><p className="form-error">{error || "Published package not found."}</p><a href="/">Back</a></main>;

  return <main className="shell">
    <p className="eyebrow">Worker training / Published WebAR</p>
    <h1>{pkg.title}</h1>
    <div className="demo-strip">Published immutable package · {moduleSlug} v{version}</div>
    {error && <p className="form-error">{error}</p>}

    {phase === "brief" && <section className="panel performance">
      <div className="panel-heading"><h2>Training brief</h2><span>{downloaded ? "available offline" : "online package loaded"}</span></div>
      <p>{steps.length} interactive steps. Server evaluation remains authoritative after sync.</p>
      <p>WebXR: {arSupported === null ? "checking…" : arSupported ? "immersive-ar supported" : "not supported — preview remains available"}</p>
      <button className="primary-button" onClick={() => void download()}>{downloaded ? "Verify offline copy" : "Download training"}</button>
      {downloaded && <button className="text-button" onClick={() => setPhase("ready")}>Continue</button>}
    </section>}

    {phase === "ready" && <section className="panel performance">
      <div className="panel-heading"><h2>Ready</h2><span>cached for this module/version</span></div>
      <button className="primary-button" onClick={() => void startRun("preview")}>Start preview</button>
      <button className="text-button" onClick={() => void startRun("ar")}>Enter AR</button>
    </section>}

    {phase === "running" && <section className="panel performance">
      <div className="panel-heading"><h2>{placed ? `Step ${stepIndex + 1}/${steps.length}` : "Place training"}</h2><span>{runMode} · {runtimeStatus}</span></div>
      {(runtimeStatus === "UNSUPPORTED_XR" || runtimeStatus === "XR_FAILED") && <p className="form-error">Immersive AR is unavailable or failed. This is not reported as AR success; use preview.</p>}
      <div ref={sceneRef} style={{ minHeight: 320, border: "1px solid var(--line)" }} />
      {runMode === "ar" && !placed && runtimeStatus === "PLACING" && <button className="primary-button" onClick={() => {
        if (!trackerRef.current?.placeFromReticle()) setFeedback("No valid surface yet — wait for the reticle.");
      }}>Lock placement</button>}
      {placed && <><p>{current?.instruction}</p><p className="empty">Interact with the 3D object. Wrong actions use the published evaluator rules.</p></>}
      {feedback && <p>{feedback}</p>}
    </section>}

    {phase === "assessment" && <section className="panel performance">
      <div className="panel-heading"><h2>Assessment</h2><span>completion checkpoint</span></div>
      <p>{pkg.assessment.questions[0]?.prompt ?? "Complete training"}</p>
      {(pkg.assessment.questions[0]?.options ?? ["Finish"]).map((option) => <button className="text-button" key={option} onClick={() => void finish()}>{option}</button>)}
      <p className="empty">The deterministic server evaluator scores the recorded training actions. The client does not issue certificates.</p>
    </section>}

    {phase === "result" && <section className="panel performance">
      <div className="panel-heading"><h2>Attempt saved</h2><span>local provisional score {score ?? 0}</span></div>
      <p>{queueEntry ? describeQueueState(queueEntry.state, queueEntry.serverResult) : "SAVED ON THIS PHONE — pending queue lookup"}</p>
      {queueEntry?.state === "CONFIRMED" && <p className="empty">Only the server-confirmed result above is authoritative.</p>}
      <a href="/">Back to dashboard</a>
    </section>}
  </main>;
}
