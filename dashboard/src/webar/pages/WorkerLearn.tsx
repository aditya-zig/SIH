import { useEffect, useRef, useState } from "react";
import { getSyncContext } from "../../data.js";
import type { SyncV2Result } from "../api/syncAttempt.js";
import { fireFixturePackage, fireFixtureScenario, FIRE_FIXTURE_LABEL } from "../templates/fire.fixture.js";
import { deriveCompetencyResult, type CompetencyResult } from "../evaluation/competency.js";
import { evaluateAttempt, type AttemptEvaluation } from "../evaluation/evaluateAttempt.js";
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

type Phase = "brief" | "downloading" | "learn" | "quiz" | "ready" | "running" | "scenario" | "result";
type RunMode = "preview" | "ar";
type AttemptEvent = { sequence: number; stepId: string; kind: string; targetId: string };

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

function syncMessage(entry: QueueEntry | null): string {
  if (!entry) return "Saved on this device";
  if (entry.state === "CONFIRMED") return "Result verified";
  if (entry.state === "SYNCING") return "Verifying result";
  if (entry.state === "CONFLICT") return "Result needs attention before it can be verified";
  if (entry.state === "BLOCKED") return "Sign in again to verify this result";
  return typeof navigator !== "undefined" && navigator.onLine ? "Waiting for verification" : "Waiting for connection";
}

