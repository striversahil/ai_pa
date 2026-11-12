"use client";

// Extracted verbatim from ProcurementQueue.tsx by scripts/refactor/split-module.mjs.
// ProcurementQueue.tsx re-exports everything public here, so existing imports keep working.
import type { Enquiry } from "@/types";
import { openLoops, isSubmitted, hasPendingProcurementLoop, itemNeedsRates, isOpenSpecFlag, procurementSubmittable } from "@/enquiry/queue";

export function EnquiryStatus({ enquiry, mode }: { enquiry: Enquiry; mode: "active" | "history" }) {
  const items = enquiry.items ?? [];
  if (mode === "history") {
    const n = items.filter((it) => (it.rates ?? []).length > 0 && openLoops(it, 'rates').length === 0).length;
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
        {n} quoted
      </span>
    );
  }
  // Reactivated concluded with a procurement-held loop — highlight differently
  if (isSubmitted(enquiry as any) && hasPendingProcurementLoop(enquiry as any)) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 animate-pulse">
        Sales follow-up — needs answer
      </span>
    );
  }
  const pendingItems = items.filter(itemNeedsRates);
  // Spec/request blockers span the whole loop, not just itemNeedsRates: a
  // flagged item keeps its quote (needs-rates goes false while the sales
  // fix is pending), but the chip must still name the blocker — otherwise
  // a quoted-but-flagged item misreads as "Needs rates".
  const loopItems = items.filter((it) => !it.rateAvailable && !(it as any).notAvailable && openLoops(it, 'not_available').length === 0 && !it.internalRates);
  const flagged = loopItems.filter((it) => isOpenSpecFlag(it)).length;
  const requested = loopItems.filter((it) => openLoops(it, 'rates').length > 0 && !isOpenSpecFlag(it)).length;
  const alternates = items.filter((it) => openLoops(it, 'query', 'procurement').length > 0).length;
  if (alternates > 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30">
        Alternate requested{items.length > 1 ? ` (${alternates}/${items.length})` : ""}
      </span>
    );
  }
  if (flagged > 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-red-500/10 text-red-500 border-red-500/30">
        Awaiting sales fix{pendingItems.length > 1 ? ` (${flagged}/${pendingItems.length})` : ""}
      </span>
    );
  }
  if (requested > 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-indigo-500/10 text-indigo-500 border-indigo-500/30">
        Rates requested{pendingItems.length > 1 ? ` (${requested}/${pendingItems.length})` : ""}
      </span>
    );
  }
  if (pendingItems.length === 0 && procurementSubmittable(enquiry).ok) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
        Quoted — ready to conclude
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
      Needs rates{pendingItems.length > 1 ? ` (${pendingItems.length})` : ""}
    </span>
  );
}
