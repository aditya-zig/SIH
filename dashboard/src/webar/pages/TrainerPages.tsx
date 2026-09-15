import { useEffect, useRef, useState } from "react";
import { FIRE_FIXTURE_LABEL, fireFixturePackage } from "../templates/fire.fixture.js";
import { DEMO_SAMPLE_LABEL, generateTrainingDraft } from "../api/generateTrainingDraft.js";
import { compileEntities, mountTrainingScene } from "../runtime/SceneRuntime.js";
import { canPublishStored, localDraftStore, type StoredDraft } from "../authoring/draftStore.js";
import { demoDraftFromFixture, projectDraftToPackage } from "../authoring/projectDraft.js";
import { stageMedia, validateMediaFiles } from "../authoring/media.js";
import { getSyncContext } from "../../data.js";

export function TrainerList() {
  const [drafts, setDrafts] = useState<StoredDraft[]>(() => localDraftStore.list());
  useEffect(() => {
    setDrafts(localDraftStore.list());
  }, []);
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / Trainings</p>
      <h1>Trainings</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL}</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>Fire Safety Induction (Demo Fixture)</h2><span>v1</span></div>
        <p>4 steps. Package {fireFixturePackage.packageId}.</p>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/app/trainings/new">New training</a>
          <a href={`/app/trainings/${fireFixturePackage.packageId}/1/preview`}>3D preview</a>
          <a href={`/learn/${fireFixturePackage.packageId}/1`}>Worker view</a>
        </div>
      </section>
      {drafts.map((d) => (
        <section className="panel performance" key={d.draftId}>
          <div className="panel-heading">
            <h2>{d.templateId} — {d.draft.workplaceType}</h2>
            <span>r{d.revision} · {d.status}</span>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <a href={`/app/trainings/${d.draftId}/review`}>Open review</a>
            <a href={`/app/trainings/${d.draftId}/1/preview`}>Preview projection</a>
          </div>
        </section>
      ))}
    </main>
  );
}

const TEMPLATES = [
  { id: "fire-safety-induction", name: "Fire Safety Induction", enabled: true },
  { id: "gas-leak-response", name: "Gas Leak Response", enabled: false },
  { id: "emergency-evacuation", name: "Emergency Evacuation", enabled: false },
  { id: "ppe-inspection", name: "PPE Inspection", enabled: false },
  { id: "electrical-hazard-awareness", name: "Electrical Hazard Awareness", enabled: false },
  { id: "machine-safety", name: "Machine Safety", enabled: false },
  { id: "new-worker-site-induction", name: "New Worker Site Induction", enabled: false },
];

export function AuthorWizard() {
  const [workplaceName, setWorkplaceName] = useState("");
  const [templateId, setTemplateId] = useState("fire-safety-induction");
  const [locale, setLocale] = useState("en-IN");
  const [instructions, setInstructions] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFiles = () => {
    const list = fileRef.current?.files;
    if (!list) return;
    const staged = stageMedia(list);
    setFiles([...list]);
    setFileNames(staged.map((s) => s.name));
    setErrors(validateMediaFiles([...list].map((f) => ({ name: f.name, type: f.type, size: f.size }))));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problems = [
      ...(!workplaceName.trim() ? ["Workplace name is required."] : []),
      ...validateMediaFiles(files.map((f) => ({ name: f.name, type: f.type, size: f.size }))),
    ];
    setErrors(problems);
    if (problems.length > 0 || busy) return;
    setBusy(true);
    try {
      const draftId = crypto.randomUUID();
      const shell = demoDraftFromFixture({
        draftId,
        workplaceName: workplaceName.trim(),
        trainerInstructions: instructions.trim(),
        mediaNames: fileNames,
        locale,
      });
      let stored = await localDraftStore.create({
        draftId,
        organizationId: "local",
        trainerId: "local-trainer",
        templateId,
        templateVersion: 1,
        draft: shell,
      });
      // Live backend with a session: request a real model draft. Without one,
      // the shell above stays as the visibly labeled demo sample.
      const context = await getSyncContext().catch(() => null);
      if (context) {
        try {
          const res = await generateTrainingDraft(context.supabaseUrl.replace(/\/$/, ""), context.accessToken, {
            draftId,
            templateId,
            templateVersion: 1,
            workplaceName: workplaceName.trim(),
            media: fileNames.map((name) => ({ storagePath: `local/${name}`, mimeType: "image/jpeg" })),
            trainerInstructions: instructions.trim(),
            locale,
          });
          stored = await localDraftStore.applyGeneration(draftId, res.draft as StoredDraft["draft"], {
            revision: stored.revision,
            contentHash: stored.contentHash,
          });
          void stored;
        } catch (e) {
          setErrors([`Live generation unavailable (${e instanceof Error ? e.message : "error"}). Continuing with the labeled demo sample.`]);
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      window.location.href = `/app/trainings/${draftId}/review`;
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
        <div className="panel-heading"><h2>1. Upload 2. Template 3. Instructions</h2><span>draft r1</span></div>
        <label>Workplace name
          <input value={workplaceName} onChange={(e) => setWorkplaceName(e.target.value)} placeholder="Mine A, Workshop 3…" />
        </label>
        <label>Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id} disabled={!t.enabled}>
                {t.name}{t.enabled ? "" : " (after Fire E2E)"}
              </option>
            ))}
          </select>
        </label>
        <label>Locale
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">Hindi</option>
          </select>
        </label>
        <label>Trainer instructions (optional)
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="New-worker induction, focus on exits…" />
        </label>
        <label>Workplace photos or short video (max 10 files, 50 MB each)
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" onChange={pickFiles} />
        </label>
        {fileNames.length > 0 && <p className="empty">{fileNames.length} file(s) staged: {fileNames.join(", ")}</p>}
        {errors.map((e) => (
          <p className="form-error" key={e}>{e}</p>
        ))}
        <button className="primary-button" disabled={busy}>{busy ? "Creating draft…" : "Generate draft"}</button>
      </form>
    </main>
  );
}

