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
   *  textlist → comma-separated provider slugs (empty = compiled default). */
  kind: 'enum' | 'text' | 'textlist';
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
  return s.length <= 120 && MODEL_ID_RE.test(s);
}

export const APP_SETTINGS: Record<string, AppSettingSpec> = {
  'chat:primary_provider': {
    key: 'chat:primary_provider',
    label: 'AI chat primary provider',
    hint: 'Agnes pool serves first via the GH relay lane; paid OpenRouter is fallback only.',
    kind: 'enum',
    options: ['agnes', 'openrouter-paid'],
    default: 'agnes',
  },
  'chat:agnes_model': {
    key: 'chat:agnes_model',
    label: 'AI chat Agnes model',
    hint: 'Model id for the Agnes leg.',
    kind: 'enum',
    options: ['agnes-3.0-flash', 'agnes-2.5-flash'],
    default: 'agnes-3.0-flash',
  },
  'chat:openrouter_model': {
    key: 'chat:openrouter_model',
    label: 'AI chat paid model',
    hint: 'OpenRouter model id for the paid leg (e.g. deepseek/deepseek-v4.1-flash).',
    kind: 'text',
    options: [],
    default: 'deepseek/deepseek-v4.1-flash',
  },
  'chat:paid_route': {
    key: 'chat:paid_route',
    label: 'Paid provider routing',
    hint: 'Comma-separated OpenRouter provider slugs serving the paid leg (e.g. inference-net). Empty = default StreamLake/FP8 preference.',
    kind: 'textlist',
    options: [],
    default: '',
  },
  'chat:paid_route_mode': {
    key: 'chat:paid_route_mode',
    label: 'Paid routing mode',
    hint: 'Prefer = try listed providers first, fall back freely. Only = serve EXCLUSIVELY from them (fails when all are down).',
    kind: 'enum',
    options: ['prefer', 'only'],
    default: 'prefer',
  },
  'intake:primary_provider': {
    key: 'intake:primary_provider',
    label: 'Enquiry intake primary provider',
    hint: 'Add-via-AI / new-items intake serves this pool first; the other leg is fallback.',
    kind: 'enum',
    options: ['agnes', 'openrouter-paid'],
    default: 'agnes',
  },
  'intake:openrouter_model': {
    key: 'intake:openrouter_model',
    label: 'Enquiry intake paid model',
    hint: 'OpenRouter model id for the paid leg (Agnes leg uses its default model).',
    kind: 'text',
    options: [],
    default: 'deepseek/deepseek-v4.1-flash',
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
  await prisma.setting.upsert({
    where: { key },
    update: { value: v },
    create: { key, value: v },
  });
}
