"use client";

import { useEffect } from "react";

// Registers the PWA service worker so the app installs as a home-screen app
// and loads offline after the first visit. Registration is a no-op when the
// SW file isn't present (e.g. local dev).
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const url = "/sw.js";
    navigator.serviceWorker
      .register(url)
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch((e) => {
        console.warn("SW registration skipped:", e);
      });
  }, []);

  return null;
}