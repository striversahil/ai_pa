import React, { useState, useMemo } from "react";
import { Agent, Enquiry } from "../mockData";
import KpiCard from "./KpiCard";
import TrendChart from "./TrendChart";
import PipelineFunnel from "./PipelineFunnel";

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
        <KpiCard
          title="Pipeline Value"
          value={`₹${stats.pipelineValue.toLocaleString()}`}
          icon={
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          trendText="+12.4% vs last month"
          trendPositive={true}
        />

        <KpiCard
          title="Active Enquiries"
          value={stats.activeCount}
          icon={
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
          }
          trendText="+3 active negotiations"
          trendPositive={true}
        />

        <KpiCard
          title="Win Rate"
          value={`${stats.winRate}%`}
          icon={
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 013.138-3.138z" />
            </svg>
          }
          trendText="+4.8% over standard targets"
          trendPositive={true}
        />

        <KpiCard
          title="Logs & Updates"
          value={enquiries.reduce((sum, e) => sum + (e.activities?.length || 0), 0)}
          icon={
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
          trendText="Collaborative history logs"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        {/* Line Chart */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5 shadow-xs">
          <div className="flex justify-between items-center mb-6">
            <div>
              <span className="font-heading font-extrabold text-base md:text-lg block text-[var(--text-primary)]">Pipeline Growth Trend</span>
              <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Value trajectory based on RFQ estimated volumes</span>
            </div>
            <span className="text-[10px] font-bold text-brand-indigo bg-brand-indigo/10 px-2 py-1 rounded-md uppercase tracking-wider">INR • Past 7 Days</span>
          </div>
          <div className="w-full h-[240px] relative overflow-hidden">
            <TrendChart chartPoints={stats.chartPoints} />
          </div>
        </div>

        {/* Status Funnel */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <span className="font-heading font-extrabold text-base md:text-lg block text-[var(--text-primary)]">Pipeline Funnel</span>
            <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5 mb-4">Stage distribution of active enquiries</span>
          </div>
          <PipelineFunnel statusCounts={stats.statusCounts} />
        </div>
      </div>

      {/* Recent Leads Grid list */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5 shadow-xs">
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="font-heading font-extrabold text-base md:text-lg block text-[var(--text-primary)]">Recent Enquiries</span>
            <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Quick access to the latest customer requests</span>
          </div>
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
                className="p-4 border border-[var(--border-card)] rounded-lg hover:bg-[var(--bg-input)]/30 hover:border-brand-indigo/50 flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] items-start md:items-center gap-3 md:gap-6 cursor-pointer transition-all duration-150 bg-[var(--bg-card)]" 
                onClick={() => onViewDetail(enq.id)}
              >
                <div className="min-w-0">
                  <span className="block font-bold text-sm md:text-base truncate text-[var(--text-primary)]">{enq.title}</span>
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
                  <span className="capitalize font-semibold text-[var(--text-secondary)]">{enq.priority}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-white flex-shrink-0" style={{ backgroundColor: agent?.color }}>
                    {agent?.initials || "UN"}
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">{agent?.name.split(" ")[0]}</span>
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
