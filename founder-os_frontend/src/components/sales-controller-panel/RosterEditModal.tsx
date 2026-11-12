"use client";

// Extracted verbatim from SalesControllerPanel.tsx by scripts/refactor/split-module.mjs.
// SalesControllerPanel.tsx re-exports everything public here, so existing imports keep working.
import type { RosterRow } from "../TelecallingDashboard";
import React, { useState, useEffect } from "react";
import { REGIONS } from "@/telecalling/regions";

// ── Roster add/edit modal ────────────────────────────────────────────────────
// Opens from "Add agent" (create) or a roster card's Edit button. Edits contact
// + role fields, plus the NeoDove link: a dropdown of currently-unlinked
// NeoDove users (the roster phone is the human-verifiable key — compare it
// with the NeoDove User Call Report's Mobile Number column before linking).
// Auto-sync only fills empty link fields and never overwrites a hand link.
export function RosterEditModal({
  target,
  open,
  busy,
  neodoveUsers,
  onSave,
  onClose,
}: {
  target: RosterRow | null; // null = creating a new agent
  open: boolean;
  busy: boolean;
  neodoveUsers: Array<{ userId: string; userName: string }>;
  onSave: (updates: { name: string; email: string; phone: string; whatsapp: string; region: string; region2: string; tlLevel: string; type: string; neodove: { userId: string; userName: string } | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [region, setRegion] = useState("");
  const [region2, setRegion2] = useState("");
  const [tlLevel, setTlLevel] = useState("");
  const [staffType, setStaffType] = useState("telecaller");
  const [neoLink, setNeoLink] = useState("");

  const neoKeyOf = (userId: unknown, userName: unknown) =>
    `${String(userId ?? '').trim()}‖${String(userName ?? '').trim()}`;

  // Re-sync on open too: cancelling with dirty edits then re-opening the SAME
  // agent must not resurrect the abandoned values (target identity unchanged).
  useEffect(() => {
    if (!open) return;
    if (target) {
      setName(target.name);
      setEmail(target.email ?? "");
      setPhone(target.phone ?? "");
      setWhatsapp(target.whatsapp ?? "");
      setRegion(target.region ?? "");
      setRegion2(target.region2 ?? "");
      setTlLevel(target.tlLevel ?? "");
      setStaffType(target.type === "field_staff" ? "field_staff" : target.type === "team_lead" ? "team_lead" : "telecaller");
      setNeoLink((target as any)?.neodoveUserName ? neoKeyOf((target as any).neodoveUserId, (target as any).neodoveUserName) : "");
    } else {
      setName(""); setEmail(""); setPhone(""); setWhatsapp("");
      setRegion(""); setRegion2(""); setTlLevel(""); setStaffType("telecaller");
      setNeoLink("");
    }
  }, [target, open]);

  if (!open) return null;

  const isCreate = !target;
  const inputCls = "w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm";
  const field = (label: string, children: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div>
          <h4 className="font-bold text-zinc-900 dark:text-white">{isCreate ? "Add sales staff" : "Edit sales staff"}</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {isCreate ? "Create a sales-roster entry — telecaller, field staff or team lead. Link their NeoDove user so calls attribute correctly." : "Update contact details, type, role and the NeoDove link (phone + linked user must belong to the same person)."}
          </p>
        </div>

        <div className="space-y-3">
          {field("Type", (
            <select
              value={staffType}
              onChange={(e) => { setStaffType(e.target.value); }}
              className={inputCls}
            >
              <option value="telecaller">Telecaller — uses the dashboard</option>
              <option value="field_staff">Field Staff — leads logged by sales agents</option>
              <option value="team_lead">Team Lead — owns the reseller target, never listed as a telecaller</option>
            </select>
          ))}
          {field("Name", <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />)}
          {field("Email", <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Email" />)}
          {field("Phone — the mapping key (must match the NeoDove User Call Report's Mobile Number for this person)", <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />)}
          {field("WhatsApp", <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inputCls} placeholder="WhatsApp" />)}

          <div className="grid grid-cols-2 gap-2">
            {field("Region", (
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
                <option value="">Unmapped</option>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
              </select>
            ))}
            {field("Hierarchy", (
              <select value={tlLevel} onChange={(e) => setTlLevel(e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="TL1">TL1</option>
                <option value="TL2">TL2</option>
              </select>
            ))}
          </div>
          {staffType === "team_lead" && tlLevel === "TL1" && field("Second region (Team Lead covers two)", (
            <select value={region2} onChange={(e) => setRegion2(e.target.value)} className={inputCls}>
              <option value="">Pick second region…</option>
              {REGIONS.filter((r) => r.id !== region).map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
            </select>
          ))}
          {staffType === "team_lead" && tlLevel === "TL1" && region && region2 && region === region2 && (
            <p className="text-[11px] rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-rose-600 dark:text-rose-400">
              A TL1 needs two DIFFERENT regions — pick a second region different from the first.
            </p>
          )}

          {staffType === "team_lead" && (
            <p className="text-[11px] rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-3 py-2 text-indigo-700 dark:text-indigo-300">
              Team Leads are <b>not telecallers</b> — they never appear in the region staff rail. They own the ₹1L/day <b>reseller</b> target across their two regions (TL strip); every reseller sale by their telecallers counts into it.
            </p>
          )}

          {staffType === "field_staff" && (
            <p className="text-[11px] rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-sky-700 dark:text-sky-400">
              Field staff never use the dashboard and never close. Sales agents log their enquiries with source <b>Field Staff</b>; the lead, region and 20% generator credit go to them. Set a region below so their estimates land in the right region.
            </p>
          )}

          {/* NeoDove link — hand-picked here; auto-sync never overwrites it.
              Compare the roster phone above with the NeoDove User Call Report's
              Mobile Number column before linking. */}
          {field("NeoDove user", (
            <select
              value={neoLink}
              onChange={(e) => setNeoLink(e.target.value)}
              className={inputCls}
            >
              <option value="">No link</option>
              {target && (target as any)?.neodoveUserName && !neodoveUsers.some((u) => neoKeyOf(u.userId, u.userName) === neoKeyOf((target as any).neodoveUserId, (target as any).neodoveUserName)) && (
                <option value={neoKeyOf((target as any).neodoveUserId, (target as any).neodoveUserName)}>
                  ✓ {(target as any).neodoveUserName} (currently linked)
                </option>
              )}
              {neodoveUsers.map((u) => (
                <option key={neoKeyOf(u.userId, u.userName)} value={neoKeyOf(u.userId, u.userName)}>
                  {u.userName || "(no name)"}{u.userId ? ` · ${String(u.userId).slice(0, 8)}…` : ""}
                </option>
              ))}
            </select>
          ))}
          {!isCreate && (target as any)?.neodoveUserName && (
            <p className="text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-zinc-500 dark:text-zinc-400">
              Currently linked to NeoDove user <b>{(target as any).neodoveUserName}</b>
              {(target as any)?.neodoveUserId ? ` (id: ${String((target as any).neodoveUserId).slice(0, 8)}…)` : ""}.
              Pick another user to re-link, or “No link” to unlink.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => {
              const parts = neoLink ? String(neoLink).split('‖') : [];
              onSave({
                name, email, phone, whatsapp, region,
                region2: staffType === "team_lead" && tlLevel === "TL1" ? region2 : "",
                tlLevel, type: staffType,
                neodove: parts.length === 2 && (parts[0] || parts[1])
                  ? { userId: parts[0], userName: parts[1] }
                  : null,
              });
            }}
            disabled={busy || !name.trim() || (staffType === "team_lead" && tlLevel === "TL1" && !!region && !!region2 && region === region2)}
            className="px-4 py-2 text-sm rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : isCreate ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
