// Employee leave applications: apply → HR decision, on the ONE leave table.
//
// Deliberately free of dashboard/service imports so `service-parts/io.ts` can
// reuse `listPendingLeaveRequests()` without an import cycle. The route pins the
// member id (never the request body) and passes the caller's own roster id in.
import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { istDateStr, text } from './parse';
import { invalidateHumanResourcesCache } from './cache';
import { leaveJson, validateLeave } from './leaves';
import {
  cleanLeaveRequest, decisionNoteError, MIN_NOTE_CHARS,
} from './leave-requests-parse';
import { LEAVE_REQUEST_STATUSES } from './types';

const REQUESTS_TAKE = 500;

function sortRequests(rows: any[]) {
  const isPending = (row: any) => String(row.status ?? 'approved') === 'pending';
  return rows.slice().sort((a, b) => {
    const pa = isPending(a);
    const pb = isPending(b);
    if (pa !== pb) return pa ? -1 : 1;
    const byDate = String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''));
    // Pending: soonest date first (what needs attention). Decided: newest first.
    return pa ? byDate : -byDate;
  });
}

async function memberNameMap(memberIds: string[]) {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return new Map<string, any>();
  const rows = (await prisma.humanResourcesMember.findMany({ where: { id: { in: ids } } })) as any[];
  return new Map(rows.map((row) => [String(row.id), row]));
}

function withMember(row: any, byId: Map<string, any>) {
  return leaveJson({ ...row, member: byId.get(String(row.memberId)) ?? null });
}

/** One employee's own leave history (every status), newest first. */
export async function listMyLeave(memberId: string) {
  const rows = (await prisma.humanResourcesLeave.findMany({
    where: { memberId: String(memberId), deleted: false },
    orderBy: [{ startDate: 'desc' }],
    take: 200,
  })) as any[];
  return sortRequests(rows).map((row) => leaveJson(row));
}

/** HR queue: every application regardless of month (the leave section is
 *  month-scoped for records, but pending work must never hide in another month). */
export async function listLeaveRequests(status?: unknown) {
  const where: any = { deleted: false };
  const wanted = String(status ?? 'all');
  if (wanted !== 'all' && (LEAVE_REQUEST_STATUSES as readonly string[]).includes(wanted)) {
    where.status = wanted;
  }
  const rows = (await prisma.humanResourcesLeave.findMany({
    where,
    orderBy: [{ startDate: 'desc' }],
    take: REQUESTS_TAKE,
  })) as any[];
  const byId = await memberNameMap(rows.map((row) => String(row.memberId)));
  return sortRequests(rows).map((row) => withMember(row, byId));
}

/** Pending applications for the HR dashboard payload (badge + short list). */
export async function listPendingLeaveRequests(limit = 20) {
  const rows = (await prisma.humanResourcesLeave.findMany({
    where: { deleted: false, status: 'pending' },
    orderBy: [{ startDate: 'asc' }],
    take: Math.min(Math.max(Number(limit) || 20, 1), 100),
  })) as any[];
  const byId = await memberNameMap(rows.map((row) => String(row.memberId)));
  const pending = rows.map((row) => withMember(row, byId));
  return { pendingCount: pending.length, pending };
}

/** Employee applies. Days are computed here (server-only rule), never trusted
 *  from the client; the member is the caller's own roster record. */
export async function applyLeaveRequest(
  input: Record<string, any>,
  memberId: string,
  actor: string | null,
) {
  const clean = cleanLeaveRequest(input ?? {}, istDateStr());
  const days = await validateLeave({ ...clean, memberId });
  const row: any = await prisma.humanResourcesLeave.create({
    data: {
      memberId: String(memberId),
      ...clean,
      days,
      status: 'pending',
      requestedBy: actor,
      createdBy: actor,
      updatedBy: actor,
    },
  });
  await invalidateHumanResourcesCache();
  return leaveJson(row);
}

/** Employee withdraws their own still-undecided request. */
export async function cancelLeaveRequest(id: string, memberId: string, actor: string | null) {
  const row: any = await prisma.humanResourcesLeave.findUnique({ where: { id: String(id) } });
  if (!row || row.deleted) throw new HrError('leave request not found', 404);
  if (String(row.memberId) !== String(memberId)) {
    throw new HrError('you can only withdraw your own leave request', 403);
  }
  if (String(row.status ?? 'approved') !== 'pending') {
    throw new HrError('only a pending request can be withdrawn — ask HR to change an approved leave', 409);
  }
  await prisma.humanResourcesLeave.update({
    where: { id: String(id) },
    data: { deleted: true, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return { ok: true };
}

/** HR approves or rejects. A rejection always carries a note the employee sees.
 *  Nobody decides their own application (root excepted). */
export async function decideLeaveRequest(opts: {
  id: string;
  action: unknown;
  note?: unknown;
  actor: string | null;
  approverMemberId: string | null;
  isRoot: boolean;
}) {
  const action = String(opts.action ?? '').trim();
  if (action !== 'approve' && action !== 'reject') {
    throw new HrError("action must be 'approve' or 'reject'");
  }
  const row: any = await prisma.humanResourcesLeave.findUnique({ where: { id: String(opts.id) } });
  if (!row || row.deleted) throw new HrError('leave request not found', 404);
  if (String(row.status ?? 'approved') !== 'pending') {
    throw new HrError('this request has already been decided', 409);
  }
  if (!opts.isRoot && opts.approverMemberId && String(row.memberId) === String(opts.approverMemberId)) {
    throw new HrError('you cannot approve or reject your own leave request', 403);
  }
  const note = text(opts.note, 1000);
  const noteError = decisionNoteError(action, note);
  if (noteError) throw new HrError(noteError);
  if (note && note.length < MIN_NOTE_CHARS) throw new HrError('decision note is too short');

  const updated: any = await prisma.humanResourcesLeave.update({
    where: { id: String(row.id) },
    data: {
      status: action === 'approve' ? 'approved' : 'rejected',
      decidedBy: opts.actor,
      decidedAt: new Date(),
      decisionNote: note || null,
      updatedBy: opts.actor,
    },
  });
  await invalidateHumanResourcesCache();
  return leaveJson(updated);
}
