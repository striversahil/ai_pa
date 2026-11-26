// modules/org/chart/parse.ts — validation for chart writes. Pure.
import { POSITION_SUGGESTED_SCOPES } from "../../auth/positions";
import { HrError } from "../../../automations/human-resources/errors";
import { ORG_WINGS, type OrgWing } from "./types";

export const LOGIN_POSITION_KEYS = Object.keys(POSITION_SUGGESTED_SCOPES);

export function chartTitleKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

export interface ChartWriteInput {
  title?: string;
  department?: string | null;
  wing?: OrgWing;
  reportsToId?: string | null;
  isHead?: boolean;
  loginPosition?: string | null;
  order?: number;
}

export function cleanChartCreate(input: Record<string, any>): ChartWriteInput & { title: string; wing: OrgWing } {
  const title = text(input.title, 80);
  if (title.length < 2) throw new HrError("position title must be at least 2 characters");
  const wing = String(input.wing ?? "Operations").trim() as OrgWing;
  if (!ORG_WINGS.includes(wing)) throw new HrError("wing must be Sales|Marketing|Operations");
  const loginPosition = input.loginPosition === null || input.loginPosition === undefined || input.loginPosition === ""
    ? null
    : String(input.loginPosition).trim();
  if (loginPosition !== null && !LOGIN_POSITION_KEYS.includes(loginPosition)) {
    throw new HrError("loginPosition is not a known position");
  }
  return {
    title,
    department: input.department ? text(input.department, 80) : null,
    wing,
    reportsToId: input.reportsToId ? text(input.reportsToId, 100) : null,
    isHead: bool(input.isHead, false),
    loginPosition,
  };
}

export function cleanChartPatch(input: Record<string, any>): ChartWriteInput {
  const out: ChartWriteInput = {};
  if (input.title !== undefined) {
    const title = text(input.title, 80);
    if (title.length < 2) throw new HrError("position title must be at least 2 characters");
    out.title = title;
  }
  if (input.department !== undefined) out.department = input.department ? text(input.department, 80) : null;
  if (input.wing !== undefined) {
    const wing = String(input.wing ?? "").trim() as OrgWing;
    if (!ORG_WINGS.includes(wing)) throw new HrError("wing must be Sales|Marketing|Operations");
    out.wing = wing;
  }
  if (input.reportsToId !== undefined) out.reportsToId = input.reportsToId ? text(input.reportsToId, 100) : null;
  if (input.isHead !== undefined) out.isHead = bool(input.isHead, false);
  if (input.loginPosition !== undefined) {
    const loginPosition = input.loginPosition ? String(input.loginPosition).trim() : null;
    if (loginPosition !== null && !LOGIN_POSITION_KEYS.includes(loginPosition)) {
      throw new HrError("loginPosition is not a known position");
    }
    out.loginPosition = loginPosition;
  }
  if (Object.keys(out).length === 0) throw new HrError("nothing to update");
  return out;
}

/** True when candidateParentId is the node itself or one of its descendants. */
export function wouldCycle(
  rows: Array<{ id: string; reportsToId: string | null }>,
  nodeId: string,
  candidateParentId: string | null,
): boolean {
  if (!candidateParentId) return false;
  if (candidateParentId === nodeId) return true;
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  let cur: string | null = candidateParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = byId.get(cur)?.reportsToId ?? null;
  }
  return false;
}
