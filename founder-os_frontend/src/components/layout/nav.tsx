import type { LucideIcon } from "lucide-react";
import { Sparkles, MessageCircle, Workflow, ShieldCheck, MessagesSquare } from "lucide-react";

export type ViewType =
  | "briefing"
  | "whatsapp"
  | "automations"
  | "chat"
  | "admin";

export interface NavItem {
  view: ViewType;
  label: string;
  icon: LucideIcon;
  /** Show in the mobile bottom tab bar */
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { view: "automations", label: "Automations", icon: Workflow, mobile: true },
  { view: "chat", label: "Chat", icon: MessagesSquare, mobile: true },
  { view: "briefing", label: "Founder AI", icon: Sparkles, mobile: true },
  { view: "whatsapp", label: "WhatsApp", icon: MessageCircle, mobile: true },
  { view: "admin", label: "Admin", icon: ShieldCheck },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.mobile);

// Navigation targets: a main view or an automation dashboard slug.
export type NavTarget =
  | { type: "view"; view: ViewType }
  | { type: "dashboard"; slug: string };

export function navTargetPath(t: NavTarget): string {
  if (t.type === "dashboard") return `/automations/${t.slug}`;
  const paths: Record<ViewType, string> = {
    briefing: "/briefing",
    whatsapp: "/whatsapp",
    automations: "/automations",
    chat: "/chat",
    admin: "/admin",
  };
  return paths[t.view];
}