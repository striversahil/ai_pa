# Reporting Sheet

Weekly management review — one page where the founder sees every department's
week, and each department head enters only their own section.

- `ReportEntry`: one row per department-section per ISO week (`2026-W44`),
  JSON payload + tabular blocks (telecaller rows, region orders), `origin`
  (`manual` | `autofill` | `adjusted`), submitted-by stamp. Upsert-only, so a
  re-save never duplicates.
- `ReportAudit`: insert-only log of every section save (who / what / when).
- `granularity` is `'week'` today; daily mode later stores `'day'` rows with a
  `YYYY-MM-DD` period in the same tables.

Reads: `GET /api/automations/reporting-sheet/data?period=2026-W44` — one
KV-cached payload per period (`reporting:week:<period>`, 5 min TTL,
invalidated on every save), filtered server-side to the viewer's departments.

Writes (worker route `src/worker/routes/reporting-sheet.ts` — Express frozen):

| endpoint | who |
|---|---|
| `PUT /api/reporting/week/:period/:dept/:section` | that department's scope holder, or root / MIS; heads locked to current + previous week |
| `GET /api/reporting/autofill?dept&section&period` | same edit permission — suggestions only, never writes |
| `GET /api/reporting/capabilities` · `GET /api/reporting/filled` | any viewer |

Auto-fill sources (suggestions — the saved snapshot is frozen history):

| section | source |
|---|---|
| Sales A telecaller rows | NeoDove agent report for the week (`getNeodoveRangeMap`) |
| Sales A region orders | accepted estimates snapshot (`loadAcceptedSnapshot`) |
| Sales B lead status | NeoDove lead pipeline sums |
| Operations B outstanding | debtors ledger live snapshot (`netDue = gross − advances`) |
| Digital B/C/D sends + leads | marketing log series (`getDigitalMarketingMetricsSeries`) |

Everything else (field visits, scheduling, dispatch, stock, reviews, Kingpin,
e-commerce, campaign counts, site work) is entered by hand — no reliable live
source exists today.
