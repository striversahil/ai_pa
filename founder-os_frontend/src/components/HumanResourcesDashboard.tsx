"use client";

import React, { useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import DelegationTab from "./human-resources/DelegationTab";
import EmployeesTab from "./human-resources/EmployeesTab";
import HiringKitTab from "./human-resources/HiringKitTab";
import AttendanceTab from "./human-resources/AttendanceTab";
import LeavesTab from "./human-resources/LeavesTab";
import PayrollTab from "./human-resources/PayrollTab";
import ExpensesTab from "./human-resources/ExpensesTab";
import InventoryTab from "./human-resources/InventoryTab";
import type { HrDashboardData } from "@/hr/types";
import { currentMonthIST, monthLabel, shiftMonth } from "@/hr/format";

type HrView = "employees" | "hiring-kit" | "delegation" | "attendance" | "leaves" | "payroll" | "expenses" | "inventory";

type HrTab = { key: HrView; label: string; icon: string };

const GROUPS: { label: string; tabs: HrTab[] }[] = [
  {
    label: "People",
    tabs: [
      { key: "employees", label: "Employees", icon: "◉" },
      { key: "hiring-kit", label: "Hiring kit", icon: "▣" },
      { key: "attendance", label: "Attendance", icon: "◷" },
      { key: "leaves", label: "Leaves & holidays", icon: "◒" },
      { key: "payroll", label: "Payroll", icon: "₹" },
      { key: "delegation", label: "Delegation", icon: "☑" },
    ],
  },
  {
    label: "Finance",
    tabs: [
      { key: "expenses", label: "Expenses", icon: "▦" },
      { key: "inventory", label: "Inventory", icon: "▤" },
    ],
  },
];

export default function HumanResourcesDashboard() {
  const { me } = useAuth();
  const [view, setView] = useState<HrView>("employees");
  const [month, setMonth] = useState(currentMonthIST());

  const dash = useLiveDashboard<HrDashboardData>(async () => {
    const res = await fetch(`/api/automations/human-resources/data?month=${encodeURIComponent(month)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { deps: [month], pollMs: 60000 });

  const data = dash.data;
  const counts: Record<HrView, number | null> = {
    employees: data ? data.employees.activeCount : null,
    "hiring-kit": null,
    delegation: data ? data.meta.counts.open : null,
    attendance: null,
    leaves: null,
    payroll: null,
    expenses: data ? data.expenses.summary.fixedCount + data.expenses.summary.variableCount + data.expenses.summary.fieldStaffCount : null,
    inventory: data ? data.inventory.summary.itemCount : null,
  };

  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Human Resources <span className="text-xs font-medium text-zinc-500">· employees + attendance + payroll</span></h2>
          {data && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-bold text-zinc-800 dark:text-zinc-100">{data.meta.canManage ? "Full view" : data.meta.self ? `Viewing as ${data.meta.self.selfName}` : "Unlinked user"}</span>
              <span className="text-zinc-400">·</span>
              <span className="text-zinc-500">{monthLabel(data.expenses.month)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(shiftMonth(month, -1))} title="Previous month" className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">←</button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
          <button onClick={() => setMonth(shiftMonth(month, 1))} title="Next month" className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">→</button>
          <button onClick={() => setMonth(currentMonthIST())} className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-indigo-500 hover:bg-indigo-500/10">This month</button>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <aside className="w-full shrink-0">
          <div className="space-y-3">
            {GROUPS.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">{group.label}</div>
                <nav className="flex flex-row flex-wrap gap-2">
                  {group.tabs.map((t) => {
                    const active = view === t.key;
                    const count = counts[t.key];
                    return (
                      <button
                        key={t.key}
                        onClick={() => setView(t.key)}
                        className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
                          active
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <span className="text-base leading-none">{t.icon}</span>
                        {t.label}
                        {count !== null && count > 0 && (
                          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-extrabold ${active ? "bg-white/25 text-white" : "bg-indigo-500/15 text-indigo-500 dark:text-indigo-400"}`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {dash.loading && !data && <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Loading Human Resources…</div>}
          {Boolean(dash.error) && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
              Failed to load: {String(dash.error)} <button onClick={() => dash.refresh()} className="ml-2 underline">Retry</button>
            </div>
          )}
          {view === "employees" && <EmployeesTab />}
          {view === "hiring-kit" && (
            <HiringKitTab
              designations={(data?.roster ?? [])
                .map((member) => String(member.designation ?? "").trim())
                .filter(Boolean)}
            />
          )}
          {data && view === "delegation" && <DelegationTab data={data} onRefresh={() => dash.refresh()} onManageEmployees={() => setView("employees")} />}
          {view === "attendance" && <AttendanceTab />}
          {view === "leaves" && <LeavesTab />}
          {view === "payroll" && <PayrollTab />}
          {data && view === "expenses" && (
            <ExpensesTab data={data} month={month} canManage={data.meta.canManage} me={me} onRefresh={() => dash.refresh()} />
          )}
          {data && view === "inventory" && (
            <InventoryTab data={data} canManage={data.meta.canManage} onRefresh={() => dash.refresh()} />
          )}
        </div>
      </div>
    </div>
  );
}
