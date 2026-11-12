import type { LucideIcon } from "lucide-react";
import { Sparkles, MessageCircle, Workflow, ShieldCheck, MessagesSquare, Mail, Settings, ListChecks, LayoutGrid } from "lucide-react";

export type ViewType =
  | "session"
  | "briefing"
  | "delegation"
  | "whatsapp"
  | "automations"
  | "chat"
  | "admin"
  | "email"
  | "settings";

export interface NavItem {
  view: ViewType;
  label: string;
  icon: LucideIcon;
  /** Show in the mobile bottom tab bar */
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // The signed-in viewer's dashboards (/session). First, so a login whose
  // current view is denied lands here (page.tsx auto-routes to the first
  // accessible item).
  { view: "session", label: "Workspace", icon: LayoutGrid, mobile: true },
  // Automation REGISTRY console (admin only — canView gates it).
  { view: "automations", label: "Automations", icon: Workflow, mobile: true },
  // Employee delegation board — every approved login, HR or not.
  { view: "delegation", label: "Delegation", icon: ListChecks, mobile: true },
  { view: "chat", label: "Chat", icon: MessagesSquare, mobile: true },
  { view: "briefing", label: "Founder AI", icon: Sparkles, mobile: true },
  { view: "whatsapp", label: "WhatsApp", icon: MessageCircle, mobile: true },
  // Founder email service — root-only (canView hides it from everyone else).
  { view: "email", label: "Email", icon: Mail },
  // Runtime application settings — root-only (provider priority + AI models).
  { view: "settings", label: "Settings", icon: Settings },
  { view: "admin", label: "Admin", icon: ShieldCheck },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.mobile);

/** Every top-level view the router accepts (derived — add a view in NAV_ITEMS only). */
export const VIEW_TYPES: ViewType[] = NAV_ITEMS.map((i) => i.view);

// Navigation targets: a main view or a workspace (dashboard) slug.
export type NavTarget =
  | { type: "view"; view: ViewType }
  | { type: "dashboard"; slug: string };

export function navTargetPath(t: NavTarget): string {
  // Dashboards live under /session for everyone (workspaces); /automations is
  // the registry console only.
  if (t.type === "dashboard") return `/session/${t.slug}`;
  const paths: Record<ViewType, string> = {
    session: "/session",
    briefing: "/briefing",
    delegation: "/delegation",
    whatsapp: "/whatsapp",
    automations: "/automations",
    chat: "/chat",
    admin: "/admin",
    email: "/email",
    settings: "/settings",
  };
  return paths[t.view];
}