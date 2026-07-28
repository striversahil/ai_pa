"use client";

import React, { useState, useEffect, useRef } from "react";
import Chart from "chart.js/auto";

interface TelecallerDashboardProps {
  data: {
    headers: string[];
    rows: any[];
  };
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  applyPresetRange: (preset: string) => void;
}

// Helpers
const parseTalkTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const cleaned = timeStr.toLowerCase().trim();
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned) || 0;
  
  if (cleaned.includes("min")) {
    const match = cleaned.match(/(\d+)\s*min/);
    if (match) return parseInt(match[1]);
  }
  
  let minutes = 0;
  let seconds = 0;
  const mMatch = cleaned.match(/(\d+)m/);
  if (mMatch) minutes = parseInt(mMatch[1]);
  
  const sMatch = cleaned.match(/(\d+)s/);
  if (sMatch) seconds = parseInt(sMatch[1]);
  
  return Number((minutes + seconds / 60).toFixed(1));
};

const parseSheetDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  
  const dmyMatch = cleaned.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2,4})$/i);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = months.indexOf(dmyMatch[2].toLowerCase());
    let year = parseInt(dmyMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  const ymdMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]));

  const mdMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdMatch) return new Date(parseInt(mdMatch[3]), parseInt(mdMatch[1]) - 1, parseInt(mdMatch[2]));

  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  return null;
};

const getEmployeeName = (row: any) => String(row["Employee Name"] || row["Agent Name"] || row["Agent"] || "Unknown").trim();
const getWorkAssigned = (row: any) => String(row["Work Assigned"] || row["Role"] || "Telecaller").trim();
const getDialed = (row: any) => parseInt(row["Outgoing Calls Count"] || row["Total Calls Dialed"] || row["Dialed Calls"] || "0") || 0;
const getConnected = (row: any) => parseInt(row["Total Connected Calls Count"] || row["Answered Calls"] || row["Connected Calls"] || "0") || 0;
const getTalkTime = (row: any) => parseTalkTimeToMinutes(row["Total Call Duration"] || row["Talk Time"] || row["Call Duration"] || "");
const getConfirmed = (row: any) => parseInt(row["Total SO Created- Count"] || row["Confirmed Orders"] || row["SO Count"] || "0") || 0;
const getDriveLink = (row: any) => row["Calling Report Screenshot"] || row["Calling Report Screenshot 2"] || row["Drive Link"] || "";
const getLeadsTotal = (row: any) => {
  const inc = parseInt(row["Leads From Incoming"] || row["Leads Incoming"] || "0") || 0;
  const out = parseInt(row["Leads From Outgoing"] || row["Leads Outgoing"] || "0") || 0;
  const ai = parseInt(row["Leads From AI"] || row["Leads AI"] || "0") || 0;
  return inc + out + ai;
};

