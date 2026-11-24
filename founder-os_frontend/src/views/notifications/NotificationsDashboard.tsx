"use client";

// ─────────────────────────────────────────────────────────────────────────────
// views/notifications/NotificationsDashboard.tsx — the Notifications dashboard
// (/notifications), its own top-level surface since 2026-11-24.
//
// It used to be a tab inside Settings; the founder needs rule authoring, the
// dispatch audit, the level palette and the AI-assist material in one place, at
// a stable URL, reachable from the sidebar.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { NotificationConsole } from "@/components/notifications-console/NotificationConsole";

export default function NotificationsDashboard() {
  return (
    <div className="mx-auto w-full max-w-[1400px] pb-12">
      <NotificationConsole />
    </div>
  );
}
