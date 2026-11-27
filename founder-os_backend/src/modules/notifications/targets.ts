// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/targets.ts — audience → seats (position-wise dispatch).
//
// A "seat" is one person a rule can speak to:
//   employeeKey = HumanResourcesMember.id   ← the notification target
//     └ telecallerId = Telecaller.id        ← what the metric SQL returns
//   position = HR `designation` (exact chart title), department, region/roster
//
// The HR register is the identity source: sales fields (type, regions) live
// ON the employee row since mig 0177, so there is no roster join at all.
// Login roles are attached by email so `roles:["sales-head"]` works too.
// ─────────────────────────────────────────────────────────────────────────────
import type { NotificationAudience, NotificationSeat } from "./types";
import { employeeDisplayName } from "../../shared/employee-name";
import { parseRegionList } from "../org/types";

export interface SeatIndex {
  seats: NotificationSeat[];
  byEmployee: Map<string, NotificationSeat>;
  byTelecaller: Map<string, NotificationSeat>;
  byEmail: Map<string, NotificationSeat>;
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

async function all(db: any, sql: string, ...params: any[]): Promise<any[]> {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length && typeof stmt.bind === "function" ? stmt.bind(...params) : stmt;
    const res: any = await bound.all();
    return (res?.results ?? []) as any[];
  } catch {
    return [];
  }
}

/** Login email → role keys (auth_role.position is the role's chart title). */
export async function loadRolesByEmail(db: any): Promise<Map<string, string[]>> {
  const rows = await all(
    db,
    `SELECT u.email AS email, r.key AS roleKey FROM "auth_user" u
       JOIN "auth_user_role" ur ON ur.userId = u.id
       JOIN "auth_role" r ON r.key = ur.roleKey`,
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const email = norm(r?.email);
    const key = String(r?.roleKey ?? "").trim();
    if (!email || !key) continue;
    const list = out.get(email) ?? [];
    if (!list.includes(key)) list.push(key);
    out.set(email, list);
  }
  return out;
}

/** Parse the salesRegions JSON array (0..N codes, first = primary). */
function seatRegions(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map((r) => String(r ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Every active employee; sales fields live on the employee row (mig 0177). */
export async function loadSeats(db: any, opts?: { includeInactive?: boolean }): Promise<NotificationSeat[]> {
  const [employees, roles] = await Promise.all([
    all(
      db,
      `SELECT "id", "name", "characterName", "useCharacterName", "email", "loginEmail", "designation", "department", "active", "deleted", "salesType", "salesRegions"
         FROM "HumanResourcesMember"`,
    ),
    loadRolesByEmail(db),
  ]);

  const out: NotificationSeat[] = [];
  for (const emp of employees) {
    if (Number(emp?.deleted ?? 0) === 1) continue;
    const active = emp?.active === undefined || emp?.active === null ? true : Number(emp.active) !== 0;
    if (!active && !opts?.includeInactive) continue;
    const emails = [norm(emp?.email), norm(emp?.loginEmail)].filter(Boolean);
    const key = String(emp?.id ?? "").trim();
    if (!key) continue;
    const regions = seatRegions(emp?.salesRegions);
    const salesType = String(emp?.salesType ?? "").trim();
    out.push({
      employeeKey: key,
      name: employeeDisplayName(emp) || key,
      email: String(emp?.email ?? emp?.loginEmail ?? "").trim(),
      position: String(emp?.designation ?? "").trim(),
      department: String(emp?.department ?? "").trim(),
      region: regions[0] ?? "",
      regions,
      rosterType: salesType,
      telecallerId: salesType ? key : "",
      roles: emails.map((e) => roles.get(e) ?? []).flat(),
    });
  }
  return out;
}

export function indexSeats(seats: NotificationSeat[]): SeatIndex {
  const byEmployee = new Map<string, NotificationSeat>();
  const byTelecaller = new Map<string, NotificationSeat>();
  const byEmail = new Map<string, NotificationSeat>();
  for (const s of seats) {
    byEmployee.set(s.employeeKey, s);
    if (s.telecallerId) byTelecaller.set(s.telecallerId, s);
    if (s.email) byEmail.set(norm(s.email), s);
  }
  return { seats, byEmployee, byTelecaller, byEmail };
}

const anyMatch = (wanted: readonly string[] | undefined, actual: string): boolean =>
  !wanted || wanted.length === 0 ? true : wanted.some((w) => norm(w) === norm(actual));

/** Region audience matches ANY region the seat holds (0..N since mig 0177). */
const anyRegionMatch = (wanted: readonly string[] | undefined, actual: readonly string[]): boolean =>
  !wanted || wanted.length === 0 ? true : actual.some((r) => wanted.some((w) => norm(w) === norm(r)));

/** Which of these seats the rule speaks to (AND across selectors). */
export function matchAudience(seats: NotificationSeat[], audience: NotificationAudience): NotificationSeat[] {
  const a = audience ?? {};
  const explicit = new Set((a.employees ?? []).map((x) => String(x).trim()).filter(Boolean));
  return seats.filter((s) => {
    if (explicit.size > 0 && !explicit.has(s.employeeKey)) return false;
    if (!anyMatch(a.positions, s.position)) return false;
    if (!anyMatch(a.departments, s.department)) return false;
    // A person holds 0..N regions (mig 0177); the rule matches when ANY of
    // their regions is selected, never just the primary one.
    if (a.regions?.length) {
      const held = (s.regions?.length ? s.regions : [s.region]).map(norm);
      if (!a.regions.some((w) => held.includes(norm(w)))) return false;
    }
    if (!anyMatch(a.rosterTypes, s.rosterType)) return false;
    if (a.roles && a.roles.length > 0 && !a.roles.some((r) => s.roles.map(norm).includes(norm(r)))) return false;
    return true;
  });
}

/** A rule must name SOME audience — an empty one would notify the whole company. */
export function hasAudience(audience: NotificationAudience | null | undefined): boolean {
  const a = audience ?? {};
  return (["positions", "departments", "regions", "rosterTypes", "roles", "employees"] as const)
    .some((k) => (a[k] ?? []).length > 0);
}

/**
 * Resolve one metric row to its seat. Accepts `employee_key`, `telecaller_id`
 * (also `telecallerId`) — the two keys the console documents.
 */
export function seatForRow(row: Record<string, unknown>, index: SeatIndex): { seat: NotificationSeat | null; rawKey: string } {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      for (const candidate of [k, k.toUpperCase(), k.toLowerCase()]) {
        const v = row?.[candidate];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
    }
    return "";
  };
  const employeeKey = pick("employee_key", "employeeId", "employee_id");
  if (employeeKey) {
    const seat = index.byEmployee.get(employeeKey) ?? null;
    return { seat, rawKey: employeeKey };
  }
  const telecallerId = pick("telecaller_id", "telecallerId", "telecaller");
  if (telecallerId) {
    const seat = index.byTelecaller.get(telecallerId) ?? null;
    return { seat, rawKey: telecallerId };
  }
  return { seat: null, rawKey: "(row has no employee_key / telecaller_id)" };
}
