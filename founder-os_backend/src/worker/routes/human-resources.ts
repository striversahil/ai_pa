// ─────────────────────────────────────────────────────────────────────────────
// routes/human-resources.ts — Human Resources automation API.
// Worker-only: Express is frozen (no parallel mirror for new endpoints).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, notifyLive, readSessionCookie, LiveEvent, type Bindings,
} from '../context';
import { HrError } from '../../automations/human-resources/errors';
import {
  createExpense, createTask, deleteExpense, deleteTask,
  resolveSelfHumanResourcesMember, updateExpense, updateTask,
} from '../../automations/human-resources/service';
import {
  applySalaryPlan, createEmployee, deleteEmployee, getEmployee, listEmployees,
  reapplySalaryPlan, saveSalaryComponents, updateEmployee,
} from '../../automations/human-resources/employees';
import {
  createTemplate, deleteTemplate, getTemplate, listTemplates, previewSalary,
  setDefaultTemplate, updateTemplate,
} from '../../automations/human-resources/templates';
import { attendanceSummary, listAttendance, saveAttendance } from '../../automations/human-resources/attendance';
import { createLeave, deleteLeave, listLeaves, updateLeave } from '../../automations/human-resources/leaves';
import { createHoliday, deleteHoliday, listHolidays, updateHoliday } from '../../automations/human-resources/holidays';
import { generatePayroll, listPayroll, setSlipStatus, updateSlipLines } from '../../automations/human-resources/payroll';
import {
  createInventoryItem, deleteInventoryItem, deleteInventoryTransaction,
  getInventorySnapshot, listInventoryItems, listInventoryTransactions,
  recordInventoryTransaction, updateInventoryItem,
} from '../../automations/human-resources/inventory';
import {
  createHiringPosition, createPositionDoc, deleteHiringPosition, deletePositionDoc, getPositionDoc,
  importHiringPositions, listHiringPositions, renameHiringPosition,
} from '../../automations/human-resources/hiring-positions';
import {
  defaultDocTitle, isHiringDocKind, isPdfUpload, MAX_HIRING_DOC_BYTES,
} from '../../automations/human-resources/hiring-positions-parse';

function actorLabel(me: any): string | null {
  return me?.user?.name ?? me?.user?.email ?? null;
}

async function access(c: any) {
  const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
  if (!me) return { me: null, canManage: false, error: c.json({ error: 'Authentication required' }, 401) };
  const scopes = (me.scopes ?? []) as string[];
  if (!me.isAdmin && !scopes.includes('mis') && !scopes.includes('human-resources')) {
    return { me, canManage: false, error: c.json({ error: "Requires 'human-resources' permission" }, 403) };
  }
  return {
    me,
    canManage: !!me.isAdmin || scopes.includes('mis') || scopes.includes('human-resources'),
    error: null,
  };
}

function errorResponse(c: any, e: unknown) {
  if (e instanceof HrError) return c.json({ error: e.message }, e.status as any);
  return c.json({ error: (e as any)?.message ?? 'request failed' }, 400);
}

