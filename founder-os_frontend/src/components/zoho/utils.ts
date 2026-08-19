import type { Comment, Estimate } from "./types";

export const getTodayDateString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const getCommentCountForDate = (est: Estimate, dateStr: string): number => {
  if (!est.comments || !Array.isArray(est.comments)) return 0;
  return est.comments.filter((c: Comment | null | undefined) => c && c.date === dateStr).length;
};

export const getCommentAgeHours = (dateFormattedStr: string): number => {
  if (!dateFormattedStr) return Infinity;
  try {
    const parts = dateFormattedStr.split(" ");
    if (parts.length < 2) return Infinity;
    const dateParts = parts[0].split("/");
    const timeParts = parts[1].split(":");
    const ampm = parts[2] ? parts[2].toUpperCase() : "";

    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const year = parseInt(dateParts[2], 10);

    let hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const commentDate = new Date(year, month, day, hours, minutes);
    const now = new Date();

    return (now.getTime() - commentDate.getTime()) / (1000 * 60 * 60);
  } catch {
    return Infinity;
  }
};

export const getIntentScoreBadgeClass = (score: number) => {
  if (score >= 7) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  if (score >= 4) return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
  return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
};

export const getStatusBadgeClass = (status: string) => {
  const s = String(status).toLowerCase();
  if (s === "sent") return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
  if (s.includes("accept") || s === "confirmed") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-rose-500/10 text-rose-400 border-rose-500/20";
};

export const getEstimateAccentClass = (est: Estimate) => {
  const c = est.classification || {};
  if (est.total > 80000) return "from-amber-500 to-rose-500";
  if (c.underDiscussion === "Yes") return "from-indigo-500 to-violet-500";
  if (c.movingSlow === "Yes") return "from-orange-500 to-amber-500";
  return "from-zinc-600 to-zinc-700";
};

export const getInitials = (name: string) =>
  (name || "?")
    .split(" ")
    .filter((p: string) => p.trim())
    .map((p: string) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();