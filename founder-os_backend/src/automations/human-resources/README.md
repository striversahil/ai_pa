# Human Resources

HR delegation task list + fixed/variable/field-staff expense tracker + daily-item inventory. Deterministic, no LLM.
Tasks are ad-hoc (created with an assignee, due date/time and priority); there
is no recurring template or rollover engine. Expenses are a simple monthly
ledger classified as `fixed`, `variable` or `field_staff` (field staff expenses are
recorded as a filter, not tied to a roster member).

Files:

- `index.ts` — dashboard data provider (`GET /api/automations/human-resources/data`).
- `service.ts` — roster, delegated tasks, expense ledger, dashboard aggregation.
- `inventory.ts` — daily-item catalog, stock movement ledger, derived stock levels and optional stock-in expenses.
- `cache.ts` — dashboard cache key + invalidation.
- `parse.ts` — pure date/time/money/input validators and task-overdue logic.
- `types.ts` — shared row and input types.
- `rule.json` — manual-trigger handler automation, scope `human-resources`.

## Concepts

- **HumanResourcesMember** — HR roster row (`name, email, phone, designation, order, deleted`).
  HR/MIS users manage it from the dashboard; the data payload exposes names/designations.
- **HumanResourcesTask** — one delegated task (`title, description, assignedToId,
  dueDate YYYY-MM-DD, dueTime HH:mm, priority, status pending|in_progress|done, remark`).
  Overdue is derived at read time (`dueDate < today`, or same day after `dueTime`) and is
  never written into `status`.
- **HumanResourcesExpense** — one ledger row (`title, expenseType fixed|variable|field_staff,
  category, amount, expenseDate, expenseMonth, paymentMode, notes`).
- **HumanResourcesInventoryItem** — daily-use stock item (`name, category, unit,
  reorderLevel, unitCost, notes, order, deleted`). Current quantity is derived from transactions.
- **HumanResourcesInventoryTxn** — stock ledger row (`itemId, txnType opening|purchase|consumption|adjustment,
  quantity, txnDate, txnMonth, notes, expenseId, createdBy, deleted`). Stock-in can optionally
  create a linked expense.

## Access

- `human-resources` scope and MIS/root: complete dashboard access — every task, the full
  roster, all expenses and all inventory. HR users can create/assign/delete tasks, manage
  the roster, edit/delete any expense, add/edit inventory items, adjust stock and delete
  stock movements.
- Stock quantity is never edited directly; it is derived from the movement ledger.

## Endpoints

- `GET /api/automations/human-resources/data?month=YYYY-MM`
- `GET/POST/PATCH/DELETE /api/human-resources/members` (HR/MIS)
- `POST /api/human-resources/tasks` (HR/MIS)
- `PATCH /api/human-resources/tasks/:id` (HR/MIS: all fields)
- `DELETE /api/human-resources/tasks/:id` (HR/MIS)
- `POST /api/human-resources/expenses`
- `PATCH/DELETE /api/human-resources/expenses/:id` (HR/MIS)
- `GET /api/human-resources/inventory/items`
- `POST/PATCH/DELETE /api/human-resources/inventory/items` (HR/MIS)
- `GET /api/human-resources/inventory/items/:id/transactions`
- `POST /api/human-resources/inventory/transactions` (purchase/consumption/adjustment by HR/MIS)
- `DELETE /api/human-resources/inventory/transactions/:id` (HR/MIS)
