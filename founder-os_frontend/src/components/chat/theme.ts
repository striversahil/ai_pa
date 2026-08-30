"use client";

import React, { useCallback, useEffect, useState } from "react";

export type ChatThemeId = "classic" | "discord" | "midnight" | "amoled" | "nord" | "light";

export interface ChatSettings {
  theme: ChatThemeId;
  accent: string;
  density: "cozy" | "compact";
  fontScale: number;
  bubbles: boolean;
  showMembers: boolean;
  clock24h: boolean;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  theme: "classic",
  accent: "#5865f2",
  density: "cozy",
  fontScale: 1,
  bubbles: false,
  showMembers: true,
  clock24h: false,
};

export const ACCENTS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Blurple", value: "#5865f2" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Emerald", value: "#10b981" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Pink", value: "#ec4899" },
  { name: "Lime", value: "#84cc16" },
];

export const THEMES: Record<ChatThemeId, { label: string; swatch: string; vars: Record<string, string> }> = {
  classic: {
    label: "Classic Dark",
    swatch: "#15181f",
    vars: {
      "--chat-bg": "#15181f",
      "--chat-side": "#0b0d11",
      "--chat-panel": "#0b0d11",
      "--chat-float": "#1b1f27",
      "--chat-input": "#1c2027",
      "--chat-text": "#eef0f4",
      "--chat-muted": "#8b92a1",
      "--chat-border": "#262b34",
      "--chat-hover": "#1a1f28",
      "--chat-active": "#232935",
      "--chat-bubble": "#1e293b",
      "--chat-divider": "#2f3644",
    },
  },
  discord: {
    label: "Discord Dark",
    swatch: "#313338",
    vars: {
      "--chat-bg": "#313338",
      "--chat-side": "#2b2d31",
      "--chat-panel": "#2b2d31",
      "--chat-float": "#111214",
      "--chat-input": "#383a40",
      "--chat-text": "#dbdee1",
      "--chat-muted": "#949ba4",
      "--chat-border": "#3f4147",
      "--chat-hover": "#2e3035",
      "--chat-active": "#404249",
      "--chat-bubble": "#3f4147",
      "--chat-divider": "#4e5058",
    },
  },
  midnight: {
    label: "Midnight Blue",
    swatch: "#0f1420",
    vars: {
      "--chat-bg": "#0f1420",
      "--chat-side": "#0b0f19",
      "--chat-panel": "#0b0f19",
      "--chat-float": "#070a12",
      "--chat-input": "#1a2233",
      "--chat-text": "#e2e8f0",
      "--chat-muted": "#7c8aa5",
      "--chat-border": "#1e2637",
      "--chat-hover": "#141b2b",
      "--chat-active": "#202a40",
      "--chat-bubble": "#1e2637",
      "--chat-divider": "#2a3650",
    },
  },
  amoled: {
    label: "AMOLED Black",
    swatch: "#000000",
    vars: {
      "--chat-bg": "#000000",
      "--chat-side": "#050505",
      "--chat-panel": "#050505",
      "--chat-float": "#000000",
      "--chat-input": "#141414",
      "--chat-text": "#e6e6e6",
      "--chat-muted": "#8a8a8a",
      "--chat-border": "#1c1c1c",
      "--chat-hover": "#0d0d0d",
      "--chat-active": "#1f1f1f",
      "--chat-bubble": "#161616",
      "--chat-divider": "#2a2a2a",
    },
  },
  nord: {
    label: "Nord Frost",
    swatch: "#2e3440",
    vars: {
      "--chat-bg": "#2e3440",
      "--chat-side": "#292e39",
      "--chat-panel": "#292e39",
      "--chat-float": "#21262e",
      "--chat-input": "#3b4252",
      "--chat-text": "#eceff4",
      "--chat-muted": "#9aa5b6",
      "--chat-border": "#3b4252",
      "--chat-hover": "#343b48",
      "--chat-active": "#434c5e",
      "--chat-bubble": "#3b4252",
      "--chat-divider": "#4c566a",
    },
  },
  light: {
    label: "Daylight",
    swatch: "#ffffff",
    vars: {
      "--chat-bg": "#ffffff",
      "--chat-side": "#f2f3f5",
      "--chat-panel": "#f2f3f5",
      "--chat-float": "#ffffff",
      "--chat-input": "#ebedef",
      "--chat-text": "#2e3338",
      "--chat-muted": "#80848e",
      "--chat-border": "#e3e5e8",
      "--chat-hover": "#f7f8f9",
      "--chat-active": "#e0e1e5",
      "--chat-bubble": "#e3e5e8",
      "--chat-divider": "#c4c9ce",
    },
  },
};

function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return "88,101,242";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

const STORAGE_KEY = "chat_settings_v1";

function readSettings(): ChatSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useChatSettings() {
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [settings]);

  const update = useCallback((patch: Partial<ChatSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return { settings, update, reset };
}

export function chatStyle(s: ChatSettings): React.CSSProperties {
  const theme = THEMES[s.theme] ?? THEMES.discord;
  return {
    ...theme.vars,
    "--chat-accent": s.accent,
    "--chat-accent-rgb": hexToRgb(s.accent),
  } as React.CSSProperties;
}

export function fontPx(s: ChatSettings): number {
  return Math.round(15 * s.fontScale);
}
