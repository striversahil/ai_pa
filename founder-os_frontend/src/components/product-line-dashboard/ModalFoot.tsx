"use client";

// Extracted verbatim from ProductLineDashboard.tsx by scripts/refactor/split-module.mjs.
// ProductLineDashboard.tsx re-exports everything public here, so existing imports keep working.
import { Check } from "lucide-react";
import { ghostBtn, dangerBtn, primaryBtn } from "./helpers";

export function ModalFoot({ onCancel, onSave, busy, disabled, danger }: { onCancel: () => void; onSave: () => void; busy: boolean; disabled?: boolean; danger?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className={ghostBtn}>Cancel</button>
      {danger ? (
        <button type="button" disabled={busy || disabled} onClick={onSave} className={dangerBtn}>{busy ? "Working…" : danger}</button>
      ) : (
        <button type="button" disabled={busy || disabled} onClick={onSave} className={primaryBtn}><Check size={14} /> {busy ? "Saving…" : "Save"}</button>
      )}
    </div>
  );
}
