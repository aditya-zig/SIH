import { useEffect, useRef, useState } from "react";
import { FIRE_FIXTURE_LABEL, fireFixturePackage } from "../templates/fire.fixture.js";
import { DEMO_SAMPLE_LABEL } from "../api/generateTrainingDraft.js";
import { compileEntities, mountTrainingScene } from "../runtime/SceneRuntime.js";

export function TrainerList() {
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
    </main>
  );
}

export function AuthorWizard() {
  const [template] = useState("fire-safety-induction");
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / New training</p>
      <h1>Author training</h1>
      <div className="demo-strip">{DEMO_SAMPLE_LABEL}</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>1. Upload 2. Template 3. AI draft</h2><span>{template}</span></div>
        <p>Upload workplace photo/video, choose the Fire template, add optional instructions. Server-side OpenRouter draft generation is wired at /functions/v1/generate-training-draft; without an authorized server secret the wizard shows this labeled demo sample instead of claiming live analysis.</p>
        <a href="/app/trainings/draft-fixture/review">Open draft review (fixture)</a>
      </section>
    </main>
  );
}

export function DraftReview({ draftId }: { draftId: string }) {
  const [edited, setEdited] = useState(false);
  const [approved, setApproved] = useState(false);
  const pkg = fireFixturePackage;
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / Draft review</p>
      <h1>AI draft — trainer review required</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL} / draft {draftId}</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>Steps</h2><span>{pkg.trainingSteps.length} steps</span></div>
        {pkg.trainingSteps.map((s) => (
          <p key={s.id}><strong>{s.id}</strong> — {s.instruction}</p>
        ))}
        <button className="text-button" onClick={() => { setEdited(true); setApproved(false); }}>Simulate trainer edit (invalidates approval)</button>
        <div style={{ marginTop: 12 }}>
          <button className="primary-button" disabled={edited && !approved} onClick={() => setApproved(true)}>
            {approved ? "Approved" : "Approve draft"}
          </button>
          {edited && !approved && <p className="form-error">Approval invalidated by edit — re-approval required before publish.</p>}
          {approved && <p>Approved. Publishing creates an immutable version (see T06 publish_training_draft).</p>}
        </div>
      </section>
    </main>
  );
}

export function PackagePreview({ packageId, version }: { packageId: string; version: number }) {
  const pkg = fireFixturePackage;
  const sceneRef = useRef<HTMLDivElement>(null);
  const entities = compileEntities(pkg);
  useEffect(() => {
    if (sceneRef.current) {
      try {
        mountTrainingScene(sceneRef.current, pkg);
      } catch {
        // Preview text list below still proves deterministic entity mapping.
      }
    }
  }, [pkg]);
  if (packageId !== pkg.packageId || version !== pkg.version) {
    return (
      <main className="shell"><h1>Package not found</h1><a href="/app/trainings">Back</a></main>
    );
  }
  return (
    <main className="shell">
      <p className="eyebrow">Trainer / 3D preview</p>
      <h1>{pkg.title}</h1>
      <div className="demo-strip">{FIRE_FIXTURE_LABEL} — same entities as AR runtime</div>
      <section className="panel performance">
        <div className="panel-heading"><h2>Entities ({entities.length})</h2><span>deterministic</span></div>
        <div ref={sceneRef} style={{ minHeight: 200, border: "1px solid var(--line)", marginBottom: 12 }} />
        {entities.map((e) => (
          <p key={e.objectId}><strong>{e.objectId}</strong> {e.attrs["gltf-model"]} [{e.attrs["position"]}]</p>
        ))}
        <a href={`/learn/${pkg.packageId}/${pkg.version}`}>Open worker view</a>
      </section>
    </main>
  );
}
