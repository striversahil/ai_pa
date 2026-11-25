// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { PaymentDueRow, PaymentSummary } from "@/components/accounts/PaymentDues";
import { PATTERNS } from "./helpers";

export interface FileItem {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface TaskItem {
  templateId: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  ruleType?: string | null;
  dueLabel?: string | null;
  isShared?: boolean;
  employeeRaw?: string | null;
  logId: string | null;
  /** 'main', or the lane copy of a shared task ('senior' | 'junior'). */
  slot?: string;
  status: string;
  remark: string | null;
  doneBy: string | null;
  timeSpentMin?: number | null;
  dueDate?: string | null;
  accountantId: string | null;
  accountantName: string | null;
  updatedAt?: string | null;
  attachments?: FileItem[];
  missed?: string[];
  overdue: boolean;
  incomplete?: boolean;
  daysOverdue?: number | null;
  daysIncomplete?: number | null;
}

export interface UnscheduledItem {
  templateId: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  ruleType: string | null;
  note: string | null;
  dueLabel: string | null;
  isShared?: boolean;
  employeeRaw?: string | null;
}

export interface RosterRow {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  order: number;
  deleted?: boolean;
}

export interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  isShared?: boolean;
  employeeRaw?: string | null;
  department?: string | null;
  sheetStatus?: string | null;
  active: boolean;
  order: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  doneToday: number;
  doneWeek: number;
  doneMonth: number;
  openLaneToday: number;
}

export interface FreqStat {
  frequency: string;
  total: number;
  done: number;
  pending: number;
  inprogress: number;
  overdue: number;
  incomplete?: number;
  completionPct: number;
}

export interface TeamData {
  date: string;
  weekStart: string;
  monthStart: string;
  doneToday: number;
  openToday: number;
  inProgressToday?: number;
  overdueToday: number;
  incompleteToday?: number;
  completionPct: number;
  weekDone: number;
  monthDone: number;
  members: TeamMember[];
}

export interface DashData {
  meta: { date: string; today: string; total: number; open: number; done: number; overdue: number; incomplete?: number; computeV?: string; generatedAt: string; isAdmin?: boolean; self?: { id: string; name: string; role: string } | null };
  roster: RosterRow[];
  senior: TaskItem[];
  junior: TaskItem[];
  items: TaskItem[];
  overdueList?: TaskItem[];
  history?: TaskItem[];
  freqStats?: FreqStat[];
  unscheduled?: UnscheduledItem[];
  payments?: PaymentDueRow[];
  paymentHistory?: PaymentDueRow[];
  paymentSummary?: PaymentSummary;
  team?: TeamData | null;
  /** One row per task × lane (migration 0166): the year's counts for a task.
   *  Expand a row → GET /api/accounts/tasks/:id/thread. */
  threads?: ThreadRow[];
}

// ── Task threads (one task = a year of entries, not a card per day) ─────────
export interface ThreadCounts {
  due: number;
  done: number;
  notDone: number;
  missed: number;
  late: number;
  pending: number;
  /** Engine-written days nobody has explained yet — what an accountant clears. */
  unresolved: number;
}

export interface ThreadSlot {
  slot: string;
  counts: ThreadCounts;
  completionPct: number;
}

export interface ThreadRow {
  templateId: string;
  title: string;
  shortTitle: string | null;
  dueTime: string | null;
  frequency: string;
  ownerRole: string;
  isShared: boolean;
  rawText: string | null;
  slots: ThreadSlot[];
}

export type ThreadBucket = "done" | "not_done" | "late" | "missed" | "pending";

export interface ThreadEntry {
  logId: string;
  dueDate: string;
  bucket: ThreadBucket;
  status: string;
  entryKind: string;
  /** "Task not done on <date>" — engine text for a missed/late day. */
  systemText: string | null;
  remark: string | null;
  lateNote: string | null;
  lateNoteBy: string | null;
  lateNoteAt: string | null;
  doneBy: string | null;
  timeSpentMin: number | null;
  updatedAt: string | null;
  attachments: FileItem[];
}

export interface ThreadDetail {
  template: { id: string; title: string; shortTitle: string | null; dueTime: string | null; frequency: string; ownerRole: string; isShared: boolean; rawText: string | null };
  slot: string;
  from: string;
  to: string;
  counts: ThreadCounts;
  completionPct: number;
  entries: ThreadEntry[];
}

export type AccountsView = "dashboard" | "tasks" | "senior" | "junior" | "my" | "dues" | "controller";

export interface LaneStat {
  done: number;
  total: number;
  not: number;
}

export type PatternKey = (typeof PATTERNS)[number]["key"];