export default function TelecallerDashboard({
  data,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  applyPresetRange
}: TelecallerDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("All");

  const barChartRef = useRef<HTMLCanvasElement | null>(null);
  const pieChartRef = useRef<HTMLCanvasElement | null>(null);
  const barChartInst = useRef<Chart | null>(null);
  const pieChartInst = useRef<Chart | null>(null);

  // Dynamic filter rows by date-range & role
  const filteredRows = React.useMemo(() => {
    if (!data || !data.rows) return [];

    return data.rows.filter((row: any) => {
      const dateField = row.Date || row.Timestamp;
      if (startDate && endDate && dateField) {
        const rowDate = parseSheetDate(dateField);
        if (rowDate) {
          const rTime = new Date(rowDate.getFullYear(), rowDate.getMonth(), rowDate.getDate()).getTime();
          const start = parseSheetDate(startDate);
          const sTime = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() : 0;
          const end = parseSheetDate(endDate);
          const eTime = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() : Infinity;

          if (rTime < sTime || rTime > eTime) return false;
        }
      }

      if (activeCategoryFilter !== "All" && getWorkAssigned(row) !== activeCategoryFilter) {
        return false;
      }

      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const customer = getEmployeeName(row).toLowerCase();
        const role = getWorkAssigned(row).toLowerCase();
        return customer.includes(query) || role.includes(query);
      }

      return true;
    });
  }, [data, searchQuery, activeCategoryFilter, startDate, endDate]);

  // Compute aggregated data for filtered telecallers
  const aggregatedEmployees = React.useMemo(() => {
    if (!data || !data.rows) return [];
    const aggMap: Record<string, any> = {};

    filteredRows.forEach((row: any) => {
      const emp = getEmployeeName(row);
      if (!emp || emp === "Unknown" || emp === "") return;

      const totalDialed = getDialed(row);
      const connected = getConnected(row);
      const talkTimeMin = getTalkTime(row);
      const confirmed = getConfirmed(row);
      const leadsTotal = getLeadsTotal(row);

      if (!aggMap[emp]) {
        aggMap[emp] = {
          name: emp,
          role: getWorkAssigned(row),
          daysCount: 0,
          totalDialed: 0,
          totalConnected: 0,
          totalTalktime: 0,
          totalConfirmed: 0,
          leadsTotal: 0
        };
      }

      aggMap[emp].daysCount += 1;
      aggMap[emp].totalDialed += totalDialed;
      aggMap[emp].totalConnected += connected;
      aggMap[emp].totalTalktime += talkTimeMin;
      aggMap[emp].totalConfirmed += confirmed;
      aggMap[emp].leadsTotal += leadsTotal;
    });

    return Object.values(aggMap);
  }, [filteredRows, data]);

  const isOnlyLeadGen = (role: string) => {
    const r = role.toLowerCase();
    return r === "telle caller" || r === "telecaller" || r === "lead generator";
  };

  // Performance Insights
  const performanceInsights = React.useMemo(() => {
    const goodList: any[] = [];
    const inconsistentList: any[] = [];

    aggregatedEmployees.forEach((emp: any) => {
      const connRate = emp.totalDialed > 0 ? (emp.totalConnected / emp.totalDialed) : 0;
      const leadRate = emp.totalConnected > 0 ? (emp.leadsTotal / emp.totalConnected) : 0;
      const soRate = emp.totalConnected > 0 ? (emp.totalConfirmed / emp.totalConnected) : 0;
      
      const isLeadGen = isOnlyLeadGen(emp.role);

      if (isLeadGen) {
        // Evaluated on Leads
        const isStarLeadGen = leadRate >= 0.12 && emp.leadsTotal >= 20;
        const isGoodLeadGen = leadRate >= 0.09 && emp.leadsTotal >= 10 && !isStarLeadGen;
        const isLowLeadGen = leadRate < 0.08 && emp.totalConnected >= 30;

        const description = `Dials: ${emp.totalDialed} | Connects: ${emp.totalConnected} | Leads: ${emp.leadsTotal}`;

        if (isStarLeadGen) {
          goodList.push({
            name: emp.name,
            role: emp.role,
            badge: "Star Lead Gen 🎯",
            desc: `${description} (${Math.round(leadRate * 100)}% Lead Rate)`
          });
        } else if (isGoodLeadGen) {
          goodList.push({
            name: emp.name,
            role: emp.role,
            badge: "Good Lead Gen 👍",
            desc: `${description} (${Math.round(leadRate * 100)}% Lead Rate)`
          });
        } else if (isLowLeadGen) {
          inconsistentList.push({
            name: emp.name,
            role: emp.role,
            badge: "Low Lead Rate ⚠️",
            desc: `${description} (${Math.round(leadRate * 100)}% Lead Rate, needs efficiency training)`
          });
        }
      } else {
        // Evaluated on SO Conversions
        const isStarConverter = soRate >= 0.04 && emp.totalConfirmed >= 15;
        const isGoodConverter = soRate >= 0.025 && emp.totalConfirmed >= 5 && !isStarConverter;
        const isLowConverter = soRate < 0.02 && emp.totalConnected >= 30;

        const description = `Dials: ${emp.totalDialed} | Connects: ${emp.totalConnected} | SOs: ${emp.totalConfirmed}`;

        if (isStarConverter) {
          goodList.push({
            name: emp.name,
            role: emp.role,
            badge: "Star Performer 🌟",
            desc: `${description} (${Math.round(soRate * 100)}% SO rate)`
          });
        } else if (isGoodConverter) {
          goodList.push({
            name: emp.name,
            role: emp.role,
            badge: "Good Performer 👍",
            desc: `${description} (${Math.round(soRate * 100)}% SO rate)`
          });
        } else if (isLowConverter) {
          inconsistentList.push({
            name: emp.name,
            role: emp.role,
            badge: "Low Conversions 📉",
            desc: `${description} (${Math.round(soRate * 100)}% SO rate, needs conversion coaching)`
          });
        }
      }
    });

    return { good: goodList, inconsistent: inconsistentList };
  }, [aggregatedEmployees]);

  // Generate charts
  useEffect(() => {
    if (!data || !data.rows || data.rows.length === 0) return;

    if (barChartInst.current) barChartInst.current.destroy();
    if (pieChartInst.current) pieChartInst.current.destroy();

    const canvasCtx1 = barChartRef.current?.getContext("2d");
    const canvasCtx2 = pieChartRef.current?.getContext("2d");

    if (!canvasCtx1) return;

    const chartLabels: string[] = [];
    const dialedData: number[] = [];
    const connectedData: number[] = [];
    const soData: number[] = [];
    const leadsData: number[] = [];

    aggregatedEmployees.forEach((emp: any) => {
      chartLabels.push(emp.name);
      dialedData.push(emp.totalDialed);
      connectedData.push(emp.totalConnected);
      soData.push(emp.totalConfirmed);
      leadsData.push(emp.leadsTotal);
    });

    // Bar Chart: Dialed vs Connected
    barChartInst.current = new Chart(canvasCtx1, {
      type: "bar",
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: "Dialed Calls",
            data: dialedData,
            backgroundColor: "rgba(99, 102, 241, 0.65)", // Indigo
            borderColor: "rgb(99, 102, 241)",
            borderWidth: 1.5,
            borderRadius: 4
          },
          {
            label: "Connected / Answered",
            data: connectedData,
            backgroundColor: "rgba(16, 185, 129, 0.65)", // Emerald
            borderColor: "rgb(16, 185, 129)",
            borderWidth: 1.5,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#d4d4d8" }
          }
        },
        scales: {
          y: {
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#a1a1aa" }
          },
          x: {
            grid: { display: false },
            ticks: { color: "#a1a1aa" }
          }
        }
      }
    });

    // Doughnut Chart: Leads Share
    if (canvasCtx2) {
      pieChartInst.current = new Chart(canvasCtx2, {
        type: "doughnut",
        data: {
          labels: chartLabels,
          datasets: [
            {
              label: "Leads Generated",
              data: leadsData,
              backgroundColor: [
                "rgba(99, 102, 241, 0.7)",
                "rgba(16, 185, 129, 0.7)",
                "rgba(245, 158, 11, 0.7)",
                "rgba(239, 68, 68, 0.7)",
                "rgba(139, 92, 246, 0.7)",
                "rgba(59, 130, 246, 0.7)"
              ],
              borderColor: "rgba(24, 24, 27, 0.8)",
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: "#d4d4d8", font: { size: 10 } }
            }
          }
        }
      });
    }
  }, [aggregatedEmployees, data]);

  // Compute stats card values
  const stats = React.useMemo(() => {
    let totalSO = 0;
    let totalCallsDialed = 0;
    let totalCallsConnected = 0;
    let totalLeads = 0;

    filteredRows.forEach((row: any) => {
      const emp = getEmployeeName(row);
      if (!emp || emp === "Unknown" || emp === "") return;

      totalSO += getConfirmed(row);
      totalCallsDialed += getDialed(row);
      totalCallsConnected += getConnected(row);
      totalLeads += getLeadsTotal(row);
    });

    const callRate = totalCallsDialed > 0 ? Math.round((totalCallsConnected / totalCallsDialed) * 100) : 0;
    const soRate = totalCallsConnected > 0 ? Math.round((totalSO / totalCallsConnected) * 100) : 0;
    const leadGenRate = totalCallsConnected > 0 ? Math.round((totalLeads / totalCallsConnected) * 100) : 0;

    return {
      val1: `${totalSO} orders`,
      val2: `${callRate}% (${totalCallsConnected}/${totalCallsDialed})`,
      val3: `${totalLeads} Leads`,
      val3Sub: `Lead Gen Rate: ${leadGenRate}% of connected`,
      val4: `${soRate}%`
    };
  }, [filteredRows]);

  const categoriesList = React.useMemo(() => {
    if (!data || !data.rows) return [];
    const cats = new Set<string>();
    data.rows.forEach((row: any) => {
      const category = getWorkAssigned(row);
      if (category && String(category).trim() !== "") cats.add(String(category).trim());
    });
    return ["All", ...Array.from(cats)];
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Date Range Control Strip */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-zinc-900 border border-zinc-800/80 rounded-xl p-3 shadow-sm text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Presets:</span>
          <select
            onChange={(e) => applyPresetRange(e.target.value)}
            defaultValue="all"
            className="bg-zinc-950 border border-zinc-850 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 Days</option>
            <option value="last30">Last 30 Days</option>
            <option value="all">All Available</option>
          </select>
        </div>

        <div className="h-6 w-px bg-zinc-800 hidden lg:block"></div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-zinc-950 border border-zinc-855 text-white text-[11px] rounded-lg px-2.5 py-1 focus:outline-none focus:border-indigo-500 font-medium"
          />
          <span className="text-zinc-650 font-bold">➔</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-zinc-950 border border-zinc-855 text-white text-[11px] rounded-lg px-2.5 py-1 focus:outline-none focus:border-indigo-500 font-medium"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-indigo-500/10 text-5xl font-bold font-mono">📈</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Total SO Created</span>
          <span className="text-2xl font-extrabold text-indigo-400 mt-1 z-10 font-mono">
            {stats.val1}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Total sales orders generated</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-emerald-500/10 text-5xl font-bold font-mono">📞</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Call Connection Rate</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 z-10 font-mono">
            {stats.val2}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Successful call connections ratio</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-violet-500/10 text-5xl font-bold font-mono">🎯</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Total Leads Generated</span>
          <span className="text-2xl font-extrabold text-violet-400 mt-1 z-10 font-mono">
            {stats.val3}
          </span>
          <span className="text-[9px] text-zinc-550 mt-0.5 font-bold truncate">
            {stats.val3Sub}
          </span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-amber-500/10 text-5xl font-bold font-mono">⚡</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">SO Conversion Rate</span>
          <span className="text-2xl font-extrabold text-amber-400 mt-1 z-10 font-mono">
            {stats.val4}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">SO Created / Connected calls ratio</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-md lg:col-span-2">
          <h3 className="text-zinc-200 font-bold text-sm mb-4">Dialed Calls vs Connected Calls</h3>
          <div className="h-64 relative font-mono">
            <canvas ref={barChartRef} />
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-md">
          <h3 className="text-zinc-200 font-bold text-sm mb-4">Leads Generation Sources Distribution</h3>
          <div className="h-64 relative font-mono">
            <canvas ref={pieChartRef} />
          </div>
        </div>
      </div>

      {/* AI Consistency Insights Panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-md space-y-4">
        <div>
          <h3 className="text-white font-bold text-base flex items-center gap-2">
            <span>🧠</span> AI-Driven Performance & Consistency Insights
          </h3>
          <p className="text-xs text-zinc-500 mt-1">Real-time caller evaluations derived from connection rates & SO conversions</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Top & Consistent Performers */}
          <div className="bg-emerald-950/10 border border-emerald-900/20 rounded-xl p-4 space-y-3">
            <h4 className="text-emerald-400 font-bold text-xs flex items-center gap-2">
              <span>🔥</span> Top & Consistent Performers
            </h4>
            {performanceInsights.good.length === 0 ? (
              <p className="text-xs text-zinc-500">No agents meet the top performer threshold in this range.</p>
            ) : (
              <div className="space-y-2.5">
                {performanceInsights.good.map((item) => (
                  <div key={item.name} className="bg-zinc-950/60 p-2.5 rounded-lg border border-emerald-950/30 flex justify-between items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-xs">{item.name}</span>
                        <span className="text-[8px] px-1 bg-zinc-800 text-zinc-400 rounded font-mono">{item.role}</span>
                      </div>
                      <span className="text-[10px] text-zinc-400">{item.desc}</span>
                    </div>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">
                      {item.badge}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inconsistent / Needs Focus */}
          <div className="bg-rose-950/10 border border-rose-900/20 rounded-xl p-4 space-y-3">
            <h4 className="text-rose-400 font-bold text-xs flex items-center gap-2">
              <span>⚠️</span> Inconsistent / Needs Training Focus
            </h4>
            {performanceInsights.inconsistent.length === 0 ? (
              <p className="text-xs text-zinc-500">No agents flagged for consistency issues in this range.</p>
            ) : (
              <div className="space-y-2.5">
                {performanceInsights.inconsistent.map((item) => (
                  <div key={item.name} className="bg-zinc-950/60 p-2.5 rounded-lg border border-rose-950/30 flex justify-between items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-xs">{item.name}</span>
                        <span className="text-[8px] px-1 bg-zinc-800 text-zinc-400 rounded font-mono">{item.role}</span>
                      </div>
                      <span className="text-[10px] text-zinc-400">{item.desc}</span>
                    </div>
                    <span className="text-[9px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold">
                      {item.badge}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
        <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
          <span>🏆</span> Telecaller Connection & SO Conversion Leaderboard
        </h3>
        <div className="overflow-x-auto border border-zinc-800 rounded-lg">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-bold">
                <th className="p-3.5 text-center">Rank</th>
                <th className="p-3.5">Employee Name</th>
                <th className="p-3.5">Work Assigned</th>
                <th className="p-3.5 text-center">Calls Dialed</th>
                <th className="p-3.5 text-center">Calls Connected</th>
                <th className="p-3.5 text-center">Call Connection Rate</th>
                <th className="p-3.5 text-center font-mono">Leads Generated</th>
                <th className="p-3.5 text-center">Lead Gen Rate</th>
                <th className="p-3.5 text-center">SO Created (Conversions)</th>
                <th className="p-3.5 text-center">SO Conversion Rate</th>
              </tr>
            </thead>
            <tbody>
              {aggregatedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-zinc-500">
                    No telecaller records found within this range.
                  </td>
                </tr>
              ) : (
                aggregatedEmployees
                  .sort((a: any, b: any) => {
                    const isAGen = isOnlyLeadGen(a.role);
                    const isBGen = isOnlyLeadGen(b.role);
                    if (isAGen !== isBGen) {
                      return isAGen ? 1 : -1; // Converters first
                    }
                    if (isAGen) {
                      return b.leadsTotal - a.leadsTotal;
                    }
                    return b.totalConfirmed - a.totalConfirmed;
                  })
                  .map((emp: any, idx: number) => {
                    const rate = emp.totalDialed > 0 ? Math.round((emp.totalConnected / emp.totalDialed) * 100) : 0;
                    const conv = emp.totalConnected > 0 ? Math.round((emp.totalConfirmed / emp.totalConnected) * 100) : 0;
                    return (
                      <tr key={emp.name} className="border-b border-zinc-800/60 hover:bg-zinc-800/20 text-zinc-300">
                        <td className="p-3.5 text-center font-bold text-zinc-400">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
                        </td>
                        <td className="p-3.5 font-bold text-white">{emp.name}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${
                            emp.role.toLowerCase() === "telle caller" || emp.role.toLowerCase() === "telecaller"
                              ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                              : emp.role.toLowerCase().includes("follow up")
                              ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                              : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                          }`}>
                            {emp.role}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-medium">{emp.totalDialed}</td>
                        <td className="p-3.5 text-center font-medium">{emp.totalConnected}</td>
                        <td className="p-3.5 text-center">
                          <span className={`font-bold ${
                            rate >= 50 ? "text-emerald-400" : rate >= 25 ? "text-amber-400" : "text-rose-400"
                          }`}>
                            {rate}%
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className="font-bold text-violet-400 font-mono">
                            {emp.leadsTotal}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`font-bold ${
                            (emp.totalConnected > 0 ? (emp.leadsTotal / emp.totalConnected) : 0) >= 0.20
                              ? "text-emerald-400"
                              : (emp.totalConnected > 0 ? (emp.leadsTotal / emp.totalConnected) : 0) >= 0.10
                              ? "text-amber-400"
                              : "text-rose-400"
                          }`}>
                            {emp.totalConnected > 0 ? Math.round((emp.leadsTotal / emp.totalConnected) * 100) : 0}%
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-bold text-zinc-200">
                          {isOnlyLeadGen(emp.role) ? (
                            <span className="text-zinc-550 italic font-mono">-</span>
                          ) : (
                            emp.totalConfirmed
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          {isOnlyLeadGen(emp.role) ? (
                            <span className="text-zinc-550 italic font-mono">-</span>
                          ) : (
                            <span className={`font-bold ${
                              conv >= 8 ? "text-emerald-400" : conv >= 4 ? "text-amber-400" : "text-rose-400"
                            }`}>
                              {conv}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Table list */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-6 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-white font-bold text-base">Raw Telecaller Sheet Data</h3>
            <p className="text-xs text-zinc-500 mt-1">Consolidated caller logs for selected time frame</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <select
              value={activeCategoryFilter}
              onChange={(e) => setActiveCategoryFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              {categoriesList.map((cat) => (
                <option key={cat} value={cat}>Role: {cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search callers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 w-full sm:w-60"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-zinc-800 rounded-lg">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-950/60 border-b border-zinc-800 text-zinc-400 font-bold">
                <th className="p-3.5 whitespace-nowrap">Date</th>
                <th className="p-3.5 whitespace-nowrap">Employee Name</th>
                <th className="p-3.5 whitespace-nowrap">Work Assigned</th>
                <th className="p-3.5 text-center whitespace-nowrap">Outgoing Calls</th>
                <th className="p-3.5 text-center whitespace-nowrap">Connected Calls</th>
                <th className="p-3.5 text-center whitespace-nowrap">Talk Time</th>
                <th className="p-3.5 text-center whitespace-nowrap">Leads Generated</th>
                <th className="p-3.5 text-center whitespace-nowrap">Lead Gen Rate</th>
                <th className="p-3.5 text-center whitespace-nowrap">SO Created</th>
                <th className="p-3.5 whitespace-nowrap">Report Screenshot</th>
                <th className="p-3.5 whitespace-nowrap">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-zinc-500">
                    No matching records found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row: any) => (
                  <tr key={row._rowId} className="border-b border-zinc-800/60 hover:bg-zinc-800/20 text-zinc-300">
                    <td className="p-3.5">{row.Date}</td>
                    <td className="p-3.5 font-bold text-white">{getEmployeeName(row)}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${
                        getWorkAssigned(row).toLowerCase() === "telle caller" || getWorkAssigned(row).toLowerCase() === "telecaller"
                          ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                          : getWorkAssigned(row).toLowerCase().includes("follow up")
                          ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                          : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                      }`}>
                        {getWorkAssigned(row)}
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-medium">{getDialed(row)}</td>
                    <td className="p-3.5 text-center font-medium">{getConnected(row)}</td>
                    <td className="p-3.5 text-center font-medium">{row["Total Call Duration"] || row["Talk Time"] || "0"}</td>
                    <td className="p-3.5 text-center font-bold text-violet-400">{getLeadsTotal(row)}</td>
                    <td className="p-3.5 text-center font-bold text-violet-550 font-mono">
                      {getConnected(row) > 0 ? Math.round((getLeadsTotal(row) / getConnected(row)) * 100) : 0}%
                    </td>
                    <td className="p-3.5 text-center font-bold text-zinc-200">
                      {isOnlyLeadGen(getWorkAssigned(row)) ? (
                        <span className="text-zinc-550 italic font-mono">-</span>
                      ) : (
                        getConfirmed(row)
                      )}
                    </td>
                    <td className="p-3.5 font-medium">
                      {getDriveLink(row) && getDriveLink(row).startsWith("http") ? (
                        <a
                          href={getDriveLink(row)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 hover:underline"
                        >
                          <span>📁</span> Screenshot
                        </a>
                      ) : (
                        <span className="text-zinc-650 font-mono">-</span>
                      )}
                    </td>
                    <td className="p-3.5 text-zinc-400 italic max-w-xs truncate" title={row.Remarks}>{row.Remarks || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
