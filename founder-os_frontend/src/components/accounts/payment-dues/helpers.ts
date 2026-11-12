// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.
import type { Bucket, PaymentDueRow, BillGroup } from "./types";

export const PAYMENT_CATEGORIES = [
  "Credit Card", "Mobile Recharge", "Utilities", "Loan / EMI", "Insurance",
  "Rent", "Software / Subscription", "Tax / Compliance", "Other",
];

// Per-category label + placeholder for the optional bill number (card number,
// mobile number, account/policy no. …). Falls back to a generic reference.
export function identifierMeta(category: string): { label: string; placeholder: string } {
  switch (category) {
    case "Credit Card": return { label: "Card number (optional)", placeholder: "e.g. ending 4521" };
    case "Mobile Recharge": return { label: "Mobile number (optional)", placeholder: "e.g. 98XXXXXXXX" };
    case "Loan / EMI": return { label: "Loan / account no. (optional)", placeholder: "e.g. loan or account no." };
    case "Insurance": return { label: "Policy no. (optional)", placeholder: "e.g. policy number" };
    case "Rent": return { label: "Property / flat (optional)", placeholder: "e.g. flat or property ref" };
    case "Utilities": return { label: "Consumer / account no. (optional)", placeholder: "e.g. consumer number" };
    case "Software / Subscription": return { label: "Account / license (optional)", placeholder: "e.g. account or license id" };
    case "Tax / Compliance": return { label: "PAN / GSTIN (optional)", placeholder: "e.g. PAN or GSTIN" };
    default: return { label: "Reference no. (optional)", placeholder: "e.g. account or ref no." };
  }
}

export const BUCKETS: { key: Bucket; label: string; icon: string }[] = [
  { key: "all", label: "All due", icon: "🧾" },
  { key: "overdue", label: "Overdue", icon: "🔴" },
  { key: "week", label: "Due in 7 days", icon: "🟡" },
  { key: "upcoming", label: "Upcoming", icon: "⚪" },
];

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Human schedule label per repeat choice (matches the engine: weekly reads
// dueDay as weekday 0–6 Sun=0, daily runs Mon–Sat, yearly reads dueMonth).
// Credit cards on after_statement read "stmt S + Nd" instead of a fixed day.
export function schedLabel(
  frequency: string, dueDay: number | null, dueMonth: number | null,
  dueMode?: string | null, graceDays?: number | null, statementDay?: number | null,
): string {
  if (frequency === "daily") return "every working day";
  if (frequency === "weekly") {
    const wd = dueDay ?? 4;
    return `every ${WEEKDAY_SHORT[wd] ?? "Thu"}`;
  }
  if (frequency === "monthly") {
    if (dueMode === "after_statement" && statementDay && graceDays) {
      return `stmt ${statementDay} + ${graceDays}d`;
    }
    return dueDay ? `day ${dueDay}` : "monthly";
  }
  if (frequency === "quarterly") return dueDay ? `day ${dueDay} of quarter-start month` : "quarterly";
  if (frequency === "yearly") {
    const m = dueMonth != null && dueMonth >= 1 && dueMonth <= 12 ? MONTH_SHORT[dueMonth - 1] : null;
    return m && dueDay ? `${m} ${dueDay}` : "yearly";
  }
  return frequency;
}

export const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

export async function postJson(url: string, method: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = String(j.error);
    } catch {
      try { msg = (await res.text()).slice(0, 300) || msg; } catch { /* ignore */ }
    }
    throw new Error(msg);
  }
  return res.json().catch(() => ({}));
}

export function groupBills(dues: PaymentDueRow[]): BillGroup[] {
  const byId = new Map<string, PaymentDueRow[]>();
  for (const d of dues) {
    if (!byId.has(d.templateId)) byId.set(d.templateId, []);
    byId.get(d.templateId)!.push(d);
  }
  const groups: BillGroup[] = [];
  for (const [templateId, cycles] of byId) {
    const sorted = [...cycles].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const s = sorted[0];
    const worstOverdue = Math.max(0, ...sorted.map((c) => c.daysOverdue));
    const urgency = sorted.some((c) => c.bucket === "overdue") ? 0 : sorted.some((c) => c.bucket === "week") ? 1 : 2;
    groups.push({
      templateId, title: s.title, biller: s.biller, identifier: s.identifier ?? "", category: s.category,
      amount: s.amount, frequency: s.frequency, dueDay: s.dueDay ?? null, dueMonth: s.dueMonth ?? null,
      dueMode: (s as any).dueMode === "after_statement" ? "after_statement" : "fixed",
      graceDays: (s as any).graceDays ?? null, statementDay: (s as any).statementDay ?? null,
      remindDays: s.remindDays,
      sample: s, cycles: sorted, worstOverdue,
      earliestDue: sorted[0]?.dueDate ?? "", urgency,
    });
  }
  return groups.sort((a, b) => a.urgency - b.urgency || b.worstOverdue - a.worstOverdue || a.earliestDue.localeCompare(b.earliestDue));
}
