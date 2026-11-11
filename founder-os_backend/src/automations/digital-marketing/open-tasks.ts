import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { invalidateDigitalMarketingCache } from './service';

// ── Open Tasks tab: free-form tasks with start/end + per-day progress (migration 0120) ──
// Manual status (open|done tick, dates display-only). One editable note per day
// (taskId+date unique, overwritten in place). Files live at BOTH levels in one
// table: task-level rows have entryId NULL, daily proof rows point at an entry.
// Mirror: frontend src/components/DigitalMarketingOpenTasks.tsx.

export type OpenTaskStatus = 'open' | 'done';

export interface OpenTaskAttachmentJson {
  id: string;
  entryId: string | null;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface OpenTaskEntryJson {
  id: string;
  date: string;
  note: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  attachments: OpenTaskAttachmentJson[];
}

export interface OpenTaskRow {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  status: OpenTaskStatus;
  doneAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  entries: OpenTaskEntryJson[];
  attachments: OpenTaskAttachmentJson[];
}

const OPEN_TASKS_TTL_MS = 5 * 60 * 1000;
const OPEN_TASKS_CACHE_KEY = 'digital-marketing:dashboard:open-tasks:registry';

function isDay(s: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').slice(0, 10));
}

function durationDaysBetween(from: string, end: string): number | null {
  if (!isDay(from) || !isDay(end)) return null;
  const ms = Date.parse(end.slice(0, 10)) - Date.parse(from.slice(0, 10));
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}

function toAttachmentJson(row: any): OpenTaskAttachmentJson {
  return {
    id: String(row?.id ?? ''),
    entryId: row?.entryId ? String(row.entryId) : null,
    fileName: String(row?.fileName ?? ''),
    mime: String(row?.mime ?? 'application/octet-stream'),
    size: Number(row?.size ?? 0),
    uploadedBy: String(row?.uploadedBy ?? ''),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
    url: `/api/digital-marketing/open-tasks/files/${String(row?.id ?? '')}`,
  };
}

function toEntryJson(entry: any, files: any[]): OpenTaskEntryJson {
  return {
    id: String(entry.id),
    date: String(entry.date ?? '').slice(0, 10),
    note: String(entry.note ?? ''),
    updatedBy: String(entry.updatedBy ?? ''),
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt ?? ''),
    updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : String(entry.updatedAt ?? ''),
    attachments: (files as any[]).map(toAttachmentJson),
  };
}

function toTaskJson(task: any, entries: any[], files: any[]): OpenTaskRow {
  const start = String(task.startDate ?? '').slice(0, 10);
  const end = String(task.endDate ?? '').slice(0, 10);
  const byEntry = new Map<string, any[]>();
  for (const f of files as any[]) {
    if (!f?.entryId) continue;
    const k = String(f.entryId);
    if (!byEntry.has(k)) byEntry.set(k, []);
    byEntry.get(k)!.push(f);
  }
  const taskFiles = (files as any[]).filter((f) => !f?.entryId);
  return {
    id: String(task.id),
    title: String(task.title ?? ''),
    description: String(task.description ?? ''),
    startDate: start,
    endDate: end,
    durationDays: durationDaysBetween(start, end),
    status: String(task.status) === 'done' ? 'done' : 'open',
    doneAt: task.doneAt ? String(task.doneAt) : null,
    createdBy: task.createdBy ?? null,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : String(task.createdAt ?? ''),
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : String(task.updatedAt ?? ''),
    entries: (entries as any[]).map((e) => toEntryJson(e, byEntry.get(String(e.id)) ?? [])),
    attachments: taskFiles.map(toAttachmentJson),
  };
}

