"use client";

import React, { useEffect, useState } from "react";
import type { HrHiringPosition } from "@/hr/types";
import { saveHiringVideoUrl } from "@/hr/api";
import { cleanVideoUrl } from "@/hr/hiring-positions";

function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "video link";
  }
}

/**
 * One video walkthrough link per hiring position. HR pastes the URL; the card
 * opens it in a new tab. Empty is a real state, so HR can remove a bad link.
 */
export default function PositionVideoSlot({
  position,
  canManage,
  onChanged,
}: {
  position: HrHiringPosition;
  canManage: boolean;
  onChanged: () => void;
}) {
  const saved = position.videoUrl ?? "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setValue(position.videoUrl ?? "");
    setErr(null);
  }, [position.id, position.videoUrl]);

  const dirty = value.trim() !== saved;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    let next: string | null;
    try {
      next = cleanVideoUrl(value);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Enter a valid video link.");
      return;
    }
    if (!next) { setErr("Paste a video link first."); return; }
    setBusy(true);
    setErr(null);
    try {
      await saveHiringVideoUrl(position.id, next);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed — please retry.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveHiringVideoUrl(position.id, null);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Remove failed — please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Video walkthrough</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${saved ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
          {saved ? "Link" : "None"}
        </span>
      </div>

      {saved ? (
        <a
          href={saved}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 hover:border-indigo-400 hover:bg-indigo-500/5 dark:border-zinc-800"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-base text-indigo-500">▶</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">Open walkthrough</span>
            <span className="block truncate text-[10px] text-zinc-500">{hostOf(saved)}</span>
          </span>
        </a>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-center text-[11px] text-zinc-500 dark:border-zinc-700">
          No walkthrough link yet.
        </div>
      )}

      {canManage && (
        <form onSubmit={save} className="mt-2 space-y-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste a video link (YouTube, Drive, Loom…)"
            inputMode="url"
            disabled={busy}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="submit"
              disabled={busy || !dirty || !value.trim()}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save link"}
            </button>
            {saved && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[10px] text-zinc-500">Any http(s) link works; it opens in a new tab.</p>
        </form>
      )}

      {err && <p className="mt-2 text-[11px] font-bold text-rose-500">{err}</p>}
    </div>
  );
}
