// filters.ts — pure search/filter/sort/grouping for the customer master.
//
// Single home for the table's predicates (the dashboard filters client-side on
// the cached payload, so no backend mirror is needed). Framework-free: every
// function takes rows and returns rows, which keeps the component about render.
import type { MasterCustomer } from "./types";

export interface MasterFilters {
  q: string;
  /** '' = every region. */
  region: string;
  status: string;
  pipeline: string;
  typeBase: string;
  state: string;
  subArea: string;
  owner: string;
  /**
   * '' = ignore duplicates · 'all' = every duplicate row · 'open' = not yet
   * reviewed · 'reviewed' = keep-master/ignored · otherwise the confidence tier.
   */
  duplicates: string;
  hasEmail: boolean;
  hasPhone: boolean;
  hasGstin: boolean;
  hasPincode: boolean;
}

export const EMPTY_FILTERS: MasterFilters = {
  q: "",
  region: "",
  status: "",
  pipeline: "",
  typeBase: "",
  state: "",
  subArea: "",
  owner: "",
  duplicates: "",
  hasEmail: false,
  hasPhone: false,
  hasGstin: false,
  hasPincode: false,
};

export function hasActiveFilters(f: MasterFilters): boolean {
  return (
    !!f.q || !!f.region || !!f.status || !!f.pipeline || !!f.typeBase ||
    !!f.state || !!f.subArea || !!f.owner || !!f.duplicates ||
    f.hasEmail || f.hasPhone || f.hasGstin || f.hasPincode
  );
}

function haystack(r: MasterCustomer): string {
  return [
    r.name, r.company, r.contact, r.designation, r.city, r.state, r.subArea,
    r.pincode, r.gstin, r.owner, r.customerType, r.typeBase, r.typeTag,
    r.duplicateGroup, r.duplicateAction, r.emails.join(" "), r.phones.join(" "),
    r.zohoCustomerId,
  ]
    .join(" ")
    .toLowerCase();
}

function phoneDigits(r: MasterCustomer): string {
  return r.phones.map((p) => p.replace(/\D/g, "")).join(" ");
}

/** Every whitespace-separated token must match; a numeric token also matches a
 *  phone number (so "98765 43210" and "9876543210" both find the record). */
export function matchesQuery(r: MasterCustomer, q: string): boolean {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = haystack(r);
  const digits = phoneDigits(r);
  return tokens.every((token) => {
    if (text.includes(token)) return true;
    const d = token.replace(/\D/g, "");
    return d.length >= 3 && digits.includes(d);
  });
}

export function matchesFilters(r: MasterCustomer, f: MasterFilters): boolean {
  if (f.region && r.region !== f.region) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.pipeline && r.pipeline !== f.pipeline) return false;
  if (f.typeBase && r.typeBase !== f.typeBase) return false;
  if (f.state && r.state !== f.state) return false;
  if (f.subArea && r.subArea !== f.subArea) return false;
  if (f.owner && r.owner !== f.owner) return false;
  if (f.hasEmail && r.emails.length === 0) return false;
  if (f.hasPhone && r.phones.length === 0) return false;
  if (f.hasGstin && !r.gstin) return false;
  if (f.hasPincode && !r.pincode) return false;
  if (f.duplicates) {
    if (!r.duplicateGroup) return false;
    if (f.duplicates === "open" && r.duplicateReview !== "open") return false;
    if (f.duplicates === "reviewed" && r.duplicateReview === "open") return false;
    if (
      f.duplicates !== "all" && f.duplicates !== "open" && f.duplicates !== "reviewed" &&
      r.duplicateConfidence !== f.duplicates
    ) {
      return false;
    }
  }
  return matchesQuery(r, f.q);
}

export function applyFilters(rows: MasterCustomer[], f: MasterFilters): MasterCustomer[] {
  return rows.filter((r) => matchesFilters(r, f));
}

export type SortKey = "name" | "region" | "city" | "type" | "est" | "lastEst" | "so" | "lastSo" | "status";

export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: SortState = { key: "name", dir: "asc" };

const dateValue = (iso: string): number => {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
};

export function compareRows(a: MasterCustomer, b: MasterCustomer, key: SortKey): number {
  switch (key) {
    case "est":
      return a.estCount - b.estCount;
    case "so":
      return a.soCount - b.soCount;
    case "lastEst":
      return dateValue(a.lastEstimateDate) - dateValue(b.lastEstimateDate);
    case "lastSo":
      return dateValue(a.lastSalesOrderDate) - dateValue(b.lastSalesOrderDate);
    case "city":
      return (a.city || "").localeCompare(b.city || "");
    case "region":
      return (a.region || "").localeCompare(b.region || "");
    case "type":
      return a.typeBase.localeCompare(b.typeBase);
    case "status":
      return a.status.localeCompare(b.status);
    default:
      return a.name.localeCompare(b.name);
  }
}

export function sortRows(rows: MasterCustomer[], sort: SortState): MasterCustomer[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareRows(a, b, sort.key) * factor;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  });
}

export interface FilterOptions {
  types: string[];
  states: string[];
  subAreas: string[];
  owners: string[];
  pipelines: string[];
}

/** View-only counter bundle for the KPI tiles when a single region is in scope.
 *  (The server's totals cover the whole book; this keeps a filtered view's
 *  tiles honest without a second endpoint.) */