async function computeOpenTasks(): Promise<{ rows: OpenTaskRow[]; total: number; generatedAt: string }> {
  const tasks = await (prisma as any).digitalMarketingOpenTask.findMany({
    orderBy: { startDate: 'desc' },
    take: 500,
  }).catch(() => []);
  const ids = (tasks as any[]).map((t) => String(t.id)).filter(Boolean);
  let entries: any[] = [];
  let files: any[] = [];
  if (ids.length) {
    entries = await (prisma as any).digitalMarketingOpenTaskEntry.findMany({
      where: { taskId: { in: ids } },
      orderBy: { date: 'asc' },
    }).catch(() => []);
    files = await (prisma as any).digitalMarketingOpenTaskAttachment.findMany({
      where: { taskId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []);
  }
  const entriesByTask = new Map<string, any[]>();
  for (const e of entries as any[]) {
    const k = String((e as any).taskId);
    if (!entriesByTask.has(k)) entriesByTask.set(k, []);
    entriesByTask.get(k)!.push(e);
  }
  const filesByTask = new Map<string, any[]>();
  for (const f of files as any[]) {
    const k = String((f as any).taskId);
    if (!filesByTask.has(k)) filesByTask.set(k, []);
    filesByTask.get(k)!.push(f);
  }
  const rows = (tasks as any[]).map((t) =>
    toTaskJson(t, entriesByTask.get(String(t.id)) ?? [], filesByTask.get(String(t.id)) ?? []));
  // Open first, then newest start.
  const rank = (s: OpenTaskStatus) => (s === 'open' ? 0 : 1);
  rows.sort((a, b) => rank(a.status) - rank(b.status)
    || (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return { rows, total: rows.length, generatedAt: new Date().toISOString() };
}

export async function getDigitalMarketingOpenTasks(): Promise<{ rows: OpenTaskRow[]; total: number; generatedAt: string }> {
  return cached(OPEN_TASKS_CACHE_KEY, OPEN_TASKS_TTL_MS, computeOpenTasks);
}

export async function getOpenTaskById(id: string): Promise<any> {
  return (prisma as any).digitalMarketingOpenTask.findUnique({ where: { id } });
}

function cleanTaskInput(input: Record<string, any>, partial = false) {
  const data: Record<string, any> = {};
  if (input.title !== undefined || !partial) {
    const title = String(input.title || '').trim().slice(0, 200);
    if (!title && !partial) throw new Error('title required');
    if (title) data.title = title;
  }
  if (input.description !== undefined || !partial) {
    data.description = String(input.description || '').trim().slice(0, 4000);
  }
  if (input.startDate !== undefined || !partial) {
    const s = String(input.startDate || '').slice(0, 10);
    if (!isDay(s) && !partial) throw new Error('startDate required (YYYY-MM-DD)');
    if (s) {
      if (!isDay(s)) throw new Error('startDate must be YYYY-MM-DD');
      data.startDate = s;
    }
  }
  if (input.endDate !== undefined || !partial) {
    const e = String(input.endDate || '').slice(0, 10);
    if (!isDay(e) && !partial) throw new Error('endDate required (YYYY-MM-DD)');
    if (e) {
      if (!isDay(e)) throw new Error('endDate must be YYYY-MM-DD');
      data.endDate = e;
    }
  }
  if (input.status !== undefined) {
    const s = String(input.status);
    if (!['open', 'done'].includes(s)) throw new Error('status must be open|done');
    data.status = s;
  }
  return data;
}

export async function createOpenTask(input: Record<string, any>, createdBy: string | null) {
  const data = cleanTaskInput(input);
  const end = String(data.endDate ?? '').slice(0, 10);
  const start = String(data.startDate ?? '').slice(0, 10);
  if (end < start) throw new Error('endDate must be on or after startDate');
  data.status = 'open';
  const row = await (prisma as any).digitalMarketingOpenTask.create({
    data: { ...data, createdBy: createdBy ? String(createdBy).slice(0, 200) : null },
  });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function updateOpenTask(id: string, input: Record<string, any>) {
  const current: any = await (prisma as any).digitalMarketingOpenTask.findUnique({ where: { id } });
  if (!current) throw new Error('task not found');
  const data = cleanTaskInput(input, true);
  const start = String(data.startDate ?? current.startDate ?? '').slice(0, 10);
  const end = String(data.endDate ?? current.endDate ?? '').slice(0, 10);
  if (end < start) throw new Error('endDate must be on or after startDate');
  // Manual status: done tick stamps doneAt, reopening clears it.
  if (data.status === 'done' && String(current.status) !== 'done') {
    data.doneAt = new Date().toISOString();
  } else if (data.status === 'open' && String(current.status) === 'done') {
    data.doneAt = null;
  }
  const row = await (prisma as any).digitalMarketingOpenTask.update({ where: { id }, data });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function deleteOpenTask(id: string) {
  const files: any[] = await (prisma as any).digitalMarketingOpenTaskAttachment
    .findMany({ where: { taskId: id } }).catch(() => []);
  await (prisma as any).digitalMarketingOpenTaskAttachment.deleteMany({ where: { taskId: id } }).catch(() => {});
  await (prisma as any).digitalMarketingOpenTaskEntry.deleteMany({ where: { taskId: id } }).catch(() => {});
  await (prisma as any).digitalMarketingOpenTask.delete({ where: { id } });
  await invalidateDigitalMarketingCache();
  return { ok: true as const, attachments: files };
}

export async function upsertOpenTaskEntry(taskId: string, date: string, note: unknown, updatedBy: string | null) {
  const task: any = await (prisma as any).digitalMarketingOpenTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('task not found');
  const d = String(date || '').slice(0, 10);
  if (!isDay(d)) throw new Error('date must be YYYY-MM-DD');
  const text = String(note ?? '').slice(0, 5000);
  const existing: any = await (prisma as any).digitalMarketingOpenTaskEntry
    .findFirst({ where: { taskId, date: d } }).catch(() => null);
  let row: any;
  if (existing) {
    row = await (prisma as any).digitalMarketingOpenTaskEntry.update({
      where: { id: String(existing.id) },
      data: { note: text, updatedBy: updatedBy ? String(updatedBy).slice(0, 200) : '' },
    });
  } else {
    row = await (prisma as any).digitalMarketingOpenTaskEntry.create({
      data: { taskId, date: d, note: text, updatedBy: updatedBy ? String(updatedBy).slice(0, 200) : '' },
    });
  }
  await invalidateDigitalMarketingCache();
  return row;
}

export async function createOpenTaskAttachment(input: {
  taskId: string; entryId?: string | null; fileName: string; mime: string; size: number; kvKey: string; uploadedBy: string | null;
}) {
  const task: any = await (prisma as any).digitalMarketingOpenTask.findUnique({ where: { id: input.taskId } });
  if (!task) throw new Error('task not found');
  let entryId: string | null = null;
  if (input.entryId) {
    const entry: any = await (prisma as any).digitalMarketingOpenTaskEntry
      .findFirst({ where: { id: String(input.entryId), taskId: input.taskId } }).catch(() => null);
    if (!entry) throw new Error('entry not found for this task');
    entryId = String(entry.id);
  }
  const row = await (prisma as any).digitalMarketingOpenTaskAttachment.create({
    data: {
      taskId: input.taskId,
      entryId,
      fileName: input.fileName.slice(0, 200),
      mime: input.mime,
      size: Math.max(0, Math.floor(input.size)),
      kvKey: input.kvKey,
      uploadedBy: String(input.uploadedBy || '').slice(0, 200),
      createdAt: new Date(),
    },
  });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function ensureEntryForDate(taskId: string, date: string, updatedBy: string | null) {
  const d = String(date || '').slice(0, 10);
  if (!isDay(d)) throw new Error('date must be YYYY-MM-DD');
  const existing: any = await (prisma as any).digitalMarketingOpenTaskEntry
    .findFirst({ where: { taskId, date: d } }).catch(() => null);
  if (existing) return existing;
  const task: any = await (prisma as any).digitalMarketingOpenTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('task not found');
  const row = await (prisma as any).digitalMarketingOpenTaskEntry.create({
    data: { taskId, date: d, note: '', updatedBy: updatedBy ? String(updatedBy).slice(0, 200) : '' },
  });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function getOpenTaskAttachment(id: string) {
  return (prisma as any).digitalMarketingOpenTaskAttachment.findUnique({ where: { id } });
}

export async function deleteOpenTaskAttachment(id: string) {
  const row: any = await (prisma as any).digitalMarketingOpenTaskAttachment.findUnique({ where: { id } });
  if (!row) throw new Error('Attachment not found');
  await (prisma as any).digitalMarketingOpenTaskAttachment.delete({ where: { id } });
  await invalidateDigitalMarketingCache();
  return row;
}

export { toAttachmentJson as toOpenTaskAttachmentJson };
