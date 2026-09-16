import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { TrainingDraft } from "../contracts.js";
import { DEMO_SAMPLE_LABEL, generateTrainingDraft } from "../api/generateTrainingDraft.js";
import {
  createRemoteDraft,
  getLiveSupabaseSession,
  publishRemoteDraft,
  requireTrainerIdentity,
  updateRemoteDraft,
} from "../api/liveSupabase.js";
import { canPublishStored, localDraftStore, type StoredDraft } from "../authoring/draftStore.js";
import { demoDraftFromFixture } from "../authoring/projectDraft.js";
import { stageMedia, uploadTrainingMedia, validateMediaFiles } from "../authoring/media.js";
import { FIRE_FIXTURE_LABEL } from "../templates/fire.fixture.js";

const FIRE_TEMPLATE = "fire-safety-induction";

async function extractVideoPosterFrame(file: File): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`${file.name}: video decode timed out`)), 12000);
      const fail = () => {
        window.clearTimeout(timer);
        reject(new Error(`${file.name}: video could not be decoded`));
      };
      video.addEventListener("error", fail, { once: true });
      video.addEventListener("loadedmetadata", () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const target = duration > 0.2 ? Math.min(0.5, duration / 2) : 0;
        if (target === 0 && video.readyState >= 2) {
          window.clearTimeout(timer);
          resolve();
          return;
        }
        video.currentTime = target;
        video.addEventListener("seeked", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      }, { once: true });
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error(`${file.name}: no decodable video frame`);
    const scale = Math.min(1, 1280 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`${file.name}: canvas unavailable`);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error(`${file.name}: frame encoding failed`)),
        "image/jpeg",
        0.86,
      );
    });
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "video";
    return new File([blob], `${stem}-ai-frame.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function deriveVideoFrames(files: File[]): Promise<File[]> {
  return Promise.all(files.filter((file) => file.type === "video/mp4").map(extractVideoPosterFrame));
}

function normalizeGeneratedDraft(
  value: unknown,
  shell: TrainingDraft,
  sourceMedia: TrainingDraft["sourceMedia"],
): TrainingDraft {
  if (!value || typeof value !== "object") throw new Error("AI returned an invalid draft");
  const draft = value as TrainingDraft;
  if (
    draft.draftId !== shell.draftId ||
    draft.templateId !== shell.templateId ||
    draft.templateVersion !== shell.templateVersion
  ) {
    throw new Error("AI draft identity does not match the requested draft");
  }
  return { ...draft, sourceMedia, reviewStatus: "AI_DRAFT" };
}

export function AuthorWizard() {
  const [workplaceName, setWorkplaceName] = useState("");
  const [locale, setLocale] = useState("en-IN");
  const [instructions, setInstructions] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFiles = () => {
    const selected = [...(fileRef.current?.files ?? [])];
    setFiles(selected);
    setErrors(validateMediaFiles(selected.map((file) => ({ name: file.name, type: file.type, size: file.size }))));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problems = [
      ...(!workplaceName.trim() ? ["Workplace name is required."] : []),
      ...validateMediaFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size }))),
    ];
    setErrors(problems);
    if (problems.length || busy) return;
    setBusy(true);
    try {
      const draftId = crypto.randomUUID();
      const liveSession = await getLiveSupabaseSession();
      if (!liveSession) {
        const shell = demoDraftFromFixture({
          draftId,
          workplaceName: workplaceName.trim(),
          trainerInstructions: instructions.trim(),
          mediaNames: files.map((file) => file.name),
          locale,
        });
        await localDraftStore.create({
          draftId,
          organizationId: "local",
          trainerId: "local-trainer",
          templateId: FIRE_TEMPLATE,
          templateVersion: 1,
          draft: shell,
        });
        window.location.href = `/app/trainings/${draftId}/review`;
        return;
      }

      const identity = await requireTrainerIdentity();
      const frames = await deriveVideoFrames(files);
      const uploaded = await uploadTrainingMedia(
        identity.client.storage as never,
        identity.organizationId,
        draftId,
        stageMedia([...files, ...frames]),
      );
      const sourceRefs = uploaded.slice(0, files.length);
      const aiRefs = uploaded.filter((ref) => ref.mimeType.startsWith("image/"));
      if (!aiRefs.length) throw new Error("No visual frame could be prepared for AI analysis");

      const shell: TrainingDraft = {
        ...demoDraftFromFixture({
          draftId,
          workplaceName: workplaceName.trim(),
          trainerInstructions: instructions.trim(),
          mediaNames: files.map((file) => file.name),
          locale,
        }),
        sourceMedia: sourceRefs,
      };
      let stored = await localDraftStore.create({
        draftId,
        organizationId: identity.organizationId,
        trainerId: identity.userId,
        templateId: FIRE_TEMPLATE,
        templateVersion: 1,
        draft: shell,
      });
      await createRemoteDraft(identity, stored);

      try {
        const pinned = { revision: stored.revision, contentHash: stored.contentHash };
        const response = await generateTrainingDraft(liveSession.supabaseUrl, liveSession.accessToken, {
          draftId,
          templateId: FIRE_TEMPLATE,
          templateVersion: 1,
          workplaceName: workplaceName.trim(),
          media: aiRefs,
          trainerInstructions: instructions.trim(),
          locale,
          expectedRevision: pinned.revision,
          expectedHash: pinned.contentHash,
        });
        const previous = stored;
        const generated = normalizeGeneratedDraft(response.draft, shell, sourceRefs);
        stored = await localDraftStore.applyGeneration(draftId, generated, pinned);
        try {
          await updateRemoteDraft(identity, stored, pinned);
        } catch (remoteError) {
          localDraftStore.restore(previous);
          throw remoteError;
        }
      } catch (aiError) {
        setErrors([
          `AI generation unavailable (${aiError instanceof Error ? aiError.message : "error"}). The labeled demo draft was preserved for trainer review.`,
        ]);
      }
      window.location.href = `/app/trainings/${draftId}/review`;
    } catch (reason) {
      setErrors([reason instanceof Error ? reason.message : "Draft creation failed"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <p className="eyebrow">Trainer / New training</p>
      <h1>Author training</h1>
      <div className="demo-strip">{DEMO_SAMPLE_LABEL}</div>
      <form className="panel performance" onSubmit={submit}>
        <div className="panel-heading"><h2>Workplace → Fire template → review</h2><span>trainer approval required</span></div>
        <label>Workplace name<input value={workplaceName} onChange={(event) => setWorkplaceName(event.target.value)} /></label>
        <label>Template<select value={FIRE_TEMPLATE} disabled><option value={FIRE_TEMPLATE}>Fire Safety Induction</option></select></label>
        <label>Locale<select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option></select></label>
        <label>Trainer instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} /></label>
        <label>Workplace photos or MP4 video<input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" onChange={pickFiles} /></label>
        {files.length > 0 && <p className="empty">{files.length} source file(s). MP4 files generate a private JPEG evidence frame for AI analysis.</p>}
        {errors.map((message) => <p className="form-error" key={message}>{message}</p>)}
        <button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Generate draft"}</button>
      </form>
    </main>
  );
}

export function DraftReview({ draftId }: { draftId: string }) {
  const [stored, setStored] = useState<StoredDraft | undefined>(() => localDraftStore.get(draftId));
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ slug: string; version: number } | null>(null);

  const commitMutation = async (mutate: () => Promise<StoredDraft>) => {
    if (!stored) return;
    const previous = structuredClone(stored);
    setError("");
    try {
      const next = await mutate();
      if (previous.organizationId !== "local") {
        try {
          await updateRemoteDraft(
            await requireTrainerIdentity(),
            next,
            { revision: previous.revision, contentHash: previous.contentHash },
          );
        } catch (remoteError) {
          localDraftStore.restore(previous);
          throw remoteError;
        }
      }
      setStored(next);
      setPublished(null);
    } catch (reason) {
      setStored(localDraftStore.get(draftId));
      setError(reason instanceof Error ? reason.message : "Draft update failed");
    }
  };

  if (!stored) {
    return <main className="shell"><h1>Draft not found</h1><p className="empty">Unknown draft {draftId} on this browser.</p><a href="/app/trainings">Back</a></main>;
  }

  const remote = stored.organizationId !== "local";
  const publishable = canPublishStored(stored);
  const editStep = (stepId: string, patch: { instruction?: string; voiceText?: string }) =>
    commitMutation(() => localDraftStore.edit(draftId, (draft) => ({
      ...draft,
      reviewStatus: "AI_DRAFT",
      trainingSteps: draft.trainingSteps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
    })));
  const approve = () => commitMutation(async () => {
    const approver = remote ? (await requireTrainerIdentity()).userId : "local-trainer";
    return localDraftStore.approve(draftId, approver);
  });
  const publish = async () => {
    if (!remote || !publishable || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const result = await publishRemoteDraft(await requireTrainerIdentity(), draftId);
      setPublished({ slug: result.slug, version: result.version });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <main className="shell">
      <p className="eyebrow">Trainer / Draft review</p>
      <h1>Review before publishing</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL} / r{stored.revision} · {stored.status}</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>Steps ({stored.draft.trainingSteps.length})</h2><span>{remote ? "Supabase-backed" : "local demo"}</span></div>
        {stored.draft.trainingSteps.map((step) => (
          <article key={step.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <p><strong>{step.id}</strong> · order {step.order}</p>
            <label>Instruction<input key={`${step.id}-${stored.revision}-instruction`} defaultValue={step.instruction} onBlur={(event) => { if (event.target.value !== step.instruction) void editStep(step.id, { instruction: event.target.value }); }} /></label>
            <label>Voice text<input key={`${step.id}-${stored.revision}-voice`} defaultValue={step.voiceText} onBlur={(event) => { if (event.target.value !== step.voiceText) void editStep(step.id, { voiceText: event.target.value }); }} /></label>
          </article>
        ))}
        {error && <p className="form-error">{error}</p>}
        {!publishable && <p className="form-error">Any content edit invalidates approval. Approve this exact revision before publishing.</p>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button className="primary-button" onClick={() => void approve()}>{stored.status === "REVIEWED" ? "Approved" : "Approve exact revision"}</button>
          <a href={`/app/trainings/${draftId}/1/preview`}>Preview projection</a>
          {remote && <button className="primary-button" disabled={!publishable || publishing} onClick={() => void publish()}>{publishing ? "Publishing…" : "Publish immutable version"}</button>}
        </div>
        {published && <p><strong>Published:</strong> <a href={`/learn/${published.slug}/${published.version}`}>open worker training v{published.version}</a></p>}
        {!remote && <p className="empty">Local demo drafts cannot be published. Sign in to Supabase for persistent authoring.</p>}
      </section>
    </main>
  );
}
