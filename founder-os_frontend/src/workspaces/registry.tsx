"use client";

// workspaces/registry.tsx — workspace slug → React component.
//
// Moved verbatim from components/Automations.tsx#renderDashboard. Rendered by
// BOTH hosts (/session and the /automations registry console) via
// <WorkspaceRenderer slug>. Add a new dashboard: one `dynamic()` line + one
// RENDERERS entry here, and one catalog entry in
// founder-os_backend/src/modules/workspaces/catalog.ts.

import React from "react";
import dynamic from "next/dynamic";
import { canonicalNavSlug } from "./aliases";
import { useWorkspaceHost } from "./WorkspaceHost";

// Lazy-load each dashboard so only the opened one is fetched & parsed.
const ZohoEstimates = dynamic(() => import("@/components/ZohoEstimates"), { ssr: false });
const DppPricesDashboard = dynamic(() => import("@/components/DppPricesDashboard"), { ssr: false });
const SheetAnalysisDashboard = dynamic(() => import("@/components/SheetAnalysisDashboard"), { ssr: false });
const WaEngineDashboard = dynamic(() => import("@/components/WaEngineDashboard"), { ssr: false });
const WhatsAppMarketingDashboard = dynamic(() => import("@/components/WhatsAppMarketingDashboard"), { ssr: false });
const NeodoveTelecallerDashboard = dynamic(() => import("@/components/NeodoveTelecallerDashboard"), { ssr: false });
const AccountsDashboard = dynamic(() => import("@/components/AccountsDashboard"), { ssr: false });
const DigitalMarketingDashboard = dynamic(() => import("@/components/DigitalMarketingDashboard"), { ssr: false });
const HumanResourcesDashboard = dynamic(() => import("@/components/HumanResourcesDashboard"), { ssr: false });
const AutopilotDashboard = dynamic(() => import("@/components/AutopilotDashboard"), { ssr: false });
const ProcurementQueue = dynamic(() => import("@/components/ProcurementQueue"), { ssr: false });
const ManagementReview = dynamic(() => import("@/components/ManagementReview"), { ssr: false });
const CrmDashboard = dynamic(() => import("@/components/CrmDashboard"), { ssr: false });
const ProductLineDashboard = dynamic(() => import("@/components/ProductLineDashboard"), { ssr: false });
const SamarthOverviewDashboard = dynamic(() => import("@/components/SamarthOverviewDashboard"), { ssr: false });
const SahilOverviewDashboard = dynamic(() => import("@/components/SahilOverviewDashboard"), { ssr: false });
const LinkedinDashboard = dynamic(() => import("@/components/LinkedinDashboard"), { ssr: false });
const AiUsageDashboard = dynamic(() => import("@/components/AiUsageDashboard"), { ssr: false });
const ReportingSheetView = dynamic(() => import("@/components/reporting/ReportingSheetView"), { ssr: false });
const StockDashboard = dynamic(() => import("@/components/StockDashboard"), { ssr: false });
const DebtorsTrackerDashboard = dynamic(() => import("@/components/DebtorsTrackerDashboard"), { ssr: false });
const SalesWorkspace = dynamic(() => import("@/components/SalesWorkspace"), { ssr: false });

/** HR links to the delegation board through the host, not a prop chain. */
function HumanResourcesWorkspace() {
  const host = useWorkspaceHost();
  return <HumanResourcesDashboard onNavigate={host.navigate} />;
}

const RENDERERS: Record<string, React.ComponentType> = {
  "zoho-sent-analyzer": ZohoEstimates,
  "dpp-prices-dashboard": DppPricesDashboard,
  "wa-engine-monitor": WaEngineDashboard,
  "whatsapp-marketing": WhatsAppMarketingDashboard,
  "neodove-telecaller-report": NeodoveTelecallerDashboard,
  sales: SalesWorkspace,
  accounts: AccountsDashboard,
  "debtors-tracker": DebtorsTrackerDashboard,
  "digital-marketing": DigitalMarketingDashboard,
  "human-resources": HumanResourcesWorkspace,
  "whatsapp-autopilot": AutopilotDashboard,
  "enquiry-procurement": ProcurementQueue,
  "enquiry-management": ManagementReview,
  crm: CrmDashboard,
  "product-line": ProductLineDashboard,
  "samarth-overview": SamarthOverviewDashboard,
  "sahil-overview": SahilOverviewDashboard,
  linkedin: LinkedinDashboard,
  "ai-usage": AiUsageDashboard,
  "reporting-sheet": ReportingSheetView,
  stock: StockDashboard,
};

/** Slugs with a dedicated renderer (others fall back to SheetAnalysisDashboard). */
export const RENDERED_SLUGS: readonly string[] = Object.keys(RENDERERS);

export function WorkspaceRenderer({ slug }: { slug: string }) {
  const canonical = canonicalNavSlug(slug);
  const Component = RENDERERS[canonical];
  if (Component) return <Component />;
  // Generic sheet-analysis renderer: any automation whose `data()` returns
  // { meta: { analysis: 'sheet', ... } } gets a dashboard automatically.
  return <SheetAnalysisDashboard slug={canonical} />;
}
