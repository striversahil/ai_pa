// Extracted verbatim from ProductLineDashboard.tsx by scripts/refactor/split-module.mjs.
// ProductLineDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { GuideRow, RateRow } from "./types";

/* ── Design tokens (single place, theme-aware via app CSS vars) ── */
export const panel = "bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl";

export const field = "w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors";

export const label = "block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]";

export const primaryBtn = "inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl hover:opacity-90 disabled:opacity-40 cursor-pointer border-0 transition-opacity";

export const ghostBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-xl cursor-pointer bg-transparent text-[var(--text-primary)] transition-colors";

export const dangerBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 font-bold text-xs rounded-xl cursor-pointer border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white bg-transparent transition-colors";

export const iconBtn = "inline-flex items-center justify-center h-7 w-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-input)] cursor-pointer bg-transparent border-0 transition-colors";

export async function api(path: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = String((await res.json())?.error ?? msg); } catch { /* keep */ }
    throw new Error(msg);
  }
}

export const fmtINR = (n: number | null | undefined): string =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

/* ── Client-side form validation (backend re-validates; the UI must never
 *  send what it can already tell is wrong, and never surface raw DB errors) ── */
export const isHttpUrl = (s: string): boolean => /^https?:\/\/.+/i.test(s.trim());

/** Photo values the backend accepts: uploaded KV path or https URL. */
export const isPhotoValue = (s: string): boolean => {
  const t = s.trim();
  return t !== "" && (isHttpUrl(t) || t.startsWith("/api/chat/files/"));
};

export const isNum = (s: string): boolean => s.trim() !== "" && Number.isFinite(Number(s));

export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/* Stable muted hue per category (dot accents, not gradients). */
export const HUES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316"];

export function hueFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function attrLabel(key: string, guide: GuideRow[]): string {
  const hit = guide.find((g) => g.attrKey === key);
  if (hit) return hit.question.length > 64 ? hit.question.slice(0, 64) + "…" : hit.question;
  return key.replace(/_/g, " ");
}

export function specSummary(r: RateRow): string {
  const vals = Object.values(r.attrValues ?? {});
  if (!vals.length) return r.unit || "standard spec";
  return vals.slice(0, 2).join(" · ");
}
