// Extracted verbatim from Sidebar.tsx by scripts/refactor/split-module.mjs.
// Sidebar.tsx re-exports everything public here, so existing imports keep working.
import type { LucideIcon } from "lucide-react";
import type { NavTarget, ViewType } from "../nav";
import type { AppThemeId } from "@/hooks/useTheme";

export interface SidebarRow {
  key: string;
  label: string;
  icon: LucideIcon;
  target: NavTarget;
  isActive: boolean;
  isDashboard: boolean;
}

export interface SidebarProps {
  activeView: ViewType;
  activeSlug: string | null;
  onNavigate: (target: NavTarget) => void;
  theme: AppThemeId;
  onSetTheme: (id: AppThemeId) => void;
  accent: string | null;
  onSetAccent: (value: string | null) => void;
  me: { email: string; name: string; picture: string | null } | null;
  onLogout: () => void;
  canView: (view: string) => boolean;
}
