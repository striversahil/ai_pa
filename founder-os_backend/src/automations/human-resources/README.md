# Human Resources

HR delegation task list + fixed/variable/field-staff expense tracker + daily-item inventory. Deterministic, no LLM.
Tasks are ad-hoc (created with an assignee, due date/time and priority); there
is no recurring template or rollover engine. Expenses are a simple monthly
ledger classified as `fixed`, `variable` or `field_staff` (field staff expenses are
recorded as a filter, not tied to a roster member).

Files:

- `index.ts` — dashboard data provider (`GET /api/automations/human-resources/data`).
- `service.ts` — roster, delegated tasks, expense ledger, dashboard aggregation,
  `resolveSelfHumanResourcesMember` (login → roster matching).
- `delegation.ts` — employee-facing board: scoped reads, self-created tasks, ownership
  guards, manager extras (team day cards, activity feed, logins).
- `delegation-parse.ts` — pure section/day/"needs an update today" rules
  (mirrors `founder-os_frontend/src/hr/delegation.ts`).
- `task-logs.ts` — append-only task journal writer + queries.
- `task-json.ts` — shared HrTask / HrTaskLog JSON mappers (dashboard + board).
- `inventory.ts` — daily-item catalog, stock movement ledger, derived stock levels and optional stock-in expenses.
- `hiring-positions.ts` — hiring kit: positions with any number of JD / SOP documents (D1 metadata).
- `hiring-positions-parse.ts` — pure position-name/PDF validation shared with the route layer.
- `employee-codes.ts` — `BUI-NNN` employee-code generator + unique-conflict retries.
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
- **HumanResourcesHiringPosition** — one hiring-kit position/job title (`name`, normalised
  `nameKey` unique). Positions can be imported from employee designations.
- **HumanResourcesPositionDoc** — one JD or SOP document for a position
  (`positionId, kind jd|sop, title, fileName, mime, size, kvKey, uploadedBy`). A position can
  hold any number of each kind (plain index on `(positionId, kind)`, no unique constraint);
  PDF bytes live in `CHAT_FILES` KV under `hrdocs/<uuid>.pdf`, served session-gated at
  `/api/human-resources/position-docs/:id/file`. Removing a document deletes its KV object.

## Access

- `human-resources` scope and MIS/root: complete dashboard access — every task, the full
  roster, all expenses and all inventory. HR users can create/assign/delete tasks, manage
  the roster, edit/delete any expense, add/edit inventory items, adjust stock and delete
  stock movements.
- Stock quantity is never edited directly; it is derived from the movement ledger.
- **Delegation board (`/delegation`) is for every approved login** — no `human-resources`
  scope required. `GET /api/delegation/board` scopes itself server-side: a non-manager only
  ever receives rows assigned to their own roster member (`linked=false` → empty board with
  a "ask HR to link your login" hint). HR/MIS holders additionally get `roster`, `team`,
  `activity` and `logins` in the same payload.
- Employees may always change `status` + `remark` on their own tasks; content fields
  (`title, description, dueDate, dueTime, priority`) only on `origin='self'` tasks they
  created. Deleting is limited to self-created tasks. Re-assignment is manager-only.

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
- `GET/POST /api/human-resources/hiring-positions` (HR/MIS)
- `POST /api/human-resources/hiring-positions/import` (seed from employee designations)
- `PATCH/DELETE /api/human-resources/hiring-positions/:id` (HR/MIS)
- `POST /api/human-resources/hiring-positions/:id/docs` (multipart `kind` + PDF, appends a document)
- `DELETE /api/human-resources/position-docs/:id` (deletes one document + its PDF)
- `GET /api/human-resources/position-docs/:id/file` (inline PDF, HR/MIS session)
- `GET /api/delegation/board?date=YYYY-MM-DD` (any signed-in user; self-scoped)
- `POST /api/delegation/tasks` (employee self task, or HR assignment when `assignedToId` is sent by HR/MIS)
- `PATCH /api/delegation/tasks/:id` (status/remark always; content on own self tasks)
- `DELETE /api/delegation/tasks/:id` (own self tasks; HR/MIS any task)
- `GET /api/delegation/tasks/:id/logs` (journal, self-scoped)
- `PUT /api/delegation/members/:id/login-email` (HR/MIS — links a roster member to a login)
