import { config } from '../../config';

export interface WahaStatus {
  status: string;
  reachable: boolean;
  error?: string | null;
}

export interface WahaSessionInfo {
  status: string;
  reachable: boolean;
  error?: string | null;
  name: string | null;
  me: { id: string | null; pushName: string | null; lid: string | null } | null;
  engine: { engine: string | null; webVersion: string | null; state: string | null } | null;
  config: Record<string, unknown>;
  timestamps: Record<string, unknown> | null;
}

/**
 * Full live WAHA session snapshot (status + connected account + engine
 * version). Single source of truth for the session monitor dashboard.
 */
export async function getWahaSessionInfo(timeoutMs = 3000): Promise<WahaSessionInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sr = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}`, {
      headers: { 'X-Api-Key': config.WAHA_API_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (sr.ok) {
      const d = await sr.json();
      return {
        status: String(d?.status || 'unknown'),
        reachable: true,
        name: d?.name ?? null,
        me: d?.me
          ? { id: d.me.id ?? null, pushName: d.me.pushName ?? null, lid: d.me.lid ?? null }
          : null,
        engine: d?.engine
          ? { engine: d.engine.engine ?? null, webVersion: d.engine.WWebVersion ?? null, state: d.engine.state ?? null }
          : null,
        config: d?.config ?? {},
        timestamps: d?.timestamps ?? null,
      };
    }
    return { status: `http_${sr.status}`, reachable: true, error: `HTTP ${sr.status}`, name: null, me: null, engine: null, config: {}, timestamps: null };
  } catch {
    return { status: 'unreachable', reachable: false, error: 'WAHA API unreachable', name: null, me: null, engine: null, config: {}, timestamps: null };
  }
}

/**
 * Live WAHA session status check. Single source of truth for the `/health`
 * endpoint — callers never fetch WAHA directly.
 */
export async function getWahaStatus(timeoutMs = 3000): Promise<WahaStatus> {
  const info = await getWahaSessionInfo(timeoutMs);
  return { status: info.status, reachable: info.reachable, error: info.error };
}
