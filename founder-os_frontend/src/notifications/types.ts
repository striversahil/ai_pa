// ─────────────────────────────────────────────────────────────────────────────
// notifications/types.ts — frontend mirror of the engine contract.
//
// mirror: founder-os_backend/src/modules/notifications/types.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationLevelDef {
  level: number;
  colorName: string;
  hexColor: string;
  label: string;
  description: string;
}

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

export interface NotificationsPayload {
  notifications: NotificationPanelItem[];
  unread: number;
  levels: NotificationLevelDef[];
  employeeKey: string;
  canAuthor: boolean;
  unlinked?: boolean;
  limit?: number;
}

export interface NotificationAudience {
  positions?: string[];
  departments?: string[];
  regions?: string[];
  rosterTypes?: string[];
  roles?: string[];
  employees?: string[];
}

export interface NotificationCadence {
  kind: "hourly" | "everyNMin" | "daily" | "weekly" | "manual";
  n?: number;
  atMinute?: number;
  days?: number[];
}

export interface NotificationThreshold {
  level: number;
  op: "lt" | "lte" | "gt" | "gte" | "eq";
  value: number;
}

export interface NotificationEscalation {
  bumpEvery?: number;
  maxLevel?: number;
  notifyOnRecovery?: boolean;
}

export interface NotificationRule {
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
  /** The query's REAL result headers (in SELECT order) — offered as {TOKEN}s. */
  columns?: string[];
  /** The dry run's actual rows (capped) — rendered as a table, and row 1 is the
   *  preview. Absent on a real run. */
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

export interface NotificationSettings {
  maxPerEmployeePerHour: number;
  sweepRulesPerTick: number;
}

export interface NotificationOptions {
  positions: string[];
  departments: string[];
  regions: string[];
  rosterTypes: string[];
  roles: Array<{ key: string; position: string }>;
  people: Array<{ employeeKey: string; name: string; position: string; department: string; region: string }>;
  placeholders: string[];
  sampleSql: string;
  sampleTemplate: string;
}

export interface NotificationDelivery {
  id: string;
  ruleKey: string;
  employeeKey: string;
  employeeName: string | null;
  position: string | null;
  level: number;
  colorHex: string;
  value: number | null;
  title: string;
  body: string;
  createdAt: string;
  status: string | null;
}

export interface NotificationConsolePayload {
  rules: NotificationRule[];
  levels: NotificationLevelDef[];
  settings: NotificationSettings;
  options: NotificationOptions;
  deliveries: NotificationDelivery[];
  prompt?: { text: string; defaultPrompt: string };
}

/** One table of the live D1 schema offered to the AI authoring flow. */
export type NotificationJoinKind = "fk" | "orm" | "declared" | "app" | "inferred";

export interface NotificationJoin {
  /** Column on this table. */
  field: string;
  /** Table it points at. */
  model: string;
  /** Column on `model` (usually `id`). */
  ref: string;
  kind: NotificationJoinKind;
}

export interface NotificationSchemaTable {
  table: string;
  note: string;
  columns: Array<{ name: string; type: string }>;
  /** Outgoing relationships — how this table connects to the rest. */
  joins?: NotificationJoin[];
}

export interface NotificationSchema {
  tables: NotificationSchemaTable[];
  text: string;
  generatedAt: string;
  /** Total relationship edges in the block (all kinds). */
  relationships?: number;
}
