// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/engine.ts — evaluate ONE rule for ONE window.
//
// Flow (per the founder's spec):
//   1. run the authored metric SQL with ?1/?2/?3 bound to the window;
//   2. each row → one person (telecaller_id | employee_key) inside the rule's
//      position-wise audience;
//   3. the row's `level` column (or thresholds) decides severity + colour;
//   4. the mustache template renders with the row's columns + builtins;
//   5. level ≥ 2 dispatches through modules/core/notify.ts#notifyUsers (the
//      ONLY writer of core_notification) and a sidecar delivery row records
//      level/colour/metrics for the bell panel;
//   6. level 1 is logged as state, not toasted (unless the rule opted into a
//      recovery notice).
//
// Window dedupe (`rule+employee+window` unique) makes a 5-minute sweep safe for
// an hourly rule. Deterministic — no LLM, no network.
// ─────────────────────────────────────────────────────────────────────────────
import { notifyUsers } from "../core/notify";
import { resultColumns, sampleRows } from "./columns";
import { escalatedLevel, levelColorNameOf, levelDefOf, levelForValue, levelLabelOf } from "./levels";
import { runMetricSql } from "./metric-sql";
import {
  countsSince,
  deliveredForWindow,
  insertDelivery,
  loadStates,
  saveState,
  type EscalationState,
} from "./store";
import { indexSeats, loadSeats, matchAudience, seatForRow } from "./targets";
import { renderTemplate } from "./template";
import { istDayKey, windowFor, type RunWindow } from "./window";
import type {
  NotificationLevelDef,
  NotificationRule,
  NotificationRunItem,
  NotificationRunResult,
  NotificationSeat,
  NotificationSettings,
} from "./types";

const PREVIEW_MAX = 80;
const ERROR_MAX = 12;

export interface EvaluateOptions {
  /** Cron slot / run time the window is anchored to. */
  slot: Date;
  levels: NotificationLevelDef[];
  settings: NotificationSettings;
  /** Write nothing (console "Test"): rows + rendered text only. */
  dryRun?: boolean;
  /** false = rolling window ending at `slot` (Test / Run now). Default true. */
  align?: boolean;
  /** Explicit window override (Test "sample" mode: widen the lookback so a
   *  quiet hour still shows real rows + headers). */
  window?: { startIso: string; endIso: string };
}

