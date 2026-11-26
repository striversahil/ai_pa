// app-settings.ts — runtime application settings (the Setting-table toggle
// pattern, same as the telecalling toggles in scoring.ts).
//
// Keys are allow-listed + validated here (400 on junk, never silent). Reads
// are fail-open to compiled defaults so a missing row can never break chat
// or intake. Writes are root-only (worker/routes/settings.ts); values are
// plain enums — key material NEVER lives here (secrets stay secrets).
import { prisma } from './prisma';

export interface AppSettingSpec {
  key: string;
  label: string;
  hint: string;
  /** enum → segmented/dropdown control; text → free model-id input;
   *  textlist → comma-separated provider slugs (empty = compiled default).
   *  json → small JSON blob (≤500 chars); jsonlarge → large JSON blob (≤20k). */
  kind: 'enum' | 'text' | 'textlist' | 'json' | 'jsonlarge';
  options: string[];
  default: string;
}

// OpenRouter model ids look like `org/model` (colons allowed for `:free`
// variants). Anything else is rejected at write AND read (fail-open to default).
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._\-/:]{0,119}$/i;

export function isValidSettingValue(spec: AppSettingSpec, v: string): boolean {
  const s = String(v ?? '').trim();
  if (spec.kind === 'textlist') {
    // Empty clears back to the compiled default routing. Otherwise 1-5
    // OpenRouter provider slugs (letters/digits/dots/dashes/slashes).
    if (!s) return true;
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    return parts.length >= 1 && parts.length <= 5
      && parts.every((p) => /^[a-z0-9][a-z0-9._\-/]{0,40}$/i.test(p));
  }
  if (!s) return false;
  if (spec.kind === 'enum') return spec.options.includes(s);
  if (spec.kind === 'jsonlarge') {
    if (s.length > 20000) return false;
    try { JSON.parse(s); return true; } catch { return false; }
  }
  if (spec.kind === 'json') {
    if (s.length > 500) return false;
    try { JSON.parse(s); return true; } catch { return false; }
  }
  return s.length <= 120 && MODEL_ID_RE.test(s);
}

export const APP_SETTINGS: Record<string, AppSettingSpec> = {
  'device:call_config': {
    key: 'device:call_config',
    label: 'Android call-recording limits',
    hint: 'JSON: {"loggingOnlyFallback":false,"maxBytes":31457280,"maxMinutes":60,"partMinutes":10}',
    kind: 'json',
    options: [],
    default: '',
  },
  'crm:invoice_gate': {
    key: 'crm:invoice_gate',
    label: 'CRM dispatch — invoice gate',
    hint: 'enforce = every dispatch needs a fresh invoice PDF. off = the floor may dispatch without one (accounting check temporarily lifted); the batch is still recorded as dispatched without an invoice.',
    kind: 'enum',
    options: ['enforce', 'off'],
    default: 'enforce',
  },
  'ai:strategy': {
    key: 'ai:strategy',
    label: 'AI gateway strategy',
    hint: 'Global key selection: round-robin cycles keys evenly; least-used-first prefers lowest usage.',
    kind: 'enum',
    options: ['least-used-first', 'round-robin'],
    default: 'least-used-first',
  },
  'ai:providers': {
    key: 'ai:providers',
    label: 'AI providers (BYOK)',
    hint: 'JSON: {"providers":[{"id,baseUrl,model,keys:[{key,label,enabled}]}]}. OpenAI-compatible endpoints only. Keys stay server-side.',
    kind: 'jsonlarge',
    options: [],
    default: '',
  },
  'ai:health': {
    key: 'ai:health',
    label: 'AI key health thresholds',
    hint: 'JSON: {"threshold":40,"atRisk":60,"minSamples":5,"tpsTarget":40,"ttftGoodMs":800,"ttftBadMs":5000,"autoDisable":true}. A key below threshold (with enough samples) is auto-disabled; set autoDisable=false to observe only.',
    kind: 'json',
    options: [],
    default: '',
  },
};

export async function getAppSetting(key: string): Promise<string> {
  const spec = APP_SETTINGS[key];
  const fallback = spec?.default ?? '';
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const v = String((row as any)?.value ?? '').trim();
    if (!v) return fallback;
    if (spec && !isValidSettingValue(spec, v)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

export async function getAppSettings(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(APP_SETTINGS)) out[key] = await getAppSetting(key);
  return out;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const spec = APP_SETTINGS[key];
  if (!spec) throw new Error(`unknown setting: ${key}`);
  const v = String(value ?? '').trim();
  if (!isValidSettingValue(spec, v)) {
    throw new Error(spec.kind === 'enum'
      ? `invalid value for ${key}: must be one of ${spec.options.join(', ')}`
      : `invalid value for ${key}: must be an OpenRouter model id like org/model (≤120 chars)`);
  }
  if (key === 'ai:providers' && v) validateAiProvidersJson(v);
  await prisma.setting.upsert({
    where: { key },
    update: { value: v },
    create: { key, value: v },
  });
}

// ── AI providers (BYOK) — Setting JSON shape ──────────────────────────────
// mirror: scripts/ai-gateway.js (validateAiProvidersJson port)
export interface AiProviderKeyHealthCfg {
  score: number;
  samples: number;
  reliability?: number;
  speed?: number;
  throughput?: number;
  atRisk?: boolean;
  lastErrorKind?: string;
  evaluatedAt?: string;
}
export interface AiProviderKeyCfg {
  key: string;
  label?: string;
  /** Operator or health auto-disable. Absent/true = selectable. */
  enabled?: boolean;
  disabledBy?: 'user' | 'health';
  disabledAt?: string;
  disabledReason?: string;
  /** Last computed score (written by the native cron sweep). */
  health?: AiProviderKeyHealthCfg;
  /** Manual re-enable marker: samples older than this never auto-disable
   *  the key again (no stale score can immediately kill it). */
  healthResetAt?: string;
}
export interface AiProviderCfg {
  id: string;
  baseUrl: string;
  model: string;
  keys: AiProviderKeyCfg[];
  /** Provider-level switch; absent/true = in the pool. */
  enabled?: boolean;
}
export interface AiProvidersCfg {
  strategy?: string;
  providers: AiProviderCfg[];
}

const AI_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._\-]{0,40}$/i;

