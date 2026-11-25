// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/store.ts — D1 persistence for the notification engine.
//
// Only hlp_* tables are WRITTEN here; the canonical inbox (`core_notification`)
// is written exclusively by modules/core/notify.ts#notifyUsers (core lock).
// Reads of core_notification are allowed and are how the bell panel joins
// escalation metadata (hlp_notification_delivery) onto the audit rows.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeLevels } from "./levels";
import { normalizePrompt } from "./prompt";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationLevelDef,
  type NotificationPanelItem,
  type NotificationRule,
  type NotificationSettings,
} from "./types";
import { employeeDisplayName } from '../../shared/employee-name';

const PANEL_MAX = 200;

function rowToRule(r: any): NotificationRule {
  const parse = (v: unknown, fallback: any) => {
    try {
      const p = JSON.parse(String(v ?? ""));
      return p ?? fallback;
    } catch {
      return fallback;
    }
  };
  return {
    id: String(r?.id ?? ""),
    key: String(r?.key ?? ""),
    name: String(r?.name ?? ""),
    description: String(r?.description ?? ""),
    enabled: Number(r?.enabled ?? 1) !== 0,
    audience: parse(r?.audienceJson, {}),
    sqlText: String(r?.sqlText ?? ""),
    titleTpl: String(r?.titleTpl ?? ""),
    bodyTpl: String(r?.bodyTpl ?? ""),
    cadence: parse(r?.cadenceJson, { kind: "hourly" }),
    thresholds: parse(r?.thresholdsJson, []),
    escalation: parse(r?.escalationJson, {}),
    nextDueAt: r?.nextDueAt ? String(r.nextDueAt) : null,
    lastRunAt: r?.lastRunAt ? String(r.lastRunAt) : null,
    lastStatus: r?.lastStatus ? String(r.lastStatus) : null,
    createdAt: r?.createdAt ? String(r.createdAt) : undefined,
    updatedAt: r?.updatedAt ? String(r.updatedAt) : undefined,
    createdBy: r?.createdBy ? String(r.createdBy) : undefined,
  };
}

async function all(db: any, sql: string, ...params: any[]): Promise<any[]> {
  const stmt = db.prepare(sql);
  const bound = params.length && typeof stmt.bind === "function" ? stmt.bind(...params) : stmt;
  const res: any = await bound.all();
  return (res?.results ?? []) as any[];
}

async function first(db: any, sql: string, ...params: any[]): Promise<any | null> {
  const stmt = db.prepare(sql);
  const bound = params.length && typeof stmt.bind === "function" ? stmt.bind(...params) : stmt;
  return (await bound.first()) ?? null;
}

async function run(db: any, sql: string, ...params: any[]): Promise<number> {
  const stmt = db.prepare(sql);
  const bound = params.length && typeof stmt.bind === "function" ? stmt.bind(...params) : stmt;
  const res: any = await bound.run();
  return Number(res?.meta?.changes ?? 0) || 0;
}

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ── Config (Setting rows, seeded by migration 0161) ─────────────────────────

export interface NotificationConfig {
  levels: NotificationLevelDef[];
  settings: NotificationSettings;
}

export async function loadNotificationConfig(db: any): Promise<NotificationConfig> {
  const rows = await all(db, `SELECT "key", "value" FROM "Setting" WHERE "key" IN (?, ?)`, "notifications:levels", "notifications:settings").catch(() => []);
  const byKey = new Map(rows.map((r) => [String(r.key), String(r.value ?? "")] as [string, string]));
  let settings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  try {
    const parsed = JSON.parse(byKey.get("notifications:settings") ?? "{}");
    settings = {
      maxPerEmployeePerHour: Math.max(1, Math.min(60, Number(parsed?.maxPerEmployeePerHour) || DEFAULT_NOTIFICATION_SETTINGS.maxPerEmployeePerHour)),
      sweepRulesPerTick: Math.max(1, Math.min(200, Number(parsed?.sweepRulesPerTick) || DEFAULT_NOTIFICATION_SETTINGS.sweepRulesPerTick)),
    };
  } catch { /* defaults */ }
  return { levels: normalizeLevels(byKey.get("notifications:levels")), settings };
}

export async function saveNotificationConfig(db: any, patch: { levels?: unknown; settings?: unknown }): Promise<void> {
  const now = new Date().toISOString();
  if (patch.levels !== undefined) {
    const levels = normalizeLevels(patch.levels);
    await run(
      db,
      `INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES (?, ?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`,
      "notifications:levels", JSON.stringify(levels), now,
    );
  }
  if (patch.settings !== undefined) {
    const raw: any = patch.settings ?? {};
    const settings: NotificationSettings = {
      maxPerEmployeePerHour: Math.max(1, Math.min(60, Number(raw?.maxPerEmployeePerHour) || DEFAULT_NOTIFICATION_SETTINGS.maxPerEmployeePerHour)),
      sweepRulesPerTick: Math.max(1, Math.min(200, Number(raw?.sweepRulesPerTick) || DEFAULT_NOTIFICATION_SETTINGS.sweepRulesPerTick)),
    };
    await run(
      db,
      `INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES (?, ?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`,
      "notifications:settings", JSON.stringify(settings), now,
    );
  }
}

