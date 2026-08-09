# _template — copy me for a new automation

Copy this whole folder, rename it to `kebab-case-slug`, then fill in the sections below.
Delete any section that doesn't apply. `README.md` is **required**; `index.ts` is
optional (delete it if your automation is purely declarative).

> Keep this header paragraph when copying.

## Flavor 1 — Rule automation (declarative, recommended for new automations)

`rule.json` declares trigger + condition + actions; `index.ts` is optional.

```json
{
  "id": "my-automation",
  "name": "My Automation",
  "description": "One line: what it does and why.",
  "type": "rule",
  "trigger": { "type": "event", "event": "whatsapp.message.inbound" },
  "condition": { "all": [ { "field": "chatId", "op": "eq", "value": "{{config.sourceChatId}}" } ] },
  "dedupField": "wahaMessageId",
  "actions": [
    { "type": "whatsapp_send", "chatId": "{{config.targetChatId}}", "body": "Alert: {{body}}", "allowNonAllowlisted": true }
  ],
  "config": { "sourceChatId": "", "targetChatId": "" },
  "enabled": true
}
```

Use `"trigger": { "type": "schedule", "cron": "* * * * *" }` with an `index.ts`
`scanner()` for periodic scans, or `"type": "event_plus_scan"` with `fallbackCron` for
event-driven with a missed-event backstop.

## Flavor 2 — Handler automation (wrap an existing service, don't modify it)

For the migrated engines and anything that is "just a scheduled code body":

```json
{
  "id": "my-handler",
  "name": "My Handler",
  "description": "Wraps MyService on a schedule.",
  "type": "handler",
  "trigger": { "type": "schedule", "cron": "*/15 * * * *" },
  "enabled": true
}
```
```ts
// index.ts
import { MyService } from '../../modules/myservice/service';
export async function handler() { await MyService.run(); }
```

---

## 1. What it does
> One paragraph, plain language.

## 2. Trigger
- **Type:** `event` / `schedule` / `event_plus_scan`
- **Event name:** e.g. `whatsapp.group.message` (catalog in framework README)
- **Schedule cron:** e.g. `* * * * *`

## 3. Condition
> The JSON condition that must be true to fire, described in plain language.

## 4. Actions
> What happens when it fires (whatsapp_send / create_task / notify / custom:*).

## 5. Source / integration
> Which service provides the data and anything the integration needs.

## 6. Config
> The `config` keys in `rule.json`, e.g.:
```json
{ "targetChatId": "9198…@c.us" }
```

## 7. Dedup
> The dedup key and why the automation cannot double-fire.

## 8. Runbook / troubleshooting
> How to verify it's working and what to check if it isn't (log prefix `Automation: <slug>`, admin API, run history).
