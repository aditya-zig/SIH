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

const TEMPLATES = [
  { id: "fire-safety-induction", name: "Fire Safety Induction", enabled: true },
  { id: "gas-leak-response", name: "Gas Leak Response", enabled: false },
  { id: "emergency-evacuation", name: "Emergency Evacuation", enabled: false },
  { id: "ppe-inspection", name: "PPE Inspection", enabled: false },
  { id: "electrical-hazard-awareness", name: "Electrical Hazard Awareness", enabled: false },
  { id: "machine-safety", name: "Machine Safety", enabled: false },
  { id: "new-worker-site-induction", name: "New Worker Site Induction", enabled: false },
];

function videoFrameName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${stem || "video"}-ai-frame.jpg`;
}

async function extractVideoPosterFrame(file: File): Promise<File> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error(`${file.name}: video frame extraction is unavailable in this browser`);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`${file.name}: video could not be decoded`)), 12000);
      const fail = () => {
        window.clearTimeout(timeout);
        reject(new Error(`${file.name}: video could not be decoded`));
      };
      video.addEventListener("error", fail, { once: true });
      video.addEventListener(
        "loadedmetadata",
        () => {
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          video.currentTime = duration > 0.2 ? Math.min(0.5, duration / 2) : 0;
          if (video.currentTime === 0 && video.readyState >= 2) {
            window.clearTimeout(timeout);
            resolve();
            return;
          }
          video.addEventListener(
            "seeked",
            () => {
              window.clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        },
        { once: true },
      );
    });

    if (!video.videoWidth || !video.videoHeight) throw new Error(`${file.name}: video has no decodable frame`);
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`${file.name}: canvas unavailable for video frame extraction`);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error(`${file.name}: frame encoding failed`))), "image/jpeg", 0.86),
    );
    return new File([blob], videoFrameName(file.name), { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function deriveVideoFrames(files: File[]): Promise<File[]> {
  const videos = files.filter((file) => file.type === "video/mp4");
  return Promise.all(videos.map(extractVideoPosterFrame));
}

function normalizeGeneratedDraft(
  value: unknown,
  shell: TrainingDraft,
  sourceMedia: TrainingDraft["sourceMedia"],
): TrainingDraft {
  if (!value || typeof value !== "object") throw new Error("AI returned an invalid draft");
  const draft = value as TrainingDraft;
  if (draft.draftId !== shell.draftId || draft.templateId !== shell.templateId || draft.templateVersion !== shell.templateVersion) {
    throw new Error("AI draft identity does not match the requested draft");
  }
  return {
    ...draft,
    sourceMedia,
    reviewStatus: "AI_DRAFT",
  };
}

export function AuthorWizard() {
  const [workplaceName, setWorkplaceName] = useState("");
  const [templateId, setTemplateId] = useState("fire-safety-induction");
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
    if (problems.length > 0 || busy) return;
    setBusy(true);

    try {
      const draftId = crypto.randomUUID();
      const liveSession = await getLiveSupabaseSession();

      // Offline/demo mode remains useful for the SIH demonstration, but it is
      // explicitly labeled and never masquerades as workplace analysis.
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
          templateId,
          templateVersion: 1,
          draft: shell,
        });
        window.location.href = `/app/trainings/${draftId}/review`;
        return;
      }

      const identity = await requireTrainerIdentity();
      const extractedFrames = await deriveVideoFrames(files);
      const uploadFiles = [...files, ...extractedFrames];
      const uploaded = await uploadTrainingMedia(
        identity.client.storage as never,
        identity.organizationId,
        draftId,
        stageMedia(uploadFiles),
      );
      const sourceRefs = uploaded.slice(0, files.length);
      const aiRefs = uploaded.filter((ref) => ref.mimeType.startsWith("image/"));
      if (aiRefs.length === 0) throw new Error("No image evidence could be prepared for AI analysis");

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
        templateId,
        templateVersion: 1,
        draft: shell,
      });
      await createRemoteDraft(identity, stored);

      try {
        const pinned = { revision: stored.revision, contentHash: stored.contentHash };
        const generated = await generateTrainingDraft(liveSession.client.supabaseUrl, liveSession.client.supabaseKey, {
          draftId,
          templateId,
          templateVersion: 1,
          workplaceName: workplaceName.trim(),
          media: aiRefs,
          trainerInstructions: instructions.trim(),
          locale,
          expectedRevision: pinned.revision,
          expectedHash: pinned.contentHash,
        });
        const nextDraft = normalizeGeneratedDraft(generated.draft, shell, sourceRefs);
        const previous = stored;
        stored = await localDraftStore.applyGeneration(draftId, nextDraft, pinned);
        try {
          await updateRemoteDraft(identity, stored, pinned);
        } catch (error) {
          localDraftStore.restore(previous);
          throw error;
        }
      } catch (error) {
        // The shell is already persisted remotely and stays visibly DEMO SAMPLE.
        setErrors([`AI generation unavailable (${error instanceof Error ? error.message : "error"}). The trainer-reviewable demo draft was preserved.`]);
      }

      window.location.href = `/app/trainings/${draftId}/review`;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Draft creation failed"]);
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
        <div className="panel-heading"><h2>1. Upload 2. Template 3. Instructions</h2><span>review required</span></div>
        <label>Workplace name
          <input value={workplaceName} onChange={(event) => setWorkplaceName(event.target.value)} placeholder="Mine A, Workshop 3…" />
        </label>
        <label>Template
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            {TEMPLATES.map((template) => (
              <option key={template.id} value={template.id} disabled={!template.enabled}>
                {template.name}{template.enabled ? "" : " (after Fire E2E)"}
              </option>
            ))}
          </select>
        </label>
        <label>Locale
          <select value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">Hindi</option>
          </select>
        </label>
        <label>Trainer instructions (optional)
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} placeholder="New-worker induction, focus on exits…" />
        </label>
        <label>Workplace photos or MP4 video (max 10 source files, 50 MB each)
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" onChange={pickFiles} />
        </label>
        {files.length > 0 && <p className="empty">{files.length} source file(s) staged. MP4 uploads generate a private JPEG evidence frame for AI analysis.</p>}
        {errors.map((error) => <p className="form-error" key={error}>{error}</p>)}
        <button className="primary-button" disabled={busy}>{busy ? "Creating draft…" : "Generate draft"}</button>
      </form>
    </main>
  );
}

export function DraftReview({ draftId }: { draftId: string }) {
  const [stored, setStored] = useState<StoredDraft | undefined>(() => localDraftStore.get(draftId));
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ slug: string; version: number } | null>(null);

  const refresh = () => setStored(localDraftStore.get(draftId));

  const commitMutation = async (mutate: (draft: StoredDraft) => Promise<StoredDraft>) => {
    if (!stored) return;
    setError("");
    const previous = structuredClone(stored);
    try {
      const next = await mutate(stored);
      if (previous.organizationId !== "local") {
        const identity = await requireTrainerIdentity();
        try {
          await updateRemoteDraft(identity, next, { revision: previous.revision, contentHash: previous.contentHash });
        } catch (remoteError) {
          localDraftStore.restore(previous);
          throw remoteError;
        }
      }
      setStored(next);
      setPublished(null);
    } catch (reason) {
      refresh();
      setError(reason instanceof Error ? reason.message : "Draft update failed");
    }
  };

  const editStep = (stepId: string, patch: { instruction?: string; voiceText?: string }) =>
    commitMutation(() => localDraftStore.edit(draftId, (draft) => ({
      ...draft,
      trainingSteps: draft.trainingSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      reviewStatus: "AI_DRAFT",
    })));

  const moveStep = (stepId: string, direction: -1 | 1) =>
    commitMutation(() => localDraftStore.edit(draftId, (draft) => {
      const order = [...draft.trainingSteps].sort((a, b) => a.order - b.order);
      const index = order.findIndex((step) => step.id === stepId);
      const swap = index + direction;
      if (index < 0 || swap < 0 || swap >= order.length) return draft;
      const moved = [...order];
      const [taken] = moved.splice(index, 1);
      if (taken) moved.splice(swap, 0, taken);
      return { ...draft, trainingSteps: moved.map((step, i) => ({ ...step, order: i + 1 })), reviewStatus: "AI_DRAFT" };
    }));

  const deleteStep = (stepId: string) =>
    commitMutation(() => localDraftStore.edit(draftId, (draft) => ({
      ...draft,
      trainingSteps: draft.trainingSteps.filter((step) => step.id !== stepId),
      reviewStatus: "AI_DRAFT",
    })));

  const approve = () =>
    commitMutation(async (current) => {
      const approver = current.organizationId === "local" ? "local-trainer" : (await requireTrainerIdentity()).userId;
      const next = await localDraftStore.approve(draftId, approver);
      next.draft.reviewStatus = "REVIEWED";
      return next;
    });

  const publish = async () => {
    if (!stored || stored.organizationId === "local" || !canPublishStored(stored) || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const identity = await requireTrainerIdentity();
      const result = await publishRemoteDraft(identity, draftId);
      setPublished({ slug: result.slug, version: result.version });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  if (!stored) {
    return <main className="shell"><h1>Draft not found</h1><p className="empty">Unknown draft {draftId} on this browser.</p><a href="/app/trainings">Back</a></main>;
  }

  const publishable = canPublishStored(stored);
  const remote = stored.organizationId !== "local";
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / Draft review</p>
      <h1>AI draft — trainer review required</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL} / draft {draftId} / r{stored.revision} · {stored.status}</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>Steps ({stored.draft.trainingSteps.length})</h2><span>{remote ? "Supabase-backed" : "local demo"} · hash {stored.contentHash.slice(0, 12)}…</span></div>
        {stored.draft.trainingSteps.map((step) => (
          <article key={step.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <p><strong>{step.id}</strong> (order {step.order})</p>
            <label>Instruction
              <input defaultValue={step.instruction} key={`${step.id}-${stored.revision}-i`} onBlur={(event) => {
                if (event.target.value !== step.instruction) void editStep(step.id, { instruction: event.target.value });
              }} />
            </label>
            <label>Voice text
              <input defaultValue={step.voiceText} key={`${step.id}-${stored.revision}-v`} onBlur={(event) => {
                if (event.target.value !== step.voiceText) void editStep(step.id, { voiceText: event.target.value });
              }} />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="text-button" onClick={() => void moveStep(step.id, -1)}>Move up</button>
              <button className="text-button" onClick={() => void moveStep(step.id, 1)}>Move down</button>
              <button className="text-button" onClick={() => void deleteStep(step.id)}>Delete</button>
            </div>
          </article>
        ))}
        {error && <p className="form-error">{error}</p>}
        {!publishable && <p className="form-error">Not approved: every content edit clears approval. Approve the exact current revision before publishing.</p>}
        <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary-button" onClick={() => void approve()}>{stored.status === "REVIEWED" ? "Approved" : "Approve exact revision"}</button>
          <a href={`/app/trainings/${draftId}/1/preview`}>Preview projection</a>
          {remote && <button className="primary-button" disabled={!publishable || publishing} onClick={() => void publish()}>{publishing ? "Publishing…" : "Publish immutable version"}</button>}
        </div>
        {published && <p><strong>Published:</strong> <a href={`/learn/${published.slug}/${published.version}`}>open worker training v{published.version}</a></p>}
        {!remote && <p className="empty">Local demo drafts cannot be published. Sign in to the configured Supabase project to create a persistent draft.</p>}
      </section>
    </main>
  );
}