export default function WorkerLearn({ packageId, version }: { packageId: string; version: number }) {
  const pkg = fireFixturePackage;
  const isFixture = packageId === pkg.packageId && version === pkg.version;
  const lessons = pkg.lessons ?? [];
  const questions = pkg.assessment.questions;
  const practicalSteps = pkg.trainingSteps.filter((step) => step.id !== "judgment");

  const [phase, setPhase] = useState<Phase>("brief");
  const [lessonIndex, setLessonIndex] = useState(0);
  const [lessonComplete, setLessonComplete] = useState(false);
  const [lessonFeedback, setLessonFeedback] = useState("");
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizFeedback, setQuizFeedback] = useState("");
  const [runMode, setRunMode] = useState<RunMode | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("UNMOUNTED");
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [events, setEvents] = useState<AttemptEvent[]>([]);
  const [placed, setPlaced] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [queueEntry, setQueueEntry] = useState<QueueEntry | null>(null);
  const [evaluation, setEvaluation] = useState<AttemptEvaluation | null>(null);
  const [competency, setCompetency] = useState<CompetencyResult | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  const sceneRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<MountedScene | null>(null);
  const trackerRef = useRef<ARPlacementTracker | null>(null);
  const attemptRef = useRef<{ attemptId: string; startedAt: string; workerId: string } | null>(null);

  useEffect(() => {
    isImmersiveArSupported().then(setArSupported).catch(() => setArSupported(false));
    resolveWorkerId().then(({ workerId: id }) => setWorkerId(id)).catch(() => undefined);
  }, []);

  const saveCheckpoint = async (nextEvents: AttemptEvent[], nextStepIndex = stepIndex) => {
    const attempt = attemptRef.current;
    if (!attempt) return;
    await saveProgress({
      workerId: attempt.workerId,
      packageId: pkg.packageId,
      version: pkg.version,
      attemptId: attempt.attemptId,
      stepIndex: nextStepIndex,
      events: nextEvents,
      startedAt: attempt.startedAt,
      completed: false,
      clientScore: 0,
    }).catch(() => undefined);
  };

  const prepareJourney = async () => {
    const id = workerId ?? (await resolveWorkerId().catch(() => null))?.workerId;
    if (!id) {
      setFeedback("Worker identity unavailable — reload and try again.");
      return;
    }
    setWorkerId(id);
    const saved = await loadProgress(id, pkg.packageId, pkg.version).catch(() => undefined);
    if (!saved || saved.completed) {
      setLessonIndex(0);
      setLessonComplete(false);
      setLessonFeedback("");
      setPhase("learn");
      return;
    }

    attemptRef.current = { attemptId: saved.attemptId, startedAt: saved.startedAt, workerId: id };
    setEvents(saved.events);
    setResumed(true);
    if (saved.events.length === 0) {
      setPhase("quiz");
      return;
    }
    const result = evaluateAttempt(fireFixtureScenario as never, saved.events as never);
    const accepted = result.events.filter((event) => event.outcome === "accepted").length;
    if (accepted < questions.length) {
      setQuizIndex(accepted);
      setPhase("quiz");
      return;
    }
    const practicalAccepted = accepted - questions.length;
    if (practicalAccepted < practicalSteps.length) {
      setStepIndex(Math.max(0, practicalAccepted));
      setPhase("ready");
      return;
    }
    setPhase("scenario");
  };

  const download = async () => {
    setPhase("downloading");
    await storeCompletePackage(pkg.packageId, pkg.version, pkg, pkg.assets.map((asset) => asset.assetKey));
    const ok = await getPackage(pkg.packageId, pkg.version);
    if (!ok) {
      setFeedback("Download incomplete — training is not ready offline.");
      setPhase("brief");
      return;
    }
    await prepareJourney();
  };

  const answerLesson = (option: string) => {
    const lesson = lessons[lessonIndex];
    if (!lesson) return;
    const correct = option === lesson.checkAnswer;
    setLessonComplete(correct);
    setLessonFeedback(correct ? lesson.feedback : `Try again. ${lesson.feedback}`);
  };

  const nextLesson = async () => {
    if (!lessonComplete) return;
    if (lessonIndex + 1 < lessons.length) {
      setLessonIndex((index) => index + 1);
      setLessonComplete(false);
      setLessonFeedback("");
      return;
    }
    const id = workerId ?? (await resolveWorkerId().catch(() => null))?.workerId;
    if (!id) return;
    const attempt = { attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(), workerId: id };
    attemptRef.current = attempt;
    setEvents([]);
    await saveProgress({
      workerId: id,
      packageId: pkg.packageId,
      version: pkg.version,
      attemptId: attempt.attemptId,
      stepIndex: 0,
      events: [],
      startedAt: attempt.startedAt,
      completed: false,
      clientScore: 0,
    });
    setQuizIndex(0);
    setQuizFeedback("");
    setPhase("quiz");
  };

  const answerQuestion = async (option: string) => {
    const question = questions[quizIndex];
    const attempt = attemptRef.current;
    if (!question || !attempt) return;
    const next = [...events, { sequence: events.length + 1, stepId: question.id, kind: "answer", targetId: option }];
    const result = evaluateAttempt(fireFixtureScenario as never, next as never);
    const last = result.events[result.events.length - 1];
    setEvents(next);
    if (last?.outcome === "accepted") {
      setQuizFeedback(`Correct. ${question.explanation ?? ""}`);
      const nextQuestion = quizIndex + 1;
      await saveCheckpoint(next, 0);
      if (nextQuestion >= questions.length) {
        setQuizIndex(nextQuestion);
        setPhase("ready");
      } else {
        setQuizIndex(nextQuestion);
      }
      return;
    }
    setQuizFeedback(`Not yet. ${question.explanation ?? "Try again."}`);
    await saveCheckpoint(next, 0);
  };

  const interact = (kind: string, targetId: string) => {
    const step = practicalSteps[stepIndex];
    const attempt = attemptRef.current;
    if (!step || phase !== "running" || !placed || !attempt) return;
    const next = [...events, { sequence: events.length + 1, stepId: step.id, kind, targetId }];
    const result = evaluateAttempt(fireFixtureScenario as never, next as never);
    const last = result.events[result.events.length - 1];
    setEvents(next);
    if (last?.outcome === "accepted") {
      setFeedback(step.successFeedback);
      const nextIndex = stepIndex + 1;
      void saveCheckpoint(next, nextIndex);
      if (nextIndex >= practicalSteps.length) {
        setRuntimeStatus("COMPLETE");
        setPhase("scenario");
        return;
      }
      setStepIndex(nextIndex);
      speakInstruction(practicalSteps[nextIndex]?.voiceText ?? "");
      return;
    }
    if (last?.outcome === "penalized") setFeedback(`${step.failureFeedback} ${step.remediation ?? ""}`);
    else setFeedback("That interaction does not match the current objective. Try the highlighted target.");
    void saveCheckpoint(next, stepIndex);
  };
  const interactRef = useRef(interact);
  interactRef.current = interact;

  useEffect(() => {
    if (phase !== "running" || !sceneRef.current || !runMode) return;
    try {
      const mounted = mountTrainingScene(sceneRef.current, pkg, { onAction: (action) => interactRef.current(action.kind, action.targetId) });
      mountedRef.current = mounted;
      setRuntimeStatus("READY");
      if (runMode === "preview") {
        placeRootAt(mounted.root, DEFAULT_ROOT_POSITION);
        setRuntimeStatus("ACTIVE");
        setPlaced(true);
        speakInstruction(practicalSteps[stepIndex]?.voiceText ?? "");
      } else {
        setRuntimeStatus("XR_ENTERING");
        const tracker = new ARPlacementTracker(mounted.root, mounted.reticle, {
          onStatus: setRuntimeStatus,
          onPlaced: () => {
            setPlaced(true);
            setRuntimeStatus("ACTIVE");
            speakInstruction(practicalSteps[stepIndex]?.voiceText ?? "");
          },
        });
        trackerRef.current = tracker;
        void tracker.start(mounted.scene).then(setRuntimeStatus);
      }
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "Scene failed to mount");
    }
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      mountedRef.current = null;
    };
  }, [phase, runMode]);

  const startRun = (mode: RunMode) => {
    if (!attemptRef.current) {
      setFeedback("Training checkpoint missing — return to the knowledge check.");
      return;
    }
    setRunMode(mode);
    setPlaced(false);
    setRuntimeStatus("UNMOUNTED");
    setFeedback("");
    setPhase("running");
  };

  const lockPlacement = () => {
    if (!trackerRef.current?.placeFromReticle()) setFeedback("No surface detected yet — move your phone slowly until the reticle appears.");
  };

  const finish = async (finalEvents: AttemptEvent[]) => {
    const attempt = attemptRef.current;
    if (!attempt) return;
    const result = evaluateAttempt(fireFixtureScenario as never, finalEvents as never);
    await completeAttemptAtomically({
      attemptId: attempt.attemptId,
      workerId: attempt.workerId,
      deviceId: "browser-fixture",
      moduleId: pkg.packageId,
      moduleVersion: pkg.version,
      startedAt: attempt.startedAt,
      completedAt: new Date().toISOString(),
      clientScore: result.score,
      events: finalEvents,
    });
    await clearProgress(attempt.workerId, pkg.packageId, pkg.version).catch(() => undefined);
    setEvaluation(result);
    setCompetency(deriveCompetencyResult(fireFixtureScenario as never, result));
    setPhase("result");
    const context = await getSyncContext().catch(() => null);
    if (context) {
      const { drainSyncQueue } = await import("../api/syncAttempt.js");
      await drainSyncQueue(context).catch(() => null);
    }
    const entries = await listQueue(attempt.workerId).catch(() => []);
    setQueueEntry(entries.find((entry) => entry.attemptId === attempt.attemptId) ?? null);
  };

  const decide = async (targetId: "evacuate" | "keep-fighting" | "move-closer") => {
    const attempt = attemptRef.current;
    if (!attempt) return;
    const next = [...events, { sequence: events.length + 1, stepId: "judgment", kind: "decision", targetId }];
    const result = evaluateAttempt(fireFixtureScenario as never, next as never);
    const last = result.events[result.events.length - 1];
    setEvents(next);
    if (last?.outcome === "accepted") {
      setFeedback("Correct for this demo scenario: stop the response, raise the alarm and evacuate.");
      await finish(next);
      return;
    }
    setFeedback("Conditions have worsened. Continuing or moving closer is unsafe in this demo scenario. Choose evacuation.");
    await saveCheckpoint(next, practicalSteps.length);
  };

  if (!isFixture) {
    return <main className="shell"><p className="eyebrow">Worker training</p><h1>Package not found</h1><p>Unknown package {packageId} v{version}.</p><a href="/">Back</a></main>;
  }

  const lesson = lessons[lessonIndex];
  const question = questions[quizIndex];
  const current = practicalSteps[stepIndex];
  const serverResult = queueEntry?.serverResult as Partial<SyncV2Result> | undefined;
  const confirmed = queueEntry?.state === "CONFIRMED" && typeof serverResult?.passed === "boolean";
  const passed = confirmed ? Boolean(serverResult?.passed) : Boolean(evaluation?.passed);

  return (
    <main className="shell">
      <p className="eyebrow">Worker training / Fire flagship</p>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL}</div>
      <h1>{pkg.title}</h1>

      {phase === "brief" && <section className="panel performance">
        <div className="panel-heading"><h2>Your required training</h2><span>offline-capable</span></div>
        <p>5 short lessons → 5-question check → PASS practical → changing-condition scenario → verified result.</p>
        <p>WebXR: {arSupported === null ? "checking…" : arSupported ? "immersive AR supported" : "interactive 3D fallback available"}</p>
        <button className="primary-button" onClick={() => void download()}>Download and start</button>
        {feedback && <p className="form-error">{feedback}</p>}
      </section>}

      {phase === "downloading" && <p>Preparing training for offline use…</p>}

      {phase === "learn" && lesson && <section className="panel performance">
        <div className="panel-heading"><h2>Lesson {lessonIndex + 1}/5 · {lesson.title}</h2><span>Learn</span></div>
        <div className="demo-strip">{lesson.visualLabel}</div>
        <p>{lesson.concept}</p>
        <p className="empty">{lesson.interactionPrompt}</p>
        <p><strong>{lesson.checkPrompt}</strong></p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {lesson.checkOptions.map((option) => <button className="text-button" key={option} onClick={() => answerLesson(option)}>{option}</button>)}
        </div>
        {lessonFeedback && <p>{lessonFeedback}</p>}
        {lessonComplete && <button className="primary-button" onClick={() => void nextLesson()}>{lessonIndex === lessons.length - 1 ? "Start knowledge check" : "Next lesson"}</button>}
      </section>}

      {phase === "quiz" && question && <section className="panel performance">
        <div className="panel-heading"><h2>Knowledge check {quizIndex + 1}/5</h2><span>4/5 provisional threshold</span></div>
        <p><strong>{question.prompt}</strong></p>
        <div style={{ display: "grid", gap: 8 }}>
          {question.options.map((option) => <button className="text-button" key={option} onClick={() => void answerQuestion(option)}>{option}</button>)}
        </div>
        {quizFeedback && <p>{quizFeedback}</p>}
        {resumed && <p className="empty">Resumed your saved training progress.</p>}
      </section>}

      {phase === "ready" && <section className="panel performance">
        <div className="panel-heading"><h2>Practical ready</h2><span>progress saved</span></div>
        <p>Perform the ordered PASS-style interactions. The browser records only interactions it can actually measure.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="primary-button" onClick={() => startRun("preview")}>Start interactive preview</button>
          <button className="text-button" onClick={() => startRun("ar")}>Enter AR</button>
        </div>
      </section>}

      {phase === "running" && <section className="panel performance">
        <div className="panel-heading"><h2>{!placed ? "Place training scene" : `Practical ${stepIndex + 1}/${practicalSteps.length} · ${current?.id}`}</h2><span>{runMode === "ar" ? `AR · ${runtimeStatus}` : `preview · ${runtimeStatus}`}</span></div>
        {(runtimeStatus === "UNSUPPORTED_XR" || runtimeStatus === "XR_FAILED") && <p className="form-error">Immersive AR is unavailable here. Use the interactive 3D fallback; it is not reported as AR success.</p>}
        <div ref={sceneRef} style={{ minHeight: 320, border: "1px solid var(--line)" }} />
        {runMode === "ar" && !placed && runtimeStatus === "PLACING" && <button className="primary-button" onClick={lockPlacement}>Tap to place training scene</button>}
        {runMode === "ar" && !placed && runtimeStatus === "XR_ENTERING" && <p>Opening camera and looking for a surface…</p>}
        {placed && <p><strong>{current?.instruction}</strong></p>}
        {placed && <p className="empty">Current objective only. Progress is saved after every recorded action.</p>}
        {feedback && <p>{feedback}</p>}
      </section>}

      {phase === "scenario" && <section className="panel performance">
        <div className="panel-heading"><h2>Conditions changed</h2><span>Judgment</span></div>
        <div className="demo-strip">Smoke increases · exit visibility worsens</div>
        <p>You started the response, but the situation is now worsening. What do you do next?</p>
        <div style={{ display: "grid", gap: 8 }}>
          <button className="primary-button" onClick={() => void decide("evacuate")}>Raise alarm and evacuate</button>
          <button className="text-button" onClick={() => void decide("keep-fighting")}>Keep fighting</button>
          <button className="text-button" onClick={() => void decide("move-closer")}>Move closer</button>
        </div>
        {feedback && <p>{feedback}</p>}
      </section>}

      {phase === "result" && evaluation && competency && <section className="panel performance">
        <div className="panel-heading"><h2>{passed ? "Training complete" : "Needs retry"}</h2><span>{confirmed ? "server verified" : "provisional"}</span></div>
        <p><strong>{syncMessage(queueEntry)}</strong></p>
        <div className="metrics" aria-label="Competency result">
          <article className="metric"><span>Knowledge</span><strong>{competency.knowledge}%</strong></article>
          <article className="metric"><span>Practical</span><strong>{competency.practical}%</strong></article>
          <article className="metric"><span>Judgment</span><strong>{competency.judgment}%</strong></article>
          <article className="metric"><span>Critical safety mistakes</span><strong>{evaluation.criticalFailure ? "1+" : "0"}</strong></article>
        </div>
        <p className="empty">Local score {evaluation.score}. The server remains authoritative after sync; competency dimensions are derived from the same deterministic evaluator evidence.</p>
        <a href="/">Back to supervisor view</a>
      </section>}
    </main>
  );
}
