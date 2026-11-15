"use client";

// ─────────────────────────────────────────────────────────────────────────────
// views/session/SessionView.tsx — the Workspace page (/session, /session/<slug>).
//
// The old tile grid is retired: the page is now the person's tabbed workspace
// (PersonWorkspace). Deep links (/session/<slug>) select the matching tab.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import PersonWorkspace from "@/views/workspace/PersonWorkspace";

export default function SessionView({ slug }: { slug: string | null }) {
  return <PersonWorkspace initialSlug={slug} />;
}
