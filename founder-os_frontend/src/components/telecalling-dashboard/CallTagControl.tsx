"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import type { FollowUp, CallTagDelta, CallTagValue } from "./types";
import { localIsoDay, CALL_TAG_META } from "./helpers";

export function CallTagControl({ f, onSaved, onTag, compact = false }: { f: FollowUp; onSaved: () => void; onTag?: (estimateId: string, delta: CallTagDelta | null) => void; compact?: boolean }) {
  const [picking, setPicking] = useState<CallTagValue | null>(null);
  const [date, setDate] = useState(() => f.callbackDate ?? localIsoDay(1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const minDay = localIsoDay(0);
  const maxDay = localIsoDay(10);

  const save = async (tag: CallTagValue | null, callbackDate: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(f.estimateId)}/call-tag`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, callbackDate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (HTTP ${res.status})`);
      setPicking(null);
      // Reconcile the optimistic echo with exactly what the server committed
      // (the response echoes the stored tag). This covers rapid re-tags of the
      // same estimate resolving out of order — the last response wins, and
      // responses arrive in commit order.
      onTag?.(f.estimateId, {
        callTag: ((body?.callTag ?? tag) as CallTagValue | null) ?? null,
        callbackDate: ((body?.callbackDate ?? callbackDate) as string | null) ?? null,
      });
      onSaved();
    } catch (e: any) {
      // Revert the optimistic echo — never display a state the server rejected.
      onTag?.(f.estimateId, null);
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  // Optimistic echo (Sheets-style): paint the intended tag instantly, then
  // persist. A failed save reverts via save()'s catch above.
  const tap = (tag: CallTagValue | null, callbackDate: string | null) => {
    if (tag) onTag?.(f.estimateId, { callTag: tag, callbackDate });
    else onTag?.(f.estimateId, null);
    void save(tag, callbackDate);
  };

  const chipBase = `inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${compact ? "text-[10px]" : "text-[11px]"}`;

  // A tag is set — show it with who/when, plus change + clear.
  if (f.callTag && CALL_TAG_META[f.callTag as CallTagValue]) {
    const meta = CALL_TAG_META[f.callTag as CallTagValue];
    const dueNote =
      f.callTag === "CALLBACK" && f.callbackDate
        ? f.callbackDate < minDay
          ? " — overdue, call today"
          : f.callbackDate === minDay
            ? " — due today"
            : ` — due ${f.callbackDate}`
        : "";
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <span title={`${meta.title}${dueNote}${f.callTagByName ? ` · set by ${f.callTagByName}` : ""}`} className={`${chipBase} ${meta.cls}`}>
          <span>{meta.icon}</span> {meta.label}
          {f.callTag === "CALLBACK" && f.callbackDate ? ` · ${f.callbackDate}` : ""}
        </span>
        <button
          disabled={busy}
          onClick={() => { setDate(f.callbackDate ?? localIsoDay(1)); setPicking(f.callTag as CallTagValue); }}
          title="Change tag"
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-50"
        >
          change
        </button>
        <button
          disabled={busy}
          onClick={() => tap(null, null)}
          title="Clear tag"
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-rose-500 disabled:opacity-50"
        >
          ✕
        </button>
        {picking && (
          <span className="inline-flex items-center gap-1">
            {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => (
              <button
                key={t}
                disabled={busy}
                onClick={() => (t === "CALLBACK" ? setPicking("CALLBACK") : tap(t, null))}
                title={CALL_TAG_META[t].title}
                className={`${chipBase} ${picking === t ? CALL_TAG_META[t].cls : "text-zinc-500 dark:text-zinc-400 border-zinc-400/30 bg-zinc-500/5"} hover:opacity-80 disabled:opacity-50`}
              >
                <span>{CALL_TAG_META[t].icon}</span> {CALL_TAG_META[t].label}
              </button>
            ))}
          </span>
        )}
        {picking === "CALLBACK" && (
          <span className="inline-flex items-center gap-1">
            <input
              type="date"
              value={date}
              min={minDay}
              max={maxDay}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100"
            />
            <button
              disabled={busy || !date}
              onClick={() => tap("CALLBACK", date)}
              className="rounded-md bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? "…" : "Save"}
            </button>
          </span>
        )}
        {err && <span className="text-[10px] text-rose-500">{err}</span>}
      </div>
    );
  }

  // Untagged — three quick tag buttons; CALLBACK opens the date picker.
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => (
        <button
          key={t}
          disabled={busy}
          onClick={() => (t === "CALLBACK" ? (setDate(localIsoDay(1)), setPicking("CALLBACK")) : tap(t, null))}
          title={t === "CALLBACK" ? "Follow up on a fixed date (max 10 days out)" : CALL_TAG_META[t].title}
          className={`${chipBase} text-zinc-500 dark:text-zinc-400 border-zinc-400/30 bg-zinc-500/5 hover:opacity-80 disabled:opacity-50`}
        >
          <span>{CALL_TAG_META[t].icon}</span> {CALL_TAG_META[t].label}
        </button>
      ))}
      {picking === "CALLBACK" && (
        <span className="inline-flex items-center gap-1">
          <input
            type="date"
            value={date}
            min={minDay}
            max={maxDay}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100"
          />
          <button
            disabled={busy || !date}
            onClick={() => tap("CALLBACK", date)}
            className="rounded-md bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "…" : "Save"}
          </button>
          <button disabled={busy} onClick={() => setPicking(null)} className="text-[10px] text-zinc-500 hover:text-rose-500 disabled:opacity-50">
            ✕
          </button>
        </span>
      )}
      {err && <span className="text-[10px] text-rose-500">{err}</span>}
    </div>
  );
}
