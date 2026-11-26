// worker/ai-gateway-health.ts — persisted AI-key telemetry + health sweep.
//
// Worker-only (D1 access). The gateway emits one GatewayCallMetric per provider
// call; the request middleware wires the sink here and writes with
// ctx.waitUntil, so the call path never waits on the ledger.
//
// Health is written back into Setting `ai:providers` (keys[].health /
// enabled / disabledBy) — there is no second config surface. A sweep runs
// natively every 5 min; 3 consecutive auth/quota failures disable immediately.
// Playground rows are stored (source='playground') but excluded from scoring.
import { getAppSetting, setAppSetting, validateAiProvidersJson, type AiProvidersCfg, type AiProviderKeyCfg } from '../shared/app-settings';
import { keyFingerprintId } from '../shared/ai-gateway-parts/pure';
import { parseAiHealthConfig, scoreKeyHealth, type HealthSample, type KeyHealthScore } from '../shared/ai-gateway-parts/health';
import { FATAL_ERROR_KINDS, type GatewayCallMetric } from '../shared/ai-gateway-parts/metrics';

const RETENTION_DAYS = 30;
const WINDOW_HOURS = 24;
const PER_KEY_SAMPLES = 50;
const MAX_ROWS = 4000;

interface Row {
  keyId: string;
  provider: string;
  ok: number;
  status: number | null;
  errorKind: string | null;
  latencyMs: number;
  ttftMs: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  streamed: number;
  source: string;
  createdAt: string;
}

function db(env: any): any {
  const d = env?.DB;
  if (!d || typeof d.prepare !== 'function') throw new Error('DB binding missing');
  return d;
}

