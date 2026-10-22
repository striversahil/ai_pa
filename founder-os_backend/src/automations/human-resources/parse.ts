import { HrError } from './errors';
import {
  EXPENSE_TYPES, INVENTORY_MOVE_TYPES, PAYMENT_MODES, TASK_PRIORITIES, TASK_STATUSES,
  type ExpenseInput, type InventoryItemInput, type InventoryItemPatch, type InventoryTxnInput,
  type MemberInput, type TaskInput, type TaskPatch,
} from './types';

export function istDateStr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).slice(0, 10);
}

export function istMonthStr(d = new Date()): string {
  return istDateStr(d).slice(0, 7);
}

export function istTimeStr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).slice(0, 5);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12) + n * 86400000);
  return dt.toISOString().slice(0, 10);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidMonth(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [y, m] = value.split('-').map(Number);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
}

export function normalizeMonth(value: unknown, fallback = istMonthStr()): string {
  return isValidMonth(value) ? value : fallback;
}

export function normalizeTime(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!m) throw new HrError('dueTime must be HH:mm');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new HrError('dueTime must be a valid 24-hour time');
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

export function nullableText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = text(value, max);
  return s ? s : null;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const v = String(value ?? '').trim();
  if (!allowed.includes(v as T)) throw new HrError(`${field} must be ${allowed.join('|')}`);
  return v as T;
}

export function positiveAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) {
    throw new HrError('amount must be a number greater than 0');
  }
  return Math.round(n * 100) / 100;
}

export function cleanTaskCreate(input: Record<string, any>): TaskInput {
  const title = text(input.title, 200);
  if (!title) throw new HrError('title is required');
  const dueDate = String(input.dueDate ?? '').slice(0, 10);
  if (!isValidDate(dueDate)) throw new HrError('dueDate must be YYYY-MM-DD');
  return {
    title,
    description: nullableText(input.description, 2000),
    assignedToId: input.assignedToId ? text(input.assignedToId, 100) : null,
    dueDate,
    dueTime: normalizeTime(input.dueTime),
    priority: oneOf(input.priority ?? 'normal', TASK_PRIORITIES, 'priority'),
  };
}

export function cleanTaskPatch(input: Record<string, any>): TaskPatch {
  const out: TaskPatch = {};
  if (input.title !== undefined) {
    const title = text(input.title, 200);
    if (!title) throw new HrError('title cannot be empty');
    out.title = title;
  }
  if (input.description !== undefined) out.description = nullableText(input.description, 2000);
  if (input.assignedToId !== undefined) out.assignedToId = input.assignedToId ? text(input.assignedToId, 100) : null;
  if (input.dueDate !== undefined) {
    const dueDate = String(input.dueDate ?? '').slice(0, 10);
    if (!isValidDate(dueDate)) throw new HrError('dueDate must be YYYY-MM-DD');
    out.dueDate = dueDate;
  }
  if (input.dueTime !== undefined) out.dueTime = normalizeTime(input.dueTime);
  if (input.priority !== undefined) out.priority = oneOf(input.priority, TASK_PRIORITIES, 'priority');
  if (input.status !== undefined) out.status = oneOf(input.status, TASK_STATUSES, 'status');
  if (input.remark !== undefined) out.remark = nullableText(input.remark, 2000);
  if (Object.keys(out).length === 0) throw new HrError('nothing to update');
  return out;
}

export function cleanExpenseCreate(input: Record<string, any>): ExpenseInput {
  const title = text(input.title, 200);
  if (!title) throw new HrError('title is required');
  const expenseType = oneOf(input.expenseType, EXPENSE_TYPES, 'expenseType');
  const expenseDate = String(input.expenseDate ?? '').slice(0, 10);
  if (!isValidDate(expenseDate)) throw new HrError('expenseDate must be YYYY-MM-DD');
  const paymentMode = input.paymentMode === null || input.paymentMode === undefined || input.paymentMode === ''
    ? null
    : oneOf(input.paymentMode, PAYMENT_MODES, 'paymentMode');
  return {
    title,
    expenseType,
    category: nullableText(input.category, 100),
    amount: positiveAmount(input.amount),
    expenseDate,
    expenseMonth: expenseDate.slice(0, 7),
    paymentMode,
    notes: nullableText(input.notes, 1000),
  };
}

