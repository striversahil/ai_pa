# Sahil Overview

One-page concise highlight across every dashboard: Zoho sent analysis, CRM
sales orders, telecalling, enquiries (tracker + procurement + management),
accounts, digital marketing, NeoDove calls, enterprise ops.

- Read-only aggregator: `data()` reuses each source automation's `data()` via
  `AutomationEngine.getData()` (see `../_overview-shared/`). No duplicated logic.
- KV-cached 60s (`overview:sahil`). Per-section `allSettled` — one failing
  source never blanks the page.
- Identical layout to `samarth-overview`; differs only by scope (`sahil`).
- Scope `sahil` is grantable in the admin panel (auto-seeded).
