# WAHA Session Monitor

## What it does
Every 5 minutes, pings the WAHA WhatsApp session. If it's not `WORKING` for over a minute, it fires the WAHA `/start` endpoint to auto-reconnect, and audits every state change.

## Folder architecture
| File | Role |
|---|---|
| `session-monitor.ts` | **`checkWahaSession`** — full health-check + reconnect logic (owned by this automation) |
| `index.ts` | Handler → runs `checkWahaSession()` |
| `rule.json` | Schedule metadata (`*/5 * * * *`) |

## Flow (what happens inside)
1. `GET {WAHA_API_URL}/api/sessions/{session}` with a 5s timeout.
2. Status `WORKING` → healthy (reset counters).
3. Other status → mark disconnect time; if disconnected > 60s → `POST .../start` to reconnect.
4. Fetch error → mark `unreachable`, audit `WAHA_DISCONNECTED`.

## Trigger
`type: handler` · cron `*/5 * * * *`.

## Dependencies (platform services in `src/modules/`)
- `config` — WAHA URL / session name / API key
- `modules/audit/service` — `WAHA_DISCONNECTED` / `WAHA_RECONNECT` audit rows
- `shared/logger`

## Data
- **Writes:** `AuditLog` entries.

## Config
None here — WAHA credentials live in env (`.env`).
