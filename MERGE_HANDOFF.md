# Branch reconciliation handoff

This document records the branch state on 2026-08-25. Do not merge these branches without reconciling the two Unity application designs.

## Branches

### `main`

`main` at `5a8fe61` has the lean training implementation. The C# source includes the action-based training runtime, offline attempt storage, synchronization, and real Supabase HTTP adapters.

- Backend bootstrap is `mobile/Assets/App/Application/BackendBootstrap.cs`.
- Training coordination is `mobile/Assets/App/Application/TrainingCoordinator.cs`.
- The runtime is `mobile/Assets/App/Domain/Training/TrainingRuntime.cs`.
- The Unity controller is `mobile/Assets/App/Scene/TrainingSceneController.cs`.
- Local persistence is `mobile/Assets/App/Infrastructure/Persistence/JsonAttemptStore.cs`.
- Synchronization is `mobile/Assets/App/Infrastructure/Sync/AttemptSync.cs`.
- Supabase authentication is `mobile/Assets/App/Remote/SupabaseSessionTokenProvider.cs`.
- The Unity sync client is `mobile/Assets/App/Remote/UnityAttemptRemote.cs`.
- Scenario files are `mobile/Assets/StreamingAssets/Scenarios/fire_001.v1.json` and `mobile/Assets/StreamingAssets/Scenarios/gas_001.v1.json`.
- The backend Edge Functions are `backend/functions/sync-attempt/index.ts` and `backend/functions/verify-certificate/index.ts`.
- Server-side evaluation is `backend/functions/_shared/evaluate-attempt.ts`.
- Supabase migrations are under `backend/supabase/migrations/`.

The .NET domain and infrastructure tests, backend tests, and dashboard tests pass on this branch's source. Unity and Android build behavior remain unverified in this environment.

### `feat/full-app-phases-1-5`

`feat/full-app-phases-1-5` at `840a3e3` has the larger Unity application shell. It adds committed scenes, menu and dashboard code, semantic interactions, worker provisioning, certificate authorization migrations, and more build scripts.

- Committed Unity scenes are `mobile/Assets/Scenes/Launcher.unity`, `MainMenu.unity`, `Dashboard.unity`, `FireTraining.unity`, `GasTraining.unity`, `Settings.unity`, `LoginMenu.unity`, and `Placeholder.unity`.
- Full-app scene generation is `mobile/Assets/Editor/CreateCoreScenes.cs`.
- Full-app build scripts are `mobile/Assets/Editor/BuildFullApp.cs`, `BuildPlaceholder.cs`, and `SetBuildScenes.cs`.
- Application-shell code is `mobile/Assets/App/Application/BackendService.cs`, `NavigationController.cs`, and `TrainingUIBridge.cs`.
- Scenario abstraction is `mobile/Assets/App/Scene/IScenarioModule.cs`.
- Provisioned worker persistence is `mobile/Assets/App/Infrastructure/Persistence/JsonProvisionedWorkerStore.cs`.
- Additional tests are `mobile/SurakshaAR.Domain.Tests/MobileTrainingSessionTests.cs` and `mobile/SurakshaAR.Infrastructure.Tests/JsonProvisionedWorkerStoreTests.cs`.
- Additional Supabase migrations are `backend/supabase/migrations/202608240001_authorize_certificate_issuance.sql` and `backend/supabase/migrations/202608240002_fix_pgcrypto.sql`.

The application shell has known incomplete paths. `BackendService.LoginTrainer` accepts any nonblank credentials and `SyncProgress` only logs. `TrainingUIBridge` only logs. The generated scenes and prefabs do not reference these three application-shell types.

### `preserve/local-unity-state-2026-08-25`

This branch starts at `main` commit `5a8fe61`. It preserves the local Unity project metadata, package lockfile, project settings, XR and ARCore configuration, generated-scene script, Supabase ignore rules, ADR, mobile launcher preview, and project-local agent tooling that existed in the working tree.

