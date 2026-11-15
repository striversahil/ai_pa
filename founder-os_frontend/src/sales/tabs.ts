"use client";

// sales/tabs.ts — ONE home for the Sales tab definitions (extracted verbatim
// from SalesWorkspace; both it and the Sales Head dashboard render these).
// Same gates, same order, same persisted pick — add a section once here and
// both surfaces gain it. Pure hook: no fetch, no panels (hosts map keys to
// their own dynamic imports, so chunks stay split per surface).
import { useMemo } from "react";
import { useAuth } from "@/auth/AuthContext";
import { canView } from "@/auth/permissions";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { masterCapabilities } from "@/master-data/permissions";
import { hasSalesManagerAccess } from "@/components/sales-controller-panel/helpers";

export type SalesTab = "leaderboard" | "analyzer" | "enquiries" | "master" | "dispatch" | "field" | "objections" | "controller";

export interface SalesTabDef {
  key: SalesTab;
  label: string;
  icon: string;
}

export const SALES_TAB_STORAGE_KEY = "sales_tab";

/** Tabs this viewer may open (controller sits last so agent tabs never shift). */
export function useSalesTabs(): { tabs: SalesTabDef[]; active: SalesTab; setActive: (t: SalesTab) => void } {
  const { me } = useAuth();
  const caps = masterCapabilities(me);
  const canManage = hasSalesManagerAccess(me);
  const [storedTab, setStoredTab] = useLocalStorage<SalesTab>(SALES_TAB_STORAGE_KEY, "leaderboard");

  const tabs = useMemo<SalesTabDef[]>(() => {
    const out: SalesTabDef[] = [];
    // Leaderboard: everyone on the `sales` automation holds `telecalling`.
    if (canView(me, "telecalling")) out.push({ key: "leaderboard", label: "Leaderboard", icon: "🏆" });
    // Analyzer: Zoho sent-estimate analysis, same audience as the leaderboard.
    if (canView(me, "telecalling")) out.push({ key: "analyzer", label: "Analyzer", icon: "📊" });
    if (canView(me, "enquiry-tracker")) out.push({ key: "enquiries", label: "Enquiries", icon: "📋" });
    if (caps.canView) out.push({ key: "master", label: "Customer Master", icon: "👥" });
    // Dispatch reads are open to sales agents too (server-region-scoped; the
    // floor-only actions stay hidden inside the panel via the viewer flags).
    if (canView(me, "crm") || canView(me, "telecalling") || canView(me, "dispatch")) {
      out.push({ key: "dispatch", label: "Dispatch", icon: "🚚" });
    }
    // Field Staff: daily visit tracking for the field force (mobile-web
    // check-in + mill rows + expenses + follow-ups). Same audience as the
    // leaderboard — agents log visits for field staff like field enquiries.
    if (canView(me, "telecalling") || canManage) {
      out.push({ key: "field", label: "Field Staff", icon: "🧑‍🌾" });
    }
    // Objections: what the field is hearing — same audience as the
    // leaderboard, every agent sees every objection. Controller stays last.
    if (canView(me, "telecalling") || canManage) {
      out.push({ key: "objections", label: "Objections", icon: "🛡️" });
    }
    // Controller is root/sales-head only and sits LAST so agents' tabs never shift.
    if (canManage) out.push({ key: "controller", label: "Controller", icon: "🎛️" });
    return out;
  }, [me, caps.canView, canManage]);

  // Never land on a tab this user cannot open. The pick persists across
  // reloads so the highlight always matches the view.
  const active = tabs.find((t) => t.key === storedTab)?.key ?? tabs[0]?.key ?? "leaderboard";
  return { tabs, active, setActive: setStoredTab };
}
