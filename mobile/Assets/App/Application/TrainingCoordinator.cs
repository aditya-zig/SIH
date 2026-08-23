using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using SurakshaAR.Content;
using SurakshaAR.Domain.Persistence;
using SurakshaAR.Domain.Training;
using SurakshaAR.Infrastructure.Catalog;
using SurakshaAR.Infrastructure.Persistence;
using SurakshaAR.Infrastructure.Sync;
using SurakshaAR.Scene;
using UnityEngine;

namespace SurakshaAR.Application
{
    public sealed class TrainingCoordinator : MonoBehaviour
    {
        [SerializeField]
        private OfflineContentInstaller contentInstaller = null!;

        [SerializeField]
        private TrainingSceneController trainingScene = null!;

        [SerializeField]
        private string moduleId = "fire_001";

        [SerializeField]
        private string workerId = string.Empty;

        private IAttemptStore? attemptStore;
        private IAttemptRemote? attemptRemote;
        private bool attemptSaved;
        private bool contentReady;
        private bool attemptStarted;
        private bool synchronizing;
        private float nextSyncAt;

        public event Action<AttemptResult>? AttemptSaved;

        public event Action<SyncReport>? Synchronized;

        private void Update()
        {
            if (Time.unscaledTime < nextSyncAt)
            {
                return;
            }

            nextSyncAt = Time.unscaledTime + 30f;
            TrySynchronize();
        }

        private async void Start()
        {
            trainingScene.Updated += HandleTrainingUpdate;
            try
            {
                await contentInstaller.Install();
                contentReady = true;
                await TryBeginAttempt();
            }
            catch (Exception error)
            {
                Debug.LogException(error, this);
            }
        }

        public void ConfigureRemote(IAttemptRemote remote)
        {
            attemptRemote = remote ?? throw new ArgumentNullException(nameof(remote));
            TrySynchronize();
        }

        public void ProvisionWorker(string provisionedWorkerId)
        {
            if (string.IsNullOrWhiteSpace(provisionedWorkerId))
            {
                throw new ArgumentException("A provisioned worker id is required.", nameof(provisionedWorkerId));
            }

            workerId = provisionedWorkerId;
            _ = TryBeginAttempt();
        }

        public async Task<SyncReport> Sync(CancellationToken cancellationToken)
        {
            if (attemptStore == null || attemptRemote == null)
            {
                throw new InvalidOperationException("Local storage and the authenticated remote must be configured first.");
            }

            var report = await new AttemptSync(attemptStore, attemptRemote, 20).SyncPending(cancellationToken);
            Synchronized?.Invoke(report);
            return report;
        }

        private async Task TryBeginAttempt()
        {
            if (!contentReady || attemptStarted || string.IsNullOrWhiteSpace(workerId))
            {
                return;
            }

            attemptStarted = true;
            var installRoot = contentInstaller.InstallRoot;
            var catalog = new JsonTrainingCatalog(Path.Combine(installRoot, "Scenarios"));
            attemptStore = new JsonAttemptStore(Path.Combine(Application.persistentDataPath, "attempts.json"));
            var scenario = await catalog.Get(moduleId);
            var context = new AttemptContext(
                Guid.NewGuid(),
                workerId,
                SystemInfo.deviceUniqueIdentifier,
                DateTimeOffset.UtcNow);
            trainingScene.StartAttempt(scenario, context);
        }

        private async void HandleTrainingUpdate(TrainingUpdate update)
        {
            if (!update.State.Completed || attemptSaved || attemptStore == null)
            {
                return;
            }

            attemptSaved = true;
            try
            {
                var result = trainingScene.FinishAttempt();
                await attemptStore.Save(result);
                AttemptSaved?.Invoke(result);
                TrySynchronize();
            }
            catch (Exception error)
            {
                attemptSaved = false;
                Debug.LogException(error, this);
            }
        }

        private async void TrySynchronize()
        {
            if (synchronizing
                || attemptStore == null
                || attemptRemote == null
                || Application.internetReachability == NetworkReachability.NotReachable)
            {
                return;
            }

            synchronizing = true;
            try
            {
                await Sync(CancellationToken.None);
            }
            catch (Exception error)
            {
                Debug.LogWarning("Pending attempts remain local: " + error.Message);
            }
            finally
            {
                synchronizing = false;
            }
        }
    }
}