export function DraftReview({ draftId }: { draftId: string }) {
  const [stored, setStored] = useState<StoredDraft | undefined>(() => localDraftStore.get(draftId));
  const [error, setError] = useState<string>("");

  const refresh = () => setStored(localDraftStore.get(draftId));

  const editStep = async (stepId: string, patch: { instruction?: string; voiceText?: string }) => {
    setError("");
    try {
      await localDraftStore.edit(draftId, (draft) => ({
        ...draft,
        trainingSteps: draft.trainingSteps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
      }));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    }
  };

  const moveStep = async (stepId: string, direction: -1 | 1) => {
    try {
      await localDraftStore.edit(draftId, (draft) => {
        const order = [...draft.trainingSteps].sort((a, b) => a.order - b.order);
        const idx = order.findIndex((s) => s.id === stepId);
        const swap = idx + direction;
        if (idx < 0 || swap < 0 || swap >= order.length) return draft;
        const moved = [...order];
        const [taken] = moved.splice(idx, 1);
        moved.splice(swap, 0, taken!);
        return { ...draft, trainingSteps: moved.map((s, i) => ({ ...s, order: i + 1 })) };
      });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    }
  };

  const deleteStep = async (stepId: string) => {
    try {
      await localDraftStore.edit(draftId, (draft) => ({
        ...draft,
        trainingSteps: draft.trainingSteps.filter((s) => s.id !== stepId),
      }));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const approve = async () => {
    setError("");
    try {
      await localDraftStore.approve(draftId, "local-trainer");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    }
  };

  if (!stored) {
    return (
      <main className="shell"><h1>Draft not found</h1><p className="empty">Unknown draft {draftId}.</p><a href="/app/trainings">Back</a></main>
    );
  }

  const publishable = canPublishStored(stored);
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / Draft review</p>
      <h1>AI draft — trainer review required</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL} / draft {draftId} / r{stored.revision} · {stored.status}</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>Steps ({stored.draft.trainingSteps.length})</h2><span>hash {stored.contentHash.slice(0, 12)}…</span></div>
        {stored.draft.trainingSteps.map((s) => (
          <article key={s.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <p><strong>{s.id}</strong> (order {s.order})</p>
            <label>Instruction
              <input
                defaultValue={s.instruction}
                key={`${s.id}-${stored.revision}-i`}
                onBlur={(e) => {
                  if (e.target.value !== s.instruction) void editStep(s.id, { instruction: e.target.value });
                }}
              />
            </label>
            <label>Voice text
              <input
                defaultValue={s.voiceText}
                key={`${s.id}-${stored.revision}-v`}
                onBlur={(e) => {
                  if (e.target.value !== s.voiceText) void editStep(s.id, { voiceText: e.target.value });
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="text-button" onClick={() => void moveStep(s.id, -1)}>Move up</button>
              <button className="text-button" onClick={() => void moveStep(s.id, 1)}>Move down</button>
              <button className="text-button" onClick={() => void deleteStep(s.id)}>Delete</button>
            </div>
          </article>
        ))}
        {error && <p className="form-error">{error}</p>}
        {!publishable && (
          <p className="form-error">Not approved: any edit clears approval — re-approve the exact current revision to publish.</p>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
          <button className="primary-button" onClick={() => void approve()}>
            {stored.status === "REVIEWED" ? "Approved" : "Approve exact revision"}
          </button>
          <a href={`/app/trainings/${draftId}/1/preview`}>Preview projection</a>
        </div>
        <p className="empty">Publishing creates an immutable version once the database migration is applied (E06).</p>
      </section>
    </main>
  );
}

export function PackagePreview({ packageId, version }: { packageId: string; version: number }) {
  const pkg = fireFixturePackage;
  const sceneRef = useRef<HTMLDivElement>(null);
  // Same deterministic projection workers use: a stored draft renders as its
  // projected package; the legacy fixture id renders the fixture package.
  let active = pkg;
  let projectionError = "";
  const stored = localDraftStore.get(packageId);
  if (stored) {
    try {
      active = projectDraftToPackage(stored, {
        workplaceId: stored.draft.workplaceType || "workplace-fixture-001",
        title: `${stored.templateId} — ${stored.draft.workplaceType || "draft"} (r${stored.revision})`,
      });
    } catch (e) {
      projectionError = e instanceof Error ? e.message : "Projection failed";
    }
  } else if (packageId !== pkg.packageId || version !== pkg.version) {
    return (
      <main className="shell"><h1>Package not found</h1><a href="/app/trainings">Back</a></main>
    );
  }
  const entities = compileEntities(active);
  useEffect(() => {
    if (sceneRef.current && !projectionError) {
      try {
        mountTrainingScene(sceneRef.current, active);
      } catch {
        // Entity list below still proves the deterministic mapping.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId, version]);
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / 3D preview</p>
      <h1>{active.title}</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL} — same entities as AR runtime</div>
      {projectionError && <p className="form-error">{projectionError}</p>}
      <section className="panel performance">
        <div className="panel-heading"><h2>Entities ({entities.length})</h2><span>deterministic</span></div>
        <div ref={sceneRef} style={{ minHeight: 200, border: "1px solid var(--line)", marginBottom: 12 }} />
        {entities.map((e) => (
          <p key={e.objectId}><strong>{e.objectId}</strong> {e.attrs["data-kind"]} [{e.attrs["position"]}]</p>
        ))}
        <a href={`/learn/${active.packageId}/${active.version}`}>Open worker view</a>
      </section>
    </main>
  );
}
