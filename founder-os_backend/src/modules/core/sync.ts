// modules/core/sync.ts — roster → core_employee dual-write (Phase 1b).
// Rules (founder 2026-11-11): all four rosters; core wins once linked
// (divergence → audit row + data_correction action, roster write proceeds);
// soft-delete/deactivate → INACTIVE; new rows → auto-create + link attempt.
// This module NEVER throws: mirror failures are logged and swallowed so the
// live roster behavior can never break. Dual-runtime safe: no-ops wherever
// the core delegates are unavailable (Express/Postgres has no core tables).
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';

export type RosterSource = 'telecaller' | 'accountant' | 'digital_marketing_manager' | 'human_resources_member';

const POSITION_FOR: Record<RosterSource, (row: any) => string> = {
  telecaller: (t) =>
    t.type === 'field_staff' ? 'pos-field-exec'
    : t.type === 'team_lead' ? (t.tlLevel === 'TL2' ? 'pos-tl2' : 'pos-tl1')
    : 'pos-sales-exec',
  accountant: () => 'pos-accountant',
  digital_marketing_manager: () => 'pos-marketing-mgr',
  human_resources_member: () => 'pos-hr-exec',
};

const DEPARTMENT_FOR_POSITION: Record<string, string> = {
  'pos-founder': 'dept-mgmt',
  'pos-md': 'dept-mgmt',
  'pos-sales-head': 'dept-sales',
  'pos-tl1': 'dept-sales',
  'pos-tl2': 'dept-sales',
  'pos-sales-exec': 'dept-sales',
  'pos-field-exec': 'dept-sales',
  'pos-accounts-head': 'dept-accounts',
  'pos-accountant': 'dept-accounts',
  'pos-purchase-exec': 'dept-purchase',
  'pos-store-keeper': 'dept-inventory',
  'pos-dispatch-head': 'dept-dispatch',
  'pos-dispatch-exec': 'dept-dispatch',
  'pos-hr-exec': 'dept-hr',
  'pos-marketing-mgr': 'dept-marketing',
};

function normEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function coreDelegates(): any | null {
  const p: any = prisma as any;
  if (!p || typeof p.coreEmployee?.findMany !== 'function') return null;
  return p;
}

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Map a roster row onto the core_employee shape (identity fields only). */
function toCoreFields(source: RosterSource, row: any): Record<string, any> {
  const email =
    source === 'human_resources_member'
      ? normEmail(row.loginEmail || row.email) || null
      : normEmail(row.email) || null;
  const base: Record<string, any> = {
    fullName: String(row.name ?? ''),
    workEmail: email,
    phoneE164: row.phone ? String(row.phone) : null,
    whatsappE164: row.whatsapp ? String(row.whatsapp) : null,
    status: row.deleted === true || row.deleted === 1 || row.active === false || row.active === 0 ? 'INACTIVE' : 'ACTIVE',
    sourceTable: source,
  };
  if (source === 'telecaller') {
    base.grade = row.type === 'team_lead' ? row.tlLevel || null : null;
    base.neodoveUserId = row.neodoveUserId ?? null;
    base.neodoveUserName = row.neodoveUserName ?? null;
    base.absentSince = row.absentSince ?? null;
  } else if (source === 'accountant') {
    base.grade = row.role ? String(row.role).toLowerCase() : null;
  } else if (source === 'digital_marketing_manager') {
    const r = String(row.role ?? '').toLowerCase();
    base.grade = r === 'junior' ? 'junior' : 'senior';
  } else {
    base.grade = row.designation ? String(row.designation) : null;
  }
  return base;
}

/** Fields that always mirror (lifecycle/operational), never diverge. */
const DIRECT_FIELDS: Record<RosterSource, string[]> = {
  telecaller: ['neodoveUserId', 'neodoveUserName', 'absentSince', 'status'],
  accountant: ['status'],
  digital_marketing_manager: ['status'],
  human_resources_member: ['status'],
};

function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

