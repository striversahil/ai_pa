"use client";

// WorkspaceFrame — the chrome around one open workspace (back + pin), shared by
// every host. Styling moved verbatim from components/Automations.tsx.
import React from "react";
import { WorkspaceRenderer } from "./registry";
import { useWorkspaceHost } from "./WorkspaceHost";
import { usePinnedWorkspaces } from "./usePinned";

export default function WorkspaceFrame({ slug, backLabel, showBack = true }: { slug: string; backLabel: string; showBack?: boolean }) {
  const host = useWorkspaceHost();
  const { isPinned, toggle } = usePinnedWorkspaces();
  const pinned = isPinned(slug);
  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showBack ? (
          <button
            onClick={() => host.home()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-sm transition-all duration-200 cursor-pointer border-0"
          >
            ← {backLabel}
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={() => toggle(slug)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer border-0 ${pinned
              ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/30"
              : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white"
            }`}
        >
          {pinned ? "📌 Pinned" : "📌 Pin this dashboard"}
        </button>
      </div>
      <WorkspaceRenderer slug={slug} />
    </div>
  );
}
