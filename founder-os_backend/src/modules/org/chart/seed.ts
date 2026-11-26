// modules/org/chart/seed.ts — the initial chart, mirrored from organization.json.
// The repository file is still the source/fallback for the frontend; the guard
// scripts/guards/org-chart-edit.test.mjs keeps this seed in lockstep.
import type { OrgChartRow } from "./types";

const row = (
  id: string, title: string, department: string | null, wing: string,
  reportsToId: string | null, isHead: boolean, loginPosition: string | null, order: number,
): OrgChartRow => ({
  id, title, titleKey: title.trim().toLowerCase(), department, wing,
  reportsToId, isTop: title === "MD", isHead, loginPosition, order, active: true,
});

export const ORG_CHART_SEED: OrgChartRow[] = [
  row("org-md", "MD", null, "Operations", null, false, null, 0),
  row("org-sales-head", "Sales Head", "Sales", "Sales", "org-md", true, "sales-head", 1),
  row("org-team-lead", "Team Lead", "Sales", "Sales", "org-sales-head", false, "team-lead", 2),
  row("org-telecaller", "Telecaller", "Sales", "Sales", "org-team-lead", false, "telecaller", 3),
  row("org-field-staff", "Field Staff", "Sales", "Sales", "org-team-lead", false, "field-staff", 4),
  row("org-dm-senior", "Digital Marketing - Senior", "Digital Marketing", "Marketing", "org-md", true, "dm-senior", 5),
  row("org-dm-junior", "Digital Marketing - Junior", "Digital Marketing", "Marketing", "org-dm-senior", false, "dm-junior", 6),
  row("org-accountant-senior", "Senior Accountant", "Accounts", "Operations", "org-md", false, "accountant", 7),
  row("org-accountant-junior", "Junior Accountant", "Accounts", "Operations", "org-md", false, "accountant", 8),
  row("org-mis", "MIS", "Operations & Support", "Operations", "org-md", false, null, 9),
  row("org-procurement", "Procurement", "Operations & Support", "Operations", "org-md", false, "procurement", 10),
  row("org-hr", "HR", "Operations & Support", "Operations", "org-md", false, "hr", 11),
];
