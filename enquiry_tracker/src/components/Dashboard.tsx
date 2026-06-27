import React, { useState, useMemo } from "react";
import { Agent, Enquiry } from "../mockData";

interface DashboardProps {
  enquiries: Enquiry[];
  agents: Agent[];
  currentAgent: Agent;
  onOpenCreate: () => void;
  onViewDetail: (enquiryId: string) => void;
  onViewAllEnquiries: () => void;
}

export default function Dashboard({
  enquiries,
  agents,
  currentAgent,
  onOpenCreate,
  onViewDetail,
  onViewAllEnquiries
}: DashboardProps) {
  const [baseTime] = useState(() => Date.now());

  // Dashboard Stats
  const stats = useMemo(() => {
    const active = enquiries.filter(e => !["won", "lost"].includes(e.status));
    const activeCount = active.length;
    const pipelineValue = active.reduce((sum, e) => sum + e.estimatedValue, 0);

    const wonCount = enquiries.filter(e => e.status === "won").length;
    const closedCount = enquiries.filter(e => ["won", "lost"].includes(e.status)).length;
    const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

    // Last 7 days metrics
    const dailyData: Record<string, { count: number; value: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const dateStr = new Date(baseTime - i * 24 * 60 * 60 * 1000).toDateString().slice(4, 10);
      dailyData[dateStr] = { count: 0, value: 0 };
    }

    enquiries.forEach(e => {
      const enqDate = new Date(e.createdAt).toDateString().slice(4, 10);
      if (dailyData[enqDate] !== undefined) {
        dailyData[enqDate].count += 1;
        dailyData[enqDate].value += e.estimatedValue;
      }
    });

    const chartPoints = Object.keys(dailyData).map(date => ({
      label: date,
      count: dailyData[date].count,
      value: dailyData[date].value
    }));

    const statusCounts = {
      new: enquiries.filter(e => e.status === "new").length,
      contacted: enquiries.filter(e => e.status === "contacted").length,
      qualified: enquiries.filter(e => e.status === "qualified").length,
      proposal: enquiries.filter(e => e.status === "proposal").length,
      negotiation: enquiries.filter(e => e.status === "negotiation").length,
      won: enquiries.filter(e => e.status === "won").length,
      lost: enquiries.filter(e => e.status === "lost").length
    };

    return {
      activeCount,
      pipelineValue,
      winRate,
      chartPoints,
      statusCounts
    };
  }, [enquiries, baseTime]);

  // custom SVG line coordinates calculator
  const svgLineChartPath = useMemo(() => {
    const points = stats.chartPoints;
    if (points.length === 0) return { strokePath: "", fillPath: "", coords: [] };
    
    const width = 500;
    const height = 180;
    const maxVal = Math.max(...points.map(p => p.value), 50000);
    const minVal = 0;

    const coords = points.map((p, idx) => {
      const x = 50 + (idx / (points.length - 1)) * (width - 100);
      const ratio = (p.value - minVal) / (maxVal - minVal);
      const y = height - 30 - ratio * (height - 60);
      return { x, y };
    });

    let path = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      path += ` L ${coords[i].x} ${coords[i].y}`;
    }

    const gradientPath = `${path} L ${coords[coords.length - 1].x} ${height - 30} L ${coords[0].x} ${height - 30} Z`;

    return {
      strokePath: path,
      fillPath: gradientPath,
      coords
    };
  }, [stats.chartPoints]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold font-heading tracking-tight">B2B Pipeline Dashboard</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">Hello, {currentAgent.name.split(" ")[0]}. Here is your B2B sales funnel overview.</p>
        </div>
        <button 
          onClick={onOpenCreate} 
          className="inline-flex items-center justify-center gap-2 bg-brand-indigo hover:opacity-90 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/20 transition-all duration-200 cursor-pointer"
          type="button"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>New Enquiry</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-[var(--text-secondary)] tracking-wider uppercase">Pipeline Value</span>
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-brand-indigo">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <span className="text-2xl md:text-3xl font-extrabold font-heading">₹{stats.pipelineValue.toLocaleString()}</span>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mt-3">
            <span className="px-1.5 py-0.5 rounded-full bg-brand-emerald/10 text-brand-emerald font-bold">+12.4%</span>
            <span>vs last month</span>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-[var(--text-secondary)] tracking-wider uppercase">Active Enquiries</span>
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-brand-emerald">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
          </div>
          <span className="text-2xl md:text-3xl font-extrabold font-heading">{stats.activeCount}</span>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mt-3">
            <span className="px-1.5 py-0.5 rounded-full bg-brand-emerald/10 text-brand-emerald font-bold">+3</span>
            <span>active negotiations</span>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-[var(--text-secondary)] tracking-wider uppercase">Win Rate</span>
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-brand-amber">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
          </div>
          <span className="text-2xl md:text-3xl font-extrabold font-heading">{stats.winRate}%</span>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mt-3">
            <span className="px-1.5 py-0.5 rounded-full bg-brand-emerald/10 text-brand-emerald font-bold">+4.8%</span>
            <span>over standard targets</span>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-[var(--text-secondary)] tracking-wider uppercase">Logs & Updates</span>
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center text-brand-rose">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
          </div>
          <span className="text-2xl md:text-3xl font-extrabold font-heading">{enquiries.reduce((sum, e) => sum + (e.activities?.length || 0), 0)}</span>
          <div className="flex items-center text-xs text-[var(--text-tertiary)] mt-3">
            <span>Collaborative history logs</span>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        {/* Line Chart */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <span className="font-heading font-extrabold text-base md:text-lg">Pipeline Growth Trend</span>
            <span className="text-xs text-[var(--text-secondary)]">Values (INR) over past 7 days</span>
          </div>
          <div className="w-full h-[240px] relative overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 500 180" preserveAspectRatio="none">
              <defs>
                <linearGradient id="indigo-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              <line x1="50" y1="30" x2="450" y2="30" stroke="var(--border-card)" strokeDasharray="4" />
              <line x1="50" y1="90" x2="450" y2="90" stroke="var(--border-card)" strokeDasharray="4" />
              <line x1="50" y1="150" x2="450" y2="150" stroke="var(--border-card)" strokeDasharray="4" />

              {svgLineChartPath.coords.length > 0 && (
                <>
                  <path d={svgLineChartPath.fillPath} fill="url(#indigo-gradient)" />
                  <path d={svgLineChartPath.strokePath} fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
                  
                  {svgLineChartPath.coords.map((c, i) => (
                    <g key={i}>
                      <circle cx={c.x} cy={c.y} r="5" fill="var(--bg-card)" stroke="#6366f1" strokeWidth="2" />
                      <text x={c.x} y={c.y - 12} textAnchor="middle" fontSize="9" fill="var(--text-primary)" fontWeight="bold">
                        {stats.chartPoints[i].value > 0 ? `₹${Math.round(stats.chartPoints[i].value / 1000)}k` : ""}
                      </text>
                    </g>
                  ))}
                </>
              )}

              {stats.chartPoints.map((p, idx) => (
                <text key={idx} x={50 + (idx / (stats.chartPoints.length - 1)) * 350} y="172" textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                  {p.label}
                </text>
              ))}
            </svg>
          </div>
        </div>

        {/* Status Funnel */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <span className="font-heading font-extrabold text-base md:text-lg mb-4">Pipeline Funnel</span>
          <div className="space-y-3.5 flex-1 flex flex-col justify-center">
            {Object.entries(stats.statusCounts).map(([status, count]) => {
              const maxVal = Math.max(...Object.values(stats.statusCounts), 1);
              const widthPercent = (count / maxVal) * 100;
              return (
                <div className="space-y-1" key={status}>
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="capitalize">{status}</span>
                    <span className="text-[var(--text-secondary)]">{count}</span>
                  </div>
                  <div className="h-2 w-full bg-[var(--bg-input)] rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-rose transition-all duration-500" 
                      style={{ width: `${widthPercent}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Leads Grid list */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <span className="font-heading font-extrabold text-base md:text-lg">Recent Enquiries</span>
          <button 
            onClick={onViewAllEnquiries} 
            className="text-xs text-brand-indigo font-bold hover:underline cursor-pointer bg-transparent border-0"
            type="button"
          >
            View All
          </button>
        </div>

        <div className="space-y-3">
          {enquiries.slice(0, 3).map(enq => {
            const agent = agents.find(a => a.id === enq.assignedAgentId);
            return (
              <div 
                key={enq.id} 
                className="p-4 border border-[var(--border-card)] rounded-xl hover:border-brand-indigo flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] items-start md:items-center gap-3 md:gap-6 cursor-pointer transition-all duration-200 bg-[var(--bg-card)] shadow-xs hover:shadow-md" 
                onClick={() => onViewDetail(enq.id)}
              >
                <div className="min-w-0">
                  <span className="block font-bold text-sm md:text-base truncate">{enq.title}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-[var(--text-secondary)] font-semibold">{enq.clientCompany}</span>
                    <span className="text-[var(--text-tertiary)] text-[10px]">•</span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(enq.createdAt).toDateString()}</span>
                  </div>
                </div>

                <div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
                    ${enq.status === "new" ? "bg-[var(--bg-input)] text-[var(--text-secondary)]" : ""}
                    ${enq.status === "contacted" ? "bg-indigo-500/10 text-brand-indigo" : ""}
                    ${enq.status === "qualified" ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" : ""}
                    ${enq.status === "proposal" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400" : ""}
                    ${enq.status === "negotiation" ? "bg-brand-amber/10 text-brand-amber" : ""}
                    ${enq.status === "won" ? "bg-brand-emerald/10 text-brand-emerald" : ""}
                    ${enq.status === "lost" ? "bg-brand-rose/10 text-brand-rose" : ""}
                  `}>
                    {enq.status}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-xs">
                  <span className={`w-2 h-2 rounded-full 
                    ${enq.priority === "high" ? "bg-brand-rose" : ""}
                    ${enq.priority === "medium" ? "bg-brand-amber" : ""}
                    ${enq.priority === "low" ? "bg-brand-emerald" : ""}
                  `}></span>
                  <span className="capitalize font-medium">{enq.priority}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-white flex-shrink-0" style={{ backgroundColor: agent?.color }}>
                    {agent?.initials || "UN"}
                  </div>
                  <span className="text-xs font-semibold">{agent?.name.split(" ")[0]}</span>
                </div>

                <div className="w-full md:w-auto text-left md:text-right font-heading font-extrabold text-sm md:text-base text-brand-indigo mt-1 md:mt-0">
                  ₹{enq.estimatedValue.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
