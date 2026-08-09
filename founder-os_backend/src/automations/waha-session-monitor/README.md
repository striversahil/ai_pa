# WAHA Session Monitor

## What it does
Every 5 minutes, pings the WAHA WhatsApp session. If it's not `WORKING` for over a minute, it fires the WAHA `/start` endpoint to auto-reconnect, and audits every state change.

## Folder architecture
| File | Role |
|---|---|
| `session-monitor.ts` | **`checkWahaSession`** — full health-check + reconnect logic (owned by this automation) |
| `dashboard.ts` | **`getWahaDashboardData`** — live session check + audit-trail uptime/outage analysis |
| `index.ts` | Handler → runs `checkWahaSession()`; `data` → dashboard provider |
| `rule.json` | Schedule metadata (`*/5 * * * *`) + `config.windowDays` (default 7) |

## Flow (what happens inside)
1. `GET {WAHA_API_URL}/api/sessions/{session}` with a 5s timeout.
2. Status `WORKING` → healthy (reset counters).
3. Other status → mark disconnect time; if disconnected > 60s → `POST .../start` to reconnect.
4. Fetch error → mark `unreachable`, audit `WAHA_DISCONNECTED`.

## Trigger
`type: handler` · cron `*/5 * * * *`.

## Dashboard
`GET /api/automations/waha-session-monitor/data` (opt-in via the `data` export — the frontend renders this under **Automations → WAHA Session Monitor**).

Returns:
- **Live check** — current WAHA session status (with a 5s timeout + API key).
- **KPIs** — current status, uptime % over the window, outage count, longest outage.
- **Outage timeline** — disconnects paired with the next reconnect into resolved/ongoing outage periods (from `AuditLog` `WAHA_DISCONNECTED` / `WAHA_RECONNECT` rows).
- **Recent events** — last 50 disconnect/reconnect audit events.

Window is `config.windowDays` (default 7) and can be overridden with `?windowDays=N`.

## Dependencies (platform services in `src/modules/`)
- `config` — WAHA URL / session name / API key
- `modules/audit/service` — `WAHA_DISCONNECTED` / `WAHA_RECONNECT` audit rows
- `shared/logger`

## Data
- **Writes:** `AuditLog` entries.
- **Reads:** `AuditLog` history + live WAHA session endpoint.

## Config
- `windowDays` — uptime/outage reporting window in days (default `7`).
- WAHA credentials live in env (`.env`).
