// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/types.ts — shared shapes for the notification engine.
//
// Pure: no DB, no fetch. Mirrored (types only, where needed) by
// founder-os_frontend/src/notifications/types.ts.
//
// Vocabulary
//   RULE      = authored in the console: audience + cadence + metric SQL +
//               template + level source.
//   ROW       = one line of that SQL = one PERSON = one notification.
//   LEVEL     = 1..5 (1 = "Normal / Resolved" → logged, never toasted).
//   WINDOW    = the metric period the rule evaluates ("last hour" at :00 IST).
//   DELIVERY  = the sidecar row that carries level/colour/metric beside the
//               canonical core_notification inbox row.
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationLevel = 1 | 2 | 3 | 4 | 5;

export interface NotificationLevelDef {
  level: number;
  colorName: string;
  hexColor: string;
  label: string;
  description: string;
}

/** Who a rule speaks to. Every selector is optional; at least one is required. */
export interface NotificationAudience {
  /** Chart position / HR designation, exact title (e.g. "Telecaller"). */
  positions?: string[];
  departments?: string[];
  /** Sales roster region (R1–R4) — matched through the Telecaller row. */
  regions?: string[];
  /** Roster type: telecaller | team_lead | … */
  rosterTypes?: string[];
  /** Login role keys (auth_role.key). */
  roles?: string[];
  /** Explicit employee ids (HR member id). */
  employees?: string[];
}

export type NotificationCadenceKind = "hourly" | "everyNMin" | "daily" | "weekly" | "manual";

export interface NotificationCadence {
  kind: NotificationCadenceKind;
  /** everyNMin: N (clamped 5..1440). */
  n?: number;
  /** daily/weekly: minute-of-day in IST (0..1439). */
  atMinute?: number;
  /** weekly: IST weekdays, 0 = Sunday. */
  days?: number[];
}

export interface NotificationThreshold {
  level: number;
  op: "lt" | "lte" | "gt" | "gte" | "eq";
  value: number;
}

/** Optional escalation memory for rules whose SQL does NOT return `level`. */
export interface NotificationEscalation {
  /** Bump one level every N consecutive windows still in breach. */
  bumpEvery?: number;
  /** Ceiling (default 5). */
  maxLevel?: number;
  /** Send a level-1 "resolved" notification when a breach clears. */
  notifyOnRecovery?: boolean;
}

export interface NotificationRule {
  id?: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  audience: NotificationAudience;
  sqlText: string;
  titleTpl: string;
  bodyTpl: string;
  cadence: NotificationCadence;
  thresholds: NotificationThreshold[];
  escalation: NotificationEscalation;
  nextDueAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

/** A resolvable seat: HR member (= notification target) + roster link. */
export interface NotificationSeat {
  employeeKey: string;
  name: string;
  email: string;
  position: string;
  department: string;
  /** Primary region (first of `regions`) — the {REGION} token. */
  region: string;
  /** Every region the seat holds (0..N; mig 0177). */
  regions: string[];
  rosterType: string;
  telecallerId: string;
  roles: string[];
}

export interface NotificationRunItem {
  employeeKey: string;
  name: string;
  level: number;
  value: number;
  title: string;
  body: string;
  colorHex: string;
}

export interface NotificationRunResult {
  ruleKey: string;
  dryRun: boolean;
  windowStart: string;
  windowEnd: string;
  windowKey: string;
  /** The SQL's REAL result headers, in SELECT order — what the console offers as
   *  `{TOKEN}`s after a dry run (see ./columns.ts). */
  columns: string[];
  /** The dry run's actual rows (capped) so the console can show the SQL's real
   *  output as a table and preview messages from row 1. Never set on a real /
   *  cron run — the sweep does not carry data around. */
  sampleRows?: Array<Record<string, unknown>>;
  /** identity value (telecaller_id / employee_key) → recipient name, so the
   *  console can preview {EMPLOYEE_NAME} for each row. Dry run only. */
  sampleNames?: Record<string, string>;
  scanned: number;
  matched: number;
  dispatched: number;
  skipped: number;
  unmatched: string[];
  errors: string[];
  results: NotificationRunItem[];
}

/** One row of the bell panel (`hlp_notification_delivery` ⋈ `core_notification`). */
export interface NotificationPanelItem {
  id: string;
  title: string;
  body: string;
  level: number;
  colorHex: string;
  colorName: string;
  levelLabel: string;
  ruleKey: string;
  value: number | null;
  createdAt: string;
  status: "QUEUED" | "READ";
  sentAt: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface NotificationSettings {
  maxPerEmployeePerHour: number;
  sweepRulesPerTick: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  maxPerEmployeePerHour: 6,
  sweepRulesPerTick: 25,
};

/** Raised for author/validation problems (mapped to HTTP 400 by the routes). */
export class NotificationInputError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "NotificationInputError";
  }
}
