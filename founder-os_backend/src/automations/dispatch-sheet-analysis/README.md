# dispatch-sheet-analysis

Reads the **Dispatch & CRM Tracker** Google Sheet, audits data quality and computes dispatch KPIs for the dashboard.

## Architecture

```
src/automations/dispatch-sheet-analysis/
├── rule.json   → declarative definition (schedule + config)
├── index.ts    → ALL analysis code lives here (audit rules, KPIs, tables)
└── README.md   → this file
```

This folder is **self-contained**: the entire analysis lives in `index.ts`. It only
*references* the shared platform Google Sheets API — it never re-implements it:

| Concern            | Owned by                                  |
|--------------------|-------------------------------------------|
| Google Sheets API  | `src/modules/google_sheets/service.ts` (shared, unchanged) |
| Schedule (cron)    | framework via `rule.json` `trigger`        |
| Dashboard API      | framework via `index.ts` `data()` export   |
| Analysis logic     | **this folder** (`index.ts`)               |

## Data flow

1. `trigger` fires the automation every 30 minutes (`*/30 * * * *`).
2. `handler()` calls `GoogleSheetsService.getSpreadsheetData(sheetUrl, range)` and
   logs a scan summary (rows read, delays, warning count).
3. `data()` runs the same read + full analysis and is served at
   `GET /api/automations/dispatch-sheet-analysis/data` for the frontend dashboard.
4. The frontend renders it generically (`SheetAnalysisDashboard`), no per-sheet
   frontend code needed.

## Dashboard payload

- `meta` — title, spreadsheet URL, range, rows read, generated time.
- `kpis` — total dispatch value, dispatch delays, overdue & rescheduled, stock readiness.
- `warnings` — data-quality audit (missing transporter / email / SO number, logical
  date violations, delivered-without-date, dispatched-without-date, payment due, …).
- `tables` — order value by company, stock confirmation distribution, dispatch log.

## Config

| key       | description                                   | default |
|-----------|-----------------------------------------------|---------|
| `sheetUrl`| full Google Sheets URL **or** raw spreadsheet ID | dispatch tracker sheet |
| `range`   | A1 range (incl. header row)                   | `A1:Z1000` |

The sheet URL is the *only* thing to change to point this analysis at another
spreadsheet. The Google Sheets API stays identical.
