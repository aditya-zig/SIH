import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { getSyncContext } from "./data";
import { startSyncScheduler } from "./webar/api/syncAttempt";

// PWA service worker (offline shell/package cache). Failure never blocks UI.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// Queue drain runs on startup, reconnect, focus, and visibility resume.
// No manual sync press required; no session means the drain quietly skips.
startSyncScheduler(getSyncContext);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
