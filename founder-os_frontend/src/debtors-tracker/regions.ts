"use client";

/**
 * Region scoping for the Debtors Tracker (frontend-only, derived from the
 * rows already in the payload — no backend change).
 *
 * `CustomerAgeingRow.region` carries R1–R4 (or blank). Names come from the
 * shared sales taxonomy; the blank bucket is shown explicitly as Unmapped.
 */

import { REGIONS } from "@/telecalling/regions";
import { CUSTOMER_SITUATION_LABELS, situationLabel, type CustomerAgeingRow } from "./types";

export type DebtorRegionFilter = "ALL" | "R1" | "R2" | "R3" | "R4" | "UNMAPPED";

/** Normalized sales region of a row: R1–R4, or "" when unmapped. */
export function debtorRegionOf(row: Pick<CustomerAgeingRow, "region">): string {
  const r = String(row.region || "").trim().toUpperCase();
  return r === "R1" || r === "R2" || r === "R3" || r === "R4" ? r : "";
}

export function matchesDebtorRegion(row: Pick<CustomerAgeingRow, "region">, filter: DebtorRegionFilter): boolean {
  if (filter === "ALL") return true;
  const r = debtorRegionOf(row);
  if (filter === "UNMAPPED") return r === "";
  return r === filter;
}

/** Short display name for a sales region id ("" = Unmapped). */
export function salesRegionName(id: string): string {
  if (!id) return "Unmapped";
  return REGIONS.find((r) => r.id === id)?.name ?? id;
}

/** Picker / tile label: "R1 · North & NCR Region", "Unmapped", "All regions". */
export function debtorRegionLabel(filter: DebtorRegionFilter): string {
  if (filter === "ALL") return "All regions";
  if (filter === "UNMAPPED") return "Unmapped";
  return `${filter} · ${salesRegionName(filter)}`;
}

const REGION_ORDER = ["R1", "R2", "R3", "R4"] as const;

export interface DebtorRegionSummary {
  key: DebtorRegionFilter;
  /** R1–R4 or "" for the unmapped bucket. */
  region: string;
  label: string;
  customers: number;
  invoices: number;
  totalReceivable: number;
  notDue: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket91to180: number;
  bucketAbove180: number;
  grossDue: number;
  advanceReceived: number;
  netDue: number;
  /** Most common CRM situation in the bucket ("" when none set). */
  topSituation: string;
  topSituationCount: number;
  promisedCount: number;
}

/**
 * One summary row per R1–R4 + Unmapped, in fixed region order. Buckets and
 * situations come straight from the customer rows, so the strip and the
 * breakdown table always agree with the Ageing tab's region filter.
 */
export function summarizeDebtorRegions(customers: CustomerAgeingRow[]): DebtorRegionSummary[] {
  const buckets = new Map<string, CustomerAgeingRow[]>();
  for (const r of customers) {
    const region = debtorRegionOf(r);
    if (!buckets.has(region)) buckets.set(region, []);
    buckets.get(region)!.push(r);
  }
  // Always show every region even when empty, so the strip is stable.
  for (const id of [...REGION_ORDER.map(String), ""]) {
    if (!buckets.has(id)) buckets.set(id, []);
  }
  return [...REGION_ORDER.map(String), ""].map((id) => {
    const rows = buckets.get(id)!;
    const acc: DebtorRegionSummary = {
      key: (id === "" ? "UNMAPPED" : id) as DebtorRegionFilter,
      region: id,
      label: id === "" ? "Unmapped" : `${id} · ${salesRegionName(id)}`,
      customers: rows.length,
      invoices: 0,
      totalReceivable: 0,
      notDue: 0,
      bucket0to30: 0,
      bucket31to60: 0,
      bucket61to90: 0,
      bucket91to180: 0,
      bucketAbove180: 0,
      grossDue: 0,
      advanceReceived: 0,
      netDue: 0,
      topSituation: "",
      topSituationCount: 0,
      promisedCount: 0,
    };
    const situationCounts = new Map<string, number>();
    for (const r of rows) {
      acc.invoices += r.invoiceCount || 0;
      acc.totalReceivable += r.totalReceivable || 0;
      acc.notDue += r.notDue || 0;
      acc.bucket0to30 += r.bucket0to30 || 0;
      acc.bucket31to60 += r.bucket31to60 || 0;
      acc.bucket61to90 += r.bucket61to90 || 0;
      acc.bucket91to180 += r.bucket91to180 || 0;
      acc.bucketAbove180 += r.bucketAbove180 || 0;
      acc.grossDue += r.grossDue || 0;
      acc.advanceReceived += r.advanceReceived || 0;
      acc.netDue += r.netDue || 0;
      const sit = String(r.situation || "");
      if (sit) situationCounts.set(sit, (situationCounts.get(sit) || 0) + 1);
      if (sit === "PROMISED_TO_PAY") acc.promisedCount += 1;
    }
    for (const [sit, n] of situationCounts) {
      if (n > acc.topSituationCount) {
        acc.topSituation = sit;
        acc.topSituationCount = n;
      }
    }
    return acc;
  });
}

/** Human "Not answering ×3" style top-situation label for a region bucket. */
export function topSituationLabel(row: DebtorRegionSummary): string {
  if (!row.topSituation) return "—";
  const label =
    (CUSTOMER_SITUATION_LABELS as Record<string, string>)[row.topSituation] ||
    situationLabel(row.topSituation) ||
    row.topSituation;
  return `${label} ×${row.topSituationCount}`;
}
