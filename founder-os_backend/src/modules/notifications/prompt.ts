// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/prompt.ts — the saved AI prompt for authoring rules
// (PURE).
//
// The founder copies this + the live schema (GET /api/notification-schema) into
// any AI agent, describes the escalation in words, and gets back a ready rule
// (SQL + template). Everything the engine requires is stated here once, so the
// agent cannot invent a row shape the engine will reject.
//
// The saved copy lives in Setting `notifications:prompt`; this is the default.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_NOTIFICATION_PROMPT = `You are writing ONE notification rule for Founder OS (Cloudflare D1 / SQLite).

Output exactly two blocks and nothing else:
1. SQL (one read-only SELECT or WITH statement)
2. A message template using {TOKEN} placeholders

## Hard rules for the SQL
- ONE statement, SELECT or WITH only. No INSERT/UPDATE/DELETE/DDL/PRAGMA/ATTACH, no semicolons chaining, no comments.
- The window is injected as bind parameters, never hardcoded:
    ?1 = window start (ISO-8601 UTC string)
    ?2 = window end   (ISO-8601 UTC string)
    ?3 = IST day      (YYYY-MM-DD)
  Use: WHERE <eventTimeColumn> >= ?1 AND <eventTimeColumn> < ?2
- ONE ROW PER PERSON. GROUP BY the person's id.
- Every row MUST return:
    telecaller_id   (or employee_key) — the person the notification is for
    value           — the number the message talks about
    level           — 1..5 severity, computed in SQL with CASE
  Any other alias you return becomes a template token ({MY_ALIAS}).
- level meaning: 1 = fine/resolved (never sent), 2 = low, 3 = warning, 4 = high, 5 = critical.
  Example shape:
    CASE WHEN metric = 0 THEN 5 WHEN metric < 2 THEN 4 WHEN metric < 4 THEN 3 ELSE 1 END AS level
- Do not filter a person out for being at level 1 — return the row with level 1 so the
  engine can record "resolved" and stop escalating.
- Exclude obviously empty rows (e.g. no attempts at all) with a WHERE guard, but never
  use NOW()/CURRENT_TIMESTAMP: the window is ?1/?2.
- SQLite only. No LIMIT tricks, no window functions that need config, no subqueries per row
  unless necessary. Cap the result with GROUP BY, not LIMIT.

## Template
- Placeholders are {UPPER_SNAKE}. Available built-ins:
  {AGENT_NAME} {EMPLOYEE_NAME} {POSITION} {DEPARTMENT} {REGION} {VALUE} {LEVEL}
  {LEVEL_LABEL} {LEVEL_COLOR} {WINDOW} {WINDOW_START} {WINDOW_END} {DATE} {RULE} {RULE_NAME}
- Plus any alias your SELECT returns, uppercased ({HOURLY_CONNECTED_CALL} for hourly_connected_call).
- Keep it short, factual and addressed to the person. State the metric, the window and what to do.
  Good: "{AGENT_NAME} you have {HOURLY_CONNECTED_CALL} connected calls in {WINDOW} — please pick up your calling pace."
  Bad: "You are underperforming." (no numbers, no window, no action)

## What to produce
Given the requested escalation and the schema below, return:
--- SQL ---
<the query>
--- TEMPLATE ---
<title line>
<body line>
--- NOTES ---
<one or two lines: which table/column assumptions you made and what to check>`;

/** Trim + cap a saved prompt; empty means "use the default". */
export function normalizePrompt(value: unknown): string {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  return text.slice(0, 12_000);
}
