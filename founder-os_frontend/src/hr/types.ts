// Frontend mirror of founder-os_backend/src/automations/human-resources/types.ts.
// Keep field names and enum values identical to the backend payload.

export type TaskStatus = "pending" | "in_progress" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type ExpenseType = "fixed" | "variable" | "field_staff";
export type PaymentMode = "cash" | "upi" | "bank" | "card" | "other";

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

export const ATTENDANCE_STATUSES = ["present", "half_day", "absent", "holiday"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  holiday: "Holiday",
};

export const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  casual: "Casual",
  sick: "Sick",
  earned: "Earned",
  unpaid: "Unpaid",
  other: "Other",
};

export const COMPONENT_TYPES = ["earning", "deduction"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export const COMPONENT_CALC_TYPES = ["fixed", "percent_basic", "percent_gross", "formula", "balance"] as const;
export type ComponentCalcType = (typeof COMPONENT_CALC_TYPES)[number];
export const SALARY_INPUT_MODES = ["gross", "basic"] as const;
export type SalaryInputMode = (typeof SALARY_INPUT_MODES)[number];

export type PayrollStatus = "draft" | "finalized" | "paid";

export const TASK_STATUSES: TaskStatus[] = ["pending", "in_progress", "done"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];
export const EXPENSE_TYPES: ExpenseType[] = ["fixed", "variable", "field_staff"];
export const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "bank", "card", "other"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const EXPENSE_TYPE_LABEL: Record<ExpenseType, string> = {
  fixed: "Fixed",
  variable: "Variable",
  field_staff: "Field Staff",
};

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank",
  card: "Card",
  other: "Other",
};

export interface HrSelf {
  selfId: string;
  selfName: string;
  designation: string | null;
}

