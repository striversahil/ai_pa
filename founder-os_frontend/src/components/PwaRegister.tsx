"use client";

import { useEffect, useState } from "react";

// Registers the PWA service worker so the app installs as a home-screen app
// and loads offline after the first visit. Registration is a no-op when the
// SW file isn't present (e.g. local dev).
//
// ── Deploy freshness (rewritten 2026-11-12) ─────────────────────────────────
// The previous version reloaded the page the instant a new worker took control
// (`controllerchange`), and called `reg.update()` on mount AND on every
// `visibilitychange`. With a fresh `VERSION` minted per build, that meant every
// deploy hard-reloaded every open tab — and since the update check also ran when
// you came back to a tab, it looked like the dashboard refreshing itself.
//
// Two rules now:
//   1. NEVER reload a tab the user is looking at. Update checks run on mount and
//      while the tab is HIDDEN (so the next visit is already fresh); a new
//      worker that arrives while the tab is hidden reloads immediately and
//      invisibly. If it arrives while visible, we show a small banner instead.
//   2. `hadController` keeps the very first visit (no controller yet) from
//      counting as an update; `done` keeps it strictly once per page load, so a
//      reload loop remains impossible.
export default function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    let done = false;
    let pendingReload = false;

    const reloadNow = () => {
      done = true;
      window.location.reload();
    };

    const onControllerChange = () => {
      if (done || !hadController) return;
      // Hidden tab: apply the update where nobody can see the reload.
      if (document.visibilityState === "hidden") {
        reloadNow();
        return;
      }
      // Visible tab: never yank the page out from under the user mid-action.
      pendingReload = true;
      setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const onVisibility = () => {
      if (!("serviceWorker" in navigator)) return;
      if (document.visibilityState === "hidden") {
        // Leaving: apply an update that is already waiting, then look for one.
        if (pendingReload && !done) {
          reloadNow();
          return;
        }
        navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => {})).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch((e) => {
        console.warn("SW registration skipped:", e);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      hadController = false;
    };
  }, []);

  // Non-blocking update banner — only ever shown when a new build is ready and
  // the tab was visible at the time. The reload is the user's click, never a
  // timer.
  if (!updateReady) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-900/95 px-4 py-3 text-sm text-white shadow-lg backdrop-blur">
      <span>A new version is available.</span>
      <button
        type="button"
        className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-white/90"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
