// Extracted verbatim from WhatsAppMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// WhatsAppMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.


export type LeadStats = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
};

export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  provider: string;
  status: string;
  scheduleType: string;
  scheduledAt: string | null;
  cron: string | null;
  timezone: string;
  templateName: string | null;
  messageBody: string | null;
  mediaUrl: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  runCount: number;
  stats: LeadStats;
  recentRuns: { id: string; status: string; total: number; sent: number; failed: number; startedAt: string }[];
};

export type DashboardData = {
  kpis: {
    campaigns: number;
    active: number;
    draft: number;
    paused: number;
    completed: number;
    totalLeads: number;
    providers: { waba: { configured: boolean } };
  };
  campaigns: Campaign[];
  recentRuns: { id: string; status: string; total: number; sent: number; failed: number; startedAt: string }[];
};