function clock(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function metricsOf(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out[String(k)] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return out;
}

/** `LEVEL` column may arrive as `level`, `LEVEL`, `escalation_level`, … */
function rowLevelOf(row: Record<string, unknown>): number | null {
  for (const key of ["level", "LEVEL", "escalation_level", "escalationLevel", "severity"]) {
    const v = (row as any)[key];
    if (v === null || v === undefined || String(v).trim() === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Find the core_notification row notifyUsers just wrote for this person.
 *  The locked notify contract returns a count, not ids, so we read it back by
 *  (employee, title, body, since). A core change request can pass the id in. */
async function latestNotificationId(db: any, employeeKey: string, title: string, body: string, sinceIso: string): Promise<string> {
  try {
    const row = await db
      .prepare(
        `SELECT "id" FROM "core_notification"
          WHERE "employeeId" = ? AND "title" = ? AND "body" = ? AND "createdAt" >= ?
          ORDER BY "createdAt" DESC LIMIT 1`,
      )
      .bind(employeeKey, title, body, sinceIso)
      .first();
    return String((row as any)?.id ?? "");
  } catch {
    return "";
  }
}

export async function evaluateRule(db: any, rule: NotificationRule, opts: EvaluateOptions): Promise<NotificationRunResult> {
  const dryRun = !!opts.dryRun;
  const win: RunWindow = opts.window
    ? {
        start: new Date(opts.window.startIso),
        end: new Date(opts.window.endIso),
        startIso: new Date(opts.window.startIso).toISOString(),
        endIso: new Date(opts.window.endIso).toISOString(),
        key: `${new Date(opts.window.startIso).toISOString()}..${new Date(opts.window.endIso).toISOString()}`,
      }
    : windowFor(rule.cadence, opts.slot, { align: opts.align !== false });
  const windowKey = `${rule.key}:${win.key}`;
  const result: NotificationRunResult = {
    ruleKey: rule.key,
    dryRun,
    windowStart: win.startIso,
    windowEnd: win.endIso,
    windowKey,
    columns: [],
    scanned: 0,
    matched: 0,
    dispatched: 0,
    skipped: 0,
    unmatched: [],
    errors: [],
    results: [],
  };
  const addError = (msg: string) => {
    if (result.errors.length < ERROR_MAX && !result.errors.includes(msg)) result.errors.push(msg);
  };

  let rows: Record<string, unknown>[] = [];
  try {
    const q = await runMetricSql(db, rule.sqlText, [win.startIso, win.endIso, istDayKey(win.start)]);
    rows = q.rows;
    if (q.truncated) addError("The query returned more than 5000 rows — narrow it (GROUP BY the person).");
  } catch (e: any) {
    addError(`Metric query failed: ${String(e?.message ?? e).slice(0, 240)}`);
    return result;
  }
  result.scanned = rows.length;
  // The real headers of the authored query — the console turns these into
  // insertable message tokens (no hand-typed mustache keys).
  result.columns = resultColumns(rows);
  // Dry run only: hand the console the actual output so it can render a table
  // and preview the message from row 1 (never invented sample values).
  if (dryRun) result.sampleRows = sampleRows(rows);
  if (rows.length === 0) return result;

  // identity value (telecaller_id | employee_key) → recipient name, so the
  // dry run can preview {EMPLOYEE_NAME} per row (the SQL returns ids, not names).
  const nameByKey: Record<string, string> = {};

  // Audience once per run (position-wise dispatch).
  const seats = await loadSeats(db);
  const index = indexSeats(seats);
  const allowedAudience = matchAudience(seats, rule.audience ?? {});
  const allowed = new Map(allowedAudience.map((s) => [s.employeeKey, s]));

  const delivered = dryRun ? new Set<string>() : await deliveredForWindow(db, rule.key, windowKey);
  const states = dryRun ? new Map<string, EscalationState>() : await loadStates(db, rule.key, allowedAudience.map((s) => s.employeeKey));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const caps = dryRun ? new Map<string, number>() : await countsSince(db, allowedAudience.map((s) => s.employeeKey), hourAgo);

  const levelColour = (level: number) => {
    const def = levelDefOf(opts.levels, level);
    return { hex: def.hexColor, label: def.label, name: def.colorName };
  };

  for (const row of rows) {
    const { seat, rawKey } = seatForRow(row, index);
    if (!seat) {
      if (result.unmatched.length < 25) result.unmatched.push(rawKey);
      continue;
    }
    if (dryRun) nameByKey[rawKey] = seat.name;
    const audienceSeat = allowed.get(seat.employeeKey) ?? null;
    if (!audienceSeat) {
      result.skipped++;
      continue;
    }
    result.matched++;

    const value = Number((row as any).value ?? (row as any).VALUE ?? 0);
    const metricValue = Number.isFinite(value) ? value : 0;
    const rowLevel = rowLevelOf(row);
    const thresholds = Array.isArray(rule.thresholds) ? rule.thresholds : [];
    const base = rowLevel !== null ? rowLevel : levelForValue(thresholds, metricValue);
    if (base === null || base === 0) {
      addError("Rows must return a `level` column (1–5) or the rule needs thresholds.");
      continue;
    }

    const prev = states.get(seat.employeeKey) ?? { streak: 0, lastLevel: 0, lastWindow: null, lastValue: null };
    const bumpEvery = Number(rule.escalation?.bumpEvery ?? 0) || 0;
    const level = rowLevel !== null
      ? Math.min(5, Math.max(1, Math.round(base)))
      : escalatedLevel(base, prev.streak, bumpEvery, Number(rule.escalation?.maxLevel ?? 5));

    const colour = levelColour(level);
    const ctx: Record<string, unknown> = {
      ...metricsOf(row),
      AGENT_NAME: audienceSeat.name,
      EMPLOYEE_NAME: audienceSeat.name,
      POSITION: audienceSeat.position,
      DEPARTMENT: audienceSeat.department,
      REGION: audienceSeat.region,
      VALUE: metricValue,
      LEVEL: level,
      LEVEL_LABEL: colour.label,
      LEVEL_COLOR: colour.name,
      WINDOW: `${clock(win.startIso)}–${clock(win.endIso)} IST`,
      WINDOW_START: win.startIso,
      WINDOW_END: win.endIso,
      DATE: istDayKey(win.start),
      RULE: rule.key,
      RULE_NAME: rule.name,
    };
    const title = renderTemplate(rule.titleTpl || rule.name || "Notification", ctx).slice(0, 200);
    const body = renderTemplate(rule.bodyTpl ?? "", ctx).slice(0, 1000);

    // Level 1 = "Normal / Resolved": never toasted, except one opted-in recovery.
    const recovering = level <= 1 && prev.lastLevel >= 2 && rule.escalation?.notifyOnRecovery === true;
    if (level < 2 && !recovering) {
      result.skipped++;
      if (!dryRun) {
        await saveState(db, rule.key, seat.employeeKey, {
          streak: 0, lastLevel: level, lastWindow: windowKey, lastValue: metricValue,
        });
      }
      continue;
    }
    if (delivered.has(seat.employeeKey)) {
      result.skipped++;
      continue;
    }
    const cap = Number(opts.settings?.maxPerEmployeePerHour ?? 6) || 6;
    if ((caps.get(seat.employeeKey) ?? 0) >= cap) {
      result.skipped++;
      addError(`Hourly cap (${cap}) reached for ${seat.name} — remaining notifications skipped.`);
      continue;
    }

    if (dryRun) {
      if (result.results.length < PREVIEW_MAX) {
        result.results.push({ employeeKey: seat.employeeKey, name: seat.name, level, value: metricValue, title, body, colorHex: colour.hex });
      }
      continue;
    }

    const since = new Date(Date.now() - 5_000).toISOString();
    const written = await notifyUsers(
      [{ employeeId: seat.employeeKey, title, body, entityType: "notification_rule", entityId: rule.key }],
      null,
    );
    if (!written) {
      addError(`Could not write the notification for ${seat.name} (core notify unavailable).`);
      continue;
    }
    const notificationId = await latestNotificationId(db, seat.employeeKey, title, body, since);
    await insertDelivery(db, {
      notificationId,
      ruleKey: rule.key,
      employeeKey: seat.employeeKey,
      windowKey,
      level,
      colorHex: colour.hex,
      value: metricValue,
      metrics: metricsOf(row),
      title,
      body,
    });
    await saveState(db, rule.key, seat.employeeKey, {
      streak: level >= 2 ? prev.streak + 1 : 0,
      lastLevel: level,
      lastWindow: windowKey,
      lastValue: metricValue,
    });
    caps.set(seat.employeeKey, (caps.get(seat.employeeKey) ?? 0) + 1);
    result.dispatched++;
    if (result.results.length < PREVIEW_MAX) {
      result.results.push({ employeeKey: seat.employeeKey, name: seat.name, level, value: metricValue, title, body, colorHex: colour.hex });
    }
  }

  if (dryRun) result.sampleNames = nameByKey;
  return result;
}

/** Colour/label helpers re-exported so routes stay thin. */
export { levelColorNameOf, levelLabelOf };
export type { NotificationSeat };
