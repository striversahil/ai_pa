"use client";

// Small level marker shared by the bell rows, the toasts and the console.
// The colour is ALWAYS the level's own hex (founder palette), never a theme
// token — a level must look identical on every theme.
export function LevelDot({ hex, size = 8, ring = false }: { hex: string; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${ring ? "ring-2 ring-offset-1 ring-offset-transparent" : ""}`}
      style={{ width: size, height: size, backgroundColor: hex || "var(--text-tertiary)", ...(ring ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${hex} 28%, transparent)` } : {}) }}
    />
  );
}

export function LevelChip({ level, hex, label }: { level: number; hex: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: `color-mix(in srgb, ${hex} 16%, transparent)`, color: hex }}
      title={`Level ${level} — ${label}`}
    >
      <LevelDot hex={hex} size={6} />
      {level}
    </span>
  );
}