async function nextEmpCode(p: any): Promise<string> {
  const rows: any[] = await p.coreEmployee.findMany({});
  let max = 0;
  for (const r of rows) {
    const m = /^EMP-(\d+)$/.exec(String(r.employeeCode ?? ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

async function writeAudit(p: any, entityId: string, operation: string, changes: Record<string, unknown>, reason: string): Promise<void> {
  await p.coreAuditEvent.create({
    data: {
      id: newId(),
      actorType: 'SYSTEM',
      actorId: null,
      source: 'roster-dual-write',
      entityType: 'core_employee',
      entityId,
      operation,
      changes: JSON.stringify(changes),
      reason,
    },
  });
}

async function openCorrectionAction(p: any, employeeId: string, title: string, changes: Record<string, unknown>): Promise<void> {
  const open: any[] = await p.coreAction.findMany({});
  if (open.some((a) => a.entityType === 'core_employee' && a.entityId === employeeId && a.category === 'data_correction' && a.status === 'OPEN')) return;
  await p.coreAction.create({
    data: {
      id: newId(),
      category: 'data_correction',
      title,
      entityType: 'core_employee',
      entityId: employeeId,
      departmentId: 'dept-sales',
      priority: 'MEDIUM',
      status: 'OPEN',
      reason: JSON.stringify(changes),
    },
  });
}

async function ensureAssignments(p: any, source: RosterSource, coreId: string, row: any): Promise<void> {
  const positionId = POSITION_FOR[source](row);
  const existing: any[] = await p.coreEmpPosition.findMany({ where: { employeeId: coreId } });
  if (!existing.some((a) => a.positionId === positionId && !a.validTo)) {
    await p.coreEmpPosition.create({
      data: { id: `ep-${coreId}`, employeeId: coreId, positionId, isPrimary: true, reason: 'roster-dual-write' },
    });
    const dept = DEPARTMENT_FOR_POSITION[positionId] ?? 'dept-sales';
    await p.coreEmpDept.create({
      data: { id: `ed-${coreId}`, employeeId: coreId, departmentId: dept, isPrimary: true, reason: 'roster-dual-write' },
    });
  }
  if (source === 'telecaller') {
    for (const [region, responsibility, suffix] of [
      [row.region, 'PRIMARY', '1'],
      [row.region2, 'SECONDARY', '2'],
    ] as Array<[unknown, string, string]>) {
      const code = String(region ?? '');
      if (!['R1', 'R2', 'R3', 'R4'].includes(code)) continue;
      if (responsibility === 'SECONDARY' && code === String(row.region ?? '')) continue;
      const regions: any[] = await p.coreEmpRegion.findMany({ where: { employeeId: coreId } });
      const regionRows: any[] = await p.coreRegion.findMany({});
      const regionId = regionRows.find((r) => r.code === code)?.id;
      if (!regionId || regions.some((a) => a.regionId === regionId && !a.validTo)) continue;
      await p.coreEmpRegion.create({
        data: { id: `er-${coreId}-${suffix}`, employeeId: coreId, regionId, responsibility, reason: 'roster-dual-write' },
      });
    }
  }
}

/**
 * Mirror one roster row into core. Accepts the fresh row or its id (refetched).
 * Create path: email-dup across core → skip + audit (precedence: first wins).
 * Update path: core wins — direct fields mirror, everything else diverges
 * into an audit row + a data_correction action. Roster callers must pass the
 * row AFTER their own write succeeded.
 */
export async function mirrorRosterRow(source: RosterSource, rowOrId: any): Promise<void> {
  try {
    const p = coreDelegates();
    if (!p) return;
    const table = (p as any)[source === 'telecaller' ? 'telecaller' : source === 'accountant' ? 'accountant' : source === 'digital_marketing_manager' ? 'digitalMarketingManager' : 'humanResourcesMember'];
    if (!table || typeof table.findUnique !== 'function') return;
    const row = typeof rowOrId === 'string' ? await table.findUnique({ where: { id: rowOrId } }) : rowOrId;
    if (!row) return;

    const existing: any = await p.coreEmployee.findUnique({ where: { id: row.id } }).catch(() => null);
    if (!existing) {
      const fields = toCoreFields(source, row);
      if (fields.workEmail) {
        const clash: any[] = await p.coreEmployee.findMany({});
        const taken = clash.some(
          (e) => e.id !== row.id && normEmail(e.workEmail) === normEmail(fields.workEmail) && normEmail(e.workEmail) !== '',
        );
        if (taken) {
          await writeAudit(p, row.id, 'skipped_duplicate', { source, email: fields.workEmail }, 'roster-dual-write: email already held by another core employee (precedence: first wins)');
          return;
        }
      }
      const employeeCode = source === 'human_resources_member' && row.employeeCode ? String(row.employeeCode) : await nextEmpCode(p);
      await p.coreEmployee.create({ data: { id: row.id, employeeCode, ...fields } });
      await ensureAssignments(p, source, row.id, row);
      if (fields.workEmail) {
        const linkable: any = await p.coreUserLink.findMany({}).catch(() => []);
        if (!linkable.some((l: any) => l.employeeId === row.id)) {
          // Link resolved lazily: match auth_user by email at read time (Phase 2).
        }
      }
      await writeAudit(p, row.id, 'create', { source }, `roster-dual-write: auto-created from ${source}`);
      return;
    }

    const fields = toCoreFields(source, row);
    const updates: Record<string, unknown> = {};
    const divergent: Record<string, { core: unknown; roster: unknown }> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'sourceTable') continue;
      if (sameValue(existing[k], v)) continue;
      if (DIRECT_FIELDS[source].includes(k)) updates[k] = v;
      else divergent[k] = { core: existing[k] ?? null, roster: v ?? null };
    }
    if (Object.keys(updates).length) {
      await p.coreEmployee.update({ where: { id: row.id }, data: { ...updates, updatedAt: new Date().toISOString() } });
      await writeAudit(p, row.id, 'update', { source, fields: Object.keys(updates) }, 'roster-dual-write: lifecycle/operational mirror');
    }
    if (Object.keys(divergent).length) {
      await writeAudit(p, row.id, 'roster_divergence', { source, divergent }, 'roster-dual-write: core wins — manager confirm required');
      await openCorrectionAction(p, row.id, `Confirm ${existing.fullName || row.id} roster change`, divergent);
    }
    await ensureAssignments(p, source, row.id, row);
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message, source }, 'mirrorRosterRow failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Hard-delete path (telecaller): core rows are never deleted — INACTIVE + audit. */
export async function mirrorRosterRemoved(source: RosterSource, id: string): Promise<void> {
  try {
    const p = coreDelegates();
    if (!p) return;
    const existing: any = await p.coreEmployee.findUnique({ where: { id } }).catch(() => null);
    if (!existing || existing.status === 'INACTIVE') return;
    await p.coreEmployee.update({ where: { id }, data: { status: 'INACTIVE', updatedAt: new Date().toISOString() } });
    await writeAudit(p, id, 'update', { source, fields: ['status'] }, 'roster-dual-write: roster row removed → INACTIVE (never deleted)');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message, source }, 'mirrorRosterRemoved failed (non-blocking)');
    } catch { /* never throw */ }
  }
}
