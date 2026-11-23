// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/parse.ts — author input → a valid rule (PURE + ish).
//
// Everything the console can send is normalised here: arrays are trimmed and
// de-duped, the cadence is clamped, the SQL is validated read-only, and an
// empty audience is refused (an empty audience would notify the whole company).
// Bad input throws NotificationInputError → HTTP 400 with the reason.
// ─────────────────────────────────────────────────────────────────────────────
import { assertReadOnlySql } from "./metric-sql";
import { hasAudience } from "./targets";
import { NotificationInputError } from "./types";
import type {
  NotificationAudience,
  NotificationCadence,
  NotificationEscalation,
  NotificationRule,
  NotificationThreshold,
} from "./types";

const OPS = ["lt", "lte", "gt", "gte", "eq"] as const;

export function slugifyKey(input: unknown): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function strList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? String(v).split(",") : [];
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function parseAudience(raw: unknown): NotificationAudience {
  const a: any = raw && typeof raw === "object" ? raw : {};
  return {
    positions: strList(a.positions),
    departments: strList(a.departments),
    regions: strList(a.regions),
    rosterTypes: strList(a.rosterTypes),
    roles: strList(a.roles),
    employees: strList(a.employees),
  };
}

function parseCadence(raw: unknown): NotificationCadence {
  const c: any = raw && typeof raw === "object" ? raw : {};
  const kind = String(c.kind ?? "hourly") as NotificationCadence["kind"];
  if (!["hourly", "everyNMin", "daily", "weekly", "manual"].includes(kind)) {
    throw new NotificationInputError(`Unknown cadence "${kind}"`);
  }
  const out: NotificationCadence = { kind };
  if (kind === "everyNMin") {
    const n = Math.round(Number(c.n));
    out.n = Number.isFinite(n) ? Math.min(1440, Math.max(5, n)) : 60;
  }
  if (kind === "daily" || kind === "weekly") {
    const at = Math.round(Number(c.atMinute));
    out.atMinute = Number.isFinite(at) ? Math.min(1439, Math.max(0, at)) : 9 * 60 + 30;
  }
  if (kind === "weekly") {
    const days: number[] = (Array.isArray(c.days) ? c.days : [])
      .map((d: unknown) => Math.round(Number(d)))
      .filter((d: number) => Number.isFinite(d) && d >= 0 && d <= 6);
    out.days = [...new Set(days)].sort((a, b) => a - b);
  }
  return out;
}

function parseThresholds(raw: unknown): NotificationThreshold[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: NotificationThreshold[] = [];
  for (const t of list) {
    const op = String((t as any)?.op ?? "").trim() as NotificationThreshold["op"];
    const value = Number((t as any)?.value);
    const level = Math.round(Number((t as any)?.level));
    if (!OPS.includes(op)) throw new NotificationInputError(`Threshold op "${op}" must be one of ${OPS.join(", ")}`);
    if (!Number.isFinite(value)) throw new NotificationInputError("Threshold value must be a number");
    if (!Number.isFinite(level) || level < 1 || level > 5) throw new NotificationInputError("Threshold level must be 1–5");
    out.push({ level, op, value });
  }
  return out;
}

function parseEscalation(raw: unknown): NotificationEscalation {
  const e: any = raw && typeof raw === "object" ? raw : {};
  const out: NotificationEscalation = {};
  const bump = Math.round(Number(e.bumpEvery));
  if (Number.isFinite(bump) && bump > 0) out.bumpEvery = Math.min(24, bump);
  const maxLevel = Math.round(Number(e.maxLevel));
  if (Number.isFinite(maxLevel) && maxLevel >= 1) out.maxLevel = Math.min(5, maxLevel);
  if (e.notifyOnRecovery === true) out.notifyOnRecovery = true;
  return out;
}

/**
 * Normalise + validate a rule body from the console. `existing` supplies the
 * id/createdBy/nextDueAt that the caller must not lose on an update.
 */
export function parseRuleInput(body: any, existing?: NotificationRule | null): NotificationRule {
  const raw: any = body && typeof body === "object" ? body : {};
  const name = String(raw.name ?? "").trim();
  if (!name) throw new NotificationInputError("Give the rule a name");
  if (name.length > 200) throw new NotificationInputError("Rule name is too long (max 200)");

  const key = slugifyKey(raw.key || existing?.key || name);
  if (!key) throw new NotificationInputError("Rule key is empty — use letters, digits or dashes");

  const audience = parseAudience(raw.audience);
  if (!hasAudience(audience)) {
    throw new NotificationInputError("Pick at least one audience (position, department, region, roster type, role or person)");
  }

  const sqlText = assertReadOnlySql(raw.sqlText);
  const cadence = parseCadence(raw.cadence);
  const thresholds = parseThresholds(raw.thresholds);
  const escalation = parseEscalation(raw.escalation);

  const titleTpl = String(raw.titleTpl ?? "").trim().slice(0, 500) || name;
  const bodyTpl = String(raw.bodyTpl ?? "").trim().slice(0, 4000);
  if (!bodyTpl) throw new NotificationInputError("Write the message template (it can be just one {FIELD})");

  return {
    id: existing?.id,
    key,
    name,
    description: String(raw.description ?? "").trim().slice(0, 1000),
    enabled: raw.enabled === undefined ? (existing?.enabled ?? true) : raw.enabled !== false,
    audience,
    sqlText,
    titleTpl,
    bodyTpl,
    cadence,
    thresholds,
    escalation,
    nextDueAt: raw.nextDueAt === undefined ? (existing?.nextDueAt ?? null) : (raw.nextDueAt ? String(raw.nextDueAt) : null),
    lastRunAt: existing?.lastRunAt ?? null,
    lastStatus: existing?.lastStatus ?? null,
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt,
    createdBy: existing?.createdBy,
  };
}
