# SurakshaAR WebAR direction

The Unity implementation specification is retired. The current execution plan is the [SurakshaAR WebAR Bible](https://app.notion.com/p/3dc074fda55681d8942fff9b7c50e490).

## Target flow

Trainer media and instructions → AI draft → trainer review and approval → immutable training package → worker browser training → offline attempt storage → server evaluation and results.

Use the existing React/TypeScript dashboard and Supabase backend as reusable foundations. The worker runtime targets A-Frame/WebXR with an explicit desktop preview. Unity, C# mobile runtime and APK builds are no longer active requirements.

These are target requirements, not a claim that this checkout implements them. The local WebAR work reported on 15 September 2026 belongs to a separate checkout whose origin is mradulverma01/SurakshaAR.

## Retained trust boundaries

The client cannot issue a trusted certificate. The server must evaluate the exact immutable module version from ordered evidence. Identical retries must not duplicate attempts or certificates; conflicting evidence must be rejected. Offline records must be isolated by authenticated worker and package version.

Safety fixtures remain explicitly labeled demos until qualified content review. Historical procedure descriptions are not automatically approved training content.
