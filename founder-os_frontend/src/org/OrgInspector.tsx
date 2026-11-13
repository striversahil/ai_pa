"use client";

// OrgInspector — the right rail for the selected chart position.
//
// Click a node to pin its people here: every active employee, their login
// state (relative last login), granted dashboards, and sales fields.
// Edit opens the person drawer (only when the server says canManage).
import type { OrgPerson } from "@/org/api";
import { orgPosition, responsibilityLine } from "@/hr/organization";
import { relActive } from "@/lib/format";

function SalesLine({ p }: { p: OrgPerson }) {
  const r = p.roster;
  if (!r) return null;
  const bits: string[] = [];
  if (r.type) bits.push(r.type === "field_staff" ? "Field Staff" : r.type === "team_lead" ? "Team Lead" : "Telecaller");
  if (r.region) bits.push(r.region2 ? `${r.region}+${r.region2}` : r.region);
  if (r.tlLevel) bits.push(r.tlLevel);
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {bits.map((b) => (
        <span key={b} className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">{b}</span>
      ))}
      {r.whatsapp && (
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">WA {r.whatsapp}</span>
      )}
      {(r.neodoveUserName || r.phone) && (
        <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-bold text-zinc-500" title={r.neodoveUserId ? `NeoDove id ${r.neodoveUserId}` : "Office phone"}>
          ☎ {r.neodoveUserName || r.phone}
        </span>
      )}
    </div>
  );
}

export default function OrgInspector({ title, people, onEdit, onClose }: {
  title: string;
  people: OrgPerson[];
  onEdit: (p: OrgPerson) => void;
  onClose: () => void;
}) {
  const pos = orgPosition(title);
  const active = people.filter((p) => p.employee.active);
  const inactive = people.filter((p) => !p.employee.active);
  const logins = active.filter((p) => p.login).length;
  return (
    <aside className="w-full shrink-0 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 lg:w-[340px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {pos ? responsibilityLine(pos) : "Top of the chart"}
            {pos?.department ? ` · ${pos.department}` : ""}
          </p>
        </div>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Unpin">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-400">Active seats</div>
          <div className="text-base font-extrabold">{active.length}</div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-400">Have logins</div>
          <div className="text-base font-extrabold">{logins}</div>
        </div>
      </div>

      {active.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-700">
          Vacant — add the person in the HR Employees tab, then set their position here.
        </p>
      )}

      <div className="space-y-2">
        {active.map((p) => (
          <div key={p.employee.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-zinc-900 dark:text-zinc-100">{p.employee.name}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${p.login ? "bg-emerald-500" : "bg-amber-400"}`} />
                  {p.login ? relActive(p.login.lastLoginAt) : "No login linked"}
                </div>
              </div>
              {p.canManage && (
                <button
                  onClick={() => onEdit(p)}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500"
                >
                  Edit
                </button>
              )}
            </div>
            {p.login && p.login.scopes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.login.scopes.map((s) => (
                  <span key={s} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{s}</span>
                ))}
              </div>
            )}
            <SalesLine p={p} />
          </div>
        ))}
      </div>

      {inactive.length > 0 && (
        <details className="text-[11px] text-zinc-500">
          <summary className="cursor-pointer font-bold">Inactive ({inactive.length})</summary>
          <div className="mt-1 space-y-1">
            {inactive.map((p) => (
              <div key={p.employee.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1 dark:bg-zinc-900">
                <span className="truncate">{p.employee.name}</span>
                {p.canManage && <button onClick={() => onEdit(p)} className="font-bold text-indigo-500 hover:underline">Edit</button>}
              </div>
            ))}
          </div>
        </details>
      )}
    </aside>
  );
}
