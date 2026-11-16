"use client";

// ─────────────────────────────────────────────────────────────────────────────
// views/session/SessionView.tsx — the Workspace page (/session, /session/<slug>).
//
// Sales-head holders and root get the single custom Sales Head dashboard.
// Everyone else keeps the tabbed pile (PersonWorkspace) until their position
// pack ships. Root keeps direct single-sheet deep links as the admin escape
// hatch; sales-head deep links redirect home (page.tsx).
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { useAuth } from "@/auth/AuthContext";
import { grantedScopes } from "@/auth/permissions";
import { WorkspaceFrame } from "@/workspaces";
import PersonWorkspace from "@/views/workspace/PersonWorkspace";
import SalesHeadDashboard from "@/views/workspace/SalesHeadDashboard";

export default function SessionView({ slug }: { slug: string | null }) {
  const { me } = useAuth();
  const single = !!me && (me.isRoot || grantedScopes(me).has("sales-head"));
  if (slug && me?.isRoot) {
    return <WorkspaceFrame slug={slug} backLabel="Workspace" />;
  }
  if (single) return <SalesHeadDashboard initialSlug={slug} />;
  return <PersonWorkspace initialSlug={slug} />;
}
