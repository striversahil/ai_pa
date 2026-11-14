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

/** HR dashboard task buckets. Input keeps the server sort (due date, time,
 *  priority). Done rows arrive already filtered to the completion window; they
 *  are ordered newest-completion-first via `completedAt` (never dueDate). */
export function splitTaskBuckets(
  tasks: any[],
  today: string,
  completedAt: (id: string) => string,
) {
  const overdue: any[] = [];
  const dueToday: any[] = [];
  const upcoming: any[] = [];
  const completed: any[] = [];
  for (const t of tasks) {
    if (t.status === 'done') completed.push(t);
    else if (t.overdue) overdue.push(t);
    else if (String(t.dueDate) === today) dueToday.push(t);
    else upcoming.push(t);
  }
  completed.sort((a, b) => completedAt(String(b.id)).localeCompare(completedAt(String(a.id))));
  return { overdue, today: dueToday, upcoming, completed };
}
