"use client";

import { useEffect, useState, useCallback } from "react";
import { useLiveEvent } from "./useLiveData";

export interface IntakeSuggestion {
  itemIndex: number;
  memoryId?: string;
  score?: number;
  name?: string;
  route?: string;
  finalRate?: number;
}

export interface IntakeData {
  ready: boolean;
  suggestions: IntakeSuggestion[];
  missing: string[];
}

/** Kill-switch for AI intake remarks (missing-detail questions) in sales UI.
 *  OFF for now — flip to true to re-enable. Past-price suggestion cards
 *  are unaffected. */
export const SHOW_INTAKE_REMARKS = false;

/** AI intake payload for one enquiry (KV, written by the intake runner).
 *  Refetches when the enquiry row changes (result POSTs bump updatedAt) and live on Enquiries events. */
export function useIntake(enquiryId: string | null, updatedAt?: string): IntakeData | null {
  const [data, setData] = useState<IntakeData | null>(null);

  const fetchIntake = useCallback(async () => {
    if (!enquiryId) { setData(null); return; }
    try {
      const r = await fetch(`/api/enquiries/${enquiryId}/intake`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setData(j); }
    } catch {}
  }, [enquiryId]);

  useEffect(() => { void fetchIntake(); }, [fetchIntake, updatedAt]);

  // Live: vision-intake broadcasts Enquiries updated → refetch intake so loader unsticks without refresh
  useLiveEvent((e: any) => {
    if (!enquiryId) return;
    if (!e || e.type !== "enquiries") return;
    const id = String(e.id ?? e.enquiryId ?? "");
    if (id && id !== enquiryId) return;
    void fetchIntake();
  });

  return data;
}

/** Missing-slot strings belonging to one item (matched by item name). */
export function missingForItem(missing: string[], itemName: string, itemIndex: number): string[] {
  const name = itemName.trim().toLowerCase();
  return (missing ?? []).filter((m) => {
    const s = String(m ?? "");
    const low = s.toLowerCase();
    if (name && low.includes(name)) return true;
    if (low.includes(`item ${itemIndex + 1}`)) return true;
    return false;
  });
}

/** Missing strings that matched no item — shown once above the list. */
export function unmatchedMissing(missing: string[], items: Array<{ name?: string }>): string[] {
  return (missing ?? []).filter((m) => {
    const low = String(m ?? "").toLowerCase();
    return !items.some((it, i) => {
      const name = String(it?.name ?? "").trim().toLowerCase();
      return (name && low.includes(name)) || low.includes(`item ${i + 1}`);
    });
  });
}
