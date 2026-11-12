"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.


export function MillFacts({ m }: { m: any }) {
  const rows: Array<[string, string]> = [
    ["Contact", [m.keyContact, m.designation].filter(Boolean).join(" · ")],
    ["Phone", m.phone],
    ["Roller plant", m.rollerPlantNos],
    ["Atta chakki", m.attaChakkiNos],
    ["Chakki size", m.chakkiSize],
    ["Running", m.runningTime],
    ["Products", m.products],
    ["Mill age", m.millAgeYrs ? `${m.millAgeYrs} yrs` : ""],
    ["Brand", m.machineBrand],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex gap-1.5"><dt className="text-[var(--text-tertiary)]">{k}:</dt><dd className="font-semibold text-[var(--text-primary)]">{v}</dd></div>
      ))}
      {!m.isNew && m.matchMasterName && (
        <div className="col-span-2 flex gap-1.5"><dt className="text-[var(--text-tertiary)]">Matches:</dt><dd className="font-semibold text-[var(--text-primary)]">{m.matchMasterName}</dd></div>
      )}
    </dl>
  );
}
