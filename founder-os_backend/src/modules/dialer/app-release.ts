// ── Latest Auto Dialer APK (built + published by .github/workflows/android-apk.yml) ──
// The workflow keeps a rolling release `auto-dialer-latest` holding
// auto-dialer.apk + auto-dialer.json (version metadata). Founder OS serves both
// under its own URL (/api/dialer/app[/download]); the upstream address is never
// sent to the browser.
import { cached } from '../../shared/cache';

const RELEASE_BASE = 'https://github.com/striversahil/ai_pa/releases/download/auto-dialer-latest';
const APK_UPSTREAM = `${RELEASE_BASE}/auto-dialer.apk`;
const META_UPSTREAM = `${RELEASE_BASE}/auto-dialer.json`;
/** Same-origin download route (worker/routes/dialer.ts). */
export const DOWNLOAD_PATH = '/api/dialer/app/download';
const TTL_MS = 5 * 60_000;
const UA = { 'User-Agent': 'founder-os-worker' };

export interface AppRelease {
  available: boolean;
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  /** Signed with the shared key: installs over the previous build (pairing + data kept). */
  stableKey: boolean;
  builtAt: string | null;
  commit: string;
  downloadUrl: string;
}

const EMPTY: AppRelease = {
  available: false, versionName: '', versionCode: 0, sizeBytes: 0, stableKey: false, builtAt: null, commit: '', downloadUrl: DOWNLOAD_PATH,
};

/** Pure: normalise the workflow's JSON (anything missing → safe defaults). */
export function parseRelease(raw: any): AppRelease {
  if (!raw || typeof raw !== 'object' || !raw.versionName) return EMPTY;
  return {
    available: true,
    versionName: String(raw.versionName).slice(0, 40),
    versionCode: Number(raw.versionCode) || 0,
    sizeBytes: Number(raw.sizeBytes) || 0,
    stableKey: raw.stableKey === true,
    builtAt: typeof raw.builtAt === 'string' ? raw.builtAt : null,
    commit: String(raw.commit ?? '').slice(0, 7),
    downloadUrl: DOWNLOAD_PATH,
  };
}

export async function latestAppRelease(): Promise<AppRelease> {
  return cached('dialer:app-release:v3', TTL_MS, async () => {
    try {
      const res = await fetch(META_UPSTREAM, { headers: UA, redirect: 'follow' });
      if (!res.ok) return EMPTY;
      return parseRelease(await res.json());
    } catch {
      return EMPTY;
    }
  });
}

/** Stream the APK through Founder OS as an attachment (null when no build is published). */
export async function streamLatestApk(): Promise<Response | null> {
  const [meta, res] = await Promise.all([latestAppRelease(), fetch(APK_UPSTREAM, { headers: UA, redirect: 'follow' })]);
  if (!res.ok || !res.body) return null;
  const name = meta.available ? `auto-dialer-${meta.versionName}.apk` : 'auto-dialer.apk';
  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'private, no-store',
  });
  const len = res.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  return new Response(res.body, { status: 200, headers });
}