export function cleanExpensePatch(input: Record<string, any>): Partial<ExpenseInput> {
  const out: Partial<ExpenseInput> = {};
  if (input.title !== undefined) {
    const title = text(input.title, 200);
    if (!title) throw new HrError('title cannot be empty');
    out.title = title;
  }
  if (input.expenseType !== undefined) out.expenseType = oneOf(input.expenseType, EXPENSE_TYPES, 'expenseType');
  if (input.category !== undefined) out.category = nullableText(input.category, 100);
  if (input.amount !== undefined) out.amount = positiveAmount(input.amount);
  if (input.expenseDate !== undefined) {
    const expenseDate = String(input.expenseDate ?? '').slice(0, 10);
    if (!isValidDate(expenseDate)) throw new HrError('expenseDate must be YYYY-MM-DD');
    out.expenseDate = expenseDate;
    out.expenseMonth = expenseDate.slice(0, 7);
  }
  if (input.paymentMode !== undefined) {
    out.paymentMode = input.paymentMode === null || input.paymentMode === ''
      ? null
      : oneOf(input.paymentMode, PAYMENT_MODES, 'paymentMode');
  }
  if (input.notes !== undefined) out.notes = nullableText(input.notes, 1000);
  if (Object.keys(out).length === 0) throw new HrError('nothing to update');
  return out;
}

export function cleanMemberCreate(input: Record<string, any>): MemberInput {
  const name = text(input.name, 200);
  if (!name) throw new HrError('name is required');
  const orderRaw = Number(input.order);
  return {
    name,
    email: nullableText(input.email, 200),
    phone: nullableText(input.phone, 40),
    designation: nullableText(input.designation, 100),
    order: Number.isFinite(orderRaw) ? Math.max(0, Math.min(9999, Math.floor(orderRaw))) : 0,
  };
}

export function cleanMemberPatch(input: Record<string, any>): Partial<MemberInput> & { deleted?: boolean } {
  const out: Partial<MemberInput> & { deleted?: boolean } = {};
  if (input.name !== undefined) {
    const name = text(input.name, 200);
    if (!name) throw new HrError('name cannot be empty');
    out.name = name;
  }
  if (input.email !== undefined) out.email = nullableText(input.email, 200);
  if (input.phone !== undefined) out.phone = nullableText(input.phone, 40);
  if (input.designation !== undefined) out.designation = nullableText(input.designation, 100);
  if (input.order !== undefined) {
    const n = Number(input.order);
    if (!Number.isFinite(n)) throw new HrError('order must be a number');
    out.order = Math.max(0, Math.min(9999, Math.floor(n)));
  }
  if (input.deleted !== undefined) out.deleted = Boolean(input.deleted);
  if (Object.keys(out).length === 0) throw new HrError('nothing to update');
  return out;
}

export function isTaskOverdue(
  task: { dueDate: string; dueTime: string | null; status: string },
  today = istDateStr(),
  nowTime = istTimeStr(),
): boolean {
  if (task.status === 'done') return false;
  const dueDate = String(task.dueDate || '').slice(0, 10);
  if (dueDate < today) return true;
  if (dueDate > today) return false;
  const dueTime = task.dueTime ? String(task.dueTime).slice(0, 5) : null;
  return !!dueTime && dueTime < nowTime;
}

export function taskSort(a: any, b: any): number {
  const d = String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
  if (d !== 0) return d;
  const t = String(a.dueTime || '23:59').localeCompare(String(b.dueTime || '23:59'));
  if (t !== 0) return t;
  const p = ['urgent', 'high', 'normal', 'low'];
  return p.indexOf(String(a.priority)) - p.indexOf(String(b.priority));
}


