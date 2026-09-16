import FlagshipWorkerJourney, { resolveWorkerId } from "./FlagshipWorkerJourney.js";
import { FIRE_FIXTURE_LABEL, fireFixturePackage, fireFixtureScenario } from "../templates/fire.fixture.js";

export { resolveWorkerId };

export default function WorkerLearn({ packageId, version }: { packageId: string; version: number }) {
  const isFixture = packageId === fireFixturePackage.packageId && version === fireFixturePackage.version;
  if (!isFixture) {
    return (
      <main className="shell">
        <p className="eyebrow">Worker training</p>
        <h1>Package not found</h1>
        <p>Unknown package {packageId} v{version}.</p>
        <a href="/">Back</a>
      </main>
    );
  }
  return (
    <FlagshipWorkerJourney
      moduleId={packageId}
      version={version}
      pkg={fireFixturePackage}
      scenario={fireFixtureScenario as never}
      offlineRecord={fireFixturePackage}
      warningLabel={FIRE_FIXTURE_LABEL}
      sourceLabel="Fire flagship"
    />
  );
}
