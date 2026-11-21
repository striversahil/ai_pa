"use client";

// Controller → Auto Dialer → phone app: the newest APK build, downloaded through
// Founder OS (/api/dialer/app/download). Open the Controller on an agent's
// phone and tap Download to install it there.
import { Download, Smartphone } from "lucide-react";
import { relActive } from "@/lib/format";
import type { AppRelease } from "@/telecalling/dialer";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function AppDownload({ release, loading }: { release: AppRelease | null; loading: boolean }) {
  if (loading && !release) return <p className="text-[11px] text-zinc-500">Checking the latest app build…</p>;
  if (!release?.available) {
    return <p className="text-[11px] text-zinc-500">No phone app build published yet. It appears here after the next app build.</p>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 text-xs">
        <Smartphone className="h-4 w-4 text-indigo-500" />
        <div>
          <p className="font-semibold">Phone app v{release.versionName}</p>
          <p className="text-[11px] text-zinc-500">
            {release.sizeBytes > 0 && `${mb(release.sizeBytes)} · `}
            built {release.builtAt ? relActive(release.builtAt).replace(/^Active /, "") : "—"}
            {" · open this page on the agent's phone and tap Download to install"}
          </p>
          {!release.stableKey && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">This build is not signed with the shared key: uninstall the old app before installing.</p>
          )}
        </div>
      </div>
      <a
        id="dialer-app-download"
        href={release.downloadUrl}
        download
        className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
      >
        <Download className="h-3.5 w-3.5" /> Download APK
      </a>
    </div>
  );
}