export function registerHumanResourcesRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Employee master (HR/MIS full access) ────────────────────────────────
  app.get('/api/human-resources/members', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json({ members: await listEmployees(c.req.query('deleted') === '1') });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/human-resources/members/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json(await getEmployee(c.req.param('id') ?? ''));
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/members', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createEmployee(body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/members/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateEmployee(c.req.param('id') ?? '', body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/members/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      await deleteEmployee(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.put('/api/human-resources/members/:id/salary-components', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await saveSalaryComponents(c.req.param('id') ?? '', body?.salaryComponents);
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.put('/api/human-resources/members/:id/salary-plan', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await applySalaryPlan(c.req.param('id') ?? '', body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/members/:id/salary-plan/reapply', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      const row = await reapplySalaryPlan(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Salary templates + formula preview ──────────────────────────────────
  app.get('/api/human-resources/salary-templates', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try { return c.json({ templates: await listTemplates() }); }
    catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/human-resources/salary-templates/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try { return c.json(await getTemplate(c.req.param('id') ?? '')); }
    catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/salary-templates', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createTemplate(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/salary-templates/preview', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try { return c.json(await previewSalary(body || {})); }
    catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/salary-templates/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateTemplate(c.req.param('id') ?? '', body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/salary-templates/:id/default', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      const row = await setDefaultTemplate(c.req.param('id') ?? '', actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/salary-templates/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      await deleteTemplate(c.req.param('id') ?? '', actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Attendance ──────────────────────────────────────────────────────────
  app.get('/api/human-resources/attendance', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      const date = String(c.req.query('date') ?? '').slice(0, 10);
      return c.json(await listAttendance(date));
    } catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/human-resources/attendance/summary', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json({ rows: await attendanceSummary(String(c.req.query('month') ?? '')) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.put('/api/human-resources/attendance', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const out = await saveAttendance(body?.rows, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(out);
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Leave + holiday calendar ────────────────────────────────────────────
  app.get('/api/human-resources/leaves', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json({ leaves: await listLeaves({
        month: c.req.query('month'), memberId: c.req.query('memberId'),
      }) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/leaves', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createLeave(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/leaves/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateLeave(c.req.param('id') ?? '', body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/leaves/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      await deleteLeave(c.req.param('id') ?? '', actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/human-resources/holidays', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json({ holidays: await listHolidays(c.req.query('year')) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/holidays', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createHoliday(body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/holidays/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateHoliday(c.req.param('id') ?? '', body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/holidays/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      await deleteHoliday(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Payroll ─────────────────────────────────────────────────────────────
  app.get('/api/human-resources/payroll', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json(await listPayroll(c.req.query('month')));
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/payroll/generate', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const out = await generatePayroll(body?.month, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(out);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/payroll/slips/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const id = c.req.param('id') ?? '';
      const row = body?.action
        ? await setSlipStatus(id, String(body.action), actorLabel(a.me))
        : await updateSlipLines(id, body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Delegated tasks ─────────────────────────────────────────────────────
  app.post('/api/human-resources/tasks', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can create or assign HR tasks' }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createTask(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/tasks/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const self = a.canManage
        ? null
        : await resolveSelfHumanResourcesMember(null, a.me as any).catch(() => null);
      const row = await updateTask(
        c.req.param('id') ?? '', body || {}, actorLabel(a.me),
        { canManage: a.canManage, selfId: self?.selfId ?? null },
      );
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/tasks/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can delete HR tasks' }, 403);
    try {
      await deleteTask(c.req.param('id') ?? '', actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });


  // ── Inventory / daily-item stock ────────────────────────────────────────
  app.get('/api/human-resources/inventory/items', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const includeDeleted = c.req.query('deleted') === '1';
    if (includeDeleted && !a.canManage) return c.json({ error: 'Only HR/MIS users can view removed inventory items' }, 403);
    try {
      return c.json({ items: await listInventoryItems(includeDeleted) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/human-resources/inventory/snapshot', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json(await getInventorySnapshot(c.req.query('month') ?? undefined));
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/inventory/items', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can add inventory items' }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createInventoryItem(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/inventory/items/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can edit inventory items' }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateInventoryItem(c.req.param('id') ?? '', body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/inventory/items/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can remove inventory items' }, 403);
    try {
      await deleteInventoryItem(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/human-resources/inventory/items/:id/transactions', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json({ transactions: await listInventoryTransactions(c.req.param('id') ?? '', c.req.query('month')) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/inventory/transactions', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const out = await recordInventoryTransaction(body || {}, actorLabel(a.me), { canManage: a.canManage });
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(out, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/inventory/transactions/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can delete stock movements' }, 403);
    try {
      await deleteInventoryTransaction(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Expense ledger ──────────────────────────────────────────────────────
  app.post('/api/human-resources/expenses', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createExpense(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/expenses/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateExpense(
        c.req.param('id') ?? '', body || {}, actorLabel(a.me), { canManage: a.canManage },
      );
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/expenses/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      await deleteExpense(c.req.param('id') ?? '', actorLabel(a.me), { canManage: a.canManage });
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Hiring kit: JD + SOP PDFs per position (many per role) ──────────────
  // PDF bytes live in CHAT_FILES KV (`hrdocs/<uuid>.pdf`); D1 keeps metadata.
  // Read/upload/delete are all HR/MIS-only (same `access()` gate as the rest
  // of the HR dashboard) — no public document URLs.
  app.get('/api/human-resources/hiring-positions', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json({ positions: await listHiringPositions(), canManage: a.canManage });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/hiring-positions', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can add positions' }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createHiringPosition(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/human-resources/hiring-positions/import', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can add positions' }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const out = await importHiringPositions(body?.names, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(out);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/human-resources/hiring-positions/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can rename positions' }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await renameHiringPosition(c.req.param('id') ?? '', body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/human-resources/hiring-positions/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can remove positions' }, 403);
    try {
      const { kvKeys } = await deleteHiringPosition(c.req.param('id') ?? '');
      if (c.env.CHAT_FILES) {
        for (const key of kvKeys) {
          try { await c.env.CHAT_FILES.delete(key); } catch { /* bytes best-effort */ }
        }
      }
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // Add a JD / SOP PDF to a position (a role can hold many of each).
  app.post('/api/human-resources/hiring-positions/:id/docs', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can upload hiring documents' }, 403);
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data' }, 400);
    }
    const kind = String(form.get('kind') || 'jd').trim().toLowerCase();
    if (!isHiringDocKind(kind)) return c.json({ error: "kind must be 'jd' or 'sop'" }, 400);
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    if (!isPdfUpload(file.name, file.type)) return c.json({ error: 'Only PDF files are accepted' }, 400);
    if (file.size > MAX_HIRING_DOC_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const title = String(form.get('title') || '').replace(/\s+/g, ' ').trim().slice(0, 200)
      || defaultDocTitle(file.name, kind);
    const key = `hrdocs/${crypto.randomUUID()}.pdf`;
    try {
      await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
        metadata: { name: file.name, type: 'application/pdf' },
      });
    } catch {
      return c.json({ error: 'Could not store the PDF — please retry' }, 502);
    }
    try {
      const doc = await createPositionDoc({
        positionId: c.req.param('id') ?? '',
        kind,
        title,
        fileName: file.name.slice(0, 200),
        mime: 'application/pdf',
        size: file.size,
        kvKey: key,
        uploadedBy: String(actorLabel(a.me) ?? '').slice(0, 200),
      });
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true, doc }, 201);
    } catch (e) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return errorResponse(c, e);
    }
  });

  app.delete('/api/human-resources/position-docs/:id', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: 'Only HR/MIS users can remove hiring documents' }, 403);
    try {
      const { kvKey } = await deletePositionDoc(c.req.param('id') ?? '');
      if (kvKey && c.env.CHAT_FILES) {
        try { await c.env.CHAT_FILES.delete(kvKey); } catch { /* best-effort */ }
      }
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // Serve the PDF inline (never exposes the raw KV key). Session-gated, so the
  // dashboard's iframe viewer works while direct links stay private.
  app.get('/api/human-resources/position-docs/:id/file', async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const row = await getPositionDoc(c.req.param('id') ?? '').catch(() => null);
    if (!row?.kvKey) return c.json({ error: 'Document not found' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.kvKey), 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'Document file is missing' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    // Header values must be byte-safe: strip non-ASCII/quote characters so a
    // unicode filename can never throw while serving the PDF.
    const safeName = String(row.fileName || 'document.pdf')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '') || 'document.pdf';
    headers.set('Content-Disposition', `inline; filename="${safeName}"`);
    headers.set('Cache-Control', 'private, max-age=300');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(obj.value, { headers });
  });
}
