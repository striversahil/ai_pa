// Extracted verbatim from ZohoEstimates.tsx by scripts/refactor/split-module.mjs.
// ZohoEstimates.tsx re-exports everything public here, so existing imports keep working.
import type { KpiCardConfig } from "../zoho/KpiCards";

export const KPI_FILTERS: Omit<KpiCardConfig, "count">[] = [
  { field: "satisfactory", label: "Satisfactory", negLabel: "Unsatisfactory", accent: "emerald", polarity: "good" },
  { field: "notAnswering", label: "Not Answering", negLabel: "Answering", accent: "rose", polarity: "bad" },
  { field: "high_value", label: "High Value", negLabel: "Low Value", accent: "amber", polarity: "good" },
  { field: "value_above_50k", label: "Above ₹50k", negLabel: "₹50k & Below", accent: "sky", polarity: "good" },
  { field: "movingSlow", label: "Moving Slow", negLabel: "Moving Fast", accent: "orange", polarity: "bad" },
  { field: "underDiscussion", label: "Under Discussion", negLabel: "Not Discussed", accent: "indigo", polarity: "bad" },
  { field: "confirm", label: "Confirm Expected", negLabel: "No Confirm", accent: "violet", polarity: "good" },
  { field: "last_comment_within_5h", label: "Comment ≤5h", negLabel: "Comment >5h", accent: "cyan", polarity: "good" },
  { field: "last_comment_within_10h", label: "Comment ≤10h", negLabel: "Comment >10h", accent: "blue", polarity: "good" },
  { field: "last_comment_older_5h", label: "Comment >5h", negLabel: "Comment ≤5h", accent: "teal", polarity: "bad" },
];
