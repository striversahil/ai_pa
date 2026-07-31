"use client";

import React, { useState, useEffect, useRef } from "react";
import Chart from "chart.js/auto";

interface CrmTrackerDashboardProps {
  data: {
    headers: string[];
    rows: any[];
  };
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  applyPresetRange: (preset: string) => void;
  filteredRows: any[];
  crmDataWarnings: any[];
  triggerAIRemarksAudit: () => void;
  aiReportOutput: string;
  isAiGenerating: boolean;
}

// Helpers for date calculations
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

const parseRemarkDates = (remarkStr: string): Date[] => {
  if (!remarkStr) return [];
  const regex = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g;
  const dates: Date[] = [];
  let match;
  while ((match = regex.exec(remarkStr)) !== null) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    let year = parseInt(match[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) {
      dates.push(d);
    }
  }
  return dates;
};

export default function CrmTrackerDashboard({
  data,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  applyPresetRange,
  filteredRows,
  crmDataWarnings,
  triggerAIRemarksAudit,
  aiReportOutput,
  isAiGenerating
}: CrmTrackerDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("All");
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);

  const barChartRef = useRef<HTMLCanvasElement | null>(null);
  const pieChartRef = useRef<HTMLCanvasElement | null>(null);
  const barChartInst = useRef<Chart | null>(null);
  const pieChartInst = useRef<Chart | null>(null);

  // Helper getters
  const getSOAmount = (row: any) => parseFloat(String(row["Total Amount"] || row["Amount"] || "0").replace(/[^0-9.]/g, "")) || 0;
  const getDriveLink = (row: any) => row["Calling Report Screenshot"] || row["Calling Report Screenshot 2"] || row["Drive Link"] || "";

  // Dynamic filter rows by active category and search (within the already date-filtered rows)
  const displayRows = React.useMemo(() => {
    return filteredRows.filter((row: any) => {
      if (activeCategoryFilter !== "All" && row["Stock Confirmation"] !== activeCategoryFilter) {
        return false;
      }

      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const customer = String(row["Company Name"] || "").toLowerCase();
        const orderNum = String(row["SO Number"] || "").toLowerCase();
        const status = String(row["Stock Confirmation"] || "").toLowerCase();
        
        return customer.includes(query) || orderNum.includes(query) || status.includes(query);
      }

      return true;
    });
  }, [filteredRows, activeCategoryFilter, searchQuery]);

  // Generate charts on filtered context change
  useEffect(() => {
    if (!data || !data.rows || displayRows.length === 0) return;

    if (barChartInst.current) barChartInst.current.destroy();
    if (pieChartInst.current) pieChartInst.current.destroy();

    const canvasCtx1 = barChartRef.current?.getContext("2d");
    const canvasCtx2 = pieChartRef.current?.getContext("2d");

    if (!canvasCtx1) return;

    const companies: string[] = [];
    const orderAmounts: number[] = [];
    const stocks: Record<string, number> = {};

    displayRows.forEach((row: any) => {
      companies.push(row["Company Name"] || "Unknown");
      const amt = getSOAmount(row);
      orderAmounts.push(amt);

      const stock = row["Stock Confirmation"] || "Unknown";
      stocks[stock] = (stocks[stock] || 0) + 1;
    });

    // Bar Chart: Order Value by Company
    barChartInst.current = new Chart(canvasCtx1, {
      type: "bar",
      data: {
        labels: companies,
        datasets: [{
          label: "Order Amount (INR)",
          data: orderAmounts,
          backgroundColor: "rgba(99, 102, 241, 0.65)",
          borderColor: "rgb(99, 102, 241)",
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
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

    // Doughnut Chart: Stock Confirmation Share
    if (canvasCtx2) {
      pieChartInst.current = new Chart(canvasCtx2, {
        type: "doughnut",
        data: {
          labels: Object.keys(stocks),
          datasets: [{
            data: Object.values(stocks),
            backgroundColor: [
              "rgba(16, 185, 129, 0.7)",  // Green - Available
              "rgba(245, 158, 11, 0.7)",  // Yellow - Partially Available
              "rgba(99, 102, 241, 0.7)"   // Blue - Unknown
            ],
            borderColor: "rgba(24, 24, 27, 0.8)",
            borderWidth: 2
          }]
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
  }, [displayRows, data]);

  // Compute stats card values
  const stats = React.useMemo(() => {
    let totalVal = 0;
    let delayedCount = 0;
    let overdueExpectedCount = 0;
    const today = new Date(); // Use actual current date

    displayRows.forEach((row: any) => {
      totalVal += getSOAmount(row);
      const status = (row["On Time Status-BUI"] || "").toLowerCase();
      const isDelayed = status.includes("delayed");
      if (isDelayed) {
        delayedCount += 1;
      }

      // Check if scheduled date was in the past and expected date is in the future
      const sched = parseSheetDate(row['Scheduled Date']);
      const tent = parseSheetDate(row['Tentative Delivery Date BUI']);
      const remarkDates = parseRemarkDates(row.Remarks);

      const hasFutureExpectedDate = (tent && tent > today) || remarkDates.some(rd => rd > today);
      const wasScheduledInPast = sched && sched < today;

      if (isDelayed && wasScheduledInPast && hasFutureExpectedDate) {
        overdueExpectedCount += 1;
      }
    });

    return {
      val1: `₹${totalVal.toLocaleString("en-IN")}`,
      val2: `${delayedCount} Delayed`,
      val3: `${overdueExpectedCount} Overdue & expected in future`,
      val4: `${displayRows.filter((r: any) => r["Stock Confirmation"] === "Available").length} Ready / ${displayRows.length} Total`
    };
  }, [displayRows]);

  const categoriesList = React.useMemo(() => {
    if (!data || !data.rows) return [];
    const cats = new Set<string>();
    data.rows.forEach((row: any) => {
      const category = row["Stock Confirmation"];
      if (category && String(category).trim() !== "") cats.add(String(category).trim());
    });
    return ["All", ...Array.from(cats)];
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Date Picker strip */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-zinc-900 border border-zinc-800/80 rounded-xl p-3 shadow-sm text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Presets:</span>
          <select
            onChange={(e) => applyPresetRange(e.target.value)}
            defaultValue="today"
            className="bg-zinc-950 border border-zinc-855 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
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
          <div className="absolute top-0 right-0 p-2 text-indigo-500/10 text-5xl font-bold font-mono">₹</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Total Dispatch Value</span>
          <span className="text-2xl font-extrabold text-indigo-400 mt-1 z-10 font-mono">
            {stats.val1}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Sum of active dispatch order amounts</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-rose-500/10 text-5xl font-bold font-mono">📦</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Dispatch Delays</span>
          <span className="text-2xl font-extrabold text-rose-455 mt-1 z-10 font-mono">
            {stats.val2}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Dispatches currently marked as delayed</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-amber-500/10 text-5xl font-bold font-mono">⏳</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Overdue & Rescheduled</span>
          <span className="text-2xl font-extrabold text-amber-455 mt-1 z-10 font-mono">
            {stats.val3}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Delayed dispatches expected after today</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-emerald-500/10 text-5xl font-bold font-mono">⚡</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Stock Readiness</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 z-10 font-mono">
            {stats.val4}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Fully available stock dispatches</span>
        </div>
      </div>

      {/* Data Integrity Audit Panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h3 className="text-white font-bold text-base flex items-center gap-2">
              <span>🔍</span> Data Quality & Integrity Audit ({crmDataWarnings.length} Warnings)
            </h3>
            <p className="text-xs text-zinc-500 mt-1">Scans dispatch logs for missing transporters, dates, email addresses, or unbilled orders.</p>
          </div>

          <button
            onClick={triggerAIRemarksAudit}
            disabled={isAiGenerating}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-550 disabled:bg-zinc-850 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            {isAiGenerating ? "⌛ Auditing..." : "🧠 AI EOD Summary"}
          </button>
        </div>

        {aiReportOutput && (
          <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-xl p-4 text-xs text-zinc-200 leading-relaxed font-medium space-y-2">
            <strong className="text-indigo-400 text-sm block">💡 EOD AI Remark Summary:</strong>
            <p className="whitespace-pre-line">{aiReportOutput}</p>
          </div>
        )}

        <div className="overflow-x-auto border border-zinc-800 rounded-lg">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-bold text-[10px] uppercase">
                <th className="p-3 text-center w-12">Row</th>
                <th className="p-3 w-48">Company Name</th>
                <th className="p-3 w-40">Field Target</th>
                <th className="p-3">Identified Issue / Correction Needed</th>
                <th className="p-3 text-center w-28">Severity</th>
              </tr>
            </thead>
            <tbody>
              {crmDataWarnings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-emerald-400 font-bold">
                    ✓ Data is clean! Zero warnings or missing fields found in sheet range.
                  </td>
                </tr>
              ) : (
                (showAllWarnings ? crmDataWarnings : crmDataWarnings.slice(0, 10)).map((warning: any, idx: number) => (
                  <tr key={idx} className="border-b border-zinc-805 hover:bg-zinc-800/10 text-zinc-300">
                    <td className="p-3 text-center font-mono font-bold text-zinc-500">{warning.sNo}</td>
                    <td className="p-3 font-bold text-white">{warning.company}</td>
                    <td className="p-3 text-zinc-400 font-mono text-[10px]">{warning.field}</td>
                    <td className="p-3 font-medium">{warning.issue}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded ${
                        warning.severity === "critical" 
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      }`}>{warning.severity}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {crmDataWarnings.length > 10 && (
            <div className="relative group/showmore text-center py-3 bg-zinc-950 border-t border-zinc-800 rounded-b-lg">
              <button 
                onClick={() => setShowAllWarnings(!showAllWarnings)}
                className="text-indigo-400 hover:text-indigo-300 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5 mx-auto"
              >
                <span>{showAllWarnings ? "➖" : "➕"}</span>
                {showAllWarnings ? "Show Less" : `Show ${crmDataWarnings.length - 10} More Warnings`}
              </button>
              
              {!showAllWarnings && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-96 max-h-60 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 shadow-2xl opacity-0 scale-95 pointer-events-none group-hover/showmore:opacity-100 group-hover/showmore:scale-100 transition-all duration-200 z-50 text-left space-y-1.5 scrollbar-thin">
                  <div className="border-b border-zinc-800 pb-1.5 mb-1.5 flex justify-between items-center">
                    <span className="text-zinc-200 font-bold text-[10px] uppercase tracking-wider">Warnings Preview</span>
                    <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded font-bold font-mono">+{crmDataWarnings.length - 10}</span>
                  </div>
                  {crmDataWarnings.slice(10).map((warn, i) => (
                    <div key={i} className="text-[10px] flex gap-1.5 items-start py-0.5">
                      <span className="text-zinc-500 font-mono font-bold">#{warn.sNo}</span>
                      <span className="text-zinc-300 font-bold truncate max-w-[120px]">{warn.company}:</span>
                      <span className="text-zinc-400 truncate flex-1">{warn.issue}</span>
                    </div>
                  ))}
                  <div className="text-zinc-500 text-[9px] text-center pt-1.5 border-t border-zinc-800 font-bold">
                    (Click to expand table inline)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-md lg:col-span-2">
          <h3 className="text-zinc-200 font-bold text-sm mb-4">Order Value by Company</h3>
          <div className="h-64 relative font-mono">
            <canvas ref={barChartRef} />
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-md">
          <h3 className="text-zinc-200 font-bold text-sm mb-4">Stock Confirmation Distribution</h3>
          <div className="h-64 relative font-mono">
            <canvas ref={pieChartRef} />
          </div>
        </div>
      </div>

      {/* Raw Tabular view */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-6 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-white font-bold text-base">Raw CRM Tracker Data</h3>
            <p className="text-xs text-zinc-500 mt-1">Consolidated dispatch list for selected range</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <select
              value={activeCategoryFilter}
              onChange={(e) => setActiveCategoryFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              {categoriesList.map((cat) => (
                <option key={cat} value={cat}>Stock: {cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search tracker..."
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
                <th className="p-3.5 whitespace-nowrap">SO Number</th>
                <th className="p-3.5 whitespace-nowrap">Company Name</th>
                <th className="p-3.5 text-right whitespace-nowrap">Amount</th>
                <th className="p-3.5 whitespace-nowrap">Transporter</th>
                <th className="p-3.5 whitespace-nowrap">Stock Confirmation</th>
                <th className="p-3.5 whitespace-nowrap">Scheduled Date</th>
                <th className="p-3.5 whitespace-nowrap">Dispatch Date</th>
                <th className="p-3.5 whitespace-nowrap">On Time Status</th>
                <th className="p-3.5 whitespace-nowrap">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-zinc-500">
                    No matching records found.
                  </td>
                </tr>
              ) : (
                (showAllRows ? displayRows : displayRows.slice(0, 10)).map((row: any) => (
                  <tr key={row._rowId} className="border-b border-zinc-800/60 hover:bg-zinc-800/20 text-zinc-300">
                    <td className="p-3.5 font-bold text-white">{row["SO Number"]}</td>
                    <td className="p-3.5 font-bold text-white">{row["Company Name"]}</td>
                    <td className="p-3.5 text-right font-mono font-bold text-indigo-400">₹{row.Amount}</td>
                    <td className="p-3.5 font-medium">{row.Transporter || <span className="text-zinc-650 font-mono italic">None</span>}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${
                        (row["Stock Confirmation"] || "").toLowerCase() === "available"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      }`}>{row["Stock Confirmation"]}</span>
                    </td>
                    <td className="p-3.5">{row["Scheduled Date"]}</td>
                    <td className="p-3.5">{row["Dispatch Date"] || <span className="text-zinc-650 font-mono">-</span>}</td>
                    <td className="p-3.5">
                      {row["On Time Status-BUI"] ? (
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${
                          (row["On Time Status-BUI"] || "").toLowerCase() === "on time"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}>{row["On Time Status-BUI"]}</span>
                      ) : (
                        <span className="text-zinc-650 font-mono">-</span>
                      )}
                    </td>
                    <td className="p-3.5 text-zinc-400 max-w-xs truncate" title={row.Remarks}>
                      {row.Remarks ? (
                        <span>
                          {row.Remarks.toUpperCase().includes("DELIVERED") && (
                            <span className="inline-block mr-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase">✓ Shipped</span>
                          )}
                          {row.Remarks.toUpperCase().includes("SAMPLE") && (
                            <span className="inline-block mr-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase">⚙️ Sample</span>
                          )}
                          {row.Remarks}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {displayRows.length > 10 && (
            <div className="relative group/showrows text-center py-3 bg-zinc-950 border-t border-zinc-800 rounded-b-lg">
              <button 
                onClick={() => setShowAllRows(!showAllRows)}
                className="text-indigo-400 hover:text-indigo-300 font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5 mx-auto"
              >
                <span>{showAllRows ? "➖" : "➕"}</span>
                {showAllRows ? "Show Less" : `Show ${displayRows.length - 10} More Rows`}
              </button>
              
              {!showAllRows && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-96 max-h-60 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 shadow-2xl opacity-0 scale-95 pointer-events-none group-hover/showrows:opacity-100 group-hover/showrows:scale-100 transition-all duration-200 z-50 text-left space-y-1.5 scrollbar-thin">
                  <div className="border-b border-zinc-800 pb-1.5 mb-1.5 flex justify-between items-center">
                    <span className="text-zinc-200 font-bold text-[10px] uppercase tracking-wider">Remaining Rows Preview</span>
                    <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded font-bold font-mono">+{displayRows.length - 10}</span>
                  </div>
                  {displayRows.slice(10).map((row, i) => (
                    <div key={i} className="text-[10px] flex gap-1.5 items-start py-0.5">
                      <span className="text-zinc-300 font-bold truncate max-w-[120px]">{row["Company Name"]}:</span>
                      <span className="text-zinc-400 truncate flex-1">{row["SO Number"]} | Stock: {row["Stock Confirmation"]}</span>
                    </div>
                  ))}
                  <div className="text-zinc-500 text-[9px] text-center pt-1.5 border-t border-zinc-800 font-bold">
                    (Click to expand table inline)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
