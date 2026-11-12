// Extracted verbatim from DigitalMarketingAds.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingAds.tsx re-exports everything public here, so existing imports keep working.
import type { AdType } from "./types";

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;

export const int = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-IN');

export const TYPE_META: Record<AdType, { label: string; icon: string; badge: string }> = {
  google: { label: 'Google', icon: '🔍', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30' },
  meta: { label: 'Meta', icon: '📣', badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' },
  whatsapp: { label: 'WhatsApp', icon: '💬', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  email: { label: 'Email', icon: '✉️', badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  twitter: { label: 'Twitter', icon: '𝕏', badge: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30' },
  other: { label: 'Other', icon: '📌', badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30' },
};

export function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function todayIST(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10);
  } catch { return new Date().toISOString().slice(0, 10); }
}

/** 0–100 progress of today between start/end (clamped). Null when dates invalid. */
export function dateProgress(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
  const t = todayIST();
  if (t <= start) return 0;
  if (t >= end) return 100;
  const total = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(((Date.parse(t) - Date.parse(start)) / total) * 100);
}

export const inputCls =
  'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500';

export const labelCls = 'text-xs font-bold text-zinc-600 dark:text-zinc-300';

export async function uploadAdFile(adId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/digital-marketing/ads/${encodeURIComponent(adId)}/files`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
}
