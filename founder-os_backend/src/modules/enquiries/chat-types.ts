// chat-types.ts — sales copilot shapes (shared by chat.ts + chat-tools*).
//
// Verbatim extract from chat.ts (Phase-1 split): interfaces only, no logic,
// so tool implementations and the department def stay in sync by construction.
import type { EnquiryStore } from './store';
import type { MeResponse } from '../auth/types';

export interface SpecQuestion {
  key: string;
  label: string;
  note: string;
  required: boolean;
  /** options = MCQ single-pick · multiselect = MSQ multi-pick · number/date/text */
  type: 'options' | 'multiselect' | 'text' | 'number' | 'date';
  options: string[];
}

export interface PriceTableRow {
  variation: string;
  markedPrice: number;
  unit: string;
  /** Null for non-scored rows (e.g. the item's own earlier prices). */
  confidence: number | null;
  quoteAgeDays: number | null;
  moq: string | null;
  deliveryDays: number | null;
  best: boolean;
  /** 1-based item number + name (set for batch tables spanning items). */
  itemIndex?: number;
  itemName?: string;
  /** 'Catalogue' past-quote rows vs 'Earlier' item-history rows. */
  tag?: string;
  /** Full labeled spec list for the per-item "all info" view. */
  specs?: { question: string; value: string }[];
  /** Vendor's rate photo (no vendor identity). */
  imageUrl?: string | null;
}

export interface ChatProposal {
  kind: 'comment' | 'spec_fix' | 'price_quote' | 'spec_form' | 'price_table';
  text?: string;
  scope?: 'sales' | 'procurement';
  itemIndex?: number;
  spec?: string;
  label: string;
  // price_quote only (vendor-blind by construction — see match.ts):
  productId?: string;
  productName?: string;
  markedPrice?: number;
  unit?: string;
  confidence?: number;
  quoteAgeDays?: number | null;
  moq?: string | null;
  deliveryDays?: number | null;
  // spec_form only:
  questions?: SpecQuestion[];
  // price_table only:
  rows?: PriceTableRow[];
  /** Enquiry item's own photo urls (image-type media) for the per-item view. */
  itemMedia?: string[];
  /** True when the lookup found NO usable price — the UI then offers the
   *  "Fetch from procurement" button (and only then). */
  needsProcurement?: boolean;
}

/** Audible-visible step for the UI chime: which tool ran + one-line outcome. */
export interface ChatActivity {
  tool: string;
  label: string;
}

export interface ChatReply {
  reply: string;
  proposals: ChatProposal[];
  activity: ChatActivity[];
}

export interface SalesCtx {
  env: Record<string, unknown>;
  store: EnquiryStore;
  me: MeResponse;
  enquiryId: string;
  restricted: boolean;
  privileged: boolean;
}