/** Fire-and-forget ledger write (called from the gateway sink). */
export async function recordKeyCall(env: any, metric: GatewayCallMetric): Promise<void> {
  try {
    await db(env).prepare(
      `INSERT INTO AiKeyCall (id, provider, keyId, ok, status, errorKind, latencyMs, ttftMs, promptTokens, completionTokens, totalTokens, streamed, source, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), String(metric.provider ?? ''), String(metric.keyId ?? ''),
      metric.ok ? 1 : 0, metric.status ?? null, metric.errorKind ?? null,
      Math.max(0, Math.round(metric.latencyMs || 0)), metric.ttftMs == null ? null : Math.round(metric.ttftMs),
      metric.promptTokens ?? null, metric.completionTokens ?? null, metric.totalTokens ?? null,
      metric.streamed ? 1 : 0, String(metric.source ?? 'app').slice(0, 24),
      new Date(metric.at ?? Date.now()).toISOString(),
    ).run();
    if (!metric.ok && metric.errorKind && FATAL_ERROR_KINDS.has(metric.errorKind as any)) {
      await autoDisableIfFatal(env, metric.provider, metric.keyId);
    }
  } catch { /* telemetry must never break a call */ }
}

async function readRows(env: any, limit = MAX_ROWS): Promise<Row[]> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60_000).toISOString();
  try {
    const res: any = await db(env).prepare(
      `SELECT keyId, provider, ok, status, errorKind, latencyMs, ttftMs, promptTokens, completionTokens, totalTokens, streamed, source, createdAt
       FROM AiKeyCall WHERE createdAt >= ? AND source <> 'playground' ORDER BY createdAt DESC LIMIT ?`,
    ).bind(since, limit).all();
    return (res?.results ?? []) as Row[];
  } catch { return []; }
}

function toSample(r: Row): HealthSample {
  return {
    ok: Number(r.ok) === 1,
    errorKind: r.errorKind,
    ttftMs: r.ttftMs,
    totalMs: Number(r.latencyMs) || 0,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    streamed: Number(r.streamed) === 1,
  };
}

async function loadConfig(env: any): Promise<AiProvidersCfg | null> {
  try {
    const raw = await getAppSetting('ai:providers');
    if (!String(raw ?? '').trim()) return null;
    return validateAiProvidersJson(raw);
  } catch { return null; }
}

async function saveConfig(cfg: AiProvidersCfg): Promise<void> {
  await setAppSetting('ai:providers', JSON.stringify(cfg));
}

function keyEntries(cfg: AiProvidersCfg): Array<{ provider: string; key: AiProviderKeyCfg }> {
  const out: Array<{ provider: string; key: AiProviderKeyCfg }> = [];
  for (const p of cfg.providers) for (const k of p.keys ?? []) out.push({ provider: p.id, key: k });
  return out;
}

/** Group rows per fingerprint id, newest 50 per key (24 h window). */
function groupRows(rows: Row[]): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const list = map.get(r.keyId) ?? [];
    if (list.length < PER_KEY_SAMPLES) list.push(r);
    map.set(r.keyId, list);
  }
  return map;
}

/** 3 consecutive auth/quota failures = the key is dead, not flaky. */
async function autoDisableIfFatal(env: any, provider: string, keyId: string): Promise<void> {
  try {
    const res: any = await db(env).prepare(
      `SELECT ok, errorKind FROM AiKeyCall WHERE keyId = ? AND source <> 'playground' ORDER BY createdAt DESC LIMIT 3`,
    ).bind(String(keyId)).all();
    const last = (res?.results ?? []) as Array<{ ok: number; errorKind: string | null }>;
    if (last.length < 3) return;
    if (!last.every((r) => Number(r.ok) === 0 && r.errorKind && FATAL_ERROR_KINDS.has(r.errorKind as any))) return;
    const cfg = await loadConfig(env);
    if (!cfg) return;
    const hcfg = parseAiHealthConfig(await getAppSetting('ai:health'));
    if (!hcfg.autoDisable) return;
    const hit = keyEntries(cfg).find((e) => e.provider === provider && keyFingerprintId(e.provider, e.key.key) === keyId);
    if (!hit || hit.key.enabled === false) return;
    hit.key.enabled = false;
    hit.key.disabledBy = 'health';
    hit.key.disabledAt = new Date().toISOString();
    hit.key.disabledReason = '3 consecutive auth/quota failures';
    await saveConfig(cfg);
    console.log(`[ai-health] auto-disabled ${keyId} (3 consecutive fatal errors)`);
  } catch { /* sweep will catch it next tick */ }
}

export interface SweepResult { evaluated: number; disabled: number; pruned: number }

/** Native cron sweep: score every Setting key over the last 24 h, persist the
 *  score, auto-disable under-threshold keys, prune rows older than 30 days. */
export async function runAiKeyHealthSweep(env: any): Promise<SweepResult> {
  const out: SweepResult = { evaluated: 0, disabled: 0, pruned: 0 };
  const cfg = await loadConfig(env);
  const rows = await readRows(env);
  if (cfg && cfg.providers.length > 0) {
    const hcfg = parseAiHealthConfig(await getAppSetting('ai:health'));
    const grouped = groupRows(rows);
    for (const { provider, key } of keyEntries(cfg)) {
      const id = keyFingerprintId(provider, key.key);
      let list = grouped.get(id) ?? [];
      const resetAt = key.healthResetAt ? Date.parse(key.healthResetAt) : 0;
      if (resetAt > 0) list = list.filter((r) => Date.parse(r.createdAt) >= resetAt);
      if (list.length === 0) continue;
      const score: KeyHealthScore = scoreKeyHealth(list.map(toSample), hcfg);
      key.health = {
        score: score.score, samples: score.samples, reliability: score.reliability,
        speed: score.speed, throughput: score.throughput, atRisk: score.atRisk,
        lastErrorKind: list.find((r) => Number(r.ok) === 0)?.errorKind ?? undefined,
        evaluatedAt: new Date().toISOString(),
      };
      out.evaluated++;
      const fatalStreak = list.length >= 3 && list.slice(0, 3).every((r) => Number(r.ok) === 0 && r.errorKind && FATAL_ERROR_KINDS.has(r.errorKind as any));
      const shouldDisable = hcfg.autoDisable && key.disabledBy !== 'user' && key.enabled !== false
        && (fatalStreak || (score.samples >= hcfg.minSamples && score.critical));
      if (shouldDisable) {
        key.enabled = false;
        key.disabledBy = 'health';
        key.disabledAt = new Date().toISOString();
        key.disabledReason = fatalStreak ? '3 consecutive auth/quota failures' : `health score ${score.score}`;
        out.disabled++;
      }
    }
    // Write only when there was something to record — a sweep with no traffic
    // must not churn the Setting row every 5 minutes.
    if (out.evaluated > 0 || out.disabled > 0) await saveConfig(cfg);
  }
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
    const res: any = await db(env).prepare(`DELETE FROM AiKeyCall WHERE createdAt < ?`).bind(cutoff).run();
    out.pruned = Number(res?.meta?.changes ?? 0);
  } catch { /* best-effort */ }
  if (out.evaluated > 0) console.log(`[ai-health] evaluated=${out.evaluated} disabled=${out.disabled} pruned=${out.pruned}`);
  return out;
}

// ── Controls (root-only routes) ────────────────────────────────────────────

export async function setProviderEnabled(env: any, providerId: string, enabled: boolean): Promise<AiProvidersCfg> {
  const cfg = await loadConfig(env);
  if (!cfg) throw new Error('no AI providers configured');
  const p = cfg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`unknown provider "${providerId}"`);
  if (enabled) delete p.enabled;
  else p.enabled = false;
  await saveConfig(cfg);
  return cfg;
}

export async function setKeyEnabled(env: any, providerId: string, keyId: string, enabled: boolean): Promise<AiProvidersCfg> {
  const cfg = await loadConfig(env);
  if (!cfg) throw new Error('no AI providers configured');
  const p = cfg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`unknown provider "${providerId}"`);
  const hit = (p.keys ?? []).find((k) => keyFingerprintId(p.id, k.key) === keyId);
  if (!hit) throw new Error(`unknown key "${keyId}"`);
  if (enabled) {
    // Manual re-enable: forget the disable reason and ignore samples older
    // than now, so the score that killed the key can't kill it again instantly.
    delete hit.enabled;
    delete hit.disabledBy;
    delete hit.disabledAt;
    delete hit.disabledReason;
    delete hit.health;
    hit.healthResetAt = new Date().toISOString();
  } else {
    hit.enabled = false;
    hit.disabledBy = 'user';
    hit.disabledAt = new Date().toISOString();
    hit.disabledReason = 'disabled manually';
  }
  await saveConfig(cfg);
  return cfg;
}

/** Config for the Settings UI: ids/labels/last4 + control/health state only. */
export function redactedProviderConfig(cfg: AiProvidersCfg | null) {
  if (!cfg) return { providers: [], health: parseAiHealthConfig('') };
  return {
    providers: cfg.providers.map((p) => ({
      id: p.id,
      baseUrl: p.baseUrl,
      model: p.model,
      enabled: p.enabled !== false,
      keys: (p.keys ?? []).map((k) => ({
        id: keyFingerprintId(p.id, k.key),
        label: k.label ?? '',
        last4: String(k.key ?? '').slice(-4),
        enabled: k.enabled !== false,
        disabledBy: k.disabledBy ?? null,
        disabledReason: k.disabledReason ?? null,
        healthResetAt: k.healthResetAt ?? null,
        health: k.health ?? null,
      })),
    })),
  };
}

export async function loadRedactedProviders(env: any) {
  const cfg = await loadConfig(env);
  return { ...redactedProviderConfig(cfg), health: parseAiHealthConfig(await getAppSetting('ai:health')) };
}

export async function listKeyCalls(env: any, limit = 100): Promise<Array<Record<string, unknown>>> {
  const n = Math.min(500, Math.max(1, Math.floor(Number(limit) || 100)));
  const rows = await readRows(env, n);
  return rows.map((r) => ({
    keyId: r.keyId, provider: r.provider, ok: Number(r.ok) === 1, status: r.status,
    errorKind: r.errorKind, latencyMs: r.latencyMs, ttftMs: r.ttftMs,
    completionTokens: r.completionTokens, totalTokens: r.totalTokens,
    streamed: Number(r.streamed) === 1, source: r.source, createdAt: r.createdAt,
  }));
}
