"use client";

// Chat display prefs — colour is owned by the GLOBAL app theme (useTheme).
// This module keeps only the fixed layout prefs (cozy flat rows, 15px).
// The old per-chat ThemeSettingsPanel + THEMES/ACCENTS/chatStyle were removed
// (2026-11-15): chat surfaces inherit global tokens via CHAT_VARS in ChatRoom.

export interface ChatSettings {
  density: "cozy" | "compact";
  bubbles: boolean;
  clock24h: boolean;
  fontScale: number;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  density: "cozy",
  bubbles: false,
  clock24h: false,
  fontScale: 1,
};

export function fontPx(s: Pick<ChatSettings, "fontScale">): number {
  return Math.round(15 * s.fontScale);
}
