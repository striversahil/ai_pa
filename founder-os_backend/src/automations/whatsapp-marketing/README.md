# whatsapp-marketing — WhatsApp Marketing

Multi-campaign WhatsApp marketing. Each campaign has its **own trigger time**
(one-shot datetime or recurring cron), its **own lead list** (uploaded via
CSV/JSON), its own **provider** (`waba` = Meta Cloud / WhatsApp Business API),
and its own template/body. A single framework cron ticks every
minute and fires whichever campaigns are due.

## What it does

- **Campaigns** (`MarketingCampaign`) — name, type (promotional / reengagement /
  invoice / seasonal / custom), provider, status (draft / active / paused /
  completed / archived), schedule (one_shot `scheduledAt` or recurring `cron`,
  both in Asia/Kolkata), message config (template + params, or free-text body),
  optional media (e.g. invoice PDF), and cached stats.
- **Leads** (`MarketingLead`) — the target list per campaign, deduped by
  `(campaignId, phoneNumber)`. Status tracks pending → sent → delivered → read
  → failed. Attributes JSON lets templates reference `{{lead.<key>}}`.
- **Runs** (`MarketingCampaignRun`) — one row per execution, with
  total/sent/failed counts so delivery can be audited.
- **Dashboard** — `GET /api/automations/whatsapp-marketing/data` returns KPIs,
  per-campaign stats + recent runs, and provider configuration state.

## Trigger

- **Type:** `schedule`, **cron:** `* * * * *` (every minute, Asia/Kolkata).
- The handler (`runDueCampaigns`) is data-driven: it loads all enabled
  campaigns and executes those whose own schedule is due. This keeps the
  module scalable — adding a campaign never requires a code change or a new
  cron registration.

## Scheduling semantics

- `one_shot`: fires when `scheduledAt` (IST) is reached **and** `runCount === 0`.
  Set `scheduledAt` to a future IST datetime, then flip status to `active`.
- `recurring`: fires whenever the current minute matches `cron` (evaluated in
  Asia/Kolkata via `cron-parser`). e.g. `"0 9 * * MON"` = every Monday 09:00 IST.
- `status` must be `active` and `enabled` true to fire.
- Sends are bounded to `leadLimit` (default 100) per run; a campaign with more
  pending leads is picked back up on the next tick, so a big list spreads
  without hammering the provider.

## Providers

| Provider | What it sends | Requires |
|---|---|---|
| `waba` | Approved template (`templateName` + `bodyParams`) OR free-text body (24h session) OR media (invoice PDF) | `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID` |

Leads are sent through `WabaClient` (`src/modules/waba/client.ts`). Message bodies
and template params support `{{lead.name}}`, `{{lead.phone}}`, and any key in the
lead's `attributes` JSON (`{{lead.attributes.<key>}}` / `{{lead.<key>}}`).

## API (campaign management)

- `GET  /api/whatsapp-marketing/campaigns` — list campaigns + stats
- `POST /api/whatsapp-marketing/campaigns` — create
- `GET  /api/whatsapp-marketing/campaigns/:id` — detail + runs + leads
- `PATCH /api/whatsapp-marketing/campaigns/:id` — update
- `POST /api/whatsapp-marketing/campaigns/:id/leads` — upload leads (CSV or JSON)
- `POST /api/whatsapp-marketing/campaigns/:id/run` — trigger a run now
- `GET  /api/whatsapp-marketing/leads/:campaignId` — paginated lead list

## Env / config

| Env | Purpose |
|---|---|
| `WHATSAPP_CLOUD_ACCESS_TOKEN` | Meta Cloud API token |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | WABA phone number ID to send from |
| `WHATSAPP_CLOUD_API_VERSION` | Graph API version (default `v21.0`) |

## Runbook / troubleshooting

- The cron tick logs `WhatsAppMarketing: tick` with `{ due, executed }` only
  when a campaign is due — silence means no due campaign.
- Per-run results log `WhatsAppMarketing: run finished` with totals.
- Missing provider config shows up in the dashboard KPIs (`providers.waba.configured`),
  and per-lead failures carry the provider's error string in `MarketingLead.error`.
- Run history + lead statuses are visible in the dashboard.
- Regenerate the Prisma client after schema edits: `npx prisma db push && npx prisma generate`.
