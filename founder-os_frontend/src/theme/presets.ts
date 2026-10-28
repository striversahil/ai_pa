// presets.ts — single source of truth for app themes + accents (PURE module).
//
// Imported by:
//   • hooks/useTheme.ts       — runtime state + accent ramp generation
//   • app/layout.tsx          — pre-paint bootstrap (whitelist is generated from
//                               THEME_IDS, never hand-written again)
//   • components/layout/Sidebar.tsx / MobileDrawer.tsx — the pickers
//
// The visual side lives in app/globals.css as `html[data-app-theme="…"]` blocks.
// Adding a preset = add it here + add its block there. Because the bootstrap
// serialises THEME_IDS, a preset can no longer be dropped before hydration
// (the bug that used to reset `midnight` to `classic` on first paint).
//
// No React, no DOM: safe to import from a server component.

export type AppThemeId =
  | 'sage'
  | 'classic'
  | 'midnight'
  | 'discord'
  | 'amoled'
  | 'nord'
  | 'graphite'
  | 'light'
  | 'paper';

export type ThemeKind = 'dark' | 'light';

export interface AppTheme {
  id: AppThemeId;
  label: string;
  /** Sidebar background — the swatch users recognise the preset by. */
  swatch: string;
  kind: ThemeKind;
}

/** Sage is the app default (founder decision). Never reorder this list. */
export const DEFAULT_THEME: AppThemeId = 'sage';

export const APP_THEMES: readonly AppTheme[] = [
  { id: 'sage', label: 'Sage Forest', swatch: '#f6f7f2', kind: 'light' },
  { id: 'classic', label: 'Classic Dark', swatch: '#0a0c10', kind: 'dark' },
  { id: 'midnight', label: 'Midnight Blue', swatch: '#0e1424', kind: 'dark' },
  { id: 'discord', label: 'Discord Dark', swatch: '#313338', kind: 'dark' },
  { id: 'amoled', label: 'AMOLED Black', swatch: '#000000', kind: 'dark' },
  { id: 'nord', label: 'Nord Frost', swatch: '#2e3440', kind: 'dark' },
  { id: 'graphite', label: 'Graphite', swatch: '#1b1e23', kind: 'dark' },
  { id: 'light', label: 'Daylight', swatch: '#f4f5f8', kind: 'light' },
  { id: 'paper', label: 'Paper', swatch: '#faf7f2', kind: 'light' },
];

export const THEME_IDS: readonly AppThemeId[] = APP_THEMES.map((t) => t.id);

export const LIGHT_THEME_IDS: readonly AppThemeId[] =
  APP_THEMES.filter((t) => t.kind === 'light').map((t) => t.id);

/** Back-compat alias — the old hook exported a Set under this name. */
export const LIGHT_THEMES: ReadonlySet<AppThemeId> = new Set<AppThemeId>(LIGHT_THEME_IDS);

const THEME_ID_SET = new Set<string>(THEME_IDS);
const LIGHT_THEME_SET = new Set<string>(LIGHT_THEME_IDS);

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && THEME_ID_SET.has(value);
}

/** Light presets flip `.dark` off and use the dark-ink accent palette. */
export function isLightTheme(value: string | null | undefined): boolean {
  return typeof value === 'string' && LIGHT_THEME_SET.has(value);
}

export function themeLabel(value: string | null | undefined): string {
  return APP_THEMES.find((t) => t.id === value)?.label ?? DEFAULT_THEME;
}

export interface AppAccent {
  name: string;
  value: string;
}

/**
 * Preset accents. Any other `#rrggbb` is also valid — the picker's custom
 * colour input feeds the same generator (`accentCssVars`), so the swatch list
 * is a shortcut, not a limit.
 */
export const APP_ACCENTS: readonly AppAccent[] = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Blurple', value: '#5865f2' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Sky', value: '#0ea5e9' },
  { name: 'Pink', value: '#ec4899' },
];

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Normalise any user input to `#rrggbb`, or null when it is not a colour. */
export function normalizeAccent(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  const prefixed = raw.startsWith('#') ? raw : `#${raw}`;
  return HEX_COLOR_RE.test(prefixed) ? prefixed.toLowerCase() : null;
}
