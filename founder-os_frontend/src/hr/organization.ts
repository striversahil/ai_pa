// hr/organization.ts — the organization chart, in code.
//
// Source of truth: the repo-root `organization.json` (founder-editable).
// ORG_CHART_JSON below is a VERBATIM copy; guard
// `scripts/guards/org-chart-parity.test.mjs` fails CI the moment the two drift.
//
// `count` is deliberately NOT part of the read model (founder decision
// 2026-11-13): the chart's count is not live headcount — seats are counted from
// the HR employee master at render time. Only ORG_CHART_JSON carries it, so the
// parity check stays a true verbatim mirror.
//
// Pure module: no fetch, no React, no I/O. Used by the HR role picker, the HR
// Organization tab and the CI guard.

/** Verbatim mirror of organization.json. Never edit one without the other. */
export const ORG_CHART_JSON = {
  organization: {
    name: "Company",
    top_position: "MD",
    departments: [
      {
        name: "Sales",
        head: "Sales Head",
        positions: [
          { title: "Sales Head", count: 16, reports_to: "MD", leads: ["Team Lead", "Telecaller", "Field Staff"] },
          { title: "Team Lead", count: 0, reports_to: "Sales Head", leads: ["Telecaller", "Field Staff"] },
          { title: "Telecaller", count: 1, reports_to: "Team Lead", leads: [] },
          { title: "Field Staff", count: 0, reports_to: "Team Lead", leads: [] },
        ],
      },
      {
        name: "Digital Marketing",
        head: "Digital Marketing - Senior",
        positions: [
          { title: "Digital Marketing - Senior", count: 0, reports_to: "MD", leads: ["Digital Marketing - Junior"] },
          { title: "Digital Marketing - Junior", count: 0, reports_to: "Digital Marketing - Senior", leads: [] },
        ],
      },
      {
        name: "Accounts",
        head: null,
        positions: [
          { title: "Senior Accountant", count: 0, reports_to: "MD", leads: [] },
          { title: "Junior Accountant", count: 0, reports_to: "MD", leads: [] },
        ],
      },
      {
        name: "Operations & Support",
        head: null,
        positions: [
          { title: "MIS", count: 1, reports_to: "MD", leads: [] },
          { title: "Procurement", count: 1, reports_to: "MD", leads: [] },
          { title: "HR", count: 0, reports_to: "MD", leads: [] },
        ],
      },
    ],
  },
} as const;

export const ORG_TOP_POSITION: string = ORG_CHART_JSON.organization.top_position;

/** One chart position as the app reads it (no `count`). */
export interface OrgPosition {
  title: string;
  department: string;
  reportsTo: string;
  leads: string[];
  /** The department's head position (one per department, when set). */
  isHead: boolean;
}

export const ORG_POSITIONS: OrgPosition[] = ORG_CHART_JSON.organization.departments.flatMap((d) =>
  d.positions.map((p) => ({
    title: p.title,
    department: d.name,
    reportsTo: p.reports_to,
    leads: [...p.leads],
    isHead: d.head === p.title,
  })),
);

export const ORG_DEPARTMENTS: string[] = ORG_CHART_JSON.organization.departments.map((d) => d.name);

/**
 * Display wing — the three-way split the founder reads the chart in.
 * Sales = the whole Sales department; Marketing = Digital Marketing;
 * Operations = MIS + Procurement + HR + Accounts (both accountant levels).
 *
 * Display-only: `organization.json` departments and backend permissions are
 * untouched — the graph groups nodes/legend by wing so the distinction is
 * visible at a glance.
 */
export type OrgWing = "Sales" | "Marketing" | "Operations";

export const ORG_WINGS: OrgWing[] = ["Sales", "Marketing", "Operations"];

const WING_OF_DEPARTMENT: Record<string, OrgWing> = {
  Sales: "Sales",
  "Digital Marketing": "Marketing",
  Accounts: "Operations",
  "Operations & Support": "Operations",
};

/** Wing a chart department belongs to (null for the synthetic top node). */
export function wingOfDepartment(department: string | null | undefined): OrgWing | null {
  if (!department) return null;
  return WING_OF_DEPARTMENT[String(department).trim()] ?? null;
}

/** Wing a chart position belongs to (null for unknown titles). */
export function wingOfTitle(title: string | null | undefined): OrgWing | null {
  const pos = BY_TITLE.get(String(title ?? "").trim());
  if (!pos) return null;
  return wingOfDepartment(pos.department);
}

const BY_TITLE = new Map(ORG_POSITIONS.map((p) => [p.title, p]));

export function orgPosition(title: string): OrgPosition | null {
  return BY_TITLE.get(String(title ?? "").trim()) ?? null;
}

/** True when `designation` is a real chart position (picker guarantees this). */
export function isOrgTitle(designation: string | null | undefined): boolean {
  return !!orgPosition(designation ?? "");
}

/** "Reports to MD · Leads: Team Lead, Telecaller, Field Staff" — the one-line
 *  responsibility summary HR reads to know who owns what. */