export interface HrMember {
  id: string;
  name: string;
  designation: string | null;
  order: number;
  department?: string | null;
  employeeCode?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface HrSalaryComponent {
  id?: string;
  name: string;
  componentType: ComponentType;
  calcType: ComponentCalcType;
  value: number;
  formula?: string | null;
  code?: string | null;
  cap?: number | null;
  floor?: number | null;
  templateId?: string | null;
  deleted?: boolean;
  isBasic: boolean;
  order?: number;
}

export interface HrSalaryTemplateComponent extends HrSalaryComponent {
  id: string;
}

export interface HrSalaryTemplate {
  id: string;
  name: string;
  description: string | null;
  inputMode: SalaryInputMode;
  isDefault: boolean;
  employeeCount: number;
  components: HrSalaryTemplateComponent[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HrSalaryPreview {
  earnings: { name: string; code: string | null; amount: number }[];
  deductions: { name: string; code: string | null; amount: number }[];
  basic: number;
  gross: number;
  deductionTotal: number;
  netPay: number;
  inputMode: SalaryInputMode;
  inputAmount: number;
  targetGross: number | null;
}

export interface HrEmployee extends HrMember {
  employeeCode: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  photoUrl: string | null;
  joiningDate: string | null;
  exitDate: string | null;
  employmentType: EmploymentType;
  active: boolean;
  dateOfBirth: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  pan: string | null;
  aadhaarLast4: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  notes: string | null;
  deleted: boolean;
  createdAt: string | null;
  grossSalary: number;
  salaryTemplateId: string | null;
  salaryInputMode: SalaryInputMode | null;
  salaryInputAmount: number | null;
  salaryTemplateAppliedAt: string | null;
  salaryTemplate: { id: string; name: string; inputMode: SalaryInputMode; updatedAt: string | null } | null;
  salaryTemplateOutdated: boolean;
  basicSalary: number;
  salaryComponents: HrSalaryComponent[];
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
}

export interface HrAttendanceRecord {
  id: string;
  memberId: string;
  date: string;
  inTime: string | null;
  outTime: string | null;
  status: AttendanceStatus;
  notes: string | null;
  updatedAt: string | null;
}

export interface HrAttendanceRow {
  member: HrMember & { active: boolean };
  attendance: HrAttendanceRecord | null;
  leave: { id: string; leaveType: LeaveType; paid: boolean; startDate: string; endDate: string; reason: string | null } | null;
  holiday: { id: string; name: string } | null;
}

export interface HrAttendanceDay {
  date: string;
  holiday: { id: string; name: string } | null;
  rows: HrAttendanceRow[];
  summary: { total: number; marked: number; present: number; halfDay: number; absent: number; leave: number };
}

export interface HrAttendanceSummaryRow {
  member: HrMember & { active: boolean };
  present: number;
  halfDay: number;
  absent: number;
  holiday: number;
  leaveDays: number;
  hours: number;
  marked: number;
}

export interface HrLeave {
  id: string;
  memberId: string;
  memberName: string | null;
  leaveType: LeaveType;
  paid: boolean;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  createdAt: string | null;
}

export interface HrHoliday {
  id: string;
  date: string;
  name: string;
}

export interface HrPayrollLine {
  name: string;
  amount: number;
}

export interface HrSalarySlip {
  id: string;
  memberId: string;
  month: string;
  status: PayrollStatus;
  employee: { id?: string; name: string; employeeCode?: string | null; designation?: string | null; department?: string | null; joiningDate?: string | null; photoUrl?: string | null };
  employeeName: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  workingDays: number;
  eligibleDays: number;
  payableDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayDays: number;
  unmarkedDays: number;
  perDay: number;
  monthlyGross: number;
  earnedGross: number;
  absenceDeduction: number;
  componentDeductions: number;
  manualDeductions: number;
  totalDeductions: number;
  netPay: number;
  earnings: HrPayrollLine[];
  deductions: HrPayrollLine[];
  fullMonthlyGross: number;
  notes: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HrPayrollEmployee {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  active: boolean;
  joiningDate: string | null;
  exitDate: string | null;
  hasSalary: boolean;
  grossSalary: number;
}

export interface HrPayrollData {
  month: string;
  slips: HrSalarySlip[];
  employees: HrPayrollEmployee[];
  summary: {
    employeeCount: number; slipCount: number; draftCount: number;
    finalizedCount: number; paidCount: number; totalNet: number; totalDeductions: number;
  };
}

export interface HrTask {
  id: string;
  title: string;
  description: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  assignedToDesignation: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  remark: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  overdue: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HrExpense {
  id: string;
  title: string;
  expenseType: ExpenseType;
  category: string | null;
  amount: number;
  expenseDate: string | null;
  expenseMonth: string | null;
  paymentMode: PaymentMode | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HrExpenseSummary {
  fixedTotal: number;
  variableTotal: number;
  fieldStaffTotal: number;
  total: number;
  fixedCount: number;
  variableCount: number;
  fieldStaffCount: number;
}

export type InventoryTxnType = "opening" | "purchase" | "consumption" | "adjustment";
export type InventoryMoveType = "purchase" | "consumption" | "adjustment";

export const INVENTORY_MOVE_LABEL: Record<InventoryMoveType, string> = {
  purchase: "Stock in",
  consumption: "Use",
  adjustment: "Adjust",
};

export const INVENTORY_TXN_LABEL: Record<InventoryTxnType, string> = {
  opening: "Opening",
  purchase: "Stock in",
  consumption: "Used",
  adjustment: "Adjustment",
};

export interface HrInventoryItem {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  reorderLevel: number;
  unitCost: number | null;
  notes: string | null;
  order: number;
  currentQty: number;
  purchasedThisMonth: number;
  consumedThisMonth: number;
  movementCount: number;
  lastMovementAt: string | null;
  stockValue: number | null;
  lowStock: boolean;
  outOfStock: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HrInventoryTxn {
  id: string;
  itemId: string;
  txnType: InventoryTxnType;
  quantity: number;
  txnDate: string | null;
  txnMonth: string | null;
  notes: string | null;
  expenseId: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface HrInventorySummary {
  itemCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  movementCount: number;
  stockValue: number;
}

export interface HrInventorySnapshot {
  month: string;
  items: HrInventoryItem[];
  summary: HrInventorySummary;
}

// ── Hiring kit (any number of JD / SOP PDFs per position) ───────────────────
export const HIRING_DOC_KINDS = ["jd", "sop"] as const;
export type HiringDocKind = (typeof HIRING_DOC_KINDS)[number];
export const HIRING_DOC_LABEL: Record<HiringDocKind, string> = {
  jd: "Job description",
  sop: "SOP",
};

export interface HrPositionDoc {
  id: string;
  kind: HiringDocKind;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** Auth-gated inline PDF URL (`/api/human-resources/position-docs/:id/file`). */
  url: string;
}

export interface HrHiringPosition {
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  docs: Record<HiringDocKind, HrPositionDoc[]>;
}

export interface HrDashboardData {
  meta: {
    today: string;
    month: string;
    self: HrSelf | null;
    isAdmin: boolean;
    canManage: boolean;
    unmatched: boolean;
    counts: { overdue: number; today: number; upcoming: number; open: number; completed: number };
  };
  roster: HrMember[];
  employees: { activeCount: number; inactiveCount: number; totalCount: number };
  tasks: {
    overdue: HrTask[];
    today: HrTask[];
    upcoming: HrTask[];
    completed: HrTask[];
  };
  expenses: {
    month: string;
    fixed: HrExpense[];
    variable: HrExpense[];
    fieldStaff: HrExpense[];
    summary: HrExpenseSummary;
  };
  inventory: HrInventorySnapshot;
}
