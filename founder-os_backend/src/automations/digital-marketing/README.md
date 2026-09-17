# Digital Marketing

Single-manager daily taskbar — BUI digital marketing KRA/KPI.

Files:

- `index.ts` — `handler()` rolls today's task instances forward; `data` serves `GET /api/automations/digital-marketing/data`.
- `service.ts` — everything: roster, templates, log instances, dashboard agg + numeric metrics (Meta/B2B/Whatsapp/Email). Per-day model: not done by EOD stays as "not done" in the Incomplete tab (no overdue rewrite); remark/metrics/time/owner autosave while typing, Done / Not Done / Pending only.
- `rule.json` — handler, daily `30 3 * * *` (03:30 IST rollover), scope `digital-marketing`.

## Concepts

- **DigitalMarketingManager** — roster row (`name, role manager, order, deleted`). MIS maps manager.
- **DigitalMarketingTaskTemplate** — recurring definition (`title, frequency daily|weekly, ownerRole manager|either, ruleType/ruleJson`). MIS-owned.
- **DigitalMarketingTaskLog** — one instance per `(templateId, dueDate)`. Logs `done|skipped` + `remark` + structured `metricsJson` (Meta category/inquiries/leads, B2B 4 sources, Whatsapp counts, Email counts) + attachments.

Due grammar same as Accounts: `not_applicable` (daily Mon-Sat), `weekday` (Monday..Thursday for posts), etc. `variable_per_item` never instantiates.

## Endpoints (worker `routes/digital-marketing.ts`, mirrored in Express)

- `GET /api/automations/digital-marketing/data?date=YYYY-MM-DD`
- `GET /api/digital-marketing/roster` (MIS) · `POST/PUT/DELETE /api/digital-marketing/roster`
- `GET /api/digital-marketing/templates` (MIS) · `POST/PUT/DELETE /api/digital-marketing/templates`
- `PATCH /api/digital-marketing/logs/:id` — log status + remark + metricsJson
- `POST /api/trigger/digital-marketing` — daily rollover (secret-gated)
