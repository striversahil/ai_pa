// routes/ai-shared.ts — auth + gateway bootstrap shared by the AI route modules.
// Kept separate so ai.ts (provider CRUD + /complete), ai-controls.ts (pool
// switches) and ai-playground.ts (pinned probes) never import each other.
import { requireSecret, type Bindings } from '../context';
import { ROOT_EMAIL } from '../../modules/auth/types';
import { getViewerMe } from '../viewer';
import { getGateway } from '../../shared/ai-gateway';
import { getAppSettings } from '../../shared/app-settings';

/** Viewer session OR runner SHARED_SECRET. */
export async function authorized(c: any): Promise<boolean> {
  if (requireSecret(c)) return true;
  try {
    await getViewerMe(c);
    return true;
  } catch { return false; }
}

/** Root account only (Settings surface). */
export async function rootOnly(c: any): Promise<boolean> {
  try {
    const me = await getViewerMe(c);
    if ((me as any)?.isRoot) return true;
    const email = String((me as any)?.user?.email ?? '').toLowerCase();
    return email === String(ROOT_EMAIL).toLowerCase();
  } catch { return false; }
}

/** Gateway instance with the live Setting config applied (fail-open to env). */
export async function gatewayForRequest(c: any) {
  const gw = getGateway(c.env as any);
  try {
    const settings = await getAppSettings();
    gw.configureFromSettings(settings as any);
  } catch { /* fail-open to env pool */ }
  return gw;
}

export type { Bindings };
