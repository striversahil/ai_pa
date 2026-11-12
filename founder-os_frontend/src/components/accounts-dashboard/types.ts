// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { PaymentDueRow, PaymentSummary } from "@/components/accounts/PaymentDues";
import type { CashEntry, CashSummary } from "@/components/accounts/DispatchCash";
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
  incompleteList?: TaskItem[];
  history?: TaskItem[];
  freqStats?: FreqStat[];
  unscheduled?: UnscheduledItem[];
  payments?: PaymentDueRow[];
  paymentHistory?: PaymentDueRow[];
  paymentSummary?: PaymentSummary;
  cashEntries?: CashEntry[];
  cashSummary?: CashSummary;
  team?: TeamData | null;
}

export type AccountsView = "dashboard" | "tasks" | "incomplete" | "history" | "senior" | "junior" | "my" | "dues" | "cash" | "controller";

export interface LaneStat {
  done: number;
  total: number;
  not: number;
}

export type PatternKey = (typeof PATTERNS)[number]["key"];
