import { config } from '../../config';

export interface WaEngineStatus {
  status: string;
  reachable: boolean;
  error?: string | null;
}

export interface WaEngineSessionInfo {
  status: string;
  reachable: boolean;
  error?: string | null;
  name: string | null;
  me: { id: string | null; name: string | null } | null;
  engine: { engine: string | null; webVersion: string | null; state: string | null } | null;
  config: Record<string, unknown>;
  timestamps: Record<string, unknown> | null;
}

/**
 * Full live WA Engine Pro snapshot (auth/workspace check via GET /me + account
 * info). Single source of truth for the session monitor dashboard.
 */
export async function getWaEngineSessionInfo(timeoutMs = 3000): Promise<WaEngineSessionInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sr = await fetch(`${config.WA_ENGINE_BASE_URL}/me`, {
      headers: { 'X-API-Key': config.WA_ENGINE_API_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (sr.ok) {
      const d = await sr.json();
      const data = d?.data || d;
      return {
        status: 'WORKING',
        reachable: true,
        name: data?.name ?? null,
        me: data?.id
          ? { id: data.id ?? null, name: data.name ?? null }
          : null,
        engine: { engine: 'WA Engine Pro (Cloud)', webVersion: null, state: 'connected' },
        config: {},
        timestamps: null,
      };
    }
    return { status: `http_${sr.status}`, reachable: true, error: `HTTP ${sr.status}`, name: null, me: null, engine: null, config: {}, timestamps: null };
  } catch {
    return { status: 'unreachable', reachable: false, error: 'WA Engine Pro API unreachable', name: null, me: null, engine: null, config: {}, timestamps: null };
  }
}

/**
 * Live WA Engine Pro connectivity check. Single source of truth for the
 * `/health` endpoint — callers never fetch the API directly.
 */
export async function getWaEngineStatus(timeoutMs = 3000): Promise<WaEngineStatus> {
  const info = await getWaEngineSessionInfo(timeoutMs);
  return { status: info.status, reachable: info.reachable, error: info.error };
}
