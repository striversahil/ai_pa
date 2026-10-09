// copilot/types.ts — shared contract for every department copilot UI.
//
// Mirrors backend src/copilot/types.ts (CopilotDef) on the frontend: one
// message/proposal/activity shape, one endpoint config, rendered by
// CopilotView. Departments differ only in config + proposal cards —
// transport, chaining, thinking, and confirm flow are identical.
// (Extracted from the ChatbaseCopilot ↔ CopilotChat fork; both now consume this.)

export interface CopilotActivity {
  tool: string;
  label: string;
  /** Announced before the tool runs; cleared when the completion lands. */
  pending?: boolean;
}

export interface CopilotSpecQuestion {
  key: string;
  label: string;
  note?: string;
  required?: boolean;
  type?: 'options' | 'multiselect' | 'text' | 'number' | 'date';
  options?: string[];
}

/** Superset proposal: every department's card fields, all optional except
 *  kind/label. Unknown future kinds ride along via the index signature. */
export interface CopilotProposal {
  kind: string;
  label: string;
  text?: string;
  spec?: string;
  scope?: string;
  title?: string;
  itemIndex?: number;
  productId?: string;
  productName?: string;
  markedPrice?: number;
  unit?: string;
  confidence?: number | null;
  quoteAgeDays?: number | null;
  moq?: string | null;
  deliveryDays?: number | null;
  questions?: CopilotSpecQuestion[];
  rows?: CopilotPriceRow[];
  itemMedia?: string[];
  needsProcurement?: boolean;
  table?: { columns?: string[]; rows?: Record<string, string>[] };
  [key: string]: unknown;
}

export interface CopilotPriceRow {
  variation: string;
  markedPrice: number;
  unit: string;
  confidence?: number | null;
  quoteAgeDays?: number | null;
  moq?: string | null;
  deliveryDays?: number | null;
  best?: boolean;
  itemIndex?: number;
  itemName?: string;
  tag?: string;
  specs?: { question: string; value: string }[];
  imageUrl?: string | null;
}

export interface CopilotMsg {
  role: 'user' | 'assistant';
  text: string;
  proposals?: CopilotProposal[];
  activity?: CopilotActivity[];
  thinking?: string;
}

export interface CopilotEndpoints {
  streamUrl: string;
  chatUrl: string;
  /** Absent = read-only copilot (confirm cards hidden, confirm() no-ops). */
  executeUrl?: string;
  /** Abort budget ms (default 60000). 0 or negative = no timer. */
  timeoutMs?: number;
  /** Local state clears whenever this changes (enquiry/product id). */
  resetKey: string | number;
  /** 'volatile' mints a per-mount session id sent with every request
   *  (product-line); 'none' sends bare { message } (sales enquiries). */
  sessionMode?: 'none' | 'volatile';
  /** Merged into every message POST (e.g. { batchId }). */
  extraBody?: Record<string, string>;
  /** Side effect on reset (sales: server-side chat/clear POST). */
  onReset?: () => void;
}

export interface CopilotViewConfig {
  title: string;
  subtitle: string;
  emptyText: string;
  suggestions: string[];
  toolIcons: Record<string, string>;
  userInitial?: string;
  /** "full" = popup + bottom pill; "popup" = popup only (caller owns launcher). */
  chrome?: 'full' | 'popup';
  modes?: { id: string; label: string }[];
  mode?: string;
  onModeChange?: (id: string) => void;
  headerExtra?: import('react').ReactNode;
  /** Refresh-button label ("Clear chat" vs "New chat"). */
  resetTitle?: string;
}