/** The saved AI prompt (Setting `notifications:prompt`). Empty = code default. */
export async function loadPrompt(db: any): Promise<string> {
  const rows = await all(db, `SELECT "value" FROM "Setting" WHERE "key" = ?`, "notifications:prompt").catch(() => []);
  return String(rows[0]?.value ?? "");
}

/** Save (or clear, when blank) the AI prompt. Returns the stored text. */
export async function savePrompt(db: any, value: unknown): Promise<string> {
  const text = normalizePrompt(value);
  if (!text) {
    await run(db, `DELETE FROM "Setting" WHERE "key" = ?`, "notifications:prompt").catch(() => undefined);
    return "";
  }
  await run(
    db,
    `INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES (?, ?, ?)
     ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`,
    "notifications:prompt", text, new Date().toISOString(),
  );
  return text;
}

// ── Rules ───────────────────────────────────────────────────────────────────

export async function listRules(db: any): Promise<NotificationRule[]> {
  const rows = await all(db, `SELECT * FROM "hlp_notification_rule" ORDER BY "name"`).catch(() => []);
  return rows.map(rowToRule);
}

export async function getRule(db: any, key: string): Promise<NotificationRule | null> {
  const row = await first(db, `SELECT * FROM "hlp_notification_rule" WHERE "key" = ?`, String(key)).catch(() => null);
  return row ? rowToRule(row) : null;
}

export async function dueRules(db: any, atIso: string, limit: number): Promise<NotificationRule[]> {
  const rows = await all(
    db,
    `SELECT * FROM "hlp_notification_rule"
      WHERE "enabled" = 1 AND "nextDueAt" IS NOT NULL AND "nextDueAt" <= ?
      ORDER BY "nextDueAt" LIMIT ?`,
    atIso, limit,
  ).catch(() => []);
  return rows.map(rowToRule);
}

function ruleParams(rule: NotificationRule, actor: string | null, now: string): any[] {
  return [
    rule.id || newId(), rule.key, String(rule.name ?? "").slice(0, 200), String(rule.description ?? "").slice(0, 1000),
    rule.enabled === false ? 0 : 1,
    JSON.stringify(rule.audience ?? {}), String(rule.sqlText ?? ""),
    String(rule.titleTpl ?? "").slice(0, 500), String(rule.bodyTpl ?? "").slice(0, 4000),
    JSON.stringify(rule.cadence ?? { kind: "hourly" }), JSON.stringify(rule.thresholds ?? []),
    JSON.stringify(rule.escalation ?? {}), rule.nextDueAt ?? null,
    actor, now, now,
  ];
}

export async function saveRule(db: any, rule: NotificationRule, actor: string | null): Promise<NotificationRule> {
  const now = new Date().toISOString();
  await run(
    db,
    `INSERT INTO "hlp_notification_rule"
       ("id", "key", "name", "description", "enabled", "audienceJson", "sqlText", "titleTpl", "bodyTpl",
        "cadenceJson", "thresholdsJson", "escalationJson", "nextDueAt", "createdBy", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("key") DO UPDATE SET
       "name" = excluded."name", "description" = excluded."description", "enabled" = excluded."enabled",
       "audienceJson" = excluded."audienceJson", "sqlText" = excluded."sqlText",
       "titleTpl" = excluded."titleTpl", "bodyTpl" = excluded."bodyTpl",
       "cadenceJson" = excluded."cadenceJson", "thresholdsJson" = excluded."thresholdsJson",
       "escalationJson" = excluded."escalationJson", "nextDueAt" = excluded."nextDueAt",
       "updatedAt" = excluded."updatedAt"`,
    ...ruleParams(rule, actor, now),
  );
  const saved = await getRule(db, rule.key);
  return saved ?? rule;
}

export async function deleteRule(db: any, key: string): Promise<number> {
  return run(db, `DELETE FROM "hlp_notification_rule" WHERE "key" = ?`, String(key));
}