export function nonNegative(value: unknown, field: string, max = 1_000_000_000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new HrError(`${field} must be a number >= 0`);
  return Math.round(n * 1000) / 1000;
}

function optionalMoney(value: unknown, field: string): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return positiveAmount(value);
}

export function cleanInventoryItemCreate(input: Record<string, any>): InventoryItemInput {
  const name = text(input.name, 200);
  if (!name) throw new HrError('name is required');
  const openingDate = isValidDate(input.openingDate) ? input.openingDate : istDateStr();
  return {
    name,
    category: nullableText(input.category, 100),
    unit: text(input.unit, 20) || 'pcs',
    reorderLevel: nonNegative(input.reorderLevel ?? 0, 'reorderLevel'),
    unitCost: optionalMoney(input.unitCost, 'unitCost'),
    notes: nullableText(input.notes, 1000),
    order: nonNegative(input.order ?? 0, 'order', 9999),
    openingQty: nonNegative(input.openingQty ?? 0, 'openingQty'),
    openingDate,
  };
}

export function cleanInventoryItemPatch(input: Record<string, any>): InventoryItemPatch {
  const out: InventoryItemPatch = {};
  if (input.name !== undefined) {
    const name = text(input.name, 200);
    if (!name) throw new HrError('name cannot be empty');
    out.name = name;
  }
  if (input.category !== undefined) out.category = nullableText(input.category, 100);
  if (input.unit !== undefined) out.unit = text(input.unit, 20) || 'pcs';
  if (input.reorderLevel !== undefined) out.reorderLevel = nonNegative(input.reorderLevel, 'reorderLevel');
  if (input.unitCost !== undefined) out.unitCost = optionalMoney(input.unitCost, 'unitCost');
  if (input.notes !== undefined) out.notes = nullableText(input.notes, 1000);
  if (input.order !== undefined) out.order = nonNegative(input.order, 'order', 9999);
  if (Object.keys(out).length === 0) throw new HrError('nothing to update');
  return out;
}

export function cleanInventoryTxnCreate(input: Record<string, any>): InventoryTxnInput {
  const itemId = text(input.itemId, 100);
  if (!itemId) throw new HrError('itemId is required');
  const txnType = oneOf(input.txnType, INVENTORY_MOVE_TYPES, 'txnType');
  const txnDate = String(input.txnDate ?? '').slice(0, 10);
  if (!isValidDate(txnDate)) throw new HrError('txnDate must be YYYY-MM-DD');
  const n = Number(input.quantity);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1_000_000_000) {
    throw new HrError('quantity must be a non-zero number');
  }
  if (txnType !== 'adjustment' && n < 0) throw new HrError('quantity must be greater than 0');
  const quantity = Math.round(n * 1000) / 1000;
  const logExpense = Boolean(input.logExpense);
  if (logExpense && txnType !== 'purchase') {
    throw new HrError('Only stock-in can be recorded as an expense');
  }
  const paymentMode = input.paymentMode === null || input.paymentMode === undefined || input.paymentMode === ''
    ? null
    : oneOf(input.paymentMode, PAYMENT_MODES, 'paymentMode');
  return {
    itemId,
    txnType,
    quantity,
    txnDate,
    notes: nullableText(input.notes, 1000),
    logExpense,
    expenseAmount: logExpense ? positiveAmount(input.expenseAmount) : null,
    expenseType: logExpense ? oneOf(input.expenseType ?? 'variable', EXPENSE_TYPES, 'expenseType') : 'variable',
    expenseCategory: logExpense ? nullableText(input.expenseCategory, 100) : null,
    paymentMode: logExpense ? paymentMode : null,
  };
}

/** Stock delta for a ledger row (adjustments may be signed). */
export function inventoryQtyEffect(txnType: string, quantity: number): number {
  if (txnType === 'consumption') return -Math.abs(quantity);
  if (txnType === 'adjustment') return Number(quantity) || 0;
  return Math.abs(quantity);
}