export function responsibilityLine(p: OrgPosition): string {
  return p.leads.length > 0
    ? `Reports to ${p.reportsTo} · Leads: ${p.leads.join(", ")}`
    : `Reports to ${p.reportsTo} · Individual contributor`;
}

/**
 * Chart title → login/dashboard position keys (taxonomy lives in
 * `founder-os_backend/src/modules/auth/positions.ts`, suggested scopes only).
 * Empty = the title carries no dashboard position: MIS is an org label only
 * (founder decision 2026-11-12, the `mis` scope/role is retired and
 * grants nothing).
 */
export const LOGIN_POSITIONS_BY_TITLE: Record<string, string[]> = {
  "Sales Head": ["sales-head"],
  "Team Lead": ["team-lead"],
  Telecaller: ["telecaller"],
  "Field Staff": ["field-staff"],
  "Digital Marketing - Senior": ["dm-senior"],
  "Digital Marketing - Junior": ["dm-junior"],
  // Both accountant levels share ONE login position — the taxonomy has a single
  // `accountant` key (no senior/junior split).
  "Senior Accountant": ["accountant"],
  "Junior Accountant": ["accountant"],
  Procurement: ["procurement"],
  HR: ["hr"],
  MIS: [],
};

export function loginPositionsFor(title: string): string[] {
  return LOGIN_POSITIONS_BY_TITLE[String(title ?? "").trim()] ?? [];
}

/** Positions whose login taxonomy has no dashboard equivalent (display-only). */
export function isOrgLabelOnly(title: string): boolean {
  return loginPositionsFor(title).length === 0;
}

/**
 * Legacy free-text designation → chart title, for the exact strings already in
 * the HR master (prod snapshot 2026-11-13). Conservative on purpose: a wrong
 * guess would put a person in someone else's position, so only unambiguous
 * strings appear here, and the picker only ever OFFERS the match (HR clicks).
 *
 * Deliberately absent: "Sale Coordinator" / "Sales Co-ordinator" (could be
 * Telecaller or MIS — founder decision pending) and anything not in the master.
 */
export const LEGACY_TITLE_SUGGESTIONS: Record<string, string> = {
  "Area Sales Manager (Field)": "Field Staff",
  "Head (Sales)": "Sales Head",
  "Head - Digital Marketing": "Digital Marketing - Senior",
  "Digital Marketing Manager": "Digital Marketing - Senior",
  "HR Manager": "HR",
  "Purchase Manager": "Procurement",
  "Jr. Accountant": "Junior Accountant",
  "Sr. Telecaller": "Telecaller",
};

/** Normalize a legacy designation for lookup (case/space/dot tolerant). */
function legacyKey(designation: string): string {
  return String(designation ?? "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

const SUGGESTION_BY_KEY = new Map(
  Object.entries(LEGACY_TITLE_SUGGESTIONS).map(([from, to]) => [legacyKey(from), to]),
);

/** The chart position a legacy free-text designation most likely means, or
 *  null when it is ambiguous/unknown (HR picks by hand — never guessed). */
export function suggestOrgTitle(designation: string | null | undefined): string | null {
  const key = legacyKey(designation ?? "");
  if (!key || isOrgTitle(key)) return null;
  const target = SUGGESTION_BY_KEY.get(key);
  if (!target || !isOrgTitle(target)) return null;
  return target;
}

export interface OrgTreeNode {
  title: string;
  /** null on the synthetic top node (the top position is not a chart row). */
  department: string | null;
  reportsTo: string | null;
  leads: string[];
  isHead: boolean;
  isTop: boolean;
  children: OrgTreeNode[];
}

/**
 * Build the reporting tree from `reports_to` (the authoritative edge — `leads`
 * is the display summary). Positions nobody leads (a chart edit mistake) are
 * appended at the top level instead of vanishing, so HR never sees a hole.
 */
export function buildOrgTree(): OrgTreeNode {
  const nodes = new Map<string, OrgTreeNode>(
    ORG_POSITIONS.map((p) => [
      p.title,
      {
        title: p.title,
        department: p.department,
        reportsTo: p.reportsTo,
        leads: [...p.leads],
        isHead: p.isHead,
        isTop: false,
        children: [],
      },
    ]),
  );

  const root: OrgTreeNode = {
    title: ORG_TOP_POSITION,
    department: null,
    reportsTo: null,
    leads: [],
    isHead: true,
    isTop: true,
    children: [],
  };

  const orphaned: OrgTreeNode[] = [];
  for (const p of ORG_POSITIONS) {
    const node = nodes.get(p.title)!;
    const parent = nodes.get(p.reportsTo);
    if (parent) parent.children.push(node);
    else if (p.reportsTo === ORG_TOP_POSITION) root.children.push(node);
    else orphaned.push(node);
  }
  root.children.push(...orphaned);
  root.leads = root.children.map((c) => c.title);
  return root;
}
