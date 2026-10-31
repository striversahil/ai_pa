// normalize.ts — presentation helpers for the customer master dashboard.
//
// Pure formatting only (no fetching, no React). The API already normalizes
// values (phones as `+91…`, dates as YYYY-MM-DD); these helpers decide how a
// value reads on screen.
import type { DuplicateReview } from "./types";

/** "12 Aug 2026" — stable across locales (the dashboard is IST-facing). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return `${Number(d)} ${month} ${y}`;
}

export function shortDate(iso: string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${String(y).slice(2)}`;
}

/** Compact relative time ("3d ago", "just now"). Empty input → "". */
export function relativeTime(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function initials(name: string): string {
  const parts = String(name ?? "")
    .replace(/[^\p{L}\p{N}\s.&-]/gu, " ")
    .split(/\s+/)
    .filter((p) => p && !/^(m\/s|ms|shri|sri|the)$/i.test(p));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Dialable href for a stored phone (already digits + optional leading +). */
export function telHref(phone: string): string {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

/** Indian numbers read better grouped; non-Indian kept as stored. */
export function formatPhone(phone: string): string {
  const raw = String(phone ?? "");
  const m = /^\+91(\d{10})$/.exec(raw);
  if (m) return `+91 ${m[1].slice(0, 5)} ${m[1].slice(5)}`;
  return raw;
}

/** Comma-joined values, capped with a "+N" tail so cells stay one line. */
export function joinCapped(list: string[], max = 2): string {
  if (!list || list.length === 0) return "";
  const head = list.slice(0, max).join(", ");
  return list.length > max ? `${head} +${list.length - max}` : head;
}

export function regionLabel(region: string): string {
  const r = String(region ?? "").trim().toUpperCase();
  return r || "Unmapped";
}

export type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "sky" | "violet" | "cyan" | "purple";

export function statusTone(status: string): Tone {
  return /inactive/i.test(status) ? "neutral" : "success";
}

export function regionTone(region: string): Tone {
  switch (String(region ?? "").toUpperCase()) {
    case "R1": return "brand";
    case "R2": return "sky";
    case "R3": return "violet";
    case "R4": return "cyan";
    default: return "neutral";
  }
}

export function duplicateTone(confidence: string): Tone {
  switch (String(confidence ?? "").toLowerCase()) {
    case "high": return "danger";
    case "medium": return "warning";
    case "review": return "info";
    default: return "neutral";
  }
}

export function pipelineTone(stage: string): Tone {
  const s = String(stage ?? "").toLowerCase();
  if (!s) return "neutral";
  if (/won|closed won|order/.test(s)) return "success";
  if (/lost|closed lost|declined/.test(s)) return "danger";
  if (/negotiat|proposal|quote/.test(s)) return "warning";
  if (/contact|qualif|follow/.test(s)) return "info";
  return "neutral";
}

export const REVIEW_LABELS: Record<DuplicateReview, string> = {
  open: "Needs review",
  "keep-master": "Keep master",
  ignored: "Ignored",
};

export function reviewTone(review: DuplicateReview): Tone {
  if (review === "keep-master") return "success";
  if (review === "ignored") return "neutral";
  return "warning";
}

/** "0 estimates" / "3 estimates · last 12 Aug 2026" — one phrasing everywhere. */
export function countHint(count: number, noun: string, lastDate?: string): string {
  if (count === 0) return `No ${noun}s`;
  const base = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return lastDate ? `${base} · ${shortDate(lastDate)}` : base;
}

export function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}
