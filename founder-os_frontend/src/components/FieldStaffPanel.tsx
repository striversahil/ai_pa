"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { hasSalesManagerAccess } from "./SalesControllerPanel";
import { fetchFieldStaff, istToday, logExpenseDay, twoWeeksAgo } from "@/field-staff/api";
import { compareVisits, type FieldStaffData, type FieldVisit } from "@/field-staff/types";
import FieldExpenseCalendar from "./FieldExpenseCalendar";
import { CheckInBar } from "./field-staff-panel/CheckInBar";
import { VisitCard } from "./field-staff-panel/VisitCard";
import { OpenVisitBanner } from "./field-staff-panel/OpenVisitBanner";
import { MillList } from "./field-staff-panel/MillList";
import { FollowupBox } from "./field-staff-panel/FollowupBox";

export default function FieldStaffPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me as any);
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState(twoWeeksAgo());
  const [to, setTo] = useState(istToday());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expenseStaffId, setExpenseStaffId] = useState("");
  const [msg, setMsg] = useState("");

  const query = useLiveDashboard(
    useCallback(() => fetchFieldStaff({ from, to, staffId: staffId || undefined }), [from, to, staffId]),
    { events: ["field-staff", "enquiries"], deps: [from, to, staffId] },
  );
  const data: FieldStaffData | null = query.data ?? null;
  const visits = useMemo(() => [...(data?.visits ?? [])].sort(compareVisits), [data]);
  const selected: FieldVisit | null = useMemo(
    () => visits.find((v) => v.id === selectedId) ?? visits[0] ?? null,
    [visits, selectedId],
  );
  const globalFollowups = useMemo(() => {
    const rows = data?.openFollowups ?? [];
    return [...rows].sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? "")));
  }, [data]);

  // Keep the expense staffer in sync with the visit filter (manual override wins).
  const staffList = data?.staff ?? [];
  const effectiveExpenseStaff = expenseStaffId || staffId || "";
  const pickStaff = (id: string) => {
    setStaffId(id);
    setExpenseStaffId(id);
    setSelectedId(null);
  };

  return (
    <div className="space-y-3">
      <CheckInBar
        staff={data?.staff ?? []}
        staffId={staffId}
        setStaffId={pickStaff}
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        onDone={(m) => { setMsg(m); query.refresh(); }}
        onCheckedIn={(id) => { setSelectedId(id); query.refresh(); }}
      />
      {msg && <p className="text-[11px] text-[var(--text-secondary)]">{msg}</p>}
      {query.error ? <p className="text-xs text-red-600">Load failed: {String(query.error)} — <button className="underline" onClick={() => query.refresh()}>retry</button></p> : null}

      {/* Horizontal staffer tabs — toggle any individual field visit book. */}
      <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => pickStaff("")}
          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
            !staffId ? "bg-brand-indigo text-white ring-brand-indigo shadow" : "bg-[var(--bg-card)] text-[var(--text-secondary)] ring-[var(--border-card)]"
          }`}
        >
          All staff
        </button>
        {(data?.staff ?? []).map((s) => (
          <button
            key={s.id}
            onClick={() => pickStaff(s.id)}
            title={s.region ? `Region ${s.region}` : s.name}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
              staffId === s.id
                ? "bg-brand-indigo text-white ring-brand-indigo shadow"
                : "bg-[var(--bg-card)] text-[var(--text-secondary)] ring-[var(--border-card)] hover:ring-brand-indigo/50"
            }`}
          >
            {s.name}{s.region ? ` · ${s.region}` : ""}
          </button>
        ))}
        {(data?.staff ?? []).length === 0 && !query.loading && (
          <span className="text-[11px] text-[var(--text-tertiary)]">No field staff in roster — add them in Controller → Roster (type = Field Staff).</span>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap gap-2 text-[11px] font-bold text-[var(--text-secondary)]">
          <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 ring-1 ring-[var(--border-card)]">{data.totals.visits} visits</span>
          <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 ring-1 ring-[var(--border-card)]">{data.totals.mills} mills</span>
          <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 ring-1 ring-[var(--border-card)]">₹{Math.round(data.totals.expenses).toLocaleString("en-IN")} expenses</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400">{data.totals.openFollowups} open follow-ups</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <section className="space-y-2">
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Visits</h2>
          {visits.length === 0 && !query.loading && (
            <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-center text-[11px] text-[var(--text-tertiary)]">
              No visits in this window. Check in above to start the day.
            </p>
          )}
          <div className="space-y-2 border-l-2 border-[var(--border-card)] pl-3">
            {visits.map((v) => (
              <VisitCard
                key={v.id}
                v={v}
                active={selected?.id === v.id}
                canManage={canManage}
                onPick={() => setSelectedId(v.id)}
                onChanged={() => query.refresh()}
              />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
            Mills{selected ? ` — ${selected.city} (${selected.day})` : ""}
          </h2>
          {!selected && <p className="text-[11px] text-[var(--text-tertiary)]">Pick a visit to see its mills.</p>}
          {selected && (
            <OpenVisitBanner visit={selected} onDone={(m) => { setMsg(m); query.refresh(); }} />
          )}
          {selected && (
            <MillList visit={selected} canManage={canManage} onDone={(m) => { if (m) setMsg(m); query.refresh(); }} />
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Follow-ups (global)</h2>
          <FollowupBox
            open={globalFollowups}
            onDone={() => query.refresh()}
          />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Day-wise expenses</h2>
        <FieldExpenseCalendar
          expenses={data?.expenses ?? []}
          staff={staffList}
          expenseStaffId={effectiveExpenseStaff}
          onExpenseStaffChange={(id) => setExpenseStaffId(id)}
          onLog={async ({ day, staffId: sid, amount, description }) => {
            await logExpenseDay({ day, staffId: sid, amount, description });
            query.refresh();
          }}
        />
      </section>
    </div>
  );
}
