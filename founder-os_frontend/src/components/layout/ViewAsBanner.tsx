"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/layout/ViewAsBanner.tsx — "you are not yourself" strip.
//
// Rendered on every view while root impersonates someone. It is the only way to
// leave without hunting for the console, and it states the read-only contract up
// front so a refused save never looks like a broken dashboard.
// ─────────────────────────────────────────────────────────────────────────────
import { useAuth } from "@/auth/AuthContext";

export function ViewAsBanner() {
  const { me, isViewingAs, exitViewAs, viewAsBusy } = useAuth();
  if (!isViewingAs || !me?.actingAs) return null;

  return (
    <div className="sticky top-0 z-20 border-b border-amber-500/40 bg-amber-500/15 backdrop-blur md:top-0">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-2 md:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="text-base leading-none">👁</span>
          <span className="font-heading text-sm font-extrabold text-amber-800 dark:text-amber-200">
            Viewing as {me.user.displayName || me.user.name}
          </span>
          <span className="truncate text-[11px] text-amber-700/80 dark:text-amber-300/80">
            {me.user.email} · {me.roles.length > 0 ? me.roles.join(", ") : "no role"} ·{" "}
            {me.scopes.length} dashboard{me.scopes.length === 1 ? "" : "s"}
          </span>
          <span className="hidden rounded-full border border-amber-600/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 sm:inline">
            read-only
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-amber-700/80 dark:text-amber-300/80 md:inline">
            Your own session and their live notifications are unaffected.
          </span>
          <button
            type="button"
            onClick={() => void exitViewAs()}
            disabled={viewAsBusy}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-500 disabled:opacity-50"
          >
            {viewAsBusy ? "Exiting…" : `Exit · back to ${me.actingAs.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ViewAsBanner;
