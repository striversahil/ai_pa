"use client";

// ─────────────────────────────────────────────────────────────────────────────
// views/session/SessionView.tsx — the Workspace page (/session, /session/<slug>).
//
// The human side: the dashboards THIS viewer may open (server-filtered by
// GET /api/session/workspaces) and, on /session/<slug>, the dashboard itself
// with data scoped to the viewer by the server. Dashboards render through the
// shared src/workspaces layer — the same components the registry links to.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { WorkspaceFrame, usePinnedWorkspaces, useWorkspaces, useWorkspaceHost, type WorkspaceSummary } from "@/workspaces";

export default function SessionView({ slug }: { slug: string | null }) {
  if (slug) return <WorkspaceFrame slug={slug} backLabel="All workspaces" />;
  return <WorkspaceGrid />;
}

function WorkspaceGrid() {
  const { workspaces, loading } = useWorkspaces();
  const { pinned, isPinned, toggle } = usePinnedWorkspaces();
  const host = useWorkspaceHost();

  const { pinnedList, restList } = useMemo(() => {
    const bySlug = new Map(workspaces.map((w) => [w.slug, w]));
    return {
      pinnedList: pinned.map((s) => bySlug.get(s)).filter(Boolean) as WorkspaceSummary[],
      restList: workspaces.filter((w) => !pinned.includes(w.slug)),
    };
  }, [workspaces, pinned]);

  const card = (w: WorkspaceSummary) => (
    <div
      key={w.slug}
      className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50 p-5 transition-all duration-200 hover:border-indigo-500/40 dark:border-zinc-800/80 dark:bg-zinc-900"
    >
      <button onClick={() => host.open(w.slug)} className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left">
        <h3 className="truncate font-bold text-zinc-900 dark:text-white">{w.name}</h3>
        <span className="mt-1 inline-block text-xs font-bold text-indigo-500 dark:text-indigo-400">Open →</span>
      </button>
      <button
        onClick={() => toggle(w.slug)}
        title={isPinned(w.slug) ? "Unpin" : "Pin for quick access"}
        className={`shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-xs transition-all duration-200 ${isPinned(w.slug)
          ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
          : "border-zinc-300 bg-zinc-100 text-zinc-600 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
      >
        📌 {isPinned(w.slug) ? "Pinned" : "Pin"}
      </button>
    </div>
  );

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      <div className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Workspace</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">The dashboards you have access to.</p>
      </div>
      {loading && workspaces.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-zinc-500 dark:text-zinc-400">
          <span className="animate-pulse">Loading workspaces...</span>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
          <div className="text-4xl">🗂️</div>
          <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">No dashboards are assigned to your account yet. Ask the administrator to grant access.</p>
        </div>
      ) : (
        <>
          {pinnedList.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">📌 Pinned</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pinnedList.map(card)}</div>
            </div>
          )}
          <div className="space-y-4">
            {pinnedList.length > 0 && (
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">All workspaces</h2>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{restList.map(card)}</div>
          </div>
        </>
      )}
    </div>
  );
}
