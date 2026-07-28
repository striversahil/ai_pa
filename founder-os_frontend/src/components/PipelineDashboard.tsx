"use client";

import React, { useState, useEffect, useRef } from "react";
import Chart from "chart.js/auto";

interface PipelineDashboardProps {
  data: {
    headers: string[];
    rows: any[];
  };
  filteredRows: any[];
}

export default function PipelineDashboard({
  data,
  filteredRows
}: PipelineDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("All");

  const barChartRef = useRef<HTMLCanvasElement | null>(null);
  const pieChartRef = useRef<HTMLCanvasElement | null>(null);
  const barChartInst = useRef<Chart | null>(null);
  const pieChartInst = useRef<Chart | null>(null);

  // Dynamic filter rows by active category and search (within the already filtered range)
  const displayRows = React.useMemo(() => {
    return filteredRows.filter((row: any) => {
      const catField = row["Product Category"] || row["Category"];
      if (activeCategoryFilter !== "All" && catField !== activeCategoryFilter) {
        return false;
      }

      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const customer = String(row["Customer Name"] || "").toLowerCase();
        const category = String(catField || "").toLowerCase();
        const agent = String(row["Agent"] || "").toLowerCase();
        
        return customer.includes(query) || category.includes(query) || agent.includes(query);
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

    const valueByCustomer: Record<string, number> = {};
    const countByCategory: Record<string, number> = {};

    displayRows.forEach((row: any) => {
      const valueStr = String(row["Order Value (INR)"] || row["Value"] || row["Amount"] || "0");
      const val = parseFloat(valueStr.replace(/[^0-9.]/g, "")) || 0;

      const customer = String(row["Customer Name"] || row["Company"] || row["Customer"] || "Unknown");
      valueByCustomer[customer] = (valueByCustomer[customer] || 0) + val;

      const category = String(row["Product Category"] || row["Category"] || "Other");
      countByCategory[category] = (countByCategory[category] || 0) + 1;
    });

    // Bar Chart: Order Value by Customer
    barChartInst.current = new Chart(canvasCtx1, {
      type: "bar",
      data: {
        labels: Object.keys(valueByCustomer),
        datasets: [{
          label: "Order Value (INR)",
          data: Object.values(valueByCustomer),
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

    // Doughnut Chart: Product Category
    if (canvasCtx2) {
      pieChartInst.current = new Chart(canvasCtx2, {
        type: "doughnut",
        data: {
          labels: Object.keys(countByCategory),
          datasets: [{
            data: Object.values(countByCategory),
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
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: "#d4d4d8", font: { size: 11 } }
            }
          }
        }
      });
    }
  }, [displayRows, data]);

  // Compute stats card values
  const stats = React.useMemo(() => {
    let total = 0;
    displayRows.forEach((row: any) => {
      const valueStr = String(row["Order Value (INR)"] || row["Value"] || row["Amount"] || "0");
      total += parseFloat(valueStr.replace(/[^0-9.]/g, "")) || 0;
    });
    return {
      val1: `₹${total.toLocaleString("en-IN")}`,
      val2: displayRows.length,
      val3: `₹${(displayRows.length > 0 ? Math.round(total / displayRows.length) : 0).toLocaleString("en-IN")}`
    };
  }, [displayRows]);

  const categoriesList = React.useMemo(() => {
    if (!data || !data.rows) return [];
    const cats = new Set<string>();
    data.rows.forEach((row: any) => {
      const category = row["Product Category"] || row["Category"];
      if (category && String(category).trim() !== "") cats.add(String(category).trim());
    });
    return ["All", ...Array.from(cats)];
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-indigo-500/10 text-5xl font-bold font-mono">₹</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Total Pipeline Value</span>
          <span className="text-2xl font-extrabold text-indigo-400 mt-1 z-10 font-mono">
            {stats.val1}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Calculated across selected range</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-emerald-500/10 text-5xl font-bold font-mono">📋</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Total Orders / Rows</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 z-10 font-mono">
            {stats.val2}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium font-mono">Active dataset row counts</span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 text-amber-500/10 text-5xl font-bold font-mono">⚡</div>
          <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">Average Deal Size</span>
          <span className="text-2xl font-extrabold text-amber-400 mt-1 z-10 font-mono">
            {stats.val3}
          </span>
          <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">Ratio of total pipeline to row counts</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-md lg:col-span-2">
          <h3 className="text-zinc-200 font-bold text-sm mb-4">Pipeline Value by Customer</h3>
          <div className="h-64 relative font-mono">
            <canvas ref={barChartRef} />
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-md">
          <h3 className="text-zinc-200 font-bold text-sm mb-4">Product Category Distribution</h3>
          <div className="h-64 relative font-mono">
            <canvas ref={pieChartRef} />
          </div>
        </div>
      </div>

      {/* Tabular Raw Data */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-6 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-white font-bold text-base">Raw CRM Pipeline Data</h3>
            <p className="text-xs text-zinc-500 mt-1">Showing filtered pipeline entries</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <select
              value={activeCategoryFilter}
              onChange={(e) => setActiveCategoryFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {categoriesList.map((cat) => (
                <option key={cat} value={cat}>Category: {cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search pipeline..."
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
                <th className="p-3.5 whitespace-nowrap">Customer Name</th>
                <th className="p-3.5 whitespace-nowrap">Product Category</th>
                <th className="p-3.5 text-right whitespace-nowrap">Order Value (INR)</th>
                <th className="p-3.5 whitespace-nowrap">Agent</th>
                <th className="p-3.5 whitespace-nowrap">Status</th>
                <th className="p-3.5 text-center whitespace-nowrap">Probability (%)</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500">
                    No matching records found.
                  </td>
                </tr>
              ) : (
                displayRows.map((row: any) => (
                  <tr key={row._rowId} className="border-b border-zinc-800/60 hover:bg-zinc-800/20 text-zinc-300">
                    <td className="p-3.5">{row.Date}</td>
                    <td className="p-3.5 font-bold text-white">{row["Customer Name"]}</td>
                    <td className="p-3.5 font-medium">{row["Product Category"] || row.Category}</td>
                    <td className="p-3.5 text-right font-mono font-bold text-indigo-400">₹{parseFloat(row["Order Value (INR)"] || "0").toLocaleString("en-IN")}</td>
                    <td className="p-3.5 font-medium">{row.Agent}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${
                        (row.Status || "").toLowerCase() === "won" 
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                          : (row.Status || "").toLowerCase() === "lost" 
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      }`}>{row.Status}</span>
                    </td>
                    <td className="p-3.5 text-center font-mono font-bold">{row["Probability (%)"]}%</td>
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
