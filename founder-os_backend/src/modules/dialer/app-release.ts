// ── Latest Auto Dialer APK (built + published by .github/workflows/android-apk.yml) ──
// The workflow keeps a rolling public release `auto-dialer-latest` holding
// auto-dialer.apk + auto-dialer.json (version metadata). The Controller shows
// that version and links straight to the APK; nothing is proxied or stored here.
import { cached } from '../../shared/cache';

const RELEASE_BASE = 'https://github.com/striversahil/ai_pa/releases/download/auto-dialer-latest';
export const APK_URL = `${RELEASE_BASE}/auto-dialer.apk`;
const META_URL = `${RELEASE_BASE}/auto-dialer.json`;
const TTL_MS = 5 * 60_000;

export interface AppRelease {
  available: boolean;
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  builtAt: string | null;
  commit: string;
  branch: string;
  runUrl: string;
  downloadUrl: string;
}

const EMPTY: AppRelease = {
  available: false, versionName: '', versionCode: 0, sizeBytes: 0, builtAt: null,
  commit: '', branch: '', runUrl: '', downloadUrl: APK_URL,
};

/** Pure: normalise the workflow's JSON (anything missing → safe defaults). */
export function parseRelease(raw: any): AppRelease {
  if (!raw || typeof raw !== 'object' || !raw.versionName) return EMPTY;
  return {
    available: true,
    versionName: String(raw.versionName).slice(0, 40),
    versionCode: Number(raw.versionCode) || 0,
    sizeBytes: Number(raw.sizeBytes) || 0,
    builtAt: typeof raw.builtAt === 'string' ? raw.builtAt : null,
    commit: String(raw.commit ?? '').slice(0, 40),
    branch: String(raw.branch ?? '').slice(0, 80),
    runUrl: String(raw.runUrl ?? '').startsWith('https://github.com/') ? String(raw.runUrl) : '',
    downloadUrl: APK_URL,
  };
}

export async function latestAppRelease(): Promise<AppRelease> {
  return cached('dialer:app-release', TTL_MS, async () => {
    try {
      const res = await fetch(META_URL, { headers: { 'User-Agent': 'founder-os-worker' }, redirect: 'follow' });
      if (!res.ok) return EMPTY;
      return parseRelease(await res.json());
    } catch {
      return EMPTY;
    }
  });
}
