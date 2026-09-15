import { useEffect, useRef, useState } from "react";
import {
  FIRE_FIXTURE_LABEL,
  fireFixturePackage,
  fireFixtureScenario,
} from "../templates/fire.fixture.js";
import { evaluateAttempt } from "../evaluation/evaluateAttempt.js";
import {
  completeAttemptAtomically,
  getPackage,
  storeCompletePackage,
} from "../offline/attemptQueue.js";
import {
  DEFAULT_ROOT_POSITION,
  enterAR,
  isImmersiveArSupported,
  mountTrainingScene,
  placeRootAt,
  setReticleVisible,
  speakInstruction,
  type MountedScene,
  type RuntimeStatus,
} from "../runtime/SceneRuntime.js";

type Phase = "brief" | "downloading" | "ready" | "running" | "assessment" | "result";
type RunMode = "preview" | "ar";

type AttemptEvent = { sequence: number; stepId: string; kind: string; targetId: string };

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
  const pkg = fireFixturePackage;
  const isFixture = packageId === pkg.packageId && version === pkg.version;

  useEffect(() => {
    isImmersiveArSupported().then(setArSupported);
  }, []);

  const steps = pkg.trainingSteps;
  const current = steps[stepIndex];

  // Evaluator is the only progression authority: an entity interaction builds
  // one sequenced event for the current step; accepted advances, penalized
  // shows remediation, rejected changes nothing.
  const interact = (kind: string, targetId: string) => {
    const step = steps[stepIndex];
    if (!step || phase !== "running" || !placed) return;
    const next = [...events, { sequence: events.length + 1, stepId: step.id, kind, targetId }];
    setEvents(next);
    try {
      const res = evaluateAttempt(fireFixtureScenario as never, next as never);
      const last = res.events[res.events.length - 1];
      if (last?.outcome === "accepted") {
        setFeedback(step.successFeedback);
        speakInstruction(steps[stepIndex + 1]?.voiceText ?? "Training complete.");
        if (stepIndex + 1 >= steps.length) {
          setRuntimeStatus("COMPLETE");
          setPhase("assessment");
        } else {
          setStepIndex(stepIndex + 1);
        }
      } else if (last?.outcome === "penalized") {
        setFeedback(`${step.failureFeedback} ${step.remediation ?? ""} (score ${res.score})`);
      } else {
        setFeedback("Not recognized for this step — no score change. Try the highlighted object.");
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Invalid event stream");
    }
  };
  // Entity listeners mount once; always call the latest step/events via ref.
  const interactRef = useRef(interact);
  interactRef.current = interact;

  // Mount once when the run starts. Preview places the root deterministically;
  // AR enters an immersive session first and waits for an explicit tap.
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
        void enterAR(mounted.scene).then((status) => {
          if (status === "PLACING") {
            setRuntimeStatus("PLACING");
            setReticleVisible(mounted.reticle, true);
          } else {
            // UNSUPPORTED_XR / XR_FAILED: shown honestly, never labeled AR.
            setRuntimeStatus(status);
          }
        });
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Scene failed to mount");
    }
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

  const startRun = (mode: RunMode) => {
    setRunMode(mode);
    setPlaced(false);
    setRuntimeStatus("UNMOUNTED");
    setPhase("running");
  };

  // AR tap stands in for the XR select event until session-select wiring lands.
  // It only runs inside a real entered session (PLACING); desktop never reaches it.
  const lockPlacement = () => {
    const mounted = mountedRef.current;
    if (!mounted) return;
    placeRootAt(mounted.root, DEFAULT_ROOT_POSITION);
    setReticleVisible(mounted.reticle, false);
    setPlaced(true);
    setRuntimeStatus("ACTIVE");
    speakInstruction(current?.voiceText ?? "");
  };

  const finish = async (correct: boolean) => {
    const finalEvents = events;
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
      attemptId: crypto.randomUUID(),
      deviceId: "browser-fixture",
      moduleId: pkg.packageId,
      moduleVersion: pkg.version,
      startedAt: new Date(Date.now() - finalEvents.length * 10000).toISOString(),
      completedAt: new Date().toISOString(),
      clientScore: provisional,
      events: finalEvents,
    };
    await completeAttemptAtomically(payload);
    setScore(provisional);
    setSaveState("SAVED ON THIS PHONE");
    setPhase("result");
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
