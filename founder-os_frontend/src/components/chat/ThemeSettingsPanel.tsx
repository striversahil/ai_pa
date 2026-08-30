"use client";

import React from "react";
import { Check, Palette, RotateCcw, X } from "lucide-react";
import { ACCENTS, ChatSettings, ChatThemeId, DEFAULT_SETTINGS, THEMES } from "./theme";

const FONT_MIN = 0.85;
const FONT_MAX = 1.3;
const FONT_STEP = 0.05;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--chat-text)]">{label}</p>
        {hint && <p className="text-xs text-[var(--chat-muted)]">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition ${on ? "" : "bg-[var(--chat-input)]"}`}
      style={on ? { backgroundColor: "var(--chat-accent)" } : undefined}
      role="switch"
      aria-checked={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

function SegButtons<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-[var(--chat-border)]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-bold transition ${
            value === o.value ? "text-white" : "bg-[var(--chat-input)] text-[var(--chat-muted)] hover:text-[var(--chat-text)]"
          }`}
          style={value === o.value ? { backgroundColor: "var(--chat-accent)" } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ThemeSettingsPanel({
  settings,
  update,
  reset,
  onClose,
}: {
  settings: ChatSettings;
  update: (patch: Partial<ChatSettings>) => void;
  reset: () => void;
  onClose: () => void;
}) {
  const validHex = /^#[0-9a-fA-F]{6}$/;
  return (
    <div className="fixed inset-0 z-[110] flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="flex h-full w-[380px] max-w-[92vw] flex-col border-l border-[var(--chat-border)] bg-[var(--chat-panel)] shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--chat-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[var(--chat-accent)]" />
            <h3 className="text-base font-bold text-[var(--chat-text)]">Chat appearance</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--chat-muted)] hover:bg-[var(--chat-active)] hover:text-[var(--chat-text)]" title="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 divide-y divide-[var(--chat-border)] overflow-y-auto px-5 py-1">
          <div className="py-4">
            <p className="mb-2 text-sm font-semibold text-[var(--chat-text)]">Theme</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(THEMES) as ChatThemeId[]).map((id) => {
                const t = THEMES[id];
                const active = settings.theme === id;
                return (
                  <button
                    key={id}
                    onClick={() => update({ theme: id })}
                    className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition ${
                      active ? "border-[var(--chat-accent)]" : "border-[var(--chat-border)] hover:border-[var(--chat-muted)]"
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--chat-border)]" style={{ backgroundColor: t.swatch }}>
                      {active && <Check className="h-4 w-4 text-white drop-shadow" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold text-[var(--chat-text)]">{t.label}</span>
                      <span className="block text-[10px] text-[var(--chat-muted)]">{active ? "Active" : "Tap to apply"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="py-4">
            <p className="mb-2 text-sm font-semibold text-[var(--chat-text)]">Accent color</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => update({ accent: a.value })}
                  title={a.name}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition ${
                    settings.accent.toLowerCase() === a.value ? "border-white/90 scale-110" : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: a.value }}
                >
                  {settings.accent.toLowerCase() === a.value && <Check className="h-4 w-4 text-white drop-shadow" />}
                </button>
              ))}
              <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--chat-border)] px-2.5 text-[11px] font-semibold text-[var(--chat-muted)] hover:border-[var(--chat-accent)]">
                Custom
                <input
                  type="color"
                  value={validHex.test(settings.accent) ? settings.accent : "#5865f2"}
                  onChange={(e) => update({ accent: e.target.value })}
                  className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
          </div>

          <Row label="Message display" hint="Compact hides avatars and groups tightly">
            <SegButtons
              value={settings.density}
              options={[
                { value: "cozy" as const, label: "Cozy" },
                { value: "compact" as const, label: "Compact" },
              ]}
              onChange={(density) => update({ density })}
            />
          </Row>

          <Row label="Chat bubbles" hint="Messenger-style bubbles instead of flat rows">
            <Toggle on={settings.bubbles} onChange={(bubbles) => update({ bubbles })} />
          </Row>

          <Row label="Show member list" hint="People in this channel on the right">
            <Toggle on={settings.showMembers} onChange={(showMembers) => update({ showMembers })} />
          </Row>

          <Row label="24-hour clock">
            <Toggle on={settings.clock24h} onChange={(clock24h) => update({ clock24h })} />
          </Row>

          <div className="py-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--chat-text)]">Font size</p>
              <span className="rounded bg-[var(--chat-input)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--chat-muted)]">
                {Math.round(15 * settings.fontScale)}px
              </span>
            </div>
            <input
              type="range"
              min={FONT_MIN}
              max={FONT_MAX}
              step={FONT_STEP}
              value={settings.fontScale}
              onChange={(e) => update({ fontScale: Number(e.target.value) })}
              className="w-full accent-[var(--chat-accent)]"
            />
          </div>

          <div className="py-4">
            <p className="mb-2 text-sm font-semibold text-[var(--chat-text)]">Preview</p>
            <div className="rounded-lg border border-[var(--chat-border)] bg-[var(--chat-bg)] p-3" style={{ fontSize: Math.round(15 * settings.fontScale) }}>
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ backgroundColor: settings.accent }}>
                  A
                </div>
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold" style={{ color: settings.accent }}>Alex</span>{" "}
                    <span className="text-[11px] text-[var(--chat-muted)]">today at 4:20 PM</span>
                  </p>
                  <p className="text-[var(--chat-text)]">This is how messages look — **bold**, `code`, links and more.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="border-t border-[var(--chat-border)] px-5 py-3">
          <button
            onClick={reset}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--chat-input)] px-4 py-2 text-sm font-bold text-[var(--chat-text)] transition hover:opacity-80"
          >
            <RotateCcw className="h-4 w-4" /> Reset to defaults
          </button>
          <p className="mt-2 text-center text-[10px] text-[var(--chat-muted)]">
            Settings are saved on this device only.
          </p>
        </footer>
      </aside>
    </div>
  );
}
