// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.


// ── Identity scoping (lane enforcement) ─────────────────────────────────────
// Non-MIS viewers only ever receive their own lane (role + shared). Mirrors
// the telecalling selfAgentId pattern: the frontend ALSO hides other tabs,
// but the payload itself is scoped so tab-switching can't leak lanes.
export interface LaneScope {
  selfId: string;
  selfRole: string;
  selfName: string;
}

// ── Payment dues (kind='payment' templates — the Payment dues tab) ───────────
// A payment template is a recurring bill (credit card, recharge, …). Each
// billing cycle is a log instance; marking paid = done + amount + reference.
// Structure: `dues` = EVERY unresolved cycle (all overdue, any age + due next
// 60d + one projected cycle per bill) · `history` = ALL paid cycles, newest
// first. Buckets on dues rows: overdue (past due, unpaid) · week (due within
// 7 days, with 7/3/1-day remind flags) · upcoming.
export type PaymentBucket = 'overdue' | 'week' | 'upcoming' | 'paid';

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
  remindDays: number[];
  /** Credit cards: statement day of month; null for every other category. */
  statementDay: number | null;
  /** Credit cards: 'fixed' (due on dueDay) or 'after_statement' (due =
   *  statementDay + graceDays). */
  dueMode: string;
  /** Credit cards on after_statement: days after the statement the bill is due. */
  graceDays: number | null;
  /** Date the statement that prices THIS cycle lands (null when no statement day). */
  statementDate: string | null;
  logId: string | null;
  dueDate: string;
  status: string;
  paidAmount: number | null;
  paidRef: string | null;
  remark: string | null;
  doneBy: string | null;
  updatedAt: string | null;
  bucket: PaymentBucket;
  daysOverdue: number;
  daysUntil: number;
  remind: boolean;
  attachments: PaymentAttachment[];
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
