// Extracted verbatim from Sidebar.tsx by scripts/refactor/split-module.mjs.
// Sidebar.tsx re-exports everything public here, so existing imports keep working.
import { FileText, Tag, PhoneCall, Radio, Megaphone, Bot, Table2, TrendingUp, PackageCheck, ClipboardCheck, Crown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const DASH_ICONS: Record<string, LucideIcon> = {
  "zoho-sent-analyzer": FileText,
  "dpp-prices-dashboard": Tag,
  "neodove-telecaller-report": PhoneCall,
  "wa-engine-monitor": Radio,
  "whatsapp-marketing": Megaphone,
  "whatsapp-autopilot": Bot,
  "sheet-analysis": Table2,
  sales: TrendingUp,
  crm: PackageCheck,
  "enquiry-procurement": ClipboardCheck,
  "enquiry-management": Crown,
  "telecalling-agent-analysis": Table2,
};
