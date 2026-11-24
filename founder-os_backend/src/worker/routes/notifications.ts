// ─────────────────────────────────────────────────────────────────────────────
// routes/notifications.ts — the bell panel + the rule console.
//
// Reads (any approved login): own in-app notifications from the existing
// `core_notification` inbox, enriched with the escalation level/colour the
// engine stored beside it (hlp_notification_delivery). Newest first, hard cap
// 200 — the "audit visible from the frontend" limit.
//
// Writes (root/admin): author rules, dry-run them, fire them, edit the level
// palette + caps. Root may read another person's inbox with ?employeeKey=.
//
// The legacy Phase-6a handlers in routes/work.ts still exist; this module is
// registered BEFORE it so /api/notifications resolves here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { getViewerMe } from '../viewer';
import { readBody, writeError } from '../http';
import { markNotificationRead } from '../../modules/core/notify';
import { normalizeLevels } from '../../modules/notifications/levels';
import { evaluateRule } from '../../modules/notifications/engine';
import { parseRuleInput } from '../../modules/notifications/parse';
import {
  deleteRule,
  employeeKeyForAuthUser,
  employeeKeyForEmail,
  getNotificationRow,
  getRule,
  listDeliveries,
  listRules,
  loadNotificationConfig,
  loadPrompt,
  readPanel,
  saveNotificationConfig,
  savePrompt,
  saveRule,
  unreadCount,
} from '../../modules/notifications/store';
import { DEFAULT_NOTIFICATION_PROMPT } from '../../modules/notifications/prompt';
import { loadNotificationSchema } from '../../modules/notifications/schema';
import { loadSeats, loadRolesByEmail } from '../../modules/notifications/targets';
import { nextDueAt } from '../../modules/notifications/window';
import { templateTokens, BUILTIN_TOKENS } from '../../modules/notifications/template';
import { NotificationInputError } from '../../modules/notifications/types';

const PANEL_LIMIT = 200;

const SAMPLE_SQL = `-- one row per person: telecaller_id + value + level (1..5)
SELECT d.telecallerId AS telecaller_id,
       SUM(CASE WHEN d.status = 'CONNECTED' THEN 1 ELSE 0 END) AS value,
       SUM(CASE WHEN d.status = 'CONNECTED' THEN 1 ELSE 0 END) AS hourly_connected_call,
       CASE
         WHEN SUM(CASE WHEN d.status = 'CONNECTED' THEN 1 ELSE 0 END) = 0 THEN 5
         WHEN SUM(CASE WHEN d.status = 'CONNECTED' THEN 1 ELSE 0 END) < 2 THEN 4
         WHEN SUM(CASE WHEN d.status = 'CONNECTED' THEN 1 ELSE 0 END) < 4 THEN 3
         ELSE 1
       END AS level
  FROM DeviceCall d
 WHERE d.attemptAt >= ?1 AND d.attemptAt < ?2
 GROUP BY d.telecallerId`;

const SAMPLE_TEMPLATE = '{AGENT_NAME} heads up you only have {HOURLY_CONNECTED_CALL} in last hour please improve your calling activity in the next hours';

async function viewerOrNull(c: any) {
  const me = await getViewerMe(c);
  return me;
}

function dbOf(c: any): any {
  return (c.env as any)?.DB;
}

function canAuthor(me: any): boolean {
  return !!me && (me.isRoot === true || me.isAdmin === true);
}

async function myEmployeeKey(db: any, me: any): Promise<string> {
  if (!me?.user?.id) return '';
  const byEmail = await employeeKeyForEmail(db, me.user.email ?? '');
  if (byEmail) return byEmail;
  return employeeKeyForAuthUser(db, me.user.id);
}

