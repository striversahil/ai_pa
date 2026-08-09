# enterprise-operations-analytics

Serves the **18-Point Complete Enterprise Supply Chain Analysis** dashboard payload for the Enterprise Operations & Order Analytics Dashboard.

## Architecture

```
src/automations/enterprise-operations-analytics/
├── rule.json   → declarative definition (schedule)
├── index.ts    → ALL analysis data lives here (18-point schema payload)
└── README.md   → this file
```

This folder is **self-contained**: the entire analysis payload lives in `index.ts`. It exposes a `data()` provider that the frontend dashboard consumes.

| Concern            | Owned by                                  |
|--------------------|-------------------------------------------|
| Schedule (cron)    | framework via `rule.json` `trigger`        |
| Dashboard API      | framework via `index.ts` `data()` export   |
| Analysis data      | **this folder** (`index.ts`)               |

## Data flow

1. `trigger` fires the automation every 30 minutes (`*/30 * * * *`).
2. `handler()` logs a scan summary (total orders, total value, critical orders).
3. `data()` returns the full 18-point schema payload and is served at
   `GET /api/automations/enterprise-operations-analytics/data` for the frontend dashboard.

## Dashboard payload (18 sections)

1. **Executive Operations Summary** — total orders, value, avg value, max/min, high-value count, customer mix, health & risk scores.
2. **Dashboard Visual Distribution Charts** — stage, stock, payment, dispatch, customer type distributions.
3. **Master Sales Orders Table** — full order list with search & risk filter.
4. **Critical Orders Escalation List** — immediate executive action items.
5. **Procurement & Inventory Operations** — waiting stock, partial stock, vendor pending, vendor priority.
6. **Dispatch Logistics Command** — ready today, scheduled, blocked, delayed, transport pending, documentation pending.
7. **Payments & Financial Risk Management** — advance pending, full payment pending, CAD/LC, hold, received, high-risk exposure.
8. **Customer Risk Assessment Matrix** — per-customer risk & recommended action.
9. **Priority Call Desk & Follow-up Script** — call scripts with questions to ask.
10. **System & Process Exceptions Log** — zero-value bookings, SLA breaches, missing data.
11. **Departmental Health & Issues Analysis** — per-department health score & bottlenecks.
12. **Root Cause & Financial Impact Analysis** — root causes with affected value.
13. **Predictive Operations Analytics** — dispatch today/tomorrow, SLA breach alerts, management attention.
14. **Core Operational KPIs & SLA Metrics** — 8 core KPIs.
15. **Departmental Action Items Taskboard** — per-department action items.
16. **Top 20 Operational Priorities** — ranked priority table.
17. **CRM & Data Governance Audit** — missing/unused/duplicate fields, recommended dropdowns/calculated fields.
18. **Workflow Automation & Alert Triggers** — automation trigger rules.

## Config

No external configuration required — the analysis payload is static schema data.