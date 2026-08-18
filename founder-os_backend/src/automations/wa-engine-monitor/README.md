# WA Engine Pro Monitor

## What it does
Every 5 minutes, verifies WA Engine Pro connectivity via `GET /me` (API key auth). WA Engine Pro is a cloud SaaS — there is no local session to reconnect — so this automation monitors and audits sustained API unreachability.

## Folder architecture
| File | Role |
|---|---|
| `session-monitor.ts` | **`checkWaEngineSession`** — connectivity health-check + outage audit (owned by this automation) |
| `dashboard.ts` | **`getWaEngineDashboardData`** — live API check + audit-trail uptime/outage analysis |
| `index.ts` | Handler → runs `checkWaEngineSession()`; `data` → dashboard provider |
| `rule.json` | Schedule metadata (`*/5 * * * *`) + `config.windowDays` (default 7) |

## Flow (what happens inside)
1. `GET {WA_ENGINE_BASE_URL}/me` with a 5s timeout + `X-API-Key`.
2. Status `WORKING` → healthy (reset counters).
3. Fetch error → mark `unreachable`, audit `WA_ENGINE_DISCONNECTED`.

## Trigger
`type: handler` · cron `*/5 * * * *`.

## Dashboard
`GET /api/automations/wa-engine-monitor/data` (opt-in via the `data` export — the frontend renders this under **Automations → WA Engine Pro Monitor**).

Returns:
- **Live check** — current WA Engine Pro API status (with a 5s timeout + API key).
- **KPIs** — current status, uptime % over the window, outage count, longest outage.
- **Outage timeline** — disconnects paired with the next reconnect into resolved/ongoing outage periods (from `AuditLog` `WA_ENGINE_DISCONNECTED` / `WA_ENGINE_RECONNECT` rows).
- **Recent events** — last 50 disconnect/reconnect audit events.

Window is `config.windowDays` (default 7) and can be overridden with `?windowDays=N`.

## Dependencies (platform services in `src/modules/`)
- `config` — WA Engine base URL / API key
- `modules/audit/service` — `WA_ENGINE_DISCONNECTED` / `WA_ENGINE_RECONNECT` audit rows
- `shared/logger`

## Data
- **Writes:** `AuditLog` entries.
- **Reads:** `AuditLog` history + live WA Engine Pro `/me` endpoint.

## Config
- `windowDays` — uptime/outage reporting window in days (default `7`).
- WA Engine credentials live in env (`.env`).