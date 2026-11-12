// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.
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

export interface MetricField {
  key: string;
  label: string;
  type: string;
  options?: string[];
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
  metricsSchema?: MetricField[] | null;
  metricsJson?: Record<string, any> | null;
  logId: string | null;
  status: string;
  remark: string | null;
  doneBy: string | null;
  timeSpentMin?: number | null;
  dueDate?: string | null;
  accountantId: string | null;
  accountantName: string | null;
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
  team?: unknown;
  metaAdsCampaign?: { logId: string; dueDate: string; category: string | null; amountSpent: number | null; fromDate: string; toDate: string; durationDays: number | null; inquiries: number | null; leads: number | null } | null;
}

export type DigitalMarketingView = "dashboard" | "tasks" | "ads" | "open" | "controller";

export type PatternKey = (typeof PATTERNS)[number]["key"];
