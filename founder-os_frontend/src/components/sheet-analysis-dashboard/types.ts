// Extracted verbatim from SheetAnalysisDashboard.tsx by scripts/refactor/split-module.mjs.
// SheetAnalysisDashboard.tsx re-exports everything public here, so existing imports keep working.


export type Kpi = {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "indigo" | "emerald" | "rose" | "amber" | "violet";
};

export type Warning = {
  sNo: string;
  company: string;
  field: string;
  issue: string;
  severity: "critical" | "warning";
};

export type Table = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
};

export type Insight = {
  name: string;
  role: string;
  badge: string;
  desc: string;
};

export type SheetData = {
  meta: {
    analysis: string;
    title: string;
    spreadsheetUrl: string;
    range: string;
    rowsRead: number;
    configured: boolean;
    generatedAt: string;
    error?: string;
  };
  kpis?: Kpi[];
  warnings?: Warning[];
  insights?: { good: Insight[]; inconsistent: Insight[] };
  tables?: Table[];
};
