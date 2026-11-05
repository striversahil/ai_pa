"use client";

import { useEffect } from "react";

// Registers the PWA service worker so the app installs as a home-screen app
// and loads offline after the first visit. Registration is a no-op when the
// SW file isn't present (e.g. local dev).
//
// Deploy freshness: sw.js calls skipWaiting() + clients.claim(), so a new
// build takes control of the OPEN page — but the page keeps running the JS it
// already loaded. That is how a dashboard tab ends up showing a days-old UI
// (no calendar, old pills) until someone refreshes by hand. So when a NEW
// worker takes control of a page that was already controlled, reload once.
// `hadController` keeps the first visit from reloading; `done` makes it
// strictly once per page load, so a reload loop is impossible.
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    let done = false;

    const onControllerChange = () => {
      if (done || !hadController) return;
      done = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let stopVisibility: (() => void) | undefined;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.update().catch(() => {});
        // A tab left open for hours should re-check when it comes back.
        const onVisible = () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", onVisible);
        stopVisibility = () => document.removeEventListener("visibilitychange", onVisible);
      })
      .catch((e) => {
        console.warn("SW registration skipped:", e);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      stopVisibility?.();
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      hadController = false;
    };
  }, []);

  return null;
}