export function validateAiProvidersJson(raw: string): AiProvidersCfg {
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error('ai:providers must be valid JSON'); }
  const list = Array.isArray(parsed) ? parsed : parsed?.providers;
  if (!Array.isArray(list)) throw new Error('ai:providers must be {"providers":[...]}');
  if (list.length > 20) throw new Error('ai:providers: max 20 providers');
  const out: AiProviderCfg[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    const id = String(p?.id ?? '').trim();
    const baseUrl = String(p?.baseUrl ?? p?.baseURL ?? '').trim().replace(/\/+$/, '');
    const model = String(p?.model ?? '').trim();
    if (!id || !AI_PROVIDER_ID_RE.test(id)) throw new Error(`ai:providers: bad provider id "${id}"`);
    if (seen.has(id.toLowerCase())) throw new Error(`ai:providers: duplicate provider "${id}"`);
    seen.add(id.toLowerCase());
    if (!/^https?:\/\/.{3,}/i.test(baseUrl)) throw new Error(`ai:providers: bad baseUrl for "${id}"`);
    if (baseUrl.length > 200) throw new Error(`ai:providers: baseUrl too long for "${id}"`);
    if (!model || model.length > 120) throw new Error(`ai:providers: bad model for "${id}"`);
    const keys = Array.isArray(p?.keys) ? p.keys : [];
    // 0 keys allowed (provider created first, keys appended after) — the
    // chain only serves providers that actually have healthy keys.
    if (keys.length > 10) throw new Error(`ai:providers: "${id}" max 10 keys`);
    const kout: AiProviderKeyCfg[] = [];
    const kseen = new Set<string>();
    for (const k of keys) {
      const kv = String((k as any)?.key ?? k ?? '').trim();
      if (kv.length < 8 || kv.length > 500) throw new Error(`ai:providers: bad key for "${id}"`);
      if (kseen.has(kv)) continue;
      kseen.add(kv);
      const entry: AiProviderKeyCfg = {
        key: kv,
        label: String((k as any)?.label ?? '').trim().slice(0, 40) || undefined,
      };
      // Control + telemetry fields survive a Settings round-trip (the UI only
      // ever sends key material + labels; this validator runs on BOTH the
      // generic settings write and the health sweep's server-side write).
      if ((k as any)?.enabled === false) {
        entry.enabled = false;
        const by = String((k as any)?.disabledBy ?? '').trim();
        if (by === 'user' || by === 'health') entry.disabledBy = by;
        const at = String((k as any)?.disabledAt ?? '').trim();
        if (at) entry.disabledAt = at.slice(0, 40);
        const reason = String((k as any)?.disabledReason ?? '').trim();
        if (reason) entry.disabledReason = reason.slice(0, 200);
      }
      const h = (k as any)?.health;
      if (h && typeof h === 'object') {
        const score = Number(h.score);
        if (Number.isFinite(score)) {
          const hout: AiProviderKeyHealthCfg = {
            score: Math.max(0, Math.min(100, Math.round(score))),
            samples: Math.max(0, Math.min(10000, Math.round(Number(h.samples) || 0))),
          };
          for (const f of ['reliability', 'speed', 'throughput'] as const) {
            const n = Number((h as any)[f]);
            if (Number.isFinite(n)) hout[f] = Math.max(0, Math.min(100, Math.round(n)));
          }
          if (typeof h.atRisk === 'boolean') hout.atRisk = h.atRisk;
          const kind = String(h.lastErrorKind ?? '').trim();
          if (kind) hout.lastErrorKind = kind.slice(0, 24);
          const at = String(h.evaluatedAt ?? '').trim();
          if (at) hout.evaluatedAt = at.slice(0, 40);
          entry.health = hout;
        }
      }
      const reset = String((k as any)?.healthResetAt ?? '').trim();
      if (reset) entry.healthResetAt = reset.slice(0, 40);
      kout.push(entry);
    }
    const pout: AiProviderCfg = { id, baseUrl, model, keys: kout };
    if ((p as any)?.enabled === false) pout.enabled = false;
    out.push(pout);
  }
  const strategy = String((parsed as any)?.strategy ?? '').trim();
  if (strategy && !['round-robin', 'least-used-first'].includes(strategy)) {
    throw new Error('ai:providers.strategy must be round-robin or least-used-first');
  }
  return { strategy: strategy || undefined, providers: out };
}

export function parseAiProvidersJson(raw: string): AiProvidersCfg | null {
  try {
    if (!String(raw ?? '').trim()) return null;
    return validateAiProvidersJson(raw);
  } catch { return null; }
}
