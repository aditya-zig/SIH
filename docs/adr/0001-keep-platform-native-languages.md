# Keep platform-native languages

Status: Unity portion superseded by the WebAR direction on 15 September 2026.

The earlier decision kept Unity/AR Foundation in C#, the React dashboard and Supabase Edge Functions in TypeScript, and database rules in SQL. Its Unity pair and APK responsibilities are historical; the mobile client has been removed.

The current direction retains TypeScript for browser/backend work and SQL for database rules, and replaces the Unity client with browser A-Frame/WebXR. See the [WebAR execution Bible](https://app.notion.com/p/3dc074fda55681d8942fff9b7c50e490). This explicitly supersedes the Unity portion of this ADR; it does not claim the replacement runtime is complete.
