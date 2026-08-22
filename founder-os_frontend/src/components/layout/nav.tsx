import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, ClipboardList, Sparkles, MessageCircle, Workflow } from "lucide-react";

export type ViewType = "dashboard" | "enquiries" | "detail" | "briefing" | "whatsapp" | "automations";

export interface NavItem {
  view: ViewType;
  label: string;
  icon: LucideIcon;
  /** Show in the mobile bottom tab bar */
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { view: "enquiries", label: "Enquiries", icon: ClipboardList, mobile: true },
  { view: "automations", label: "Automations", icon: Workflow, mobile: true },
  { view: "briefing", label: "Founder AI", icon: Sparkles, mobile: true },
  { view: "whatsapp", label: "WhatsApp", icon: MessageCircle, mobile: true },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.mobile);
