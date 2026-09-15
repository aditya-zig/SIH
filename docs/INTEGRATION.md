# SurakshaAR integration status

The former Unity integration contract is retired. Its scene-generation commands, C# seams, APK ownership and mobile paths refer to the removed client. Consult Git history for that implementation.

The [WebAR execution Bible](https://app.notion.com/p/3dc074fda55681d8942fff9b7c50e490) tracks current implementation tasks.

## Repository boundary

This repository is aditya-zig/SIH. The supplied local-agent transcript identifies a different origin, mradulverma01/SurakshaAR, at /home/batman/Projects/code/SurakshaAR. Do not assume local WebAR changes are present here or overwrite that dirty checkout during cleanup.

## Keep

- backend/: evaluation, certificate verification, schema history and tests. Review compatibility before replacing existing sync contracts.
- dashboard/: reusable React dashboard and certificate views.
- package.json and package-lock.json: existing backend/dashboard workspace configuration.
- CONTEXT.md, research, translation questionnaire and prototype material: domain/design references, not implementation acceptance evidence.
- Agent tooling and guidance: unrelated to retiring Unity.

## Retire

Unity client files have already been removed from main. Do not restore mobile build instructions or treat historical C# tests as current gates. Preserve repository history. Any dirty or untracked local Unity work needs a separate backup before local deletion.

## Local-agent status from the supplied 15 September transcript

E01 adds the A-Frame dependency, primitive scene entities, worker event progression and runtime tests. Reported dashboard verification: typecheck passed, 26 tests passed, production build passed. Headless browser evidence shows A-Frame loaded and synthetic entity events reached local save.

Real WebXR hit-test placement remains incomplete: the shown placement handler uses a fixed origin. Synthetic DOM clicks do not establish real raycast selection or device AR behavior. Offline assets, authenticated queue isolation/retries, AI authoring and publish/sync integration remain separate work. These observations are transcript evidence, not independent verification of the laptop.

## Existing workspace checks

Run npm run typecheck, npm test and npm run build with existing dependencies. Apply database migrations or deploy functions only as a separately scoped implementation task.
