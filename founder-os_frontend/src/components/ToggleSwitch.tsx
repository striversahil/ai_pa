"use client";

import React from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  title?: string;
}

// iOS-style on/off switch.
export default function ToggleSwitch({ checked, onChange, label, title }: ToggleSwitchProps) {
  return (
    <label
      className="inline-flex items-center gap-2 cursor-pointer select-none"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-150 cursor-pointer border-0 p-0 ${
          checked ? "bg-brand-indigo" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150 ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      {label && (
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{label}</span>
      )}
    </label>
  );
}
