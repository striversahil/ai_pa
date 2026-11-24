// accounts-dashboard/thread-api.ts — the only place the Accounts thread UI
// talks to the backend. Components never fetch directly (AGENTS.md: domain
// api.ts/hook owns the request; `fe.raw_fetch_api` is ratcheted).
import type { ThreadDetail } from "./types";

const BASE = "/api/accounts";

/** One task's thread for the performance window (defaults to the current FY). */
export async function fetchThread(
  templateId: string,
  slot: string,
  opts: { from?: string; to?: string } = {},
): Promise<ThreadDetail> {
  const q = new URLSearchParams({ slot });
  if (opts.from) q.set("from", opts.from);
  if (opts.to) q.set("to", opts.to);
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(templateId)}/thread?${q.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    let msg = `Thread load failed (HTTP ${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep status text */ }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Explain a missed day: the description of the late work. The day stays
 * "Not done" (founder rule 2026-11-25) — this records WHY, it does not complete
 * anything; marking the work done is the normal Done action.
 */
export async function resolveLateWork(logId: string, lateNote: string): Promise<void> {
  const res = await fetch(`${BASE}/logs/${encodeURIComponent(logId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    // status is sent unchanged on purpose: the API requires a status, and the
    // server keeps not_done; the note is what changes.
    body: JSON.stringify({ status: "not_done", lateNote }),
  });
  if (!res.ok) {
    let msg = `Resolve failed (HTTP ${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep status text */ }
    throw new Error(msg);
  }
}

/**
 * Fill the financial year once (root). Idempotent: existing days are untouched,
 * and past due days with no update become the engine's own "Task not done on
 * <date>" entries, so the year view is complete instead of starting at
 * deployment day.
 */
export async function syncThreadWindow(from?: string): Promise<{ from: string; to: string; created: number; missed: number }> {
  const res = await fetch(`${BASE}/threads/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(from ? { from } : {}),
  });
  if (!res.ok) {
    let msg = `Sync failed (HTTP ${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep status text */ }
    throw new Error(msg);
  }
  return res.json();
}
