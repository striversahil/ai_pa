# Data Retention Cleanup

## What it does
Deletes WhatsApp messages older than 90 days, in batches, every night at 3:00 AM IST — keeping the message table bounded so the digest / SLA / recovery jobs stay fast.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | The **entire** automation — no other files needed |
| `rule.json` | Schedule metadata (`0 3 * * *`) |

## Flow (what happens inside `index.ts`)
1. Compute cutoff = `now - 90 days`.
2. Loop: fetch up to 1000 old message IDs → `deleteMany` them.
3. Repeat until a batch deletes 0 rows.
4. Log total deleted.

## Trigger
`type: handler` · cron `0 3 * * *` (IST).

## Dependencies (platform services in `src/modules/` or `src/shared/`)
- `shared/prisma` — message reads/writes
- `shared/logger`

## Data
- **Writes:** deletes rows from `Message`.

## Config
None.