export interface RowSummary {
  total: number;
  active: number;
  inactive: number;
  neverTouched: number;
  withOrders: number;
  duplicateGroups: number;
  duplicateOpenGroups: number;
  noPhone: number;
  noEmail: number;
  noGstin: number;
  noPincode: number;
}

export function summarizeRows(rows: MasterCustomer[]): RowSummary {
  const groups = new Map<string, boolean>();
  const out: RowSummary = {
    total: rows.length, active: 0, inactive: 0, neverTouched: 0, withOrders: 0,
    duplicateGroups: 0, duplicateOpenGroups: 0, noPhone: 0, noEmail: 0, noGstin: 0, noPincode: 0,
  };
  for (const r of rows) {
    if (r.status === "Inactive") out.inactive++;
    else out.active++;
    if (r.estCount === 0 && r.soCount === 0) out.neverTouched++;
    if (r.soCount > 0) out.withOrders++;
    if (!r.phones.length) out.noPhone++;
    if (!r.emails.length) out.noEmail++;
    if (!r.gstin) out.noGstin++;
    if (!r.pincode) out.noPincode++;
    if (r.duplicateGroup) {
      const open = groups.get(r.duplicateGroup);
      groups.set(r.duplicateGroup, open === undefined ? r.duplicateReview === "open" : open || r.duplicateReview === "open");
    }
  }
  out.duplicateGroups = groups.size;
  out.duplicateOpenGroups = [...groups.values()].filter(Boolean).length;
  return out;
}

export function buildFilterOptions(rows: MasterCustomer[]): FilterOptions {
  const pick = (fn: (r: MasterCustomer) => string) =>
    [...new Set(rows.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    types: pick((r) => r.typeBase),
    states: pick((r) => r.state),
    subAreas: pick((r) => r.subArea),
    owners: pick((r) => r.owner),
    pipelines: pick((r) => r.pipeline),
  };
}

export interface DuplicateGroup {
  group: string;
  confidence: string;
  /** "Keep (master)" when declared, else the most common suggestion. */
  action: string;
  review: MasterCustomer["duplicateReview"];
  members: MasterCustomer[];
}

const CONFIDENCE_RANK: Record<string, number> = { High: 3, Medium: 2, Review: 1 };

/** Group the duplicate rows for the review tab — highest confidence first,
 *  then the biggest cluster (the ones worth a decision). */
export function groupDuplicates(rows: MasterCustomer[]): DuplicateGroup[] {
  const map = new Map<string, MasterCustomer[]>();
  for (const r of rows) {
    if (!r.duplicateGroup) continue;
    const list = map.get(r.duplicateGroup);
    if (list) list.push(r);
    else map.set(r.duplicateGroup, [r]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [group, members] of map) {
    const master = members.find((m) => /keep/i.test(m.duplicateAction));
    const actionCount = new Map<string, number>();
    for (const m of members) {
      if (!m.duplicateAction) continue;
      actionCount.set(m.duplicateAction, (actionCount.get(m.duplicateAction) ?? 0) + 1);
    }
    const action = master?.duplicateAction
      ?? [...actionCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      ?? "";
    const reviewed = members.every((m) => m.duplicateReview !== "open");
    groups.push({
      group,
      confidence: members.find((m) => m.duplicateConfidence)?.duplicateConfidence ?? "",
      action,
      review: reviewed ? (members[0].duplicateReview === "ignored" ? "ignored" : "keep-master") : "open",
      members: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups.sort((a, b) => {
    const rank = (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0);
    if (rank !== 0) return rank;
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return a.group.localeCompare(b.group);
  });
}

const CSV_COLUMNS: Array<[string, (r: MasterCustomer) => string | number]> = [
  ["Customer ID (Zoho)", (r) => r.zohoCustomerId],
  ["Display Name", (r) => r.name],
  ["Company Name", (r) => r.company],
  ["Contact Person", (r) => r.contact],
  ["Designation", (r) => r.designation],
  ["Customer Type", (r) => r.customerType],
  ["Type", (r) => r.typeBase],
  ["Type Tag", (r) => r.typeTag],
  ["Status", (r) => r.status],
  ["Region", (r) => r.region],
  ["Zone", (r) => r.zone],
  ["Sub-Area", (r) => r.subArea],
  ["State", (r) => r.state],
  ["City", (r) => r.city],
  ["Pincode", (r) => r.pincode],
  ["Phones", (r) => r.phones.join(" / ")],
  ["Emails", (r) => r.emails.join(" / ")],
  ["GSTIN", (r) => r.gstin],
  ["Owner", (r) => r.owner],
  ["Pipeline Stage", (r) => r.pipeline],
  ["# Estimates", (r) => r.estCount],
  ["Last Estimate Date", (r) => r.lastEstimateDate],
  ["# Sales Orders", (r) => r.soCount],
  ["Last Sales Order Date", (r) => r.lastSalesOrderDate],
  ["Duplicate Group", (r) => r.duplicateGroup],
  ["Duplicate Confidence", (r) => r.duplicateConfidence],
  ["Suggested Action", (r) => r.duplicateAction],
  ["Duplicate Review", (r) => r.duplicateReview],
];

/** CSV of exactly what the filters produced — the founder's export contract. */
export function toCsv(rows: MasterCustomer[]): string {
  const escape = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = CSV_COLUMNS.map(([label]) => escape(label)).join(",");
  const body = rows.map((r) => CSV_COLUMNS.map(([, pick]) => escape(pick(r))).join(","));
  return [header, ...body].join("\n");
}
