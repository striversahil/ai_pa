// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/template.ts — mustache-lite rendering (PURE).
//
// `{TOKEN}` only: no logic, no loops, no HTML. Every token is uppercase and
// case-insensitive on lookup, so `{agent_name}` and `{AGENT_NAME}` are the same
// field. Unknown tokens render as an empty string (never a raw `{FOO}` leak).
//
// Two token classes:
//   BUILTIN  — computed by the engine (person, window, level, rule).
//   COLUMN   — any alias the authored SQL returned (`{ATTEMPTED}`, `{NAME}`, …).
//
// mirror of backend: founder-os_backend/src/modules/notifications/template.ts
// Guarded by scripts/guards/notifications.test.mjs — change both together.
// ─────────────────────────────────────────────────────────────────────────────

export const BUILTIN_TOKENS: readonly string[] = [
  "AGENT_NAME",
  "EMPLOYEE_NAME",
  "POSITION",
  "DEPARTMENT",
  "REGION",
  "VALUE",
  "LEVEL",
  "LEVEL_LABEL",
  "LEVEL_COLOR",
  "WINDOW",
  "WINDOW_START",
  "WINDOW_END",
  "DATE",
  "RULE",
  "RULE_NAME",
];

const TOKEN_RE = /\{([A-Za-z0-9_]+)\}/g;

/** Uppercase every key so `{value}` and `{VALUE}` resolve identically. */
export function indexContext(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (v === null || v === undefined) continue;
    const key = String(k).trim().toUpperCase();
    if (!key) continue;
    out[key] = formatValue(v);
  }
  return out;
}

function formatValue(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/** Render one template. Never throws; unknown tokens collapse to "". */
export function renderTemplate(tpl: string, ctx: Record<string, unknown>): string {
  const source = String(tpl ?? "");
  if (!source) return "";
  const fields = indexContext(ctx ?? {});
  return source
    .replace(TOKEN_RE, (_m, raw: string) => {
      const key = String(raw).toUpperCase();
      return fields[key] ?? "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `{TOKEN}` used by a template (for docs + the console's chip list). */
export function templateTokens(tpl: string): string[] {
  const out: string[] = [];
  for (const m of String(tpl ?? "").matchAll(TOKEN_RE)) {
    const key = String(m[1]).toUpperCase();
    if (!out.includes(key)) out.push(key);
  }
  return out;
}