export async function markRuleRun(
  db: any,
  key: string,
  nextDue: string | null,
  status: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE "hlp_notification_rule" SET "lastRunAt" = ?, "lastStatus" = ?, "nextDueAt" = ?, "updatedAt" = ?
      WHERE "key" = ?`,
    now, JSON.stringify(status).slice(0, 2000), nextDue, now, String(key),
  ).catch(() => 0);
}

// ── Deliveries + escalation state ───────────────────────────────────────────

/** Employees already notified for this rule+window (window dedupe). */
export async function deliveredForWindow(db: any, ruleKey: string, windowKey: string): Promise<Set<string>> {
  const rows = await all(
    db,
    `SELECT "employeeKey" FROM "hlp_notification_delivery" WHERE "ruleKey" = ? AND "windowKey" = ?`,
    ruleKey, windowKey,
  ).catch(() => []);
  return new Set(rows.map((r) => String(r.employeeKey ?? "")));
}

export async function insertDelivery(db: any, d: {
  notificationId: string; ruleKey: string; employeeKey: string; windowKey: string;
  level: number; colorHex: string; value: number | null; metrics: Record<string, unknown>;
  title: string; body: string;
}): Promise<boolean> {
  const changes = await run(
    db,
    `INSERT OR IGNORE INTO "hlp_notification_delivery"
       ("id", "notificationId", "ruleKey", "employeeKey", "windowKey", "level", "colorHex", "value", "metricsJson", "title", "body", "createdAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(), d.notificationId, d.ruleKey, d.employeeKey, d.windowKey, d.level, d.colorHex,
    d.value, JSON.stringify(d.metrics ?? {}).slice(0, 4000), d.title.slice(0, 500), d.body.slice(0, 4000),
    new Date().toISOString(),
  ).catch(() => 0);
  return changes > 0;
}

/** Delivered count per employee since `sinceIso` (per-hour flood cap). */
export async function countsSince(db: any, employeeKeys: string[], sinceIso: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const keys = [...new Set(employeeKeys.filter(Boolean))];
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await all(
      db,
      `SELECT "employeeKey" AS k, COUNT(*) AS c FROM "hlp_notification_delivery"
        WHERE "createdAt" >= ? AND "employeeKey" IN (${placeholders}) GROUP BY "employeeKey"`,
      sinceIso, ...chunk,
    ).catch(() => []);
    for (const r of rows) out.set(String(r.k), Number(r.c ?? 0));
  }
  return out;
}

export interface EscalationState { streak: number; lastLevel: number; lastWindow: string | null; lastValue: number | null }

export async function loadStates(db: any, ruleKey: string, employeeKeys: string[]): Promise<Map<string, EscalationState>> {
  const out = new Map<string, EscalationState>();
  const keys = [...new Set(employeeKeys.filter(Boolean))];
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await all(
      db,
      `SELECT "employeeKey" AS k, "streak", "lastLevel", "lastWindow", "lastValue"
         FROM "hlp_notification_state" WHERE "ruleKey" = ? AND "employeeKey" IN (${placeholders})`,
      ruleKey, ...chunk,
    ).catch(() => []);
    for (const r of rows) {
      out.set(String(r.k), {
        streak: Number(r.streak ?? 0),
        lastLevel: Number(r.lastLevel ?? 0),
        lastWindow: r.lastWindow ? String(r.lastWindow) : null,
        lastValue: r.lastValue === null || r.lastValue === undefined ? null : Number(r.lastValue),
      });
    }
  }
  return out;
}

export async function saveState(db: any, ruleKey: string, employeeKey: string, s: EscalationState): Promise<void> {
  await run(
    db,
    `INSERT INTO "hlp_notification_state" ("ruleKey", "employeeKey", "streak", "lastLevel", "lastWindow", "lastValue", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("ruleKey", "employeeKey") DO UPDATE SET
       "streak" = excluded."streak", "lastLevel" = excluded."lastLevel",
       "lastWindow" = excluded."lastWindow", "lastValue" = excluded."lastValue", "updatedAt" = excluded."updatedAt"`,
    ruleKey, employeeKey, s.streak, s.lastLevel, s.lastWindow, s.lastValue, new Date().toISOString(),
  ).catch(() => 0);
}

// ── Reads for the bell panel + console ──────────────────────────────────────

export interface PanelQuery { status?: "unread" | "all" | "read"; level?: number | null; limit?: number }

