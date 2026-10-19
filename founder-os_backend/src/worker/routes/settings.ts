// routes/settings.ts — root-only runtime application settings (AI provider
// priority + model selection for chat and intake).
//
// Values are plain enums in the Setting table (see shared/app-settings.ts) —
// key material NEVER passes through here. Writes broadcast live so open
// dashboards converge instantly (plus the auto-live data-changed event).
import type { Hono } from 'hono';
import { authStore, getMe, notifyLive, readSessionCookie, type Bindings } from '../context';
import { LiveEvent } from '../../live';
import { ROOT_EMAIL } from '../../modules/auth/types';
import { APP_SETTINGS, getAppSettings, setAppSetting } from '../../shared/app-settings';
import { resolveChatChain, resolveChatModel, resolveIntakeChain, resolveLegModel } from '../../shared/intake-chain';

async function rootDenial(c: any): Promise<any | null> {
  try {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if ((me as any)?.isRoot || String((me as any)?.user?.email ?? '').toLowerCase() === String(ROOT_EMAIL).toLowerCase()) return null;
    return c.json({ ok: false, error: 'Root only' }, 403);
  } catch (e: any) {
    const status = typeof (e as any)?.status === 'number' ? (e as any).status : 401;
    return c.json({ ok: false, error: (e as any)?.message ?? 'Authentication required' }, status);
  }
}

export function registerSettingsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Full settings + live chain preview (leg order + models for the current
  // key pool — never key material).
  app.get('/api/settings', async (c) => {
    const denied = await rootDenial(c);
    if (denied) return denied;
    const settings = await getAppSettings();
    const env = c.env as any;
    const chatPrimary = settings['chat:primary_provider'];
    const chatModels = { agnesModel: settings['chat:agnes_model'], openrouterModel: settings['chat:openrouter_model'] };
    const intakePrimary = settings['intake:primary_provider'];
    const chatChain = resolveChatChain(env, { primary: chatPrimary });
    const intakeChain = resolveIntakeChain(env, undefined, { primary: intakePrimary });
    const intakeModels = { openrouterModel: settings['intake:openrouter_model'] };
    return c.json({
      settings,
      spec: APP_SETTINGS,
      preview: {
        chat: {
          chain: chatChain,
          models: Object.fromEntries(chatChain.map((leg) => [leg, resolveChatModel({ defaultModel: 'deepseek/deepseek-v4.1-flash' }, env, leg, chatModels)])),
          route: { slugs: settings['chat:paid_route'] || '(default StreamLake/FP8 preference)', mode: settings['chat:paid_route_mode'] },
        },
        intake: {
          chain: intakeChain,
          models: Object.fromEntries(intakeChain.map((leg) => [leg, resolveLegModel(leg, intakeModels) ?? (leg === 'agnes' ? 'agnes-3.0-flash' : 'deepseek/deepseek-v4.1-flash')])),
        },
      },
    });
  });

  // Enum-validated write (400 on unknown key or off-list value — never
  // silent). Root only.
  app.put('/api/settings/:key', async (c) => {
    const denied = await rootDenial(c);
    if (denied) return denied;
    const key = String(c.req.param('key') ?? '');
    const body = await c.req.json().catch(() => ({}));
    if (typeof body?.value !== 'string') return c.json({ ok: false, error: 'value string required' }, 400);
    try {
      await setAppSetting(key, body.value);
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 400);
    }
    try { notifyLive(c, { type: LiveEvent.DataChanged }); } catch { /* non-fatal */ }
    return c.json({ ok: true, key, value: String(body.value).trim() });
  });
}
