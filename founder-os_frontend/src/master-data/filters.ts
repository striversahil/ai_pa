// filters.ts — filter state, duplicate grouping and CSV for the customer master.
//
// Filtering, search, sorting, KPI tiles and filter options run on the SERVER
// since 2026-11-21 (founder paging standard): this file only shapes the
// filter state into query params — mirror of
// founder-os_backend/src/modules/master-data/list-query.ts `parseCustomerFilters`
// (same param names; the SQL there reproduces the retired client predicates,
// parity-checked on the live book).
import type { MasterCustomer } from "./types";

export interface MasterFilters {
  q: string;
  /** '' = every region. */
  region: string;
  status: string;
  pipeline: string;
  typeBase: string;
  state: string;
  /** '' = every district (options narrow to the selected state). */
  district: string;
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
  district: "",
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
    !!f.state || !!f.district || !!f.subArea || !!f.owner || !!f.duplicates ||
    f.hasEmail || f.hasPhone || f.hasGstin || f.hasPincode
  );
}

export type SortKey = "name" | "region" | "city" | "type" | "est" | "lastEst" | "so" | "lastSo" | "status";

export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: SortState = { key: "name", dir: "asc" };

/** Filters + sort → server query params (search `q` rides the paged hook). */
export function filterParams(f: MasterFilters, sort: SortState = DEFAULT_SORT): Record<string, string | undefined> {
  const flag = (b: boolean) => (b ? "1" : undefined);
  return {
    region: f.region, status: f.status, pipeline: f.pipeline, typeBase: f.typeBase,
    state: f.state, district: f.district, subArea: f.subArea, owner: f.owner,
    duplicates: f.duplicates,
    hasEmail: flag(f.hasEmail), hasPhone: flag(f.hasPhone), hasGstin: flag(f.hasGstin), hasPincode: flag(f.hasPincode),
    sort: sort.key, dir: sort.dir,
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
  ["District", (r) => r.district],
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
