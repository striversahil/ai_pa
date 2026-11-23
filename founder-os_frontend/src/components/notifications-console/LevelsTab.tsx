"use client";

// LevelsTab — the escalation palette + engine caps.
//
// The palette is the founder's JSON, stored once in Setting
// `notifications:levels`; every row, toast and chip reads its colour from here.
// Editing is deliberate: the label/colour a person sees IS this table.
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { NotificationLevelDef, NotificationSettings } from "@/notifications/types";
import { Field, inputCls } from "./ui";
import { LevelDot } from "@/components/notifications/LevelDot";

export function LevelsTab({
  levels, settings, onSave, busy, error,
}: {
  levels: NotificationLevelDef[];
  settings: NotificationSettings;
  onSave: (levels: NotificationLevelDef[], settings: NotificationSettings) => void;
  busy: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState<NotificationLevelDef[]>(levels);
  const [caps, setCaps] = useState<NotificationSettings>(settings);

  useEffect(() => setDraft(levels), [levels]);
  useEffect(() => setCaps(settings), [settings]);

  const patch = (level: number, part: Partial<NotificationLevelDef>) =>
    setDraft((prev) => prev.map((l) => (l.level === level ? { ...l, ...part } : l)));

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[var(--text-secondary)]">
        Level 1 is <span className="font-bold">Normal / Resolved</span> — it is recorded in the audit but never toasted. Rules notify at level ≥ 2.
      </p>

      <div className="space-y-2">
        {draft.map((l) => (
          <div key={l.level} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-[var(--border-card)] p-3 md:grid-cols-[3rem_1fr_1fr_5.5rem]">
            <div className="flex items-center gap-2 md:block">
              <LevelDot hex={l.hexColor} size={14} ring />
              <p className="text-xs font-black text-[var(--text-primary)] md:mt-1">L{l.level}</p>
            </div>
            <Field label="Label">
              <input className={inputCls} value={l.label} onChange={(e) => patch(l.level, { label: e.target.value })} />
            </Field>
            <Field label="Colour name">
              <input className={inputCls} value={l.colorName} onChange={(e) => patch(l.level, { colorName: e.target.value })} />
            </Field>
            <Field label="Hex">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  aria-label={`Level ${l.level} colour`}
                  value={/^#[0-9a-f]{6}$/i.test(l.hexColor) ? l.hexColor : "#000000"}
                  onChange={(e) => patch(l.level, { hexColor: e.target.value.toUpperCase() })}
                  className="h-9 w-9 cursor-pointer rounded-md border border-[var(--border-card)] bg-transparent"
                />
                <input className={`${inputCls} font-mono !px-2`} value={l.hexColor} onChange={(e) => patch(l.level, { hexColor: e.target.value.toUpperCase() })} />
              </div>
            </Field>
            <div className="md:col-span-4">
              <Field label="Description">
                <input className={inputCls} value={l.description} onChange={(e) => patch(l.level, { description: e.target.value })} />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--border-card)] p-3 md:grid-cols-2">
        <Field label="Max notifications per person / hour" hint="Flood guard across ALL rules (default 6).">
          <input
            type="number" min={1} max={60} className={inputCls}
            value={caps.maxPerEmployeePerHour}
            onChange={(e) => setCaps({ ...caps, maxPerEmployeePerHour: Number(e.target.value) || 6 })}
          />
        </Field>
        <Field label="Rules evaluated per cron tick" hint="Sweep budget (default 25). Extra due rules run on the next tick.">
          <input
            type="number" min={1} max={200} className={inputCls}
            value={caps.sweepRulesPerTick}
            onChange={(e) => setCaps({ ...caps, sweepRulesPerTick: Number(e.target.value) || 25 })}
          />
        </Field>
      </div>

      {error ? <p className="text-[11px] font-bold text-[var(--color-danger)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => onSave(draft, caps)}>{busy ? "Saving…" : "Save levels & caps"}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(levels); setCaps(settings); }}>Reset</Button>
      </div>
    </div>
  );
}
