import React, { useState, useMemo } from "react";
import { IndianRupee, Users, Trophy, Activity, Inbox } from "lucide-react";
import { Agent, Enquiry } from "../mockData";
import { Card, CardHeader, KpiCard, StatusBadge, PriorityBadge, EmptyState } from "./ui";
import TrendChart from "./TrendChart";
import PipelineFunnel from "./PipelineFunnel";
import EnquiryRowItem from "./EnquiryRowItem";

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
  onViewAllEnquiries,
}: DashboardProps) {
  const [baseTime] = useState(() => Date.now());

  const stats = useMemo(() => {
    const active = enquiries.filter((e) => !["won", "lost"].includes(e.status));
    const activeCount = active.length;
    const pipelineValue = active.reduce((sum, e) => sum + e.estimatedValue, 0);

    const wonCount = enquiries.filter((e) => e.status === "won").length;
    const closedCount = enquiries.filter((e) => ["won", "lost"].includes(e.status)).length;
    const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

    const dailyData: Record<string, { count: number; value: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const dateStr = new Date(baseTime - i * 24 * 60 * 60 * 1000).toDateString().slice(4, 10);
      dailyData[dateStr] = { count: 0, value: 0 };
    }
    enquiries.forEach((e) => {
      const enqDate = new Date(e.createdAt).toDateString().slice(4, 10);
      if (dailyData[enqDate] !== undefined) {
        dailyData[enqDate].count += 1;
        dailyData[enqDate].value += e.estimatedValue;
      }
    });

    const chartPoints = Object.keys(dailyData).map((date) => ({
      label: date,
      count: dailyData[date].count,
      value: dailyData[date].value,
    }));

    const statusCounts = {
      new: enquiries.filter((e) => e.status === "new").length,
      contacted: enquiries.filter((e) => e.status === "contacted").length,
      qualified: enquiries.filter((e) => e.status === "qualified").length,
      proposal: enquiries.filter((e) => e.status === "proposal").length,
      negotiation: enquiries.filter((e) => e.status === "negotiation").length,
      won: enquiries.filter((e) => e.status === "won").length,
      lost: enquiries.filter((e) => e.status === "lost").length,
    };

    return { activeCount, pipelineValue, winRate, chartPoints, statusCounts };
  }, [enquiries, baseTime]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight text-[var(--text-primary)] md:text-3xl">
            B2B Pipeline Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Hello, {currentAgent.name.split(" ")[0]}. Here is your sales funnel overview.
          </p>
        </div>
        <button
          onClick={onOpenCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-indigo)] px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-card)] transition hover:opacity-90"
          type="button"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>New Enquiry</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Pipeline Value"
          value={`₹${stats.pipelineValue.toLocaleString()}`}
          accent="brand"
          icon={<IndianRupee className="h-5 w-5" />}
          hint={`${stats.activeCount} active enquir${stats.activeCount === 1 ? "y" : "ies"}`}
        />
        <KpiCard
          title="Active Enquiries"
          value={stats.activeCount}
          accent="info"
          icon={<Users className="h-5 w-5" />}
          hint="Open in pipeline"
        />
        <KpiCard
          title="Win Rate"
          value={`${stats.winRate}%`}
          accent="success"
          icon={<Trophy className="h-5 w-5" />}
          hint="Closed deals won"
        />
        <KpiCard
          title="Activity Logs"
          value={enquiries.reduce((sum, e) => sum + (e.activities?.length || 0), 0)}
          accent="violet"
          icon={<Activity className="h-5 w-5" />}
          hint="Collaborative history"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Pipeline Growth Trend"
            subtitle="Value trajectory based on RFQ estimated volumes"
            action={
              <span className="rounded-md bg-[color-mix(in_srgb,var(--color-brand-indigo)_12%,transparent)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-indigo)]">
                INR • Past 7 Days
              </span>
            }
          />
          <div className="relative h-[240px] w-full overflow-hidden">
            <TrendChart chartPoints={stats.chartPoints} />
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <CardHeader title="Pipeline Funnel" subtitle="Stage distribution of active enquiries" />
          <PipelineFunnel statusCounts={stats.statusCounts} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent Enquiries"
          subtitle="Quick access to the latest customer requests"
          action={
            <button
              onClick={onViewAllEnquiries}
              className="rounded-lg bg-transparent text-xs font-bold text-[var(--color-brand-indigo)] transition hover:underline"
              type="button"
            >
              View All
            </button>
          }
        />
        {enquiries.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title="No enquiries yet"
            description="Create your first enquiry to start tracking your pipeline."
            action={
              <button
                onClick={onOpenCreate}
                className="rounded-xl bg-[var(--color-brand-indigo)] px-4 py-2 text-xs font-bold text-white transition hover:opacity-90"
              >
                New Enquiry
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {enquiries.slice(0, 3).map((enq) => (
              <EnquiryRowItem
                key={enq.id}
                enq={enq}
                agent={agents.find((a) => a.id === enq.assignedAgentId)}
                onViewDetail={onViewDetail}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
