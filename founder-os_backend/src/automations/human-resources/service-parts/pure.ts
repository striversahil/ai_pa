// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.


export function normId(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Split a free-text email cell ("a@x.com, b@y.com") into normalised tokens. */
export function emailTokens(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,;/\s]+/)
    .map((part) => normId(part))
    .filter(Boolean);
}

export function expenseJson(row: any) {
  return {
    id: String(row.id),
    title: row.title ?? '',
    expenseType: row.expenseType ?? 'variable',
    category: row.category ?? null,
    amount: Number(row.amount) || 0,
    expenseDate: row.expenseDate ?? null,
    expenseMonth: row.expenseMonth ?? null,
    paymentMode: row.paymentMode ?? null,
    notes: row.notes ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** One funding top-up HR received. */
export function fundTxnJson(row: any) {
  return {
    id: String(row.id),
    title: row.title ?? '',
    amount: Number(row.amount) || 0,
    txnDate: row.txnDate ?? null,
    notes: row.notes ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}
