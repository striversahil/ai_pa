// routes/settings.ts — root-only runtime application settings (single AI
// gateway: global strategy + BYOK provider list).
//
// Values are plain enums in the Setting table (see shared/app-settings.ts) —
// key material NEVER passes through here. Writes broadcast live so open
// dashboards converge instantly (plus the auto-live data-changed event).
import type { Hono } from 'hono';
import { notifyLive, type Bindings } from '../context';
import { LiveEvent } from '../../live';
import { ROOT_EMAIL } from '../../modules/auth/types';
import { APP_SETTINGS, getAppSettings, setAppSetting } from '../../shared/app-settings';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';

async function rootDenial(c: any): Promise<any | null> {
  try {
    const me = await getViewerMe(c);
    if ((me as any)?.isRoot || String((me as any)?.user?.email ?? '').toLowerCase() === String(ROOT_EMAIL).toLowerCase()) return null;
    return c.json({ ok: false, error: 'Root only' }, 403);
  } catch (e: any) {
    const status = typeof (e as any)?.status === 'number' ? (e as any).status : 401;
    return c.json({ ok: false, error: (e as any)?.message ?? 'Authentication required' }, status);
  }
}

export function registerSettingsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Full settings + live gateway preview (chain order + per-provider
  // health — never key material).
  app.get('/api/settings', async (c) => {
    const denied = await rootDenial(c);
    if (denied) return denied;
    const settings = await getAppSettings();
    const env = c.env as any;
    // AI gateway: global strategy + Setting providers (health only, no keys).
    let ai: any = { strategy: settings['ai:strategy'] || 'least-used-first', providers: [] as any[] };
    try {
      const { getGateway } = await import('../../shared/ai-gateway');
      const gw = getGateway(env as any);
      try { gw.configureFromSettings(settings as any); } catch { /* ignore */ }
      ai = {
        strategy: gw.strategy(),
        keys: gw.keyCount,
        providers: (() => {
          try {
            const byProv = new Map<string, { usable: number; total: number }>();
            const now = Date.now();
            for (const h of gw.health()) {
              const e = byProv.get(h.provider) ?? { usable: 0, total: 0 };
              e.total++;
              if (h.enabled && h.cooldownUntil <= now) e.usable++;
              byProv.set(h.provider, e);
            }
            return [...byProv.entries()].map(([provider, v]) => ({ provider, ...v }));
          } catch { return []; }
        })(),
      };
    } catch { /* ignore */ }
    // Redact key material: GET never returns raw keys — ids + counts only.
    let safeSettings: Record<string, string> = settings as any;
    try {
      const { parseAiProvidersJson } = await import('../../shared/app-settings');
      const raw = String((settings as any)['ai:providers'] ?? '');
      if (raw) {
        const cfg = parseAiProvidersJson(raw);
        if (cfg) {
          safeSettings = {
            ...(settings as any),
            'ai:providers': JSON.stringify({
              strategy: (settings as any)['ai:strategy'] || cfg.strategy || 'least-used-first',
              providers: cfg.providers.map((p) => ({ id: p.id, baseUrl: p.baseUrl, model: p.model, keys: p.keys.length })),
            }),
          };
        } else {
          safeSettings = { ...(settings as any), 'ai:providers': '' };
        }
      }
    } catch {
      try { safeSettings = { ...(settings as any), 'ai:providers': '' }; } catch { /* ignore */ }
    }
    return c.json({
      settings: safeSettings,
      spec: APP_SETTINGS,
      preview: {
        ai,
      },
    });
  });

  // Enum-validated write (400 on unknown key or off-list value — never
  // silent). Root only.
  app.put('/api/settings/:key', async (c) => {
    const denied = await rootDenial(c);
    if (denied) return denied;
    const key = String(c.req.param('key') ?? '');
    const body = await readBody(c);
    if (typeof body?.value !== 'string') return c.json({ ok: false, error: 'value string required' }, 400);
    try {
      await setAppSetting(key, body.value);
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 400);
    }
    try { notifyLive(c, { type: LiveEvent.Settings }); } catch { /* non-fatal */ }
    // Never echo key material: ai:providers write returns a redacted summary.
    if (key === 'ai:providers') {
      let summary = 'saved';
      try {
        const { parseAiProvidersJson } = await import('../../shared/app-settings');
        const cfg = parseAiProvidersJson(String(body.value));
        const n = cfg ? cfg.providers.length : 0;
        const k = cfg ? cfg.providers.reduce((a, p) => a + p.keys.length, 0) : 0;
        summary = `${n} providers, ${k} keys`;
      } catch { /* ignore */ }
      return c.json({ ok: true, key, value: summary });
    }
    return c.json({ ok: true, key, value: String(body.value).trim() });
  });
}
