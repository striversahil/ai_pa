// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.


export interface PaymentAttachment {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface PaymentDueRow {
  templateId: string;
  title: string;
  biller: string;
  identifier: string;
  category: string;
  amount: number | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  /** Credit cards: 'fixed' (due on dueDay) or 'after_statement' (due =
   *  statementDay + graceDays). */
  dueMode?: string;
  /** Credit cards on after_statement: days after the statement the bill is due. */
  graceDays?: number | null;
  remindDays: number[];
  /** Credit cards: statement day of month; null for every other category. */
  statementDay?: number | null;
  /** Date the statement pricing this cycle lands (amount is known from here). */
  statementDate?: string | null;
  logId: string | null;
  dueDate: string;
  status: string;
  paidAmount: number | null;
  paidRef: string | null;
  remark: string | null;
  doneBy: string | null;
  updatedAt: string | null;
  bucket: "overdue" | "week" | "upcoming" | "paid";
  daysOverdue: number;
  daysUntil: number;
  remind: boolean;
  attachments?: PaymentAttachment[];
}

export interface PaymentSummary {
  unpaidTotal: number;
  unpaidCount: number;
  overdueCount: number;
  overdueTotal: number;
  weekCount: number;
  weekTotal: number;
  paidCount: number;
  paidTotal: number;
}

export type MainTab = "due" | "history";

export type Bucket = "all" | "overdue" | "week" | "upcoming";

export interface BillGroup {
  templateId: string;
  title: string;
  biller: string;
  identifier: string;
  category: string;
  amount: number | null;
  frequency: string;
  dueDay: number | null;
  dueMonth: number | null;
  dueMode: string;
  graceDays: number | null;
  statementDay?: number | null;
  remindDays: number[];
  sample: PaymentDueRow;
  cycles: PaymentDueRow[];
  worstOverdue: number;
  earliestDue: string;
  urgency: number; // 0 overdue · 1 week · 2 upcoming
}
