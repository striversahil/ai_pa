// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/levels.ts — the 1..5 escalation palette (PURE).
//
// The founder's palette is the default; the live copy lives in Setting
// `notifications:levels` so the console can edit names/colours without a
// migration. Level 1 means "Normal / Resolved" — the engine logs it and never
// toasts it (a rule may opt into one level-1 "resolved" notice on recovery).
//
// mirror: founder-os_frontend/src/notifications/levels.ts
// Guarded by scripts/guards/notifications.test.mjs — change both together.
// ─────────────────────────────────────────────────────────────────────────────
import type { NotificationLevelDef, NotificationThreshold } from "./types";

export const DEFAULT_LEVELS: readonly NotificationLevelDef[] = [
  { level: 1, colorName: "Green", hexColor: "#2E7D32", label: "Normal / Resolved", description: "Everything is operating normally, or a previous issue has been fixed." },
  { level: 2, colorName: "Light Green", hexColor: "#689F38", label: "Info / Low", description: "A minor update or routine event occurred." },
  { level: 3, colorName: "Yellow", hexColor: "#FBC02D", label: "Warning / Moderate", description: "An unusual spike or minor issue is detected." },
  { level: 4, colorName: "Orange", hexColor: "#F57C00", label: "High / Major", description: "A significant problem is affecting users or operations." },
  { level: 5, colorName: "Dark Red", hexColor: "#B71C1C", label: "Critical / Severe", description: "Total outage, security breach, or emergency." },
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

/** Coerce anything to a usable 1..5 level (unknown → 2 = "Info / Low"). */
export function clampLevel(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n));
}

function cleanHex(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return /^#?[0-9a-f]{6}$/i.test(s) ? (s.startsWith("#") ? s : `#${s}`).toUpperCase() : fallback;
}

/**
 * Parse a levels payload (JSON string or array) into exactly five sorted defs.
 * Bad input never throws — it falls back to the founder palette for the
 * missing/invalid entries, so a typo can never blank the UI.
 */
export function normalizeLevels(raw: unknown): NotificationLevelDef[] {
  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = (parsed as any).escalationLevels ?? (parsed as any).levels ?? null;
  }
  const list: any[] = Array.isArray(parsed) ? parsed : [];
  return DEFAULT_LEVELS.map((def) => {
    const hit = list.find((x) => Number(x?.level) === def.level) ?? {};
    return {
      level: def.level,
      colorName: String(hit.colorName ?? "").trim() || def.colorName,
      hexColor: cleanHex(hit.hexColor, def.hexColor),
      label: String(hit.label ?? "").trim() || def.label,
      description: String(hit.description ?? "").trim() || def.description,
    };
  });
}

export function levelDefOf(levels: readonly NotificationLevelDef[], level: unknown): NotificationLevelDef {
  const n = clampLevel(level);
  return levels.find((l) => l.level === n) ?? DEFAULT_LEVELS[n - 1];
}

export function levelHexOf(levels: readonly NotificationLevelDef[], level: unknown): string {
  return levelDefOf(levels, level).hexColor;
}

export function levelLabelOf(levels: readonly NotificationLevelDef[], level: unknown): string {
  return levelDefOf(levels, level).label;
}

export function levelColorNameOf(levels: readonly NotificationLevelDef[], level: unknown): string {
  return levelDefOf(levels, level).colorName;
}

/**
 * Threshold → level, highest matching level wins (so an author can list
 * `{"level":5,"op":"lt","value":2}` next to `{"level":3,"op":"lt","value":5}`).
 * Returns null when nothing matches (caller decides the default).
 */
export function levelForValue(
  thresholds: readonly NotificationThreshold[] | null | undefined,
  value: number,
): number | null {
  const rows = (thresholds ?? []).filter((t) => t && typeof t.value === "number");
  let best: number | null = null;
  for (const t of rows) {
    const v = Number(value);
    const hit =
      t.op === "lt" ? v < t.value
        : t.op === "lte" ? v <= t.value
          : t.op === "gt" ? v > t.value
            : t.op === "gte" ? v >= t.value
              : v === t.value;
    if (!hit) continue;
    const lvl = clampLevel(t.level);
    if (best === null || lvl > best) best = lvl;
  }
  return best;
}

/** Escalation memory: a rule without a `level` column climbs every N windows. */
export function escalatedLevel(baseLevel: number, streak: number, bumpEvery: number, maxLevel = MAX_LEVEL): number {
  const step = Math.floor(Math.max(0, Number(bumpEvery) || 0) > 0 ? Math.max(0, streak) / Math.max(1, bumpEvery) : 0);
  return Math.min(clampLevel(maxLevel), clampLevel(baseLevel) + step);
}
