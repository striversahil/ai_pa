# telecalling-agent-analysis

Reads the **Telecalling Agents** Google Sheet and computes per-agent connection,
lead-gen and SO conversion metrics for the dashboard.

## Architecture

```
src/automations/telecalling-agent-analysis/
├── rule.json   → declarative definition (schedule + config)
├── index.ts    → ALL analysis code lives here (aggregation, insights, leaderboard)
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
   logs a scan summary (rows read, SO created, leads, agent count).
3. `data()` runs the same read + full analysis and is served at
   `GET /api/automations/telecalling-agent-analysis/data` for the frontend dashboard.
4. The frontend renders it generically (`SheetAnalysisDashboard`), no per-sheet
   frontend code needed.

## Dashboard payload

- `meta` — title, spreadsheet URL, range, rows read, generated time.
- `kpis` — total SO created, call connection rate, total leads, SO conversion rate.
- `insights` — AI-style performance & consistency evaluation per agent
  (Star/Good Lead Gen, Star/Good Performer vs. Low Lead Rate/Low Conversions).
- `tables` — telecaller leaderboard (ranked) and the raw telecaller log.

## Config

| key       | description                                   | default |
|-----------|-----------------------------------------------|---------|
| `sheetUrl`| full Google Sheets URL **or** raw spreadsheet ID | telecalling agents sheet |
| `range`   | A1 range (incl. header row)                   | `A1:Z1000` |

The sheet URL is the *only* thing to change to point this analysis at another
spreadsheet. The Google Sheets API stays identical.