async function optionsPayload(db: any): Promise<any> {
  const [seats, roles] = await Promise.all([loadSeats(db, { includeInactive: false }), loadRolesByEmail(db)]);
  const uniq = (values: string[]) => [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))].sort();
  const roleRows: Array<{ key: string; position: string }> = [];
  try {
    const res = await db.prepare(`SELECT "key", "label", "position" FROM "auth_role" ORDER BY "key"`).all();
    for (const r of (res?.results ?? []) as any[]) roleRows.push({ key: String(r.key), position: String(r.position ?? '') });
  } catch { /* roles optional */ }
  return {
    positions: uniq(seats.map((s) => s.position)),
    departments: uniq(seats.map((s) => s.department)),
    regions: uniq(seats.map((s) => s.region)),
    rosterTypes: uniq(seats.map((s) => s.rosterType)),
    roles: roleRows,
    people: seats.map((s) => ({ employeeKey: s.employeeKey, name: s.name, position: s.position, department: s.department, region: s.region })),
    placeholders: [...BUILTIN_TOKENS],
    sampleSql: SAMPLE_SQL,
    sampleTemplate: SAMPLE_TEMPLATE,
    roleCount: roles.size,
  };
}

export function registerNotificationRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Panel ─────────────────────────────────────────────────────────────────
  app.get('/api/notifications', async (c) => {
    try {
      const me = await viewerOrNull(c);
      if (!me) return c.json({ error: 'Authentication required' }, 401);
      const db = dbOf(c);
      if (!db) return c.json({ notifications: [], unread: 0, levels: normalizeLevels(null) });
      const config = await loadNotificationConfig(db);
      const requested = String(c.req.query('employeeKey') ?? '').trim();
      const employeeKey = me.isRoot && requested ? requested : await myEmployeeKey(db, me);
      if (!employeeKey) {
        // An unlinked login has no inbox yet — never an error.
        return c.json({ notifications: [], unread: 0, levels: config.levels, employeeKey: '', canAuthor: canAuthor(me), unlinked: true });
      }
      const status = String(c.req.query('status') ?? 'all');
      const level = Number(c.req.query('level') ?? 0) || null;
      const limit = Math.min(PANEL_LIMIT, Math.max(1, Number(c.req.query('limit') ?? PANEL_LIMIT) || PANEL_LIMIT));
      const [notifications, unread] = await Promise.all([
        readPanel(db, employeeKey, {
          status: status === 'unread' ? 'unread' : status === 'read' ? 'read' : 'all',
          level,
          limit,
        }),
        unreadCount(db, employeeKey),
      ]);
      const enriched = notifications.map((n) => {
        const def = config.levels.find((l) => l.level === n.level) ?? config.levels[1];
        return {
          ...n,
          level: def.level,
          colorHex: n.colorHex || def.hexColor,
          colorName: def.colorName,
          levelLabel: def.label,
        };
      });
      return c.json({
        notifications: enriched,
        unread,
        levels: config.levels,
        employeeKey,
        canAuthor: canAuthor(me),
        limit: PANEL_LIMIT,
      });
    } catch (e) {
      return writeError(c, e, 'notifications unavailable');
    }
  });

  app.post('/api/notifications/:id/read', async (c) => {
    try {
      const me = await viewerOrNull(c);
      if (!me) return c.json({ error: 'Authentication required' }, 401);
      const db = dbOf(c);
      const row = await getNotificationRow(db, c.req.param('id') ?? '');
      if (!row) return c.json({ error: 'no such notification' }, 404);
      const employeeKey = await myEmployeeKey(db, me);
      if (!me.isRoot && (!employeeKey || row.employeeId !== employeeKey)) return c.json({ error: 'not yours' }, 403);
      await markNotificationRead(row.id);
      notifyLive(c, { type: LiveEvent.Notifications });
      return c.json({ ok: true });
    } catch (e) {
      return writeError(c, e, 'mark-read failed');
    }
  });

  app.post('/api/notifications/read-all', async (c) => {
    try {
      const me = await viewerOrNull(c);
      if (!me) return c.json({ error: 'Authentication required' }, 401);
      const db = dbOf(c);
      const employeeKey = await myEmployeeKey(db, me);
      if (!employeeKey) return c.json({ ok: true, read: 0 });
      const unread = await readPanel(db, employeeKey, { status: 'unread', limit: PANEL_LIMIT });
      let read = 0;
      for (const n of unread) {
        if (await markNotificationRead(n.id)) read++;
      }
      notifyLive(c, { type: LiveEvent.Notifications });
      return c.json({ ok: true, read });
    } catch (e) {
      return writeError(c, e, 'mark-all failed');
    }
  });

  // ── Console: rules + options + settings (root/admin) ──────────────────────
  const author = async (c: any) => {
    const me = await viewerOrNull(c);
    if (!me) return { me: null, denied: c.json({ error: 'Authentication required' }, 401) };
    if (!canAuthor(me)) return { me, denied: c.json({ error: 'Root or admin only' }, 403) };
    return { me, denied: null as any };
  };

  app.get('/api/notification-rules', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      const db = dbOf(c);
      const config = await loadNotificationConfig(db);
      return c.json({
        rules: await listRules(db),
        levels: config.levels,
        settings: config.settings,
        options: await optionsPayload(db),
        deliveries: await listDeliveries(db, 200),
        prompt: { text: await loadPrompt(db), defaultPrompt: DEFAULT_NOTIFICATION_PROMPT },
      });
    } catch (e) {
      return writeError(c, e, 'rules unavailable');
    }
  });

  app.get('/api/notification-options', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      return c.json(await optionsPayload(dbOf(c)));
    } catch (e) {
      return writeError(c, e, 'options unavailable');
    }
  });

  app.put('/api/notification-rules/:key', async (c) => {
    try {
      const { me, denied } = await author(c);
      if (denied) return denied;
      const db = dbOf(c);
      const key = String(c.req.param('key') ?? '');
      const body = await readBody<any>(c);
      const existing = key && key !== 'new' ? await getRule(db, key) : null;
      const requestedKey = String(body?.key ?? '').trim();
      const rule = parseRuleInput(
        { ...(body ?? {}), key: existing?.key || (requestedKey && requestedKey !== 'new' ? requestedKey : '') },
        existing,
      );
      rule.nextDueAt = nextDueAt(rule.cadence, new Date())?.toISOString()
        ?? (rule.cadence.kind === 'manual' ? null : rule.nextDueAt);
      const saved = await saveRule(db, rule, me?.user?.id ?? null);
      notifyLive(c, { type: LiveEvent.Notifications, ruleKey: saved.key });
      return c.json({ rule: saved });
    } catch (e) {
      if (e instanceof NotificationInputError) return c.json({ error: e.message }, 400);
      return writeError(c, e, 'save failed');
    }
  });

  app.delete('/api/notification-rules/:key', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      const removed = await deleteRule(dbOf(c), String(c.req.param('key') ?? ''));
      notifyLive(c, { type: LiveEvent.Notifications, ruleKey: c.req.param('key') });
      return c.json({ ok: true, removed });
    } catch (e) {
      return writeError(c, e, 'delete failed');
    }
  });

  /** Dry run: rows + matches + rendered messages. Writes NOTHING. */
  app.post('/api/notification-rules/:key/test', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      const db = dbOf(c);
      const body = await readBody<any>(c);
      const stored = await getRule(db, String(c.req.param('key') ?? ''));
      const base = body?.rule ? parseRuleInput(body.rule, stored) : stored;
      if (!base) return c.json({ error: 'save the rule first' }, 400);
      const draft = body?.rule ? { ...base, nextDueAt: base.nextDueAt } : base;
      const config = await loadNotificationConfig(db);
      // "Sample" windows: a quiet hour legitimately has 0 rows, which makes the
      // dry run useless for seeing columns/message shape. lookbackHours > 0
      // widens the window (still a dry run — nothing is written or sent).
      const lookbackHours = Math.max(0, Math.min(24 * 90, Number(body?.lookbackHours) || 0));
      const now = new Date();
      const window = lookbackHours > 0
        ? { startIso: new Date(now.getTime() - lookbackHours * 3_600_000).toISOString(), endIso: now.toISOString() }
        : undefined;
      const result = await evaluateRule(db, draft, {
        slot: now, levels: config.levels, settings: config.settings, dryRun: true, align: false, window,
      });
      return c.json({
        result,
        tokens: templateTokens(`${draft.titleTpl} ${draft.bodyTpl}`),
        lookbackHours,
        nextDueAt: nextDueAt(draft.cadence, new Date())?.toISOString() ?? null,
      });
    } catch (e) {
      if (e instanceof NotificationInputError) return c.json({ error: e.message }, 400);
      return writeError(c, e, 'test failed');
    }
  });

  /** Real run, on demand (also the manual cadence's only trigger). */
  app.post('/api/notification-rules/:key/run', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      const db = dbOf(c);
      const rule = await getRule(db, String(c.req.param('key') ?? ''));
      if (!rule) return c.json({ error: 'no such rule' }, 404);
      const config = await loadNotificationConfig(db);
      const result = await evaluateRule(db, rule, {
        slot: new Date(), levels: config.levels, settings: config.settings, align: false,
      });
      if (result.dispatched > 0) notifyLive(c, { type: LiveEvent.Notifications, ruleKey: rule.key, count: result.dispatched });
      return c.json({ result });
    } catch (e) {
      return writeError(c, e, 'run failed');
    }
  });

  app.put('/api/notification-settings', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      const db = dbOf(c);
      const body = await readBody<any>(c);
      await saveNotificationConfig(db, { levels: body?.levels, settings: body?.settings });
      const config = await loadNotificationConfig(db);
      notifyLive(c, { type: LiveEvent.Notifications });
      return c.json({ levels: config.levels, settings: config.settings });
    } catch (e) {
      return writeError(c, e, 'save settings failed');
    }
  });

  /** The saved AI prompt (root/admin): author rules by describing them to an
   *  agent instead of writing SQL by hand. Blank clears back to the default. */
  app.get('/api/notification-prompt', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      return c.json({ text: await loadPrompt(dbOf(c)), defaultPrompt: DEFAULT_NOTIFICATION_PROMPT });
    } catch (e) {
      return writeError(c, e, 'prompt unavailable');
    }
  });

  app.put('/api/notification-prompt', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      const body = await readBody<any>(c);
      const text = await savePrompt(dbOf(c), body?.text ?? body?.prompt ?? '');
      notifyLive(c, { type: LiveEvent.Notifications });
      return c.json({ text, defaultPrompt: DEFAULT_NOTIFICATION_PROMPT });
    } catch (e) {
      return writeError(c, e, 'could not save the prompt');
    }
  });

  /** The LIVE D1 schema (business tables only, KV-cached 10 min) — copyable into
   *  an AI agent together with the prompt above. */
  app.get('/api/notification-schema', async (c) => {
    try {
      const { denied } = await author(c);
      if (denied) return denied;
      return c.json(await loadNotificationSchema(dbOf(c)));
    } catch (e) {
      return writeError(c, e, 'schema unavailable');
    }
  });

  /** Legacy Phase-6a shape (kept for the old /work screen): own QUEUED only. */
  app.get('/api/notifications/unread-count', async (c) => {
    try {
      const me = await viewerOrNull(c);
      if (!me) return c.json({ error: 'Authentication required' }, 401);
      const db = dbOf(c);
      const employeeKey = await myEmployeeKey(db, me);
      return c.json({ unread: employeeKey ? await unreadCount(db, employeeKey) : 0 });
    } catch (e) {
      return writeError(c, e, 'count failed');
    }
  });
}
