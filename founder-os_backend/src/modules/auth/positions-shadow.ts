// modules/auth/positions-shadow.ts — Phase 1 shadow compare (core vs roster).
// Framework-free (no imports): the Worker route feeds it plain core rows,
// it resolves the core-backed auto position with the SAME precedence shape as
// positions.ts, and reports diffs. Served roster values never change here —
// diffs surface as an internal `coreMismatch` marker for cleanup review.
// Mirror note: no frontend mirror needed (marker is internal-only for now).

import type { OrgPosition, PositionInput } from './positions';
import { POSITION_META } from './positions';

/** Minimal core rows the route loads (validTo-filtered, primary position). */
export interface CoreSnapshot {
  employees: Array<{ workEmail?: string | null; positionCode?: string | null; grade?: string | null }>;
}

export interface CoreAuto {
  position: OrgPosition;
  via: string;
}

const normEmail = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const normCode = (v: unknown): string => String(v ?? '').trim().toUpperCase();

function hasScope(scopes: string[], key: string): boolean {
  return scopes.some((s) => String(s ?? '').toLowerCase() === key);
}

/**
 * Core-backed auto resolution. Precedence mirrors resolveAutoPosition:
 * manager scopes first, then the single core roster, then scope procurement.
 * (HR needs no separate list — HR members are core employees with HR_EXEC.)
 */
export function resolveCoreAutoPosition(input: PositionInput, snap: CoreSnapshot): CoreAuto {
  const email = normEmail(input.email);
  const scopes = input.scopes ?? [];
  if (hasScope(scopes, 'sales-head')) {
    return { position: 'sales-head', via: 'holds sales-head scope' };
  }
  if (hasScope(scopes, 'mis') || hasScope(scopes, 'user-admin')) {
    return { position: 'mis', via: 'holds MIS scope' };
  }
  if (email) {
    const emp = (snap.employees ?? []).find((e) => normEmail(e.workEmail) === email);
    if (emp) {
      const code = normCode(emp.positionCode);
      const grade = String(emp.grade ?? '').toLowerCase();
      switch (code) {
        case 'TL1':
        case 'TL2':
          return { position: 'team-lead', via: `core_employee · ${code}` };
        case 'SALES_EXEC':
          return { position: 'telecaller', via: 'core_employee · SALES_EXEC' };
        case 'FIELD_EXEC':
          return { position: 'field-staff', via: 'core_employee · FIELD_EXEC' };
        case 'ACCOUNTANT':
          return { position: 'accountant', via: 'core_employee · ACCOUNTANT' };
        case 'MARKETING_MGR':
          return grade === 'junior'
            ? { position: 'dm-junior', via: 'core_employee · MARKETING_MGR · Junior' }
            : { position: 'dm-senior', via: 'core_employee · MARKETING_MGR · Senior' };
        case 'HR_EXEC':
          return { position: 'hr', via: 'core_employee · HR_EXEC' };
        case 'SALES_HEAD':
          return { position: 'sales-head', via: 'core_employee · SALES_HEAD' };
        case 'PURCHASE_EXEC':
          return { position: 'procurement', via: 'core_employee · PURCHASE_EXEC' };
        default:
          break;
      }
    }
  }
  if (hasScope(scopes, 'procurement')) {
    return { position: 'procurement', via: 'holds procurement scope' };
  }
  return { position: 'unmapped', via: 'no core match — check roster email / dual-write' };
}

/** True when the two auto resolutions disagree (override applies equally after). */
export function isCoreMismatch(rosterAuto: string, coreAuto: CoreAuto): boolean {
  return String(rosterAuto ?? '') !== coreAuto.position;
}

export function corePositionLabel(position: OrgPosition): string {
  return POSITION_META[position]?.label ?? position;
}
