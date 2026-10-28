'use client';
// useTheme — the single runtime owner of `data-app-theme`, `.dark` and the
// accent ramp. Preset metadata lives in `src/theme/presets.ts`; the colours
// live in `app/globals.css`. This hook only decides WHICH preset is active and
// generates the accent ramp when the user picks a custom accent.
//
// Three things this file is responsible for getting right:
//   1. Never persist the DEFAULT before the saved choice is read (the mount
//      effect would clobber the user's theme with the default).
//   2. Generate the accent ramp in the direction the ACTIVE preset needs —
//      lighter tints on dark surfaces, darker ones on light surfaces. The old
//      single-direction ramp made every custom accent unreadable on Sage.
//   3. Apply accent changes before paint, so a custom accent cannot flash the
//      preset's ramp on load.

import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  APP_ACCENTS,
  APP_THEMES,
  DEFAULT_THEME,
  LIGHT_THEMES,
  isAppThemeId,
  isLightTheme,
  normalizeAccent,
  type AppThemeId,
} from '@/theme/presets';

// Re-exported for backwards compatibility — call sites import these from here.
export { APP_ACCENTS, APP_THEMES, LIGHT_THEMES };
export type { AppThemeId };

export { DEFAULT_THEME };

const THEME_KEY = 'app_theme_v2';
const ACCENT_KEY = 'app_accent_v1';

/**
 * Accent ramp. Dark surfaces need *lighter* tints (300 → +24), light surfaces
 * need *darker* ones (300 → −30) so `text-*-300/400` stays readable on white.
 * 500/600 stay close to the accent in both modes — they are button fills.
 */
const RAMP_DARK = { 300: 24, 400: 14, 500: 6, 600: 0, 650: -6, 700: -12 } as const;
const RAMP_LIGHT = { 300: -30, 400: -22, 500: -8, 600: 0, 650: -8, 700: -16 } as const;

// `--ring-color` is derived from `--color-brand-indigo` in CSS (color-mix), so
// the focus ring follows the accent in every preset without JS.
const ACCENT_VARS = [
  '--color-brand-indigo',
  '--color-indigo-300',
  '--color-indigo-400',
  '--color-indigo-500',
  '--color-indigo-600',
  '--color-indigo-650',
  '--color-indigo-700',
] as const;

// SSR-safe layout effect: applies before paint on the client (no accent flash),
// falls back to useEffect when there is no DOM.
const useApplyEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [235, 84, 59];
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lig = Math.min(96, Math.max(6, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/**
 * CSS variables for a custom accent. `light` flips the ramp direction, so the
 * same hex stays readable on Sage/Daylight/Paper and on every dark preset.
 * `--ring-color` is intentionally NOT set here — the CSS presets derive it
 * from `--color-brand-indigo`, so the focus ring follows the accent in both
 * modes without JS.
 */
export function accentCssVars(accent: string, light = false): Record<string, string> {
  const [h, s, l] = hexToHsl(accent);
  const ramp = light ? RAMP_LIGHT : RAMP_DARK;
  const shade = (dl: number) => hslToHex(h, Math.max(45, s), l + dl);
  return {
    '--color-brand-indigo': accent,
    '--color-indigo-300': shade(ramp[300]),
    '--color-indigo-400': shade(ramp[400]),
    '--color-indigo-500': shade(ramp[500]),
    '--color-indigo-600': shade(ramp[600]),
    '--color-indigo-650': shade(ramp[650]),
    '--color-indigo-700': shade(ramp[700]),
  };
}

function readSavedTheme(): AppThemeId | null {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isAppThemeId(saved)) return saved;
    // One-time migration from the v1 key: honour an explicit choice, but anyone
    // who never picked (or was on the old default 'classic') lands on the new
    // Sage default.
    const legacyV1 = localStorage.getItem('app_theme_v1');
    if (legacyV1 && legacyV1 !== 'classic' && isAppThemeId(legacyV1)) return legacyV1;
    const legacy = localStorage.getItem('theme');
    if (legacy === 'light') return 'light';
    if (legacy === 'dark') return 'classic';
  } catch { /* ignore */ }
  return null;
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppThemeId>(DEFAULT_THEME);
  const [accent, setAccentState] = useState<string | null>(null);
  // Sticky flags so the persistence effects can't fire with the *default* value
  // before the saved choice has been read — otherwise the first mount writes
  // DEFAULT_THEME back to localStorage and clobbers the user's theme.
  const [hydrated, setHydrated] = useState(false);
  const [accentHydrated, setAccentHydrated] = useState(false);

  useEffect(() => {
    const saved = readSavedTheme();
    if (saved) setThemeState(saved);
    try {
      setAccentState(normalizeAccent(localStorage.getItem(ACCENT_KEY)));
    } catch { /* ignore */ }
    setHydrated(true);
    setAccentHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.setAttribute('data-app-theme', theme);
    root.classList.toggle('dark', !isLightTheme(theme));
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme, hydrated]);

  const light = isLightTheme(theme);

  useApplyEffect(() => {
    if (!accentHydrated) return;
    const root = document.documentElement;
    if (accent) {
      for (const [k, v] of Object.entries(accentCssVars(accent, light))) root.style.setProperty(k, v);
      try { localStorage.setItem(ACCENT_KEY, accent); } catch { /* ignore */ }
    } else {
      for (const k of ACCENT_VARS) root.style.removeProperty(k);
      try { localStorage.removeItem(ACCENT_KEY); } catch { /* ignore */ }
    }
  }, [accent, accentHydrated, light]);

  const setTheme = useCallback((id: AppThemeId) => setThemeState(id), []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const i = APP_THEMES.findIndex((t) => t.id === prev);
      return APP_THEMES[(i + 1) % APP_THEMES.length].id;
    });
  }, []);

  /**
   * Accepts any `#rrggbb` (custom picker) or `null` to reset to the preset.
   * Invalid input while typing is a no-op rather than a reset, so a half-typed
   * hex in the picker never drops the accent.
   */
  const setAccent = useCallback((value: string | null) => {
    setAccentState((prev) => (value === null ? null : normalizeAccent(value) ?? prev));
  }, []);

  return {
    theme,
    setTheme,
    toggleTheme,
    accent,
    setAccent,
    isDark: !light,
  };
}
