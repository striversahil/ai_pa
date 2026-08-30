'use client';
import { useState, useEffect, useCallback } from 'react';

export type AppThemeId = 'classic' | 'midnight' | 'discord' | 'amoled' | 'nord' | 'light';

export const APP_THEMES: { id: AppThemeId; label: string; swatch: string }[] = [
  { id: 'classic', label: 'Classic Dark', swatch: '#0a0c10' },
  { id: 'midnight', label: 'Midnight Blue', swatch: '#151d2e' },
  { id: 'discord', label: 'Discord Dark', swatch: '#313338' },
  { id: 'amoled', label: 'AMOLED Black', swatch: '#000000' },
  { id: 'nord', label: 'Nord Frost', swatch: '#2e3440' },
  { id: 'light', label: 'Daylight', swatch: '#f4f5f8' },
];

export const APP_ACCENTS: { name: string; value: string }[] = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Blurple', value: '#5865f2' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Sky', value: '#0ea5e9' },
  { name: 'Pink', value: '#ec4899' },
];

const THEME_KEY = 'app_theme_v1';
const ACCENT_KEY = 'app_accent_v1';
const ACCENT_VARS = [
  '--color-brand-indigo', '--color-indigo-300', '--color-indigo-400', '--color-indigo-500',
  '--color-indigo-600', '--color-indigo-650', '--color-indigo-700', '--ring-color',
] as const;

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

export function accentCssVars(accent: string): Record<string, string> {
  const [h, s, l] = hexToHsl(accent);
  const shade = (dl: number) => hslToHex(h, Math.max(45, s), l + dl);
  return {
    '--color-brand-indigo': accent,
    '--color-indigo-300': shade(24),
    '--color-indigo-400': shade(14),
    '--color-indigo-500': shade(6),
    '--color-indigo-600': accent,
    '--color-indigo-650': shade(-6),
    '--color-indigo-700': shade(-12),
    '--ring-color': `rgba(${hslToRgbStr(accent)}, 0.45)`,
  };
}

function hslToRgbStr(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return '91,94,240';
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

function readSavedTheme(): AppThemeId | null {
  try {
    const saved = localStorage.getItem(THEME_KEY) as AppThemeId | null;
    if (saved && APP_THEMES.some((t) => t.id === saved)) return saved;
    const legacy = localStorage.getItem('theme');
    if (legacy === 'light') return 'light';
    if (legacy === 'dark') return 'classic';
  } catch { /* ignore */ }
  return null;
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppThemeId>('classic');
  const [accent, setAccentState] = useState<string | null>(null);

  useEffect(() => {
    const saved = readSavedTheme();
    if (saved) setThemeState(saved);
    try {
      setAccentState(localStorage.getItem(ACCENT_KEY));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-app-theme', theme);
    root.classList.toggle('dark', theme !== 'light');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent) {
      const vars = accentCssVars(accent);
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      try { localStorage.setItem(ACCENT_KEY, accent); } catch { /* ignore */ }
    } else {
      for (const k of ACCENT_VARS) root.style.removeProperty(k);
      try { localStorage.removeItem(ACCENT_KEY); } catch { /* ignore */ }
    }
  }, [accent]);

  const setTheme = useCallback((id: AppThemeId) => setThemeState(id), []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const i = APP_THEMES.findIndex((t) => t.id === prev);
      return APP_THEMES[(i + 1) % APP_THEMES.length].id;
    });
  }, []);

  const setAccent = useCallback((value: string | null) => setAccentState(value), []);

  return { theme, setTheme, toggleTheme, accent, setAccent, isDark: theme !== 'light' };
}