export async function readPanel(db: any, employeeKey: string, q: PanelQuery = {}): Promise<NotificationPanelItem[]> {
  const limit = Math.max(1, Math.min(PANEL_MAX, Number(q.limit) || PANEL_MAX));
  const where: string[] = [`n."employeeId" = ?`];
  const params: any[] = [String(employeeKey)];
  if (q.status === "unread") where.push(`n."status" = 'QUEUED'`);
  if (q.status === "read") where.push(`n."status" = 'READ'`);
  if (q.level) { where.push(`d."level" = ?`); params.push(Number(q.level)); }
  params.push(limit);
  const rows = await all(
    db,
    `SELECT n."id" AS id, n."title" AS title, n."body" AS body, n."status" AS status,
            n."createdAt" AS createdAt, n."sentAt" AS sentAt, n."entityType" AS entityType, n."entityId" AS entityId,
            d."ruleKey" AS ruleKey, d."level" AS level, d."colorHex" AS colorHex, d."value" AS value
       FROM "core_notification" n
       LEFT JOIN "hlp_notification_delivery" d ON d."notificationId" = n."id"
      WHERE ${where.join(" AND ")}
      ORDER BY n."createdAt" DESC
      LIMIT ?`,
    ...params,
  ).catch(() => []);
  return rows.map((r): NotificationPanelItem => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    level: Number(r.level ?? 2),
    colorHex: String(r.colorHex ?? ""),
    colorName: "",
    levelLabel: "",
    ruleKey: String(r.ruleKey ?? ""),
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    createdAt: String(r.createdAt ?? ""),
    status: String(r.status ?? "QUEUED") === "READ" ? "READ" : "QUEUED",
    sentAt: r.sentAt ? String(r.sentAt) : null,
    entityType: r.entityType ? String(r.entityType) : null,
    entityId: r.entityId ? String(r.entityId) : null,
  }));
}

export async function unreadCount(db: any, employeeKey: string): Promise<number> {
  const row = await first(
    db,
    `SELECT COUNT(*) AS c FROM "core_notification" WHERE "employeeId" = ? AND "status" = 'QUEUED'`,
    String(employeeKey),
  ).catch(() => null);
  return Number((row as any)?.c ?? 0) || 0;
}

export async function getNotificationRow(db: any, id: string): Promise<{ id: string; employeeId: string; status: string } | null> {
  const row = await first(db, `SELECT "id", "employeeId", "status" FROM "core_notification" WHERE "id" = ?`, String(id)).catch(() => null);
  return row ? { id: String(row.id), employeeId: String(row.employeeId ?? ""), status: String(row.status ?? "") } : null;
}

/** Console "Deliveries" tab: newest deliveries across everyone (root view). */
export async function listDeliveries(db: any, limit = PANEL_MAX): Promise<any[]> {
  const capped = Math.max(1, Math.min(PANEL_MAX, Number(limit) || PANEL_MAX));
  return all(
    db,
    `SELECT d."id" AS id, d."ruleKey" AS ruleKey, d."employeeKey" AS employeeKey, d."level" AS level,
            d."colorHex" AS colorHex, d."value" AS value, d."title" AS title, d."body" AS body,
            d."createdAt" AS createdAt, n."status" AS status,
            m."name" AS employeeName, m."characterName" AS employeeCharacterName,
            m."useCharacterName" AS employeeUseCharacterName, m."designation" AS position
       FROM "hlp_notification_delivery" d
       LEFT JOIN "core_notification" n ON n."id" = d."notificationId"
       LEFT JOIN "HumanResourcesMember" m ON m."id" = d."employeeKey"
      ORDER BY d."createdAt" DESC
      LIMIT ?`,
    capped,
  ).catch(() => []).then((rows: any[]) => rows.map((row) => ({
    ...row,
    employeeName: employeeDisplayName({
      name: row.employeeName,
      characterName: row.employeeCharacterName,
      useCharacterName: row.employeeUseCharacterName,
    }),
  })));
}

/** Employees a rule's window already covered (used by the console Test tab). */
export async function lastRunSummary(db: any, ruleKey: string): Promise<any[]> {
  return all(
    db,
    `SELECT "employeeKey" AS employeeKey, "level" AS level, "value" AS value, "createdAt" AS createdAt
       FROM "hlp_notification_delivery" WHERE "ruleKey" = ? ORDER BY "createdAt" DESC LIMIT 50`,
    String(ruleKey),
  ).catch(() => []);
}

/** HR member id for a login (email first — the org module's join, never guessed). */
export async function employeeKeyForEmail(db: any, email: string): Promise<string> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return "";
  const row = await first(
    db,
    `SELECT "id" FROM "HumanResourcesMember"
      WHERE "deleted" = 0 AND (lower("email") = ? OR lower("loginEmail") = ?)
      ORDER BY "active" DESC LIMIT 1`,
    e, e,
  ).catch(() => null);
  return String((row as any)?.id ?? "");
}

/** Fallback identity: the core user link (only populated for onboarding flows). */
export async function employeeKeyForAuthUser(db: any, authUserId: string): Promise<string> {
  if (!authUserId) return "";
  const row = await first(db, `SELECT "employeeId" FROM "core_user_link" WHERE "authUserId" = ?`, String(authUserId)).catch(() => null);
  return String((row as any)?.employeeId ?? "");
}
