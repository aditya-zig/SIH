import WorkerLearn from "./WorkerLearn.js";
import PublishedWorkerLearn from "./PublishedWorkerLearn.js";

export default function WorkerEntry({ packageId, version }: { packageId: string; version: number }) {
  if (packageId === "fire-fixture-001") return <WorkerLearn packageId={packageId} version={version} />;
  return <PublishedWorkerLearn moduleSlug={packageId} version={version} />;
}
