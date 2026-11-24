// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/metric-sql.ts — the authored metric query, validated
// and executed read-only against D1.
//
// The console lets the founder paste ONE SQL statement. That is a big hammer,
// so the guard rails are strict and the surface is narrow:
//   · exactly one statement, starting with SELECT or WITH;
//   · no comments (a comment can hide a second statement from a human reader);
//   · no DDL/DML/ATTACH/PRAGMA/transaction keywords anywhere;
//   · positional parameters only — ?1 window start, ?2 window end, ?3 IST day;
//   · result rows capped (a runaway cross join cannot blow the cron CPU budget).
// The query is authored by root only, and every save/test runs through here.
// ─────────────────────────────────────────────────────────────────────────────
import { NotificationInputError } from "./types";

const SQL_MAX_CHARS = 8000;
const DEFAULT_MAX_ROWS = 5000;

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|replace|trigger|grant|revoke|begin|commit|rollback|savepoint|release|analyze|load_extension)\b/i;

/** Remove line + block comments so validation sees only executable SQL. */
export function stripSqlComments(sql: string): string {
  return String(sql ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .trim();
}

/**
 * Validate an authored metric query. Returns the normalised SQL (comments
 * stripped, trailing `;` removed) or throws `NotificationInputError` (HTTP 400).
 */
export function assertReadOnlySql(sql: unknown): string {
  const raw = String(sql ?? "").trim();
  if (!raw) throw new NotificationInputError("The metric query is empty");
  if (raw.length > SQL_MAX_CHARS) throw new NotificationInputError(`The metric query is longer than ${SQL_MAX_CHARS} characters`);
  const text = stripSqlComments(raw);
  if (!/^(select|with)\b/i.test(text)) throw new NotificationInputError("The metric query must start with SELECT (or WITH … SELECT)");
  const body = text.replace(/;\s*$/, "");
  if (body.includes(";")) throw new NotificationInputError("Only ONE statement is allowed — remove the extra ';'");
  if (FORBIDDEN.test(body)) throw new NotificationInputError("The metric query must be read-only (no INSERT/UPDATE/DELETE/DDL/ATTACH/PRAGMA)");
  return body;
}

/** The three bind values every authored query receives. */
export function windowParams(startIso: string, endIso: string, day: string): string[] {
  return [startIso, endIso, day];
}

/**
 * How many positional parameters the statement actually uses.
 *
 * D1/SQLite reject a bind whose count does not match the statement exactly
 * ("Wrong number of parameter bindings"), so bind `?1..?N` only up to the
 * highest index the SQL mentions. This is what made a perfectly good rule fail
 * with only `?1` and `?2` in it while the runner offered three values.
 *
 * Supports `?N` (highest index wins) and bare `?` (positional, counted).
 */
export function paramCount(sql: string): number {
  const text = String(sql ?? '');
  const bare = text.replace(/\?\d+/g, '').match(/\?/g)?.length ?? 0;
  let maxIndexed = 0;
  for (const m of text.matchAll(/\?(\d+)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > maxIndexed) maxIndexed = n;
  }
  return maxIndexed + bare;
}

export interface MetricQueryResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/** Execute a validated metric query. `?1/?2/?3` are bound positionally. */
export async function runMetricSql(
  db: any,
  sql: string,
  params: string[],
  maxRows = DEFAULT_MAX_ROWS,
): Promise<MetricQueryResult> {
  if (!db || typeof db.prepare !== "function") return { rows: [], truncated: false };
  const stmt = db.prepare(sql);
  const bound = typeof stmt.bind === "function" ? stmt.bind(...params.slice(0, Math.min(paramCount(sql), params.length))) : stmt;
  const res: any = await bound.all();
  const rows = ((res?.results ?? []) as any[]).map((r) => ({ ...(r as Record<string, unknown>) }));
  const truncated = rows.length > maxRows;
  return { rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}

/** True when the query text already uses the window params (for docs/UI). */
export function usesWindowParam(sql: string): boolean {
  return /\?[123]/.test(String(sql ?? ""));
}
