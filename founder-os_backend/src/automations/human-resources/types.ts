export const TASK_STATUSES = ['pending', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const EXPENSE_TYPES = ['fixed', 'variable', 'field_staff'] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const PAYMENT_MODES = ['cash', 'upi', 'bank', 'card', 'other'] as const;

export const INVENTORY_TXN_TYPES = ['opening', 'purchase', 'consumption', 'adjustment'] as const;
export type InventoryTxnType = (typeof INVENTORY_TXN_TYPES)[number];

export const INVENTORY_MOVE_TYPES = ['purchase', 'consumption', 'adjustment'] as const;
export type InventoryMoveType = (typeof INVENTORY_MOVE_TYPES)[number];

export interface HrSelf {
  selfId: string;
  selfName: string;
  designation: string | null;
}

export interface HrScope {
  scope: HrSelf | null;
  isAdmin: boolean;
}

export interface TaskInput {
  title: string;
  description: string | null;
  assignedToId: string | null;
  dueDate: string;
  dueTime: string | null;
  priority: TaskPriority;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  assignedToId?: string | null;
  dueDate?: string;
  dueTime?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  remark?: string | null;
}

export interface ExpenseInput {
  title: string;
  expenseType: ExpenseType;
  category: string | null;
  amount: number;
  expenseDate: string;
  expenseMonth: string;
  paymentMode: string | null;
  notes: string | null;
}

export interface MemberInput {
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  order: number;
}


export interface InventoryItemInput {
  name: string;
  category: string | null;
  unit: string;
  reorderLevel: number;
  unitCost: number | null;
  notes: string | null;
  order: number;
  openingQty: number;
  openingDate: string;
}

export interface InventoryItemPatch {
  name?: string;
  category?: string | null;
  unit?: string;
  reorderLevel?: number;
  unitCost?: number | null;
  notes?: string | null;
  order?: number;
}

export interface InventoryTxnInput {
  itemId: string;
  txnType: InventoryMoveType;
  quantity: number;
  txnDate: string;
  notes: string | null;
  logExpense: boolean;
  expenseAmount: number | null;
  expenseType: ExpenseType;
  expenseCategory: string | null;
  paymentMode: string | null;
}

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent', 'holiday'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const COMPONENT_TYPES = ['earning', 'deduction'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const COMPONENT_CALC_TYPES = ['fixed', 'percent_basic', 'percent_gross', 'formula', 'balance'] as const;
export type ComponentCalcType = (typeof COMPONENT_CALC_TYPES)[number];

export const SALARY_INPUT_MODES = ['gross', 'basic'] as const;
export type SalaryInputMode = (typeof SALARY_INPUT_MODES)[number];

export const PAYROLL_STATUSES = ['draft', 'finalized', 'paid'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export interface EmployeeInput {
  name: string;
  employeeCode: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
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
  order: number;
}

export type EmployeePatch = Partial<EmployeeInput> & { deleted?: boolean };

export interface SalaryComponentInput {
  name: string;
  componentType: ComponentType;
  calcType: ComponentCalcType;
  value: number;
  formula: string | null;
  code: string | null;
  cap: number | null;
  floor: number | null;
  isBasic: boolean;
  order: number;
}

export interface SalaryTemplateInput {
  name: string;
  description: string | null;
  inputMode: SalaryInputMode;
  isDefault: boolean;
  components: SalaryComponentInput[];
}

export interface SalaryPlanInput {
  templateId: string;
  inputAmount: number;
  components?: SalaryComponentInput[];
}

export interface AttendanceRowInput {
  memberId: string;
  date: string;
  inTime: string | null;
  outTime: string | null;
  status: AttendanceStatus;
  notes: string | null;
}

export interface LeaveInput {
  memberId: string;
  leaveType: LeaveType;
  paid: boolean;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export interface HolidayInput {
  date: string;
  name: string;
}

export interface PayrollLine {
  name: string;
  amount: number;
}

export interface PayrollLinesPatch {
  earnings?: PayrollLine[];
  deductions?: PayrollLine[];
  notes?: string | null;
}