`mobile/Assets/Editor/BuildMvp.cs` now builds the two scenes created by `MvpSceneBuilder.CreateScenes()`. It no longer requires `Assets/Scenes/Launcher.unity`, which the current generator does not create.

No Unity scene file exists in the preserved working tree. `mobile/Assets/Scenes.meta` exists, and `MvpSceneBuilder.CreateScenes()` generates `FireTraining.unity` and `GasTraining.unity` when Unity runs it.

## Important files

- Unity MVP scene generator is `mobile/Assets/App/Editor/MvpSceneBuilder.cs`.
- Unity MVP build script is `mobile/Assets/Editor/BuildMvp.cs`.
- Unity project settings are under `mobile/ProjectSettings/`.
- Unity package lockfile is `mobile/Packages/packages-lock.json`.
- ARCore and XR settings are under `mobile/Assets/XR/`.
- .NET solution is `mobile/SurakshaAR.sln`.
- Domain tests are `mobile/SurakshaAR.Domain.Tests/TrainingRuntimeTests.cs`.
- Infrastructure tests are `mobile/SurakshaAR.Infrastructure.Tests/AttemptSyncTests.cs`, `JsonAttemptStoreTests.cs`, `JsonLocalizationCatalogTests.cs`, and `JsonTrainingCatalogTests.cs`.
- Backend test is `backend/tests/evaluate-attempt.test.ts`.
- Dashboard test is `dashboard/src/data.test.ts`.

## Known conflicts

- `MvpSceneBuilder.CreateScenes()` and `CreateCoreScenes.cs` both write `FireTraining.unity` and `GasTraining.unity`. Running either generator can replace the other design.
- The lean runtime uses action-based training. The full-app branch adds semantic interactions and `IScenarioModule`.
- The full-app branch has several scene lists. The full-app build uses seven scenes, the MVP build uses three scenes, the placeholder build uses one scene, and `SetBuildScenes.cs` writes seven scenes.
- The full-app version of `MvpSceneBuilder` creates `Launcher.unity`, but it writes a removed `TrainingCoordinator.moduleId` serialized field. Unity will dereference a missing serialized property.
- Current local generated prefabs serialize `TrainingTarget.interactionId`, but the lean `TrainingTarget` source has no such field. Those prefabs belong to the full-app interaction model.
- The lean runtime has real Supabase adapters. The full-app `BackendService` and `TrainingUIBridge` are placeholders and must not replace the working adapters.

## Suggested merge approach

1. Keep the tested domain runtime, local persistence, synchronization, and Supabase adapters from `main`.
2. Select useful scenes and UI from `feat/full-app-phases-1-5` without running competing scene generators during the merge.
3. Replace `BackendService` and `TrainingUIBridge` placeholder paths with calls into the retained coordinator and remote adapters.
4. Reconcile the action model and `IScenarioModule` before reconnecting scenarios to the UI.
5. Preserve each Unity asset's matching `.meta` file. Do not regenerate GUIDs during the merge.

## Test status

- `dotnet test mobile/SurakshaAR.sln` passed 11 tests. The domain project passed 4 tests and the infrastructure project passed 7 tests.
- `npm test` passed 5 tests. The backend workspace passed 3 tests and the dashboard workspace passed 2 tests.
- `npm run typecheck` passed.
- `npm run build` passed. Vite built the dashboard production bundle.
- Unity editor, Unity EditMode tests, and Android builds were not run. This environment has no `Unity` or `unity-editor` executable.

## Secrets and local output

Runtime configuration still needs a Supabase URL, a publishable key for the Unity inspector, and server-only service-role credentials for Edge Function deployment and `publish-scenarios`. Use ignored `.env` files for backend and dashboard values. Do not put the service-role key in Unity.

The branch does not commit `.env` files, APKs, AABs, keystores, Unity `Library`, `Logs`, `UserSettings`, `.utmp`, generated prefabs, generated font assets, or Supabase `.temp` state. `mobile/ProjectSettings/ProjectSettings.asset` contained a nonempty PlayStation passcode. This branch clears that field before committing the project settings.
