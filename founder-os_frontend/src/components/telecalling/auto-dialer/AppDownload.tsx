"use client";

// Controller → Auto Dialer → phone app: the newest APK built by GitHub Actions
// (android-apk.yml), with a direct download and a link to share with agents.
import { useState } from "react";
import { Download, Link2, Smartphone } from "lucide-react";
import { relActive } from "@/lib/format";
import type { AppRelease } from "@/telecalling/dialer";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function AppDownload({ release, loading }: { release: AppRelease | null; loading: boolean }) {
  const [copied, setCopied] = useState(false);

  if (loading && !release) return <p className="text-[11px] text-zinc-500">Checking the latest app build…</p>;
  if (!release?.available) {
    return (
      <p className="text-[11px] text-zinc-500">
        No app build published yet. It appears here after the next GitHub build of android/Auto-Dialer.
      </p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(release.downloadUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is still visible on the button */ }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 text-xs">
        <Smartphone className="h-4 w-4 text-indigo-500" />
        <div>
          <p className="font-semibold">Phone app v{release.versionName}</p>
          <p className="text-[11px] text-zinc-500">
            {release.sizeBytes > 0 && `${mb(release.sizeBytes)} · `}
            built {release.builtAt ? relActive(release.builtAt).replace(/^Active /, "") : "—"}
            {release.commit && ` · ${release.commit.slice(0, 7)}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          id="dialer-app-copy-link"
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <Link2 className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy link"}
        </button>
        <a
          id="dialer-app-download"
          href={release.downloadUrl}
          download
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          <Download className="h-3.5 w-3.5" /> Download APK
        </a>
      </div>
    </div>
  );
}
