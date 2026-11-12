// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import { REGIONS } from "@/telecalling/regions";
import type { CrmProofFile } from "../types";

/** Upload one proof file for an SO; resolves the SoAttachment id. Shared by
 *  the dispatch dialog slots and the per-proof add-photo buttons. */
export async function uploadProofFile(soNumber: string, kind: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append("soNumber", soNumber);
  fd.append("kind", kind);
  fd.append("file", file);
  const res = await fetch("/api/crm/attachments", { method: "POST", body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Upload failed");
  const id = String(data?.attachment?.id || "");
  if (!id) throw new Error("Upload failed — please retry.");
  return id;
}

export const inr = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** "26 Oct 2026" — every date in this panel carries its year. The dispatch
 *  window is 30 days wide, so day+month alone reads ambiguous at a glance. */
export const dateLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** "Tue, 26 Oct 2026" — the header's order date gets the weekday too. */
export const fullDateLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/** "R2 · North-Central & Himalayan Belt" — code first, name for humans. */
export const regionName = (id: string) =>
  (REGIONS.find((r) => r.id === id)?.name ?? "").replace(/\s*Region$/, "");

/** How old the SO is on the floor: "today", "yesterday", "9 days ago". */
export const ageLabel = (d: string | null | undefined, today: string) => {
  const raw = String(d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !today) return "";
  const a = new Date(`${raw}T00:00:00Z`).getTime();
  const b = new Date(`${today}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return "";
  const days = Math.round((b - a) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1) return `${days} days ago`;
  return `in ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
};

export const isPhotoFile = (f: CrmProofFile | null): boolean =>
  !!f && (f.mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.fileName));

export const isPdfFile = (f: CrmProofFile | null): boolean =>
  !!f && (f.mime === "application/pdf" || /\.pdf$/i.test(f.fileName));

/** Older payloads carried proof IDs without file metadata — synth a tile so a
 *  dispatched order never shows blank documents. */
export const proofFileFromId = (id: string): CrmProofFile => ({
  id,
  kind: "",
  fileName: "",
  mime: "",
  size: 0,
  url: `/api/crm/files/${id}`,
  uploadedBy: "",
  createdAt: null,
});
