// SourcePicker — the Source + Marketing-channel selects for EnquiryModal.
//
// Extracted from EnquiryModal (split threshold): `Marketing` is a picker
// group only — the saved source is always the channel (`Email` / `WhatsApp`
// / `Meta`), so the label reads `Enquiry No 3 - 19 NOV Meta`. Correct
// spelling: `WhatsApp`. Legacy `AI` is never offered (writes normalize it
// to TL server-side).
import React from "react";

export const MARKETING_CHANNELS = ["Email", "WhatsApp", "Meta"] as const;
export const SOURCE_OPTIONS = ["TL", "Incoming", "B2B", "Field Staff", "Marketing"] as const;

export function isMarketingChannel(s: unknown): boolean {
  return (MARKETING_CHANNELS as readonly string[]).includes(String(s ?? ""));
}

interface SourcePickerProps {
  group: string;
  channel: string;
  onGroup: (v: string) => void;
  onChannel: (v: string) => void;
  error: string | null;
}

export default function SourcePicker({ group, channel, onGroup, onChannel, error }: SourcePickerProps) {
  return (
    <>
      <div className="space-y-1">
        <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Source</label>
        <select
          value={group}
          onChange={(e) => onGroup(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {group === "Marketing" && (
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
            Marketing channel <span className="text-rose-500">*</span>
          </label>
          <select
            value={channel}
            onChange={(e) => onChannel(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
          >
            <option value="">Select Email / WhatsApp / Meta…</option>
            {MARKETING_CHANNELS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {error && <p className="text-[11px] font-semibold text-rose-500">{error}</p>}
        </div>
      )}
    </>
  );
}
