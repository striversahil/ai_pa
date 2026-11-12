// Extracted verbatim from SpecificationsSection.tsx by scripts/refactor/split-module.mjs.
// SpecificationsSection.tsx re-exports everything public here, so existing imports keep working.
import { Enquiry, EnquiryItem } from "../../types";
import type { IntakeSuggestion } from "../../hooks/useIntake";

export interface SpecificationsSectionProps {
  selectedEnquiry: Enquiry;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
  onAddRequirement?: (text: string, images: string[]) => void;
  onUpdateItems?: (items: EnquiryItem[] | ((prev: EnquiryItem[]) => EnquiryItem[])) => void;
  redacted?: boolean;
  /** Vendor-rate visibility per view: sales sees finals only ('none');
   *  procurement collects rates ('edit'); management reviews them ('view'). */
  ratesMode?: "none" | "edit" | "view";
  /** AI intake (suggestions + missing slots) rendered per item row.
   *  `ready:false` = the GH intake action hasn't finished yet. */
  intake?: { suggestions: IntakeSuggestion[]; missing: string[]; ready?: boolean } | null;
  /** Sales 1-click quote-from-memory (marks rateAvailable on the item). */
  onAcceptSuggestion?: (itemIndex: number) => void;
}
