// Extracted verbatim from EnquiryDetail.tsx by scripts/refactor/split-module.mjs.
// EnquiryDetail.tsx re-exports everything public here, so existing imports keep working.
import { Enquiry, Agent, Comment, EnquiryItem } from "../../types";

export interface EnquiryDetailProps {
  selectedEnquiry: Enquiry;
  agents: Agent[];
  currentAgent: Agent;
  comments: Comment[];
  onUpdateStatus: (id: string, newStatus: Enquiry["status"]) => void;
  onUpdateAgent: (id: string, newAgentId: string) => void;
  onAddComment: (comment: Comment) => void;
  onUpdateItems?: (id: string, items: EnquiryItem[] | ((prev: EnquiryItem[]) => EnquiryItem[])) => Promise<any> | void;
  /** Server-side append of an "Add via AI" raw requirement (preferred — never echoes stale items). */
  onAddRequirement?: (id: string, text: string, imageUrls?: string[]) => Promise<any> | void;
  /** Accept a price-memory suggestion: marks the item rate-available (skips the loop). */
  onAcceptSuggestion?: (id: string, itemIndex: number) => Promise<void>;
  onMarkSent?: (id: string) => Promise<void>;
  /** Reopen a sent enquiry for additional scope (any team member). */
  onReviseSent?: (id: string) => Promise<void>;
  /** Last save failure from useEnquiryData (bannered — never a silent revert). */
  saveError?: string | null;
  onDismissSaveError?: () => void;
  onDeleteEnquiry: (id: string) => void;
  onOpenEdit: (enq: Enquiry) => void;
  onBack: () => void;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
  redacted?: boolean;
  /** Vendor-rate visibility forwarded to SpecificationsSection. */
  ratesMode?: "none" | "edit" | "view";
}
